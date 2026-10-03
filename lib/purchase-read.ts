import { prisma } from './db'

/**
 * One purchase, shaped for the view and edit pages.
 *
 * Was 400 lines inline in `api/purchases/[id].ts` GET with two queries per
 * return (N+1), a multi-bill count that ignored fy, and `isFullyReturned`
 * true for a bill with no lines (PU-21). Lines carry their database `id`, which
 * the edit form sends back as `line_id` so a save reconciles by row (PU-17).
 */
export async function loadPurchaseDetail(purchaseId: number) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } })
  if (!purchase) return null

  // Lines and the snapshot belong to the purchase by id (P4-11).
  const docKey = { purchase_id: purchaseId }

  const [lines, billTo, staff, allocations] = await Promise.all([
    prisma.purchaseitems.findMany({ where: docKey, orderBy: { id: 'asc' } }),
    prisma.bill_to.findFirst({ where: docKey }),
    purchase.staff_id ? prisma.staff.findUnique({ where: { id: purchase.staff_id } }) : Promise.resolve(null),
    prisma.payment_allocations.findMany({
      where: { purchase_id: purchaseId },
      include: {
        payment: {
          select: { id: true, payment_date: true, payment_amount: true, payment_mode: true, payment_type: true, notes: true, created_at: true }
        }
      },
      orderBy: { allocation_date: 'desc' }
    })
  ])

  const lineIds = lines.map(l => l.id)
  const productIds = lines.map(l => l.product_id).filter((id): id is number => id !== null)

  const [products, returnLines] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, display_name: true } })
      : Promise.resolve([] as { id: number; display_name: string | null }[]),
    lineIds.length
      ? prisma.purchase_return_items.findMany({
          where: { purchase_item_id: { in: lineIds } },
          include: { purchase_return: { select: { id: true, return_date: true, status: true } } }
        })
      : Promise.resolve([] as any[])
  ])
  const displayName = new Map(products.map(p => [p.id, p.display_name]))

  // Vendor block: the bill's own snapshot first (it may have been edited for
  // this bill), the vendor master only when no snapshot exists.
  const vendor = billTo
    ? {
        id: purchase.vendor_id || 0,
        vendor_name: billTo.vendor_name || '',
        address: billTo.address || '',
        address_2: billTo.address2 || '',
        city: billTo.city || '',
        state: billTo.state || '',
        state_code: billTo.state_code,
        pin_code: billTo.pin_code || '',
        tax_id: billTo.gstin || '',
        contact_no: billTo.contact_no || '',
        email: billTo.email || ''
      }
    : purchase.vendor_id
      ? await prisma.vendor_details.findUnique({ where: { id: purchase.vendor_id } })
      : null

  // ---- returns, per line and per return document
  const returnedByLine = new Map<number, { qty: number; history: any[] }>()
  for (const r of returnLines) {
    const entry = returnedByLine.get(r.purchase_item_id) || { qty: 0, history: [] as any[] }
    entry.qty += r.return_qty
    entry.history.push({
      return_id: r.purchase_return.id.toString(),
      return_no: `PR-${r.purchase_return.id.toString().padStart(3, '0')}`,
      qty: r.return_qty,
      date: r.purchase_return.return_date,
      unit_price: r.unit_price,
      tax_amount: r.tax_amount,
      cgst: r.cgst || 0,
      sgst: r.sgst || 0,
      igst: r.igst || 0,
      reason_id: r.return_reason_id,
      notes: r.notes || ''
    })
    returnedByLine.set(r.purchase_item_id, entry)
  }

  let fullyReturnedLines = 0
  const items = lines.map(line => {
    const returned = returnedByLine.get(line.id) || { qty: 0, history: [] }
    const qty = line.qty || 0
    const isFullyReturned = qty > 0 && returned.qty >= qty
    if (isFullyReturned) fullyReturnedLines++
    return {
      id: line.id,
      line_id: line.id,
      product_id: line.product_id,
      product_name: line.name_of_product || 'Unknown Product',
      display_name: (line.product_id && displayName.get(line.product_id)) || line.name_of_product,
      category_id: line.category_id,
      subcategory_id: line.subcategory_id,
      company_id: line.company_id,
      model_id: line.model_id,
      car_model: line.car_model || '',
      part: line.part || '',
      qty: line.qty,
      rate: line.rate,
      gst_percentage: line.gst_percentage || 0,
      cgst: line.cgst || 0,
      sgst: line.sgst || 0,
      igst: line.igst || 0,
      tax: line.tax || 0,
      total: line.subtotal,
      subtotal: line.subtotal,
      hsn: line.hsn || '',
      original_qty: qty,
      returned_qty: returned.qty,
      available_qty: Math.max(0, qty - returned.qty),
      is_fully_returned: isFullyReturned,
      return_history: returned.history
    }
  })

  const hasReturns = returnLines.length > 0
  const isFullyReturned = lines.length > 0 && fullyReturnedLines === lines.length

  // ---- return documents: one query for their headers, one for all their
  // lines (to count how many bills each spans). Was two queries per return.
  const returnIds = Array.from(new Set(returnLines.map((r: any) => r.purchase_return.id as number)))
  const [returnDocs, allReturnLines] = returnIds.length
    ? await Promise.all([
        prisma.purchase_returns.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, return_date: true, total_amount: true, total_tax: true, refund_amount: true, payment_status: true, payment_mode: true, payment_date: true, notes: true }
        }),
        prisma.purchase_return_items.findMany({
          where: { purchase_return_id: { in: returnIds } },
          select: { purchase_return_id: true, purchase_item_id: true }
        })
      ])
    : [[], []] as [any[], any[]]

  const otherLineIds = Array.from(new Set(allReturnLines.map((r: any) => r.purchase_item_id as number)))
  const billOfLine = new Map<number, number>()
  if (otherLineIds.length) {
    const rows = await prisma.purchaseitems.findMany({
      where: { id: { in: otherLineIds } },
      select: { id: true, purchase_id: true }
    })
    rows.forEach(r => billOfLine.set(r.id, r.purchase_id))
  }

  const lineById = new Map(lines.map(l => [l.id, l]))
  const returns = returnDocs.map((doc: any) => {
    const here = returnLines.filter((r: any) => r.purchase_return.id === doc.id)
    const all = allReturnLines.filter((r: any) => r.purchase_return_id === doc.id)
    const bills = new Set(all.map((r: any) => billOfLine.get(r.purchase_item_id)).filter(Boolean))
    const amount = here.reduce((s: number, r: any) => s + r.unit_price * r.return_qty, 0)
    const tax = here.reduce((s: number, r: any) => s + (r.tax_amount || 0), 0)
    return {
      id: doc.id,
      return_no: `PR-${doc.id.toString().padStart(3, '0')}`,
      return_date: doc.return_date,
      this_bill_amount: amount,
      this_bill_tax: tax,
      this_bill_total: amount + tax,
      this_bill_items_count: here.length,
      total_amount: doc.total_amount,
      total_tax: doc.total_tax || 0,
      refund_amount: doc.refund_amount,
      total_items_count: all.length,
      total_bills_count: bills.size,
      is_multi_bill_return: bills.size > 1,
      has_tax: false,
      payment_status: doc.payment_status,
      payment_mode: doc.payment_mode,
      payment_date: doc.payment_date,
      notes: doc.notes || '',
      items: here.map((r: any) => {
        const line = lineById.get(r.purchase_item_id)
        const name = line?.name_of_product || 'Unknown Product'
        return {
          product_name: name,
          display_name: (line?.product_id && displayName.get(line.product_id)) || name,
          part_number: line?.part || '',
          qty: r.return_qty,
          rate: r.unit_price,
          total: r.unit_price * r.return_qty,
          tax_amount: r.tax_amount || 0,
          cgst: r.cgst || 0,
          sgst: r.sgst || 0,
          igst: r.igst || 0
        }
      })
    }
  })

  const totalPaid = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0)

  return {
    id: purchase.id,
    invoice_number: purchase.invoice_no?.toString() || '',
    bill_reference: purchase.bill_reference || '',
    // Stored as UTC midnight of the picked day; the UTC date is that day in
    // every timezone the server might run in (PU-21).
    bill_reference_date: purchase.bill_reference_date ? purchase.bill_reference_date.toISOString().slice(0, 10) : '',
    staff_id: purchase.staff_id || null,
    date: purchase.invoice_date,
    vendor_id: purchase.vendor_id,
    transport_name: purchase.transport_name || purchase.transport || '',
    vehicle_number: purchase.vehicle_number || '',
    transport_cost: purchase.freight || 0,
    items_total: purchase.items_total || 0,
    total_taxable_value: purchase.total_taxable_value || purchase.items_total || 0,
    total_tax: purchase.total_tax || 0,
    total: purchase.total,
    freight: purchase.freight || 0,
    items,
    descriptions: purchase.descriptions || '',
    packing_forwarding_qty: purchase.packing_forwarding_qty || 0,
    packing_forwarding_rate: purchase.packing_forwarding_rate || 0,
    packing_forwarding_total: purchase.packing_forwarding_total || 0,
    total_cgst: purchase.total_cgst || 0,
    total_sgst: purchase.total_sgst || 0,
    total_igst: purchase.total_igst || 0,
    notes: purchase.notes || '',
    payment_status: purchase.payment_status ?? 0,
    // One default everywhere: Cash (PU-20).
    payment_mode: purchase.payment_mode ?? 0,
    return_status: {
      has_returns: hasReturns,
      fully_returned_items: fullyReturnedLines,
      total_items: lines.length,
      is_fully_returned: isFullyReturned,
      status: isFullyReturned ? 'FULLY_RETURNED' : hasReturns ? 'PARTIAL_RETURN' : 'NO_RETURNS'
    },
    returns,
    payment_summary: {
      total_bill: purchase.total,
      total_paid: totalPaid,
      remaining_amount: purchase.total - totalPaid,
      payment_count: allocations.length,
      is_fully_paid: totalPaid >= purchase.total,
      is_partially_paid: totalPaid > 0 && totalPaid < purchase.total
    },
    payment_history: allocations.map(a => ({
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
    })),
    fy: purchase.fy,
    item_count: lines.length,
    formattedDate: purchase.invoice_date,
    vendor,
    bill_to: billTo,
    staff
  }
}
