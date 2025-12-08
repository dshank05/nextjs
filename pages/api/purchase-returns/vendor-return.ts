import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { generateNoteNumber } from '../../../lib/note-counter'
import { ledgerService } from '../../../lib/ledger-service'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'POST':
      return handlePost(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      vendor_id,
      return_date,
      return_notes,
      payment_status, // 0=Unpaid/Pending Refund, 1=Paid/Refunded (optional, defaults to 0)
      payment_mode,   // 0=Cash, 1=Bank (optional, defaults to 1)
      payment_date,   // Unix timestamp (optional)
      include_packing_forwarding, // 0=no, 1=yes (optional, defaults to 0)
      include_freight,            // 0=no, 1=yes (optional, defaults to 0)
      pf_calculation_method,      // 3=proportional, 4=full (optional, defaults to 3)
      freight_calculation_method, // 3=proportional, 4=full (optional, defaults to 3)
      items // Array of { purchase_item_id, return_qty, return_reason_id, unit_price, tax_rate, notes? }
    } = req.body

    // Validation
    if (!vendor_id || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Vendor ID and items are required'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert return date to Unix timestamp
    const returnDateTimestamp = return_date ? Math.floor(new Date(return_date).getTime() / 1000) : Math.floor(Date.now() / 1000)

    // Calculate totals
    let totalAmount = 0
    let totalTax = 0

    // Get vendor details for tax calculations
    const vendor = await prisma.vendor_details.findUnique({
      where: { id: parseInt(vendor_id) },
      select: { state_code: true }
    })

    // Process items and calculate totals
    const processedItems = []
    for (const item of items) {
      const subtotal = item.return_qty * item.unit_price
      const taxAmount = (subtotal * item.tax_rate) / 100

      // Calculate CGST/SGST/IGST breakdown based on vendor state
      const BUSINESS_STATE_CODE = 9 // Uttar Pradesh
      let cgst = 0, sgst = 0, igst = 0
      if (vendor?.state_code === BUSINESS_STATE_CODE) {
        // Intra-state: CGST + SGST
        cgst = taxAmount / 2
        sgst = taxAmount / 2
      } else {
        // Inter-state: IGST only
        igst = taxAmount
      }

      totalAmount += subtotal
      totalTax += taxAmount

      processedItems.push({
        purchase_item_id: parseInt(item.purchase_item_id),
        return_qty: item.return_qty,
        return_reason_id: parseInt(item.return_reason_id),
        unit_price: item.unit_price,
        tax_amount: taxAmount,
        cgst: cgst,
        sgst: sgst,
        igst: igst,
        subtotal: subtotal,
        notes: item.notes || ''
      })
    }

    // Generate debit note number (outside transaction)
    const debitNoteNo = await generateNoteNumber('DEBIT', financialYear)

    // Process payment tracking fields (before transaction)
    const paymentStatusValue = payment_status !== undefined ? parseInt(payment_status) : 0 // Default: Unpaid
    const paymentModeValue = payment_mode !== undefined ? parseInt(payment_mode) : 1 // Default: Bank
    const paymentDateValue = payment_date ? parseInt(payment_date) : null

    // Calculate P&F and freight amounts
    let packingForwardingAmount = 0
    let freightAmount = 0
    
    if (include_packing_forwarding || include_freight) {
      // Get first affected purchase for P&F/freight calculation
      const purchaseItems = await prisma.purchaseitems.findMany({
        where: {
          id: { in: items.map((item: any) => parseInt(item.purchase_item_id)) }
        },
        select: { invoice_no: true }
      })

      if (purchaseItems.length > 0) {
        const firstPurchaseInvoiceNo = purchaseItems[0].invoice_no
        const originalPurchase = await prisma.purchase.findFirst({
          where: { invoice_no: firstPurchaseInvoiceNo },
          select: {
            total: true,
            packing_forwarding_total: true,
            freight: true
          }
        })

        if (originalPurchase) {
          const returnRatio = totalAmount / (originalPurchase.total || 1)
          const pfMethod = pf_calculation_method !== undefined ? parseInt(pf_calculation_method) : 3
          const freightMethod = freight_calculation_method !== undefined ? parseInt(freight_calculation_method) : 3

          // P&F calculation
          if (include_packing_forwarding && originalPurchase.packing_forwarding_total) {
            if (pfMethod === 3) {
              // Proportional
              packingForwardingAmount = returnRatio * originalPurchase.packing_forwarding_total
            } else if (pfMethod === 4) {
              // Full
              packingForwardingAmount = originalPurchase.packing_forwarding_total
            }
          }

          // Freight calculation
          if (include_freight && originalPurchase.freight) {
            if (freightMethod === 3) {
              // Proportional
              freightAmount = returnRatio * originalPurchase.freight
            } else if (freightMethod === 4) {
              // Full
              freightAmount = originalPurchase.freight
            }
          }
        }
      }
    }

    // Calculate refund amount (before transaction for use in ledger entry)
    const refundAmount = totalAmount + totalTax + packingForwardingAmount + freightAmount

    // Use database transaction with increased timeout for return processing
    const result = await prisma.$transaction(async (tx) => {
      // Get affected purchase IDs from items
      const purchaseItems = await tx.purchaseitems.findMany({
        where: {
          id: { in: items.map((item: any) => parseInt(item.purchase_item_id)) }
        },
        select: {
          id: true,
          invoice_no: true,
          product_id: true
        }
      })

      // Get unique purchase IDs
      const purchaseInvoiceNos = Array.from(new Set(purchaseItems.map(pi => pi.invoice_no)))
      const affectedPurchases = await tx.purchase.findMany({
        where: {
          invoice_no: { in: purchaseInvoiceNos }
        },
        select: { id: true }
      })

      // Calculate refund amount (total + tax + P&F + freight)
      const refundAmount = totalAmount + totalTax + packingForwardingAmount + freightAmount

      // Process payment tracking fields
      const paymentStatusValue = payment_status !== undefined ? parseInt(payment_status) : 0 // Default: Unpaid
      const paymentModeValue = payment_mode !== undefined ? parseInt(payment_mode) : 1 // Default: Bank
      const paymentDateValue = payment_date ? parseInt(payment_date) : null

      // Create the main return record with debit note and P&F/freight fields
      const returnRecord = await tx.purchase_returns.create({
        data: {
          debit_note_no: debitNoteNo,
          note_type: 'DEBIT',
          vendor_id: parseInt(vendor_id),
          purchase_id: affectedPurchases.length > 0 ? affectedPurchases[0].id : null,
          return_date: returnDateTimestamp,
          total_amount: totalAmount,
          total_tax: totalTax,
          status: 'Completed',
          notes: return_notes || '',
          fy: financialYear,
          payment_status: paymentStatusValue,
          payment_mode: paymentModeValue,
          payment_date: paymentDateValue,
          refund_amount: refundAmount,
          include_packing_forwarding: include_packing_forwarding ? parseInt(include_packing_forwarding) : 0,
          include_freight: include_freight ? parseInt(include_freight) : 0,
          pf_calculation_method: pf_calculation_method !== undefined ? parseInt(pf_calculation_method) : 3,
          freight_calculation_method: freight_calculation_method !== undefined ? parseInt(freight_calculation_method) : 3,
          packing_forwarding_amount: packingForwardingAmount,
          freight_amount: freightAmount
        }
      })

      // Create return items and update product stock
      for (const item of processedItems) {
        // Create return item record
        await tx.purchase_return_items.create({
          data: {
            purchase_return_id: returnRecord.id,
            purchase_item_id: item.purchase_item_id,
            return_qty: item.return_qty,
            return_reason_id: item.return_reason_id,
            unit_price: item.unit_price,
            tax_amount: item.tax_amount,
            cgst: item.cgst,
            sgst: item.sgst,
            igst: item.igst,
            notes: item.notes
          }
        })

        // Update product stock (DECREASE stock since we're returning items to vendor)
        const purchaseItem = purchaseItems.find(pi => pi.id === item.purchase_item_id)
        if (purchaseItem?.product_id) {
          await tx.product.update({
            where: { id: purchaseItem.product_id },
            data: {
              stock: {
                decrement: item.return_qty
              }
            }
          })
        }
      }

      // Update return_status for all affected purchases
      // CRITICAL: We do NOT modify the original purchase amounts - they remain unchanged for accounting integrity
      // Returns are tracked separately in purchase_returns and purchase_return_items tables
      // Net amounts are calculated on-demand in reports/views when needed
      for (const purchase of affectedPurchases) {
        // Get purchase details
        const purchaseRecord = await tx.purchase.findUnique({
          where: { id: purchase.id },
          select: { invoice_no: true }
        })

        // Get all items for this purchase
        const allPurchaseItems = await tx.purchaseitems.findMany({
          where: { invoice_no: purchaseRecord?.invoice_no },
          select: { id: true, qty: true }
        })

        // Get all returns for these items
        const allReturns = await tx.purchase_return_items.findMany({
          where: { purchase_item_id: { in: allPurchaseItems.map(pi => pi.id) } },
          select: { purchase_item_id: true, return_qty: true }
        })

        // Calculate return status based on returned quantities
        const returnMap = new Map()
        allReturns.forEach(r => {
          const existing = returnMap.get(r.purchase_item_id) || { qty: 0 }
          existing.qty += r.return_qty
          returnMap.set(r.purchase_item_id, existing)
        })

        let fullyReturnedCount = 0
        let hasAnyReturns = false
        for (const item of allPurchaseItems) {
          const returnData = returnMap.get(item.id)
          if (returnData && returnData.qty > 0) {
            hasAnyReturns = true
            if (returnData.qty >= (item.qty || 0)) {
              fullyReturnedCount++
            }
          }
        }

        // Calculate return_status: 0=none, 1=partial, 2=full
        const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allPurchaseItems.length ? 2 : 1)

        // ✅ ONLY update return_status - preserve original purchase amounts
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { 
            return_status: returnStatus
          }
        })
      }

      return returnRecord
    }, {
      timeout: 15000 // 15 seconds timeout for complex return processing
    })

    // Create ledger entry for debit note (outside transaction)
    await ledgerService.createDebitNoteEntry({
      id: result.id,
      vendor_id: parseInt(vendor_id),
      debit_note_no: debitNoteNo,
      return_date: returnDateTimestamp,
      total_amount: totalAmount,
      total_tax: totalTax,
      packing_forwarding_amount: packingForwardingAmount,
      freight_amount: freightAmount,
      fy: financialYear
    })

    // If refunded immediately, create refund received ledger entry
    if (paymentStatusValue === 1) {
      await ledgerService.createEntry({
        vendor_id: parseInt(vendor_id),
        transaction_date: paymentDateValue || returnDateTimestamp,
        transaction_type: 'REFUND_RECEIVED',
        reference_type: 'purchase_return',
        reference_id: result.id,
        reference_no: debitNoteNo,
        debit: refundAmount,
        credit: 0,
        payment_mode: paymentModeValue,
        payment_status: 1,
        payment_date: paymentDateValue,
        notes: `Refund received for ${debitNoteNo}`,
        fy: financialYear
      })
    }

    res.status(201).json({
      success: true,
      message: 'Return processed successfully',
      data: {
        return: {
          id: result.id,
          debit_note_no: debitNoteNo,
          return_no: `PR-${String(result.id).padStart(3, '0')}`,
          total_amount: totalAmount,
          total_tax: totalTax,
          packing_forwarding_amount: packingForwardingAmount,
          freight_amount: freightAmount,
          refund_amount: totalAmount + totalTax + packingForwardingAmount + freightAmount,
          status: 'Completed',
          payment_status: result.payment_status,
          payment_mode: result.payment_mode,
          payment_date: result.payment_date
        }
      }
    })

  } catch (error) {
    console.error('Vendor return processing error:', error)
    res.status(500).json({
      message: 'Failed to process return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
