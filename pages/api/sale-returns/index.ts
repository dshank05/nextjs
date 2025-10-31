import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      try {
        const { page = 1, limit = 50 , status } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const skip = (pageNum - 1) * limitNum;

        // Build where clause
        const where: any = {};
        if (status) {
          where.status = status;
        }

        // Get sale returns
        const saleReturns = await prisma.sale_returns.findMany({
          where,
          include: {
            invoice: true,
            items: {
              include: {
                reason: true,
                invoice_item: {
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
        const totalCount = await prisma.sale_returns.count({ where });

        // Get customer information for invoices
        const invoiceIds = saleReturns.map(sr => sr.invoice_id);
        const invoiceData = await prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            select_customer: true,
          },
        });

        const customerIds = invoiceData.map(inv => inv.select_customer);
        const customerData = await prisma.customer_details.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            billing_name: true,
          },
        });

        // Create lookup maps
        const invoiceCustomerMap = new Map(
          invoiceData.map(inv => [inv.id, inv.select_customer])
        );
        const customerMap = new Map(
          customerData.map(cust => [cust.id, cust.billing_name])
        );

        // Transform data for frontend
        const transformedReturns = saleReturns.map(returnRecord => ({
          id: returnRecord.id,
          invoice_id: returnRecord.invoice_id,
          invoice_no: returnRecord.invoice.invoice_no,
          customer_name: customerMap.get(invoiceCustomerMap.get(returnRecord.invoice_id)) || 'Unknown Customer',
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
            product_name: item.invoice_item?.name_of_product || 'Unknown Product',
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
        console.error('Error fetching sale returns:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch sale returns',
        });
      }
      break;

    case 'POST':
      try {
        const {
          invoice_id,
          return_date,
          total_amount,
          total_tax,
          status,
          notes,
          fy,
          returnItems,
          full_return,
        } = req.body;

        // Validate required fields
        if (!invoice_id) {
          return res.status(400).json({
            success: false,
            error: 'Invoice ID is required',
          });
        }

        // Create sale return in a transaction with extended timeout
        const result = await prisma.$transaction(async (tx) => {
          let finalReturnItems = returnItems || [];

          // If this is a full return, get all items from the original invoice
          if (full_return) {
            const originalInvoiceItems = await tx.invoiceitems.findMany({
              where: { invoice_no: parseInt(invoice_id) },
            });

            // Get the first return reason (default)
            const defaultReason = await tx.return_reasons.findFirst({
              where: { type: 'sale' },
              orderBy: { id: 'asc' },
            });

            if (!defaultReason) {
              throw new Error('No return reasons found. Please seed return reasons first.');
            }

            // Create return items for all original items with full quantities
            finalReturnItems = originalInvoiceItems.map(item => ({
              invoice_item_id: item.id,
              return_qty: item.qty || 0,
              return_reason_id: defaultReason.id,
              unit_price: item.rate || 0,
              tax_amount: (item.tax || 0),
              notes: 'Full order return processed automatically',
            }));
          } else {
            // Partial return - validate returnItems
            if (!returnItems || returnItems.length === 0) {
              throw new Error('Return items are required for partial returns');
            }

            // Validate each return item
            const invoiceItemIds = returnItems.map(item => parseInt(item.invoice_item_id));
            const invoiceItems = await tx.invoiceitems.findMany({
              where: { id: { in: invoiceItemIds } },
              select: {
                id: true,
                name_of_product: true,
                qty: true,
              }
            });

            const invoiceItemMap = new Map(invoiceItems.map(item => [item.id, item]));

            for (const item of returnItems) {
              const invoiceItem = invoiceItemMap.get(parseInt(item.invoice_item_id));

              if (!invoiceItem) {
                throw new Error(`Invoice item ${item.invoice_item_id} not found`);
              }

              if (parseFloat(item.return_qty) > (invoiceItem.qty || 0)) {
                throw new Error(`Cannot return ${item.return_qty} of ${invoiceItem.name_of_product}. Only ${invoiceItem.qty} were purchased.`);
              }
            }
          }

          // Calculate totals if not provided
          let finalTotalAmount = total_amount;
          let finalTotalTax = total_tax;

          if (full_return || !total_amount) {
            finalTotalAmount = finalReturnItems.reduce((sum, item) => sum + (item.return_qty * item.unit_price), 0);
            finalTotalTax = finalReturnItems.reduce((sum, item) => sum + item.tax_amount, 0);
          }

          // Create the main sale return record
          const saleReturn = await tx.sale_returns.create({
            data: {
              invoice_id: parseInt(invoice_id),
              return_date: return_date || Math.floor(Date.now() / 1000),
              total_amount: parseFloat(finalTotalAmount),
              total_tax: parseFloat(finalTotalTax),
              status: status || 'Pending',
              notes: notes || (full_return ? 'Full order return processed automatically' : ''),
              fy: fy || new Date().getFullYear(),
            },
          });

          // Create the return items
          await tx.sale_return_items.createMany({
            data: finalReturnItems.map((item: any) => ({
              sale_return_id: saleReturn.id,
              invoice_item_id: parseInt(item.invoice_item_id),
              return_qty: parseFloat(item.return_qty),
              return_reason_id: parseInt(item.return_reason_id),
              unit_price: parseFloat(item.unit_price),
              tax_amount: parseFloat(item.tax_amount) || 0,
              notes: item.notes || '',
            })),
          });

          // Update inventory - INCREASE stock for returned items
          const invoiceItemIds = finalReturnItems.map(item => parseInt(item.invoice_item_id));
          const invoiceItemsData = await tx.invoiceitems.findMany({
            where: { id: { in: invoiceItemIds } },
            select: { id: true, product_id: true }
          });

          const invoiceItemMap = new Map(
            invoiceItemsData.map(item => [item.id, item.product_id])
          );

          // Aggregate return quantities by product_id
          const productReturnMap = new Map<number, number>();
          for (const item of finalReturnItems) {
            const productId = invoiceItemMap.get(parseInt(item.invoice_item_id));
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
            const originalItems = await tx.invoiceitems.findMany({
              where: { invoice_no: parseInt(invoice_id) },
            });

            isFullReturn = finalReturnItems.every(returnItem => {
              const originalItem = originalItems.find(orig => orig.id === returnItem.invoice_item_id);
              return originalItem && returnItem.return_qty === originalItem.qty;
            });
          }

          // Update invoice return status
          await tx.invoice.update({
            where: { id: parseInt(invoice_id) },
            data: {
              return_status: isFullReturn ? 2 : 1,
            },
          });

          // Get the created items for response
          const createdItems = await tx.sale_return_items.findMany({
            where: { sale_return_id: saleReturn.id },
            include: {
              reason: true,
              invoice_item: {
                select: {
                  name_of_product: true,
                },
              },
            },
          });

          return {
            saleReturn,
            items: createdItems,
          };
        }, {
          timeout: 15000
        });

        res.status(201).json({
          success: true,
          data: {
            return: result.saleReturn,
            items: result.items,
          },
        });
      } catch (error) {
        console.error('Error creating sale return:', error);
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to create sale return',
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
