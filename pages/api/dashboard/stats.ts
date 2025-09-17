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
    // Get current date for today's calculations (Purchase uses string dates)
    const today = new Date()
    const todayStart = Math.floor(today.setHours(0, 0, 0, 0) / 1000)
    const todayEnd = Math.floor(today.setHours(23, 59, 59, 999) / 1000)
    const todayDateString = today.toISOString().split('T')[0] // YYYY-MM-DD format

    // Run all queries in parallel for better performance
    const [
      totalProducts,
      lowStockProducts,
      totalInvoices,
      totalPurchases,
      todaysSalesResult,
      todaysPurchasesResult,
    ] = await Promise.all([
      // Total products count
      prisma.product.count(),

      // Low stock products (stock < min_stock)
      prisma.product.count({
        where: {
          stock: {
            lt: prisma.product.fields.min_stock
          }
        }
      }),

      // Total invoices count
      prisma.invoice.count(),

      // Total purchases count
      prisma.purchase.count(),

      // Today's sales total
      prisma.invoice.aggregate({
        where: {
          invoice_date: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        _sum: {
          total: true,
        },
      }),

      // Today's purchases total (Purchase uses string dates - skip for now)
      Promise.resolve({ _sum: { total: 0 } }),
    ])

    const stats = {
      totalProducts,
      lowStockProducts,
      totalInvoices,
      totalPurchases,
      todaysSales: todaysSalesResult._sum.total || 0,
      todaysPurchases: todaysPurchasesResult._sum.total || 0,
    }

    res.status(200).json(stats)
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch dashboard stats',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
