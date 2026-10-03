import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { answerError } from '../../../lib/api/sale-routes'
import { parseId } from '../../../lib/api/respond'
import {
  loadPurchaseReturnDetail, updatePurchaseReturn, deletePurchaseReturn, purchaseReturnNo
} from '../../../lib/purchase-return'

/** One purchase return: read, edit, delete. The work lives in lib/purchase-return.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Valid return ID is required' })
  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json({ success: true, data: await loadPurchaseReturnDetail(id) })
      case 'PUT': {
        const r = await updatePurchaseReturn(id, req.body || {})
        return res.status(200).json({
          success: true,
          message: 'Return updated successfully',
          data: { return: { id: r.id, return_no: purchaseReturnNo(r.id), total_amount: r.total_amount, total_tax: r.total_tax, refund_amount: r.refund_amount, status: r.status } }
        })
      }
      case 'DELETE':
        await deletePurchaseReturn(id)
        return res.status(200).json({ success: true, message: 'Return deleted successfully' })
      default:
        return res.status(405).json({ message: 'Method not allowed' })
    }
  } catch (error) {
    return answerError(res, error, req.method === 'GET' ? 'fetch the return' : req.method === 'PUT' ? 'update the return' : 'delete the return')
  }
}

export default withObservability(handler)
