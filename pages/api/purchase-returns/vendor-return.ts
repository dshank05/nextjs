import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

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

      // Create the main return record (link to first affected purchase if available)
      const returnRecord = await tx.purchase_returns.create({
        data: {
          vendor_id: parseInt(vendor_id),
          purchase_id: affectedPurchases.length > 0 ? affectedPurchases[0].id : null,
          return_date: returnDateTimestamp,
          total_amount: totalAmount,
          total_tax: totalTax,
          status: 'Completed',
          notes: return_notes || '',
          fy: financialYear
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

      // Update return_status and recalculate totals for all affected purchases (OPTIMIZED)
      for (const purchase of affectedPurchases) {
        // Get purchase details in one query
        const purchaseRecord = await tx.purchase.findUnique({
          where: { id: purchase.id },
          select: { 
            invoice_no: true, 
            packing_forwarding_total: true,
            items_total: true,
            total_tax: true
          }
        })

        // Get all items for this purchase
        const allPurchaseItems = await tx.purchaseitems.findMany({
          where: { invoice_no: purchaseRecord?.invoice_no },
          select: { id: true, qty: true, rate: true, tax: true, cgst: true, sgst: true, igst: true }
        })

        // Get all returns for these items in one query
        const allReturns = await tx.purchase_return_items.findMany({
          where: { purchase_item_id: { in: allPurchaseItems.map(pi => pi.id) } },
          select: { purchase_item_id: true, return_qty: true, unit_price: true, tax_amount: true, cgst: true, sgst: true, igst: true }
        })

        // Calculate return totals
        const returnMap = new Map()
        allReturns.forEach(r => {
          const existing = returnMap.get(r.purchase_item_id) || { qty: 0, amount: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 }
          existing.qty += r.return_qty
          existing.amount += r.return_qty * r.unit_price
          existing.tax += r.tax_amount
          existing.cgst += r.cgst || 0
          existing.sgst += r.sgst || 0
          existing.igst += r.igst || 0
          returnMap.set(r.purchase_item_id, existing)
        })

        let fullyReturnedCount = 0
        let totalReturnedAmount = 0
        let totalReturnedTax = 0
        let totalReturnedCgst = 0
        let totalReturnedSgst = 0
        let totalReturnedIgst = 0

        for (const item of allPurchaseItems) {
          const returnData = returnMap.get(item.id)
          if (returnData) {
            totalReturnedAmount += returnData.amount
            totalReturnedTax += returnData.tax
            totalReturnedCgst += returnData.cgst
            totalReturnedSgst += returnData.sgst
            totalReturnedIgst += returnData.igst
            if (returnData.qty >= (item.qty || 0)) fullyReturnedCount++
          }
        }

        // Calculate return_status
        const returnStatus = fullyReturnedCount === 0 ? 0 : (fullyReturnedCount === allPurchaseItems.length ? 2 : 1)

        // Calculate new totals
        const originalItemsTotal = allPurchaseItems.reduce((sum, item) => sum + ((item.qty || 0) * (item.rate || 0)), 0)
        const newItemsTotal = originalItemsTotal - totalReturnedAmount
        const newTotalTax = allPurchaseItems.reduce((sum, item) => sum + (item.tax || 0), 0) - totalReturnedTax
        const newTotalCgst = allPurchaseItems.reduce((sum, item) => sum + (item.cgst || 0), 0) - totalReturnedCgst
        const newTotalSgst = allPurchaseItems.reduce((sum, item) => sum + (item.sgst || 0), 0) - totalReturnedSgst
        const newTotalIgst = allPurchaseItems.reduce((sum, item) => sum + (item.igst || 0), 0) - totalReturnedIgst
        const packingTotal = purchaseRecord?.packing_forwarding_total || 0
        const newGrandTotal = newItemsTotal + newTotalTax + packingTotal

        // Update purchase
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { 
            return_status: returnStatus,
            items_total: newItemsTotal,
            total_taxable_value: newItemsTotal,
            total_tax: newTotalTax,
            total_cgst: newTotalCgst,
            total_sgst: newTotalSgst,
            total_igst: newTotalIgst,
            total: newGrandTotal
          }
        })
      }

      return returnRecord
    }, {
      timeout: 15000 // 15 seconds timeout for complex return processing
    })

    res.status(201).json({
      success: true,
      message: 'Return processed successfully',
      data: {
        return: {
          id: result.id,
          return_no: `PR-${String(result.id).padStart(3, '0')}`,
          total_amount: totalAmount,
          total_tax: totalTax,
          status: 'Completed'
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
