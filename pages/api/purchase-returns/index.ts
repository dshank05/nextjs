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
        } = req.body;

        // Validate required fields
        if (!purchase_id || !returnItems || returnItems.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Purchase ID and return items are required',
          });
        }

        // Create purchase return in a transaction
        const result = await prisma.$transaction(async (tx) => {
          // Create the main purchase return record
          const purchaseReturn = await tx.purchase_returns.create({
            data: {
              purchase_id: parseInt(purchase_id),
              return_date: return_date,
              total_amount: parseFloat(total_amount),
              total_tax: parseFloat(total_tax),
              status: status || 'Pending',
              notes,
              fy: fy || new Date().getFullYear(),
            },
          });

          // Create the return items
          await tx.purchase_return_items.createMany({
            data: returnItems.map((item: any) => ({
              purchase_return_id: purchaseReturn.id,
              purchase_item_id: parseInt(item.purchase_item_id),
              return_qty: parseFloat(item.return_qty),
              return_reason_id: parseInt(item.return_reason_id),
              unit_price: parseFloat(item.unit_price),
              tax_amount: parseFloat(item.tax_amount),
              notes: item.notes,
            })),
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
          error: 'Failed to create purchase return',
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
