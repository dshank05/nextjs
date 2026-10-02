import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '../../../lib/db';
import { fail, methodNotAllowed } from '../../../lib/api/respond';
import { withObservability } from '../../../lib/withObservability';
import { queryFloat, queryInt, queryString, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query';

/**
 * Vendors we owe, one row per vendor.
 *
 * This returned every LEDGER ROW whose running balance was above zero, so a
 * vendor with forty bills appeared up to forty times, a vendor since paid off
 * still appeared through older rows, and the totals counted rows (PU-27).
 *
 * A vendor's outstanding is now the balance on its latest ledger entry (by
 * id) - the definition `ledgerService.getLatestBalance` / `getAllOutstanding`
 * already use. With a date range, it is the latest entry inside the range.
 * Which of the app's several "outstanding" definitions is right is F-47, an
 * owner decision; this report now uses one of them consistently.
 */

const SORT_SQL: Record<string, string> = { balance: 'l.balance', transaction_date: 'l.transaction_date' };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: 'Unauthorized' });
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const { page, limit, skip } = reportPage(req, 10);
    const range = reportDayRange(req);
    const vendorId = queryInt(req, 'vendorFilter');
    const amountMin = queryFloat(req, 'amountMin');
    const amountMax = queryFloat(req, 'amountMax');
    const search = queryString(req, 'search');
    const sortColumn = SORT_SQL[queryString(req, 'sortBy')] || SORT_SQL.balance;
    const sortOrder = queryString(req, 'sortOrder') === 'asc' ? 'ASC' : 'DESC';

    const inner: string[] = [];
    const innerParams: unknown[] = [];
    if (range?.start != null) { inner.push('transaction_date >= ?'); innerParams.push(range.start); }
    if (range?.end != null) { inner.push('transaction_date <= ?'); innerParams.push(range.end); }

    const outer: string[] = ['l.balance > 0'];
    const outerParams: unknown[] = [];
    if (vendorId !== null) { outer.push('l.vendor_id = ?'); outerParams.push(vendorId); }
    if (amountMin !== null) { outer.push('l.balance >= ?'); outerParams.push(amountMin); }
    if (amountMax !== null) { outer.push('l.balance <= ?'); outerParams.push(amountMax); }
    if (search) { outer.push('v.vendor_name LIKE ?'); outerParams.push(`%${search}%`); }

    const from = `
      FROM vendor_ledger l
      JOIN (SELECT vendor_id, MAX(id) AS id FROM vendor_ledger ${inner.length ? 'WHERE ' + inner.join(' AND ') : ''} GROUP BY vendor_id) latest
        ON latest.id = l.id
      LEFT JOIN vendor_details v ON v.id = l.vendor_id
      WHERE ${outer.join(' AND ')}`;
    const params = [...innerParams, ...outerParams];

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count ${from}`, ...params) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT l.id, l.vendor_id, l.transaction_date, l.balance, l.transaction_type, l.reference_no, l.reference_id,
                v.vendor_name, v.contact_no, v.email, v.address, v.city, v.state, v.tax_id
         ${from} ORDER BY ${sortColumn} ${sortOrder}, l.id ${sortOrder} LIMIT ? OFFSET ?`,
        ...params, limit, skip
      ) as Promise<any[]>
    ]);
    const total = Number(countRows[0]?.count ?? 0);

    const reference = (r: any) => {
      switch (r.transaction_type) {
        case 'PURCHASE':
          return { display: r.reference_no || String(r.id), url: `/purchases/view/${r.reference_id}`, type: 'purchase' };
        case 'DEBIT_NOTE':
          return { display: r.reference_no || String(r.id), url: `/entry/purchasereturn-vendor/${r.reference_id}`, type: 'debit_note' };
        case 'PAYMENT':
          return { display: 'Payment', url: null, type: 'payment' };
        default:
          return { display: r.reference_no || 'N/A', url: null, type: 'unknown' };
      }
    };

    const outstandingVendors = rows.map(r => {
      const ref = reference(r);
      return {
        id: r.id,
        vendor_id: r.vendor_id,
        vendor_name: r.vendor_name || 'Unknown Vendor',
        transaction_date: r.transaction_date,
        balance: Number(r.balance),
        last_transaction_type: r.transaction_type,
        reference_display: ref.display,
        reference_url: ref.url,
        reference_type: ref.type,
        formattedDate: new Date(r.transaction_date * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        vendor: r.vendor_name
          ? { vendor_name: r.vendor_name, contact_no: r.contact_no, email: r.email, address: r.address, city: r.city, state: r.state, tax_id: r.tax_id }
          : null
      };
    });

    return res.status(200).json({ outstandingVendors, pagination: reportPagination(page, limit, total) });
  } catch (error) {
    return fail(res, error, 'fetch vendor outstanding balances');
  }
}

export default withObservability(handler);
