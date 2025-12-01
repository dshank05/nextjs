import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'PUT':
      return handlePut(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Get the return record with vendor
    const returnRecord = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        vendor_id: true,
        purchase_id: true,
        return_date: true,
        total_amount: true,
        total_tax: true,
        status: true,
        notes: true,
        fy: true,
        payment_status: true,
        payment_mode: true,
        payment_date: true,
        refund_amount: true,
        created_at: true,
        updated_at: true
      }
    })

    if (!returnRecord) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // Get vendor details directly from return (vendor-based returns)
    const vendor = returnRecord.vendor_id ? await prisma.vendor_details.findUnique({
      where: { id: returnRecord.vendor_id },
      select: {
        id: true,
        vendor_name: true,
        state: true,
        state_code: true,
        tax_id: true,
        address: true
      }
    }) : null

    if (!vendor) {
      return res.status(404).json({ message: 'Associated vendor not found' })
    }

    // Get purchase details if available (optional for vendor-based returns)
    let purchase = null
    if (returnRecord.purchase_id) {
      purchase = await prisma.purchase.findUnique({
        where: { id: returnRecord.purchase_id },
        select: {
          id: true,
          invoice_no: true,
          vendor_id: true,
          invoice_date: true
        }
      })
    }

    // Get return items with product details
    const returnItems = await prisma.purchase_return_items.findMany({
      where: { purchase_return_id: returnId },
      select: {
        id: true,
        purchase_item_id: true,
        return_qty: true,
        unit_price: true,
        tax_amount: true,
        return_reason_id: true,
        notes: true,
        reason: {
          select: {
            id: true,
            reason_name: true
          }
        }
      }
    })

    // Get original purchase items to get current available quantities
    const purchaseItemIds = returnItems.map(item => item.purchase_item_id)
    const originalPurchaseItems = await prisma.purchaseitems.findMany({
      where: {
        id: { in: purchaseItemIds }
      },
      select: {
        id: true,
        product_id: true,
        name_of_product: true,
        part: true,
        qty: true,
        rate: true,
        gst_percentage: true
      }
    })

    // Get product details
    const productIds = Array.from(new Set(originalPurchaseItems.map(item => item.product_id).filter(Boolean)))
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds }
      },
      select: {
        id: true,
        display_name: true,
        part_no: true,
        stock: true
      }
    })

    // Get already returned quantities for these items (excluding current return)
    const returnedQuantities = await prisma.purchase_return_items.groupBy({
      by: ['purchase_item_id'],
      where: {
        purchase_item_id: { in: purchaseItemIds },
        purchase_return_id: { not: returnId } // Exclude current return
      },
      _sum: {
        return_qty: true
      }
    })

    // Create lookup maps
    const productMap = new Map(products.map(p => [p.id, p]))
    const returnedQtyMap = new Map(
      returnedQuantities.map(item => [item.purchase_item_id, item._sum.return_qty || 0])
    )

    // Format return date
    let formattedReturnDate = ''
    try {
      if (returnRecord.return_date) {
        const dateObj = new Date(returnRecord.return_date * 1000)
        if (!isNaN(dateObj.getTime())) {
          formattedReturnDate = dateObj.toISOString().split('T')[0]
        }
      }
    } catch (error) {
      console.warn('Invalid return date format:', returnRecord.return_date, error)
    }

    // Build return items with current available quantities
    const returnItemsWithDetails = returnItems.map(item => {
      const originalItem = originalPurchaseItems.find(oi => oi.id === item.purchase_item_id)
      const product = originalItem ? productMap.get(originalItem.product_id) : null
      const alreadyReturned = returnedQtyMap.get(item.purchase_item_id) || 0
      const availableQty = (originalItem?.qty || 0) - alreadyReturned

      // Calculate tax breakdown (since it's not stored in return items)
      const taxRate = originalItem?.gst_percentage || 0
      const subtotal = item.return_qty * item.unit_price
      const taxAmount = item.tax_amount // Use stored tax amount

      // Determine CGST/SGST vs IGST based on vendor state
      const BUSINESS_STATE_CODE = 9 // Uttar Pradesh
      let cgst = 0, sgst = 0, igst = 0
      if (vendor?.state_code === BUSINESS_STATE_CODE) {
        cgst = taxAmount / 2
        sgst = taxAmount / 2
      } else {
        igst = taxAmount
      }

      return {
        id: item.id.toString(),
        purchase_item_id: item.purchase_item_id,
        product_id: originalItem?.product_id || 0,
        product_name: product?.display_name || originalItem?.name_of_product || 'Unknown Product',
        display_name: product?.display_name || originalItem?.name_of_product,
        part_number: product?.part_no || originalItem?.part,
        original_qty: originalItem?.qty || 0, // Original purchase quantity
        available_qty: Math.max(0, availableQty), // Don't add current return qty since it's already excluded from alreadyReturned
        return_qty: item.return_qty,
        unit_price: item.unit_price,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        cgst,
        sgst,
        igst,
        return_reason_id: item.return_reason_id,
        return_reason: item.reason?.reason_name || 'Unknown Reason',
        notes: item.notes,
        bill_reference: purchase?.invoice_no?.toString() || 'N/A',
        invoice_date: purchase?.invoice_date ? new Date(purchase.invoice_date * 1000).toISOString().split('T')[0] : ''
      }
    })

    // Group items by bill (for vendor-based returns without specific purchase)
    const bills = [{
      id: purchase?.id?.toString() || returnRecord.id.toString(),
      invoice_no: purchase?.invoice_no?.toString() || 'N/A',
      bill_reference: purchase?.invoice_no?.toString() || 'Vendor Return',
      invoice_date: purchase?.invoice_date ? new Date(purchase.invoice_date * 1000).toISOString().split('T')[0] : '',
      total_amount: returnRecord.total_amount,
      has_tax: (returnRecord.total_tax || 0) > 0,
      available_items: returnItemsWithDetails.length,
      total_items: returnItemsWithDetails.length,
      items: returnItemsWithDetails
    }]

    const response = {
      return: {
        id: returnRecord.id,
        return_no: `PR-${String(returnRecord.id).padStart(3, '0')}`,
        return_date: formattedReturnDate,
        total_amount: returnRecord.total_amount,
        total_tax: returnRecord.total_tax,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        status: returnRecord.status,
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        notes: returnRecord.notes,
        fy: returnRecord.fy
      },
      vendor: {
        id: vendor?.id || 0,
        vendor_name: vendor?.vendor_name || 'Unknown Vendor',
        state: vendor?.state || '',
        state_code: vendor?.state_code || 0,
        gstin: vendor?.tax_id || '',
        address: vendor?.address || ''
      },
      bills: bills,
      summary: {
        total_bills: 1,
        total_items: returnItemsWithDetails.length,
        total_value: returnRecord.total_amount
      }
    }

    res.status(200).json({
      success: true,
      data: response
    })
  } catch (error) {
    console.error('Return detail fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch return details',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const { return_date, notes, items } = req.body

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Start transaction with increased timeout
    const result = await prisma.$transaction(async (tx) => {
      // Get current return items
      const currentReturnItems = await tx.purchase_return_items.findMany({
        where: { purchase_return_id: returnId },
        select: { 
          purchase_item_id: true, 
          return_qty: true
        }
      })

      // Batch stock restoration
      if (currentReturnItems.length > 0) {
        // Get product_ids for current items
        const currentPurchaseItemIds = currentReturnItems.map(item => item.purchase_item_id)
        const currentPurchaseItems = await tx.purchaseitems.findMany({
          where: { id: { in: currentPurchaseItemIds } },
          select: { id: true, product_id: true }
        })
        const currentPurchaseItemMap = new Map(currentPurchaseItems.map(pi => [pi.id, pi.product_id]))

        const stockUpdates = currentReturnItems
          .filter(item => currentPurchaseItemMap.has(item.purchase_item_id))
          .map(item => ({
            product_id: currentPurchaseItemMap.get(item.purchase_item_id)!,
            qty: item.return_qty
          }))

        // Group by product_id and sum quantities (in case same product appears multiple times)
        const stockMap = new Map<number, number>()
        for (const update of stockUpdates) {
          stockMap.set(update.product_id, (stockMap.get(update.product_id) || 0) + update.qty)
        }

        // Restore stock in batch
        for (const [product_id, qty] of Array.from(stockMap.entries())) {
          await tx.product.update({
            where: { id: product_id },
            data: { stock: { increment: qty } }
          })
        }
      }

      // Get current return
      const currentReturn = await tx.purchase_returns.findUnique({
        where: { id: returnId },
        select: { total_amount: true, total_tax: true }
      })

      if (!currentReturn) {
        throw new Error('Return not found')
      }

      // Calculate new totals
      let totalAmount = 0
      let totalTax = 0

      const processedItems = items.map((item: any) => {
        const subtotal = item.return_qty * item.unit_price
        const taxAmount = (subtotal * item.tax_rate) / 100

        // Determine CGST/SGST vs IGST based on vendor state
        const BUSINESS_STATE_CODE = 9 // Uttar Pradesh
        let cgst = 0, sgst = 0, igst = 0
        if (item.vendor_state_code === BUSINESS_STATE_CODE) {
          cgst = taxAmount / 2
          sgst = taxAmount / 2
        } else {
          igst = taxAmount
        }

        totalAmount += subtotal + taxAmount
        totalTax += taxAmount

        return {
          purchase_item_id: parseInt(item.purchase_item_id),
          return_qty: item.return_qty,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          tax_amount: taxAmount,
          cgst,
          sgst,
          igst,
          return_reason_id: item.return_reason_id,
          notes: item.notes || ''
        }
      })

      // Update return record
      const updatedReturn = await tx.purchase_returns.update({
        where: { id: returnId },
        data: {
          return_date: return_date ? Math.floor(new Date(return_date).getTime() / 1000) : undefined,
          total_amount: totalAmount,
          total_tax: totalTax,
          notes: notes || '',
          updated_at: new Date()
        }
      })

      // Get product_ids for new items in batch
      const purchaseItemIds = processedItems.map(item => item.purchase_item_id)
      const purchaseItems = await tx.purchaseitems.findMany({
        where: { id: { in: purchaseItemIds } },
        select: { id: true, product_id: true }
      })
      const purchaseItemMap = new Map(purchaseItems.map(pi => [pi.id, pi.product_id]))

      // Delete existing return items
      await tx.purchase_return_items.deleteMany({
        where: { purchase_return_id: returnId }
      })

      // Create new return items in batch using createMany
      await tx.purchase_return_items.createMany({
        data: processedItems.map(item => ({
          purchase_return_id: returnId,
          ...item
        }))
      })

      // Batch stock decrements
      const newStockUpdates = processedItems
        .filter(item => purchaseItemMap.has(item.purchase_item_id))
        .map(item => ({
          product_id: purchaseItemMap.get(item.purchase_item_id)!,
          qty: item.return_qty
        }))

      // Group by product_id and sum quantities
      const newStockMap = new Map<number, number>()
      for (const update of newStockUpdates) {
        newStockMap.set(update.product_id, (newStockMap.get(update.product_id) || 0) + update.qty)
      }

      // Apply new stock decrements in batch
      for (const [product_id, qty] of Array.from(newStockMap.entries())) {
        await tx.product.update({
          where: { id: product_id },
          data: { stock: { decrement: qty } }
        })
      }

      return updatedReturn
    })

    res.status(200).json({
      success: true,
      data: {
        return: {
          id: result.id,
          return_no: `PR-${String(result.id).padStart(3, '0')}`,
          total_amount: result.total_amount,
          total_tax: result.total_tax,
          status: result.status
        }
      },
      message: 'Return updated successfully'
    })
  } catch (error) {
    console.error('Return update error:', error)
    res.status(500).json({
      message: 'Failed to update return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Delete return items first, then return record
    await prisma.$transaction(async (tx) => {
      // Get return items to restore stock before deleting
      const returnItems = await tx.purchase_return_items.findMany({
        where: { purchase_return_id: returnId },
        select: { purchase_item_id: true, return_qty: true }
      })

      // Restore stock for all return items
      for (const returnItem of returnItems) {
        const purchaseItem = await tx.purchaseitems.findUnique({
          where: { id: returnItem.purchase_item_id },
          select: { product_id: true }
        })

        if (purchaseItem?.product_id) {
          await tx.product.update({
            where: { id: purchaseItem.product_id },
            data: {
              stock: { increment: returnItem.return_qty } // Restore stock when return is cancelled
            }
          })
        }
      }

      // Delete return items and return record
      await tx.purchase_return_items.deleteMany({
        where: { purchase_return_id: returnId }
      })

      await tx.purchase_returns.delete({
        where: { id: returnId }
      })
    })

    res.status(200).json({
      success: true,
      message: 'Return deleted successfully'
    })
  } catch (error) {
    console.error('Return deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
