import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'
import { reportDayRange } from '../../../lib/api/report-query'
import { gstReport } from '../../../lib/gst-report'

/** GST summary for a period (lib/gst-report.ts). Needs dateFrom and dateTo. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const range = reportDayRange(req)
    if (!range || range.start == null || range.end == null) return res.status(400).json({ message: 'dateFrom and dateTo are required' })
    return res.status(200).json(await gstReport(range.start, range.end))
  } catch (error) {
    return fail(res, error, 'build the GST summary')
  }
}

export default withObservability(handler)
