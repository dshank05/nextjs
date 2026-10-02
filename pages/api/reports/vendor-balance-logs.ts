import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { fail, methodNotAllowed, notFound } from '../../../lib/api/respond';
import { withObservability } from '../../../lib/withObservability';
import { queryInt, queryString, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query';

/**
 * Vendor balance-change log, or (get_balance=true) a vendor's four counters.
 * The date range now covers whole local days; `new Date('YYYY-MM-DD')` was
 * 00:00 UTC, so the end day's entries were left out (PU-29).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const vendorId = queryInt(req, 'vendor_id');

    if (queryString(req, 'get_balance') === 'true' && vendorId !== null) {
      const vendor = await prisma.vendor_details.findUnique({
        where: { id: vendorId },
        select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
      });
      if (!vendor) return notFound(res, 'Vendor not found');
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

    const { page, limit, skip } = reportPage(req);
    const where: any = {};
    if (vendorId !== null) where.vendor_id = vendorId;
    const column = queryString(req, 'column_name');
    if (column) where.column_name = column;
    const source = queryString(req, 'source_type');
    if (source) where.source_type = source;
    const range = reportDayRange(req);
    if (range) {
      where.created_at = {};
      if (range.start !== null) where.created_at.gte = new Date(range.start * 1000);
      if (range.end !== null) where.created_at.lte = new Date((range.end + 1) * 1000 - 1);
    }

    const [logs, total] = await Promise.all([
      prisma.vendor_balance_logs.findMany({
        where,
        include: { vendor: { select: { id: true, vendor_name: true } } },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take: limit
      }),
      prisma.vendor_balance_logs.count({ where })
    ]);

    return res.status(200).json({
      success: true,
      data: logs.map(log => ({
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
      })),
      pagination: reportPagination(page, limit, total)
    });
  } catch (error) {
    return fail(res, error, 'fetch balance logs');
  }
}

export default withObservability(handler);
