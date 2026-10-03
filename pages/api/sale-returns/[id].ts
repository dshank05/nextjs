import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { answerError } from '../../../lib/api/sale-routes'
import { parseId } from '../../../lib/api/respond'
import { SaleError } from '../../../lib/sale'
import {
  parseReturnKind, findSaleReturn, loadSaleReturnDetail, updateSaleReturn, deleteSaleReturn
} from '../../../lib/sale-return'

/**
 * One sale or Invoice C return. Sale and Invoice C returns are numbered
 * separately, so the kind comes with the id: `?type=invoice|invoicex` (or
 * `invoice_type` in a PUT body). Without it an id that names two returns is
 * refused instead of silently opening the sale one. The work lives in
 * lib/sale-return.ts.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.id)
  if (id === null) return res.status(400).json({ message: 'Valid return ID is required' })
  const hint = parseReturnKind(req.query.type ?? req.body?.invoice_type)

  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json({ success: true, data: await loadSaleReturnDetail(id, hint) })
      case 'PUT': {
        const { kind } = await findSaleReturn(id, hint)
        if (!Array.isArray(req.body?.items)) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION')
        const r = await updateSaleReturn(kind, id, req.body)
        return res.status(200).json({
          success: true,
          message: 'Return updated successfully',
          data: { return: { id: r.id, return_no: r.return_no, total_amount: r.total_amount, total_tax: r.total_tax ?? 0, refund_amount: r.refund_amount, status: r.status, invoice_type: kind === 'sale' ? 'invoice' : 'invoicex' } }
        })
      }
      case 'DELETE': {
        const { kind } = await findSaleReturn(id, hint)
        await deleteSaleReturn(kind, id)
        return res.status(200).json({ success: true, message: 'Return deleted successfully' })
      }
      default:
        return res.status(405).json({ message: 'Method not allowed' })
    }
  } catch (error) {
    return answerError(res, error, req.method === 'GET' ? 'fetch the return' : req.method === 'PUT' ? 'update the return' : 'delete the return')
  }
}

export default withObservability(handler)
