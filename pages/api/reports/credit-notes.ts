import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { returnNo } from '../../../lib/sale-return';

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

    // Search: a number is a note number (SR-012 / SXR-012 / 12); text matches
    // the customer name after the join. Returns have no return_no, customer
    // or customer_id column, so the old filters made every search a 500.
    const searchText = String(search || '').trim();
    const searchNum = parseInt(searchText.replace(/^SX?R-?/i, ''), 10);
    if (searchText && Number.isInteger(searchNum) && /^(SX?R-?)?\d+$/i.test(searchText)) {
      saleWhere.id = searchNum;
      salexWhere.id = searchNum;
      if (/^SR/i.test(searchText)) salexWhere.id = -1;
      if (/^SXR/i.test(searchText)) saleWhere.id = -1;
    }
    const nameSearch = searchText && !(saleWhere.id || salexWhere.id) ? searchText.toLowerCase() : '';

    // Customer filter: through the bill
    if (customerFilter) {
      const cid = parseInt(customerFilter as string);
      saleWhere.invoice = { select_customer: cid };
      salexWhere.invoicex = { select_customer: cid };
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
    const [saleCounts, salexCounts] = await Promise.all([
      saleReturns.length ? prisma.sale_return_items.groupBy({ by: ['sale_return_id'], where: { sale_return_id: { in: saleReturns.map(r => r.id) } }, _count: { id: true } }) : Promise.resolve([] as any[]),
      salexReturns.length ? prisma.salex_return_items.groupBy({ by: ['salex_return_id'], where: { salex_return_id: { in: salexReturns.map(r => r.id) } }, _count: { id: true } }) : Promise.resolve([] as any[])
    ]);
    const saleCount = new Map<number, number>(saleCounts.map((c: any) => [c.sale_return_id, c._count.id]));
    const salexCount = new Map<number, number>(salexCounts.map((c: any) => [c.salex_return_id, c._count.id]));

    // Combine and format
    const allReturns = [
      ...saleReturns.map(r => ({
        id: r.id,
        key: `sale-${r.id}`,
        credit_note_no: returnNo('sale', r.id),
        item_count: saleCount.get(r.id) || 0,
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
        key: `salex-${r.id}`,
        credit_note_no: returnNo('salex', r.id),
        item_count: salexCount.get(r.id) || 0,
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

    const matching = nameSearch
      ? allReturns.filter(r => r.customer_name.toLowerCase().includes(nameSearch))
      : allReturns;

    // Sort
    matching.sort((a, b) => {
      const aVal = a[sortBy as keyof typeof a];
      const bVal = b[sortBy as keyof typeof b];
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    // Paginate
    const total = matching.length;
    const paginatedReturns = matching.slice(skip, skip + limitNum);

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
