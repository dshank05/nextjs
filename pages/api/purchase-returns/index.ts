import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { listReturns, parseReturnListQuery } from '../../../lib/return-list'

/** Purchase returns - see lib/return-list.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })
  try {
    return res.status(200).json(await listReturns('vendor', parseReturnListQuery('vendor', req.query)))
  } catch (error) {
    console.error('Purchase returns fetch error:', error)
    return res.status(500).json({ message: 'Failed to fetch purchase returns data' })
  }
}

export default withObservability(handler)
