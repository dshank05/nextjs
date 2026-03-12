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
    const saleWhere: any = {};
    const salexWhere: any = {};

    if (billReference) {
      saleWhere.bill_reference = { contains: billReference as string, mode: 'insensitive' };
      salexWhere.bill_reference = { contains: billReference as string, mode: 'insensitive' };
    }

    if (dateFrom) {
      const fromTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000);
      saleWhere.invoice_date = { gte: fromTimestamp };
      salexWhere.invoice_date = { gte: fromTimestamp };
    }
    if (dateTo) {
      const toTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000);
      saleWhere.invoice_date = { ...saleWhere.invoice_date, lte: toTimestamp };
      salexWhere.invoice_date = { ...salexWhere.invoice_date, lte: toTimestamp };
    }

    // Fetch from both tables
    const [saleData, salexData] = await Promise.all([
      prisma.invoice.findMany({
        where: saleWhere,
        select: {
          id: true,
          invoice_no: true,
          bill_reference: true,
          select_customer: true,
          total: true,
          invoice_date: true,
          payment_status: true
        }
      }),
      prisma.invoicex.findMany({
        where: salexWhere,
        select: {
          id: true,
          invoice_no: true,
          bill_reference: true,
          select_customer: true,
          total: true,
          invoice_date: true,
          payment_status: true
        }
      })
    ]);

    // Get unique customer IDs
    const customerIds = Array.from(new Set([
      ...saleData.map(s => s.select_customer),
      ...salexData.map(s => s.select_customer)
    ].filter(id => id !== 0)));

    // Fetch customer details
    const customers = await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true }
    });

    const customerMap = new Map(customers.map(c => [c.id, c.billing_name || 'Unknown']));

    // Combine and format
    const allSales = [
      ...saleData.map(s => ({
        id: s.id,
        invoice_no: s.invoice_no,
        bill_reference: s.bill_reference || '',
        customer_name: s.select_customer === 0 ? 'Other' : customerMap.get(s.select_customer) || 'Unknown',
        total: Number(s.total),
        invoice_date: s.invoice_date,
        payment_status: s.payment_status,
        formattedDate: new Date(s.invoice_date * 1000).toLocaleDateString('en-IN'),
        type: 'sale' as const
      })),
      ...salexData.map(s => ({
        id: s.id,
        invoice_no: s.invoice_no,
        bill_reference: s.bill_reference || '',
        customer_name: s.select_customer === 0 ? 'Other' : customerMap.get(s.select_customer) || 'Unknown',
        total: Number(s.total),
        invoice_date: s.invoice_date,
        payment_status: s.payment_status,
        formattedDate: new Date(s.invoice_date * 1000).toLocaleDateString('en-IN'),
        type: 'salex' as const
      }))
    ];

    // Sort by date descending
    allSales.sort((a, b) => b.invoice_date - a.invoice_date);

    // Paginate
    const total = allSales.length;
    const paginatedSales = allSales.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      sales: paginatedSales,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching bill reference sales:', error);
    return res.status(500).json({ error: 'Failed to fetch bill reference sales' });
  }
}
