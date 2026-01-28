import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

/**
 * Merge adjustment/reversal entries with base transactions
 * 
 * Groups by: BASE_TYPE-REFERENCE_TYPE-REFERENCE_ID
 * - PURCHASE + PURCHASE_ADJUSTMENT → Single Purchase entry
 * - PAYMENT + PAYMENT_ADJUSTMENT/REVERSAL → Single Payment entry  
 * - DEBIT_NOTE + REFUND + REVERSALS → Single Debit Note entry
 * 
 * Preserves Order: Uses transaction_date (earliest) for sorting, display_date (latest) for UI
 * NET Calculation: Combines debits and credits to show NET amount in appropriate column only
 *   Example: Debit ₹26,500 + Credit ₹5,300 = NET Debit ₹21,200 (NOT both!)
 */
function mergeAdjustmentEntries(entries: any[]): any[] {
  // Group entries by reference_id + base transaction type
  const groups = new Map<string, any[]>()
  
  entries.forEach(entry => {
    // Determine base transaction type (remove _ADJUSTMENT, _REVERSAL suffixes)
    let baseType = entry.transaction_type
      .replace('_ADJUSTMENT', '')
      .replace('_REVERSAL', '')
    
    // Map REFUND types to DEBIT_NOTE (fallback for old data)
    if (baseType === 'REFUND_RECEIVED') {
      baseType = 'DEBIT_NOTE'
    }
    
    // Create group key: baseType-referenceType-referenceId
    // This ensures PURCHASE and PAYMENT don't merge together
    const key = entry.reference_id && entry.reference_type
      ? `${baseType}-${entry.reference_type}-${entry.reference_id}`
      : `solo-${entry.id}` // Standalone entries without reference
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(entry)
  })
  
  // Merge each group
  const merged: any[] = []
  
  groups.forEach((group) => {
    if (group.length === 1) {
      // Single entry, no merging needed
      merged.push(group[0])
    } else {
      // Multiple entries - merge them
      const firstEntry = group[0]
      
      // Sum up all debits and credits
      const totalDebit = group.reduce((sum, e) => sum + Number(e.debit), 0)
      const totalCredit = group.reduce((sum, e) => sum + Number(e.credit), 0)
      
      // ✅ Calculate NET amount (fixes double debit/credit display bug)
      const netAmount = totalDebit - totalCredit
      
      // ✅ Calculate earliest date (for sorting/position) and latest date (for display)
      const earliestDate = Math.min(...group.map(e => e.transaction_date))
      const latestDate = Math.max(...group.map(e => e.transaction_date))
      
      // Create merged entry (keep first entry's metadata)
      merged.push({
        ...firstEntry,
        transaction_date: earliestDate,  // Preserves original position
        display_date: latestDate,         // Shows updated date in UI
        debit: netAmount > 0 ? netAmount : 0,        // Show in debit column only if NET is positive
        credit: netAmount < 0 ? Math.abs(netAmount) : 0,  // Show in credit column only if NET is negative
        // Balance will be recalculated later
        transaction_type: firstEntry.transaction_type.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
      })
    }
  })
  
  // Sort by date to maintain chronological order
  // ✅ Filter out entries that NET to zero (deleted/cancelled transactions)
  return merged
    .filter(entry => entry.debit !== 0 || entry.credit !== 0)  // Keep only non-zero entries
    .sort((a, b) => a.transaction_date - b.transaction_date)
}

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

    // ✅ Return RAW entries (merge happens on client-side)
    // Calculate running balance
    let runningBalance = 0
    entries.forEach(entry => {
      runningBalance = runningBalance + Number(entry.debit) - Number(entry.credit)
      entry.balance = runningBalance
    })

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

      // ✅ Use display_date if available (for edited transactions), otherwise use transaction_date
      const displayDate = (entry as any).display_date || entry.transaction_date
      
      return {
        id: entry.id,
        date: displayDate,  // Use display_date for UI
        formattedDate: new Date(displayDate * 1000).toLocaleDateString('en-IN'),
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
