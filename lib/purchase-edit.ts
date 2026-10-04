import { prisma } from './db'
import { transactionHandler } from './transaction-handler'
import { paidWithBill, trimAllocations, setOwnPaymentsMode } from './advance-allocation'
import { recalculatePurchaseStatus } from './payment-allocation-service'
import { assertStockCovers } from './purchase-delete'
import { convertDateToTimestamp, getLocalDateString } from './date-utils'
import {
  validatePurchase,
  computePurchaseTotals,
  getBusinessGstin,
  lineQty,
  PAYMENT_STATUS
} from './purchase'

/**
 * Editing a purchase (PUT /api/purchases/[id]).
 *
 * Rules, each the fix for a finding in PURCHASE_PASS2_AUDIT.md:
 *
 *  - A field the request does not send keeps its stored value. Absent fields
 *    used to be written as null/0, and an absent payment_status as Unpaid
 *    (PU-19).
 *  - Lines are reconciled by ROW. A line the form loaded carries `line_id`;
 *    without one, the first unmatched stored row of the same product is used.
 *    Keyed by product before, so two lines of one product collapsed and a bill
 *    holding them could not be edited at all (PU-17, L-24).
 *  - Every column of a kept line is saved: qty, rate, GST and the server's tax
 *    split, company, model, part, and the bill date. Only qty/rate/name/model
 *    were, and only when qty or rate moved (PU-14, PU-15, PU-16).
 *  - The GST split uses the bill's own state (the edited snapshot), falling
 *    back to the vendor master only when the bill has none (PU-18).
 *  - Partial (2) is derived from allocations. A form that loaded a part-paid
 *    bill sends 2 back, which means "leave payment alone" - it is not a request
 *    to set 2, and it used to fail validation on every save (PU-35).
 *  - Freight is part of the total, as on a sale; P&F follows sale's rule
 *    (owner, 2026-10-03, BILLS_PLAN Q1).
 *  - Units the edit takes back out of stock must still be there - a line whose
 *    units were sold cannot be lowered past what is left (BILLS_PLAN Q3).
 */

export class PurchaseEditError extends Error {
  constructor(
    public httpStatus: number,
    public clientMessage: string,
    public code: string,
    public detail?: unknown
  ) {
    super(code)
  }
}

const intOrNull = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

/** A state code as stored on bill_to / vendor_details, or null for none. */
export const parseStateCode = intOrNull

export async function updatePurchase(purchaseId: number, rawBody: any) {
  const body: any = { ...(rawBody || {}) }
  const has = (field: string) => body[field] !== undefined

  const existing = await prisma.purchase.findUnique({ where: { id: purchaseId } })
  if (!existing) throw new PurchaseEditError(404, 'Purchase not found', 'NOT_FOUND')
  // Captured now: the handler compares against the bill as it was.
  const oldTotal = existing.total
  const oldStatus = existing.payment_status ?? PAYMENT_STATUS.UNPAID

  if (body.vendor_id !== undefined && body.vendor_id !== null && intOrNull(body.vendor_id) !== existing.vendor_id) {
    throw new PurchaseEditError(
      400,
      'Vendor cannot be changed after purchase creation. Please delete and recreate the purchase if needed.',
      'VENDOR_CHANGE_NOT_ALLOWED'
    )
  }

  // PU-35: a resent Partial means "unchanged".
  if (body.payment_status !== undefined && body.payment_status !== null && intOrNull(body.payment_status) === PAYMENT_STATUS.PARTIAL) {
    delete body.payment_status
  }

  const failure = await validatePurchase(body, { partial: true })
  if (failure) throw new PurchaseEditError(failure.status, failure.message, 'VALIDATION')

  if (existing.return_status === 2) {
    throw new PurchaseEditError(400, 'Cannot edit a fully returned purchase. All items have been returned.', 'FULLY_RETURNED')
  }

  // Lines and the snapshot belong to the purchase by id (P4-11).
  const docKey = { purchase_id: purchaseId }

  const [storedLines, billTo, vendor, allocations] = await Promise.all([
    prisma.purchaseitems.findMany({ where: docKey, orderBy: { id: 'asc' } }),
    prisma.bill_to.findFirst({ where: docKey }),
    existing.vendor_id !== null ? prisma.vendor_details.findUnique({ where: { id: existing.vendor_id } }) : Promise.resolve(null),
    prisma.payment_allocations.findMany({ where: { purchase_id: purchaseId }, select: { allocated_amount: true } })
  ])

  // ---- Lines: the request's, or (when it sends none) the stored ones as they are
  const incoming: any[] = Array.isArray(body.items)
    ? body.items
    : storedLines.map(row => ({
        line_id: row.id,
        product_id: row.product_id,
        qty: row.qty,
        rate: row.rate,
        gst_percentage: row.gst_percentage
      }))

  const unmatched = new Map(storedLines.map(row => [row.id, row]))
  const plan = incoming.map(item => {
    const productId = intOrNull(item.product_id) as number
    const lineId = intOrNull(item.line_id)
    let row: (typeof storedLines)[number] | null = null
    if (lineId !== null) {
      if (!storedLines.some(r => r.id === lineId)) {
        throw new PurchaseEditError(400, 'A line in this request does not belong to this purchase.', 'FOREIGN_LINE')
      }
      row = unmatched.get(lineId) ?? null
      if (!row) throw new PurchaseEditError(400, 'The same line was sent twice.', 'DUPLICATE_LINE_ID')
    } else {
      row = Array.from(unmatched.values()).find(r => r.product_id === productId) ?? null
    }
    // A different product on a loaded line is a removal plus an addition.
    if (row && row.product_id !== productId) row = null
    if (row) unmatched.delete(row.id)
    return { item, productId, row }
  })
  const removed = Array.from(unmatched.values())

  // ---- Returns: a kept line cannot drop below what was returned from it, and a
  // line with returns cannot be removed.
  const returned = new Map<number, number>()
  if (storedLines.length) {
    const rows = await prisma.purchase_return_items.findMany({
      where: { purchase_item_id: { in: storedLines.map(r => r.id) } },
      select: { purchase_item_id: true, return_qty: true }
    })
    rows.forEach(r => returned.set(r.purchase_item_id, (returned.get(r.purchase_item_id) || 0) + r.return_qty))
  }
  for (const p of plan) {
    if (!p.row) continue
    const back = returned.get(p.row.id) || 0
    const qty = lineQty(p.item.qty)
    if (back > 0 && qty < back) {
      throw new PurchaseEditError(
        400,
        `Cannot reduce quantity for "${p.row.name_of_product}" to ${qty}. ${back} units have already been returned.`,
        'QTY_BELOW_RETURNED',
        { product_name: p.row.name_of_product, returned_qty: back, requested_qty: qty }
      )
    }
  }
  for (const row of removed) {
    const back = returned.get(row.id) || 0
    if (back > 0) {
      throw new PurchaseEditError(
        400,
        `Cannot delete "${row.name_of_product}". ${back} units have been returned.`,
        'CANNOT_DELETE_RETURNED_ITEM',
        { product_name: row.name_of_product, returned_qty: back }
      )
    }
  }

  // ---- Products for new lines (and to prove every product exists)
  // Legacy stored rows can lack a product; a request's lines cannot (validated).
  const productIds = Array.from(new Set(plan.map(p => p.productId).filter((id): id is number => id !== null)))
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, product_name: true, product_category_id: true, product_subcategory_id: true, hsn: true, last_purchase_date: true }
  })
  const productById = new Map(products.map(p => [p.id, p]))
  for (const id of productIds) {
    if (!productById.has(id)) throw new PurchaseEditError(400, 'A selected product does not exist', 'UNKNOWN_PRODUCT')
  }

  // ---- Money, from the lines and the bill's state (PU-18)
  const stateCode = has('state_code')
    ? parseStateCode(body.state_code)
    : (billTo?.state_code ?? vendor?.state_code ?? null)

  // P&F: what the request sends, else the stored figures (a legacy total with no
  // qty / rate is kept rather than zeroed). Freight is in the total (owner, 2026-10-03).
  const sentPacking = has('packing_forwarding_qty') || has('packing_forwarding_rate')
  const packingQty = sentPacking ? body.packing_forwarding_qty : existing.packing_forwarding_qty
  const packingRate = sentPacking ? body.packing_forwarding_rate : existing.packing_forwarding_rate
  const packingTotal = sentPacking ? body.packing_forwarding_total : existing.packing_forwarding_total
  const freight = has('transport_cost') ? body.transport_cost : existing.freight

  const totals = computePurchaseTotals({
    items: plan.map(p => ({ product_id: p.productId, qty: p.item.qty, rate: p.item.rate, gst_percentage: p.item.gst_percentage })),
    packingQty: packingQty ?? 0,
    packingRate: packingRate ?? 0,
    packingTotal: packingTotal ?? 0,
    freight: freight ?? 0,
    vendorStateCode: stateCode,
    businessGstin: await getBusinessGstin(),
    hasVendorState: stateCode != null
  })
  if (totals.supplyType === null) {
    throw new PurchaseEditError(
      400,
      'Cannot determine the tax type for this purchase. Check the state on this bill and the business GSTIN in Settings.',
      'SUPPLY_TYPE_UNRESOLVED'
    )
  }

  // ---- Payment intent: the stored status unless the request names one
  const requestedStatus = body.payment_status !== undefined && body.payment_status !== null
    ? (intOrNull(body.payment_status) as number)
    : (existing.payment_status ?? PAYMENT_STATUS.UNPAID)
  const paymentMode = body.payment_mode !== undefined && body.payment_mode !== null
    ? (intOrNull(body.payment_mode) as number)
    : (existing.payment_mode ?? 0)
  const modeChanged = body.payment_mode !== undefined && body.payment_mode !== null && paymentMode !== existing.payment_mode

  const totalAllocated = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0)
  const isTypeA = allocations.length > 0
  const newTotal = totals.grandTotal
  // "Paid" against allocations that do not cover the new total is Partial.
  let finalStatus = requestedStatus === PAYMENT_STATUS.PAID && isTypeA && totalAllocated > 0
    ? (totalAllocated >= newTotal ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL)
    : requestedStatus
  // A (part) paid bill with nothing allocated and no payment row - a 0 bill marked Paid -
  // whose total moves: nothing was paid, so it is Unpaid (A-03, 2026-10-04: it stayed Paid
  // and the counters invented the money). No payment is made for it automatically.
  if (finalStatus !== PAYMENT_STATUS.UNPAID && oldStatus !== PAYMENT_STATUS.UNPAID && !isTypeA
      && Math.abs(newTotal - Number(oldTotal)) > 0.005
      && !(await prisma.vendor_ledger.findFirst({
        where: { reference_type: 'purchase', reference_id: purchaseId, transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] } },
        select: { id: true }
      }))) {
    finalStatus = PAYMENT_STATUS.UNPAID
  }

  const finalDate = has('date') && body.date ? convertDateToTimestamp(body.date) : existing.invoice_date

  // ---- Header: only what was sent, plus everything the server derives
  const headerData: any = {
    invoice_date: finalDate,
    payment_status: finalStatus,
    payment_mode: paymentMode,
    packing_forwarding_qty: totals.packingQty,
    packing_forwarding_rate: totals.packingRate,
    packing_forwarding_total: totals.packingTotal,
    freight: totals.freight,
    items_total: totals.itemsTotal,
    total_taxable_value: totals.itemsTotal,
    total_cgst: totals.totalCgst,
    total_sgst: totals.totalSgst,
    total_igst: totals.totalIgst,
    total_tax: totals.totalTax,
    total: newTotal,
    // An edit moves it, in the create's format (A-13: written on create only).
    updated_at: getLocalDateString()
  }
  // Empty text is stored as create stores it, '' (A-06: an edit wrote null, so saving the
  // untouched form changed six columns). A column already blank (null on older rows) is kept.
  const blank = (v: any) => v === undefined || v === null || v === ''
  const textField = (sent: any, stored: any) => (blank(sent) ? (blank(stored) ? stored : '') : String(sent))
  if (has('bill_reference')) headerData.bill_reference = textField(body.bill_reference, existing.bill_reference)
  if (has('bill_reference_date')) headerData.bill_reference_date = body.bill_reference_date ? new Date(body.bill_reference_date).toISOString() : null
  if (has('notes')) headerData.notes = textField(body.notes, existing.notes)
  if (has('descriptions')) headerData.descriptions = textField(body.descriptions, existing.descriptions)
  if (has('transport_name')) {
    headerData.transport = textField(body.transport_name, existing.transport)
    headerData.transport_name = textField(body.transport_name, existing.transport_name)
  }
  if (has('vehicle_number')) headerData.vehicle_number = textField(body.vehicle_number, existing.vehicle_number)
  if (has('staff_id')) {
    const staffId = intOrNull(body.staff_id)
    // Disconnected only when one is set: an untouched save writes nothing (A-06).
    if (staffId) headerData.staff = { connect: { id: staffId } }
    else if (existing.staff_id !== null && existing.staff_id !== undefined) headerData.staff = { disconnect: true }
  }

  // ---- The billing snapshot: sent fields only on update; the master fills a new one
  const text = (field: string) => (has(field) ? (body[field] ?? '') : undefined)
  const snapshot = {
    vendor_name: text('vendor_name'),
    contact_no: text('contact_number'),
    email: text('email_id'),
    address: text('address'),
    address2: text('address_2'),
    city: text('city'),
    state: text('state'),
    state_code: has('state_code') ? parseStateCode(body.state_code) : undefined,
    gstin: text('gst_number'),
    pin_code: text('pin_code')
  }

  // ---- Stock the edit takes back out, per product (lowered, removed or swapped
  // lines), worked out before anything is written.
  const planned = new Map<number, number>()
  const plan2 = (productId: number | null, delta: number) => {
    if (productId === null || !Number.isFinite(delta) || delta === 0) return
    planned.set(productId, (planned.get(productId) || 0) + delta)
  }
  removed.forEach(r => plan2(r.product_id, -(r.qty || 0)))
  plan.forEach((p, i) => plan2(p.productId, totals.lines[i].qty - (p.row ? (p.row.qty || 0) : 0)))
  const takenOut = new Map<number, number>()
  for (const [productId, delta] of Array.from(planned.entries())) if (Math.round(delta) < 0) takenOut.set(productId, -Math.round(delta))

  return prisma.$transaction(async (tx) => {
    // Units this edit takes back out must still be in stock (owner, 2026-10-03):
    // lowering or removing a line whose units were sold would go below zero.
    await assertStockCovers(tx, takenOut, (name, have, need) =>
      `Cannot reduce "${name}" by ${need}: only ${have} is in stock. Some of it has been sold.`)

    await tx.vendor_ledger.updateMany({
      where: { reference_type: 'purchase', reference_id: purchaseId, transaction_type: 'PURCHASE' },
      data: { transaction_date: finalDate }
    })

    await tx.bill_to.upsert({
      where: { purchase_id: purchaseId },
      update: snapshot,
      create: {
        purchase_id: purchaseId,
        invoice_no: existing.invoice_no,
        fy: existing.fy,
        vendor_name: snapshot.vendor_name ?? vendor?.vendor_name ?? 'Other',
        contact_no: snapshot.contact_no ?? vendor?.contact_no ?? '',
        email: snapshot.email ?? vendor?.email ?? '',
        address: snapshot.address ?? vendor?.address ?? '',
        address2: snapshot.address2 ?? vendor?.address_2 ?? '',
        city: snapshot.city ?? vendor?.city ?? '',
        state: snapshot.state ?? vendor?.state ?? '',
        state_code: snapshot.state_code !== undefined ? snapshot.state_code : (vendor?.state_code ?? null),
        gstin: snapshot.gstin ?? vendor?.tax_id ?? '',
        pin_code: snapshot.pin_code ?? vendor?.pin_code ?? ''
      }
    })

    const updated = await tx.purchase.update({ where: { id: purchaseId }, data: headerData })

    // ---- Lines
    const stockDelta = new Map<number, number>()
    const bump = (productId: number | null, delta: number) => {
      if (productId === null || !Number.isFinite(delta) || delta === 0) return
      stockDelta.set(productId, (stockDelta.get(productId) || 0) + delta)
    }
    const latestRate = new Map<number, number>()

    if (removed.length) {
      await tx.purchaseitems.deleteMany({ where: { id: { in: removed.map(r => r.id) } } })
      removed.forEach(r => bump(r.product_id, -(r.qty || 0)))
    }

    const newRows: any[] = []
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]
      const line = totals.lines[i]
      const pick = (field: string, stored: any) => (p.item[field] !== undefined ? p.item[field] : stored)
      const money = {
        qty: line.qty,
        rate: line.rate,
        subtotal: line.taxable,
        gst_percentage: line.gst_percentage,
        cgst: line.cgst,
        sgst: line.sgst,
        igst: line.igst,
        tax: line.tax,
        invoice_date: finalDate
      }
      if (p.row) {
        bump(p.productId, line.qty - (p.row.qty || 0))
        if (Math.abs(line.rate - (p.row.rate || 0)) > 0.001) latestRate.set(p.productId, line.rate)
        await tx.purchaseitems.update({
          where: { id: p.row.id },
          data: {
            ...money,
            company_id: intOrNull(pick('company_id', p.row.company_id)),
            model_id: intOrNull(pick('model_id', p.row.model_id)),
            car_model: pick('car_model', p.row.car_model) || '',
            part: pick('part', p.row.part) || ''
          }
        })
      } else {
        const product = productById.get(p.productId)!
        newRows.push({
          ...money,
          purchase_id: purchaseId,
          invoice_no: existing.invoice_no,
          fy: existing.fy,
          product_id: p.productId,
          name_of_product: product.product_name,
          category_id: product.product_category_id ?? null,
          subcategory_id: product.product_subcategory_id ?? null,
          company_id: intOrNull(p.item.company_id),
          model_id: intOrNull(p.item.model_id),
          car_model: p.item.car_model || '',
          vendor_id: existing.vendor_id,
          hsn: product.hsn || '',
          part: p.item.part || ''
        })
        bump(p.productId, line.qty)
        latestRate.set(p.productId, line.rate)
      }
    }
    if (newRows.length) await tx.purchaseitems.createMany({ data: newRows })

    // Stock is whole units; a legacy fractional row rounds here.
    for (const [productId, delta] of Array.from(stockDelta.entries())) {
      const step = Math.round(delta)
      if (step !== 0) await tx.product.update({ where: { id: productId }, data: { stock: { increment: step } } })
    }

    // The product's latest rate moves only when this bill is its newest (L-4).
    for (const [productId, rate] of Array.from(latestRate.entries())) {
      await tx.product.updateMany({
        where: { id: productId, OR: [{ last_purchase_date: null }, { last_purchase_date: { lte: finalDate } }] },
        data: { latest_purchase_rate: rate, last_purchase_date: finalDate }
      })
    }

    // ---- Ledger, allocations and vendor balance: unchanged rules, in the handler
    const vendorBalance = existing.vendor_id !== null
      ? await tx.vendor_details.findUnique({
          where: { id: existing.vendor_id },
          select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
        })
      : null
    const hasPaymentLedger = await tx.vendor_ledger.findFirst({
      where: {
        vendor_id: existing.vendor_id,
        reference_type: 'purchase',
        reference_id: purchaseId,
        transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
      }
    })
    // What THIS purchase paid in (BILL_SPECIFIC), as opposed to what it
    // allocated from a pre-existing advance (L-30).
    const paidByThisDocument = isTypeA ? await paidWithBill(tx, 'vendor', { purchase_id: purchaseId }) : undefined

    const ops = await transactionHandler.handlePurchaseEdit({
      oldStatus,
      newStatus: finalStatus,
      oldTotal,
      newTotal,
      vendorId: existing.vendor_id as number,
      purchaseId,
      invoiceNo: existing.invoice_no.toString(),
      paymentMode,
      paymentDate: finalDate,
      fy: existing.fy,
      totalAllocated,
      paidByThisDocument,
      isTypeA,
      hasPaymentLedger: hasPaymentLedger !== null,
      currentBalance: vendorBalance
        ? {
            total_paid: Number(vendorBalance.total_paid),
            total_allocated: Number(vendorBalance.total_allocated),
            total_refunded: Number(vendorBalance.total_refunded),
            total_refund_allocated: Number(vendorBalance.total_refund_allocated)
          }
        : undefined
    })
    await transactionHandler.executeInTransaction(tx, ops)
    // A new mode picked on a bill that was and stays (part) paid: the payments made with it
    // follow, with their ledger rows (A-05). Shared payments and advance are left alone.
    if (modeChanged && oldStatus !== PAYMENT_STATUS.UNPAID && finalStatus !== PAYMENT_STATUS.UNPAID) {
      await setOwnPaymentsMode(tx, 'vendor', { purchase_id: purchaseId }, paymentMode)
    }
    // Lowered below what is allocated: the allocation shrinks, the rest is advance (owner).
    if (isTypeA && newTotal < totalAllocated - 0.005) {
      await trimAllocations(tx, 'vendor', { purchase_id: purchaseId }, newTotal)
      await recalculatePurchaseStatus(purchaseId, tx)
    }

    return updated
  }, { timeout: 30000 })
}
