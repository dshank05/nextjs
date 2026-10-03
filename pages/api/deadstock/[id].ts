import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { parseId } from '../../../lib/api/respond'
import { answerPartyError } from '../../../lib/party-details'
import { getDeadstock, updateDeadstock, deleteDeadstock } from '../../../lib/deadstock'

/** One dead stock entry: read, edit, delete (returns the units to stock). lib/deadstock.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Invalid deadstock ID' })
  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json(await getDeadstock(id))
      case 'PUT':
        return res.status(200).json({ success: true, message: 'Deadstock entry updated successfully', data: await updateDeadstock(id, req.body || {}) })
      case 'DELETE':
        return res.status(200).json({ success: true, message: 'Deadstock entry deleted successfully. Stock returned to inventory.', data: await deleteDeadstock(id) })
      default:
        return res.status(405).json({ message: 'Method not allowed' })
    }
  } catch (error) {
    return answerPartyError(res, error, `${req.method === 'GET' ? 'fetch' : req.method === 'PUT' ? 'update' : 'delete'} deadstock entry`)
  }
}

export default withObservability(handler)
