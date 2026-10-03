import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { returnNo } from '../../../lib/sale-return';
import { reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query';

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

    const { page: pageNum, limit: limitNum, skip } = reportPage(req, 10);

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

    // Local whole days, both ends inclusive. `new Date('YYYY-MM-DD')` is UTC
    // midnight, so the last day was left out (as PU-28 on the purchase side).
    const range = reportDayRange(req);
    if (range) {
      const d = { ...(range.start != null ? { gte: range.start } : {}), ...(range.end != null ? { lte: range.end } : {}) };
      saleWhere.return_date = d;
      salexWhere.return_date = d;
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
    // An unknown field (the page sends 'balance' from its other view) sorted
    // on undefined, and equal values never compared equal: the order was random.
    const field = ['return_date', 'refund_amount', 'total_amount', 'customer_name', 'payment_status', 'id'].includes(String(sortBy))
      ? String(sortBy) : 'return_date';
    const dir = sortOrder === 'asc' ? 1 : -1;
    matching.sort((a: any, b: any) => {
      const x = typeof a[field] === 'string' ? a[field].toLowerCase() : a[field] ?? 0;
      const y = typeof b[field] === 'string' ? b[field].toLowerCase() : b[field] ?? 0;
      return dir * (x < y ? -1 : x > y ? 1 : (a.return_date - b.return_date) || (a.id - b.id));
    });

    // Paginate
    const total = matching.length;
    const paginatedReturns = matching.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      creditNotes: paginatedReturns,
      totals: {
        taxable: Math.round(matching.reduce((s, r) => s + (r.total_amount || 0), 0) * 100) / 100,
        refund: Math.round(matching.reduce((s, r) => s + (r.refund_amount || 0), 0) * 100) / 100
      },
      pagination: reportPagination(pageNum, limitNum, total)
    });

  } catch (error) {
    console.error('Error fetching credit notes:', error);
    return res.status(500).json({ error: 'Failed to fetch credit notes' });
  }
}
