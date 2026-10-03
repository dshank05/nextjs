import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { fail, methodNotAllowed } from '../../../lib/api/respond';
import { withObservability } from '../../../lib/withObservability';
import { queryFloat, queryInt, queryString, reportPage, reportPagination, reportDayRange } from '../../../lib/api/report-query';
import { partyOutstanding } from '../../../lib/party-outstanding';

/**
 * Customer balances, one row per customer: SUM(debit) - SUM(credit) of
 * the customer ledger up to the end of the range (F-47, lib/party-outstanding.ts).
 * `totals.owed` is what is owed on positive balances, `totals.credit` the
 * advances / unrefunded returns on negative ones.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: 'Unauthorized' });
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { page, limit, skip } = reportPage(req, 10);
    const range = reportDayRange(req);
    const result = await partyOutstanding('customer', {
      partyId: queryInt(req, 'customerFilter'),
      search: queryString(req, 'search'),
      start: range?.start ?? null,
      end: range?.end ?? null,
      amountMin: queryFloat(req, 'amountMin'),
      amountMax: queryFloat(req, 'amountMax'),
      sortBy: queryString(req, 'sortBy'),
      sortOrder: queryString(req, 'sortOrder') === 'asc' ? 'asc' : 'desc',
      limit,
      skip
    });
    return res.status(200).json({
      success: true,
      outstandingCustomers: result.items,
      totals: result.totals,
      pagination: reportPagination(page, limit, result.total)
    });
  } catch (error) {
    return fail(res, error, 'fetch customer balances');
  }
}

export default withObservability(handler);
