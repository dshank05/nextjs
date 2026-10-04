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
      customerId,
      vendorId,
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
        freight: { gt: 0 }
      };
      if (Object.keys(dateFilter).length > 0) {
        salesWhere.invoice_date = dateFilter;
      }
      if (customerId) {
        salesWhere.select_customer = parseInt(customerId as string);
      }

      const sales = await prisma.invoice.findMany({
        where: salesWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          select_customer: true,
          freight: true,
          total: true
        }
      });

      // B-10: the name the bill was made out to (its snapshot), then the master.
      const customerMap = await saleCustomerNames('sale', sales);

      sales.forEach(sale => {
        results.push({
          type: 'Sale',
          reference_no: `INV-${sale.invoice_no}`,
          date: sale.invoice_date,
          party_name: customerMap.get(sale.id) || 'Unknown',
          freight_amount: Number(sale.freight || 0),
          total_amount: Number(sale.total || 0)
        });
      });
    }

    // Fetch from invoicex (salex)
    if (transactionType === 'all' || transactionType === 'salex') {
      const salexWhere: any = {
        freight: { gt: 0 }
      };
      if (Object.keys(dateFilter).length > 0) {
        salexWhere.invoice_date = dateFilter;
      }
      if (customerId) {
        salexWhere.select_customer = parseInt(customerId as string);
      }

      const salex = await prisma.invoicex.findMany({
        where: salexWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          select_customer: true,
          freight: true,
          total: true
        }
      });

      const customerMap = await saleCustomerNames('salex', salex);

      salex.forEach(sale => {
        results.push({
          type: 'Salex',
          reference_no: `INVX-${sale.invoice_no}`,
          date: sale.invoice_date,
          party_name: customerMap.get(sale.id) || 'Unknown',
          freight_amount: Number(sale.freight || 0),
          total_amount: Number(sale.total || 0)
        });
      });
    }

    // Fetch from purchase
    if (transactionType === 'all' || transactionType === 'purchase') {
      const purchaseWhere: any = {
        freight: { gt: 0 }
      };
      if (Object.keys(dateFilter).length > 0) {
        purchaseWhere.invoice_date = dateFilter;
      }
      if (vendorId) {
        purchaseWhere.vendor_id = parseInt(vendorId as string);
      }

      const purchases = await prisma.purchase.findMany({
        where: purchaseWhere,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          vendor_id: true,
          freight: true,
          total: true,
          transport_name: true
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
          party_name: vendorMap.get(purchase.vendor_id!) || 'Unknown',
          freight_amount: Number(purchase.freight || 0),
          total_amount: Number(purchase.total || 0),
          transport_company: purchase.transport_name || '-'
        });
      });
    }

    // Sort results
    results.sort((a, b) => {
      if (sortBy === 'date') {
        return sortOrder === 'desc' ? b.date - a.date : a.date - b.date;
      } else if (sortBy === 'amount') {
        return sortOrder === 'desc' ? b.freight_amount - a.freight_amount : a.freight_amount - b.freight_amount;
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

    // Calculate summary
    const summary = {
      total_freight: results.reduce((sum, r) => sum + r.freight_amount, 0),
      total_transactions: total,
      avg_freight: total > 0 ? results.reduce((sum, r) => sum + r.freight_amount, 0) / total : 0
    };

    return res.status(200).json({
      success: true,
      data: paginatedResults,
      summary,
      // E-11: an empty list is page 1 of 1.
      pagination: reportPagination(pageNum, limitNum, total)
    });

  } catch (error) {
    return fail(res, error, 'fetch the transport cost report');
  }
}
