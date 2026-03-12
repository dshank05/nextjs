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
      notesSearch = '',
      transactionType = 'all',
      dateFrom = '',
      dateTo = ''
    } = req.query;

    if (!notesSearch) {
      return res.status(400).json({ error: 'notesSearch is required' });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clauses
    const notesCondition = { contains: notesSearch as string, mode: 'insensitive' as const };
    
    let dateCondition: any = {};
    if (dateFrom) {
      const fromTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000);
      dateCondition.gte = fromTimestamp;
    }
    if (dateTo) {
      const toTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000);
      dateCondition.lte = toTimestamp;
    }

    const hasDateFilter = Object.keys(dateCondition).length > 0;

    // Fetch from tables based on transaction type
    let allTransactions: any[] = [];

    if (transactionType === 'all' || transactionType === 'sale') {
      const sales = await prisma.invoice.findMany({
        where: {
          notes: notesCondition,
          ...(hasDateFilter && { invoice_date: dateCondition })
        },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true,
          total: true,
          invoice_date: true,
          notes: true
        }
      });

      // Fetch customer details
      const customerIds = Array.from(new Set(sales.map(s => s.select_customer).filter(id => id !== 0)));
      const customers = await prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      });
      const customerMap = new Map(customers.map(c => [c.id, c.billing_name]));

      allTransactions = allTransactions.concat(
        sales.map(s => ({
          id: s.id,
          invoice_no: s.invoice_no,
          type: 'sale',
          customer_vendor_name: s.select_customer === 0 ? 'Other' : customerMap.get(s.select_customer) || 'Unknown',
          total: Number(s.total),
          invoice_date: s.invoice_date,
          notes: s.notes || '',
          formattedDate: new Date(s.invoice_date * 1000).toLocaleDateString('en-IN')
        }))
      );
    }

    if (transactionType === 'all' || transactionType === 'salex') {
      const salex = await prisma.invoicex.findMany({
        where: {
          notes: notesCondition,
          ...(hasDateFilter && { invoice_date: dateCondition })
        },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true,
          total: true,
          invoice_date: true,
          notes: true
        }
      });

      // Fetch customer details
      const customerIds = Array.from(new Set(salex.map(s => s.select_customer).filter(id => id !== 0)));
      const customers = await prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      });
      const customerMap = new Map(customers.map(c => [c.id, c.billing_name]));

      allTransactions = allTransactions.concat(
        salex.map(s => ({
          id: s.id,
          invoice_no: s.invoice_no,
          type: 'salex',
          customer_vendor_name: s.select_customer === 0 ? 'Other' : customerMap.get(s.select_customer) || 'Unknown',
          total: Number(s.total),
          invoice_date: s.invoice_date,
          notes: s.notes || '',
          formattedDate: new Date(s.invoice_date * 1000).toLocaleDateString('en-IN')
        }))
      );
    }

    if (transactionType === 'all' || transactionType === 'purchase') {
      const purchases = await prisma.purchase.findMany({
        where: {
          notes: notesCondition,
          ...(hasDateFilter && { invoice_date: dateCondition })
        },
        include: {
          vendor: {
            select: {
              vendor_name: true
            }
          }
        }
      });
      allTransactions = allTransactions.concat(
        purchases.map(p => ({
          id: p.id,
          invoice_no: p.invoice_no,
          type: 'purchase',
          customer_vendor_name: p.vendor?.vendor_name || 'Unknown',
          total: Number(p.total),
          invoice_date: p.invoice_date,
          notes: p.notes || '',
          formattedDate: new Date(p.invoice_date * 1000).toLocaleDateString('en-IN')
        }))
      );
    }

    // Sort by date descending
    allTransactions.sort((a, b) => b.invoice_date - a.invoice_date);

    // Paginate
    const total = allTransactions.length;
    const paginatedTransactions = allTransactions.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      transactions: paginatedTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching notes mentioned:', error);
    return res.status(500).json({ error: 'Failed to fetch notes mentioned' });
  }
}
