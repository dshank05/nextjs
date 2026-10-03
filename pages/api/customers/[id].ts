import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { parseId } from '../../../lib/api/respond'
import { getParty, updateParty, deleteParty, answerPartyError } from '../../../lib/party-details'

/** One customer: read (with outstanding), edit, delete (refused with history). lib/party-details.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Customer ID is required' })
  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json(await getParty('customer', id))
      case 'PUT':
        return res.status(200).json({ message: 'Customer updated successfully', customer: await updateParty('customer', id, req.body || {}) })
      case 'DELETE':
        await deleteParty('customer', id)
        return res.status(200).json({ message: 'Customer deleted successfully' })
      default:
        return res.status(405).json({ message: 'Method not allowed' })
    }
  } catch (error) {
    return answerPartyError(res, error, req.method === 'GET' ? 'fetch customer' : req.method === 'PUT' ? 'update customer' : 'delete customer')
  }
}

export default withObservability(handler)
