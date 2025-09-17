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
    // Get current date for today's calculations
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const todayStartUnix = Math.floor(todayStart.getTime() / 1000)
    const todayEndUnix = Math.floor(todayEnd.getTime() / 1000)
    const todayDateString = now.toISOString().split('T')[0] // YYYY-MM-DD format

    // Run all queries in parallel for better performance
    const [
      totalProducts,
      lowStockProducts,
      totalInvoices,
      totalPurchases,
      todaysSalesResult,
      todaysPurchasesResult,
      lastSale,
      lastPurchase,
    ] = await Promise.all([
      // Total products count
      prisma.product.count(),

      // Low stock products (stock < min_stock) - using raw SQL since Prisma doesn't support field comparisons
      prisma.$queryRaw`SELECT COUNT(*) as count FROM product WHERE stock < min_stock AND min_stock IS NOT NULL`,

      // Total invoices count
      prisma.invoice.count(),

      // Total purchases count
      prisma.purchase.count(),

      // Today's sales total
      prisma.invoice.aggregate({
        where: {
          invoice_date: {
            gte: todayStartUnix,
            lte: todayEndUnix,
          },
        },
        _sum: {
          total: true,
        },
      }),

      // Today's purchases total (Purchase uses Unix timestamps)
      prisma.purchase.aggregate({
        where: {
          invoice_date: {
            gte: String(todayStartUnix),
            lte: String(todayEndUnix),
          },
        },
        _sum: {
          total: true,
        },
      }),

      // Last sale
      prisma.invoice.findFirst({
        orderBy: {
          invoice_date: 'desc'
        },
        select: {
          total: true,
          invoice_date: true,
          invoice_no: true
        }
      }),

      // Last purchase
      prisma.purchase.findFirst({
        orderBy: {
          invoice_date: 'desc' // Using invoice_date since it's a timestamp
        },
        select: {
          total: true,
          invoice_date: true,
          invoice_no: true
        }
      }),
    ])

    // Extract count from raw query result
    const lowStockCount = Array.isArray(lowStockProducts) && lowStockProducts[0] ? 
      Number(lowStockProducts[0].count) : 0

    const stats = {
      totalProducts,
      lowStockProducts: lowStockCount,
      totalInvoices,
      totalPurchases,
      todaysSales: todaysSalesResult._sum.total || 0,
      todaysPurchases: todaysPurchasesResult._sum.total || 0,
      lastSale: lastSale ? {
        amount: lastSale.total,
        date: lastSale.invoice_date,
        invoiceNo: lastSale.invoice_no
      } : null,
      lastPurchase: lastPurchase ? {
        amount: lastPurchase.total,
        date: lastPurchase.invoice_date,
        invoiceNo: lastPurchase.invoice_no
      } : null,
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
