/**
 * Client-side ledger merge utility
 * Merges adjustment/reversal entries with base transactions for clean display
 */

export interface LedgerEntry {
  id: number
  date: number
  formattedDate: string
  particulars: string
  voucherType: string
  voucherNo: string
  debit: number
  credit: number
  balance: number
  remarks: string
  paymentMode: number | null
  transactionType: string
  referenceType: string
  referenceId: number
  transaction_date?: number  // For sorting (earliest)
  display_date?: number      // For display (latest)
}

/**
 * Merge adjustment/reversal entries with base transactions
 * 
 * Groups by: BASE_TYPE-REFERENCE_TYPE-REFERENCE_ID
 * - PURCHASE + PURCHASE_ADJUSTMENT → Single Purchase entry
 * - PAYMENT + PAYMENT_ADJUSTMENT/REVERSAL → Single Payment entry  
 * - DEBIT_NOTE + REFUND + REVERSALS → Single Debit Note entry
 * 
 * Preserves Order: Uses date (earliest) for sorting
 * NET Calculation: Combines debits and credits to show NET amount in appropriate column only
 *   Example: Debit ₹26,500 + Credit ₹5,300 = NET Debit ₹21,200 (NOT both!)
 */
export function mergeLedgerEntries(entries: LedgerEntry[]): LedgerEntry[] {
  // Group entries by reference_id + base transaction type
  const groups = new Map<string, LedgerEntry[]>()
  
  entries.forEach(entry => {
    // Determine base transaction type (remove _ADJUSTMENT, _REVERSAL suffixes)
    let baseType = entry.transactionType
      .replace('_ADJUSTMENT', '')
      .replace('_REVERSAL', '')
    
    // Map REFUND types to DEBIT_NOTE (fallback for old data)
    if (baseType === 'REFUND_RECEIVED') {
      baseType = 'DEBIT_NOTE'
    }
    
    // Create group key: baseType-referenceType-referenceId
    const key = entry.referenceId && entry.referenceType
      ? `${baseType}-${entry.referenceType}-${entry.referenceId}`
      : `solo-${entry.id}` // Standalone entries without reference
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(entry)
  })
  
  // Merge each group
  const merged: LedgerEntry[] = []
  
  groups.forEach((group) => {
    if (group.length === 1) {
      // Single entry, no merging needed
      merged.push(group[0])
    } else {
      // Multiple entries - merge them
      const firstEntry = group[0]
      
      // Sum up all debits and credits
      const totalDebit = group.reduce((sum, e) => sum + e.debit, 0)
      const totalCredit = group.reduce((sum, e) => sum + e.credit, 0)
      
      // ✅ Calculate NET amount (fixes double debit/credit display bug)
      const netAmount = totalDebit - totalCredit
      
      // ✅ Calculate earliest date (for sorting/position) and latest date (for display)
      const earliestDate = Math.min(...group.map(e => e.date))
      const latestDate = Math.max(...group.map(e => e.date))
      
      // Create merged entry (keep first entry's metadata)
      merged.push({
        ...firstEntry,
        transaction_date: earliestDate,  // Preserves original position
        display_date: latestDate,        // Shows updated date in UI
        date: latestDate,  // For backward compatibility
        formattedDate: new Date(latestDate * 1000).toLocaleDateString('en-IN'),
        debit: netAmount > 0 ? netAmount : 0,        // Show in debit column only if NET is positive
        credit: netAmount < 0 ? Math.abs(netAmount) : 0,  // Show in credit column only if NET is negative
        // Balance will be recalculated later
        transactionType: firstEntry.transactionType.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
      })
    }
  })
  
  // Sort by date to maintain chronological order
  // ✅ Filter out entries that NET to zero (deleted/cancelled transactions)
  return merged
    .filter(entry => entry.debit !== 0 || entry.credit !== 0)  // Keep only non-zero entries
    .sort((a, b) => (a.transaction_date || a.date) - (b.transaction_date || b.date))  // Sort by transaction_date (earliest)
}

/**
 * Recalculate running balance after merge
 */
export function recalculateBalance(entries: LedgerEntry[]): LedgerEntry[] {
  let runningBalance = 0
  
  return entries.map(entry => {
    runningBalance = runningBalance + entry.debit - entry.credit
    return {
      ...entry,
      balance: runningBalance
    }
  })
}
