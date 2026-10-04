import { prisma } from './db';
import { convertDateToTimestamp } from './date-utils';
import { customerTransactionHandler } from './customer-transaction-handler';
import { getBusinessGstin, PAYMENT_STATUS } from './purchase';
import {
  SaleKind, SaleError, saleTables, validateSale, computeSaleTotals, assertStock,
  intOrNull, requestedCustomer, requestedFreight, requestedItems, billStateCode, requestedDate
} from './sale';
import { shippingFrom, transportFrom } from './sale-create';
import { paidWithBill, trimAllocations } from './advance-allocation';
import { recalculateSaleStatus } from './payment-allocation-service';

/**
 * Editing a sale or salex (PUT /api/sales/[id], PUT /api/salex/[id]).
 * The lib/purchase-edit.ts rules, for the customer side:
 *
 *  - The customer cannot change (SA-11, owner: block). The sale PUT posted
 *    money to the new customer while the bill kept the old one; salex the
 *    other way round. Purchase refuses a vendor change the same way.
 *  - A field the request does not send keeps its stored value; the money
 *    figures are always recomputed from the lines (SA-10, SA-23).
 *  - Lines are reconciled by ROW (`line_id`, else the first unmatched stored
 *    row of the product). Every column of a kept line is saved - qty, rate,
 *    discount, GST and the server's tax split, company, model, part, date
 *    (SA-13, L-24).
 *  - A kept line cannot drop below what was returned from it, and a line
 *    with returns cannot be removed (SA-13).
 *  - Stock is checked per product for what the edit adds (SA-14).
 *  - Partial is derived from allocations; a resent 2 means "leave payment
 *    alone" (SA-15).
 *  - The handler gets the document type and what this bill itself paid in
 *    (SA-01, SA-12).
 */
export async function updateSale(kind: SaleKind, docId: number, rawBody: any) {
  const body: any = { ...(rawBody || {}) };
  const has = (f: string) => body[f] !== undefined;
  const t = saleTables(kind);

  const existing = await (prisma as any)[t.header].findUnique({ where: { id: docId } });
  if (!existing) throw new SaleError(404, `${t.label} not found`, 'NOT_FOUND');
  const customerId: number = existing.select_customer ?? 0;
  // Captured now: the handler compares against the bill as it was.
  const oldTotal = Number(existing.total);
  const oldStatus: number = existing.payment_status ?? PAYMENT_STATUS.UNPAID;

  const asked = requestedCustomer(body);
  if (asked !== null && asked !== customerId) {
    throw new SaleError(400,
      'The customer cannot be changed after the bill is created. Delete and recreate the bill if needed.',
      'CUSTOMER_CHANGE_NOT_ALLOWED');
  }
  delete body.select_customer;
  delete body.customer_id;

  if (body.payment_status !== undefined && body.payment_status !== null && intOrNull(body.payment_status) === PAYMENT_STATUS.PARTIAL) {
    delete body.payment_status;
  }

  const failure = await validateSale(kind, body, { partial: true });
  if (failure) throw failure;

  if (existing.return_status === 2) {
    throw new SaleError(400, 'Cannot edit a fully returned bill. All items have been returned.', 'FULLY_RETURNED');
  }

  const [storedLines, billTo, customer, allocations] = await Promise.all([
    (prisma as any)[t.items].findMany({ where: { invoice_no: docId }, orderBy: { id: 'asc' } }),
    (prisma as any)[t.billTo].findFirst({ where: { invoice_no: docId } }),
    customerId ? prisma.customer_details.findUnique({ where: { id: customerId } }) : Promise.resolve(null),
    prisma.customer_payment_allocations.findMany({ where: { [t.allocFk]: docId } as any, select: { allocated_amount: true } })
  ]);

  // ---- Lines: the request's, or the stored ones as they are
  const requested = requestedItems(body);
  const incoming: any[] = requested ?? storedLines.map((r: any) => ({
    line_id: r.id, product_id: r.product_id, qty: r.qty, rate: r.rate, gst_percentage: r.gst_percentage, discount: r.discount
  }));

  const unmatched = new Map<number, any>(storedLines.map((r: any) => [r.id, r]));
  const plan = incoming.map(item => {
    const productId = intOrNull(item.product_id) as number;
    const lineId = intOrNull(item.line_id);
    let row: any = null;
    if (lineId !== null) {
      if (!storedLines.some((r: any) => r.id === lineId)) {
        throw new SaleError(400, 'A line in this request does not belong to this bill.', 'FOREIGN_LINE');
      }
      row = unmatched.get(lineId) ?? null;
      if (!row) throw new SaleError(400, 'The same line was sent twice.', 'DUPLICATE_LINE_ID');
    } else {
      row = Array.from(unmatched.values()).find((r: any) => r.product_id === productId) ?? null;
    }
    if (row && row.product_id !== productId) row = null;
    if (row) unmatched.delete(row.id);
    return { item, productId, row };
  });
  const removed = Array.from(unmatched.values());

  // ---- Returns guard
  const returned = new Map<number, number>();
  if (storedLines.length) {
    const rows = await (prisma as any)[t.returnItems].findMany({
      where: { [t.returnItemFk]: { in: storedLines.map((r: any) => r.id) } },
      select: { [t.returnItemFk]: true, return_qty: true }
    });
    rows.forEach((r: any) => returned.set(r[t.returnItemFk], (returned.get(r[t.returnItemFk]) || 0) + (r.return_qty || 0)));
  }

  // ---- Money, from the lines and the bill's state
  const stateCode = billStateCode(body, billTo?.billing_state_code ?? customer?.billing_state_code ?? null);
  const pick = (f: string) => (has(f) ? body[f] : existing[f]);
  const freightRaw = requestedFreight(body);
  const { bill, supplyType, packing } = computeSaleTotals({
    kind,
    items: plan.map(p => p.item),
    packingQty: pick('packing_forwarding_qty') ?? 0,
    packingRate: pick('packing_forwarding_rate') ?? 0,
    packingTotal: pick('packing_forwarding_total') ?? 0,
    freight: freightRaw !== undefined ? freightRaw : existing.freight,
    stateCode,
    businessGstin: await getBusinessGstin()
  });
  if (supplyType === null) {
    throw new SaleError(400,
      'Cannot determine the tax type for this bill. Check the state on the bill and the business GSTIN in Settings.',
      'SUPPLY_TYPE_UNRESOLVED');
  }

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (!p.row) continue;
    const back = returned.get(p.row.id) || 0;
    if (back > 0 && bill.lines[i].qty < back) {
      throw new SaleError(400,
        `Cannot reduce quantity for "${p.row.name_of_product}" to ${bill.lines[i].qty}. ${back} units have already been returned.`,
        'QTY_BELOW_RETURNED', { product_name: p.row.name_of_product, returned_qty: back, requested_qty: bill.lines[i].qty });
    }
  }
  for (const row of removed) {
    const back = returned.get(row.id) || 0;
    if (back > 0) {
      throw new SaleError(400, `Cannot delete "${row.name_of_product}". ${back} units have been returned.`,
        'CANNOT_DELETE_RETURNED_ITEM', { product_name: row.name_of_product, returned_qty: back });
    }
  }

  // ---- Payment intent
  const requestedStatus = body.payment_status !== undefined && body.payment_status !== null && body.payment_status !== ''
    ? (intOrNull(body.payment_status) as number)
    : (existing.payment_status ?? PAYMENT_STATUS.UNPAID);
  const paymentMode = body.payment_mode !== undefined && body.payment_mode !== null && body.payment_mode !== ''
    ? (intOrNull(body.payment_mode) as number)
    : (existing.payment_mode ?? 0);
  const totalAllocated = allocations.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const isTypeA = allocations.length > 0;
  const newTotal = bill.grandTotal;
  const finalStatus = requestedStatus === PAYMENT_STATUS.PAID && isTypeA && totalAllocated > 0
    ? (totalAllocated >= newTotal ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL)
    : requestedStatus;

  const askedDate = has('date') || has('invoice_date') ? requestedDate(body, convertDateToTimestamp) : null;
  const finalDate = askedDate ?? existing.invoice_date;

  // ---- Header: what was sent, plus everything derived
  const headerData: any = {
    invoice_date: finalDate,
    payment_status: finalStatus,
    payment_mode: paymentMode,
    packing_forwarding_qty: packing.qty,
    packing_forwarding_rate: packing.rate,
    packing_forwarding_total: packing.total,
    items_total: bill.itemsTotal,
    discount: bill.discountTotal,
    freight: bill.freight,
    total_taxable_value: bill.itemsTotal,
    total_cgst: bill.totalCgst,
    total_sgst: bill.totalSgst,
    total_igst: bill.totalIgst,
    total_tax: bill.totalTax,
    total: newTotal,
    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
  for (const f of ['bill_reference', 'notes', 'descriptions', 'staff_details']) {
    if (has(f)) headerData[f] = body[f] ?? '';
  }
  if (has('commission')) headerData.commission = Number(body.commission) || 0;
  for (const [f, rel] of [['staff_id', 'staff'], ['mechanic_id', 'mechanic']]) {
    if (has(f)) {
      const id = intOrNull(body[f]);
      headerData[rel] = id ? { connect: { id } } : { disconnect: true };
    }
  }

  // ---- Snapshot: sent fields only
  const txt = (f: string) => (has(f) ? String(body[f] ?? '') : undefined);
  const billing: any = {
    billing_name: txt('customer_name'),
    contact_no: txt('contact_number'),
    email: txt('email_id'),
    billing_address: txt('address'),
    billing_address2: txt('address_2'),
    billing_city: txt('city'),
    billing_state: txt('state'),
    billing_state_code: has('state_code') ? intOrNull(body.state_code) : undefined,
    billing_gstin: txt('gst_number')
  };

  return prisma.$transaction(async (tx: any) => {
    // ---- Products for new lines, stock for what the edit adds
    const productIds = Array.from(new Set(plan.map(p => p.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, product_name: true, hsn: true, product_category_id: true, product_subcategory_id: true, company_id: true }
    });
    const productById = new Map<number, any>(products.map((p: any) => [p.id, p]));
    for (const id of productIds) {
      if (!productById.has(id)) throw new SaleError(400, 'A selected product does not exist', 'UNKNOWN_PRODUCT');
    }

    // Stock delta per product: positive = more leaves the shelf.
    const delta = new Map<number, number>();
    const bump = (pid: number | null, d: number) => {
      if (pid === null || !Number.isFinite(d) || d === 0) return;
      delta.set(pid, (delta.get(pid) || 0) + d);
    };
    removed.forEach((r: any) => bump(r.product_id, -(r.qty || 0)));
    plan.forEach((p, i) => bump(p.productId, bill.lines[i].qty - (p.row ? (p.row.qty || 0) : 0)));
    const need = new Map<number, number>();
    for (const [pid, d] of Array.from(delta.entries())) if (d > 0) need.set(pid, d);
    await assertStock(tx, need);

    const updated = await tx[t.header].update({ where: { id: docId }, data: headerData });

    if (removed.length) await tx[t.items].deleteMany({ where: { id: { in: removed.map((r: any) => r.id) } } });
    const newRows: any[] = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const l = bill.lines[i];
      const val = (f: string, stored: any) => (p.item[f] !== undefined ? p.item[f] : stored);
      const money = {
        qty: l.qty, rate: l.rate, subtotal: l.taxable, discount: l.discount, discountrate: l.discountrate,
        gst_percentage: l.gst_percentage, cgst: l.cgst, sgst: l.sgst, igst: l.igst, tax: l.tax, invoice_date: finalDate
      };
      if (p.row) {
        await tx[t.items].update({
          where: { id: p.row.id },
          data: {
            ...money,
            company_id: intOrNull(val('company_id', p.row.company_id)),
            model_id: intOrNull(val('model_id', p.row.model_id)),
            part: val('part', p.row.part) || ''
          }
        });
      } else {
        const product = productById.get(p.productId);
        newRows.push({
          ...money,
          invoice_no: docId,
          fy: existing.fy,
          product_id: p.productId,
          name_of_product: product.product_name,
          category_id: product.product_category_id ?? null,
          subcategory_id: product.product_subcategory_id ?? null,
          company_id: intOrNull(p.item.company_id) ?? product.company_id ?? null,
          model_id: intOrNull(p.item.model_id),
          hsn: product.hsn || '',
          part: p.item.part || p.item.part_number || ''
        });
      }
    }
    if (newRows.length) await tx[t.items].createMany({ data: newRows });
    for (const [pid, d] of Array.from(delta.entries())) {
      const step = Math.round(d);
      if (step !== 0) await tx.product.update({ where: { id: pid }, data: { stock: { decrement: step } } });
    }

    // ---- Snapshots
    const name = billing.billing_name ?? billTo?.billing_name ?? customer?.billing_name ?? 'Other';
    const createBilling = {
      billing_name: name,
      contact_no: billing.contact_no ?? customer?.contact_no ?? '',
      email: billing.email ?? customer?.email ?? '',
      billing_address: billing.billing_address ?? customer?.billing_address ?? '',
      billing_address2: billing.billing_address2 ?? customer?.billing_address_2 ?? '',
      billing_city: billing.billing_city ?? customer?.billing_city ?? '',
      billing_state: billing.billing_state ?? customer?.billing_state ?? '',
      billing_state_code: billing.billing_state_code !== undefined ? billing.billing_state_code : stateCode,
      billing_gstin: billing.billing_gstin ?? customer?.billing_gstin ?? ''
    };
    await tx[t.billTo].upsert({
      where: { invoice_no: docId },
      update: billing,
      create: { invoice_no: docId, ...createBilling }
    });
    if (has('useShippingAddress') || has('shippingDetails') || Object.values(billing).some(v => v !== undefined)) {
      const ship = shippingFrom(body, { ...createBilling, ...(billTo || {}), ...stripUndefined(billing) });
      await tx[t.shipTo].upsert({ where: { invoice_no: docId }, update: ship, create: { invoice_no: docId, ...ship } });
    }
    const transport = transportFrom(body);
    if (transport) {
      await tx[t.transport].upsert({ where: { invoice_id: docId }, update: transport, create: { invoice_id: docId, ...transport } });
    }

    // ---- Ledger, allocations and balance: registered customers only
    if (customerId !== 0) {
      await tx.customer_ledger.updateMany({
        where: { reference_type: kind, reference_id: docId, transaction_type: 'SALE' },
        data: { transaction_date: finalDate }
      });
      const balance = await tx.customer_details.findUnique({
        where: { id: customerId },
        select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
      });
      const hasPaymentLedger = await tx.customer_ledger.findFirst({
        where: { customer_id: customerId, reference_type: kind, reference_id: docId, transaction_type: 'PAYMENT_RECEIVED' }
      });
      const paidByThisDocument = isTypeA ? await paidWithBill(tx, 'customer', { [t.allocFk]: docId }) : undefined;

      const ops = await customerTransactionHandler.handleSaleEdit({
        type: kind,
        oldStatus,
        newStatus: finalStatus,
        oldTotal,
        newTotal,
        customerId,
        invoiceId: docId,
        invoiceNo: String(existing.invoice_no),
        paymentMode,
        paymentDate: finalDate,
        fy: existing.fy,
        totalAllocated,
        paidByThisDocument,
        isTypeA,
        hasPaymentLedger: hasPaymentLedger !== null,
        currentBalance: balance ? {
          total_paid: Number(balance.total_paid),
          total_allocated: Number(balance.total_allocated),
          total_refunded: Number(balance.total_refunded),
          total_refund_allocated: Number(balance.total_refund_allocated)
        } : undefined
      });
      await customerTransactionHandler.executeInTransaction(tx, ops);
      // Lowered below what is allocated: the allocation shrinks, the rest is advance (owner).
      if (isTypeA && newTotal < totalAllocated - 0.005) {
        await trimAllocations(tx, 'customer', { [t.allocFk]: docId }, newTotal);
        await recalculateSaleStatus(kind, docId, tx);
      }
    }
    return updated;
  }, { timeout: 45000 });
}

function stripUndefined(o: any) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
