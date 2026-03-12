import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom and dateTo are required' });
    }

    const fromTimestamp = Math.floor(new Date(dateFrom as string).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(dateTo as string).getTime() / 1000);

    const dateFilter = {
      invoice_date: {
        gte: fromTimestamp,
        lte: toTimestamp
      }
    };

    // Fetch salex data
    const salexData = await prisma.invoicex.findMany({
      where: dateFilter,
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        select_customer: true,
        total: true,
        payment_mode: true,
        payment_status: true
      }
    });

    // Fetch customer details
    const customerIds = Array.from(new Set(salexData.map(s => s.select_customer).filter(id => id !== 0)));
    const customers = await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true }
    });
    const customerMap = new Map(customers.map(c => [c.id, c.billing_name]));

    const salexItems = await prisma.invoice_itemsx.findMany({
      where: {
        invoice_no: { in: salexData.map(s => s.invoice_no) }
      }
    });

    // Calculate summary
    const totalSales = salexData.length;
    const totalRevenue = salexData.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const totalItems = salexItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const uniqueCustomers = new Set(salexData.map(s => s.select_customer)).size;
    const avgOrderValue = totalSales > 0 ? totalRevenue / totalSales : 0;

    const cashSales = salexData
      .filter(s => s.payment_mode === 0)
      .reduce((sum, s) => sum + Number(s.total || 0), 0);
    const bankSales = salexData
      .filter(s => s.payment_mode === 1)
      .reduce((sum, s) => sum + Number(s.total || 0), 0);

    const paidSales = salexData.filter(s => s.payment_status === 1).length;
    const unpaidSales = salexData.filter(s => s.payment_status === 0).length;
    const partiallyPaidSales = salexData.filter(s => s.payment_status === 2).length;

    // Top customers
    const customerRevenue = salexData.reduce((acc: any, sale) => {
      const customerName = sale.select_customer === 0 ? 'Other' : customerMap.get(sale.select_customer) || 'Unknown';
      if (!acc[customerName]) {
        acc[customerName] = { total_sales: 0, total_revenue: 0 };
      }
      acc[customerName].total_sales += 1;
      acc[customerName].total_revenue += Number(sale.total || 0);
      return acc;
    }, {});

    const topCustomers = Object.entries(customerRevenue)
      .map(([name, data]: [string, any]) => ({
        customer_name: name,
        total_sales: data.total_sales,
        total_revenue: data.total_revenue
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue);

    // Top products
    const productSales = salexItems.reduce((acc: any, item) => {
      const productName = item.name_of_product || 'Unknown';
      if (!acc[productName]) {
        acc[productName] = { total_qty: 0, total_revenue: 0 };
      }
      acc[productName].total_qty += Number(item.qty || 0);
      acc[productName].total_revenue += Number(item.subtotal || 0);
      return acc;
    }, {});

    const topProducts = Object.entries(productSales)
      .map(([name, data]: [string, any]) => ({
        product_name: name,
        total_qty: data.total_qty,
        total_revenue: data.total_revenue
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue);

    // Daily sales
    const dailySalesMap = salexData.reduce((acc: any, sale) => {
      const date = new Date(sale.invoice_date * 1000).toLocaleDateString('en-IN');
      if (!acc[date]) {
        acc[date] = { total_sales: 0, total_revenue: 0 };
      }
      acc[date].total_sales += 1;
      acc[date].total_revenue += Number(sale.total || 0);
      return acc;
    }, {});

    const dailySales = Object.entries(dailySalesMap)
      .map(([date, data]: [string, any]) => ({
        date,
        total_sales: data.total_sales,
        total_revenue: data.total_revenue
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return res.status(200).json({
      success: true,
      summary: {
        totalSales,
        totalRevenue,
        totalItems,
        totalCustomers: uniqueCustomers,
        avgOrderValue,
        cashSales,
        bankSales,
        paidSales,
        unpaidSales,
        partiallyPaidSales
      },
      topCustomers,
      topProducts,
      dailySales
    });

  } catch (error) {
    console.error('Error generating salex report:', error);
    return res.status(500).json({ error: 'Failed to generate salex report' });
  }
}
