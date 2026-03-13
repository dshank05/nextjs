import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { customerTransactionHandler } from '../../../lib/customer-transaction-handler'

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

    // Try to find in sale_returns first
    let returnRecord = await prisma.sale_returns.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        invoice_id: true,
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

    let isInvoicex = false
    let salexReturnRecord = null

    // If not found in sale_returns, try salex_returns
    if (!returnRecord) {
      salexReturnRecord = await prisma.salex_returns.findUnique({
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

      if (!salexReturnRecord) {
        return res.status(404).json({ message: 'Return not found' })
      }

      isInvoicex = true
      // Map salex return to common structure
      returnRecord = {
        ...salexReturnRecord,
        invoice_id: salexReturnRecord.invoicex_id,
        total_tax: 0
      } as any
    }

    // Get invoice details based on type
    const invoice = isInvoicex
      ? (returnRecord.invoice_id ? await prisma.invoicex.findUnique({
          where: { id: returnRecord.invoice_id },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            invoice_date: true
          }
        }) : null)
      : (returnRecord.invoice_id ? await prisma.invoice.findUnique({
          where: { id: returnRecord.invoice_id },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            invoice_date: true
          }
        }) : null)

    if (!invoice) {
      return res.status(404).json({ message: 'Associated invoice not found' })
    }

    // Get customer details
    const customer = invoice.select_customer ? await prisma.customer_details.findUnique({
      where: { id: invoice.select_customer },
      select: {
        id: true,
        billing_name: true,
        billing_state: true,
        billing_state_code: true,
        billing_gstin: true,
        billing_address: true
      }
    }) : null

    // If customer not found but invoice has customer ID, return error
    if (invoice.select_customer && invoice.select_customer !== 0 && !customer) {
      return res.status(404).json({ message: 'Customer not found for this return' })
    }

    // If customer not found but invoice has customer ID, return error
    if (invoice.select_customer && invoice.select_customer !== 0 && !customer) {
      return res.status(404).json({ message: 'Customer not found for this return' })
    }

    // Get return items based on type
    const returnItems = isInvoicex
      ? await prisma.salex_return_items.findMany({
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
        }).then(items => items.map(item => ({
          ...item,
          invoice_item_id: item.invoice_itemx_id,
          tax_amount: 0
        })))
      : await prisma.sale_return_items.findMany({
          where: { sale_return_id: returnId },
          select: {
            id: true,
            invoice_item_id: true,
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

    // Get ALL invoice items from the original invoice based on type
    const allInvoiceItems = isInvoicex
      ? await prisma.invoice_itemsx.findMany({
          where: { invoice_no: invoice.id }, // ✅ FIX: Use invoice.id, not invoice.invoice_no
          select: {
            id: true,
            product_id: true,
            name_of_product: true,
            part: true,
            qty: true,
            rate: true,
            invoice_no: true
          }
        }).then(items => items.map(item => ({
          ...item,
          gst_percentage: 0
        })))
      : await prisma.invoiceitems.findMany({
          where: { invoice_no: invoice.id }, // ✅ FIX: Use invoice.id, not invoice.invoice_no
          select: {
            id: true,
            product_id: true,
            name_of_product: true,
            part: true,
            qty: true,
            rate: true,
            gst_percentage: true,
            invoice_no: true
          }
        })

    // Get product details
    const productIds = Array.from(new Set(allInvoiceItems.map(item => item.product_id).filter(Boolean)))
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

    // Format return date in local timezone
    let formattedReturnDate = ''
    try {
      if (returnRecord.return_date) {
        const dateObj = new Date(returnRecord.return_date * 1000)
        if (!isNaN(dateObj.getTime())) {
          const year = dateObj.getFullYear();
          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
          const day = String(dateObj.getDate()).padStart(2, '0');
          formattedReturnDate = `${year}-${month}-${day}`;
        }
      }
    } catch (error) {
      console.warn('Invalid return date format:', returnRecord.return_date, error)
    }

    // Create a map of return items for quick lookup
    const returnItemsMap = new Map(returnItems.map(item => [item.invoice_item_id, item]))

    // Build ALL invoice items with return status
    const allItemsWithDetails = allInvoiceItems.map(originalItem => {
      const product = productMap.get(originalItem.product_id)
      const returnItem = returnItemsMap.get(originalItem.id)
      const availableQty = (originalItem.qty || 0) // Available for return (original qty)

      // If this item was returned, use the return data; otherwise set return_qty to 0
      const returnQty = returnItem?.return_qty || 0
      const unitPrice = returnItem?.unit_price || originalItem.rate || 0
      const taxRate = originalItem.gst_percentage || 0

      // Calculate tax for the returned quantity
      const subtotal = returnQty * unitPrice
      const taxAmount = returnItem?.tax_amount || 0

      // Determine CGST/SGST vs IGST based on customer state
      const BUSINESS_STATE_CODE = 9 // Uttar Pradesh
      let cgst = 0, sgst = 0, igst = 0
      if (customer?.billing_state_code === BUSINESS_STATE_CODE) {
        cgst = taxAmount / 2
        sgst = taxAmount / 2
      } else {
        igst = taxAmount
      }

      return {
        id: originalItem.id.toString(),
        invoice_item_id: originalItem.id,
        product_id: originalItem.product_id || 0,
        product_name: product || originalItem.name_of_product || 'Unknown Product',
        display_name: product || originalItem.name_of_product,
        part_number: originalItem.part,
        original_qty: originalItem.qty || 0, // Original sale quantity
        available_qty: availableQty, // Available for return
        return_qty: returnQty, // 0 if not returned, actual qty if returned
        unit_price: unitPrice,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        cgst,
        sgst,
        igst,
        return_reason_id: returnItem?.return_reason_id || 1,
        return_reason: returnItem?.reason?.reason_name || 'Unknown Reason',
        notes: returnItem?.notes || '',
        bill_reference: invoice.invoice_no?.toString() || 'N/A',
        invoice_date: invoice.invoice_date ? (() => {
          const date = new Date(invoice.invoice_date * 1000);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        })() : ''
      }
    })

    // Group items by bill (single invoice for sale returns)
    const bills = [{
      id: invoice.id?.toString() || returnRecord.id.toString(),
      invoice_no: invoice.invoice_no?.toString() || 'N/A',
      bill_reference: invoice.invoice_no?.toString() || (isInvoicex ? 'Salex Return' : 'Sale Return'),
      invoice_date: invoice.invoice_date ? (() => {
        const date = new Date(invoice.invoice_date * 1000);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      })() : '',
      total_amount: returnRecord.total_amount,
      has_tax: (returnRecord.total_tax || 0) > 0,
      available_items: allItemsWithDetails.length,
      total_items: allItemsWithDetails.length,
      items: allItemsWithDetails,
      invoice_type: isInvoicex ? 'invoicex' : 'invoice'
    }]

    const returnPrefix = isInvoicex ? 'SXR' : 'SR'
    const response = {
      return: {
        id: returnRecord.id,
        return_no: `${returnPrefix}-${String(returnRecord.id).padStart(3, '0')}`,
        return_date: formattedReturnDate,
        total_amount: returnRecord.total_amount,
        total_tax: returnRecord.total_tax,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        status: returnRecord.status,
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        notes: returnRecord.notes,
        fy: returnRecord.fy,
        invoice_type: isInvoicex ? 'invoicex' : 'invoice'
      },
      customer: customer ? {
        id: customer.id,
        customer_name: customer.billing_name,
        billing_name: customer.billing_name,
        state: customer.billing_state || '',
        state_code: customer.billing_state_code || 0,
        gstin: customer.billing_gstin || '',
        address: customer.billing_address || ''
      } : {
        id: 0,
        customer_name: 'Other',
        billing_name: 'Other',
        state: '',
        state_code: 0,
        gstin: '',
        address: ''
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
    const { return_date, notes, items, payment_status, payment_mode, payment_date, invoice_type } = req.body

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Determine if this is invoicex or invoice return
    const isInvoicex = invoice_type === 'invoicex'

    // Get existing return before transaction
    const existingReturn = isInvoicex
      ? await prisma.salex_returns.findUnique({
          where: { id: returnId },
          select: {
            payment_status: true,
            invoicex_id: true,
            fy: true,
            total_amount: true,
            return_date: true
          }
        }).then(r => r ? { ...r, invoice_id: r.invoicex_id, total_tax: 0 } : null)
      : await prisma.sale_returns.findUnique({
          where: { id: returnId },
          select: {
            payment_status: true,
            invoice_id: true,
            fy: true,
            total_amount: true,
            total_tax: true,
            return_date: true
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

    // Start transaction - ALL operations inside
    const result = await prisma.$transaction(async (tx) => {
      // Get current return items based on type
      const currentReturnItems = isInvoicex
        ? await tx.salex_return_items.findMany({
            where: { salex_return_id: returnId },
            select: { invoice_itemx_id: true, return_qty: true }
          }).then(items => items.map(item => ({ invoice_item_id: item.invoice_itemx_id, return_qty: item.return_qty })))
        : await tx.sale_return_items.findMany({
            where: { sale_return_id: returnId },
            select: { invoice_item_id: true, return_qty: true }
          })

      // Calculate new totals and process items
      let totalAmount = 0
      let totalTax = 0

      const processedItems = items.map((item: any) => {
        const subtotal = item.return_qty * item.unit_price
        const taxAmount = isInvoicex ? 0 : ((subtotal * (item.tax_rate || 0)) / 100)

        totalAmount += subtotal
        totalTax += taxAmount

        // Accept both invoice_item_id and sale_item_id for compatibility
        const itemId = item.invoice_item_id || item.sale_item_id
        if (!itemId) {
          throw new Error('Missing invoice_item_id or sale_item_id in item')
        }

        return {
          invoice_item_id: parseInt(itemId),
          return_qty: item.return_qty,
          unit_price: item.unit_price,
          tax_amount: taxAmount,
          return_reason_id: item.return_reason_id,
          notes: item.notes || ''
        }
      })

      // Pre-calculate NET stock adjustments
      const stockAdjustments = new Map<number, number>()

      // Get all invoice_item_ids (old + new)
      const allInvoiceItemIds = [
        ...currentReturnItems.map(item => item.invoice_item_id),
        ...processedItems.map(item => item.invoice_item_id)
      ]
      const uniqueInvoiceItemIds = Array.from(new Set(allInvoiceItemIds))

      // Fetch product_ids for all items in one query based on type (only if items exist)
      const invoiceItems = uniqueInvoiceItemIds.length > 0
        ? (isInvoicex
            ? await tx.invoice_itemsx.findMany({
                where: { id: { in: uniqueInvoiceItemIds } },
                select: { id: true, product_id: true }
              })
            : await tx.invoiceitems.findMany({
                where: { id: { in: uniqueInvoiceItemIds } },
                select: { id: true, product_id: true }
              }))
        : []
      
      const invoiceItemMap = new Map(invoiceItems.map(ii => [ii.id, ii.product_id]))

      // Calculate reversals for old return items (decrease stock)
      for (const oldItem of currentReturnItems) {
        const productId = invoiceItemMap.get(oldItem.invoice_item_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment - oldItem.return_qty)
        }
      }

      // Calculate additions for new return items (increase stock)
      for (const newItem of processedItems) {
        const productId = invoiceItemMap.get(newItem.invoice_item_id)
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
      if (isInvoicex) {
        await Promise.all([
          tx.salex_return_items.deleteMany({ where: { salex_return_id: returnId } }),
          ...stockUpdatePromises
        ])
      } else {
        await Promise.all([
          tx.sale_return_items.deleteMany({ where: { sale_return_id: returnId } }),
          ...stockUpdatePromises
        ])
      }

      // Update return record and create new items in parallel
      const refundAmount = totalAmount + totalTax
      
      if (isInvoicex) {
        const [updatedReturn] = await Promise.all([
          tx.salex_returns.update({
            where: { id: returnId },
            data: {
              return_date: return_date ? convertDateToTimestamp(return_date) : undefined,
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
              invoice_itemx_id: item.invoice_item_id,
              return_qty: item.return_qty,
              return_reason_id: item.return_reason_id,
              unit_price: item.unit_price,
              notes: item.notes
            }))
          })
        ])

        // Recalculate return_status for the invoicex
        if (existingReturn.invoice_id) {
          const invoiceRecord = await tx.invoicex.findUnique({
            where: { id: existingReturn.invoice_id },
            select: { invoice_no: true, select_customer: true }
          })

          if (invoiceRecord) {
            const allInvoiceItems = await tx.invoice_itemsx.findMany({
              where: { invoice_no: invoiceRecord.invoice_no },
              select: { id: true, qty: true }
            })

            const allReturns = await tx.salex_return_items.findMany({
              where: { invoice_itemx_id: { in: allInvoiceItems.map(ii => ii.id) } },
              select: { invoice_itemx_id: true, return_qty: true }
            })

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

            const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allInvoiceItems.length ? 2 : 1)

            await tx.invoicex.update({
              where: { id: existingReturn.invoice_id },
              data: { return_status: returnStatus }
            })

            // ✅ USE TRANSACTION HANDLER FOR LEDGER/ALLOCATION/BALANCE OPERATIONS
            const oldPaymentStatus = existingReturn.payment_status
            const newPaymentStatus = payment_status !== undefined ? parseInt(payment_status) : existingReturn.payment_status
            const oldTotal = (existingReturn.total_amount || 0) + (existingReturn.total_tax || 0)
            const newTotal = totalAmount + totalTax

            // Calculate final return date
            const finalReturnDate = return_date
              ? convertDateToTimestamp(return_date)
              : updatedReturn.return_date

            const dateChanged = return_date && finalReturnDate !== existingReturn.return_date

            // Update CREDIT_NOTE date if changed
            if (dateChanged && invoiceRecord.select_customer && invoiceRecord.select_customer !== 0) {
              await tx.customer_ledger.updateMany({
                where: {
                  customer_id: invoiceRecord.select_customer,
                  reference_type: 'salex_return',
                  reference_id: returnId,
                  transaction_type: 'CREDIT_NOTE'
                },
                data: {
                  transaction_date: finalReturnDate
                }
              })
            }

            // Get existing allocations
            const existingAllocations = await tx.customer_refund_allocations.findMany({
              where: { 
                salex_return_id: returnId 
              },
              select: { allocated_amount: true }
            })

            const totalAllocated = existingAllocations.reduce(
              (sum, alloc) => sum + Number(alloc.allocated_amount),
              0
            )

            // Fetch customer balance
            const customer = invoiceRecord.select_customer && invoiceRecord.select_customer !== 0
              ? await tx.customer_details.findUnique({
                  where: { id: invoiceRecord.select_customer },
                  select: {
                    total_paid: true,
                    total_allocated: true,
                    total_refunded: true,
                    total_refund_allocated: true
                  }
                })
              : null

            // Call handler if customer exists
            if (invoiceRecord.select_customer && invoiceRecord.select_customer !== 0) {
              const handlerResult = await customerTransactionHandler.handleReturnEdit({
                type: 'salex',
                oldStatus: oldPaymentStatus,
                newStatus: newPaymentStatus,
                oldTotal: oldTotal,
                newTotal: newTotal,
                customerId: invoiceRecord.select_customer,
                returnId: returnId,
                creditNoteNo: `SXR-${String(returnId).padStart(3, '0')}`,
                paymentMode: payment_mode !== undefined ? parseInt(payment_mode) : updatedReturn.payment_mode,
                paymentDate: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
                returnDate: finalReturnDate,
                fy: existingReturn.fy,
                totalAllocated: totalAllocated,
                totalAmount: totalAmount,
                totalTax: totalTax,
                tx: tx,
                currentBalance: customer ? {
                  total_paid: Number(customer.total_paid),
                  total_allocated: Number(customer.total_allocated),
                  total_refunded: Number(customer.total_refunded),
                  total_refund_allocated: Number(customer.total_refund_allocated)
                } : undefined
              })

              await customerTransactionHandler.executeInTransaction(tx, handlerResult)
            }
          }
        }

        return updatedReturn
      } else {
        const [updatedReturn] = await Promise.all([
          tx.sale_returns.update({
            where: { id: returnId },
            data: {
              return_date: return_date ? convertDateToTimestamp(return_date) : undefined,
              total_amount: totalAmount,
              total_tax: totalTax,
              refund_amount: refundAmount,
              notes: notes || '',
              payment_status: payment_status !== undefined ? parseInt(payment_status) : undefined,
              payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : undefined,
              payment_date: payment_date ? parseInt(payment_date) : undefined,
              updated_at: new Date()
            }
          }),
          tx.sale_return_items.createMany({
            data: processedItems.map(item => ({
              sale_return_id: returnId,
              invoice_item_id: item.invoice_item_id,
              return_qty: item.return_qty,
              return_reason_id: item.return_reason_id,
              unit_price: item.unit_price,
              tax_amount: item.tax_amount,
              notes: item.notes
            }))
          })
        ])

        // Recalculate return_status for the invoice
        if (existingReturn.invoice_id) {
          const invoiceRecord = await tx.invoice.findUnique({
            where: { id: existingReturn.invoice_id },
            select: { invoice_no: true, select_customer: true }
          })

          if (invoiceRecord) {
            const allInvoiceItems = await tx.invoiceitems.findMany({
              where: { invoice_no: invoiceRecord.invoice_no },
              select: { id: true, qty: true }
            })

            const allReturns = await tx.sale_return_items.findMany({
              where: { invoice_item_id: { in: allInvoiceItems.map(ii => ii.id) } },
              select: { invoice_item_id: true, return_qty: true }
            })

            const returnMap = new Map()
            allReturns.forEach(r => {
              const existing = returnMap.get(r.invoice_item_id) || { qty: 0 }
              existing.qty += r.return_qty
              returnMap.set(r.invoice_item_id, existing)
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

            const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allInvoiceItems.length ? 2 : 1)

            await tx.invoice.update({
              where: { id: existingReturn.invoice_id },
              data: { return_status: returnStatus }
            })

            // ✅ USE TRANSACTION HANDLER FOR LEDGER/ALLOCATION/BALANCE OPERATIONS
            const oldPaymentStatus = existingReturn.payment_status
            const newPaymentStatus = payment_status !== undefined ? parseInt(payment_status) : existingReturn.payment_status
            const oldTotal = (existingReturn.total_amount || 0) + (existingReturn.total_tax || 0)
            const newTotal = totalAmount + totalTax

            // Calculate final return date
            const finalReturnDate = return_date
              ? convertDateToTimestamp(return_date)
              : updatedReturn.return_date

            const dateChanged = return_date && finalReturnDate !== existingReturn.return_date

            // Update CREDIT_NOTE date if changed
            if (dateChanged && invoiceRecord.select_customer && invoiceRecord.select_customer !== 0) {
              await tx.customer_ledger.updateMany({
                where: {
                  customer_id: invoiceRecord.select_customer,
                  reference_type: 'sale_return',
                  reference_id: returnId,
                  transaction_type: 'CREDIT_NOTE'
                },
                data: {
                  transaction_date: finalReturnDate
                }
              })
            }

            // Get existing allocations
            const existingAllocations = await tx.customer_refund_allocations.findMany({
              where: { 
                sale_return_id: returnId 
              },
              select: { allocated_amount: true }
            })

            const totalAllocated = existingAllocations.reduce(
              (sum, alloc) => sum + Number(alloc.allocated_amount),
              0
            )

            // Fetch customer balance
            const customer = invoiceRecord.select_customer && invoiceRecord.select_customer !== 0
              ? await tx.customer_details.findUnique({
                  where: { id: invoiceRecord.select_customer },
                  select: {
                    total_paid: true,
                    total_allocated: true,
                    total_refunded: true,
                    total_refund_allocated: true
                  }
                })
              : null

            // Call handler if customer exists
            if (invoiceRecord.select_customer && invoiceRecord.select_customer !== 0) {
              const handlerResult = await customerTransactionHandler.handleReturnEdit({
                type: 'sale',
                oldStatus: oldPaymentStatus,
                newStatus: newPaymentStatus,
                oldTotal: oldTotal,
                newTotal: newTotal,
                customerId: invoiceRecord.select_customer,
                returnId: returnId,
                creditNoteNo: `SR-${String(returnId).padStart(3, '0')}`,
                paymentMode: payment_mode !== undefined ? parseInt(payment_mode) : updatedReturn.payment_mode,
                paymentDate: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
                returnDate: finalReturnDate,
                fy: existingReturn.fy,
                totalAllocated: totalAllocated,
                totalAmount: totalAmount,
                totalTax: totalTax,
                tx: tx,
                currentBalance: customer ? {
                  total_paid: Number(customer.total_paid),
                  total_allocated: Number(customer.total_allocated),
                  total_refunded: Number(customer.total_refunded),
                  total_refund_allocated: Number(customer.total_refund_allocated)
                } : undefined
              })

              await customerTransactionHandler.executeInTransaction(tx, handlerResult)
            }
          }
        }

        return updatedReturn
      }
    }, {
      timeout: 45000 // 45 seconds timeout for complex return edit processing
    })

    const returnPrefix = isInvoicex ? 'SXR' : 'SR'
    res.status(200).json({
      success: true,
      data: {
        return: {
          id: result.id,
          return_no: `${returnPrefix}-${String(result.id).padStart(3, '0')}`,
          total_amount: result.total_amount,
          total_tax: isInvoicex ? 0 : (result as any).total_tax,
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

    // Try to find in sale_returns first
    const saleReturn = await prisma.sale_returns.findUnique({
      where: { id: returnId },
      select: { 
        id: true,
        invoice_id: true,
        payment_status: true,
        fy: true,
        total_amount: true,
        total_tax: true
      }
    })

    if (saleReturn) {
      // Get invoice details for customer_id
      const invoice = await prisma.invoice.findUnique({
        where: { id: saleReturn.invoice_id },
        select: { select_customer: true }
      })

      // ✅ Use customer transaction handler for deletion
      if (invoice?.select_customer && invoice.select_customer !== 0) {
        const operations = await customerTransactionHandler.handleReturnDelete({
          type: 'sale',
          returnId: returnId,
          customerId: invoice.select_customer,
          paymentStatus: saleReturn.payment_status,
          fy: saleReturn.fy,
          totalAmount: saleReturn.total_amount,
          totalTax: saleReturn.total_tax
        })

        await prisma.$transaction(async (tx) => {
          await customerTransactionHandler.executeDeleteInTransaction(tx, operations)
        }, {
          timeout: 45000
        })
      } else {
        // For "Other" customer, just delete manually
        await prisma.$transaction(async (tx) => {
          const returnItems = await tx.sale_return_items.findMany({
            where: { sale_return_id: returnId },
            select: { invoice_item_id: true, return_qty: true }
          })

          for (const returnItem of returnItems) {
            const invoiceItem = await tx.invoiceitems.findUnique({
              where: { id: returnItem.invoice_item_id },
              select: { product_id: true }
            })

            if (invoiceItem?.product_id) {
              await tx.product.update({
                where: { id: invoiceItem.product_id },
                data: { stock: { decrement: returnItem.return_qty } }
              })
            }
          }

          await tx.sale_return_items.deleteMany({ where: { sale_return_id: returnId } })
          await tx.sale_returns.delete({ where: { id: returnId } })
        })
      }
    } else {
      // Try salex_returns
      const salexReturn = await prisma.salex_returns.findUnique({
        where: { id: returnId },
        select: { 
          id: true,
          invoicex_id: true,
          payment_status: true,
          fy: true,
          total_amount: true
        }
      })

      if (!salexReturn) {
        return res.status(404).json({ message: 'Return not found' })
      }

      // Get invoice details for customer_id
      const invoice = await prisma.invoicex.findUnique({
        where: { id: salexReturn.invoicex_id },
        select: { select_customer: true }
      })

      // ✅ Use customer transaction handler for deletion
      if (invoice?.select_customer && invoice.select_customer !== 0) {
        const operations = await customerTransactionHandler.handleReturnDelete({
          type: 'salex',
          returnId: returnId,
          customerId: invoice.select_customer,
          creditNoteNo: `SXR-${String(returnId).padStart(3, '0')}`,
          paymentStatus: salexReturn.payment_status,
          fy: salexReturn.fy,
          totalAmount: salexReturn.total_amount,
          totalTax: 0
        })

        await prisma.$transaction(async (tx) => {
          await customerTransactionHandler.executeDeleteInTransaction(tx, operations)
        }, {
          timeout: 45000
        })
      } else {
        // For "Other" customer, just delete manually
        await prisma.$transaction(async (tx) => {
          const returnItems = await tx.salex_return_items.findMany({
            where: { salex_return_id: returnId },
            select: { invoice_itemx_id: true, return_qty: true }
          })

          for (const returnItem of returnItems) {
            const invoiceItem = await tx.invoice_itemsx.findUnique({
              where: { id: returnItem.invoice_itemx_id },
              select: { product_id: true }
            })

            if (invoiceItem?.product_id) {
              await tx.product.update({
                where: { id: invoiceItem.product_id },
                data: { stock: { decrement: returnItem.return_qty } }
              })
            }
          }

          await tx.salex_return_items.deleteMany({ where: { salex_return_id: returnId } })
          await tx.salex_returns.delete({ where: { id: returnId } })
        })
      }
    }

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
