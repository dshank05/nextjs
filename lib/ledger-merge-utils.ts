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
  transaction_id?: number | null  // ✅ NEW: Links PAYMENT/REFUND with their adjustments
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

    // Map REFUND types to DEBIT_NOTE for purchase returns
    // But NOT for standalone refunds (reference_type='payment')
    if (baseType === 'REFUND_RECEIVED' && entry.referenceType === 'purchase_return') {
      baseType = 'DEBIT_NOTE'
    }
    
    // ✅ NEW: Normalize REFUND_RECEIVED to REFUND for standalone refunds
    // This allows REFUND_RECEIVED + REFUND_ADJUSTMENT to merge
    if (baseType === 'REFUND_RECEIVED' && entry.referenceType === 'payment') {
      baseType = 'REFUND'
    }
    
    // ✅ NEW: Also handle REFUND (after removing _ADJUSTMENT) for purchase returns
    if (baseType === 'REFUND' && entry.referenceType === 'purchase_return') {
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

    // ✅ Issue 4 FIX: Create group key with transaction_id for PAYMENT/REFUND entries
    // This keeps separate payments/refunds apart while allowing them to merge with their adjustments
    let key: string
    
    if ((baseType === 'PAYMENT' || baseType === 'REFUND' || baseType === 'REFUND_RECEIVED') && entry.transaction_id) {
      // PAYMENT/REFUND with transaction_id: Group by transaction_id
      // Example: Payment #149 and Payment #150 stay separate (different transaction_id)
      // But Payment #150 + its adjustment merge (same transaction_id=150)
      key = entry.referenceId && entry.referenceType
        ? `${baseType}-${entry.referenceType}-${entry.referenceId}-txn${entry.transaction_id}`
        : `solo-${entry.id}`
    } else {
      // Other transaction types (PURCHASE, DEBIT_NOTE) OR old data without transaction_id:
      // Use existing logic (group by reference_id only)
      key = entry.referenceId && entry.referenceType
        ? `${baseType}-${entry.referenceType}-${entry.referenceId}`
        : `solo-${entry.id}`
    }

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
          particulars = entry.paymentMode === 0 ? 'Cash' : 'Bank'
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

      // ✅ FIX: Find the BASE transaction (not _ADJUSTMENT) to use its date
      // This keeps the entry at its original chronological position
      const baseTransaction = group.find(e => !e.transactionType.includes('_ADJUSTMENT') && !e.transactionType.includes('_REVERSAL')) || group[0]
      const baseDate = baseTransaction.date

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
            particulars = baseTransaction.paymentMode === 0 ? 'Cash' : 'Bank'
            voucherType = 'Payment'
            break
          case 'DEBIT_NOTE':
            particulars = 'Purchase Return'
            voucherType = 'Debit Note'
            break
          case 'REFUND_RECEIVED':
            particulars = baseTransaction.paymentMode === 0 ? 'Cash' : 'Bank'
            voucherType = 'Refund'
            break
          default:
            particulars = baseType.replace(/_/g, ' ')
            voucherType = baseType.replace(/_/g, ' ')
        }
      }

      // ✅ Build merged notes/remarks - show NET amount, not breakdown
      const baseType = firstEntry.transactionType.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
      let mergedRemarks = baseTransaction.remarks || ''
      
      // For refunds, update to show final NET amount
      if (baseType === 'REFUND' || baseType === 'REFUND_RECEIVED') {
        const netAmountAbs = Math.abs(netAmount)
        mergedRemarks = `Direct refund received ₹${netAmountAbs.toLocaleString('en-IN')}`
      }
      // For payments, update to show final NET amount
      else if (baseType === 'PAYMENT') {
        const netAmountAbs = Math.abs(netAmount)
        mergedRemarks = `Payment made ₹${netAmountAbs.toLocaleString('en-IN')}`
      }
      // For purchases, keep original remarks
      else if (baseType === 'PURCHASE') {
        mergedRemarks = baseTransaction.remarks || 'Purchase'
      }

      // Create merged entry using BASE transaction for sorting, date, and metadata
      merged.push({
        ...baseTransaction,  // ✅ FIX: Use base transaction, not firstEntry
        transaction_date: baseDate,  // Use base transaction date for sorting
        display_date: baseDate,      // Use base transaction date for display too
        date: baseDate,              // Keep entry at original position
        formattedDate: new Date(baseDate * 1000).toLocaleDateString('en-IN'),
        debit: netAmount > 0 ? netAmount : 0,        // Show in debit column only if NET is positive
        credit: netAmount < 0 ? Math.abs(netAmount) : 0,  // Show in credit column only if NET is negative
        paymentMode: baseTransaction.paymentMode,    // Use base transaction payment mode
        // ✅ Update display names
        particulars,
        voucherType,
        remarks: mergedRemarks,  // ✅ Show NET amount in remarks
        // Balance will be recalculated later
        transactionType: baseTransaction.transactionType.replace('_ADJUSTMENT', '').replace('_REVERSAL', '')
      })
    }
  })

  // Sort by date to maintain chronological order
  // ✅ Filter out entries that NET to zero (deleted/cancelled transactions)
  return merged
    .filter(entry => entry.debit !== 0 || entry.credit !== 0)  // Keep only non-zero entries
    .sort((a, b) => {
      // Primary sort: by date
      const dateDiff = (a.transaction_date || a.date) - (b.transaction_date || b.date)
      if (dateDiff !== 0) return dateDiff

      // ✅ Secondary sort: by ID (matches backend ORDER BY logic)
      // This ensures PURCHASE (id:418) shows before PAYMENT (id:419) on same date
      return a.id - b.id
    })
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
