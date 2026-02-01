import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { parseDateRange } from '../../../lib/date-utils'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      vendor_id,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    if (!vendor_id) {
      return res.status(400).json({ message: 'Vendor ID is required' })
    }

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {
      vendor_id: parseInt(vendor_id as string)
    }

    // Date range filter - default to current month if not provided
    if (dateFrom && dateTo) {
      const { startTimestamp, endTimestamp } = parseDateRange(
        dateFrom as string,
        dateTo as string
      );
      where.transaction_date = {
        gte: startTimestamp,
        lte: endTimestamp
      };
    } else {
      // Default: Current month (first day to last day)
      const now = new Date()
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      where.transaction_date = {
        gte: Math.floor(firstDayOfMonth.getTime() / 1000),
        lte: Math.floor(lastDayOfMonth.getTime() / 1000)
      }
    }

    // Fetch ledger entries
    const [entries, total] = await Promise.all([
      prisma.vendor_ledger.findMany({
        where,
        orderBy: [
          { transaction_date: 'asc' },  // Primary sort: transaction date
          { id: 'asc' }                 // ✅ Secondary sort: id for consistent same-date ordering
        ],
        skip,
        take: limitNum
      }),
      prisma.vendor_ledger.count({ where })
    ])

    // ✅ Return RAW entries (merge happens on client-side)
    // Calculate running balance
    let runningBalance = 0
    entries.forEach(entry => {
      runningBalance = runningBalance + Number(entry.debit) - Number(entry.credit)
      entry.balance = runningBalance
    })

    // ✅ Filter out zero-value entries (cancelled transactions)
    const nonZeroEntries = entries.filter(entry => entry.debit !== 0 || entry.credit !== 0)
    
    // ✅ Return RAW entries - all formatting/merging happens on client-side
    const formattedEntries = nonZeroEntries.map(entry => {
      return {
        id: entry.id,
        date: entry.transaction_date,
        formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN'),
        particulars: entry.notes || '',  // Raw notes
        voucherType: entry.transaction_type,  // Raw transaction type
        voucherNo: entry.reference_no || '-',
        debit: Number(entry.debit) || 0,
        credit: Number(entry.credit) || 0,
        balance: Number(entry.balance) || 0,
        remarks: entry.notes || '',
        paymentMode: entry.payment_mode,
        transactionType: entry.transaction_type,
        referenceType: entry.reference_type,
        referenceId: entry.reference_id
      }
    })

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      entries: formattedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages
      }
    })
  } catch (error) {
    console.error('Vendor ledger accounting fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch vendor ledger',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
