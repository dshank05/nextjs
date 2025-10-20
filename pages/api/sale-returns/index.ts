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
        const customerData = await prisma.bill_tosales.findMany({
          where: { invoice_no: { in: invoiceIds } },
          include: {
            customer: {
              select: { billing_name: true }
            }
          }
        });

        // Create customer lookup map
        const customerMap = new Map(
          customerData.map(cd => [cd.invoice_no, cd.customer?.billing_name || 'Unknown Customer'])
        );

        // Transform data for frontend
        const transformedReturns = saleReturns.map(returnRecord => ({
          id: returnRecord.id,
          invoice_id: returnRecord.invoice_id,
          invoice_no: returnRecord.invoice.invoice_no,
          customer_name: customerMap.get(returnRecord.invoice_id) || 'Unknown Customer',
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
        } = req.body;

        // Validate required fields
        if (!invoice_id || !returnItems || returnItems.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Invoice ID and return items are required',
          });
        }

        // Create sale return in a transaction
        const result = await prisma.$transaction(async (tx) => {
          // Create the main sale return record
          const saleReturn = await tx.sale_returns.create({
            data: {
              invoice_id: parseInt(invoice_id),
              return_date: parseInt(return_date),
              total_amount: parseFloat(total_amount),
              total_tax: parseFloat(total_tax),
              status: status || 'Pending',
              notes,
              fy: fy || new Date().getFullYear(),
            },
          });

          // Create the return items
          await tx.sale_return_items.createMany({
            data: returnItems.map((item: any) => ({
              sale_return_id: saleReturn.id,
              invoice_item_id: parseInt(item.invoice_item_id),
              return_qty: parseFloat(item.return_qty),
              return_reason_id: parseInt(item.return_reason_id),
              unit_price: parseFloat(item.unit_price),
              tax_amount: parseFloat(item.tax_amount),
              notes: item.notes,
            })),
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
        });

        res.status(201).json({
          status: "success",
          message: "Sale return created successfully"
        });
      } catch (error) {
        console.error('Error creating sale return:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to create sale return',
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
