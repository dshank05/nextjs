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

    // Get the return record with invoicex and customer
    const returnRecord = await prisma.salex_returns.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        invoicex_id: true,
        return_date: true,
        total_amount: true,
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

    // Get invoicex details
    const invoicex = returnRecord.invoicex_id ? await prisma.invoicex.findUnique({
      where: { id: returnRecord.invoicex_id },
      select: {
        id: true,
        invoice_no: true,
        select_customer: true,
        invoice_date: true
      }
    }) : null

    if (!invoicex) {
      return res.status(404).json({ message: 'Associated invoicex not found' })
    }

    // Get customer details
    const customer = invoicex.select_customer ? await prisma.customer_details.findUnique({
      where: { id: invoicex.select_customer },
      select: {
        id: true,
        billing_name: true,
        billing_state: true,
        billing_state_code: true,
        billing_gstin: true,
        billing_address: true
      }
    }) : null

    // Get return items with product details
    const returnItems = await prisma.salex_return_items.findMany({
      where: { salex_return_id: returnId },
      select: {
        id: true,
        invoice_itemx_id: true,
        return_qty: true,
        unit_price: true,
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

    // Get ALL invoicex items from the original invoice (not just returned ones)
    const allInvoicexItems = await prisma.invoice_itemsx.findMany({
      where: {
        invoice_no: invoicex.invoice_no
      },
      select: {
        id: true,
        product_id: true,
        name_of_product: true,
        part: true,
        qty: true,
        rate: true,
        invoice_no: true
      }
    })

    // Get product details
    const productIds = Array.from(new Set(allInvoicexItems.map(item => item.product_id).filter(Boolean)))
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

    // Create lookup maps
    const productMap = new Map(products.map(p => [p.id, p.display_name]))

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

    // Create a map of return items for quick lookup
    const returnItemsMap = new Map(returnItems.map(item => [item.invoice_itemx_id, item]))

    // Build ALL invoicex items with return status
    const allItemsWithDetails = allInvoicexItems.map(originalItem => {
      const product = productMap.get(originalItem.product_id)
      const returnItem = returnItemsMap.get(originalItem.id)
      const availableQty = (originalItem.qty || 0) // Available for return (original qty)

      // If this item was returned, use the return data; otherwise set return_qty to 0
      const returnQty = returnItem?.return_qty || 0
      const unitPrice = returnItem?.unit_price || originalItem.rate || 0

      return {
        id: originalItem.id.toString(),
        invoice_itemx_id: originalItem.id,
        product_id: originalItem.product_id || 0,
        product_name: product || originalItem.name_of_product || 'Unknown Product',
        display_name: product || originalItem.name_of_product,
        part_number: originalItem.part,
        original_qty: originalItem.qty || 0, // Original sale quantity
        available_qty: availableQty, // Available for return
        return_qty: returnQty, // 0 if not returned, actual qty if returned
        unit_price: unitPrice,
        return_reason_id: returnItem?.return_reason_id || 1,
        return_reason: returnItem?.reason?.reason_name || 'Unknown Reason',
        notes: returnItem?.notes || '',
        bill_reference: invoicex.invoice_no?.toString() || 'N/A',
        invoice_date: invoicex.invoice_date ? new Date(invoicex.invoice_date * 1000).toISOString().split('T')[0] : ''
      }
    })

    // Group items by bill (single invoicex for salex returns)
    const bills = [{
      id: invoicex.id?.toString() || returnRecord.id.toString(),
      invoice_no: invoicex.invoice_no?.toString() || 'N/A',
      bill_reference: invoicex.invoice_no?.toString() || 'Salex Return',
      invoice_date: invoicex.invoice_date ? new Date(invoicex.invoice_date * 1000).toISOString().split('T')[0] : '',
      total_amount: returnRecord.total_amount,
      has_tax: false, // No tax for salex
      available_items: allItemsWithDetails.length,
      total_items: allItemsWithDetails.length,
      items: allItemsWithDetails
    }]

    const response = {
      return: {
        id: returnRecord.id,
        return_no: `SX-${String(returnRecord.id).padStart(3, '0')}`,
        return_date: formattedReturnDate,
        total_amount: returnRecord.total_amount,
        refund_amount: returnRecord.refund_amount || returnRecord.total_amount,
        status: returnRecord.status,
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        notes: returnRecord.notes,
        fy: returnRecord.fy
      },
      customer: {
        id: customer?.id || 0,
        customer_name: customer?.billing_name || 'Unknown Customer',
        state: customer?.billing_state || '',
        state_code: customer?.billing_state_code || 0,
        gstin: customer?.billing_gstin || '',
        address: customer?.billing_address || ''
      },
      bills: bills,
      summary: {
        total_bills: 1,
        total_items: allItemsWithDetails.length,
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
    const { return_date, notes, items, payment_status, payment_mode, payment_date } = req.body

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Get existing return before transaction to check payment status change
    const existingReturn = await prisma.salex_returns.findUnique({
      where: { id: returnId },
      select: {
        payment_status: true,
        invoicex_id: true,
        fy: true,
        total_amount: true
      }
    })

    if (!existingReturn) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // Block editing if refunded
    if (existingReturn.payment_status === 1) {
      return res.status(400).json({
        message: 'Cannot edit a refunded return. The refund has already been processed.',
        error_code: 'REFUNDED_RETURN_EDIT_BLOCKED',
        suggestion: 'Create a new return if additional items need to be returned'
      })
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get current return items
      const currentReturnItems = await tx.salex_return_items.findMany({
        where: { salex_return_id: returnId },
        select: {
          invoice_itemx_id: true,
          return_qty: true
        }
      })

      // Get current return
      const currentReturn = await tx.salex_returns.findUnique({
        where: { id: returnId },
        select: { total_amount: true }
      })

      if (!currentReturn) {
        throw new Error('Return not found')
      }

      // Calculate new totals (no tax for salex)
      let totalAmount = 0

      const processedItems = items.map((item: any) => {
        const subtotal = item.return_qty * item.unit_price
        totalAmount += subtotal

        return {
          invoice_itemx_id: parseInt(item.invoice_itemx_id),
          return_qty: item.return_qty,
          unit_price: item.unit_price,
          return_reason_id: item.return_reason_id,
          notes: item.notes || ''
        }
      })

      // Pre-calculate NET stock adjustments
      const stockAdjustments = new Map<number, number>()

      // Get all invoice_itemx_ids (old + new)
      const allInvoiceItemIds = [
        ...currentReturnItems.map(item => item.invoice_itemx_id),
        ...processedItems.map(item => item.invoice_itemx_id)
      ]
      const uniqueInvoiceItemIds = Array.from(new Set(allInvoiceItemIds))

      // Fetch product_ids for all items in one query
      const invoiceItems = await tx.invoice_itemsx.findMany({
        where: { id: { in: uniqueInvoiceItemIds } },
        select: { id: true, product_id: true }
      })
      const invoiceItemMap = new Map(invoiceItems.map(ii => [ii.id, ii.product_id]))

      // Calculate reversals for old return items (decrease stock)
      for (const oldItem of currentReturnItems) {
        const productId = invoiceItemMap.get(oldItem.invoice_itemx_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment - oldItem.return_qty)
        }
      }

      // Calculate additions for new return items (increase stock)
      for (const newItem of processedItems) {
        const productId = invoiceItemMap.get(newItem.invoice_itemx_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment + newItem.return_qty)
        }
      }

      // Execute all stock adjustments in parallel
      const stockUpdatePromises = Array.from(stockAdjustments.entries())
        .filter(([_, adjustment]) => adjustment !== 0)
        .map(([productId, adjustment]) =>
          tx.product.update({
            where: { id: productId },
            data: { stock: { increment: adjustment } }
          })
        )

      // Delete old items and update stock in parallel
      const [deleteResult] = await Promise.all([
        tx.salex_return_items.deleteMany({ where: { salex_return_id: returnId } }),
        ...stockUpdatePromises
      ])

      // Update return record and create new items in parallel
      const refundAmount = totalAmount
      const [updatedReturn] = await Promise.all([
        tx.salex_returns.update({
          where: { id: returnId },
          data: {
            return_date: return_date ? Math.floor(new Date(return_date).getTime() / 1000) : undefined,
            total_amount: totalAmount,
            refund_amount: refundAmount,
            notes: notes || '',
            payment_status: payment_status !== undefined ? parseInt(payment_status) : undefined,
            payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : undefined,
            payment_date: payment_date ? parseInt(payment_date) : undefined,
            updated_at: new Date()
          }
        }),
        tx.salex_return_items.createMany({
          data: processedItems.map(item => ({
            salex_return_id: returnId,
            ...item
          }))
        })
      ])

      // Recalculate return_status for the invoicex
      if (existingReturn.invoicex_id) {
        // Get invoicex details
        const invoicexRecord = await tx.invoicex.findUnique({
          where: { id: existingReturn.invoicex_id },
          select: { invoice_no: true }
        })

        if (invoicexRecord) {
          // Get all items for this invoicex
          const allInvoiceItems = await tx.invoice_itemsx.findMany({
            where: { invoice_no: invoicexRecord.invoice_no },
            select: { id: true, qty: true }
          })

          // Get all returns for these items
          const allReturns = await tx.salex_return_items.findMany({
            where: { invoice_itemx_id: { in: allInvoiceItems.map(ii => ii.id) } },
            select: { invoice_itemx_id: true, return_qty: true }
          })

          // Calculate return status based on returned quantities
          const returnMap = new Map()
          allReturns.forEach(r => {
            const existing = returnMap.get(r.invoice_itemx_id) || { qty: 0 }
            existing.qty += r.return_qty
            returnMap.set(r.invoice_itemx_id, existing)
          })

          let fullyReturnedCount = 0
          let hasAnyReturns = false
          for (const item of allInvoiceItems) {
            const returnData = returnMap.get(item.id)
            if (returnData && returnData.qty > 0) {
              hasAnyReturns = true
              if (returnData.qty >= (item.qty || 0)) {
                fullyReturnedCount++
              }
            }
          }

          // Calculate return_status: 0=none, 1=partial, 2=full
          const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allInvoiceItems.length ? 2 : 1)

          // Update return_status on invoicex
          await tx.invoicex.update({
            where: { id: existingReturn.invoicex_id },
            data: { return_status: returnStatus }
          })
        }
      }

      return updatedReturn
    }, {
      timeout: 10000 // 10 second timeout for the transaction
    })

    res.status(200).json({
      success: true,
      data: {
        return: {
          id: result.id,
          return_no: `SX-${String(result.id).padStart(3, '0')}`,
          total_amount: result.total_amount,
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
      const returnItems = await tx.salex_return_items.findMany({
        where: { salex_return_id: returnId },
        select: { invoice_itemx_id: true, return_qty: true }
      })

      // Restore stock for all return items (decrease stock since we're removing the return)
      for (const returnItem of returnItems) {
        const invoiceItem = await tx.invoice_itemsx.findUnique({
          where: { id: returnItem.invoice_itemx_id },
          select: { product_id: true }
        })

        if (invoiceItem?.product_id) {
          await tx.product.update({
            where: { id: invoiceItem.product_id },
            data: {
              stock: { decrement: returnItem.return_qty } // Restore stock when return is cancelled
            }
          })
        }
      }

      // Delete return items and return record
      await tx.salex_return_items.deleteMany({
        where: { salex_return_id: returnId }
      })

      await tx.salex_returns.delete({
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
