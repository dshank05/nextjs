import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      page = '1',
      limit = '50',
      billReference = '',
      dateFrom = '',
      dateTo = ''
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (billReference) {
      where.bill_reference = { contains: billReference as string, mode: 'insensitive' };
    }

    if (dateFrom) {
      const fromTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000);
      where.invoice_date = { gte: fromTimestamp };
    }
    if (dateTo) {
      const toTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000);
      where.invoice_date = { ...where.invoice_date, lte: toTimestamp };
    }

    // Fetch purchases
    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: {
          invoice_date: 'desc'
        },
        include: {
          vendor: {
            select: {
              vendor_name: true
            }
          }
        }
      }),
      prisma.purchase.count({ where })
    ]);

    // Format response
    const formattedPurchases = purchases.map(p => ({
      id: p.id,
      invoice_no: p.invoice_no,
      bill_reference: p.bill_reference || '',
      vendor_name: p.vendor?.vendor_name || 'Unknown',
      total: Number(p.total),
      invoice_date: p.invoice_date,
      payment_status: p.payment_status,
      formattedDate: new Date(p.invoice_date * 1000).toLocaleDateString('en-IN')
    }));

    return res.status(200).json({
      success: true,
      purchases: formattedPurchases,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching bill reference purchases:', error);
    return res.status(500).json({ error: 'Failed to fetch bill reference purchases' });
  }
}
