import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { transactionHandler } from '../../../lib/transaction-handler'
import { balanceHandler } from '../../../lib/balance-handler'
import { ledgerService } from '../../../lib/ledger-service'

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
        packing_forwarding_amount: true,
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

    // ⚡ PERFORMANCE: Parallelize all independent queries
    const [returnItems, refundAllocations] = await Promise.all([
      // Get return items with product details
      prisma.purchase_return_items.findMany({
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
      }),
      // Get refund allocation history in parallel
      prisma.refund_allocations.findMany({
        where: { return_id: returnId },
        include: {
          refund: {
            select: {
              id: true,
              refund_date: true,
              refund_amount: true,
              refund_mode: true,
              refund_type: true,
              notes: true,
              created_at: true
            }
          }
        },
        orderBy: {
          allocation_date: 'desc'
        }
      })
    ])

    // ✅ FIX BUG #4: Get ALL items from ALL invoices (not just returned ones)
    const purchaseItemIds = returnItems.map(item => item.purchase_item_id)
    
    // ⚡ PERFORMANCE: Fetch invoice numbers and get returned quantities in parallel
    const [returnedPurchaseItems, returnedQuantities] = await Promise.all([
      // Get the invoice numbers from returned items
      prisma.purchaseitems.findMany({
        where: {
          id: { in: purchaseItemIds }
        },
        select: {
          invoice_no: true
        }
      }),
      // Get already returned quantities (excluding current return) - run in parallel
      prisma.purchase_return_items.groupBy({
        by: ['purchase_item_id'],
        where: {
          purchase_item_id: { in: purchaseItemIds },
          purchase_return_id: { not: returnId }
        },
        _sum: {
          return_qty: true
        }
      })
    ])
    
    // Get ALL invoice numbers (unique)
    const invoiceNos = Array.from(new Set(returnedPurchaseItems.map(pi => pi.invoice_no)))
    
    // ⚡ PERFORMANCE: Fetch ALL items from invoices first
    const allPurchaseItems = await prisma.purchaseitems.findMany({
      where: {
        invoice_no: { in: invoiceNos }
      },
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
    
    // Get all product IDs we need
    const productIds = Array.from(new Set(allPurchaseItems.map(item => item.product_id).filter(Boolean)))
    
    // Fetch all products in one query
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
    
    // Keep reference for backward compatibility
    const originalPurchaseItems = allPurchaseItems

    // Create lookup maps
    const productMap = new Map(products.map(p => [p.id, p]))
    const returnedQtyMap = new Map(
      returnedQuantities.map(item => [item.purchase_item_id, item._sum.return_qty || 0])
    )

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

    // ✅ NEW: Build ALL purchase items with return status (not just returned ones)
    // Create a map of return items for quick lookup
    const returnItemsMap = new Map(returnItems.map(item => [item.purchase_item_id, item]))
    
    const allItemsWithDetails = originalPurchaseItems.map(originalItem => {
      const product = productMap.get(originalItem.product_id)
      const returnItem = returnItemsMap.get(originalItem.id)
      const alreadyReturned = returnedQtyMap.get(originalItem.id) || 0
      const availableQty = (originalItem.qty || 0) - alreadyReturned

      // If this item was returned, use the return data; otherwise set return_qty to 0
      const returnQty = returnItem?.return_qty || 0
      // ✅ FIX: Handle ₹0 price correctly - don't fallback if price is explicitly 0
      const unitPrice = returnItem !== undefined ? returnItem.unit_price : (originalItem.rate || 0)
      const taxRate = originalItem.gst_percentage || 0
      
      // Calculate tax for the returned quantity
      const subtotal = returnQty * unitPrice
      const taxAmount = returnItem?.tax_amount || 0

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
        id: originalItem.id.toString(),
        purchase_item_id: originalItem.id,
        product_id: originalItem.product_id || 0,
        product_name: product?.display_name || originalItem.name_of_product || 'Unknown Product',
        display_name: product?.display_name || originalItem.name_of_product,
        part_number: product?.part_no || originalItem.part,
        original_qty: originalItem.qty || 0, // Original purchase quantity
        available_qty: Math.max(0, availableQty), // Available for return (excluding current return since it's in returnedQtyMap)
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
        bill_reference: purchase?.invoice_no?.toString() || 'N/A',
        invoice_date: purchase?.invoice_date ? (() => {
          const date = new Date(purchase.invoice_date * 1000);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        })() : ''
      }
    })
    
    // Keep the variable name for backward compatibility
    const returnItemsWithDetails = allItemsWithDetails

    // Calculate refund summary (refundAllocations already fetched in parallel above)
    const totalRefunded = refundAllocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    )
    const totalReturn = returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax)
    const remainingAmount = totalReturn - totalRefunded

    // Format refund history
    const refundHistory = refundAllocations.map(alloc => ({
      allocation_id: alloc.id,
      refund_id: alloc.refund_id,
      allocated_amount: Number(alloc.allocated_amount),
      allocation_date: alloc.allocation_date,
      allocation_notes: alloc.notes,
      refund_date: alloc.refund.refund_date,
      refund_amount: Number(alloc.refund.refund_amount),
      refund_mode: alloc.refund.refund_mode,
      refund_mode_text: alloc.refund.refund_mode === 0 ? 'Cash' : 'Bank',
      refund_type: alloc.refund.refund_type,
      refund_notes: alloc.refund.notes,
      created_at: alloc.refund.created_at
    }))

    // ✅ Group items by invoice_no to show multiple bills
    const billsMap = new Map<number, any>()
    
    for (const item of returnItemsWithDetails) {
      const invoiceNo = originalPurchaseItems.find(pi => pi.id === item.purchase_item_id)?.invoice_no
      
      if (!invoiceNo) continue
      
      if (!billsMap.has(invoiceNo)) {
        // Get purchase details for this invoice
        const purchaseForBill = await prisma.purchase.findFirst({
          where: { invoice_no: invoiceNo },
          select: {
            id: true,
            invoice_no: true,
            invoice_date: true
          }
        })
        
        billsMap.set(invoiceNo, {
          id: purchaseForBill?.id?.toString() || invoiceNo.toString(),
          invoice_no: invoiceNo.toString(),
          bill_reference: invoiceNo.toString(),
          invoice_date: purchaseForBill?.invoice_date ? (() => {
            const date = new Date(purchaseForBill.invoice_date * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          })() : '',
          total_amount: 0,
          has_tax: (returnRecord.total_tax || 0) > 0,
          available_items: 0,
          total_items: 0,
          items: []
        })
      }
      
      const bill = billsMap.get(invoiceNo)
      bill.items.push(item)
      bill.available_items++
      bill.total_items++
      bill.total_amount += (item.return_qty * item.unit_price) + item.tax_amount
    }
    
    const bills = Array.from(billsMap.values())

    const response = {
      return: {
        id: returnRecord.id,
        return_no: `PR-${String(returnRecord.id).padStart(3, '0')}`,
        return_date: formattedReturnDate,
        total_amount: returnRecord.total_amount,
        total_tax: returnRecord.total_tax,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        packing_forwarding_amount: returnRecord.packing_forwarding_amount || 0,
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
        total_bills: bills.length,
        total_items: returnItems.length, // Count of actual returned items
        total_value: returnRecord.total_amount
      },
      refund_summary: {
        total_return: totalReturn,
        total_refunded: totalRefunded,
        remaining_amount: remainingAmount,
        refund_count: refundAllocations.length,
        is_fully_refunded: totalRefunded >= totalReturn,
        is_partially_refunded: totalRefunded > 0 && totalRefunded < totalReturn
      },
      refund_history: refundHistory
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
    const { return_date, notes, items, payment_status, payment_mode, payment_date, packing_forwarding_amount } = req.body

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: 'Valid return ID is required' })
    }

    const returnId = parseInt(id)
    if (isNaN(returnId)) {
      return res.status(400).json({ message: 'Invalid return ID format' })
    }

    // Get existing return
    const existingReturn = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        payment_status: true,
        payment_mode: true,
        debit_note_no: true,
        vendor_id: true,
        return_date: true,  // ✅ Add for date change detection
        fy: true,
        total_amount: true,
        total_tax: true,
        refund_amount: true
      }
    })

    if (!existingReturn) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // Check if Type A (has refund allocations) or Type B (marked as refunded during creation)
    const existingAllocations = await prisma.refund_allocations.findMany({
      where: { return_id: returnId },
      select: { allocated_amount: true }
    })
    
    const isTypeA = existingAllocations.length > 0

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      let finalPaymentStatus = payment_status !== undefined ? parseInt(payment_status.toString()) : existingReturn.payment_status
      
      // Calculate totals
      let totalAmount = 0
      let totalTax = 0

      const processedItems = items.map((item: any) => {
        const subtotal = item.return_qty * item.unit_price
        const taxAmount = (subtotal * item.tax_rate) / 100

        const BUSINESS_STATE_CODE = 9
        let cgst = 0, sgst = 0, igst = 0
        if (item.vendor_state_code === BUSINESS_STATE_CODE) {
          cgst = taxAmount / 2
          sgst = taxAmount / 2
        } else {
          igst = taxAmount
        }

        totalAmount += subtotal
        totalTax += taxAmount

        return {
          purchase_item_id: parseInt(item.purchase_item_id),
          return_qty: item.return_qty,
          unit_price: item.unit_price,
          tax_amount: taxAmount,
          cgst,
          sgst,
          igst,
          return_reason_id: item.return_reason_id,
          notes: item.notes || ''
        }
      })

      const pfAmount = parseFloat((packing_forwarding_amount || 0).toString())
      const newTotal = totalAmount + totalTax + pfAmount

      // For Type A returns, calculate status from allocations
      if (isTypeA) {
        const totalAllocated = existingAllocations.reduce(
          (sum, alloc) => sum + Number(alloc.allocated_amount),
          0
        )
        
        if (totalAllocated >= newTotal) {
          finalPaymentStatus = 1
        } else if (totalAllocated > 0) {
          finalPaymentStatus = 2
        } else {
          finalPaymentStatus = 0
        }
      }

      // Get current return items for stock adjustment
      const currentReturnItems = await tx.purchase_return_items.findMany({
        where: { purchase_return_id: returnId },
        select: { purchase_item_id: true, return_qty: true }
      })

      // Calculate NET stock adjustments
      const stockAdjustments = new Map<number, number>()

      const allPurchaseItemIds = [
        ...currentReturnItems.map(item => item.purchase_item_id),
        ...processedItems.map(item => item.purchase_item_id)
      ]
      const uniquePurchaseItemIds = Array.from(new Set(allPurchaseItemIds))

      const purchaseItems = await tx.purchaseitems.findMany({
        where: { id: { in: uniquePurchaseItemIds } },
        select: { id: true, product_id: true }
      })
      const purchaseItemMap = new Map(purchaseItems.map(pi => [pi.id, pi.product_id]))

      // Reversals for old items (add back to stock)
      for (const oldItem of currentReturnItems) {
        const productId = purchaseItemMap.get(oldItem.purchase_item_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment + oldItem.return_qty)
        }
      }

      // Deductions for new items (remove from stock)
      for (const newItem of processedItems) {
        const productId = purchaseItemMap.get(newItem.purchase_item_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment - newItem.return_qty)
        }
      }

      // Execute stock adjustments in parallel
      const stockUpdatePromises = Array.from(stockAdjustments.entries())
        .filter(([_, adjustment]) => adjustment !== 0)
        .map(([productId, adjustment]) =>
          tx.product.update({
            where: { id: productId },
            data: { stock: { increment: adjustment } }
          })
        )

      // Delete old items and update stock in parallel
      await Promise.all([
        tx.purchase_return_items.deleteMany({ where: { purchase_return_id: returnId } }),
        ...stockUpdatePromises
      ])

      // Update return record and create new items in parallel
      const refundAmount = totalAmount + totalTax + pfAmount
      const [updatedReturn] = await Promise.all([
        tx.purchase_returns.update({
          where: { id: returnId },
          data: {
            return_date: return_date ? Math.floor(new Date(return_date + 'T12:00:00').getTime() / 1000) : undefined,
            total_amount: totalAmount,
            total_tax: totalTax,
            refund_amount: parseFloat(refundAmount.toString()),
            packing_forwarding_amount: pfAmount,
            notes: notes || '',
            payment_status: finalPaymentStatus,
            payment_mode: payment_mode !== undefined ? parseInt(payment_mode.toString()) : undefined,
            payment_date: payment_date ? parseInt(payment_date.toString()) : undefined,
            updated_at: new Date()
          }
        }),
        tx.purchase_return_items.createMany({
          data: processedItems.map(item => ({
            purchase_return_id: returnId,
            ...item
          }))
        })
      ])

        // Recalculate return_status for affected purchases
        const returnWithPurchase = await tx.purchase_returns.findUnique({
          where: { id: returnId },
          select: { purchase_id: true }
        })

        if (returnWithPurchase?.purchase_id) {
          const purchaseRecord = await tx.purchase.findUnique({
            where: { id: returnWithPurchase.purchase_id },
            select: { invoice_no: true }
          })

          if (purchaseRecord) {
            const allPurchaseItems = await tx.purchaseitems.findMany({
              where: { invoice_no: purchaseRecord.invoice_no },
              select: { id: true, qty: true }
            })

            const allReturns = await tx.purchase_return_items.findMany({
              where: { purchase_item_id: { in: allPurchaseItems.map(pi => pi.id) } },
              select: { purchase_item_id: true, return_qty: true }
            })

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

            const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allPurchaseItems.length ? 2 : 1)

            await tx.purchase.update({
              where: { id: returnWithPurchase.purchase_id },
              data: { return_status: returnStatus }
            })
          }
        }

      // ✅ USE TRANSACTION HANDLER FOR ALL LEDGER/ALLOCATION/BALANCE OPERATIONS
      // ✅ REFACTORED: Handler now handles DEBIT_NOTE checks and updates internally
      const oldPaymentStatus = existingReturn.payment_status
      const newPaymentStatus = finalPaymentStatus
      const oldTotal = (existingReturn.total_amount || 0) + (existingReturn.total_tax || 0)

      // ✅ Calculate final return date (like purchase PUT)
      const finalReturnDate = return_date
        ? Math.floor(new Date(return_date + 'T12:00:00').getTime() / 1000)
        : existingReturn.return_date

      const dateChanged = return_date && finalReturnDate !== existingReturn.return_date

      // ✅ DIRECTLY UPDATE DEBIT_NOTE when date changes (like purchase)
      if (dateChanged) {
        await tx.vendor_ledger.updateMany({
          where: {
            vendor_id: existingReturn.vendor_id,
            reference_type: 'purchase_return',
            reference_id: returnId,
            transaction_type: 'DEBIT_NOTE'
          },
          data: {
            transaction_date: finalReturnDate
          }
        })
      }

      const totalAllocated = existingAllocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount),
        0
      )

      // ✅ FETCH VENDOR BALANCE FOR SMART ADVANCE REFUND ALLOCATION
      const vendor = await tx.vendor_details.findUnique({
        where: { id: existingReturn.vendor_id },
        select: {
          total_paid: true,
          total_allocated: true,
          total_refunded: true,
          total_refund_allocated: true
        }
      });

        // ✅ Get all operations from handler (now handles DEBIT_NOTE logic internally)
        const handlerResult = await transactionHandler.handleReturnEdit({
          oldStatus: oldPaymentStatus,
          newStatus: newPaymentStatus,
          oldTotal: oldTotal,
          newTotal: newTotal,
          vendorId: existingReturn.vendor_id,
          returnId: returnId,
          debitNoteNo: existingReturn.debit_note_no || '',
          paymentMode: payment_mode !== undefined ? parseInt(payment_mode.toString()) : existingReturn.payment_mode,
          paymentDate: payment_date ? parseInt(payment_date.toString()) : Math.floor(Date.now() / 1000),
          returnDate: finalReturnDate,  // ✅ Pass return_date (not payment_date) for DEBIT_NOTE
          fy: existingReturn.fy,
          totalAllocated: totalAllocated,
          totalAmount: totalAmount,  // ✅ Pass for DEBIT_NOTE updates
          totalTax: totalTax,        // ✅ Pass for DEBIT_NOTE updates
          tx: tx,                    // ✅ Pass transaction context
          currentBalance: vendor ? {
            total_paid: Number(vendor.total_paid),
            total_allocated: Number(vendor.total_allocated),
            total_refunded: Number(vendor.total_refunded),
            total_refund_allocated: Number(vendor.total_refund_allocated)
          } : undefined
        })

      // Execute all operations (ledger, allocations, balance) in transaction
      await transactionHandler.executeInTransaction(tx, handlerResult)

      return updatedReturn
    }, {
      timeout: 45000 // 45 seconds timeout for complex return edit processing
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

    // Get return info before deletion
    const returnRecord = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        vendor_id: true,
        payment_status: true
      }
    })

    if (!returnRecord) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // Get delete operations from handler
    const deleteOps = await transactionHandler.handleReturnDelete({
      returnId,
      vendorId: returnRecord.vendor_id,
      paymentStatus: returnRecord.payment_status
    })

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      await transactionHandler.executeDeleteInTransaction(tx, deleteOps)
    }, {
      timeout: 45000
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
