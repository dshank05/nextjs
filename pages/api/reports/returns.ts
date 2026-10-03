import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]'
import { withObservability } from '../../../lib/withObservability'
import { fail, methodNotAllowed } from '../../../lib/api/respond'
import { queryInt, queryString, reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query'
import { returnRegister, type ReturnKind } from '../../../lib/return-register'

/** Return registers (lib/return-register.ts). `kind` = sale | salex | purchase | all. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ message: 'Unauthorized' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const kindParam = queryString(req, 'kind')
    const kinds: ReturnKind[] = (['sale', 'salex', 'purchase'] as ReturnKind[]).includes(kindParam as ReturnKind)
      ? [kindParam as ReturnKind]
      : kindParam === 'customer' ? ['sale', 'salex'] : ['sale', 'salex', 'purchase']
    const range = reportDayRange(req)
    const { page, limit, skip } = reportPage(req, 50, 5000)
    const result = await returnRegister({
      start: range?.start ?? null,
      end: range?.end ?? null,
      kinds,
      status: queryInt(req, 'status'),
      search: queryString(req, 'search'),
      sortOrder: queryString(req, 'sortOrder') === 'asc' ? 'asc' : 'desc',
      limit,
      skip
    })
    return res.status(200).json({ success: true, returns: result.items, totals: result.totals, pagination: reportPagination(page, limit, result.total) })
  } catch (error) {
    return fail(res, error, 'build the return register')
  }
}

export default withObservability(handler)
