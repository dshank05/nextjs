import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      try {
        const { page = 1, limit = 50, status } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        // Build where clause
        const where: any = {};
        if (status) {
          where.status = status;
        }

        // Get salex returns
        const salexReturns = await prisma.salex_returns.findMany({
          where,
          include: {
            invoicex: true,
            items: {
              include: {
                reason: true,
                invoice_itemx: {
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
        const totalCount = await prisma.salex_returns.count({ where });

        // Get customer information for invoicex
        const invoicexIds = salexReturns.map(sr => sr.invoicex_id);
        const invoicexData = await prisma.invoicex.findMany({
          where: { id: { in: invoicexIds } },
          select: {
            id: true,
            select_customer: true,
          },
        });

        const customerIds = invoicexData.map(inv => inv.select_customer).filter(id => id !== null);
        const customerData = await prisma.customer_details.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            billing_name: true,
          },
        });

        // Create lookup maps
        const invoicexCustomerMap = new Map(
          invoicexData.map(inv => [inv.id, inv.select_customer])
        );
        const customerMap = new Map(
          customerData.map(cust => [cust.id, cust.billing_name])
        );

        // Transform data for frontend
        const transformedReturns = salexReturns.map(returnRecord => ({
          id: returnRecord.id,
          invoicex_id: returnRecord.invoicex_id,
          invoice_no: returnRecord.invoicex.invoice_no,
          customer_name: customerMap.get(invoicexCustomerMap.get(returnRecord.invoicex_id)) || 'Unknown Customer',
          return_date: returnRecord.return_date,
          total_amount: returnRecord.total_amount,
          status: returnRecord.status,
          notes: returnRecord.notes,
          fy: returnRecord.fy,
          created_at: returnRecord.created_at,
          updated_at: returnRecord.updated_at,
          items: returnRecord.items.map(item => ({
            id: item.id,
            product_name: item.invoice_itemx?.name_of_product || 'Unknown Product',
            return_qty: item.return_qty,
            unit_price: item.unit_price,
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
        console.error('Error fetching salex returns:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch salex returns',
        });
      }
      break;

    case 'POST':
      try {
        const {
          invoicex_id,
          return_date,
          total_amount,
          status,
          notes,
          fy,
          returnItems,
          full_return,
        } = req.body;

        // Validate required fields
        if (!invoicex_id) {
          return res.status(400).json({
            success: false,
            error: 'Invoicex ID is required',
          });
        }

        // Create salex return in a transaction with extended timeout
        const result = await prisma.$transaction(async (tx) => {
          let finalReturnItems = returnItems || [];

          // If this is a full return, get all items from the original invoicex
          if (full_return) {
            const originalInvoicexItems = await tx.invoice_itemsx.findMany({
              where: { invoice_no: parseInt(invoicex_id) },
            });

            // Get the first return reason (default)
            const defaultReason = await tx.return_reasons.findFirst({
              where: { type: 'salex' },
              orderBy: { id: 'asc' },
            });

            if (!defaultReason) {
              throw new Error('No return reasons found. Please seed return reasons first.');
            }

            // Create return items for all original items with full quantities (NO TAX for salex)
            finalReturnItems = originalInvoicexItems.map(item => ({
              invoice_itemx_id: item.id,
              return_qty: item.qty || 0,
              return_reason_id: defaultReason.id,
              unit_price: item.rate || 0,
              notes: 'Full order return processed automatically',
            }));
          } else {
            // Partial return - validate returnItems
            if (!returnItems || returnItems.length === 0) {
              throw new Error('Return items are required for partial returns');
            }

            // Validate each return item
            const invoicexItemIds = returnItems.map(item => parseInt(item.invoice_itemx_id));
            const invoicexItems = await tx.invoice_itemsx.findMany({
              where: { id: { in: invoicexItemIds } },
              select: {
                id: true,
                name_of_product: true,
                qty: true,
              }
            });

            const invoicexItemMap = new Map(invoicexItems.map(item => [item.id, item]));

            for (const item of returnItems) {
              const invoicexItem = invoicexItemMap.get(parseInt(item.invoice_itemx_id));

              if (!invoicexItem) {
                throw new Error(`Invoicex item ${item.invoice_itemx_id} not found`);
              }

              if (parseFloat(item.return_qty) > (invoicexItem.qty || 0)) {
                throw new Error(`Cannot return ${item.return_qty} of ${invoicexItem.name_of_product}. Only ${invoicexItem.qty} were purchased.`);
              }
            }
          }

          // Calculate total if not provided (NO TAX for salex)
          let finalTotalAmount = total_amount;

          if (full_return || !total_amount) {
            finalTotalAmount = finalReturnItems.reduce((sum, item) => sum + (item.return_qty * item.unit_price), 0);
          }

          // Create the main salex return record (NO total_tax field)
          const salexReturn = await tx.salex_returns.create({
            data: {
              invoicex_id: parseInt(invoicex_id),
              return_date: return_date || Math.floor(Date.now() / 1000),
              total_amount: parseFloat(finalTotalAmount),
              status: status || 'Pending',
              notes: notes || (full_return ? 'Full order return processed automatically' : ''),
              fy: fy || new Date().getFullYear(),
            },
          });

          // Create the return items (NO tax_amount field)
          await tx.salex_return_items.createMany({
            data: finalReturnItems.map((item: any) => ({
              salex_return_id: salexReturn.id,
              invoice_itemx_id: parseInt(item.invoice_itemx_id),
              return_qty: parseFloat(item.return_qty),
              return_reason_id: parseInt(item.return_reason_id),
              unit_price: parseFloat(item.unit_price),
              notes: item.notes || '',
            })),
          });

          // Update inventory - INCREASE stock for returned items
          const invoicexItemIds = finalReturnItems.map(item => parseInt(item.invoice_itemx_id));
          const invoicexItemsData = await tx.invoice_itemsx.findMany({
            where: { id: { in: invoicexItemIds } },
            select: { id: true, product_id: true }
          });

          const invoicexItemMap = new Map(
            invoicexItemsData.map(item => [item.id, item.product_id])
          );

          // Aggregate return quantities by product_id
          const productReturnMap = new Map<number, number>();
          for (const item of finalReturnItems) {
            const productId = invoicexItemMap.get(parseInt(item.invoice_itemx_id));
            if (productId) {
              const currentQty = productReturnMap.get(productId) || 0;
              productReturnMap.set(productId, currentQty + parseFloat(item.return_qty));
            }
          }

          // Execute inventory updates (INCREMENT for returns from customers)
          const inventoryUpdatePromises = Array.from(productReturnMap.entries()).map(
            ([productId, totalReturnQty]) =>
              tx.product.update({
                where: { id: productId },
                data: {
                  stock: { increment: totalReturnQty }
                }
              })
          );

          await Promise.all(inventoryUpdatePromises);

          // Determine return status
          let isFullReturn = false;
          if (finalReturnItems.length > 0) {
            const originalItems = await tx.invoice_itemsx.findMany({
              where: { invoice_no: parseInt(invoicex_id) },
            });

            isFullReturn = finalReturnItems.every(returnItem => {
              const originalItem = originalItems.find(orig => orig.id === returnItem.invoice_itemx_id);
              return originalItem && returnItem.return_qty === originalItem.qty;
            });
          }

          // Update invoicex return status
          await tx.invoicex.update({
            where: { id: parseInt(invoicex_id) },
            data: {
              return_status: isFullReturn ? 2 : 1,
            },
          });

          // Get the created items for response
          const createdItems = await tx.salex_return_items.findMany({
            where: { salex_return_id: salexReturn.id },
            include: {
              reason: true,
              invoice_itemx: {
                select: {
                  name_of_product: true,
                },
              },
            },
          });

          return {
            salexReturn,
            items: createdItems,
          };
        }, {
          timeout: 15000
        });

        res.status(201).json({
          success: true,
          data: {
            return: result.salexReturn,
            items: result.items,
          },
        });
      } catch (error) {
        console.error('Error creating salex return:', error);
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to create salex return',
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
