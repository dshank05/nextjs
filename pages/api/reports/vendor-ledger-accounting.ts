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
      // Start of day for dateFrom (00:00:00)
      const startDate = new Date(dateFrom as string)
      startDate.setHours(0, 0, 0, 0)
      const startTimestamp = Math.floor(startDate.getTime() / 1000)
      
      // End of day for dateTo (23:59:59)
      const endDate = new Date(dateTo as string)
      endDate.setHours(23, 59, 59, 999)
      const endTimestamp = Math.floor(endDate.getTime() / 1000)
      
      where.transaction_date = {
        gte: startTimestamp,
        lte: endTimestamp
      }
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
        orderBy: { transaction_date: 'asc' }, // Sort by transaction_date only (ASC - oldest first)
        skip,
        take: limitNum
      }),
      prisma.vendor_ledger.count({ where })
    ])

    // Format entries for accounting ledger display
    const formattedEntries = entries.map(entry => {
      // Determine particulars based on transaction type and payment mode (removed "A/c" suffix)
      let particulars = ''
      
      switch (entry.transaction_type) {
        case 'PURCHASE':
        case 'PURCHASE_ADJUSTMENT':
          particulars = 'Purchase'
          break
        case 'PAYMENT':
        case 'PAYMENT_ADJUSTMENT':
          particulars = entry.payment_mode === 0 ? 'Cash' : 'Bank'
          break
        case 'DEBIT_NOTE':
          particulars = 'Purchase Return'
          break
        case 'REFUND_RECEIVED':
        case 'REFUND_REVERSAL':
          particulars = entry.payment_mode === 0 ? 'Cash' : 'Bank'
          break
        case 'PAYMENT_REVERSAL':
          particulars = entry.payment_mode === 0 ? 'Cash' : 'Bank'
          break
        default:
          particulars = entry.transaction_type.replace(/_/g, ' ')
      }

      // Determine voucher type (clean names)
      let voucherType = ''
      switch (entry.transaction_type) {
        case 'PURCHASE':
        case 'PURCHASE_ADJUSTMENT':
          voucherType = 'Purchase'
          break
        case 'PAYMENT':
        case 'PAYMENT_ADJUSTMENT':
          voucherType = 'Payment'
          break
        case 'DEBIT_NOTE':
          voucherType = 'Debit Note'
          break
        case 'REFUND_RECEIVED':
        case 'REFUND_REVERSAL':
          voucherType = 'Refund'
          break
        case 'PAYMENT_REVERSAL':
          voucherType = 'Payment Reversal'
          break
        default:
          voucherType = entry.transaction_type.replace(/_/g, ' ')
      }

      // Determine remarks
      let remarks = entry.notes || ''
      if (!remarks) {
        if (entry.balance === 0) {
          remarks = 'Nill Balance'
        } else if (entry.balance < 0) {
          remarks = 'Advance Payment'
        } else {
          remarks = 'Balance'
        }
      }

      return {
        id: entry.id,
        date: entry.transaction_date,
        formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN'),
        particulars,
        voucherType,
        voucherNo: entry.reference_no || '-',
        debit: Number(entry.debit) || 0,
        credit: Number(entry.credit) || 0,
        balance: Number(entry.balance) || 0,
        remarks,
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
