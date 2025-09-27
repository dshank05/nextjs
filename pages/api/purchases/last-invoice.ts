import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    // Get the highest invoice number from purchases
    const lastPurchase = await prisma.purchase.findFirst({
      orderBy: { invoice_no: 'desc' },
      select: { invoice_no: true }
    });

    const lastInvoiceNumber = lastPurchase?.invoice_no || 0;

    res.status(200).json({
      lastInvoiceNumber: parseInt(lastInvoiceNumber.toString()) || 0
    });
  } catch (error) {
    console.error('Error fetching last invoice number:', error);
    res.status(500).json({
      message: 'Failed to fetch last invoice number',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
