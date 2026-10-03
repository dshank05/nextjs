import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'
import { queryString, reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query'
import { cashBook } from '../../../lib/cash-book'

/** Cash / bank book (lib/cash-book.ts). `mode` = cash | bank | all. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const range = reportDayRange(req)
    if (!range || range.start == null || range.end == null) return res.status(400).json({ message: 'dateFrom and dateTo are required' })
    const m = queryString(req, 'mode')
    const { page, limit, skip } = reportPage(req, 100, 5000)
    const r = await cashBook({ start: range.start, end: range.end, mode: m === 'cash' ? 0 : m === 'bank' ? 1 : null, limit, skip })
    return res.status(200).json({ success: true, opening: r.opening, pageOpening: r.pageOpening, rows: r.rows, totals: r.totals, pagination: reportPagination(page, limit, r.total) })
  } catch (error) {
    return fail(res, error, 'build the cash / bank book')
  }
}

export default withObservability(handler)
