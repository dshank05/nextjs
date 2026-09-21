import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { getCurrentFinancialYear } from '../../../lib/financial-year'

/**
 * The last purchase invoice number IN THE CURRENT FINANCIAL YEAR.
 *
 * This used to return a GLOBAL maximum, with no `fy` filter, while
 * lib/invoice-counter.ts allocates per financial year. Two numbering schemes
 * for one number (F-16), and the disagreement was not harmless: the form
 * prefilled from the global maximum, so at the start of a new year it offered
 * a number far above the counter's, and every purchase created through the UI
 * silently skipped the low numbers the counter would have used.
 *
 * It also masked P4-02. The duplicate check had no `fy` filter either, so an
 * auto-generated number collided with the previous year's rows - but a form
 * prefilled from the global maximum never hit that path, which is why a
 * guaranteed annual failure could sit unnoticed. Fixing one without the other
 * would have turned a hidden bug into a visible one.
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const currentFy = await getCurrentFinancialYear()

    const lastPurchase = await prisma.purchase.findFirst({
      where: { fy: currentFy },
      orderBy: { invoice_no: 'desc' },
      select: { invoice_no: true }
    });

    const lastInvoiceNumber = lastPurchase?.invoice_no || 0;

    res.status(200).json({
      lastInvoiceNumber,
      // Returned so a caller can tell an empty year from a failed lookup, and
      // so the UI can say which year it is numbering within.
      fy: currentFy,
      nextInvoiceNumber: lastInvoiceNumber + 1
    });
  } catch (error) {
    // Logged in full, returned as a bare message (P4-20 / L-11).
    console.error('Error fetching last invoice number:', error);
    res.status(500).json({ message: 'Failed to fetch last invoice number' });
  }
}
export default withObservability(handler)
