import type { NextApiRequest, NextApiResponse } from 'next'
import { withObservability } from '../../../lib/withObservability'
import { answerError } from '../../../lib/api/sale-routes'
import { createCustomerReturns } from '../../../lib/sale-return'

/**
 * POST: create a customer's return(s), one per bill. The server prices every
 * line (net of its discount, with its own GST) and refuses over-returns; see
 * lib/sale-return.ts. Each item names its kind with `invoice_type`
 * ('invoice' | 'invoicex'), since sale and Invoice C line ids overlap.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  try {
    const returns = await createCustomerReturns(req.body)
    const first = (kind: string) => returns.find(r => r.kind === kind) || null
    return res.status(201).json({
      success: true,
      message: returns.length > 1 ? `${returns.length} returns created` : 'Return created successfully',
      data: {
        returns,
        // Kept for callers that read one of each.
        sale_return: first('sale'),
        salex_return: first('salex')
      }
    })
  } catch (error) {
    return answerError(res, error, 'create the return')
  }
}

export default withObservability(handler)
