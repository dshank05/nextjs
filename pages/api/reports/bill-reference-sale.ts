import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { fail, methodNotAllowed } from '../../../lib/api/respond';
import { withObservability } from '../../../lib/withObservability';
import { queryString, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query';

/**
 * Sales and Invoice C bills by bill reference - the bill-reference-purchase
 * fix for the customer side (SA-19).
 *
 * The search used `mode: 'insensitive'`, which Prisma refuses on MySQL, so
 * every search was a 500; the end date was 00:00 UTC, so the last day was
 * left out; both tables were loaded whole and paged in memory. Now one UNION
 * query pages in the database. The customer name is the bill's own snapshot.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { page, limit, skip } = reportPage(req);
    const billReference = queryString(req, 'billReference');
    const range = reportDayRange(req);

    const conds: string[] = [];
    const params: unknown[] = [];
    if (billReference) { conds.push('d.bill_reference LIKE ?'); params.push(`%${billReference}%`); }
    if (range?.start != null) { conds.push('d.invoice_date >= ?'); params.push(range.start); }
    if (range?.end != null) { conds.push('d.invoice_date <= ?'); params.push(range.end); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const branch = (header: string, billTo: string, type: string) => `
      SELECT d.id, d.invoice_no, d.bill_reference, d.total, d.invoice_date, d.payment_status, '${type}' AS type,
        COALESCE(NULLIF(b.billing_name, ''), c.billing_name, 'Other') AS customer_name
      FROM ${header} d
      LEFT JOIN customer_details c ON c.id = d.select_customer AND d.select_customer <> 0
      LEFT JOIN ${billTo} b ON b.invoice_no = d.id
      ${where}`;
    const union = `${branch('invoice', 'bill_tosales', 'sale')} UNION ALL ${branch('invoicex', 'bill_tosalesx', 'salex')}`;
    const both = [...params, ...params];

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM (${union}) t`, ...both) as Promise<any[]>,
      prisma.$queryRawUnsafe(`SELECT * FROM (${union}) t ORDER BY t.invoice_date DESC, t.id DESC LIMIT ? OFFSET ?`, ...both, limit, skip) as Promise<any[]>
    ]);

    return res.status(200).json({
      success: true,
      sales: rows.map(r => ({
        id: Number(r.id),
        invoice_no: Number(r.invoice_no),
        bill_reference: r.bill_reference || '',
        customer_name: r.customer_name,
        total: Number(r.total),
        invoice_date: Number(r.invoice_date),
        payment_status: r.payment_status === null ? null : Number(r.payment_status),
        formattedDate: new Date(Number(r.invoice_date) * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        type: r.type
      })),
      pagination: reportPagination(page, limit, Number(countRows[0]?.n ?? 0))
    });
  } catch (error) {
    return fail(res, error, 'fetch bill reference sales');
  }
}

export default withObservability(handler);
