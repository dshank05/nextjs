import { prisma } from './db'
import { getNextInvoiceNumber } from './invoice-counter'
import { ledgerService } from './ledger-service'
import { balanceHandler } from './balance-handler'
import { getLocalDateString, convertDateToTimestamp } from './date-utils'
import { validatePurchase, computePurchaseTotals, getBusinessGstin, num, PAYMENT_STATUS } from './purchase'
import { parseStateCode } from './purchase-edit'
import { allocateFromAdvance, availableAdvance } from './advance-allocation'
import { SaleError, intOrNull } from './sale'

/**
 * Creating a purchase (POST /api/purchases). Moved out of the route
 * (BILLS_PLAN B1) with its rules unchanged, except:
 *  - freight is part of the total, as on a sale (owner, 2026-10-03);
 *  - a missing product is a 400 that says so, not a bare 500;
 *  - refusals are SaleErrors, answered by lib/api/purchase-routes.ts.
 *
 * Numbering: the form no longer sends a number, so the server's counter picks
 * it and a lost race for it is retried with the next one (F-13 / P4-05). A
 * number the caller names is still honoured and not retried - there a
 * collision is a real answer.
 *
 * "Other" (vendor 0) is a real vendor row; its purchases post to the vendor
 * ledger as vendor 0, as before.
 */
const MAX_INVOICE_ATTEMPTS = 3

export interface CreatedPurchase {
  id: number
  invoice_no: number
  total: number
  vendor_name: string
}

export async function createPurchase(rawBody: any, attempt = 1): Promise<CreatedPurchase> {
  const body: any = { ...(rawBody || {}) }
  const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('purchase')
  const clientChoseNumber = body.invoice_number !== undefined && body.invoice_number !== null && body.invoice_number !== ''
  const invoiceNo = clientChoseNumber ? parseInt(String(body.invoice_number), 10) : nextInvoiceNo
  if (!Number.isFinite(invoiceNo) || invoiceNo < 1) throw new SaleError(400, 'Invalid invoice number', 'VALIDATION')

  // Unique within the financial year only (P4-02, L-1).
  if (await prisma.purchase.findFirst({ where: { invoice_no: invoiceNo, fy: currentFy } })) {
    throw new SaleError(400, `Invoice number ${invoiceNo} already exists in this financial year`, 'DUPLICATE_INVOICE_NO')
  }

  const failure = await validatePurchase(body, { partial: false })
  if (failure) throw new SaleError(failure.status, failure.message, 'VALIDATION')

  const vendorId = parseInt(String(body.vendor_id), 10)
  if (vendorId === 0 && !String(body.contact_number ?? '').trim()) {
    throw new SaleError(400, 'Phone number is required for "Other" vendor selection', 'VALIDATION')
  }
  const existingVendor = await prisma.vendor_details.findUnique({ where: { id: vendorId } })

  const items: any[] = body.items
  const invoiceDate = Math.floor(body.date ? convertDateToTimestamp(body.date) : Date.now() / 1000)
  // The bill's own state, the vendor master as the fallback (PU-18).
  const billStateCode = body.state_code !== undefined && body.state_code !== null && body.state_code !== ''
    ? parseStateCode(body.state_code)
    : (existingVendor?.state_code ?? null)
  const totals = computePurchaseTotals({
    items,
    packingQty: body.packing_forwarding_qty,
    packingRate: body.packing_forwarding_rate,
    packingTotal: body.packing_forwarding_total,
    freight: body.transport_cost,
    vendorStateCode: billStateCode,
    businessGstin: await getBusinessGstin(),
    hasVendorState: billStateCode != null
  })
  if (totals.supplyType === null) {
    throw new SaleError(400,
      'Cannot determine the tax type for this purchase. Check that the vendor has a valid state and that the business GSTIN in Settings is correct.',
      'SUPPLY_TYPE_UNRESOLVED')
  }
  const grandTotal = totals.grandTotal
  if (!Number.isFinite(grandTotal)) throw new SaleError(400, 'Could not compute a valid total from the supplied amounts', 'VALIDATION')

  const paymentStatus = intOrNull(body.payment_status) ?? PAYMENT_STATUS.UNPAID
  const paymentMode = intOrNull(body.payment_mode)

  try {
    const purchase = await prisma.$transaction(async (tx: any) => {
      // ---- Products first: a missing one is the caller's mistake, not a 500
      const productIds = Array.from(new Set(items.map(i => parseInt(i.product_id, 10))))
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, product_name: true, product_category_id: true, product_subcategory_id: true, company_id: true, hsn: true }
      })
      const productById = new Map<number, any>(products.map((p: any) => [p.id, p]))
      for (const id of productIds) {
        if (!productById.has(id)) throw new SaleError(400, `Product with ID ${id} not found`, 'UNKNOWN_PRODUCT')
      }

      // ---- Header
      const data: any = {
        invoice_no: invoiceNo,
        bill_reference: body.bill_reference ?? '',
        bill_reference_date: body.bill_reference_date ? new Date(body.bill_reference_date).toISOString() : null,
        items_total: totals.itemsTotal,
        freight: totals.freight,
        total_taxable_value: totals.itemsTotal,
        total_cgst: totals.totalCgst,
        total_sgst: totals.totalSgst,
        total_igst: totals.totalIgst,
        total_tax: totals.totalTax,
        total: grandTotal,
        notes: body.notes || '',
        descriptions: body.descriptions ?? '',
        packing_forwarding_qty: totals.packingQty,
        packing_forwarding_rate: totals.packingRate,
        packing_forwarding_total: totals.packingTotal,
        invoice_date: invoiceDate,
        updated_at: getLocalDateString(),
        payment_status: paymentStatus,
        payment_mode: paymentMode,
        fy: currentFy,
        transport: body.transport_name || '',
        transport_name: body.transport_name ?? '',
        vehicle_number: body.vehicle_number ?? '',
        return_status: 0
      }
      const staffId = intOrNull(body.staff_id)
      if (staffId) data.staff = { connect: { id: staffId } }
      if (vendorId === 0) data.vendor_id = 0
      else data.vendor = { connect: { id: vendorId } }
      const created = await tx.purchase.create({ data })

      // ---- Billing snapshot, under the bill's own number (P4-03)
      const text = (v: any) => (v === undefined || v === null ? undefined : String(v))
      await tx.bill_to.create({
        data: {
          purchase_id: created.id,
          invoice_no: invoiceNo,
          fy: currentFy,
          vendor_name: text(body.vendor_name) ?? existingVendor?.vendor_name ?? '',
          contact_no: text(body.contact_number) ?? existingVendor?.contact_no ?? '',
          email: text(body.email_id) ?? existingVendor?.email ?? '',
          address: text(body.address) ?? existingVendor?.address ?? '',
          address2: text(body.address_2) ?? existingVendor?.address_2 ?? '',
          city: text(body.city) ?? existingVendor?.city ?? '',
          state: text(body.state) ?? existingVendor?.state ?? '',
          state_code: billStateCode,
          gstin: text(body.gst_number) ?? existingVendor?.tax_id ?? '',
          pin_code: text(body.pin_code) ?? existingVendor?.pin_code ?? ''
        }
      })

      // ---- Lines: the server's figures, the product's names
      await tx.purchaseitems.createMany({
        data: items.map((item, i) => {
          const productId = parseInt(item.product_id, 10)
          const product = productById.get(productId)
          const line = totals.lines[i]
          return {
            purchase_id: created.id,
            invoice_no: invoiceNo,
            product_id: productId,
            name_of_product: product.product_name,
            category_id: product.product_category_id || 0,
            subcategory_id: product.product_subcategory_id || 0,
            model_id: intOrNull(item.model_id),
            company_id: intOrNull(item.company_id),
            car_model: item.car_model || '',
            vendor_id: vendorId,
            part: item.part || '',
            hsn: product.hsn || '',   // A-08: lines added by an edit had it, lines saved at create did not
            qty: line.qty,
            rate: line.rate,
            subtotal: line.taxable,
            gst_percentage: line.gst_percentage,
            cgst: line.cgst,
            sgst: line.sgst,
            igst: line.igst,
            tax: line.tax,
            fy: currentFy,
            invoice_date: invoiceDate
          }
        })
      })

      // ---- Advance, worked out once (L-9 / P4-18)
      let advanceUsed = 0
      let newPayment = 0
      let ledgerNote: string | undefined
      let vendorBalance: any = null
      if (paymentStatus === PAYMENT_STATUS.PAID) {
        vendorBalance = await tx.vendor_details.findUnique({
          where: { id: vendorId },
          select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
        })
        const advance = availableAdvance(vendorBalance)
        advanceUsed = await allocateFromAdvance(
          tx, 'vendor', vendorId, { purchase_id: created.id },
          Math.min(Math.max(0, advance), grandTotal), invoiceDate,
          { mode: paymentMode, fy: currentFy }
        )
        newPayment = Math.round((grandTotal - advanceUsed) * 100) / 100
        if (advanceUsed >= grandTotal) ledgerNote = `Paid using ₹${advanceUsed.toFixed(2)} from advance balance`
        else if (advanceUsed > 0) ledgerNote = `Paid: ₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment`
      }

      // ---- Stock in, and the latest purchase rate when this bill is the newest (L-4)
      const perProduct = new Map<number, { qty: number; rate: number }>()
      for (const line of totals.lines) {
        if (isNaN(line.product_id)) continue
        const seen = perProduct.get(line.product_id)
        if (seen) { seen.qty += line.qty; seen.rate = line.rate } else perProduct.set(line.product_id, { qty: line.qty, rate: line.rate })
      }
      for (const [productId, agg] of Array.from(perProduct.entries())) {
        await tx.product.update({ where: { id: productId }, data: { stock: { increment: agg.qty } } })
        await tx.product.updateMany({
          where: { id: productId, OR: [{ last_purchase_date: null }, { last_purchase_date: { lte: invoiceDate } }] },
          data: { latest_purchase_rate: agg.rate, last_purchase_date: invoiceDate }
        })
      }

      // ---- Ledger: the purchase, then the payment it came with
      await ledgerService.createPurchaseEntry({
        id: created.id,
        vendor_id: vendorId,
        invoice_no: created.invoice_no,
        invoice_date: invoiceDate,
        total: grandTotal,
        fy: currentFy,
        notes: ledgerNote
      }, tx)

      if (paymentStatus === PAYMENT_STATUS.PAID) {
        if (newPayment > 0) {
          const payment = await tx.vendor_payments.create({
            data: {
              vendor_id: vendorId,
              payment_date: invoiceDate,
              payment_amount: newPayment,
              payment_mode: paymentMode,
              payment_type: 'BILL_SPECIFIC',
              notes: advanceUsed > 0
                ? `New payment for purchase ${created.invoice_no}: ₹${newPayment.toFixed(2)}`
                : `Payment for purchase ${created.invoice_no}`,
              fy: currentFy
            }
          })
          await tx.payment_allocations.create({
            data: {
              payment_id: payment.id,
              purchase_id: created.id,
              allocated_amount: newPayment,
              allocation_date: invoiceDate,
              notes: 'Allocated during purchase creation'
            }
          })
          await ledgerService.createEntry({
            vendor_id: vendorId,
            transaction_date: invoiceDate,
            transaction_type: 'PAYMENT',
            reference_type: 'purchase',
            reference_id: created.id,
            reference_no: created.invoice_no.toString(),
            debit: 0,
            credit: newPayment,
            payment_mode: paymentMode,
            payment_status: 1,
            payment_date: invoiceDate,
            notes: `Payment ₹${newPayment} for bill INV-${created.invoice_no} via Payment #${payment.id}`,
            fy: currentFy,
            transaction_id: payment.id
          } as any, tx)
        }

        const balanceOp = balanceHandler.getCreateBalanceOps({
          vendorId,
          total: grandTotal,
          currentBalance: vendorBalance ? {
            total_paid: Number(vendorBalance.total_paid),
            total_allocated: Number(vendorBalance.total_allocated),
            total_refunded: Number(vendorBalance.total_refunded),
            total_refund_allocated: Number(vendorBalance.total_refund_allocated)
          } : undefined,
          type: 'PURCHASE'
        } as any)
        if (balanceOp) {
          await balanceHandler.incrementBalanceInTransaction(tx, balanceOp.vendorId, balanceOp.update, {
            type: 'purchase_create',
            id: created.id,
            reference_no: `INV-${created.invoice_no}`,
            notes: advanceUsed > 0
              ? `Purchase: ₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment`
              : `Purchase: ₹${grandTotal.toFixed(2)} paid`
          } as any)
        }
      }
      return created
    }, { timeout: 45000 })

    return {
      id: purchase.id,
      invoice_no: purchase.invoice_no,
      total: purchase.total,
      vendor_name: existingVendor?.vendor_name || body.vendor_name || 'Other'
    }
  } catch (error: any) {
    // Auto-numbered and lost the race for the number: take the next one.
    if (error?.code === 'P2002' && !clientChoseNumber && attempt < MAX_INVOICE_ATTEMPTS) {
      return createPurchase(rawBody, attempt + 1)
    }
    throw error
  }
}
