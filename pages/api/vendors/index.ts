import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { listParties, parsePartyListQuery, createParty, answerPartyError } from '../../../lib/party-details'

/** Vendors: list (GET, ?dropdown=true for every active one) and create (POST). lib/party-details.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return res.status(200).json(await listParties('vendor', parsePartyListQuery(req.query)))
    if (req.method === 'POST') {
      const created = await createParty('vendor', req.body || {})
      return res.status(201).json({ status: 'success', message: 'Vendor created successfully', vendor: created })
    }
    return res.status(405).json({ message: 'Method not allowed' })
  } catch (error) {
    return answerPartyError(res, error, req.method === 'POST' ? 'create vendor' : 'fetch vendors')
  }
}

export default withObservability(handler)
