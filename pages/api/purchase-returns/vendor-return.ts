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

    // Use database transaction for atomic operations
    const result = await prisma.$transaction(async (tx) => {
      // Create the main return record
      const returnRecord = await tx.purchase_returns.create({
        data: {
          vendor_id: parseInt(vendor_id), // CORRECT: Use vendor_id for vendor-based returns
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
        // First get the product_id from purchase_item
        const purchaseItem = await tx.purchaseitems.findUnique({
          where: { id: item.purchase_item_id },
          select: { product_id: true }
        })

        if (purchaseItem?.product_id) {
          await tx.product.update({
            where: { id: purchaseItem.product_id },
            data: {
              stock: {
                decrement: item.return_qty  // ✅ FIXED: Decrement stock when returning to vendor
              }
            }
          })
        }
      }

      return returnRecord
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
