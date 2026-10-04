import { prisma } from './db';
import { convertDateToTimestamp, paymentDateTs } from './date-utils';
import { getCurrentFinancialYear } from './financial-year';
import { customerLedgerService } from './customer-ledger-service';
import { customerBalanceHandler } from './customer-balance-handler';
import { customerTransactionHandler } from './customer-transaction-handler';
import { round2, roundRupee } from './line-math';
import { SaleKind, SaleError, saleTables, intOrNull } from './sale';
import { assertStockCovers } from './purchase-delete';
import { resolveReturnReasons } from './return-reasons';

/**
 * Sale and Invoice C returns: pricing, validation, create, edit, delete.
 *
 * Fixes (Phase 6 carry list, docs/SALE_AUDIT.md section 8):
 *  - The refund price is the line's NET unit price (rate less its discount);
 *    it was the gross rate, so a discounted sale refunded more than was paid.
 *    The form may lower it (a negotiated refund), never raise it.
 *  - Tax is the server's: the line's own GST % and split. The return form was
 *    sent tax_rate 0 for every sale line, so sale returns carried no tax.
 *  - A line cannot be returned beyond what is left of it, must belong to the
 *    bill, and must be named with its kind: sale and salex line ids overlap,
 *    and the create path looked an id up in BOTH tables, returning it twice.
 *  - Return status is recomputed from the bill's own lines (by header id); it
 *    was looked up by the printed number.
 *  - One return per bill. The create path put every sale line from several
 *    bills on the first bill's return.
 */

export const parseReturnKind = (raw: unknown): SaleKind | null => {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'sale' || v === 'invoice') return 'sale';
  if (v === 'salex' || v === 'invoicex') return 'salex';
  return null;
};

const prefix = (kind: SaleKind) => (kind === 'sale' ? 'SR' : 'SXR');
export const returnNo = (kind: SaleKind, id: number) => `${prefix(kind)}-${String(id).padStart(3, '0')}`;
const returnsTable = (kind: SaleKind) => saleTables(kind).returns;

/**
 * A return by id. Sale and salex returns are numbered separately, so an id
 * alone can name two returns; without `kind` an ambiguous id is refused rather
 * than resolved to the sale one (which is what every caller used to get).
 */
export async function findSaleReturn(id: number, kindHint: SaleKind | null) {
  const db = prisma as any;
  if (kindHint) {
    const rec = await db[returnsTable(kindHint)].findUnique({ where: { id } });
    if (!rec) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
    return { kind: kindHint, record: rec };
  }
  const [s, x] = await Promise.all([db.sale_returns.findUnique({ where: { id } }), db.salex_returns.findUnique({ where: { id } })]);
  if (s && x) {
    throw new SaleError(409, 'Both a sale return and an Invoice C return have this number. Open it from the returns list.', 'AMBIGUOUS_RETURN');
  }
  if (s) return { kind: 'sale' as SaleKind, record: s };
  if (x) return { kind: 'salex' as SaleKind, record: x };
  throw new SaleError(404, 'Return not found', 'NOT_FOUND');
}

export interface PricedLine {
  invoice_item_id: number;
  product_id: number;
  return_qty: number;
  return_reason_id: number;
  unit_price: number;
  subtotal: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  notes: string;
}

export interface PricedReturn {
  kind: SaleKind;
  docId: number;
  lines: PricedLine[];
  totalAmount: number;
  totalTax: number;
  refundAmount: number;
}

/** A sale line's net unit price: rate less its discount, per unit, paise kept. */
export const netUnitPrice = (line: { qty?: number | null; rate?: number | null; discount?: number | null }) => {
  const qty = Number(line.qty) || 0;
  const rate = Number(line.rate) || 0;
  if (qty <= 0) return round2(rate);
  return round2((qty * rate - (Number(line.discount) || 0)) / qty);
};

/**
 * Price and validate the lines of one or more returns of one kind. Returns one
 * entry per bill. `docId` pins every line to that bill; `excludeReturnId` is
 * the return being edited (its own quantities are available to it again).
 */
export async function priceReturnLines(
  tx: any,
  kind: SaleKind,
  items: any[],
  opts: { docId?: number; excludeReturnId?: number } = {}
): Promise<PricedReturn[]> {
  const t = saleTables(kind);
  if (!Array.isArray(items) || items.length === 0) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION');

  const wanted = items.map((i: any) => ({
    id: intOrNull(i.invoice_item_id ?? i.sale_item_id ?? i.id),
    qty: Math.round(Number(i.return_qty)),
    reason: intOrNull(i.return_reason_id) || null,
    price: i.unit_price,
    notes: i.notes || i.return_notes || ''
  }));
  if (items.some((i: any) => { const k = parseReturnKind(i.invoice_type); return k !== null && k !== kind; })) {
    throw new SaleError(400, 'A sale line and an Invoice C line cannot be on the same return', 'KIND_MISMATCH');
  }
  if (wanted.some(w => w.id === null)) throw new SaleError(400, 'Every return line needs its bill line', 'VALIDATION');
  const ids = wanted.map(w => w.id as number);
  if (new Set(ids).size !== ids.length) throw new SaleError(400, 'The same line was sent twice', 'DUPLICATE_LINE');

  const lines = await tx[t.items].findMany({
    where: { id: { in: ids } },
    select: { id: true, invoice_no: true, product_id: true, qty: true, rate: true, discount: true, gst_percentage: true, igst: true, name_of_product: true }
  });
  const byId = new Map<number, any>(lines.map((l: any) => [l.id, l]));
  const returnedRows = await tx[t.returnItems].findMany({
    where: { [t.returnItemFk]: { in: ids } },
    select: { [t.returnItemFk]: true, [t.returnFk]: true, return_qty: true }
  });
  const returned = new Map<number, number>();
  for (const r of returnedRows) {
    if (opts.excludeReturnId !== undefined && r[t.returnFk] === opts.excludeReturnId) continue;
    returned.set(r[t.returnItemFk], (returned.get(r[t.returnItemFk]) || 0) + (Number(r.return_qty) || 0));
  }

  const groups = new Map<number, PricedLine[]>();
  const inOrder: PricedLine[] = [];
  for (const w of wanted) {
    const line = byId.get(w.id as number);
    if (!line) throw new SaleError(400, `A return line does not belong to any ${t.label} bill`, 'UNKNOWN_LINE');
    if (opts.docId !== undefined && line.invoice_no !== opts.docId) {
      throw new SaleError(400, 'A return line belongs to a different bill', 'FOREIGN_LINE');
    }
    const left = (Number(line.qty) || 0) - (returned.get(line.id) || 0);
    if (!Number.isFinite(w.qty) || w.qty < 1) throw new SaleError(400, `Return at least 1 of "${line.name_of_product}"`, 'VALIDATION');
    if (w.qty > left) {
      throw new SaleError(400, `Only ${left} of "${line.name_of_product}" can still be returned`, 'OVER_RETURN',
        { product_name: line.name_of_product, available_qty: left, requested_qty: w.qty });
    }
    const net = netUnitPrice(line);
    let unit = net;
    if (w.price !== undefined && w.price !== null && w.price !== '') {
      const asked = Number(w.price);
      if (!Number.isFinite(asked) || asked < 0) throw new SaleError(400, 'A refund price must be a number', 'VALIDATION');
      if (asked > net + 0.005) {
        throw new SaleError(400, `The refund price of "${line.name_of_product}" cannot be more than it sold for (₹${net})`, 'PRICE_ABOVE_SALE');
      }
      unit = round2(asked);
    }
    const subtotal = round2(w.qty * unit);
    const gst = t.taxFree ? 0 : Number(line.gst_percentage) || 0;
    const tax = round2((subtotal * gst) / 100);
    const inter = (Number(line.igst) || 0) > 0;
    const priced: PricedLine = {
      invoice_item_id: line.id,
      product_id: line.product_id,
      return_qty: w.qty,
      return_reason_id: w.reason ?? 0,
      unit_price: unit,
      subtotal,
      tax_amount: tax,
      cgst: inter ? 0 : round2(tax / 2),
      sgst: inter ? 0 : round2(tax / 2),
      igst: inter ? tax : 0,
      notes: w.notes
    };
    if (!groups.has(line.invoice_no)) groups.set(line.invoice_no, []);
    groups.get(line.invoice_no)!.push(priced);
    inOrder.push(priced);
  }
  // A sale reason (Invoice C uses the sale reasons too); none sent = the form's first (D-04).
  const reasons = await resolveReturnReasons(tx, kind === 'sale' ? ['sale'] : ['sale', 'salex'], inOrder.map(l => l.return_reason_id || null), 'sale');
  inOrder.forEach((l, i) => { l.return_reason_id = reasons[i]; });

  return Array.from(groups.entries()).map(([docId, ls]) => {
    const sum = (f: keyof PricedLine) => ls.reduce((s, l) => s + (l[f] as number), 0);
    // F-34, as on the bill: each tax head to the rupee, the refund to the rupee.
    const totalTax = roundRupee(sum('cgst')) + roundRupee(sum('sgst')) + roundRupee(sum('igst'));
    const totalAmount = round2(sum('subtotal'));
    return { kind, docId, lines: ls, totalAmount, totalTax, refundAmount: roundRupee(totalAmount + totalTax) };
  });
}

/** Recompute a bill's return_status (0 none, 1 partial, 2 full) from its own lines. */
export async function recalcReturnStatus(tx: any, kind: SaleKind, docId: number) {
  const t = saleTables(kind);
  const lines = await tx[t.items].findMany({ where: { invoice_no: docId }, select: { id: true, qty: true } });
  const rows = lines.length
    ? await tx[t.returnItems].findMany({ where: { [t.returnItemFk]: { in: lines.map((l: any) => l.id) } }, select: { [t.returnItemFk]: true, return_qty: true } })
    : [];
  const back = new Map<number, number>();
  rows.forEach((r: any) => back.set(r[t.returnItemFk], (back.get(r[t.returnItemFk]) || 0) + (Number(r.return_qty) || 0)));
  const any = rows.length > 0;
  const full = lines.length > 0 && lines.every((l: any) => (back.get(l.id) || 0) >= (Number(l.qty) || 0));
  await tx[t.header].update({ where: { id: docId }, data: { return_status: !any ? 0 : full ? 2 : 1 } });
}

const perProduct = (lines: { product_id: number; qty: number }[]) => {
  const per = new Map<number, number>();
  lines.forEach(l => { if (l.product_id) per.set(l.product_id, (per.get(l.product_id) || 0) + (Number(l.qty) || 0)); });
  return per;
};

/**
 * Units a return brought back that go out of stock again (the return lowered or
 * deleted) must still be there: refused like a sale or a purchase delete
 * (D-07). Read inside the transaction that then moves the stock.
 */
async function assertReturnStockCovers(tx: any, out: Map<number, number>, action: 'lower' | 'delete') {
  await assertStockCovers(tx, out, (name, have, need) => action === 'delete'
    ? `Cannot delete this return: only ${have} of "${name}" is in stock and the return brought back ${need}. Some of it has been sold.`
    : `Cannot lower this return: only ${have} of "${name}" is in stock and ${need} would go back out. Some of it has been sold.`);
}

async function moveStock(tx: any, lines: { product_id: number; qty: number }[], sign: 1 | -1) {
  const per = new Map<number, number>();
  lines.forEach(l => { if (l.product_id) per.set(l.product_id, (per.get(l.product_id) || 0) + l.qty); });
  for (const [pid, qty] of Array.from(per.entries())) {
    if (qty) await tx.product.update({ where: { id: pid }, data: { stock: { increment: sign * qty } } });
  }
}

/**
 * POST /api/sale-returns/customer-return: one return per bill, for a customer.
 * Lines are named by kind (`invoice_type` per item, or the request's
 * invoice_id / invoicex_id). return_type 'full' with a bill and no items
 * returns everything still left on it.
 */
export async function createCustomerReturns(body: any) {
  const customerId = intOrNull(body.customer_id);
  if (customerId === null) throw new SaleError(400, 'Customer ID is required', 'VALIDATION');
  const fy = await getCurrentFinancialYear();
  const returnDate = body.return_date ? convertDateToTimestamp(body.return_date) : Math.floor(Date.now() / 1000);
  const status = intOrNull(body.payment_status) ?? 0;
  if (status !== 0 && status !== 1) throw new SaleError(400, 'payment_status must be 0 (pending) or 1 (complete)', 'VALIDATION');
  const mode = intOrNull(body.payment_mode) ?? 1;
  const docKind = body.invoicex_id ? 'salex' : body.invoice_id ? 'sale' : null;
  const docId = intOrNull(body.invoicex_id ?? body.invoice_id);

  // Lines by kind
  const byKind: Record<SaleKind, any[]> = { sale: [], salex: [] };
  let items: any[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 && body.return_type === 'full' && docKind && docId !== null) {
    const t = saleTables(docKind);
    const all = await (prisma as any)[t.items].findMany({ where: { invoice_no: docId }, select: { id: true, qty: true } });
    const back = all.length ? await (prisma as any)[t.returnItems].findMany({ where: { [t.returnItemFk]: { in: all.map((l: any) => l.id) } }, select: { [t.returnItemFk]: true, return_qty: true } }) : [];
    const used = new Map<number, number>();
    back.forEach((r: any) => used.set(r[t.returnItemFk], (used.get(r[t.returnItemFk]) || 0) + r.return_qty));
    items = all.filter((l: any) => (l.qty || 0) - (used.get(l.id) || 0) > 0)
      .map((l: any) => ({ invoice_item_id: l.id, return_qty: (l.qty || 0) - (used.get(l.id) || 0), invoice_type: docKind, notes: 'Full order return' }));
  }
  for (const item of items) {
    const kind = parseReturnKind(item.invoice_type ?? item.type) ?? docKind;
    if (!kind) throw new SaleError(400, 'Each return line must say whether it is from a sale or an Invoice C bill (invoice_type)', 'KIND_REQUIRED');
    byKind[kind].push(item);
  }
  if (!byKind.sale.length && !byKind.salex.length) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION');

  return prisma.$transaction(async (tx: any) => {
    const created: any[] = [];
    for (const kind of ['sale', 'salex'] as SaleKind[]) {
      if (!byKind[kind].length) continue;
      const t = saleTables(kind);
      const priced = await priceReturnLines(tx, kind, byKind[kind], docKind === kind && docId !== null ? { docId } : {});
      for (const r of priced) {
        const bill = await tx[t.header].findUnique({ where: { id: r.docId }, select: { id: true, invoice_no: true, select_customer: true } });
        if (!bill || (bill.select_customer ?? 0) !== customerId) {
          throw new SaleError(400, 'A returned bill does not belong to this customer', 'FOREIGN_BILL');
        }
        const paidOn = status === 1 ? (paymentDateTs(body.payment_date) ?? returnDate) : null;
        const header: any = {
          [t.returnHeaderFk]: r.docId,
          return_date: returnDate,
          total_amount: r.totalAmount,
          refund_amount: r.refundAmount,
          payment_status: status,
          payment_mode: mode,
          payment_date: paidOn,
          notes: body.return_notes || '',
          fy
        };
        if (kind === 'sale') header.total_tax = r.totalTax;
        const ret = await tx[t.returns].create({ data: header });
        for (const l of r.lines) {
          const row: any = {
            [t.returnFk]: ret.id,
            [t.returnItemFk]: l.invoice_item_id,
            return_qty: l.return_qty,
            unit_price: l.unit_price,
            return_reason_id: l.return_reason_id,
            notes: l.notes
          };
          if (kind === 'sale') row.tax_amount = l.tax_amount;
          await tx[t.returnItems].create({ data: row });
        }
        await moveStock(tx, r.lines.map(l => ({ product_id: l.product_id, qty: l.return_qty })), 1);
        await recalcReturnStatus(tx, kind, r.docId);

        if (status === 1 && customerId !== 0) {
          const no = returnNo(kind, ret.id);
          await customerLedgerService.createEntry({
            customer_id: customerId, transaction_date: returnDate, transaction_type: 'CREDIT_NOTE',
            reference_type: kind === 'sale' ? 'sale_return' : 'salex_return', reference_id: ret.id, reference_no: no,
            debit: 0, credit: r.refundAmount, payment_mode: null, payment_status: 1, payment_date: null,
            notes: body.return_notes || `${t.label} return ${no}`, fy, transaction_id: null
          } as any, tx);
          // The money goes out on the payment date, as the cash book has it (D-08); the note stays on the return date.
          await customerLedgerService.createEntry({
            customer_id: customerId, transaction_date: paidOn, transaction_type: 'REFUND',
            reference_type: kind === 'sale' ? 'sale_return' : 'salex_return', reference_id: ret.id, reference_no: `REF-${no}`,
            debit: r.refundAmount, credit: 0, payment_mode: mode, payment_status: 1, payment_date: paidOn,
            notes: `Refund for ${t.label} return ${no}`, fy, transaction_id: ret.id
          } as any, tx);
          // Logged under the return's note number, so deleting it can reverse exactly this.
          await customerBalanceHandler.incrementBalanceInTransaction(tx, customerId,
            { total_refunded: r.refundAmount, total_refund_allocated: r.refundAmount },
            { type: 'return_create', id: ret.id, reference_no: no, notes: body.return_notes || 'Customer return with refund' });
        }
        created.push({ ...ret, kind, return_no: returnNo(kind, ret.id) });
      }
    }
    return created;
  }, { timeout: 45000 });
}

/** PUT /api/sale-returns/[id]: edit a return that is not yet complete. */
export async function updateSaleReturn(kind: SaleKind, returnId: number, body: any) {
  const t = saleTables(kind);
  const db = prisma as any;
  const existing = await db[t.returns].findUnique({ where: { id: returnId } });
  if (!existing) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
  if (existing.payment_status === 1) {
    throw new SaleError(400, 'Cannot edit a refunded return. The refund has already been processed.', 'REFUNDED_RETURN_EDIT_BLOCKED');
  }
  const docId: number = existing[t.returnHeaderFk];
  // What the return was, copied before the update (never read back from a row the update may share).
  const oldStatus: number = existing.payment_status ?? 0;
  const oldRefund = Number(existing.refund_amount ?? ((existing.total_amount || 0) + (existing.total_tax || 0)));
  const oldDate: number = existing.return_date;
  const oldPaymentDate = existing.payment_date;
  const newStatus = body.payment_status !== undefined && body.payment_status !== null && body.payment_status !== ''
    ? (intOrNull(body.payment_status) as number) : (existing.payment_status ?? 0);
  if (newStatus !== 0 && newStatus !== 1) throw new SaleError(400, 'payment_status must be 0 (pending) or 1 (complete)', 'VALIDATION');
  const mode = body.payment_mode !== undefined && body.payment_mode !== null ? (intOrNull(body.payment_mode) as number) : existing.payment_mode;
  const finalDate = body.return_date ? convertDateToTimestamp(body.return_date) : existing.return_date;

  return prisma.$transaction(async (tx: any) => {
    const [priced] = await priceReturnLines(tx, kind, body.items, { docId, excludeReturnId: returnId });
    const old = await tx[t.returnItems].findMany({ where: { [t.returnFk]: returnId }, select: { [t.returnItemFk]: true, return_qty: true } });
    const oldLines = old.length
      ? await tx[t.items].findMany({ where: { id: { in: old.map((o: any) => o[t.returnItemFk]) } }, select: { id: true, product_id: true } })
      : [];
    const productOf = new Map<number, number>(oldLines.map((l: any) => [l.id, l.product_id]));
    const oldOut = old.map((o: any) => ({ product_id: productOf.get(o[t.returnItemFk]) as number, qty: o.return_qty }));
    const before = perProduct(oldOut);
    const after = perProduct(priced.lines.map(l => ({ product_id: l.product_id, qty: l.return_qty })));
    const goingOut = new Map<number, number>();
    before.forEach((q, pid) => { const d = q - (after.get(pid) || 0); if (d > 0) goingOut.set(pid, d); });
    await assertReturnStockCovers(tx, goingOut, 'lower');
    await moveStock(tx, oldOut, -1);
    await tx[t.returnItems].deleteMany({ where: { [t.returnFk]: returnId } });
    for (const l of priced.lines) {
      const row: any = {
        [t.returnFk]: returnId, [t.returnItemFk]: l.invoice_item_id, return_qty: l.return_qty,
        unit_price: l.unit_price, return_reason_id: l.return_reason_id, notes: l.notes
      };
      if (kind === 'sale') row.tax_amount = l.tax_amount;
      await tx[t.returnItems].create({ data: row });
    }
    await moveStock(tx, priced.lines.map(l => ({ product_id: l.product_id, qty: l.return_qty })), 1);

    const data: any = {
      return_date: finalDate,
      total_amount: priced.totalAmount,
      refund_amount: priced.refundAmount,
      notes: body.notes ?? body.return_notes ?? existing.notes ?? '',
      payment_status: newStatus,
      payment_mode: mode,
      // Pending: not refunded, so no payment date (D-12, as purchase returns).
      payment_date: newStatus === 1 ? (paymentDateTs(body.payment_date) ?? oldPaymentDate ?? finalDate) : null
    };
    if (kind === 'sale') data.total_tax = priced.totalTax;
    const updated = await tx[t.returns].update({ where: { id: returnId }, data });
    await recalcReturnStatus(tx, kind, docId);

    const bill = await tx[t.header].findUnique({ where: { id: docId }, select: { select_customer: true } });
    const customerId = bill?.select_customer ?? 0;
    if (customerId) {
      if (finalDate !== oldDate) {
        await tx.customer_ledger.updateMany({
          where: { customer_id: customerId, reference_type: kind === 'sale' ? 'sale_return' : 'salex_return', reference_id: returnId, transaction_type: 'CREDIT_NOTE' },
          data: { transaction_date: finalDate }
        });
      }
      const allocFk = kind === 'sale' ? 'sale_return_id' : 'salex_return_id';
      const allocs = await tx.customer_refund_allocations.findMany({ where: { [allocFk]: returnId }, select: { allocated_amount: true } });
      const balance = await tx.customer_details.findUnique({
        where: { id: customerId },
        select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
      });
      const ops = await customerTransactionHandler.handleReturnEdit({
        type: kind,
        oldStatus,
        newStatus,
        oldTotal: oldRefund,
        newTotal: priced.refundAmount,
        customerId,
        returnId,
        creditNoteNo: returnNo(kind, returnId),
        paymentMode: mode ?? 1,
        paymentDate: paymentDateTs(body.payment_date) ?? finalDate,
        returnDate: finalDate,
        fy: existing.fy,
        totalAllocated: allocs.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0),
        totalAmount: priced.totalAmount,
        totalTax: priced.totalTax,
        tx,
        currentBalance: balance ? {
          total_paid: Number(balance.total_paid), total_allocated: Number(balance.total_allocated),
          total_refunded: Number(balance.total_refunded), total_refund_allocated: Number(balance.total_refund_allocated)
        } : undefined
      });
      await customerTransactionHandler.executeInTransaction(tx, ops);
    }
    return { ...updated, kind, return_no: returnNo(kind, returnId) };
  }, { timeout: 45000 });
}

/** DELETE /api/sale-returns/[id]. */
export async function deleteSaleReturn(kind: SaleKind, returnId: number) {
  const t = saleTables(kind);
  const db = prisma as any;
  const ret = await db[t.returns].findUnique({ where: { id: returnId } });
  if (!ret) throw new SaleError(404, 'Return not found', 'NOT_FOUND');
  const docId: number = ret[t.returnHeaderFk];
  const bill = await db[t.header].findUnique({ where: { id: docId }, select: { select_customer: true } });
  const customerId = bill?.select_customer ?? 0;

  await prisma.$transaction(async (tx: any) => {
    const rows = await tx[t.returnItems].findMany({ where: { [t.returnFk]: returnId }, select: { [t.returnItemFk]: true, return_qty: true } });
    const lines = rows.length
      ? await tx[t.items].findMany({ where: { id: { in: rows.map((r: any) => r[t.returnItemFk]) } }, select: { id: true, product_id: true } })
      : [];
    const productOf = new Map<number, number>(lines.map((l: any) => [l.id, l.product_id]));
    const out = rows.map((r: any) => ({ product_id: productOf.get(r[t.returnItemFk]) as number, qty: r.return_qty }));
    await assertReturnStockCovers(tx, perProduct(out), 'delete');
    if (customerId) {
      const ops = await customerTransactionHandler.handleReturnDelete({
        type: kind, returnId, customerId, paymentStatus: ret.payment_status ?? 0, fy: ret.fy,
        totalAmount: ret.total_amount, totalTax: ret.total_tax ?? 0, creditNoteNo: returnNo(kind, returnId),
        refundAmount: Number(ret.refund_amount) || 0
      });
      await customerTransactionHandler.executeDeleteInTransaction(tx, ops);
    } else {
      await moveStock(tx, out, -1);
      await tx[t.returnItems].deleteMany({ where: { [t.returnFk]: returnId } });
      await tx[t.returns].delete({ where: { id: returnId } });
    }
    // The bill's return status was never recomputed after a return was deleted.
    if (docId) await recalcReturnStatus(tx, kind, docId);
  }, { timeout: 45000 });
}

const ymd = (ts?: number | null) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * GET /api/sale-returns/[id]: the return with every line of its bill. Each
 * line's available_qty is what is left of it apart from THIS return, so the
 * edit form offers exactly what the server will accept; unit_price defaults
 * to the line's net price, and ids carry the kind.
 */
export async function loadSaleReturnDetail(id: number, kindHint: SaleKind | null) {
  const { kind, record } = await findSaleReturn(id, kindHint);
  const t = saleTables(kind);
  const db = prisma as any;
  const type = kind === 'sale' ? 'invoice' : 'invoicex';
  const docId: number = record[t.returnHeaderFk];
  const invoice = docId
    ? await db[t.header].findUnique({ where: { id: docId }, select: { id: true, invoice_no: true, select_customer: true, invoice_date: true, total: true, bill_reference: true } })
    : null;
  if (!invoice) throw new SaleError(404, 'Associated invoice not found', 'NOT_FOUND');

  const customer = invoice.select_customer
    ? await db.customer_details.findUnique({
        where: { id: invoice.select_customer },
        select: { id: true, billing_name: true, billing_state: true, billing_state_code: true, billing_gstin: true, billing_address: true }
      })
    : null;
  if (invoice.select_customer && !customer) throw new SaleError(404, 'Customer not found for this return', 'NOT_FOUND');

  const lines = await db[t.items].findMany({
    where: { invoice_no: invoice.id },
    select: { id: true, product_id: true, name_of_product: true, part: true, qty: true, rate: true, discount: true, gst_percentage: true, igst: true }
  });
  const mine = await db[t.returnItems].findMany({
    where: { [t.returnFk]: id },
    select: {
      [t.returnItemFk]: true, return_qty: true, unit_price: true, return_reason_id: true, notes: true,
      ...(kind === 'sale' ? { tax_amount: true } : {}),
      reason: { select: { id: true, reason_name: true } }
    }
  });
  const others = lines.length
    ? await db[t.returnItems].findMany({
        where: { [t.returnItemFk]: { in: lines.map((l: any) => l.id) }, NOT: { [t.returnFk]: id } },
        select: { [t.returnItemFk]: true, return_qty: true }
      })
    : [];
  const elsewhere = new Map<number, number>();
  others.forEach((r: any) => elsewhere.set(r[t.returnItemFk], (elsewhere.get(r[t.returnItemFk]) || 0) + (Number(r.return_qty) || 0)));
  const mineByLine = new Map<number, any>(mine.map((r: any) => [r[t.returnItemFk], r]));
  const productIds = Array.from(new Set(lines.map((l: any) => l.product_id).filter(Boolean)));
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, display_name: true } })
    : [];
  const nameOf = new Map<number, string>(products.map((p: any) => [p.id, p.display_name]));
  const billNo = invoice.invoice_no?.toString() || 'N/A';
  // The bill's own reference (D-09: this repeated the bill number).
  const billRef = invoice.bill_reference || '';
  const invoiceDate = ymd(invoice.invoice_date);

  const items = lines.map((line: any) => {
    const r = mineByLine.get(line.id);
    const returnQty = Number(r?.return_qty) || 0;
    const unitPrice = r ? Number(r.unit_price) || 0 : netUnitPrice(line);
    const taxAmount = kind === 'sale' ? Number(r?.tax_amount) || 0 : 0;
    const inter = (Number(line.igst) || 0) > 0;
    const name = nameOf.get(line.product_id) || line.name_of_product || 'Unknown Product';
    return {
      id: `${type}-${line.id}`,
      invoice_item_id: line.id,
      invoice_type: type,
      product_id: line.product_id || 0,
      product_name: name,
      display_name: name,
      part_number: line.part,
      original_qty: line.qty || 0,
      available_qty: Math.max(0, (Number(line.qty) || 0) - (elsewhere.get(line.id) || 0)),
      return_qty: returnQty,
      unit_price: unitPrice,
      net_unit_price: netUnitPrice(line),
      tax_rate: t.taxFree ? 0 : Number(line.gst_percentage) || 0,
      tax_amount: taxAmount,
      cgst: inter ? 0 : round2(taxAmount / 2),
      sgst: inter ? 0 : round2(taxAmount / 2),
      igst: inter ? taxAmount : 0,
      return_reason_id: r?.return_reason_id || 1,
      return_reason: r?.reason?.reason_name || 'Unknown Reason',
      notes: r?.notes || '',
      bill_reference: billRef,
      invoice_date: invoiceDate
    };
  });

  const totalTax = kind === 'sale' ? Number(record.total_tax) || 0 : 0;
  return {
    return: {
      id: record.id,
      return_no: returnNo(kind, record.id),
      return_date: ymd(record.return_date),
      total_amount: record.total_amount,
      total_tax: totalTax,
      refund_amount: record.refund_amount ?? roundRupee((record.total_amount || 0) + totalTax),
      status: record.status,
      payment_status: record.payment_status ?? 0,
      payment_mode: record.payment_mode ?? 1,
      payment_date: record.payment_date,
      notes: record.notes,
      fy: record.fy,
      invoice_type: type
    },
    customer: customer
      ? {
          id: customer.id, customer_name: customer.billing_name, billing_name: customer.billing_name,
          state: customer.billing_state || '', state_code: customer.billing_state_code || 0,
          gstin: customer.billing_gstin || '', address: customer.billing_address || ''
        }
      : { id: 0, customer_name: 'Other', billing_name: 'Other', state: '', state_code: 0, gstin: '', address: '' },
    bills: [{
      id: `${type}-${invoice.id}`,
      invoice_id: invoice.id,
      invoice_no: billNo,
      bill_reference: billRef,
      invoice_date: invoiceDate,
      // The bill's total, as the create screen shows it (D-09: this was the return's).
      total_amount: Number(invoice.total) || 0,
      has_tax: totalTax > 0,
      available_items: items.filter((i: any) => i.available_qty > 0).length,
      total_items: items.length,
      items,
      invoice_type: type
    }],
    summary: { total_bills: 1, total_items: items.length, total_value: record.total_amount }
  };
}
