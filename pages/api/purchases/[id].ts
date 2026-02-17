import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { transactionHandler } from '../../../lib/transaction-handler'
import { ledgerService } from '../../../lib/ledger-service'
import { convertDateToTimestamp } from '../../../lib/date-utils'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        // Get the purchase record
        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId }
        })

        if (!purchase) {
          return res.status(404).json({ message: 'Purchase not found' })
        }

        // Get the purchase items for this invoice
        const purchaseItems = await prisma.purchaseitems.findMany({
          where: { invoice_no: purchase.invoice_no }
        })

        // Get display_name for each product
        const productIds = purchaseItems.map(item => item.product_id).filter(id => id !== null)
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, display_name: true }
        })
        const productMap = new Map(products.map(p => [p.id, p.display_name]))

        // Get return status for each purchase item
        const purchaseItemIds = purchaseItems.map(item => item.id)
        const returnItems = await prisma.purchase_return_items.findMany({
          where: { purchase_item_id: { in: purchaseItemIds } },
          include: {
            purchase_return: {
              select: {
                id: true,
                return_date: true,
                status: true
              }
            }
          }
        })

        // Group return items by purchase_item_id and calculate totals
        const returnSummaryMap = new Map<number, {
          returned_qty: number
          return_history: Array<{
            return_id: string
            return_no: string
            qty: number
            date: number
            unit_price: number
            tax_amount: number
            cgst: number
            sgst: number
            igst: number
            reason_id: number
            notes: string
          }>
        }>()

        returnItems.forEach(returnItem => {
          const itemId = returnItem.purchase_item_id
          const existing = returnSummaryMap.get(itemId) || { returned_qty: 0, return_history: [] }

          existing.returned_qty += returnItem.return_qty
          existing.return_history.push({
            return_id: returnItem.purchase_return.id.toString(),
            return_no: `PR-${returnItem.purchase_return.id.toString().padStart(3, '0')}`,
            qty: returnItem.return_qty,
            date: returnItem.purchase_return.return_date,
            unit_price: returnItem.unit_price,
            tax_amount: returnItem.tax_amount,
            cgst: returnItem.cgst || 0,
            sgst: returnItem.sgst || 0,
            igst: returnItem.igst || 0,
            reason_id: returnItem.return_reason_id,
            notes: returnItem.notes || ''
          })

          returnSummaryMap.set(itemId, existing)
        })

        // ✅ CRITICAL FIX: Always fetch bill_to data first (contains inline-edited vendor details)
        let billToData = null;
        if (purchase.invoice_no) {
          billToData = await prisma.bill_to.findUnique({
            where: { invoice_no: purchase.invoice_no }
          });
        }

        // Get complete vendor data - ALWAYS prioritize bill_to over vendor_details
        // The bill_to table contains the vendor details specific to THIS purchase (may be edited inline)
        let vendorData = null
        if (billToData) {
          // Use bill_to data (inline-edited vendor details for this specific purchase)
          vendorData = {
            id: purchase.vendor_id || 0,
            vendor_name: billToData.vendor_name || '',
            address: billToData.address || '',
            tax_id: billToData.gstin || '',
            contact_no: billToData.contact_no || '',
            email: billToData.email || ''
          }
        } else if (purchase.vendor_id && purchase.vendor_id !== 0) {
          // Fallback to vendor_details only if bill_to doesn't exist (backward compatibility)
          vendorData = await prisma.vendor_details.findUnique({
            where: { id: purchase.vendor_id }
          });
        }

        // ✅ Fetch staff details if staff_id exists
        let staffData = null;
        if (purchase.staff_id) {
          staffData = await prisma.staff.findUnique({
            where: { id: purchase.staff_id }
          });
        }

        // Calculate return status for items and purchase
        let fullyReturnedItems = 0
        const itemsWithReturnStatus = purchaseItems.map(item => {
          const returnData = returnSummaryMap.get(item.id) || { returned_qty: 0, return_history: [] }
          const originalQty = item.qty || 0
          const returnedQty = returnData.returned_qty
          const availableQty = Math.max(0, originalQty - returnedQty)
          const isFullyReturned = returnedQty >= originalQty

          if (isFullyReturned) {
            fullyReturnedItems++
          }

          return {
            id: item.id,  // ✅ CRITICAL FIX: Include real database ID
            product_id: item.product_id,
            product_name: item.name_of_product || 'Unknown Product',  // Use name_of_product as product_name
            display_name: item.product_id ? productMap.get(item.product_id) || item.name_of_product : item.name_of_product,
            category_id: item.category_id,
            subcategory_id: item.subcategory_id,
            company_id: item.company_id,
            model_id: item.model_id,
            car_model: item.car_model || '',  // Keep as string for now
            part: item.part || '',  // Use part field
            qty: item.qty,
            rate: item.rate,
            gst_percentage: item.gst_percentage || 0,  // GST percentage applied to item
            cgst: item.cgst || 0,  // CGST amount for item
            sgst: item.sgst || 0,  // SGST amount for item
            igst: item.igst || 0,  // IGST amount for item
            tax: item.tax || 0,  // Total tax amount for item
            total: item.subtotal || (item.qty * item.rate),  // Use subtotal as total
            subtotal: item.subtotal || (item.qty * item.rate),  // Also include subtotal for compatibility
            hsn: item.hsn || '',
            // Return status fields
            original_qty: originalQty,
            returned_qty: returnedQty,
            available_qty: availableQty,
            is_fully_returned: isFullyReturned,
            return_history: returnData.return_history
          }
        })

        // Calculate overall purchase return status
        const hasReturns = fullyReturnedItems > 0 || returnItems.length > 0
        const isFullyReturned = fullyReturnedItems === purchaseItems.length
        const returnStatus = isFullyReturned ? 'FULLY_RETURNED' :
                           hasReturns ? 'PARTIAL_RETURN' : 'NO_RETURNS'

        // Get return transaction details with payment info and bill-specific breakdown
        const uniqueReturnIds = new Set<number>()
        returnItems.forEach(item => {
          uniqueReturnIds.add(item.purchase_return.id)
        })

        const returnTransactions = await prisma.purchase_returns.findMany({
          where: { id: { in: Array.from(uniqueReturnIds) } },
          select: {
            id: true,
            return_date: true,
            total_amount: true,
            total_tax: true,
            refund_amount: true,
            payment_status: true,
            payment_mode: true,
            payment_date: true,
            notes: true
          }
        })

        // Calculate bill-specific amounts for each return
        const returnsWithDetails = await Promise.all(returnTransactions.map(async (ret) => {
          // Get items from THIS bill only
          const thisBillItems = returnItems.filter(item => item.purchase_return.id === ret.id)
          
          // Calculate this bill's totals
          const thisBillAmount = thisBillItems.reduce((sum, item) => {
            const subtotal = item.unit_price * item.return_qty
            return sum + subtotal
          }, 0)
          
          const thisBillTax = thisBillItems.reduce((sum, item) => {
            return sum + (item.tax_amount || 0)
          }, 0)
          
          const thisBillTotal = thisBillAmount + thisBillTax
          const thisBillItemsCount = thisBillItems.length
          
          // Count total bills in this return
          const allReturnItems = await prisma.purchase_return_items.findMany({
            where: { purchase_return_id: ret.id },
            select: { purchase_item_id: true }
          })
          
          const allPurchaseItemIds = allReturnItems.map(item => item.purchase_item_id)
          const purchaseItemsData = await prisma.purchaseitems.findMany({
            where: { id: { in: allPurchaseItemIds } },
            select: { invoice_no: true }
          })
          
          const uniqueBills = new Set(purchaseItemsData.map(item => item.invoice_no))
          const totalBillsCount = uniqueBills.size
          const isMultiBillReturn = totalBillsCount > 1
          
          // Get total items count across all bills
          const totalItemsCount = allReturnItems.length
          
          // Format items from this bill with details
          const itemsDetails = thisBillItems.map(item => {
            const purchaseItem = purchaseItems.find(pi => pi.id === item.purchase_item_id)
            const product = purchaseItem?.product_id ? productMap.get(purchaseItem.product_id) : null
            
            return {
              product_name: purchaseItem?.name_of_product || 'Unknown Product',
              display_name: product || purchaseItem?.name_of_product || 'Unknown Product',
              part_number: purchaseItem?.part || '',
              qty: item.return_qty,
              rate: item.unit_price,
              total: item.unit_price * item.return_qty,
              tax_amount: item.tax_amount || 0,
              cgst: item.cgst || 0,
              sgst: item.sgst || 0,
              igst: item.igst || 0
            }
          })
          
          return {
            id: ret.id,
            return_no: `PR-${ret.id.toString().padStart(3, '0')}`,
            return_date: ret.return_date,
            
            // This bill's portion
            this_bill_amount: thisBillAmount,
            this_bill_tax: thisBillTax,
            this_bill_total: thisBillTotal,
            this_bill_items_count: thisBillItemsCount,
            
            // Full return totals (all bills)
            total_amount: ret.total_amount,
            total_tax: ret.total_tax || 0,
            refund_amount: ret.refund_amount,
            total_items_count: totalItemsCount,
            total_bills_count: totalBillsCount,
            
            // Indicators
            is_multi_bill_return: isMultiBillReturn,
            has_tax: false,  // Returns don't have reverse tax calculation
            
            // Payment info
            payment_status: ret.payment_status,
            payment_mode: ret.payment_mode,
            payment_date: ret.payment_date,
            notes: ret.notes || '',
            
            // Items from this bill only
            items: itemsDetails
          }
        }))

        // Get payment allocation history
        const paymentAllocations = await prisma.payment_allocations.findMany({
          where: { purchase_id: purchaseId },
          include: {
            payment: {
              select: {
                id: true,
                payment_date: true,
                payment_amount: true,
                payment_mode: true,
                payment_type: true,
                notes: true,
                created_at: true
              }
            }
          },
          orderBy: {
            allocation_date: 'desc'
          }
        })

        // Calculate payment summary
        const totalPaid = paymentAllocations.reduce(
          (sum, alloc) => sum + Number(alloc.allocated_amount),
          0
        )
        const remainingAmount = purchase.total - totalPaid

        // Format payment history
        const paymentHistory = paymentAllocations.map(alloc => ({
          allocation_id: alloc.id,
          payment_id: alloc.payment_id,
          allocated_amount: Number(alloc.allocated_amount),
          allocation_date: alloc.allocation_date,
          allocation_notes: alloc.notes,
          payment_date: alloc.payment.payment_date,
          payment_amount: Number(alloc.payment.payment_amount),
          payment_mode: alloc.payment.payment_mode,
          payment_mode_text: alloc.payment.payment_mode === 0 ? 'Cash' : 'Bank',
          payment_type: alloc.payment.payment_type,
          payment_notes: alloc.payment.notes,
          created_at: alloc.payment.created_at
        }))

        // ✅ Transform to POST/PUT compatible structure
        const transformedPurchase = {
          // Main purchase fields - ensure all required fields are populated
          id: purchase.id,
          invoice_number: purchase.invoice_no?.toString() || '',
          bill_reference: purchase.bill_reference || '',
          bill_reference_date: purchase.bill_reference_date ? (() => {
            const date = new Date(purchase.bill_reference_date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          })() : '',
          staff_id: purchase.staff_id || null,
          date: purchase.invoice_date,  // Keep as number for proper formatting
          vendor_id: purchase.vendor_id,
          transport_name: purchase.transport || '',
          vehicle_number: purchase.vehicle_number || '',
          transport_cost: purchase.freight || 0,

          // Financial summary fields - ensure these are populated
          items_total: purchase.items_total || 0,
          total_taxable_value: purchase.total_taxable_value || purchase.items_total || 0,
          total_tax: purchase.total_tax || 0,
          total: purchase.total || (purchase.items_total + (purchase.total_tax || 0)),
          freight: purchase.freight || 0,

          // Transform items to POST structure with return status
          items: itemsWithReturnStatus,

          // Additional fields
          descriptions: purchase.descriptions || '',
          packing_forwarding_qty: purchase.packing_forwarding_qty || 0,
          packing_forwarding_rate: purchase.packing_forwarding_rate || 0,
          packing_forwarding_total: purchase.packing_forwarding_total || 0,

          // Tax summary fields
          total_cgst: purchase.total_cgst || 0,
          total_sgst: purchase.total_sgst || 0,
          total_igst: purchase.total_igst || 0,
          notes: purchase.notes || '',

          // Payment fields
          payment_status: purchase.payment_status ?? 0,
          payment_mode: purchase.payment_mode ?? 0,  // Default to Cash (0), use ?? to preserve 0 value

          // Return status summary
          return_status: {
            has_returns: hasReturns,
            fully_returned_items: fullyReturnedItems,
            total_items: purchaseItems.length,
            is_fully_returned: isFullyReturned,
            status: returnStatus
          },

          // Return transactions with payment details
          returns: returnsWithDetails,

          // Payment allocation summary and history
          payment_summary: {
            total_bill: purchase.total,
            total_paid: totalPaid,
            remaining_amount: remainingAmount,
            payment_count: paymentAllocations.length,
            is_fully_paid: totalPaid >= purchase.total,
            is_partially_paid: totalPaid > 0 && totalPaid < purchase.total
          },
          payment_history: paymentHistory,

          // Metadata
          fy: purchase.fy,
          item_count: purchaseItems.length,

          // Keep original fields for backward compatibility
          formattedDate: purchase.invoice_date,
          vendor: vendorData,
          bill_to: billToData,
          staff: staffData
        }

        res.status(200).json(transformedPurchase)

      } catch (error) {
        console.error('Get purchase error:', error)
        res.status(500).json({ message: 'Failed to fetch purchase', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'PUT':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        const {
          bill_reference,
          bill_reference_date,
          staff_id,
          date,
          vendor_id,
          notes,
          payment_status,
          payment_mode,
          transport_name,
          vehicle_number,
          items,
          total_cgst,
          total_sgst,
          total_igst,
          total_tax,
          transport_cost,
          descriptions,
          packing_forwarding_qty,
          packing_forwarding_rate,
          packing_forwarding_total
        } = req.body

        // Get existing purchase
        const existingPurchase = await prisma.purchase.findUnique({
          where: { id: purchaseId }
        })

        if (!existingPurchase) {
          return res.status(404).json({ message: 'Purchase not found' })
        }

        // ===== BLOCK VENDOR CHANGES =====
        // Vendor changes are not allowed as they would corrupt ledger entries and payment allocations
        if (vendor_id !== undefined && vendor_id !== null && parseInt(vendor_id) !== existingPurchase.vendor_id) {
          return res.status(400).json({
            message: 'Vendor cannot be changed after purchase creation. Please delete and recreate the purchase if needed.',
            error_code: 'VENDOR_CHANGE_NOT_ALLOWED'
          })
        }

        // Validation
        const validPaymentStatuses = [0, 1, 2]
        const validPaymentModes = [0, 1]

        const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
          ? parseInt(payment_status.toString())
          : 0

        const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
          ? parseInt(payment_mode.toString())
          : 1

        if (!validPaymentStatuses.includes(parsedPaymentStatus)) {
          return res.status(400).json({
            message: 'Invalid payment_status: must be 0 (Unpaid), 1 (Paid), or 2 (Partially Paid)'
          })
        }

        if (!validPaymentModes.includes(parsedPaymentMode)) {
          return res.status(400).json({
            message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
          })
        }

        // Check if Type A (has payment allocations) or Type B (marked as paid during creation)
        const existingAllocations = await prisma.payment_allocations.findMany({
          where: { purchase_id: purchaseId },
          select: { allocated_amount: true }
        })
        
        const isTypeA = existingAllocations.length > 0

        // Return validation
        if (existingPurchase.return_status === 2) {
          return res.status(400).json({
            message: 'Cannot edit a fully returned purchase. All items have been returned.',
            error_code: 'FULLY_RETURNED'
          })
        }

        // Validate item-level changes for partial returns
        if (existingPurchase.return_status === 1 && items && Array.isArray(items)) {
          const purchaseItems = await prisma.purchaseitems.findMany({
            where: { invoice_no: existingPurchase.invoice_no },
            select: { id: true, product_id: true, qty: true, name_of_product: true }
          })

          const purchaseItemIds = purchaseItems.map(item => item.id)
          const returnItems = await prisma.purchase_return_items.findMany({
            where: { purchase_item_id: { in: purchaseItemIds } },
            select: { purchase_item_id: true, return_qty: true }
          })

          const returnedQtyMap = new Map<number, number>()
          returnItems.forEach(returnItem => {
            const existingQty = returnedQtyMap.get(returnItem.purchase_item_id) || 0
            returnedQtyMap.set(returnItem.purchase_item_id, existingQty + returnItem.return_qty)
          })

          const productToPurchaseItemMap = new Map(
            purchaseItems.map(item => [item.product_id, { id: item.id, qty: item.qty, name: item.name_of_product }])
          )

          for (const newItem of items) {
            const productId = parseInt(newItem.product_id)
            const purchaseItemData = productToPurchaseItemMap.get(productId)
            
            if (purchaseItemData) {
              const returnedQty = returnedQtyMap.get(purchaseItemData.id) || 0
              
              if (returnedQty > 0 && newItem.qty < returnedQty) {
                return res.status(400).json({
                  message: `Cannot reduce quantity for "${purchaseItemData.name}" to ${newItem.qty}. ${returnedQty} units have already been returned.`,
                  error_code: 'QTY_BELOW_RETURNED',
                  item: {
                    product_name: purchaseItemData.name,
                    returned_qty: returnedQty,
                    requested_qty: newItem.qty
                  }
                })
              }
            }
          }

          const newProductIds = new Set(items.map(item => parseInt(item.product_id)))
          for (const purchaseItem of purchaseItems) {
            if (!newProductIds.has(purchaseItem.product_id)) {
              const returnedQty = returnedQtyMap.get(purchaseItem.id) || 0
              if (returnedQty > 0) {
                return res.status(400).json({
                  message: `Cannot delete "${purchaseItem.name_of_product}". ${returnedQty} units have been returned.`,
                  error_code: 'CANNOT_DELETE_RETURNED_ITEM',
                  item: {
                    product_name: purchaseItem.name_of_product,
                    returned_qty: returnedQty
                  }
                })
              }
            }
          }
        }

        // Start transaction
        const result = await prisma.$transaction(async (tx) => {
          // Calculate totals first
          let calculatedItemsTotal = 0
          let calculatedPackingTotal = 0
          let calculatedTotalTax = 0

          if (items && Array.isArray(items)) {
            calculatedItemsTotal = items.reduce((sum: number, item: any) => {
              return sum + (parseFloat(item.qty || 0) * parseFloat(item.rate || 0))
            }, 0)

            const packingQty = req.body.packing_forwarding_qty ? parseFloat(req.body.packing_forwarding_qty.toString()) : 0
            const packingRate = req.body.packing_forwarding_rate ? parseFloat(req.body.packing_forwarding_rate.toString()) : 0
            calculatedPackingTotal = packingQty * packingRate

            calculatedTotalTax = total_tax ? parseFloat(total_tax.toString()) : 0
          }

          const newTotal = calculatedItemsTotal + calculatedPackingTotal + calculatedTotalTax

          // ✅ Calculate total allocated from existing allocations
          const totalAllocated = existingAllocations.reduce(
            (sum, alloc) => sum + Number(alloc.allocated_amount),
            0
          );

          // ✅ Calculate final payment status
          // UI only sends 0 (Unpaid) or 1 (Paid)
          // Server calculates 2 (Partial) when user sends 1 but allocations don't cover full amount
          let finalPaymentStatus = parsedPaymentStatus;
          
          // If user sends "Paid" (1) and has allocations (Type A), check if they cover the full amount
          if (parsedPaymentStatus === 1 && isTypeA && totalAllocated > 0) {
            if (totalAllocated >= newTotal) {
              finalPaymentStatus = 1;  // Fully Paid
            } else {
              finalPaymentStatus = 2;  // Partially Paid (server overrides!)
            }
          }
          // If user sends "Unpaid" (0), always respect it for deallocation

          // ✅ Calculate final invoice date early (for ledger entries) - TIMEZONE SAFE
          const finalInvoiceDate = date 
            ? convertDateToTimestamp(date)
            : existingPurchase.invoice_date;
          
          const dateChanged = date && finalInvoiceDate !== existingPurchase.invoice_date;

          // ✅ UPDATE purchase ledger entry
          await tx.vendor_ledger.updateMany({
            where: {
              reference_type: 'purchase',
              reference_id: purchaseId,
              transaction_type: 'PURCHASE'  // No more PURCHASE_ADJUSTMENT
            },
            data: {
              transaction_date: finalInvoiceDate
            }
          });
          
          console.log(`[PURCHASE UPDATE] Updated ledger entries for purchase ${purchaseId}, date: ${finalInvoiceDate}, changed: ${dateChanged}`);

          // Update bill_to table
          let existingVendor = null
          if (existingPurchase.vendor_id && existingPurchase.vendor_id !== 0) {
            existingVendor = await tx.vendor_details.findUnique({
              where: { id: existingPurchase.vendor_id }
            })
          }

          await tx.bill_to.upsert({
            where: { invoice_no: existingPurchase.invoice_no },
            update: {
              vendor_name: req.body.vendor_name ?? existingVendor?.vendor_name ?? '',
              contact_no: req.body.contact_number ?? existingVendor?.contact_no ?? '',
              email: req.body.email_id ?? existingVendor?.email ?? '',
              address: req.body.address ?? existingVendor?.address ?? '',
              address2: req.body.address_2 ?? existingVendor?.address_2 ?? '',
              city: req.body.city ?? existingVendor?.city ?? '',
              state: req.body.state ?? existingVendor?.state ?? '',
              state_code: req.body.state_code ?? existingVendor?.state_code ?? null,
              gstin: req.body.gst_number ?? existingVendor?.tax_id ?? '',
              pin_code: req.body.pin_code ?? ''
            },
            create: {
              invoice_no: existingPurchase.invoice_no,
              vendor_name: req.body.vendor_name ?? existingVendor?.vendor_name ?? 'Other',
              contact_no: req.body.contact_number ?? existingVendor?.contact_no ?? '',
              email: req.body.email_id ?? existingVendor?.email ?? '',
              address: req.body.address ?? existingVendor?.address ?? '',
              address2: req.body.address_2 ?? existingVendor?.address_2 ?? '',
              city: req.body.city ?? existingVendor?.city ?? '',
              state: req.body.state ?? existingVendor?.state ?? '',
              state_code: req.body.state_code ?? existingVendor?.state_code ?? null,
              gstin: req.body.gst_number ?? existingVendor?.tax_id ?? '',
              pin_code: req.body.pin_code ?? ''
            }
          })

          // Update purchase record
          // ✅ FIX: Build update data with proper relation syntax for staff
          const updateData: any = {
            bill_reference: bill_reference || null,
            bill_reference_date: bill_reference_date ? new Date(bill_reference_date).toISOString() : null,
            invoice_date: finalInvoiceDate,  // ✅ Use already-calculated finalInvoiceDate
            // vendor_id is NOT updated - changes are blocked above
            notes: notes || null,
            descriptions: descriptions || null,
            payment_status: finalPaymentStatus,
            payment_mode: parsedPaymentMode,
            transport: transport_name || null,
            transport_name: transport_name || null,
            vehicle_number: vehicle_number || null,
            packing_forwarding_qty: packing_forwarding_qty ? parseFloat(packing_forwarding_qty.toString()) : 0,
            packing_forwarding_rate: packing_forwarding_rate ? parseFloat(packing_forwarding_rate.toString()) : 0,
            packing_forwarding_total: packing_forwarding_total ? parseFloat(packing_forwarding_total.toString()) : 0,
            items_total: calculatedItemsTotal,
            total_taxable_value: calculatedItemsTotal,
            total_cgst: total_cgst ? parseFloat(total_cgst.toString()) : 0,
            total_sgst: total_sgst ? parseFloat(total_sgst.toString()) : 0,
            total_igst: total_igst ? parseFloat(total_igst.toString()) : 0,
            total_tax: calculatedTotalTax,
            total: newTotal,
            freight: transport_cost ? parseFloat(transport_cost.toString()) : 0
          };

          // ✅ FIX: Handle staff relation properly
          if (staff_id) {
            updateData.staff = { connect: { id: parseInt(staff_id.toString()) } };
          } else if (staff_id === null) {
            updateData.staff = { disconnect: true };
          }

          const updatedPurchase = await tx.purchase.update({
            where: { id: purchaseId },
            data: updateData
          })

          // Handle item updates
          if (items && Array.isArray(items)) {
            const existingItems = await tx.purchaseitems.findMany({
              where: { invoice_no: updatedPurchase.invoice_no }
            })

            const existingItemsMap = new Map<number, any>()
            const newItemsMap = new Map<number, any>()

            existingItems.forEach(item => {
              existingItemsMap.set(item.product_id, {
                id: item.id,
                qty: item.qty || 0,
                item: item
              })
            })

            items.forEach(item => {
              newItemsMap.set(parseInt(item.product_id), {
                qty: item.qty || 0,
                category_id: item.category_id,
                subcategory_id: item.subcategory_id,
                company_id: item.company_id,
                model_id: item.model_id,
                car_model: item.car_model || '',
                name_of_product: item.product_name || item.name_of_product || '',
                part: item.part || '',
                rate: item.rate,
                total: item.total,
                gst_percentage: item.gst_percentage || 0,
                cgst: item.cgst || 0,
                sgst: item.sgst || 0,
                igst: item.igst || 0,
                tax: item.tax || 0,
                product_id: parseInt(item.product_id),
                item: item
              })
            })

            // ✅ OPTIMIZATION 1: Collect deletions, additions, and updates
            const itemsToDelete: Array<{ id: number; productId: number; qty: number }> = []
            const itemsToAdd: Array<{ productId: number; data: any }> = []
            const itemsToUpdate: Array<{ id: number; productId: number; data: any; qtyDiff: number; rateChanged: boolean }> = []

            // Identify deletions
            for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
              if (!newItemsMap.has(productId)) {
                itemsToDelete.push({
                  id: existingData.id,
                  productId,
                  qty: existingData.qty
                })
              }
            }

            // Identify additions and updates
            for (const [productId, newData] of Array.from(newItemsMap.entries())) {
              const existingData = existingItemsMap.get(productId)

              if (!existingData) {
                // New item
                itemsToAdd.push({ productId, data: newData })
              } else {
                // Check if update needed
                const qtyDifference = newData.qty - existingData.qty
                const rateChanged = Math.abs(newData.rate - existingData.item.rate) > 0.001
                const subtotalChanged = Math.abs(newData.total - existingData.item.subtotal) > 0.001
                const nameChanged = newData.name_of_product !== existingData.item.name_of_product
                const carModelChanged = newData.car_model !== existingData.item.car_model

                const needsUpdate = Math.abs(qtyDifference) > 0.001 || rateChanged || subtotalChanged || nameChanged || carModelChanged

                if (needsUpdate) {
                  itemsToUpdate.push({
                    id: existingData.id,
                    productId,
                    data: newData,
                    qtyDiff: qtyDifference,
                    rateChanged
                  })
                }
              }
            }

            // ✅ OPTIMIZATION 2: Execute deletions in parallel
            if (itemsToDelete.length > 0) {
              await Promise.all([
                // Delete all items at once
                tx.purchaseitems.deleteMany({
                  where: { id: { in: itemsToDelete.map(item => item.id) } }
                }),
                // Parallel stock decrements
                ...itemsToDelete.map(item =>
                  item.qty > 0
                    ? tx.product.update({
                        where: { id: item.productId },
                        data: { stock: { decrement: item.qty } }
                      })
                    : Promise.resolve()
                )
              ])
            }

            // ✅ OPTIMIZATION 3: Batch load products for new items
            if (itemsToAdd.length > 0) {
              const newProductIds = itemsToAdd.map(item => item.productId)
              const products = await tx.product.findMany({
                where: { id: { in: newProductIds } },
                select: {
                  id: true,
                  product_name: true,
                  product_category_id: true,
                  product_subcategory_id: true,
                  hsn: true
                }
              })

              const productMap = new Map(products.map(p => [p.id, p]))

              // Validate all products exist
              for (const item of itemsToAdd) {
                if (!productMap.has(item.productId)) {
                  throw new Error(`Product with ID ${item.productId} not found`)
                }
              }

              // ✅ OPTIMIZATION 4: Bulk insert new items
              const bulkInsertData = itemsToAdd.map(item => {
                const product = productMap.get(item.productId)!
                const newData = item.data
                const modelId = newData.model_id ? parseInt(newData.model_id) : null
                const companyId = newData.company_id ? parseInt(newData.company_id) : null

                return {
                  invoice_no: updatedPurchase.invoice_no,
                  product_id: item.productId,
                  name_of_product: newData.name_of_product || product.product_name || '',
                  category_id: newData.category_id || product.product_category_id || null,
                  subcategory_id: newData.subcategory_id || product.product_subcategory_id || null,
                  model_id: modelId,
                  company_id: companyId,
                  car_model: newData.car_model || '',
                  vendor_id: updatedPurchase.vendor_id,
                  hsn: product.hsn || '',
                  part: newData.part || '',
                  qty: parseFloat(newData.qty),
                  rate: parseFloat(newData.rate),
                  subtotal: parseFloat(newData.qty) * parseFloat(newData.rate),
                  gst_percentage: parseFloat(newData.gst_percentage) || 0,
                  cgst: parseFloat(newData.cgst) || 0,
                  sgst: parseFloat(newData.sgst) || 0,
                  igst: parseFloat(newData.igst) || 0,
                  tax: parseFloat(newData.tax) || 0,
                  fy: updatedPurchase.fy,
                  invoice_date: updatedPurchase.invoice_date
                }
              })

              // Parallel: Bulk insert + stock updates
              await Promise.all([
                tx.purchaseitems.createMany({ data: bulkInsertData }),
                ...itemsToAdd.map(item => 
                  tx.product.update({
                    where: { id: item.productId },
                    data: {
                      stock: { increment: parseFloat(item.data.qty.toString()) },
                      latest_purchase_rate: parseFloat(item.data.rate.toString()),
                      last_purchase_date: updatedPurchase.invoice_date
                    }
                  })
                )
              ])
            }

            // ✅ OPTIMIZATION 5: Parallel item updates
            if (itemsToUpdate.length > 0) {
              await Promise.all([
                // Parallel item updates
                ...itemsToUpdate.map(item =>
                  tx.purchaseitems.update({
                    where: { id: item.id },
                    data: {
                      qty: parseFloat(item.data.qty),
                      rate: parseFloat(item.data.rate),
                      subtotal: parseFloat(item.data.qty) * parseFloat(item.data.rate),
                      name_of_product: item.data.name_of_product,
                      car_model: item.data.car_model,
                      gst_percentage: parseFloat(item.data.gst_percentage) || 0,
                      cgst: parseFloat(item.data.cgst) || 0,
                      sgst: parseFloat(item.data.sgst) || 0,
                      igst: parseFloat(item.data.igst) || 0,
                      tax: parseFloat(item.data.tax) || 0
                    }
                  })
                ),
                // Parallel stock updates
                ...itemsToUpdate.map(item => {
                  const productUpdateData: any = {}

                  if (Math.abs(item.qtyDiff) > 0.001) {
                    productUpdateData.stock = { increment: item.qtyDiff }
                  }

                  if (item.rateChanged) {
                    productUpdateData.latest_purchase_rate = parseFloat(item.data.rate.toString())
                    productUpdateData.last_purchase_date = updatedPurchase.invoice_date
                  }

                  return Object.keys(productUpdateData).length > 0
                    ? tx.product.update({
                        where: { id: item.productId },
                        data: productUpdateData
                      })
                    : Promise.resolve()
                })
              ])
            }
          }

          // ✅ USE TRANSACTION HANDLER FOR ALL LEDGER/ALLOCATION/BALANCE OPERATIONS
          const oldPaymentStatus = existingPurchase.payment_status
          const newPaymentStatus = finalPaymentStatus
          const oldTotal = existingPurchase.total
          // totalAllocated already calculated above for status calculation

          // ✅ FETCH VENDOR BALANCE FOR SMART ADVANCE ALLOCATION
          const vendor = await tx.vendor_details.findUnique({
            where: { id: existingPurchase.vendor_id },
            select: {
              total_paid: true,
              total_allocated: true,
              total_refunded: true,
              total_refund_allocated: true
            }
          });

          // ✅ CHECK IF PAYMENT LEDGER EXISTS (to detect advance vs real payment)
          const hasPaymentLedger = await tx.vendor_ledger.findFirst({
            where: {
              vendor_id: existingPurchase.vendor_id,
              reference_type: 'purchase',
              reference_id: purchaseId,
              transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
            }
          });

          // Get all operations from handler
          const handlerResult = await transactionHandler.handlePurchaseEdit({
            oldStatus: oldPaymentStatus,
            newStatus: newPaymentStatus,
            oldTotal: oldTotal,
            newTotal: newTotal,
            vendorId: existingPurchase.vendor_id,
            purchaseId: purchaseId,
            invoiceNo: existingPurchase.invoice_no.toString(),
            paymentMode: parsedPaymentMode,
            paymentDate: finalInvoiceDate,  // ✅ Use finalInvoiceDate (user's date or existing)
            fy: existingPurchase.fy,
            totalAllocated: totalAllocated,
            isTypeA: isTypeA,
            hasPaymentLedger: hasPaymentLedger !== null,  // ✅ NEW: Pass payment ledger detection
            currentBalance: vendor ? {
              total_paid: Number(vendor.total_paid),
              total_allocated: Number(vendor.total_allocated),
              total_refunded: Number(vendor.total_refunded),
              total_refund_allocated: Number(vendor.total_refund_allocated)
            } : undefined
          })

          // ✅ LOGGING: Purchase edit transaction details
          console.log(`[PURCHASE EDIT] Starting edit for purchase ${purchaseId}`);
          console.log(`[PURCHASE EDIT] Old total: ${existingPurchase.total}, New total: ${newTotal}`);
          console.log(`[PURCHASE EDIT] Old status: ${existingPurchase.payment_status}, New status: ${finalPaymentStatus}`);
          console.log(`[PURCHASE EDIT] Total allocated: ${totalAllocated}, Is Type A: ${isTypeA}`);
          console.log(`[PURCHASE EDIT] Vendor ID: ${existingPurchase.vendor_id}`);
          console.log(`[PURCHASE EDIT] Has payment ledger: ${hasPaymentLedger !== null}`);
          console.log(`[PURCHASE EDIT] Current balance:`, vendor ? {
            total_paid: Number(vendor.total_paid),
            total_allocated: Number(vendor.total_allocated),
            total_refunded: Number(vendor.total_refunded),
            total_refund_allocated: Number(vendor.total_refund_allocated)
          } : null);

          // ✅ LOGGING: Transaction handler result
          console.log(`[PURCHASE EDIT] Transaction handler result:`, JSON.stringify(handlerResult, null, 2));

          // Execute all operations (ledger, allocations, balance) in transaction
          await transactionHandler.executeInTransaction(tx, handlerResult)

          return updatedPurchase
        }, {
          timeout: 30000
        })

        res.status(200).json({
          status: "success",
          message: "Purchase updated successfully"
        })

      } catch (error) {
        console.error('Update purchase error:', error)
        res.status(500).json({
          status: "failure",
          message: 'Failed to update purchase',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
      break

    case 'DELETE':
      try {
        const purchaseId = parseInt(id as string)
        if (isNaN(purchaseId)) {
          return res.status(400).json({ message: 'Invalid purchase ID' })
        }

        // Get purchase info before deletion
        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId },
          select: { 
            invoice_no: true,
            payment_status: true,
            vendor_id: true,
            return_status: true
          }
        })

        if (!purchase) {
          return res.status(404).json({ message: 'Purchase not found' })
        }

        // Block deletion ONLY if fully returned
        if (purchase.return_status === 2) {
          return res.status(400).json({
            message: 'Cannot delete fully returned purchase. All items have been returned.',
            error_code: 'FULLY_RETURNED'
          })
        }

        // Get delete operations from handler
        const deleteOps = await transactionHandler.handlePurchaseDelete({
          purchaseId,
          vendorId: purchase.vendor_id,
          invoiceNo: purchase.invoice_no,
          paymentStatus: purchase.payment_status,
          returnStatus: purchase.return_status
        })

        // Execute in transaction
        await prisma.$transaction(async (tx) => {
          await transactionHandler.executeDeleteInTransaction(tx, deleteOps)
        }, {
          timeout: 45000
        })

        res.status(200).json({
          success: true,
          message: 'Purchase deleted successfully'
        })

      } catch (error) {
        console.error('Delete purchase error:', error)
        res.status(500).json({ 
          message: 'Failed to delete purchase', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      }
      break

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
      res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}