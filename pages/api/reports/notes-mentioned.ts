import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query';
import { fail } from '../../../lib/api/respond';

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

    const { page: pageNum, limit: limitNum, skip } = reportPage(req, 50, 1000);

    // `mode: 'insensitive'` is PostgreSQL-only: the MySQL connector rejects it,
    // so every search was a 500. MySQL's collation is already case-insensitive.
    const notesCondition = { contains: notesSearch as string };

    // Whole local days, both ends inclusive (was UTC midnight, last day lost).
    const range = reportDayRange(req);
    const dateCondition: any = {};
    if (range?.start != null) dateCondition.gte = range.start;
    if (range?.end != null) dateCondition.lte = range.end;

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
      // E-11: an empty list is page 1 of 1, not "Page 1 of 0".
      pagination: reportPagination(pageNum, limitNum, total)
    });

  } catch (error) {
    return fail(res, error, 'fetch the notes mentioned report');
  }
}
