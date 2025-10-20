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

        const enhancedPurchase = {
          ...purchase,
          payment_status: purchase.payment_status, // Use Prisma 'payment_status' field directly
          items: purchaseItems,
          formattedDate: purchase.invoice_date,
          bill_reference: purchase.bill_reference,
          descriptions: purchase.descriptions || null, // Note: descriptions field may also be missing
          // Return full master objects
          vendor: vendorData,
          staff: staffData
        }

        res.status(200).json(enhancedPurchase)

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
          transport,
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
          // Update purchase record
          const updatedPurchase = await tx.purchase.update({
            where: { id: purchaseId },
            data: {
              bill_reference: bill_reference || null,
              notes: notes || null,
              descriptions: descriptions || null,
              payment_status: parsedPaymentStatus,
              payment_mode: parsedPaymentMode,
              transport: transport || null,
              total_cgst: total_cgst ? parseFloat(total_cgst.toString()) : 0,
              total_sgst: total_sgst ? parseFloat(total_sgst.toString()) : 0,
              total_igst: total_igst ? parseFloat(total_igst.toString()) : 0,
              total_tax: total_tax ? parseFloat(total_tax.toString()) : 0,
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
                name_of_product: item.name_of_product || '',
                part: item.part || '',
                rate: item.rate,
                total: item.total,
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
                    name_of_product: product.product_name || '',
                    category_id: product.product_category_id || null,
                    subcategory_id: product.product_subcategory_id || null,
                    model_id: modelId,
                    company_id: product.company_id || null,
                    car_model: newData.car_model || '',
                    vendor_id: updatedPurchase.vendor_id,
                    hsn: product.hsn || '',
                    part: newData.part || '',
                    qty: newData.qty,
                    rate: newData.rate,
                    subtotal: newData.total,
                    fy: updatedPurchase.fy,
                    invoice_date: parseInt(updatedPurchase.invoice_date)
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
                    last_purchase_date: parseInt(updatedPurchase.invoice_date)
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
                      subtotal: newData.total,
                      name_of_product: newData.name_of_product,
                      car_model: newData.car_model
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
