import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { 
      period = 'month',
      startDate = '',
      endDate = '',
      fy = ''
    } = req.query

    // Calculate date range based on period
    let dateFilter: any = {}
    const now = new Date()
    
    if (period === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      dateFilter = {
        gte: Math.floor(firstDay.getTime() / 1000),
        lte: Math.floor(lastDay.getTime() / 1000)
      }
    } else if (period === 'year') {
      const firstDay = new Date(now.getFullYear(), 0, 1)
      const lastDay = new Date(now.getFullYear(), 11, 31)
      dateFilter = {
        gte: Math.floor(firstDay.getTime() / 1000),
        lte: Math.floor(lastDay.getTime() / 1000)
      }
    } else if (startDate && endDate) {
      dateFilter = {
        gte: Math.floor(new Date(startDate as string).getTime() / 1000),
        lte: Math.floor(new Date(endDate as string).getTime() / 1000)
      }
    }

    const whereClause: any = {}
    if (Object.keys(dateFilter).length > 0) {
      whereClause.invoice_date = dateFilter
    }
    if (fy && fy !== '') {
      whereClause.fy = parseInt(fy as string)
    }

    // Run analytics queries in parallel (simplified to avoid SQL errors)
    const [
      totalSales,
      gstBreakdown,
      recentInvoices
    ] = await Promise.all([
      // Total sales summary
      prisma.invoice.aggregate({
        where: whereClause,
        _sum: {
          total: true,
          total_taxable_value: true,
          total_tax: true
        },
        _count: {
          id: true
        }
      }),

      // GST breakdown
      prisma.invoice.aggregate({
        where: whereClause,
        _sum: {
          total_cgst: true,
          total_sgst: true,
          total_igst: true
        }
      }),

      // Recent invoices for trend analysis
      prisma.invoice.findMany({
        where: whereClause,
        take: 30,
        orderBy: { invoice_date: 'desc' },
        select: {
          invoice_date: true,
          total: true,
          invoice_no: true
        }
      })
    ])

    // Process sales trends from recent invoices
    const salesTrends = recentInvoices.map((invoice: any) => ({
      sale_date: new Date(invoice.invoice_date * 1000).toISOString().split('T')[0],
      total_sales: invoice.total,
      invoice_count: 1
    }))

    // Group by date for trend analysis
    const dailySales = salesTrends.reduce((acc: any, sale: any) => {
      if (!acc[sale.sale_date]) {
        acc[sale.sale_date] = { sale_date: sale.sale_date, total_sales: 0, invoice_count: 0 }
      }
      acc[sale.sale_date].total_sales += sale.total_sales
      acc[sale.sale_date].invoice_count += 1
      return acc
    }, {})

    const analytics = {
      summary: {
        totalInvoices: totalSales._count.id,
        totalSales: totalSales._sum.total || 0,
        totalTaxableValue: totalSales._sum.total_taxable_value || 0,
        totalTax: totalSales._sum.total_tax || 0,
        averageInvoiceValue: totalSales._count.id > 0 ? (totalSales._sum.total || 0) / totalSales._count.id : 0
      },
      salesByMonth: [], // Simplified for now
      topProducts: [], // Simplified for now
      recentCustomers: [], // Will show recent customers instead of top
      salesTrends: Object.values(dailySales).slice(0, 15),
      gstBreakdown: {
        cgst: gstBreakdown._sum.total_cgst || 0,
        sgst: gstBreakdown._sum.total_sgst || 0,
        igst: gstBreakdown._sum.total_igst || 0
      }
    }

    res.status(200).json(analytics)
  } catch (error) {
    console.error('Sales analytics error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch sales analytics',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
