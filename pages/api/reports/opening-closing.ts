import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'
import { queryInt, queryString, reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query'
import { stockReport } from '../../../lib/stock-report'

/** Opening / Closing Stock for a date range (lib/stock-report.ts). */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const range = reportDayRange(req)
    if (!range || range.start == null || range.end == null) return res.status(400).json({ message: 'dateFrom and dateTo are required' })
    const { page, limit, skip } = reportPage(req, 50, 5000)
    const result = await stockReport({
      start: range.start,
      end: range.end,
      search: queryString(req, 'search'),
      categoryId: queryInt(req, 'categoryFilter'),
      activeOnly: queryString(req, 'all') !== '1',
      sortBy: queryString(req, 'sortBy'),
      sortOrder: queryString(req, 'sortOrder') === 'desc' ? 'desc' : 'asc',
      limit,
      skip
    })
    return res.status(200).json({ success: true, products: result.items, totals: result.totals, pagination: reportPagination(page, limit, result.total) })
  } catch (error) {
    return fail(res, error, 'build the opening / closing stock report')
  }
}

export default withObservability(handler)
