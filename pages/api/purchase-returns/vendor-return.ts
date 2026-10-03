import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { answerError } from '../../../lib/api/sale-routes'
import { createVendorReturn } from '../../../lib/purchase-return'

/** Create a purchase return for a vendor. The work lives in lib/purchase-return.ts. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  try {
    const r = await createVendorReturn(req.body || {})
    return res.status(201).json({ success: true, message: 'Return processed successfully', data: { return: r } })
  } catch (error) {
    return answerError(res, error, 'process the return')
  }
}

export default withObservability(handler)
