import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { parseId } from '../../../lib/api/respond'
import { getParty, updateParty, deleteParty, answerPartyError } from '../../../lib/party-details'

/** One vendor: read (with outstanding), edit, delete (refused with history). lib/party-details.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Vendor ID is required' })
  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json(await getParty('vendor', id))
      case 'PUT':
        return res.status(200).json({ message: 'Vendor updated successfully', vendor: await updateParty('vendor', id, req.body || {}) })
      case 'DELETE':
        await deleteParty('vendor', id)
        return res.status(200).json({ message: 'Vendor deleted successfully' })
      default:
        return res.status(405).json({ message: 'Method not allowed' })
    }
  } catch (error) {
    return answerPartyError(res, error, req.method === 'GET' ? 'fetch vendor' : req.method === 'PUT' ? 'update vendor' : 'delete vendor')
  }
}

export default withObservability(handler)
