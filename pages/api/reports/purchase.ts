import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'
import { reportDayRange } from '../../../lib/api/report-query'
import { billReport, type BillKind } from '../../../lib/bill-report'

/** Purchase report (lib/bill-report.ts). Needs dateFrom and dateTo. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const range = reportDayRange(req)
    if (!range || range.start == null || range.end == null) return res.status(400).json({ message: 'dateFrom and dateTo are required' })
    const kinds: BillKind[] = ['purchase']
    return res.status(200).json(await billReport(kinds, { start: range.start, end: range.end }))
  } catch (error) {
    return fail(res, error, 'generate the purchase report')
  }
}

export default withObservability(handler)
