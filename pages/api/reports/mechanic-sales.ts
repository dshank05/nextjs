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
      dateFrom,
      dateTo,
      transactionType = 'all',
      mechanicId,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const dateFilter: any = {};
    if (dateFrom) {
      dateFilter.gte = parseInt(dateFrom as string);
    }
    if (dateTo) {
      dateFilter.lte = parseInt(dateTo as string);
    }

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

      const customerIds = Array.from(new Set(sales.map(s => s.select_customer)));
      const customers = await prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      });
      const customerMap = new Map(customers.map(c => [c.id, c.billing_name]));

      sales.forEach(sale => {
        results.push({
          type: 'Sale',
          reference_no: `INV-${sale.invoice_no}`,
          date: sale.invoice_date,
          customer_name: customerMap.get(sale.select_customer) || 'Unknown',
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

      const customerIds = Array.from(new Set(salex.map(s => s.select_customer).filter(Boolean)));
      const customers = await prisma.customer_details.findMany({
        where: { id: { in: customerIds as number[] } },
        select: { id: true, billing_name: true }
      });
      const customerMap = new Map(customers.map(c => [c.id, c.billing_name]));

      salex.forEach(sale => {
        results.push({
          type: 'Salex',
          reference_no: `INVX-${sale.invoice_no}`,
          date: sale.invoice_date,
          customer_name: customerMap.get(sale.select_customer!) || 'Unknown',
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
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching mechanic sales report:', error);
    return res.status(500).json({ error: 'Failed to fetch mechanic sales report' });
  }
}
