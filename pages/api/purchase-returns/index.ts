import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      try {
        const { page = 1, limit = 10, status } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        // Build where clause
        const where: any = {};
        if (status) {
          where.status = status;
        }

        // Get purchase returns
        const purchaseReturns = await prisma.purchase_returns.findMany({
          where,
          include: {
            purchase: true,
            items: {
              include: {
                reason: true,
                purchase_item: {
                  select: {
                    name_of_product: true,
                  },
                },
              },
            },
          },
          orderBy: {
            created_at: 'desc',
          },
          skip,
          take: limitNum,
        });

        // Get total count for pagination
        const totalCount = await prisma.purchase_returns.count({ where });

        // Get vendor information for purchases
        const purchaseIds = purchaseReturns.map(pr => pr.purchase_id);
        const purchaseData = await prisma.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: {
            id: true,
            vendor_id: true,
          },
        });

        const vendorIds = purchaseData.map(pd => pd.vendor_id);
        const vendorData = await prisma.vendor_details.findMany({
          where: { id: { in: vendorIds } },
          select: {
            id: true,
            vendor_name: true,
          },
        });

        // Create lookup maps
        const purchaseVendorMap = new Map(
          purchaseData.map(pd => [pd.id, pd.vendor_id])
        );
        const vendorMap = new Map(
          vendorData.map(vd => [vd.id, vd.vendor_name])
        );

        // Transform data for frontend
        const transformedReturns = purchaseReturns.map(returnRecord => ({
          id: returnRecord.id,
          purchase_id: returnRecord.purchase_id,
          invoice_no: returnRecord.purchase.invoice_no,
          vendor_name: vendorMap.get(returnRecord.purchase_id) || 'Unknown Vendor',
          return_date: returnRecord.return_date,
          total_amount: returnRecord.total_amount,
          total_tax: returnRecord.total_tax,
          status: returnRecord.status,
          notes: returnRecord.notes,
          fy: returnRecord.fy,
          created_at: returnRecord.created_at,
          updated_at: returnRecord.updated_at,
          items: returnRecord.items.map(item => ({
            id: item.id,
            product_name: item.purchase_item?.name_of_product || 'Unknown Product',
            return_qty: item.return_qty,
            unit_price: item.unit_price,
            tax_amount: item.tax_amount,
            subtotal: item.unit_price * item.return_qty,
            return_reason: item.reason.reason_name,
            notes: item.notes,
          })),
        }));

        res.status(200).json({
          success: true,
          data: {
            returns: transformedReturns,
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: totalCount,
              totalPages: Math.ceil(totalCount / limitNum),
            },
          },
        });
      } catch (error) {
        console.error('Error fetching purchase returns:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch purchase returns',
        });
      }
      break;

    case 'POST':
      try {
        const {
          purchase_id,
          return_date,
          total_amount,
          total_tax,
          status,
          notes,
          fy,
          returnItems,
          full_return, // New flag for full returns
        } = req.body;

        // Validate required fields
        if (!purchase_id) {
          return res.status(400).json({
            success: false,
            error: 'Purchase ID is required',
          });
        }

        // Create purchase return in a transaction with extended timeout
        const result = await prisma.$transaction(async (tx) => {
          let finalReturnItems = returnItems || [];

          // If this is a full return, get all items from the original purchase
          if (full_return) {
            const originalPurchaseItems = await tx.purchaseitems.findMany({
              where: { invoice_no: parseInt(purchase_id) },
            });

            // OPTIMIZATION: Pre-calculate sold quantities for full return validation
            const productIds = originalPurchaseItems.map(item => item.product_id);
            const soldQuantities = await prisma.invoiceitems.groupBy({
              by: ['product_id'],
              where: {
                product_id: { in: productIds }
              },
              _sum: { qty: true }
            });

            // Create sold quantity lookup map
            const soldQtyMap = new Map();
            soldQuantities.forEach(sq => {
              soldQtyMap.set(sq.product_id, sq._sum?.qty || 0);
            });

            // Validate: Check if any items have been sold (full return only possible if nothing sold)
            for (const item of originalPurchaseItems) {
              const totalSold = soldQtyMap.get(item.product_id) || 0;
              if (totalSold > 0) {
                throw new Error(`Cannot process full return. ${item.name_of_product} has been sold (${totalSold} units). Use partial return instead.`);
              }
            }

            // Get the first return reason (default) - we should have seeded some reasons
            const defaultReason = await tx.return_reasons.findFirst({
              where: { type: 'purchase' },
              orderBy: { id: 'asc' },
            });

            if (!defaultReason) {
              throw new Error('No return reasons found. Please seed return reasons first.');
            }

            // Create return items for all original items with full quantities
            finalReturnItems = originalPurchaseItems.map(item => ({
              purchase_item_id: item.id,
              return_qty: item.qty || 0, // Return full quantity
              return_reason_id: defaultReason.id,
              unit_price: item.rate || 0,
              tax_amount: (item.tax || 0), // Total tax for the item
              notes: 'Full purchase return',
            }));
          } else {
            // Partial return - validate returnItems and available inventory
            if (!returnItems || returnItems.length === 0) {
              throw new Error('Return items are required for partial returns');
            }

            // OPTIMIZATION: Pre-calculate sold quantities outside transaction
            const purchaseItemIds = returnItems.map(item => parseInt(item.purchase_item_id));
            const purchaseItems = await prisma.purchaseitems.findMany({
              where: { id: { in: purchaseItemIds } },
              select: {
                id: true,
                product_id: true,
                name_of_product: true,
                qty: true,
                invoice_date: true
              }
            });

            // Create lookup map for quick access
            const purchaseItemMap = new Map(purchaseItems.map(item => [item.id, item]));

            // Batch sold quantity queries for better performance
            const productIds = purchaseItems.map(item => item.product_id);
            const soldQuantities = await prisma.invoiceitems.groupBy({
              by: ['product_id'],
              where: {
                product_id: { in: productIds }
              },
              _sum: { qty: true }
            });

            // Create sold quantity lookup map
            const soldQtyMap = new Map();
            soldQuantities.forEach(sq => {
              soldQtyMap.set(sq.product_id, sq._sum?.qty || 0);
            });

            // Now validate each return item (inside transaction with pre-calculated data)
            for (const item of returnItems) {
              const purchaseItem = purchaseItemMap.get(parseInt(item.purchase_item_id));

              if (!purchaseItem) {
                throw new Error(`Purchase item ${item.purchase_item_id} not found`);
              }

              const totalSold = soldQtyMap.get(purchaseItem.product_id) || 0;
              const availableToReturn = (purchaseItem.qty || 0) - totalSold;

              if (parseFloat(item.return_qty) > availableToReturn) {
                throw new Error(`Cannot return ${item.return_qty} of ${purchaseItem.name_of_product}.
                                Only ${availableToReturn} available (purchased: ${purchaseItem.qty}, sold: ${totalSold})`);
              }
            }
          }

          // Calculate totals if not provided (for full returns)
          let finalTotalAmount = total_amount;
          let finalTotalTax = total_tax;

          if (full_return || !total_amount) {
            finalTotalAmount = finalReturnItems.reduce((sum, item) => sum + (item.return_qty * item.unit_price), 0);
            finalTotalTax = finalReturnItems.reduce((sum, item) => sum + item.tax_amount, 0);
          }

          // Create the main purchase return record
          const purchaseReturn = await tx.purchase_returns.create({
            data: {
              purchase_id: parseInt(purchase_id),
              return_date: return_date || new Date().toISOString().split('T')[0], // String date format
              total_amount: parseFloat(finalTotalAmount),
              total_tax: parseFloat(finalTotalTax),
              status: status || 'Pending',
              notes: notes || (full_return ? 'Full order return processed automatically' : notes),
              fy: fy || new Date().getFullYear(),
            },
          });

          // Create the return items
          await tx.purchase_return_items.createMany({
            data: finalReturnItems.map((item: any) => ({
              purchase_return_id: purchaseReturn.id,
              purchase_item_id: parseInt(item.purchase_item_id),
              return_qty: parseFloat(item.return_qty),
              return_reason_id: parseInt(item.return_reason_id),
              unit_price: parseFloat(item.unit_price),
              tax_amount: parseFloat(item.tax_amount) || 0,
              notes: item.notes || '',
            })),
          });

          // OPTIMIZATION: Batch inventory updates for better performance
          // Step 1: Pre-fetch all purchase items in one query
          const purchaseItemIds = finalReturnItems.map(item => parseInt(item.purchase_item_id));
          const purchaseItemsData = await tx.purchaseitems.findMany({
            where: { id: { in: purchaseItemIds } },
            select: { id: true, product_id: true }
          });

          // Step 2: Create lookup map for product_ids
          const purchaseItemMap = new Map(
            purchaseItemsData.map(item => [item.id, item.product_id])
          );

          // Step 3: Aggregate return quantities by product_id
          const productReturnMap = new Map<number, number>();
          for (const item of finalReturnItems) {
            const productId = purchaseItemMap.get(parseInt(item.purchase_item_id));
            if (productId) {
              const currentQty = productReturnMap.get(productId) || 0;
              productReturnMap.set(productId, currentQty + parseFloat(item.return_qty));
            }
          }

          // Step 4: Execute inventory updates (one per unique product)
          const inventoryUpdatePromises = Array.from(productReturnMap.entries()).map(
            ([productId, totalReturnQty]) =>
              tx.product.update({
                where: { id: productId },
                data: {
                  stock: { decrement: totalReturnQty }
                }
              })
          );

          // Execute all updates in parallel for better performance
          await Promise.all(inventoryUpdatePromises);

          // Determine return type: Check if all items are returned at full quantity
          let isFullReturn = false;
          if (finalReturnItems.length > 0) {
            // Get original purchase items to compare
            const originalItems = await tx.purchaseitems.findMany({
              where: { invoice_no: parseInt(purchase_id) },
            });

            // Check if return quantities match original quantities for all items
            isFullReturn = finalReturnItems.every(returnItem => {
              const originalItem = originalItems.find(orig => orig.id === returnItem.purchase_item_id);
              return originalItem && returnItem.return_qty === originalItem.qty;
            });
          }

          // Update purchase return status
          await tx.purchase.update({
            where: { id: parseInt(purchase_id) },
            data: {
              return_status: isFullReturn ? 2 : 1, // 2=full return, 1=partial return
            },
          });

          // Get the created items for response
          const createdItems = await tx.purchase_return_items.findMany({
            where: { purchase_return_id: purchaseReturn.id },
            include: {
              reason: true,
              purchase_item: {
                select: {
                  name_of_product: true,
                },
              },
            },
          });

          return {
            purchaseReturn,
            items: createdItems,
          };
        }, {
          timeout: 15000  // 15 seconds timeout for complex return operations
        });

        res.status(201).json({
          success: true,
          data: {
            return: result.purchaseReturn,
            items: result.items,
          },
        });
      } catch (error) {
        console.error('Error creating purchase return:', error);
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to create purchase return',
        });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({
        success: false,
        error: `Method ${req.method} not allowed`,
      });
  }
}
