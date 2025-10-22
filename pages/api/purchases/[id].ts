import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

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

        // ✅ Use direct vendor_id FK lookup
        let vendorData = null;
        if (purchase.vendor_id) {
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

        // ✅ Transform to POST/PUT compatible structure
        const transformedPurchase = {
          // Main purchase fields - ensure all required fields are populated
          id: purchase.id,
          invoice_number: purchase.invoice_no?.toString() || '',
          bill_reference: purchase.bill_reference || '',
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

          // Transform items to POST structure
          items: purchaseItems.map(item => ({
            id: item.id,  // ✅ CRITICAL FIX: Include real database ID
            product_id: item.product_id,
            product_name: item.name_of_product || 'Unknown Product',  // Use name_of_product as product_name
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
            hsn: item.hsn || ''
          })),

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
          payment_status: purchase.payment_status || 0,
          payment_mode: purchase.payment_mode || 1,

          // Metadata
          fy: purchase.fy,
          item_count: purchaseItems.length,

          // Keep original fields for backward compatibility
          formattedDate: purchase.invoice_date,
          vendor: vendorData,
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
          // staff_details, // TODO: Field removed from schema
          notes,
          // descriptions, // TODO: Field removed from schema
          payment_status,
          payment_mode,
          transport_name,
          items, // Include items for update logic
          total_cgst,
          total_sgst,
          total_igst,
          total_tax,
          transport_cost,
          descriptions
        } = req.body

        // ===== VALIDATION =====
        // Validate payment_status and payment_mode are valid integers [0,1]
        const validPaymentStatuses = [0, 1];
        const validPaymentModes = [0, 1];

        const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
          ? parseInt(payment_status.toString())
          : 0; // Default to 0 (Unpaid)

        const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
          ? parseInt(payment_mode.toString())
          : 1; // Default to 1 (Bank)

        if (!validPaymentStatuses.includes(parsedPaymentStatus)) {
          return res.status(400).json({
            message: 'Invalid payment_status: must be 0 (Unpaid) or 1 (Paid)'
          })
        }

        if (!validPaymentModes.includes(parsedPaymentMode)) {
          return res.status(400).json({
            message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
          })
        }

        // Get existing purchase to access invoice_no
        const existingPurchase = await prisma.purchase.findUnique({
          where: { id: purchaseId }
        })

        if (!existingPurchase) {
          return res.status(404).json({ message: 'Purchase not found' })
        }

        // Start transaction for purchase and item updates
        const result = await prisma.$transaction(async (tx) => {
          // Calculate totals from items if provided
          let calculatedItemsTotal = 0;
          let calculatedPackingTotal = 0;
          let calculatedTotalTax = 0;

          if (items && Array.isArray(items)) {
            // Calculate items total (sum of qty * rate for all items)
            calculatedItemsTotal = items.reduce((sum: number, item: any) => {
              return sum + (parseFloat(item.qty || 0) * parseFloat(item.rate || 0));
            }, 0);

            // Get packing/forwarding total if provided
            const packingQty = req.body.packing_forwarding_qty ? parseFloat(req.body.packing_forwarding_qty.toString()) : 0;
            const packingRate = req.body.packing_forwarding_rate ? parseFloat(req.body.packing_forwarding_rate.toString()) : 0;
            calculatedPackingTotal = packingQty * packingRate;

            // Get total tax from request body
            calculatedTotalTax = total_tax ? parseFloat(total_tax.toString()) : 0;
          }

          // Calculate grand total (excluding freight as per requirement)
          const calculatedGrandTotal = calculatedItemsTotal + calculatedPackingTotal + calculatedTotalTax;

          // Update purchase record
          const updatedPurchase = await tx.purchase.update({
            where: { id: purchaseId },
            data: {
              bill_reference: bill_reference || null,
              notes: notes || null,
              descriptions: descriptions || null,
              payment_status: parsedPaymentStatus,
              payment_mode: parsedPaymentMode,
              transport: transport_name || null,
              items_total: calculatedItemsTotal,
              total_taxable_value: calculatedItemsTotal,
              total_cgst: total_cgst ? parseFloat(total_cgst.toString()) : 0,
              total_sgst: total_sgst ? parseFloat(total_sgst.toString()) : 0,
              total_igst: total_igst ? parseFloat(total_igst.toString()) : 0,
              total_tax: calculatedTotalTax,
              total: calculatedGrandTotal,
              freight: transport_cost ? parseFloat(transport_cost.toString()) : 0,
            }
          })

          // Handle item updates if items are provided
          if (items && Array.isArray(items)) {
            // Get existing purchase items for comparison
            const existingItems = await tx.purchaseitems.findMany({
              where: { invoice_no: updatedPurchase.invoice_no }
            })

            // Create maps for efficient lookup
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

            // Process deletions: items that exist in DB but not in new list
            for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
              if (!newItemsMap.has(productId)) {
                // Item was removed - decrease stock
                if (existingData.qty > 0) {
                  await tx.product.update({
                    where: { id: productId },
                    data: {
                      stock: {
                        decrement: existingData.qty
                      }
                    }
                  })
                }
                // Delete the item
                await tx.purchaseitems.delete({
                  where: { id: existingData.id }
                })
              }
            }

            // Process additions and updates
            for (const [productId, newData] of Array.from(newItemsMap.entries())) {
              const existingData = existingItemsMap.get(productId)

              if (!existingData) {
                // New item - create it and increase stock
                // Fetch product details from database for new item
                const product = await tx.product.findUnique({
                  where: { id: productId }
                })

                if (!product) {
                  throw new Error(`Product with ID ${productId} not found`)
                }

                // Use model_id directly from frontend
                const modelId = newData.model_id ? parseInt(newData.model_id) : null;

                await tx.purchaseitems.create({
                  data: {
                    invoice_no: updatedPurchase.invoice_no,
                    product_id: productId,
                    name_of_product: newData.name_of_product || product.product_name || '',
                    category_id: newData.category_id || product.product_category_id || null,
                    subcategory_id: newData.subcategory_id || product.product_subcategory_id || null,
                    model_id: modelId,
                    company_id: newData.company_id || product.company_id || null,
                    car_model: newData.car_model || '',
                    vendor_id: updatedPurchase.vendor_id,
                    hsn: product.hsn || '',
                    part: newData.part || '',
                    qty: newData.qty,
                    rate: newData.rate,
                    subtotal: newData.qty * newData.rate, // Base amount without tax
                    gst_percentage: newData.gst_percentage || 0,
                    cgst: newData.cgst || 0,
                    sgst: newData.sgst || 0,
                    igst: newData.igst || 0,
                    tax: newData.tax || 0,
                    fy: updatedPurchase.fy,
                    invoice_date: updatedPurchase.invoice_date
                  }
                })

                // Increase stock for new purchase
                await tx.product.update({
                  where: { id: productId },
                  data: {
                    stock: {
                      increment: newData.qty
                    },
                    // Update latest purchase rate and timestamp
                    latest_purchase_rate: parseFloat(newData.rate.toString()),
                    last_purchase_date: updatedPurchase.invoice_date
                  }
                })
              } else {
                // Existing item - check if quantity, rate, or product details changed
                const qtyDifference = newData.qty - existingData.qty
                const rateChanged = Math.abs(newData.rate - existingData.item.rate) > 0.001
                const subtotalChanged = Math.abs(newData.total - existingData.item.subtotal) > 0.001
                const nameChanged = newData.name_of_product !== existingData.item.name_of_product
                const carModelChanged = newData.car_model !== existingData.item.car_model

                const needsUpdate = Math.abs(qtyDifference) > 0.001 || rateChanged || subtotalChanged || nameChanged || carModelChanged

                if (needsUpdate) {
                  // Update item details
                  await tx.purchaseitems.update({
                    where: { id: existingData.id },
                    data: {
                      qty: newData.qty,
                      rate: newData.rate,
                      subtotal: newData.qty * newData.rate, // Base amount without tax
                      name_of_product: newData.name_of_product,
                      car_model: newData.car_model,
                      gst_percentage: newData.gst_percentage || 0,
                      cgst: newData.cgst || 0,
                      sgst: newData.sgst || 0,
                      igst: newData.igst || 0,
                      tax: newData.tax || 0
                    }
                  })

                  // Adjust stock based on quantity difference
                  if (Math.abs(qtyDifference) > 0.001) {
                    await tx.product.update({
                      where: { id: productId },
                      data: {
                        stock: {
                          increment: qtyDifference // Add the difference (can be negative)
                        }
                      }
                    })
                  }
                }
              }
            }
          }

          return updatedPurchase
        }, {
          timeout: 15000 // 15 seconds
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

        // First delete associated items
        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId },
          select: { invoice_no: true }
        })

        if (purchase) {
          await prisma.purchaseitems.deleteMany({
            where: { invoice_no: purchase.invoice_no }
          })
        }

        // Then delete purchase
        await prisma.purchase.delete({
          where: { id: purchaseId }
        })

        res.status(204).end()

      } catch (error) {
        console.error('Delete purchase error:', error)
        res.status(500).json({ message: 'Failed to delete purchase', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
      res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
