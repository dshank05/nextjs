import { prisma } from './db';
import { SaleKind, saleTables } from './sale';

/**
 * One sale or salex, shaped for the view and edit pages - the same shape for
 * both kinds (they had drifted: SA-21, SA-27).
 *
 *  - Customer details come from the bill's own snapshot, the master only when
 *    a bill has none. Sale read the master, so editing a customer rewrote every
 *    old invoice, and returned address_2/city/state as '' (SA-21).
 *  - `id` is returned: the sale view sent the printed number to "Mark as Paid"
 *    because it had nothing else (SA-05).
 *  - Allocations are summed for real; salex reported 0 (SA-27).
 *  - Lines carry their row id, sent back as `line_id` on save.
 *  - Unset payment status / mode stay unset; they used to read as Paid / Bank.
 */
export async function loadSaleDetail(kind: SaleKind, docId: number) {
  const t = saleTables(kind);
  const db = prisma as any;
  const doc = await db[t.header].findUnique({ where: { id: docId } });
  if (!doc) return null;

  const [lines, billTo, shipTo, transport, master, staff, mechanic, allocations] = await Promise.all([
    db[t.items].findMany({ where: { invoice_no: docId }, orderBy: { id: 'asc' } }),
    db[t.billTo].findFirst({ where: { invoice_no: docId } }),
    db[t.shipTo].findFirst({ where: { invoice_no: docId } }),
    db[t.transport].findFirst({ where: { invoice_id: docId } }),
    doc.select_customer ? prisma.customer_details.findUnique({ where: { id: doc.select_customer } }) : Promise.resolve(null),
    doc.staff_id ? prisma.staff.findUnique({ where: { id: doc.staff_id }, select: { id: true, name: true, phone: true, email: true } }) : Promise.resolve(null),
    doc.mechanic_id ? prisma.mechanic.findUnique({ where: { id: doc.mechanic_id }, select: { id: true, name: true, phone: true } }) : Promise.resolve(null),
    prisma.customer_payment_allocations.findMany({
      where: { [t.allocFk]: docId } as any,
      include: { payment: { select: { id: true, payment_date: true, payment_amount: true, payment_mode: true, payment_type: true, notes: true, created_at: true } } },
      orderBy: { allocation_date: 'desc' }
    })
  ]);

  const lineIds = lines.map((l: any) => l.id);
  const productIds = Array.from(new Set(lines.map((l: any) => l.product_id)));
  const [products, returnLines] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({ where: { id: { in: productIds as number[] } }, select: { id: true, display_name: true, stock: true } })
      : Promise.resolve([] as any[]),
    lineIds.length
      ? db[t.returnItems].findMany({
          where: { [t.returnItemFk]: { in: lineIds } },
          include: { [t.returnRelation]: true }
        })
      : Promise.resolve([] as any[])
  ]);
  const productById = new Map<number, any>(products.map((p: any) => [p.id, p]));

  // ---- Returns, per line and per return document
  const returnedByLine = new Map<number, { qty: number; history: any[] }>();
  const returnDocs = new Map<number, any>();
  const returnPrefix = kind === 'sale' ? 'SR' : 'SXR';
  for (const r of returnLines) {
    const ret = r[t.returnRelation];
    const lineId = r[t.returnItemFk];
    const entry = returnedByLine.get(lineId) || { qty: 0, history: [] };
    entry.qty += r.return_qty || 0;
    entry.history.push({
      return_id: String(ret.id),
      return_no: `${returnPrefix}-${String(ret.id).padStart(3, '0')}`,
      qty: r.return_qty,
      date: ret.return_date,
      unit_price: r.unit_price,
      tax_amount: r.tax_amount ?? 0,
      reason_id: r.return_reason_id,
      notes: r.notes || ''
    });
    returnedByLine.set(lineId, entry);
    if (!returnDocs.has(ret.id)) returnDocs.set(ret.id, { ...ret, items: [] });
    const line = lines.find((l: any) => l.id === lineId);
    const taxAmount = r.tax_amount ?? 0;
    returnDocs.get(ret.id).items.push({
      id: r.id,
      [t.returnItemFk]: lineId,
      product_name: (line && (productById.get(line.product_id)?.display_name || line.name_of_product)) || 'Unknown',
      return_qty: r.return_qty,
      unit_price: r.unit_price,
      tax_amount: taxAmount,
      subtotal: r.return_qty * r.unit_price,
      total: r.return_qty * r.unit_price + taxAmount,
      return_reason_id: r.return_reason_id,
      notes: r.notes
    });
  }

  let fullyReturned = 0;
  const items = lines.map((l: any) => {
    const back = returnedByLine.get(l.id) || { qty: 0, history: [] };
    const qty = l.qty || 0;
    const isFull = qty > 0 && back.qty >= qty;
    if (isFull) fullyReturned++;
    const name = productById.get(l.product_id)?.display_name || l.name_of_product;
    return {
      id: l.id,
      line_id: l.id,
      product_id: l.product_id,
      name_of_product: name,
      product_name: name,
      display_name: name,
      qty,
      rate: l.rate || 0,
      subtotal: l.subtotal || 0,
      discount: l.discount || 0,
      discountrate: l.discountrate || 0,
      gst_percentage: l.gst_percentage || 0,
      cgst: l.cgst || 0,
      sgst: l.sgst || 0,
      igst: l.igst || 0,
      tax: l.tax || 0,
      total: (l.subtotal || 0) + (l.tax || 0),
      hsn: l.hsn || '',
      part: l.part || '',
      category_id: l.category_id,
      subcategory_id: l.subcategory_id,
      model_id: l.model_id,
      company_id: l.company_id,
      invoice_date: l.invoice_date,
      fy: l.fy,
      stock: productById.get(l.product_id)?.stock ?? null,
      original_qty: qty,
      returned_qty: back.qty,
      available_qty: Math.max(0, qty - back.qty),
      is_fully_returned: isFull,
      return_history: back.history
    };
  });

  const hasReturns = returnLines.length > 0;
  const isFullyReturned = lines.length > 0 && fullyReturned === lines.length;

  // ---- Customer: the bill's snapshot first
  const customer = {
    id: doc.select_customer ?? 0,
    billing_name: billTo?.billing_name ?? master?.billing_name ?? '',
    billing_address: billTo?.billing_address ?? master?.billing_address ?? '',
    billing_address_2: billTo?.billing_address2 ?? master?.billing_address_2 ?? '',
    billing_city: billTo?.billing_city ?? master?.billing_city ?? '',
    billing_state: billTo?.billing_state ?? master?.billing_state ?? '',
    billing_state_code: billTo ? billTo.billing_state_code : (master?.billing_state_code ?? null),
    billing_gstin: billTo?.billing_gstin ?? master?.billing_gstin ?? '',
    contact_no: billTo?.contact_no ?? master?.contact_no ?? '',
    email: billTo?.email ?? master?.email ?? ''
  };

  const allocated = allocations.reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
  const total = Number(doc.total) || 0;
  // A walk-in (customer 0) has no payment rows by rule; marked Paid, it is paid in full (B-05).
  const totalPaid = (doc.select_customer ?? 0) === 0 && doc.payment_status === 1 ? total : allocated;

  return {
    id: doc.id,
    kind,
    invoice_no: doc.invoice_no,
    invoice_date: doc.invoice_date,
    date: doc.invoice_date,
    formattedDate: new Date(doc.invoice_date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    fy: doc.fy,
    select_customer: doc.select_customer ?? 0,
    customer_id: doc.select_customer ?? 0,

    customer_name: customer.billing_name,
    contact_number: customer.contact_no,
    email_id: customer.email,
    address: customer.billing_address,
    address_2: customer.billing_address_2,
    city: customer.billing_city,
    state: customer.billing_state,
    state_code: customer.billing_state_code,
    gst_number: customer.billing_gstin,
    customer_gstin: customer.billing_gstin,
    customer,

    items_total: doc.items_total ?? 0,
    discount: doc.discount ?? 0,
    freight: doc.freight ?? 0,
    total_taxable_value: doc.total_taxable_value ?? 0,
    total_cgst: doc.total_cgst ?? 0,
    total_sgst: doc.total_sgst ?? 0,
    total_igst: doc.total_igst ?? 0,
    total_tax: doc.total_tax ?? 0,
    total,
    packing_forwarding_qty: doc.packing_forwarding_qty ?? 0,
    packing_forwarding_rate: doc.packing_forwarding_rate ?? 0,
    packing_forwarding_total: doc.packing_forwarding_total ?? 0,
    commission: doc.commission ?? 0,

    bill_reference: doc.bill_reference || '',
    notes: doc.notes || '',
    descriptions: doc.descriptions || '',
    payment_status: doc.payment_status,
    payment_mode: doc.payment_mode,
    updated_at: doc.updated_at,

    staff_id: doc.staff_id,
    staff_details: staff?.name || doc.staff_details || '',
    staff,
    mechanic_id: doc.mechanic_id,
    mechanic,

    shippingDetails: shipTo ? {
      user_name: shipTo.shipping_name || '',
      address: shipTo.shipping_address || '',
      address_2: shipTo.shipping_address2 || '',
      city: shipTo.shipping_city || '',
      state: shipTo.shipping_state || '',
      state_code: shipTo.shipping_state_code,
      gstin: shipTo.shipping_gstin || ''
    } : null,
    transportDetails: {
      trans_mode: transport?.trans_mode || '',
      vehicle_no: transport?.vehicle_no || '',
      supply_date: transport?.supply_date || ''
    },
    transport_name: transport?.trans_mode || '',
    vehicle_number: transport?.vehicle_no || '',

    items,
    invoiceItems: items,
    item_count: items.length,

    return_status: {
      has_returns: hasReturns,
      fully_returned_items: fullyReturned,
      total_items: lines.length,
      is_fully_returned: isFullyReturned,
      status: isFullyReturned ? 'FULLY_RETURNED' : hasReturns ? 'PARTIAL_RETURN' : 'NO_RETURNS'
    },
    returns: Array.from(returnDocs.values()).map((r: any) => ({
      id: r.id,
      return_no: `${returnPrefix}-${String(r.id).padStart(3, '0')}`,
      return_date: r.return_date,
      total_amount: r.total_amount,
      total_tax: r.total_tax ?? 0,
      refund_amount: r.refund_amount,
      payment_status: r.payment_status,
      payment_mode: r.payment_mode,
      payment_date: r.payment_date,
      notes: r.notes,
      items: r.items,
      item_count: r.items.length,
      total_qty: r.items.reduce((s: number, i: any) => s + (i.return_qty || 0), 0)
    })),

    total_allocated: allocated,
    outstanding_amount: total - totalPaid,
    payment_summary: {
      total_bill: total,
      total_paid: totalPaid,
      remaining_amount: total - totalPaid,
      payment_count: allocations.length,
      is_fully_paid: totalPaid >= total,
      is_partially_paid: totalPaid > 0 && totalPaid < total
    },
    payment_history: allocations.map((a: any) => ({
      allocation_id: a.id,
      payment_id: a.payment_id,
      allocated_amount: Number(a.allocated_amount),
      allocation_date: a.allocation_date,
      allocation_notes: a.notes,
      payment_date: a.payment.payment_date,
      payment_amount: Number(a.payment.payment_amount),
      payment_mode: a.payment.payment_mode,
      payment_mode_text: a.payment.payment_mode === 0 ? 'Cash' : 'Bank',
      payment_type: a.payment.payment_type,
      payment_notes: a.payment.notes,
      created_at: a.payment.created_at
    }))
  };
}
