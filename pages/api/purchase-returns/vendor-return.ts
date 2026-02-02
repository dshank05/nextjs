import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { generateNoteNumber } from '../../../lib/note-counter'
import { ledgerService } from '../../../lib/ledger-service'
import { balanceHandler } from '../../../lib/balance-handler'

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
      payment_status, // ✅ FIXED: Use payment_status (0=Incomplete, 1=Complete)
      payment_mode, // 0=Cash, 1=Bank
      packing_forwarding_amount, // Manual P&F amount from UI
      items // Array of { purchase_item_id, return_qty, return_reason_id, unit_price, tax_rate, notes? }
    } = req.body

    // Validation
    if (!vendor_id || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Vendor ID and items are required'
      })
    }

    // ✅ Validate quantities and stock
    const returnQtyByProduct = new Map<number, number>();
    const purchaseItemIds = items.map((item: any) => parseInt(item.purchase_item_id));

    // Get purchase items to get product_ids
    const purchaseItemsForValidation = await prisma.purchaseitems.findMany({
      where: { id: { in: purchaseItemIds } },
      select: {
        id: true,
        product_id: true
      }
    });

    // Get unique product IDs
    const productIds = Array.from(new Set(purchaseItemsForValidation.map(pi => pi.product_id).filter(Boolean)));
    
    // Fetch product details
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        stock: true,
        product_name: true
      }
    });

    // Build maps
    const itemProductIdMap = new Map(
      purchaseItemsForValidation.map(pi => [pi.id, pi.product_id])
    );
    const productMap = new Map(products.map(p => [p.id, p]));

    // Validate each item
    for (const item of items) {
      const purchaseItemId = parseInt(item.purchase_item_id);
      const productId = itemProductIdMap.get(purchaseItemId);
      
      if (!productId) {
        return res.status(400).json({
          message: `Purchase item not found: ${purchaseItemId}`
        });
      }

      const product = productMap.get(productId);
      if (!product) {
        return res.status(400).json({
          message: `Product not found for purchase item ${purchaseItemId}`
        });
      }
      
      // Check negative quantity
      if (item.return_qty < 0) {
        return res.status(400).json({
          message: `Return quantity must be 0 or positive for ${product.product_name}, got: ${item.return_qty}`
        });
      }
      
      // Aggregate by product_id
      const existing = returnQtyByProduct.get(productId) || 0;
      returnQtyByProduct.set(productId, existing + item.return_qty);
    }

    // Check stock for each product
    const returnQtyEntries = Array.from(returnQtyByProduct.entries());
    for (const [productId, totalReturnQty] of returnQtyEntries) {
      const product = productMap.get(productId);
      
      if (product && totalReturnQty > product.stock) {
        return res.status(400).json({
          message: `Cannot return ${totalReturnQty} units of "${product.product_name}". Only ${product.stock} units in stock. (Some units may have been sold)`,
          error_code: 'INSUFFICIENT_STOCK',
          details: {
            product_name: product.product_name,
            requested_qty: totalReturnQty,
            current_stock: product.stock
          }
        });
      }
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert return date to Unix timestamp
    const returnDateTimestamp = return_date ? Math.floor(new Date(return_date + 'T12:00:00').getTime() / 1000) : Math.floor(Date.now() / 1000)

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

    // Use the provided P&F amount from UI (no calculation needed)
    const packingForwardingAmount = packing_forwarding_amount || 0
    const freightAmount = 0 // Not used in new system

    // Calculate refund amount (before transaction for use in ledger entry)
    const refundAmount = totalAmount + totalTax + packingForwardingAmount + freightAmount

    // ✅ Determine payment status from payment_status parameter
    const paymentStatusValue = payment_status !== undefined ? parseInt(payment_status.toString()) : 0 // 0=Incomplete, 1=Complete
    const paymentModeValue = payment_mode !== undefined ? parseInt(payment_mode.toString()) : 1 // 0=Cash, 1=Bank (default)
    const paymentDateValue = paymentStatusValue === 1 ? returnDateTimestamp : null

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

      // Create the main return record with debit note and P&F fields
      // ✅ FIX: Use Prisma relation syntax instead of direct field assignment
      const returnData: any = {
        debit_note_no: debitNoteNo,
        note_type: 'DEBIT',
        vendor: { connect: { id: parseInt(vendor_id) } },
        return_date: returnDateTimestamp,
        total_amount: totalAmount,
        total_tax: totalTax,
        status: 1,
        notes: return_notes || '',
        fy: financialYear,
        payment_status: paymentStatusValue,
        payment_mode: paymentModeValue,
        payment_date: paymentDateValue,
        refund_amount: refundAmount,
        include_packing_forwarding: 0,
        include_freight: 0,
        pf_calculation_method: 3,
        freight_calculation_method: 3,
        packing_forwarding_amount: packingForwardingAmount,
        freight_amount: freightAmount
      };

      // Add purchase relation if available (optional)
      if (affectedPurchases.length > 0) {
        returnData.purchase = { connect: { id: affectedPurchases[0].id } };
      }

      const returnRecord = await tx.purchase_returns.create({
        data: returnData
      })

      // ✅ PARALLEL OPTIMIZATION: Create return items and update stock in parallel
      await Promise.all([
        // Create all return items in bulk
        tx.purchase_return_items.createMany({
          data: processedItems.map(item => ({
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
          }))
        }),
        // Update all product stocks in parallel
        ...processedItems.map(item => {
          const purchaseItem = purchaseItems.find(pi => pi.id === item.purchase_item_id)
          if (purchaseItem?.product_id) {
            return tx.product.update({
              where: { id: purchaseItem.product_id },
              data: {
                stock: {
                  decrement: item.return_qty
                }
              }
            })
          }
          return Promise.resolve()
        })
      ])

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

      // ✅ ONLY CREATE LEDGER ENTRIES WHEN COMPLETE (Issue #6)
      if (paymentStatusValue === 1) {
        // Create ledger entry for debit note
        await ledgerService.createDebitNoteEntry({
          id: returnRecord.id,
          vendor_id: parseInt(vendor_id),
          debit_note_no: debitNoteNo,
          return_date: returnDateTimestamp,
          total_amount: totalAmount,
          total_tax: totalTax,
          packing_forwarding_amount: packingForwardingAmount,
          freight_amount: freightAmount,
          fy: financialYear
        }, tx)

        // ❌ COMMENTED OUT - Issue #6: No REFUND_RECEIVED entry
        // Balance adjusts automatically from DEBIT_NOTE entry only
        // const vendor = await tx.vendor_details.findUnique({
        //   where: { id: parseInt(vendor_id) },
        //   select: {
        //     total_paid: true,
        //     total_allocated: true,
        //     total_refunded: true,
        //     total_refund_allocated: true
        //   }
        // });

        // const balanceOp = balanceHandler.getCreateBalanceOps({
        //   vendorId: parseInt(vendor_id),
        //   total: refundAmount,
        //   currentBalance: vendor ? {
        //     total_paid: Number(vendor.total_paid),
        //     total_allocated: Number(vendor.total_allocated),
        //     total_refunded: Number(vendor.total_refunded),
        //     total_refund_allocated: Number(vendor.total_refund_allocated)
        //   } : undefined,
        //   type: 'RETURN'
        // });

        // const advanceRefundBalance = vendor 
        //   ? Number(vendor.total_refunded) - Number(vendor.total_refund_allocated)
        //   : 0;

        // await ledgerService.createEntry({
        //   vendor_id: parseInt(vendor_id),
        //   transaction_date: paymentDateValue || returnDateTimestamp,
        //   transaction_type: 'REFUND_RECEIVED',
        //   reference_type: 'purchase_return',
        //   reference_id: returnRecord.id,
        //   reference_no: debitNoteNo,
        //   debit: refundAmount,
        //   credit: 0,
        //   payment_mode: paymentModeValue,
        //   payment_status: 1,
        //   payment_date: paymentDateValue,
        //   notes: advanceRefundBalance > 0
        //     ? `Refund for ${debitNoteNo} (₹${advanceRefundBalance >= refundAmount ? refundAmount : advanceRefundBalance} from advance${advanceRefundBalance < refundAmount ? `, ₹${refundAmount - advanceRefundBalance} new refund` : ''})`
        //     : `Refund received for ${debitNoteNo}`,
        //   fy: financialYear
        // }, tx)

        // ❌ COMMENTED OUT - Issue #6: No vendor_refunds record
        // await tx.vendor_refunds.create({
        //   data: {
        //     vendor_id: parseInt(vendor_id),
        //     refund_date: returnDateTimestamp,
        //     refund_amount: refundAmount,
        //     refund_mode: paymentModeValue,
        //     refund_type: 'RETURN_SPECIFIC',
        //     notes: advanceRefundBalance > 0
        //       ? `Refund for return ${debitNoteNo} (using ₹${Math.min(advanceRefundBalance, refundAmount)} advance)`
        //       : `Refund for return ${debitNoteNo}`,
        //     fy: financialYear
        //   }
        // });
        
        // ❌ COMMENTED OUT - Issue #7: Remove separate refund allocation entries
        // Payment adjusts automatically through ledger + balance updates
        // await tx.refund_allocations.create({
        //   data: {
        //     refund_id: refund.id,
        //    te return_id: returnRecord.id,
        //     allocated_amount: refundAmount,
        //     allocation_date: returnDateTimestamp,
        //     notes: 'Allocated during return creation'
        //   }
        // });

        // ❌ COMMENTED OUT - Issue #6: No balance update needed
        // Balance adjusts automatically from DEBIT_NOTE ledger entry
        // if (balanceOp) {
        //   await balanceHandler.incrementBalanceInTransaction(tx, balanceOp.vendorId, balanceOp.update);
        // }
      }

      return returnRecord
    }, {
      timeout: 45000 // 45 seconds timeout for complex return processing
    })

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
