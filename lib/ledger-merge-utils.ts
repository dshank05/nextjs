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
    // ✅ Special handling: Group ALL reversals for same deleted purchase together
    // This merges PURCHASE_REVERSAL, PAYMENT_REVERSAL, DEBIT_NOTE_REVERSAL, etc. into one entry
    if (entry.transactionType.endsWith('_REVERSAL') && 
        entry.referenceType === 'purchase' &&
        entry.referenceId) {
      const key = `DELETION-purchase-${entry.referenceId}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(entry)
      return
    }
    
    // Determine base transaction type (remove _ADJUSTMENT, _REVERSAL suffixes)
    let baseType = entry.transactionType
      .replace('_ADJUSTMENT', '')
      .replace('_REVERSAL', '')
    
    // Map REFUND types to DEBIT_NOTE (fallback for old data)
    if (baseType === 'REFUND_RECEIVED') {
      baseType = 'DEBIT_NOTE'
    }
    
    // Map REFUND_REVERSAL to DEBIT_NOTE for purchase returns
    // When a paid return is changed from complete → incomplete, REFUND_REVERSAL is created
    // This should cancel out the original DEBIT_NOTE entry
    if (entry.transactionType === 'REFUND_REVERSAL' && entry.referenceType === 'purchase_return') {
      baseType = 'DEBIT_NOTE'
    }
    
    // ✅ NEW: Map DEBIT_NOTE_REVERSAL to DEBIT_NOTE for purchase returns
    // When a purchase with returns is deleted, DEBIT_NOTE_REVERSAL is created
    // This should cancel out the original DEBIT_NOTE entry
    if (entry.transactionType === 'DEBIT_NOTE_REVERSAL' && entry.referenceType === 'purchase_return') {
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
      // Single entry, no merging needed - but normalize names
      const entry = group[0]
      const baseType = entry.transactionType.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
      
      let particulars = ''
      let voucherType = ''
      
      switch (baseType) {
        case 'PURCHASE':
          particulars = 'Purchase'
          voucherType = 'Purchase'
          break
        case 'PAYMENT':
          particulars = entry.paymentMode === 0 ? 'Cash' : 'Bank'
          voucherType = 'Payment'
          break
        case 'DEBIT_NOTE':
          particulars = 'Purchase Return'
          voucherType = 'Debit Note'
          break
        case 'REFUND_RECEIVED':
          particulars = entry.paymentMode === 0 ? 'Cash' : 'Bank'
          voucherType = 'Refund'
          break
        default:
          particulars = baseType.replace(/_/g, ' ')
          voucherType = baseType.replace(/_/g, ' ')
      }
      
      merged.push({
        ...entry,
        particulars,
        voucherType,
        transactionType: baseType
      })
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
      
      // ✅ Special display for deletion (merged reversals)
      const isDeletion = group.every(e => e.transactionType.endsWith('_REVERSAL') && e.referenceType === 'purchase')
      
      // ✅ Normalize particulars and voucher type
      let particulars = ''
      let voucherType = ''
      
      if (isDeletion) {
        particulars = 'Purchase Reversal'
        voucherType = 'Purchase Reversal'
      } else {
        const baseType = firstEntry.transactionType.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
        
        switch (baseType) {
          case 'PURCHASE':
            particulars = 'Purchase'
            voucherType = 'Purchase'
            break
          case 'PAYMENT':
            particulars = firstEntry.paymentMode === 0 ? 'Cash' : 'Bank'
            voucherType = 'Payment'
            break
          case 'DEBIT_NOTE':
            particulars = 'Purchase Return'
            voucherType = 'Debit Note'
            break
          case 'REFUND_RECEIVED':
            particulars = firstEntry.paymentMode === 0 ? 'Cash' : 'Bank'
            voucherType = 'Refund'
            break
          default:
            particulars = baseType.replace(/_/g, ' ')
            voucherType = baseType.replace(/_/g, ' ')
        }
      }
      
      // Create merged entry (keep first entry's metadata)
      merged.push({
        ...firstEntry,
        transaction_date: earliestDate,  // Preserves original position
        display_date: latestDate,        // Shows updated date in UI
        date: latestDate,  // For backward compatibility
        formattedDate: new Date(latestDate * 1000).toLocaleDateString('en-IN'),
        debit: netAmount > 0 ? netAmount : 0,        // Show in debit column only if NET is positive
        credit: netAmount < 0 ? Math.abs(netAmount) : 0,  // Show in credit column only if NET is negative
        // ✅ Update display names
        particulars,
        voucherType,
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
