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
      staffId,
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
        staff_id: { not: null }
      };
      if (Object.keys(dateFilter).length > 0) {
        salesWhere.invoice_date = dateFilter;
      }
      if (staffId) {
        salesWhere.staff_id = parseInt(staffId as string);
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
          staff_id: true,
          staff: {
            select: { name: true }
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
          staff_name: sale.staff?.name || 'Unknown',
          total_amount: Number(sale.total || 0),
          commission: Number(sale.commission || 0)
        });
      });
    }

    // Fetch from invoicex (salex)
    if (transactionType === 'all' || transactionType === 'salex') {
      const salexWhere: any = {
        staff_id: { not: null }
      };
      if (Object.keys(dateFilter).length > 0) {
        salexWhere.invoice_date = dateFilter;
      }
      if (staffId) {
        salexWhere.staff_id = parseInt(staffId as string);
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
          staff_id: true,
          staff: {
            select: { name: true }
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
          staff_name: sale.staff?.name || 'Unknown',
          total_amount: Number(sale.total || 0),
          commission: Number(sale.commission || 0)
        });
      });
    }

    // Fetch from purchase
    if (transactionType === 'all' || transactionType === 'purchase') {
      const purchaseWhere: any = {
        staff_id: { not: null }
      };
      if (Object.keys(dateFilter).length > 0) {
        purchaseWhere.invoice_date = dateFilter;
      }
      if (staffId) {
        purchaseWhere.staff_id = parseInt(staffId as string);
      }

      const purchases = await prisma.purchase.findMany({
        where: purchaseWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          vendor_id: true,
          total: true,
          staff_id: true,
          staff: {
            select: { name: true }
          }
        }
      });

      const vendorIds = Array.from(new Set(purchases.map(p => p.vendor_id).filter(Boolean)));
      const vendors = await prisma.vendor_details.findMany({
        where: { id: { in: vendorIds as number[] } },
        select: { id: true, vendor_name: true }
      });
      const vendorMap = new Map(vendors.map(v => [v.id, v.vendor_name]));

      purchases.forEach(purchase => {
        results.push({
          type: 'Purchase',
          reference_no: `PUR-${purchase.invoice_no}`,
          date: purchase.invoice_date,
          customer_name: vendorMap.get(purchase.vendor_id!) || 'Unknown',
          staff_name: purchase.staff?.name || 'Unknown',
          total_amount: Number(purchase.total || 0),
          commission: 0
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

    // Calculate summary by staff
    const staffSummary = results.reduce((acc, r) => {
      if (!acc[r.staff_name]) {
        acc[r.staff_name] = { total_sales: 0, total_commission: 0, count: 0 };
      }
      acc[r.staff_name].total_sales += r.total_amount;
      acc[r.staff_name].total_commission += r.commission;
      acc[r.staff_name].count += 1;
      return acc;
    }, {} as Record<string, any>);

    const summary = {
      total_sales: results.reduce((sum, r) => sum + r.total_amount, 0),
      total_commission: results.reduce((sum, r) => sum + r.commission, 0),
      total_transactions: total,
      staff_summary: Object.entries(staffSummary).map(([name, data]: [string, any]) => ({
        staff_name: name,
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
    console.error('Error fetching staff sales report:', error);
    return res.status(500).json({ error: 'Failed to fetch staff sales report' });
  }
}
