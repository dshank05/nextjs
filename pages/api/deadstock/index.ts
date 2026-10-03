import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { answerPartyError } from '../../../lib/party-details'
import { listDeadstock, parseDeadstockQuery, createDeadstock } from '../../../lib/deadstock'

/** Dead stock: list (GET) and add (POST). lib/deadstock.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return res.status(200).json(await listDeadstock(parseDeadstockQuery(req.query)))
    if (req.method === 'POST') {
      return res.status(201).json({ success: true, message: 'Deadstock entry created successfully', data: await createDeadstock(req.body || {}) })
    }
    return res.status(405).json({ message: 'Method not allowed' })
  } catch (error) {
    return answerPartyError(res, error, req.method === 'POST' ? 'create deadstock entry' : 'fetch deadstock data')
  }
}

export default withObservability(handler)
