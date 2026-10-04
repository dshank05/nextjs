import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { reportDayRange, reportPage, reportPagination } from '../../../lib/api/report-query';
import { fail } from '../../../lib/api/respond';
import { saleCustomerNames } from '../../../lib/bill-party-name-report';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      page = '1',
      limit = '50',
      dateFrom,
      dateTo,
      transactionType = 'all',
      mechanicId,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const { page: pageNum, limit: limitNum, skip } = reportPage(req, 50, 1000);

    // The date picker sends YYYY-MM-DD; this did parseInt() on it (2026), so
    // any date range matched nothing. Whole local days, either end alone.
    const range = reportDayRange(req);
    const dateFilter: any = {};
    if (range?.start != null) dateFilter.gte = range.start;
    if (range?.end != null) dateFilter.lte = range.end;

    const results: any[] = [];

    // Fetch from invoice (sales)
    if (transactionType === 'all' || transactionType === 'sale') {
      const salesWhere: any = {
        mechanic_id: { not: null }
      };
      if (Object.keys(dateFilter).length > 0) {
        salesWhere.invoice_date = dateFilter;
      }
      if (mechanicId) {
        salesWhere.mechanic_id = parseInt(mechanicId as string);
      }

      const sales = await prisma.invoice.findMany({
        where: salesWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          select_customer: true,
          total: true,
          commission: true,
          mechanic_id: true,
          mechanic: {
            select: { name: true, city: true }
          }
        }
      });

      // B-10: the name the bill was made out to (its snapshot), then the master.
      const customerMap = await saleCustomerNames('sale', sales);

      sales.forEach(sale => {
        results.push({
          type: 'Sale',
          reference_no: `INV-${sale.invoice_no}`,
          date: sale.invoice_date,
          customer_name: customerMap.get(sale.id) || 'Unknown',
          mechanic_name: sale.mechanic?.name || 'Unknown',
          mechanic_city: sale.mechanic?.city || '-',
          total_amount: Number(sale.total || 0),
          commission: Number(sale.commission || 0)
        });
      });
    }

    // Fetch from invoicex (salex)
    if (transactionType === 'all' || transactionType === 'salex') {
      const salexWhere: any = {
        mechanic_id: { not: null }
      };
      if (Object.keys(dateFilter).length > 0) {
        salexWhere.invoice_date = dateFilter;
      }
      if (mechanicId) {
        salexWhere.mechanic_id = parseInt(mechanicId as string);
      }

      const salex = await prisma.invoicex.findMany({
        where: salexWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          select_customer: true,
          total: true,
          commission: true,
          mechanic_id: true,
          mechanic: {
            select: { name: true, city: true }
          }
        }
      });

      const customerMap = await saleCustomerNames('salex', salex);

      salex.forEach(sale => {
        results.push({
          type: 'Salex',
          reference_no: `INVX-${sale.invoice_no}`,
          date: sale.invoice_date,
          customer_name: customerMap.get(sale.id) || 'Unknown',
          mechanic_name: sale.mechanic?.name || 'Unknown',
          mechanic_city: sale.mechanic?.city || '-',
          total_amount: Number(sale.total || 0),
          commission: Number(sale.commission || 0)
        });
      });
    }

    // Sort results
    results.sort((a, b) => {
      if (sortBy === 'date') {
        return sortOrder === 'desc' ? b.date - a.date : a.date - b.date;
      } else if (sortBy === 'amount') {
        return sortOrder === 'desc' ? b.total_amount - a.total_amount : a.total_amount - b.total_amount;
      }
      return 0;
    });

    // Format dates
    const formattedResults = results.map(r => ({
      ...r,
      formattedDate: new Date(r.date * 1000).toLocaleDateString('en-IN')
    }));

    // Paginate
    const total = formattedResults.length;
    const paginatedResults = formattedResults.slice(skip, skip + limitNum);

    // Calculate summary by mechanic
    const mechanicSummary = results.reduce((acc, r) => {
      if (!acc[r.mechanic_name]) {
        acc[r.mechanic_name] = { total_sales: 0, total_commission: 0, count: 0, city: r.mechanic_city };
      }
      acc[r.mechanic_name].total_sales += r.total_amount;
      acc[r.mechanic_name].total_commission += r.commission;
      acc[r.mechanic_name].count += 1;
      return acc;
    }, {} as Record<string, any>);

    const summary = {
      total_sales: results.reduce((sum, r) => sum + r.total_amount, 0),
      total_commission: results.reduce((sum, r) => sum + r.commission, 0),
      total_transactions: total,
      mechanic_summary: Object.entries(mechanicSummary).map(([name, data]: [string, any]) => ({
        mechanic_name: name,
        ...data
      }))
    };

    return res.status(200).json({
      success: true,
      data: paginatedResults,
      summary,
      // E-11: an empty list is page 1 of 1.
      pagination: reportPagination(pageNum, limitNum, total)
    });

  } catch (error) {
    return fail(res, error, 'fetch the mechanic sales report');
  }
}
