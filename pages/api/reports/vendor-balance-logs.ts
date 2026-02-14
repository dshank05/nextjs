import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      vendor_id,
      column_name,
      source_type,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50',
      get_balance
    } = req.query;

    // ✅ NEW: If get_balance=true, return actual vendor balance from DB
    if (get_balance === 'true' && vendor_id) {
      const vendor = await prisma.vendor_details.findUnique({
        where: { id: parseInt(vendor_id as string) },
        select: {
          total_paid: true,
          total_allocated: true,
          total_refunded: true,
          total_refund_allocated: true
        }
      });

      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found' });
      }

      return res.status(200).json({
        success: true,
        balance: {
          total_paid: Number(vendor.total_paid || 0),
          total_allocated: Number(vendor.total_allocated || 0),
          total_refunded: Number(vendor.total_refunded || 0),
          total_refund_allocated: Number(vendor.total_refund_allocated || 0)
        }
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (vendor_id) {
      where.vendor_id = parseInt(vendor_id as string);
    }

    if (column_name) {
      where.column_name = column_name;
    }

    if (source_type) {
      where.source_type = source_type;
    }

    if (dateFrom && dateTo) {
      where.created_at = {
        gte: new Date(dateFrom as string),
        lte: new Date(dateTo as string)
      };
    }

    // Get logs with vendor info
    const [logs, total] = await Promise.all([
      prisma.vendor_balance_logs.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              vendor_name: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.vendor_balance_logs.count({ where })
    ]);

    // Format response
    const formattedLogs = logs.map(log => ({
      id: log.id,
      vendor_id: log.vendor_id,
      vendor_name: log.vendor.vendor_name,
      column_name: log.column_name,
      change_amount: Number(log.change_amount),
      old_value: Number(log.old_value),
      new_value: Number(log.new_value),
      source_type: log.source_type,
      source_id: log.source_id,
      reference_no: log.reference_no,
      created_at: log.created_at,
      created_by: log.created_by,
      notes: log.notes
    }));

    return res.status(200).json({
      success: true,
      data: formattedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching balance logs:', error);
    return res.status(500).json({
      error: 'Failed to fetch balance logs',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
