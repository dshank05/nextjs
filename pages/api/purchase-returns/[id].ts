import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
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

    // ✅ Get ALL purchase items from ALL invoices that have returned items
    const purchaseItemIds = returnItems.map(item => item.purchase_item_id)
    const returnedPurchaseItems = await prisma.purchaseitems.findMany({
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
        gst_percentage: true,
        invoice_no: true
      }
    })
    
    // ✅ Get ALL items from ALL invoices (not just returned ones) for edit mode
    const invoiceNos = Array.from(new Set(returnedPurchaseItems.map(pi => pi.invoice_no)))
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
    
    // Keep reference for backward compatibility
    const originalPurchaseItems = allPurchaseItems

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
      const unitPrice = returnItem?.unit_price || originalItem.rate || 0
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
        invoice_date: purchase?.invoice_date ? new Date(purchase.invoice_date * 1000).toISOString().split('T')[0] : ''
      }
    })
    
    // Keep the variable name for backward compatibility
    const returnItemsWithDetails = allItemsWithDetails

    // Get refund allocation history
    const refundAllocations = await prisma.refund_allocations.findMany({
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

    // Calculate refund summary
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
          invoice_date: purchaseForBill?.invoice_date ? new Date(purchaseForBill.invoice_date * 1000).toISOString().split('T')[0] : '',
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

    // Get existing return before transaction to check payment status change
    const existingReturn = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        payment_status: true,
        payment_mode: true,
        debit_note_no: true,
        vendor_id: true,
        fy: true,
        total_amount: true,
        total_tax: true
      }
    })

    if (!existingReturn) {
      return res.status(404).json({ message: 'Return not found' })
    }

    // ✅ Block editing if refunded
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
      const currentReturnItems = await tx.purchase_return_items.findMany({
        where: { purchase_return_id: returnId },
        select: { 
          purchase_item_id: true, 
          return_qty: true
        }
      })

      // Get current return
      const currentReturn = await tx.purchase_returns.findUnique({
        where: { id: returnId },
        select: { total_amount: true, total_tax: true }
      })

      if (!currentReturn) {
        throw new Error('Return not found')
      }

      // Calculate new totals and process items
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
          tax_amount: taxAmount,
          cgst,
          sgst,
          igst,
          return_reason_id: item.return_reason_id,
          notes: item.notes || ''
        }
      })

      // Pre-calculate NET stock adjustments (like invoice API pattern)
      const stockAdjustments = new Map<number, number>()

      // Get all purchase_item_ids (old + new)
      const allPurchaseItemIds = [
        ...currentReturnItems.map(item => item.purchase_item_id),
        ...processedItems.map(item => item.purchase_item_id)
      ]
      const uniquePurchaseItemIds = Array.from(new Set(allPurchaseItemIds))

      // Fetch product_ids for all items in one query
      const purchaseItems = await tx.purchaseitems.findMany({
        where: { id: { in: uniquePurchaseItemIds } },
        select: { id: true, product_id: true }
      })
      const purchaseItemMap = new Map(purchaseItems.map(pi => [pi.id, pi.product_id]))

      // Calculate reversals for old return items (add back to stock)
      for (const oldItem of currentReturnItems) {
        const productId = purchaseItemMap.get(oldItem.purchase_item_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment + oldItem.return_qty)
        }
      }

      // Calculate deductions for new return items (remove from stock)
      for (const newItem of processedItems) {
        const productId = purchaseItemMap.get(newItem.purchase_item_id)
        if (productId) {
          const currentAdjustment = stockAdjustments.get(productId) || 0
          stockAdjustments.set(productId, currentAdjustment - newItem.return_qty)
        }
      }

      // Execute all stock adjustments in parallel using Promise.all
      const stockUpdatePromises = Array.from(stockAdjustments.entries())
        .filter(([_, adjustment]) => adjustment !== 0) // Skip if no net change
        .map(([productId, adjustment]) =>
          tx.product.update({
            where: { id: productId },
            data: { stock: { increment: adjustment } }
          })
        )

      // Delete old items and update stock in parallel
      const [deleteResult] = await Promise.all([
        tx.purchase_return_items.deleteMany({ where: { purchase_return_id: returnId } }),
        ...stockUpdatePromises
      ])

      // Update return record and create new items in parallel
      const pfAmount = packing_forwarding_amount || 0
      const refundAmount = totalAmount + totalTax + pfAmount
      const [updatedReturn] = await Promise.all([
        tx.purchase_returns.update({
          where: { id: returnId },
          data: {
            return_date: return_date ? Math.floor(new Date(return_date).getTime() / 1000) : undefined,
            total_amount: totalAmount,
            total_tax: totalTax,
            refund_amount: refundAmount,
            packing_forwarding_amount: pfAmount,
            notes: notes || '',
            payment_status: payment_status !== undefined ? parseInt(payment_status) : undefined,
            payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : undefined,
            payment_date: payment_date ? parseInt(payment_date) : undefined,
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
      // Get the return record to find purchase_id
      const returnWithPurchase = await tx.purchase_returns.findUnique({
        where: { id: returnId },
        select: { purchase_id: true }
      })

      if (returnWithPurchase?.purchase_id) {
        // Get purchase details
        const purchaseRecord = await tx.purchase.findUnique({
          where: { id: returnWithPurchase.purchase_id },
          select: { invoice_no: true }
        })

        if (purchaseRecord) {
          // Get all items for this purchase
          const allPurchaseItems = await tx.purchaseitems.findMany({
            where: { invoice_no: purchaseRecord.invoice_no },
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

          // Update return_status on purchase
          await tx.purchase.update({
            where: { id: returnWithPurchase.purchase_id },
            data: { return_status: returnStatus }
          })
        }
      }

      return updatedReturn
    }, {
      timeout: 10000 // 10 second timeout for the transaction
    })

    // ✅ FIX: Update DEBIT_NOTE ledger entry if amount changed (outside transaction)
    const amountChanged = 
      result.total_amount !== existingReturn.total_amount || 
      result.total_tax !== existingReturn.total_tax

    if (amountChanged) {
      // Update the DEBIT_NOTE ledger entry with new amount
      await ledgerService.updateDebitNoteEntry({
        vendor_id: existingReturn.vendor_id,
        reference_id: returnId,
        reference_no: existingReturn.debit_note_no || '',
        new_total_amount: result.total_amount,
        new_total_tax: result.total_tax,
        fy: existingReturn.fy
      })
    }

    // Create ledger entry if payment status changed from unpaid to paid (OUTSIDE TRANSACTION)
    if (existingReturn.payment_status === 0 && payment_status === 1) {
      const finalRefundAmount = result.refund_amount || (result.total_amount + result.total_tax)
      
      await ledgerService.createEntry({
        vendor_id: existingReturn.vendor_id,
        transaction_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
        transaction_type: 'REFUND_RECEIVED',
        reference_type: 'purchase_return',
        reference_id: returnId,
        reference_no: existingReturn.debit_note_no || '',
        debit: finalRefundAmount,
        credit: 0,
        payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : 1,
        payment_status: 1,
        payment_date: payment_date ? parseInt(payment_date) : null,
        notes: `Refund received for ${existingReturn.debit_note_no}`,
        fy: existingReturn.fy
      }, prisma)

      // ✅ CREATE REFUND ALLOCATION RECORDS
      const refund = await prisma.vendor_refunds.create({
        data: {
          vendor_id: existingReturn.vendor_id,
          refund_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
          refund_amount: finalRefundAmount,
          refund_mode: payment_mode !== undefined ? parseInt(payment_mode) : 1,
          refund_type: 'RETURN_SPECIFIC',
          notes: `Refund for return ${existingReturn.debit_note_no}`,
          fy: existingReturn.fy
        }
      });
      
      await prisma.refund_allocations.create({
        data: {
          refund_id: refund.id,
          return_id: returnId,
          allocated_amount: finalRefundAmount,
          allocation_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
          notes: 'Allocated during return edit'
        }
      });
    }

    // ✅ HANDLE PAYMENT STATUS CHANGE FROM PAID TO UNPAID (REVERSAL)
    if (existingReturn.payment_status === 1 && payment_status === 0) {
      // Delete refund allocations
      const allocations = await prisma.refund_allocations.findMany({
        where: { return_id: returnId },
        select: { refund_id: true }
      });
      
      await prisma.refund_allocations.deleteMany({
        where: { return_id: returnId }
      });
      
      // Delete vendor_refunds if no other allocations exist
      for (const alloc of allocations) {
        const remainingAllocs = await prisma.refund_allocations.count({
          where: { refund_id: alloc.refund_id }
        });
        
        if (remainingAllocs === 0) {
          await prisma.vendor_refunds.delete({
            where: { id: alloc.refund_id }
          });
        }
      }
      
      // Create REFUND_REVERSAL ledger entry (OUTSIDE TRANSACTION)
      const refundEntry = await prisma.vendor_ledger.findFirst({
        where: {
          reference_type: 'purchase_return',
          reference_id: returnId,
          transaction_type: 'REFUND_RECEIVED'
        },
        orderBy: { id: 'desc' }
      });
      
      if (refundEntry) {
        await ledgerService.createEntry({
          vendor_id: existingReturn.vendor_id,
          transaction_date: Math.floor(Date.now() / 1000),
          transaction_type: 'REFUND_REVERSAL',
          reference_type: 'purchase_return',
          reference_id: returnId,
          reference_no: existingReturn.debit_note_no || '',
          debit: 0,
          credit: refundEntry.debit,
          payment_mode: existingReturn.payment_mode,
          payment_status: 0,
          notes: `Refund reversed for ${existingReturn.debit_note_no} - unmarked as unpaid`,
          fy: existingReturn.fy
        }, prisma);
      }
    }

    // ✅ NEW CASE 1: PARTIAL (2) → PAID (1) - Mark remaining as refunded
    if (existingReturn.payment_status === 2 && payment_status === 1) {
      // Get existing refund allocations
      const existingAllocations = await prisma.refund_allocations.findMany({
        where: { return_id: returnId },
        select: { allocated_amount: true }
      });
      
      const totalAllocated = existingAllocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount),
        0
      );
      
      const finalRefundAmount = result.refund_amount || (result.total_amount + result.total_tax);
      const remainingAmount = finalRefundAmount - totalAllocated;
      
      // FIRST: Handle amount change if it occurred before marking as refunded
      if (amountChanged) {
        const oldTotal = existingReturn.total_amount + existingReturn.total_tax;
        const newTotal = result.total_amount + result.total_tax;
        const difference = newTotal - oldTotal;
        
        await ledgerService.createEntry({
          vendor_id: existingReturn.vendor_id,
          transaction_date: Math.floor(Date.now() / 1000),
          transaction_type: 'PURCHASE_ADJUSTMENT',
          reference_type: 'purchase_return',
          reference_id: returnId,
          reference_no: existingReturn.debit_note_no || '',
          debit: difference < 0 ? Math.abs(difference) : 0,
          credit: difference > 0 ? difference : 0,
          notes: `Return ${existingReturn.debit_note_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (before marking as fully refunded)`,
          fy: existingReturn.fy
        }, prisma);
      }
      
      // SECOND: Create REFUND_RECEIVED entry for remaining amount
      await ledgerService.createEntry({
        vendor_id: existingReturn.vendor_id,
        transaction_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
        transaction_type: 'REFUND_RECEIVED',
        reference_type: 'purchase_return',
        reference_id: returnId,
        reference_no: existingReturn.debit_note_no || '',
        debit: remainingAmount,
        credit: 0,
        payment_mode: payment_mode !== undefined ? parseInt(payment_mode) : 1,
        payment_status: 1,
        payment_date: payment_date ? parseInt(payment_date) : null,
        notes: `Refund for remaining amount ₹${remainingAmount} for ${existingReturn.debit_note_no} (marked as fully refunded)`,
        fy: existingReturn.fy
      }, prisma);

      // THIRD: Create refund allocation for remaining amount
      const refund = await prisma.vendor_refunds.create({
        data: {
          vendor_id: existingReturn.vendor_id,
          refund_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
          refund_amount: remainingAmount,
          refund_mode: payment_mode !== undefined ? parseInt(payment_mode) : 1,
          refund_type: 'RETURN_SPECIFIC',
          notes: `Refund for remaining amount on return ${existingReturn.debit_note_no}`,
          fy: existingReturn.fy
        }
      });
      
      await prisma.refund_allocations.create({
        data: {
          refund_id: refund.id,
          return_id: returnId,
          allocated_amount: remainingAmount,
          allocation_date: payment_date ? parseInt(payment_date) : Math.floor(Date.now() / 1000),
          notes: 'Allocated during return edit (partial to refunded)'
        }
      });
    }

    // ✅ NEW CASE 2: PARTIAL (2) → UNPAID (0) - Unmark all refunds
    if (existingReturn.payment_status === 2 && payment_status === 0) {
      // Get all refund allocations to reverse
      const allocations = await prisma.refund_allocations.findMany({
        where: { return_id: returnId },
        select: { allocated_amount: true, refund_id: true }
      });
      
      const totalAllocated = allocations.reduce(
        (sum, alloc) => sum + Number(alloc.allocated_amount),
        0
      );
      
      // FIRST: Create REFUND_REVERSAL to reverse all refunds
      await ledgerService.createEntry({
        vendor_id: existingReturn.vendor_id,
        transaction_date: Math.floor(Date.now() / 1000),
        transaction_type: 'REFUND_REVERSAL',
        reference_type: 'purchase_return',
        reference_id: returnId,
        reference_no: existingReturn.debit_note_no || '',
        debit: 0,
        credit: totalAllocated,
        payment_mode: existingReturn.payment_mode,
        payment_status: 0,
        notes: `All refunds (₹${totalAllocated}) reversed for ${existingReturn.debit_note_no} - unmarked as unpaid`,
        fy: existingReturn.fy
      }, prisma);

      // SECOND: Delete refund allocations
      await prisma.refund_allocations.deleteMany({
        where: { return_id: returnId }
      });
      
      // Delete vendor_refunds if no other allocations exist
      for (const alloc of allocations) {
        const remainingAllocs = await prisma.refund_allocations.count({
          where: { refund_id: alloc.refund_id }
        });
        
        if (remainingAllocs === 0) {
          await prisma.vendor_refunds.delete({
            where: { id: alloc.refund_id }
          });
        }
      }
      
      // THIRD: Handle amount change if it occurred when unmarking
      if (amountChanged) {
        const oldTotal = existingReturn.total_amount + existingReturn.total_tax;
        const newTotal = result.total_amount + result.total_tax;
        const difference = newTotal - oldTotal;
        
        await ledgerService.createEntry({
          vendor_id: existingReturn.vendor_id,
          transaction_date: Math.floor(Date.now() / 1000),
          transaction_type: 'PURCHASE_ADJUSTMENT',
          reference_type: 'purchase_return',
          reference_id: returnId,
          reference_no: existingReturn.debit_note_no || '',
          debit: difference < 0 ? Math.abs(difference) : 0,
          credit: difference > 0 ? difference : 0,
          notes: `Return ${existingReturn.debit_note_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (after unmarking)`,
          fy: existingReturn.fy
        }, prisma);
      }
    }

    // ✅ NEW CASE 3: PARTIAL (2) → PARTIAL (2) - Amount change while partially refunded
    if (existingReturn.payment_status === 2 && payment_status === 2 && amountChanged) {
      const oldTotal = existingReturn.total_amount + existingReturn.total_tax;
      const newTotal = result.total_amount + result.total_tax;
      const difference = newTotal - oldTotal;
      
      // Create PURCHASE_ADJUSTMENT entry for return amount change
      await ledgerService.createEntry({
        vendor_id: existingReturn.vendor_id,
        transaction_date: Math.floor(Date.now() / 1000),
        transaction_type: 'PURCHASE_ADJUSTMENT',
        reference_type: 'purchase_return',
        reference_id: returnId,
        reference_no: existingReturn.debit_note_no || '',
        debit: difference < 0 ? Math.abs(difference) : 0,
        credit: difference > 0 ? difference : 0,
        notes: `Return ${existingReturn.debit_note_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (partially refunded)`,
        fy: existingReturn.fy
      }, prisma);
    }

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

    // ✅ GET RETURN INFO BEFORE DELETION
    const returnRecord = await prisma.purchase_returns.findUnique({
      where: { id: returnId },
      select: {
        vendor_id: true,
        debit_note_no: true,
        payment_status: true
      }
    });

    if (!returnRecord) {
      return res.status(404).json({ message: 'Return not found' })
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

    // ✅ CLEAN UP LEDGER ENTRIES AND REFUND ALLOCATIONS (outside transaction)
    // Delete refund allocations if return was refunded
    if (returnRecord.payment_status === 1) {
      const allocations = await prisma.refund_allocations.findMany({
        where: { return_id: returnId },
        select: { refund_id: true }
      });
      
      await prisma.refund_allocations.deleteMany({
        where: { return_id: returnId }
      });
      
      // Delete vendor_refunds if no other allocations exist
      for (const alloc of allocations) {
        const remainingAllocs = await prisma.refund_allocations.count({
          where: { refund_id: alloc.refund_id }
        });
        
        if (remainingAllocs === 0) {
          await prisma.vendor_refunds.delete({
            where: { id: alloc.refund_id }
          });
        }
      }
    }

    // Delete ledger entries for this return
    await prisma.vendor_ledger.deleteMany({
      where: {
        reference_type: 'purchase_return',
        reference_id: returnId
      }
    });

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
