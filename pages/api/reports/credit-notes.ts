import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      page = '1',
      limit = '10',
      search = '',
      customerFilter = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      paymentStatus = 'all',
      sortBy = 'return_date',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause for sale_returns
    const saleWhere: any = {};
    const salexWhere: any = {};

    // Search filter
    if (search) {
      const searchCondition = {
        OR: [
          { return_no: { contains: search as string, mode: 'insensitive' } },
          { customer: {
            OR: [
              { billing_name: { contains: search as string, mode: 'insensitive' } },
              { name: { contains: search as string, mode: 'insensitive' } }
            ]
          }}
        ]
      };
      saleWhere.OR = searchCondition.OR;
      salexWhere.OR = searchCondition.OR;
    }

    // Customer filter
    if (customerFilter) {
      saleWhere.customer_id = parseInt(customerFilter as string);
      salexWhere.customer_id = parseInt(customerFilter as string);
    }

    // Date filters
    if (dateFrom) {
      const fromTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000);
      saleWhere.return_date = { gte: fromTimestamp };
      salexWhere.return_date = { gte: fromTimestamp };
    }
    if (dateTo) {
      const toTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000);
      saleWhere.return_date = { ...saleWhere.return_date, lte: toTimestamp };
      salexWhere.return_date = { ...salexWhere.return_date, lte: toTimestamp };
    }

    // Amount filters
    if (amountMin) {
      saleWhere.refund_amount = { gte: parseFloat(amountMin as string) };
      salexWhere.refund_amount = { gte: parseFloat(amountMin as string) };
    }
    if (amountMax) {
      saleWhere.refund_amount = { ...saleWhere.refund_amount, lte: parseFloat(amountMax as string) };
      salexWhere.refund_amount = { ...salexWhere.refund_amount, lte: parseFloat(amountMax as string) };
    }

    // Payment status filter
    if (paymentStatus !== 'all') {
      const statusValue = parseInt(paymentStatus as string);
      saleWhere.payment_status = statusValue;
      salexWhere.payment_status = statusValue;
    }

    // Fetch from both tables
    const [saleReturns, salexReturns] = await Promise.all([
      prisma.sale_returns.findMany({
        where: saleWhere,
        include: {
          invoice: {
            select: {
              invoice_no: true,
              select_customer: true
            }
          }
        }
      }),
      prisma.salex_returns.findMany({
        where: salexWhere,
        include: {
          invoicex: {
            select: {
              invoice_no: true,
              select_customer: true
            }
          }
        }
      })
    ]);

    // Get unique customer IDs
    const customerIds = Array.from(new Set([
      ...saleReturns.map(r => r.invoice.select_customer),
      ...salexReturns.map(r => r.invoicex.select_customer)
    ].filter(id => id !== 0)));

    // Fetch customer details
    const customers = await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true }
    });

    const customerMap = new Map(customers.map(c => [c.id, c.billing_name || 'Unknown']));

    // Combine and format
    const allReturns = [
      ...saleReturns.map(r => ({
        id: r.id,
        credit_note_no: r.id,
        return_date: r.return_date,
        customer_id: r.invoice.select_customer,
        customer_name: r.invoice.select_customer === 0 ? 'Other' : customerMap.get(r.invoice.select_customer) || 'Unknown',
        invoice_id: r.invoice_id,
        invoice_no: r.invoice?.invoice_no?.toString() || 'N/A',
        total_amount: Number(r.total_amount),
        total_tax: Number(r.total_tax || 0),
        refund_amount: Number(r.refund_amount),
        payment_status: r.payment_status,
        payment_mode: r.payment_mode,
        payment_date: r.payment_date,
        notes: r.notes,
        fy: r.fy,
        formattedDate: new Date(r.return_date * 1000).toLocaleDateString('en-IN'),
        type: 'sale' as const
      })),
      ...salexReturns.map(r => ({
        id: r.id,
        credit_note_no: r.id,
        return_date: r.return_date,
        customer_id: r.invoicex.select_customer,
        customer_name: r.invoicex.select_customer === 0 ? 'Other' : customerMap.get(r.invoicex.select_customer) || 'Unknown',
        invoice_id: r.invoicex_id,
        invoice_no: r.invoicex?.invoice_no?.toString() || 'N/A',
        total_amount: Number(r.total_amount),
        refund_amount: Number(r.refund_amount),
        payment_status: r.payment_status,
        payment_mode: r.payment_mode,
        payment_date: r.payment_date,
        notes: r.notes,
        fy: r.fy,
        formattedDate: new Date(r.return_date * 1000).toLocaleDateString('en-IN'),
        type: 'salex' as const
      }))
    ];

    // Sort
    allReturns.sort((a, b) => {
      const aVal = a[sortBy as keyof typeof a];
      const bVal = b[sortBy as keyof typeof b];
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    // Paginate
    const total = allReturns.length;
    const paginatedReturns = allReturns.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      creditNotes: paginatedReturns,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching credit notes:', error);
    return res.status(500).json({ error: 'Failed to fetch credit notes' });
  }
}
