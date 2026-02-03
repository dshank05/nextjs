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
    // Generate last 5 days
    const last5Days = Array.from({ length: 5 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
      
      // Generate YYYY-MM-DD in local timezone
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      return {
        date: dateString, // YYYY-MM-DD in local timezone
        startTimestamp: Math.floor(startOfDay.getTime() / 1000),
        endTimestamp: Math.floor(endOfDay.getTime() / 1000),
        label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }
    })

    // Fetch sales and purchases data for each day
    const trendsData = await Promise.all(
      last5Days.map(async (day) => {
        const [salesResult, purchasesResult] = await Promise.all([
          // Sales for this day (invoice table uses Unix timestamps)
          prisma.invoice.aggregate({
            where: {
              invoice_date: {
                gte: day.startTimestamp,
                lte: day.endTimestamp,
              },
            },
            _sum: {
              total: true,
            },
          }),

          // Purchases for this day - handle both Unix timestamps and date strings
          // Some purchase records may have string dates (YYYY-MM-DD) while others have integers
          (() => {
            const formattedDateString = `${day.date} `; // Add space to match potential string formats

            // Query for records with Unix timestamps (standard)
            const timestampQuery = prisma.purchase.aggregate({
              where: {
                invoice_date: {
                  gte: day.startTimestamp,
                  lte: day.endTimestamp,
                },
              },
              _sum: {
                total: true,
              },
            });

            // Also handle any string date records that might exist (fallback)
            // Use raw SQL for string date filtering
            const stringDateQuery = prisma.$queryRaw`
              SELECT SUM(total) as total FROM purchase
              WHERE invoice_date = ${day.date} OR invoice_date LIKE ${day.date + '%'}
            `;

            // Return the timestamp query as primary - string query as fallback if needed
            return Promise.all([timestampQuery, stringDateQuery]).then(([timestampResult, stringResult]) => {
              // Use timestamp query result if available, otherwise fallback
              if (timestampResult._sum.total) {
                return timestampResult;
              }

              // Handle string result
              const stringTotal = Array.isArray(stringResult) && stringResult[0] ?
                Number(stringResult[0].total) || 0 : 0;

              return {
                _sum: {
                  total: stringTotal
                }
              };
            });
          })(),
        ])

        return {
          date: day.date,
          label: day.label,
          sales: salesResult._sum.total || 0,
          purchases: purchasesResult._sum.total || 0,
        }
      })
    )

    res.status(200).json(trendsData)
  } catch (error) {
    console.error('Dashboard trends error:', error)
    res.status(500).json({
      message: 'Failed to fetch dashboard trends',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
