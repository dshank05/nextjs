import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { listReturns, parseReturnListQuery } from '../../../lib/return-list'

/** Sale and Invoice C returns, one list - see lib/return-list.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })
  try {
    return res.status(200).json(await listReturns('customer', parseReturnListQuery('customer', req.query)))
  } catch (error) {
    console.error('Sale returns fetch error:', error)
    return res.status(500).json({ message: 'Failed to fetch sale returns data' })
  }
}

export default withObservability(handler)
