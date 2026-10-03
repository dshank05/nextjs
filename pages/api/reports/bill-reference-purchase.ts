import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { fail, methodNotAllowed } from '../../../lib/api/respond';
import { withObservability } from '../../../lib/withObservability';
import { queryString, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query';

/**
 * Purchases by bill reference. The search used `mode: 'insensitive'`, which
 * Prisma supports only on PostgreSQL and MongoDB - on MySQL every search was a
 * 500 (PU-28). MySQL's collation is already case-insensitive.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { page, limit, skip } = reportPage(req);
    const billReference = queryString(req, 'billReference');
    const range = reportDayRange(req);

    const where: any = {};
    if (billReference) where.bill_reference = { contains: billReference };
    if (range) {
      where.invoice_date = {};
      if (range.start !== null) where.invoice_date.gte = range.start;
      if (range.end !== null) where.invoice_date.lte = range.end;
    }

    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ invoice_date: 'desc' }, { id: 'desc' }],
        include: { vendor: { select: { vendor_name: true } } }
      }),
      prisma.purchase.count({ where })
    ]);

    // "Other" (vendor 0) keeps its name on the bill's own snapshot.
    const others = purchases.filter(p => !p.vendor_id);
    const snapshots = others.length
      ? await prisma.bill_to.findMany({
          where: { purchase_id: { in: others.map(p => p.id) } },
          select: { purchase_id: true, vendor_name: true }
        })
      : [];
    const snapshotName = new Map(snapshots.map(s => [s.purchase_id, s.vendor_name]));

    return res.status(200).json({
      success: true,
      purchases: purchases.map(p => ({
        id: p.id,
        invoice_no: p.invoice_no,
        bill_reference: p.bill_reference || '',
        vendor_name: (p.vendor_id ? p.vendor?.vendor_name : snapshotName.get(p.id)) || 'Other',
        total: Number(p.total),
        invoice_date: p.invoice_date,
        payment_status: p.payment_status,
        formattedDate: new Date(p.invoice_date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
      })),
      pagination: reportPagination(page, limit, total)
    });
  } catch (error) {
    return fail(res, error, 'fetch bill reference purchases');
  }
}

export default withObservability(handler);
