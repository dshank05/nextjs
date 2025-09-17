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
    const { date } = req.query

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ message: 'Date parameter is required' })
    }

    // Parse the date (YYYY-MM-DD format)
    const targetDate = new Date(date)
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' })
    }

    // Calculate start and end of the day
    const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
    const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999)
    const dayStartUnix = Math.floor(dayStart.getTime() / 1000)
    const dayEndUnix = Math.floor(dayEnd.getTime() / 1000)

    // Run queries in parallel
    const [
      salesResult,
      purchasesResult,
    ] = await Promise.all([
      // Sales total for the day
      prisma.invoice.aggregate({
        where: {
          invoice_date: {
            gte: dayStartUnix,
            lte: dayEndUnix,
          },
        },
        _sum: {
          total: true,
        },
      }),

      // Purchases total for the day (Purchase uses Unix timestamps as strings)
      prisma.purchase.aggregate({
        where: {
          invoice_date: {
            gte: String(dayStartUnix),
            lte: String(dayEndUnix),
          },
        },
        _sum: {
          total: true,
        },
      }),
    ])

    const dailyStats = {
      date: date,
      sales: salesResult._sum.total || 0,
      purchases: purchasesResult._sum.total || 0,
    }

    res.status(200).json(dailyStats)
  } catch (error) {
    console.error('Daily stats error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch daily stats',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
