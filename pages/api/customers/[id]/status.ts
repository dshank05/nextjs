import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../../lib/withObservability'
import { parseId } from '../../../../lib/api/respond'
import { getParty, setPartyStatus, answerPartyError } from '../../../../lib/party-details'

/** Activate / deactivate a customer (PUT {status, confirmed}); GET the status. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Customer ID is required' })
  try {
    if (req.method === 'PUT') {
      const status = await setPartyStatus('customer', id, req.body?.status, req.body?.confirmed)
      return res.status(200).json({ message: `Customer status updated to ${status}`, status })
    }
    if (req.method === 'GET') {
      const p: any = await getParty('customer', id)
      return res.status(200).json({ status: p.status, name: p.billing_name })
    }
    return res.status(405).json({ message: 'Method not allowed' })
  } catch (error) {
    return answerPartyError(res, error, 'update customer status')
  }
}

export default withObservability(handler)
