import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { listParties, parsePartyListQuery, createParty, answerPartyError } from '../../../lib/party-details'

/** Customers: list (GET, ?dropdown=true for every active one) and create (POST). lib/party-details.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return res.status(200).json(await listParties('customer', parsePartyListQuery(req.query)))
    if (req.method === 'POST') {
      const created = await createParty('customer', req.body || {})
      return res.status(201).json({ status: 'success', message: 'Customer created successfully', customer: created })
    }
    return res.status(405).json({ message: 'Method not allowed' })
  } catch (error) {
    return answerPartyError(res, error, req.method === 'POST' ? 'create customer' : 'fetch customers')
  }
}

export default withObservability(handler)
