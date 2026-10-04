import { round2, roundRupee } from './line-math';
import { SaleError, intOrNull } from './sale';
import { prisma } from './db';
import { convertDateToTimestamp, paymentDateTs } from './date-utils';
import { getCurrentFinancialYear } from './financial-year';
import { generateNoteNumber } from './note-counter';
import { ledgerService } from './ledger-service';
import { balanceHandler } from './balance-handler';
import { transactionHandler } from './transaction-handler';
import { returnCounterAmounts } from './advance-allocation';
import { resolveReturnReasons } from './return-reasons';

/**
 * Purchase (vendor) return pricing and validation, the twin of
 * lib/sale-return.ts so the two sides refuse and price the same way.
 *
 *  - A line cannot be returned beyond what is left of it (other returns
 *    counted, the return being edited excluded), and must be on one of THIS
 *    vendor's bills. Neither was checked: only current stock was.
 *  - The price is the purchase rate unless the form lowers it; never above.
 *  - Tax is the line's own GST % (the form's tax_rate was trusted), split the
 *    way the bill was (IGST if the bill line carried IGST). Edit split on an
 *    `item.vendor_state_code` the form never sends, so every edit became IGST.
 *  - Totals round per F-34: each tax head and the refund to the rupee.
 *
 * Purchase lines carry no discount column, so the rate is already net.
 */
export interface PricedPurchaseLine {
  purchase_item_id: number;
  product_id: number | null;
  purchase_id: number;
  return_qty: number;
  return_reason_id: number;
  unit_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  notes: string;
}

export async function pricePurchaseReturnLines(
  tx: any,
  vendorId: number,
  items: any[],
  opts: { excludeReturnId?: number } = {}
) {
  if (!Array.isArray(items) || items.length === 0) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION');
  const wanted = items.map((i: any) => ({
    id: intOrNull(i.purchase_item_id ?? i.id),
    qty: Math.round(Number(i.return_qty)),
    reason: intOrNull(i.return_reason_id) || null,
    price: i.unit_price,
    notes: i.notes || ''
  }));
  if (wanted.some(w => w.id === null)) throw new SaleError(400, 'Every return line needs its bill line', 'VALIDATION');
  const ids = wanted.map(w => w.id as number);
  if (new Set(ids).size !== ids.length) throw new SaleError(400, 'The same line was sent twice', 'DUPLICATE_LINE');

  const lines = await tx.purchaseitems.findMany({
    where: { id: { in: ids } },
    select: { id: true, purchase_id: true, product_id: true, qty: true, rate: true, gst_percentage: true, igst: true, name_of_product: true }
  });
  const byId = new Map<number, any>(lines.map((l: any) => [l.id, l]));
  const billIds = Array.from(new Set(lines.map((l: any) => l.purchase_id)));
  const bills = billIds.length ? await tx.purchase.findMany({ where: { id: { in: billIds } }, select: { id: true, vendor_id: true } }) : [];
  const vendorOf = new Map<number, number | null>(bills.map((b: any) => [b.id, b.vendor_id]));
  const prior = await tx.purchase_return_items.findMany({
    where: { purchase_item_id: { in: ids } },
    select: { purchase_item_id: true, purchase_return_id: true, return_qty: true }
  });
  const returned = new Map<number, number>();
  for (const r of prior) {
    if (opts.excludeReturnId !== undefined && r.purchase_return_id === opts.excludeReturnId) continue;
    returned.set(r.purchase_item_id, (returned.get(r.purchase_item_id) || 0) + (Number(r.return_qty) || 0));
  }

  const priced: PricedPurchaseLine[] = wanted.map(w => {
    const line = byId.get(w.id as number);
    if (!line) throw new SaleError(400, 'A return line does not belong to any purchase bill', 'UNKNOWN_LINE');
    if ((vendorOf.get(line.purchase_id) ?? null) !== vendorId) {
      throw new SaleError(400, `"${line.name_of_product}" is not on a bill from this vendor`, 'FOREIGN_BILL');
    }
    if (!Number.isFinite(w.qty) || w.qty < 1) throw new SaleError(400, `Return at least 1 of "${line.name_of_product}"`, 'VALIDATION');
    const left = (Number(line.qty) || 0) - (returned.get(line.id) || 0);
    if (w.qty > left) {
      throw new SaleError(400, `Only ${left} of "${line.name_of_product}" can still be returned`, 'OVER_RETURN',
        { product_name: line.name_of_product, available_qty: left, requested_qty: w.qty });
    }
    const rate = round2(Number(line.rate) || 0);
    let unit = rate;
    if (w.price !== undefined && w.price !== null && w.price !== '') {
      const asked = Number(w.price);
      if (!Number.isFinite(asked) || asked < 0) throw new SaleError(400, 'A return price must be a number', 'VALIDATION');
      if (asked > rate + 0.005) throw new SaleError(400, `The return price of "${line.name_of_product}" cannot be more than it was bought for (₹${rate})`, 'PRICE_ABOVE_PURCHASE');
      unit = round2(asked);
    }
    const subtotal = round2(w.qty * unit);
    const tax = round2((subtotal * (Number(line.gst_percentage) || 0)) / 100);
    const inter = (Number(line.igst) || 0) > 0;
    return {
      purchase_item_id: line.id,
      product_id: line.product_id ?? null,
      purchase_id: line.purchase_id,
      return_qty: w.qty,
      return_reason_id: w.reason ?? 0,
      unit_price: unit,
      tax_amount: tax,
      cgst: inter ? 0 : round2(tax / 2),
      sgst: inter ? 0 : round2(tax / 2),
      igst: inter ? tax : 0,
      notes: w.notes
    };
  });

  // A purchase reason; none sent = the form's first (D-04, as the sale twin).
  const reasons = await resolveReturnReasons(tx, ['purchase'], priced.map(l => l.return_reason_id || null), 'purchase');
  priced.forEach((l, i) => { l.return_reason_id = reasons[i]; });

  const sum = (f: keyof PricedPurchaseLine) => priced.reduce((s, l) => s + (l[f] as number), 0);
  const totalAmount = round2(priced.reduce((s, l) => s + round2(l.return_qty * l.unit_price), 0));
  const totalTax = roundRupee(sum('cgst')) + roundRupee(sum('sgst')) + roundRupee(sum('igst'));
  return {
    lines: priced,
    totalAmount,
    totalTax,
    purchaseIds: Array.from(new Set(priced.map(l => l.purchase_id))),
    refund: (pf: number) => roundRupee(totalAmount + totalTax + round2(pf || 0))
  };
}

/** The row each priced line is stored as. */
export const purchaseReturnItemRow = (returnId: number, l: PricedPurchaseLine) => ({
  purchase_return_id: returnId,
  purchase_item_id: l.purchase_item_id,
  return_qty: l.return_qty,
  return_reason_id: l.return_reason_id,
  unit_price: l.unit_price,
  tax_amount: l.tax_amount,
  cgst: l.cgst,
  sgst: l.sgst,
  igst: l.igst,
  notes: l.notes
});

/** Recompute return_status (0 none, 1 partial, 2 full) for each bill, by id. */
export async function recalcPurchaseReturnStatus(tx: any, purchaseIds: number[]) {
  for (const pid of Array.from(new Set(purchaseIds.filter(Boolean)))) {
    const lines = await tx.purchaseitems.findMany({ where: { purchase_id: pid }, select: { id: true, qty: true } });
    const rows = lines.length
      ? await tx.purchase_return_items.findMany({ where: { purchase_item_id: { in: lines.map((l: any) => l.id) } }, select: { purchase_item_id: true, return_qty: true } })
      : [];
    const back = new Map<number, number>();
    rows.forEach((r: any) => back.set(r.purchase_item_id, (back.get(r.purchase_item_id) || 0) + (Number(r.return_qty) || 0)));
    const any = rows.length > 0;
    const full = lines.length > 0 && lines.every((l: any) => (back.get(l.id) || 0) >= (Number(l.qty) || 0));
    await tx.purchase.update({ where: { id: pid }, data: { return_status: !any ? 0 : full ? 2 : 1 } });
  }
}

// ============================================================================
// Create, update, delete and read (RETURNS_PLAN R5). These were the bodies of
// pages/api/purchase-returns/vendor-return.ts and [id].ts, moved here so the
// routes are thin like the sale-return ones. Ledger and balance conventions
// are unchanged: a complete return posts a DEBIT_NOTE and moves the vendor's
// refund counters; edits and deletes go through transactionHandler.
// ============================================================================

const pad3 = (n: number) => String(n).padStart(3, '0');
export const purchaseReturnNo = (id: number) => `PR-${pad3(id)}`;

const ymd = (ts?: number | null) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const statusOf = (v: any, fallback: number) => {
  const s = intOrNull(v);
  if (s === null) return fallback;
  if (s !== 0 && s !== 1) throw new SaleError(400, 'payment_status must be 0 (pending refund) or 1 (refunded)', 'VALIDATION');
  return s;
};

/** Returning more than is in stock is refused (some may have been sold since). */
async function checkStock(tx: any, lines: PricedPurchaseLine[], givenBack: Map<number, number> = new Map()) {
  const need = new Map<number, number>();
  for (const l of lines) if (l.product_id) need.set(l.product_id, (need.get(l.product_id) || 0) + l.return_qty);
  const ids = Array.from(need.keys());
  if (!ids.length) return;
  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, stock: true, product_name: true } });
  for (const p of products) {
    const want = (need.get(p.id) || 0) - (givenBack.get(p.id) || 0);
    if (want > 0 && want > (Number(p.stock) || 0)) {
      throw new SaleError(400,
        `Cannot return ${want} units of "${p.product_name}". Only ${p.stock} units in stock. (Some units may have been sold)`,
        'INSUFFICIENT_STOCK', { product_name: p.product_name, requested_qty: want, current_stock: p.stock });
    }
  }
}

/**
 * How a return edit moves the vendor's refund counters, from what the return
 * itself put on them (`before`: the balance-log rows under its debit note
 * number, the same figures a delete takes back).
 *
 * A refunded return holds its refund (less any old refund allocations to it)
 * on total_refund_allocated. Of that, the part not drawn from an on-account
 * vendor refund is also on total_refunded. Pending: nothing on either.
 *  - raised (or marked refunded): the extra draws first on the vendor's free
 *    on-account refund, as marking refunded always has (owner); the rest is
 *    new refund money;
 *  - lowered: the drawn part is given back to on account first; the return's
 *    own refund money comes off only below that;
 *  - marked pending: both come off, exactly what the return added.
 */
export function returnCounterChange(p: {
  before: { refunded: number; allocated: number };
  newStatus: number;
  newTotal: number;
  totalAllocated: number;
  freeRefund: number;
}): { total_refunded?: number; total_refund_allocated?: number } | null {
  const { before } = p;
  const allocated = p.newStatus === 1 ? Math.max(0, round2(p.newTotal - p.totalAllocated)) : 0;
  let refunded: number;
  if (allocated <= before.allocated) {
    refunded = Math.min(before.refunded, allocated);
  } else {
    const extra = round2(allocated - before.allocated);
    refunded = round2(before.refunded + extra - Math.min(Math.max(0, round2(p.freeRefund)), extra));
  }
  const dR = round2(refunded - before.refunded);
  const dA = round2(allocated - before.allocated);
  if (!dR && !dA) return null;
  return { ...(dR ? { total_refunded: dR } : {}), ...(dA ? { total_refund_allocated: dA } : {}) };
}

/** POST /api/purchase-returns/vendor-return */
export async function createVendorReturn(body: any) {
  const vendorId = intOrNull(body.vendor_id);
  if (vendorId === null || !Array.isArray(body.items) || body.items.length === 0) {
    throw new SaleError(400, 'Vendor ID and items are required', 'VALIDATION');
  }
  if (body.items.some((i: any) => Number(i.return_qty) < 0)) {
    throw new SaleError(400, 'Return quantities must be 0 or positive', 'VALIDATION');
  }
  const fy = await getCurrentFinancialYear();
  const returnDate = body.return_date ? convertDateToTimestamp(body.return_date) : Math.floor(Date.now() / 1000);
  const priced = await pricePurchaseReturnLines(prisma, vendorId, body.items);
  await checkStock(prisma, priced.lines);
  const pf = round2(Number(body.packing_forwarding_amount) || 0);
  if (pf < 0) throw new SaleError(400, 'P&F cannot be negative', 'VALIDATION');
  const refundAmount = priced.refund(pf);
  const status = statusOf(body.payment_status, 0);
  const mode = intOrNull(body.payment_mode) ?? 1;
  const paymentDate = status === 1 ? (paymentDateTs(body.payment_date) ?? returnDate) : null;
  const debitNoteNo = await generateNoteNumber('DEBIT', fy);

  const record = await prisma.$transaction(async (tx: any) => {
    const data: any = {
      debit_note_no: debitNoteNo,
      note_type: 'DEBIT',
      vendor: { connect: { id: vendorId } },
      return_date: returnDate,
      total_amount: priced.totalAmount,
      total_tax: priced.totalTax,
      status: 1,
      notes: body.return_notes ?? body.notes ?? '',
      fy,
      payment_status: status,
      payment_mode: mode,
      payment_date: paymentDate,
      refund_amount: refundAmount,
      include_packing_forwarding: 0,
      include_freight: 0,
      pf_calculation_method: 3,
      freight_calculation_method: 3,
      packing_forwarding_amount: pf,
      freight_amount: 0
    };
    if (priced.purchaseIds.length) data.purchase = { connect: { id: priced.purchaseIds[0] } };
    const ret = await tx.purchase_returns.create({ data });
    await tx.purchase_return_items.createMany({ data: priced.lines.map(l => purchaseReturnItemRow(ret.id, l)) });
    for (const l of priced.lines) {
      if (l.product_id) await tx.product.update({ where: { id: l.product_id }, data: { stock: { decrement: l.return_qty } } });
    }
    await recalcPurchaseReturnStatus(tx, priced.purchaseIds);
    if (status === 1) {
      await ledgerService.createDebitNoteEntry({
        id: ret.id, vendor_id: vendorId, debit_note_no: debitNoteNo, return_date: returnDate,
        total_amount: priced.totalAmount, total_tax: priced.totalTax, packing_forwarding_amount: pf,
        freight_amount: 0, refund_amount: refundAmount, fy
      } as any, tx);
      await balanceHandler.incrementBalanceInTransaction(tx, vendorId,
        { total_refunded: refundAmount, total_refund_allocated: refundAmount },
        { type: 'return_create', id: ret.id, reference_no: debitNoteNo, notes: `Return complete: ₹${refundAmount}` });
    }
    return ret;
  }, { timeout: 45000 });

  return {
    id: record.id,
    debit_note_no: debitNoteNo,
    return_no: purchaseReturnNo(record.id),
    total_amount: priced.totalAmount,
    total_tax: priced.totalTax,
    packing_forwarding_amount: pf,
    freight_amount: 0,
    refund_amount: refundAmount,
    status: 'Completed',
    payment_status: record.payment_status,
    payment_mode: record.payment_mode,
    payment_date: record.payment_date
  };
}

/** PUT /api/purchase-returns/[id] */
export async function updatePurchaseReturn(returnId: number, body: any) {
  if (!Array.isArray(body.items)) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION');
  const existing = await prisma.purchase_returns.findUnique({ where: { id: returnId } });
  if (!existing) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
  const vendorId = existing.vendor_id as number;
  // What the return was, copied before the update.
  const oldStatus = existing.payment_status ?? 0;
  const oldTotal = Number(existing.refund_amount ?? ((existing.total_amount || 0) + (existing.total_tax || 0)));
  const oldDate = existing.return_date;
  const allocations = await prisma.refund_allocations.findMany({ where: { return_id: returnId }, select: { allocated_amount: true } });
  const totalAllocated = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
  const finalDate = body.return_date ? convertDateToTimestamp(body.return_date) : existing.return_date;
  const mode = body.payment_mode !== undefined && body.payment_mode !== null ? (intOrNull(body.payment_mode) as number) : existing.payment_mode;

  return prisma.$transaction(async (tx: any) => {
    const priced = await pricePurchaseReturnLines(tx, vendorId, body.items, { excludeReturnId: returnId });
    const pf = round2(Number(body.packing_forwarding_amount) || 0);
    if (pf < 0) throw new SaleError(400, 'P&F cannot be negative', 'VALIDATION');
    const newTotal = priced.refund(pf);

    // Old refund allocations (before refunds went on account) decide the status.
    let newStatus = statusOf(body.payment_status, oldStatus);
    if (allocations.length) newStatus = totalAllocated >= newTotal ? 1 : totalAllocated > 0 ? 2 : 0;

    // Stock: the old lines go back, the new ones come out, net per product.
    const old = await tx.purchase_return_items.findMany({ where: { purchase_return_id: returnId }, select: { purchase_item_id: true, return_qty: true } });
    const lineIds = Array.from(new Set([...old.map((o: any) => o.purchase_item_id), ...priced.lines.map(l => l.purchase_item_id)]));
    const lineRows = await tx.purchaseitems.findMany({ where: { id: { in: lineIds } }, select: { id: true, product_id: true, purchase_id: true } });
    const productOf = new Map<number, number>(lineRows.map((l: any) => [l.id, l.product_id]));
    const givenBack = new Map<number, number>();
    for (const o of old) {
      const pid = productOf.get(o.purchase_item_id);
      if (pid) givenBack.set(pid, (givenBack.get(pid) || 0) + Number(o.return_qty));
    }
    await checkStock(tx, priced.lines, givenBack);
    const net = new Map<number, number>(givenBack);
    for (const l of priced.lines) if (l.product_id) net.set(l.product_id, (net.get(l.product_id) || 0) - l.return_qty);
    for (const [pid, adj] of Array.from(net.entries())) {
      if (adj) await tx.product.update({ where: { id: pid }, data: { stock: { increment: adj } } });
    }
    await tx.purchase_return_items.deleteMany({ where: { purchase_return_id: returnId } });
    await tx.purchase_return_items.createMany({ data: priced.lines.map(l => purchaseReturnItemRow(returnId, l)) });

    const sentPaymentDate = paymentDateTs(body.payment_date);
    const updated = await tx.purchase_returns.update({
      where: { id: returnId },
      data: {
        return_date: finalDate,
        total_amount: priced.totalAmount,
        total_tax: priced.totalTax,
        refund_amount: newTotal,
        packing_forwarding_amount: pf,
        // The form sends return_notes; this read `notes`, so every edit blanked the note.
        notes: body.return_notes ?? body.notes ?? existing.notes ?? '',
        payment_status: newStatus,
        payment_mode: mode ?? undefined,
        // A return marked pending has not been refunded: it carries no payment date (D-12).
        payment_date: newStatus === 1 ? (sentPaymentDate ?? existing.payment_date ?? finalDate) : newStatus === 0 ? null : existing.payment_date,
        updated_at: new Date()
      }
    });
    const oldBills = lineRows.filter((l: any) => old.some((o: any) => o.purchase_item_id === l.id)).map((l: any) => l.purchase_id);
    await recalcPurchaseReturnStatus(tx, [...priced.purchaseIds, ...oldBills]);

    if (finalDate !== oldDate) {
      await tx.vendor_ledger.updateMany({
        where: { vendor_id: vendorId, reference_type: 'purchase_return', reference_id: returnId, transaction_type: 'DEBIT_NOTE' },
        data: { transaction_date: finalDate }
      });
    }
    const vendor = await tx.vendor_details.findUnique({
      where: { id: vendorId },
      select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
    });
    const ops = await transactionHandler.handleReturnEdit({
      oldStatus,
      newStatus,
      oldTotal,
      newTotal,
      vendorId,
      returnId,
      debitNoteNo: existing.debit_note_no || '',
      paymentMode: mode ?? 1,
      paymentDate: sentPaymentDate ?? Math.floor(Date.now() / 1000),
      returnDate: finalDate,
      fy: existing.fy,
      totalAllocated,
      totalAmount: priced.totalAmount,
      totalTax: priced.totalTax,
      tx,
      currentBalance: vendor ? {
        total_paid: Number(vendor.total_paid), total_allocated: Number(vendor.total_allocated),
        total_refunded: Number(vendor.total_refunded), total_refund_allocated: Number(vendor.total_refund_allocated)
      } : undefined
    } as any);
    // The refund counters are moved here, not by the handler's status cases
    // (D-01..D-03): those were logged without the debit note number, so a later
    // delete reversed the wrong amount, and 1->0 / 1->1 assumed the return had
    // raised total_refunded by its whole refund even when it drew on an
    // on-account vendor refund.
    ops.balanceOp = null;
    await transactionHandler.executeInTransaction(tx, ops);
    const counters = returnCounterChange({
      before: await returnCounterAmounts(tx, 'vendor', vendorId, [existing.debit_note_no || ''],
        oldStatus === 1 ? Math.max(0, round2(oldTotal - totalAllocated)) : 0),
      newStatus, newTotal, totalAllocated,
      freeRefund: vendor ? Number(vendor.total_refunded) - Number(vendor.total_refund_allocated) : 0
    });
    if (counters) {
      await balanceHandler.incrementBalanceInTransaction(tx, vendorId, counters, {
        type: 'return_edit', id: returnId, reference_no: existing.debit_note_no || '',
        notes: newStatus === 1 ? `Return edited: refund ₹${newTotal}` : 'Return marked pending: refund counters reversed'
      });
    }
    return updated;
  }, { timeout: 45000 });
}

/** DELETE /api/purchase-returns/[id] */
export async function deletePurchaseReturn(returnId: number) {
  const record = await prisma.purchase_returns.findUnique({
    where: { id: returnId },
    select: { vendor_id: true, payment_status: true, debit_note_no: true, refund_amount: true }
  });
  if (!record) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
  const ops = await transactionHandler.handleReturnDelete({
    returnId,
    vendorId: record.vendor_id,
    paymentStatus: record.payment_status,
    debitNoteNo: record.debit_note_no,
    refundAmount: Number(record.refund_amount) || 0
  } as any);
  const lines = await prisma.purchase_return_items.findMany({ where: { purchase_return_id: returnId }, select: { purchase_item_id: true } });
  const bills = lines.length
    ? await prisma.purchaseitems.findMany({ where: { id: { in: lines.map(l => l.purchase_item_id) } }, select: { purchase_id: true } })
    : [];
  await prisma.$transaction(async (tx: any) => {
    await transactionHandler.executeDeleteInTransaction(tx, ops);
    await recalcPurchaseReturnStatus(tx, bills.map(b => b.purchase_id));
  }, { timeout: 45000 });
}

/**
 * GET /api/purchase-returns/[id]: the return with every line of its bills.
 * available_qty is what is left of each line apart from THIS return (other
 * lines of the bill ignored other returns before), bill_reference is the
 * bill's own reference (it repeated the bill number), and each line's tax
 * split is what was stored (it was re-guessed from the vendor's state).
 */
export async function loadPurchaseReturnDetail(returnId: number) {
  const record = await prisma.purchase_returns.findUnique({ where: { id: returnId } });
  if (!record) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
  const vendor = record.vendor_id != null
    ? await prisma.vendor_details.findUnique({
        where: { id: record.vendor_id },
        select: { id: true, vendor_name: true, state: true, state_code: true, tax_id: true, address: true, contact_no: true }
      })
    : null;
  if (!vendor) throw new SaleError(404, 'Associated vendor not found', 'NOT_FOUND');

  const mine = await prisma.purchase_return_items.findMany({
    where: { purchase_return_id: returnId },
    select: {
      id: true, purchase_item_id: true, return_qty: true, unit_price: true, tax_amount: true,
      cgst: true, sgst: true, igst: true, return_reason_id: true, notes: true,
      reason: { select: { id: true, reason_name: true } }
    }
  });
  const mineLines = mine.length
    ? await prisma.purchaseitems.findMany({ where: { id: { in: mine.map(m => m.purchase_item_id) } }, select: { purchase_id: true } })
    : [];
  const purchaseIds = Array.from(new Set(mineLines.map(l => l.purchase_id)));
  const [lines, purchases, allocations]: any[][] = await Promise.all([
    purchaseIds.length
      ? prisma.purchaseitems.findMany({
          where: { purchase_id: { in: purchaseIds } },
          select: { id: true, product_id: true, name_of_product: true, part: true, qty: true, rate: true, gst_percentage: true, purchase_id: true }
        })
      : [],
    purchaseIds.length
      ? prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, invoice_no: true, invoice_date: true, bill_reference: true, total: true } })
      : [],
    prisma.refund_allocations.findMany({
      where: { return_id: returnId },
      include: { refund: { select: { id: true, refund_date: true, refund_amount: true, refund_mode: true, refund_type: true, notes: true, created_at: true } } }
    })
  ]);
  const others = lines.length
    ? await prisma.purchase_return_items.findMany({
        where: { purchase_item_id: { in: lines.map(l => l.id) }, NOT: { purchase_return_id: returnId } },
        select: { purchase_item_id: true, return_qty: true }
      })
    : [];
  const elsewhere = new Map<number, number>();
  for (const o of others) elsewhere.set(o.purchase_item_id, (elsewhere.get(o.purchase_item_id) || 0) + (Number(o.return_qty) || 0));
  const productIds = Array.from(new Set(lines.map(l => l.product_id).filter((v): v is number => v != null)));
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, display_name: true, part_no: true, stock: true } })
    : [];
  const productMap = new Map(products.map(p => [p.id, p]));
  const mineByLine = new Map(mine.map(m => [m.purchase_item_id, m]));
  const purchaseMap = new Map(purchases.map(p => [p.id, p]));

  const billsMap = new Map<number, any>();
  for (const pid of purchaseIds) {
    const p = purchaseMap.get(pid);
    billsMap.set(pid, {
      id: String(pid),
      purchase_id: pid,
      invoice_no: p?.invoice_no?.toString() || '',
      bill_reference: p?.bill_reference || '',
      invoice_date: ymd(p?.invoice_date),
      // The bill's total, as the create screen shows it (D-09: this was the return's portion).
      total_amount: Number(p?.total) || 0,
      has_tax: (record.total_tax || 0) > 0,
      available_items: 0,
      total_items: 0,
      items: []
    });
  }
  for (const line of lines.slice().sort((a, b) => a.id - b.id)) {
    const r = mineByLine.get(line.id);
    const product = line.product_id != null ? productMap.get(line.product_id) : undefined;
    const bill = billsMap.get(line.purchase_id);
    const p = purchaseMap.get(line.purchase_id);
    const already = elsewhere.get(line.id) || 0;
    const available = Math.max(0, (Number(line.qty) || 0) - already);
    const returnQty = Number(r?.return_qty) || 0;
    const unitPrice = r ? Number(r.unit_price) || 0 : Number(line.rate) || 0;
    const taxAmount = Number(r?.tax_amount) || 0;
    const item = {
      id: String(line.id),
      purchase_item_id: line.id,
      product_id: line.product_id || 0,
      product_name: product?.display_name || line.name_of_product || 'Unknown Product',
      display_name: product?.display_name || line.name_of_product,
      part_number: product?.part_no || line.part,
      original_qty: Number(line.qty) || 0,
      already_returned: already,
      available_qty: available,
      is_fully_returned: available <= 0,
      current_stock: Number(product?.stock) || 0,
      return_qty: returnQty,
      unit_price: unitPrice,
      net_unit_price: Number(line.rate) || 0,
      tax_rate: Number(line.gst_percentage) || 0,
      tax_amount: taxAmount,
      cgst: Number(r?.cgst) || 0,
      sgst: Number(r?.sgst) || 0,
      igst: Number(r?.igst) || 0,
      total: round2(returnQty * unitPrice + taxAmount),
      return_reason_id: r?.return_reason_id || 1,
      return_reason: r?.reason?.reason_name || 'Unknown Reason',
      notes: r?.notes || '',
      bill_no: p?.invoice_no?.toString() || '',
      bill_reference: p?.bill_reference || '',
      invoice_date: ymd(p?.invoice_date)
    };
    bill.items.push(item);
    bill.total_items++;
    if (available > 0) bill.available_items++;
  }
  const bills = Array.from(billsMap.values());

  const totalReturn = Number(record.refund_amount ?? ((record.total_amount || 0) + (record.total_tax || 0)));
  const totalRefunded = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
  return {
    return: {
      id: record.id,
      return_no: purchaseReturnNo(record.id),
      debit_note_no: record.debit_note_no,
      return_date: ymd(record.return_date),
      total_amount: record.total_amount,
      total_tax: record.total_tax,
      refund_amount: totalReturn,
      packing_forwarding_amount: Number(record.packing_forwarding_amount || 0),
      status: record.status,
      payment_status: record.payment_status ?? 0,
      payment_mode: record.payment_mode ?? 1,
      payment_date: record.payment_date,
      notes: record.notes,
      fy: record.fy
    },
    vendor: {
      id: vendor.id,
      vendor_name: vendor.vendor_name || 'Unknown Vendor',
      state: vendor.state || '',
      state_code: vendor.state_code || 0,
      gstin: vendor.tax_id || '',
      address: vendor.address || '',
      contact: vendor.contact_no || ''
    },
    bills,
    summary: { total_bills: bills.length, total_items: mine.length, total_value: record.total_amount },
    refund_summary: {
      total_return: totalReturn,
      total_refunded: totalRefunded,
      remaining_amount: totalReturn - totalRefunded,
      refund_count: allocations.length,
      is_fully_refunded: totalRefunded >= totalReturn,
      is_partially_refunded: totalRefunded > 0 && totalRefunded < totalReturn
    },
    refund_history: allocations.map((a: any) => ({
      allocation_id: a.id,
      refund_id: a.refund_id,
      allocated_amount: Number(a.allocated_amount),
      allocation_date: a.allocation_date,
      allocation_notes: a.notes,
      refund_date: a.refund?.refund_date,
      refund_amount: Number(a.refund?.refund_amount || 0),
      refund_mode: a.refund?.refund_mode,
      refund_mode_text: a.refund?.refund_mode === 0 ? 'Cash' : 'Bank',
      refund_type: a.refund?.refund_type,
      refund_notes: a.refund?.notes,
      created_at: a.refund?.created_at
    }))
  };
}
