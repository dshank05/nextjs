import { prisma } from './db'

/**
 * Customer Ledger Service
 * Manages customer transaction records for sales, returns, and receipts
 * Tracks customer balances and transaction history
 */

export type CustomerTransactionType =
  | 'SALE'              // Regular sales (money coming in)
  | 'SALEX'             // Tax-exempt sales (money coming in)
  | 'CREDIT_NOTE'       // Returns (money going out)
  | 'RECEIPT'           // Customer payments (money coming in)
  | 'RECEIPT_REVERSAL'  // Payment reversals (bounced checks)
  | 'SALE_ADJUSTMENT'   // Sale amount corrections
  | 'RECEIPT_ADJUSTMENT' // Payment amount corrections
  | 'REFUND_PAID'       // Refunds issued to customers

export interface CustomerLedgerEntry {
  customer_id: number
  transaction_date: number
  transaction_type: CustomerTransactionType
  reference_type: string
  reference_id: number
  reference_no: string
  payment_mode?: number
  payment_status?: number
  payment_date?: number
  debit: number      // Money coming in (sales, receipts)
  credit: number     // Money going out (returns, payments)
  balance: number
  notes?: string
  fy: number
}

/**
 * Create a new customer ledger entry
 */
export async function createCustomerLedgerEntry(entry: Omit<CustomerLedgerEntry, 'balance'>): Promise<void> {
  // Calculate running balance for the customer
  const balance = await calculateCustomerBalance(entry.customer_id, entry.transaction_date)

  // Adjust balance based on transaction type
  let finalBalance = balance
  if (entry.debit > 0) {
    finalBalance += entry.debit  // Money coming in increases balance
  }
  if (entry.credit > 0) {
    finalBalance -= entry.credit // Money going out decreases balance
  }

  await prisma.customer_ledger.create({
    data: {
      customer_id: entry.customer_id,
      transaction_date: entry.transaction_date,
      transaction_type: entry.transaction_type,
      reference_type: entry.reference_type,
      reference_id: entry.reference_id,
      reference_no: entry.reference_no,
      payment_mode: entry.payment_mode,
      payment_status: entry.payment_status,
      payment_date: entry.payment_date,
      debit: entry.debit,
      credit: entry.credit,
      balance: finalBalance,
      notes: entry.notes,
      fy: entry.fy
    }
  })
}

/**
 * Calculate customer balance up to a specific date
 */
export async function calculateCustomerBalance(customerId: number, upToDate?: number): Promise<number> {
  const where: any = { customer_id: customerId }
  if (upToDate) {
    where.transaction_date = { lte: upToDate }
  }

  const result = await prisma.customer_ledger.aggregate({
    where,
    _sum: {
      debit: true,
      credit: true
    },
    orderBy: { transaction_date: 'desc' },
    take: 1
  })

  const totalDebit = result._sum.debit || 0
  const totalCredit = result._sum.credit || 0

  return totalDebit - totalCredit
}

/**
 * Get customer ledger entries with pagination
 */
export async function getCustomerLedger(
  customerId: number,
  options: {
    page?: number
    limit?: number
    startDate?: number
    endDate?: number
    transactionType?: CustomerTransactionType
    fy?: number
  } = {}
) {
  const {
    page = 1,
    limit = 50,
    startDate,
    endDate,
    transactionType,
    fy
  } = options

  const skip = (page - 1) * limit

  const where: any = { customer_id: customerId }

  if (startDate && endDate) {
    where.transaction_date = {
      gte: startDate,
      lte: endDate
    }
  }

  if (transactionType) {
    where.transaction_type = transactionType
  }

  if (fy) {
    where.fy = fy
  }

  const [entries, total] = await Promise.all([
    prisma.customer_ledger.findMany({
      where,
      skip,
      take: limit,
      orderBy: { transaction_date: 'desc' },
      select: {
        id: true,
        transaction_date: true,
        transaction_type: true,
        reference_type: true,
        reference_id: true,
        reference_no: true,
        payment_mode: true,
        payment_status: true,
        payment_date: true,
        debit: true,
        credit: true,
        balance: true,
        notes: true,
        fy: true,
        created_at: true
      }
    }),
    prisma.customer_ledger.count({ where })
  ])

  return {
    entries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total
    }
  }
}

/**
 * Get customer outstanding balance
 */
export async function getCustomerOutstandingBalance(customerId: number): Promise<number> {
  return calculateCustomerBalance(customerId)
}

/**
 * Create ledger entry for sale transaction
 */
export async function recordSaleTransaction(
  customerId: number,
  invoiceId: number,
  invoiceNo: string,
  totalAmount: number,
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'SALE',
    reference_type: 'INVOICE',
    reference_id: invoiceId,
    reference_no: invoiceNo,
    debit: totalAmount,  // Money coming in from customer
    credit: 0,
    notes: notes || `Sale invoice ${invoiceNo}`,
    fy
  })
}

/**
 * Create ledger entry for tax-exempt sale transaction
 */
export async function recordSalexTransaction(
  customerId: number,
  invoicexId: number,
  invoiceNo: string,
  totalAmount: number,
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'SALEX',
    reference_type: 'INVOICEX',
    reference_id: invoicexId,
    reference_no: invoiceNo,
    debit: totalAmount,  // Money coming in from customer
    credit: 0,
    notes: notes || `Tax-exempt sale invoice ${invoiceNo}`,
    fy
  })
}

/**
 * Create ledger entry for return transaction (credit note)
 */
export async function recordReturnTransaction(
  customerId: number,
  returnId: number,
  returnNo: string,
  refundAmount: number,
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'CREDIT_NOTE',
    reference_type: 'SALE_RETURN',
    reference_id: returnId,
    reference_no: returnNo,
    debit: 0,
    credit: refundAmount,  // Money going out to customer
    notes: notes || `Return credit note ${returnNo}`,
    fy
  })
}

/**
 * Create ledger entry for customer receipt/payment
 */
export async function recordReceiptTransaction(
  customerId: number,
  receiptId: number,
  receiptNo: string,
  receiptAmount: number,
  transactionDate: number,
  paymentMode: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'RECEIPT',
    reference_type: 'RECEIPT',
    reference_id: receiptId,
    reference_no: receiptNo,
    payment_mode: paymentMode,
    debit: receiptAmount,  // Money coming in from customer
    credit: 0,
    notes: notes || `Customer receipt ${receiptNo}`,
    fy
  })
}

/**
 * Create ledger entry for receipt reversal (bounced check, etc.)
 */
export async function recordReceiptReversalTransaction(
  customerId: number,
  originalReceiptId: number,
  reversalId: number,
  reversalNo: string,
  reversalAmount: number,
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'RECEIPT_REVERSAL',
    reference_type: 'RECEIPT_REVERSAL',
    reference_id: reversalId,
    reference_no: reversalNo,
    debit: 0,
    credit: reversalAmount,  // Money going back to customer
    notes: notes || `Receipt reversal ${reversalNo} for original receipt ${originalReceiptId}`,
    fy
  })
}

/**
 * Create ledger entry for sale adjustment (correction)
 */
export async function recordSaleAdjustmentTransaction(
  customerId: number,
  invoiceId: number,
  invoiceNo: string,
  adjustmentAmount: number, // Positive = increase customer owes, Negative = decrease customer owes
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'SALE_ADJUSTMENT',
    reference_type: 'INVOICE',
    reference_id: invoiceId,
    reference_no: invoiceNo,
    debit: adjustmentAmount > 0 ? adjustmentAmount : 0,  // Customer owes more
    credit: adjustmentAmount < 0 ? Math.abs(adjustmentAmount) : 0,  // Customer owes less
    notes: notes || `Sale adjustment for invoice ${invoiceNo}`,
    fy
  })
}

/**
 * Create ledger entry for receipt adjustment (correction)
 */
export async function recordReceiptAdjustmentTransaction(
  customerId: number,
  originalReceiptId: number,
  adjustmentId: number,
  adjustmentNo: string,
  adjustmentAmount: number, // Positive = customer paid more, Negative = customer paid less
  transactionDate: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'RECEIPT_ADJUSTMENT',
    reference_type: 'RECEIPT',
    reference_id: adjustmentId,
    reference_no: adjustmentNo,
    debit: adjustmentAmount > 0 ? adjustmentAmount : 0,  // Customer paid more
    credit: adjustmentAmount < 0 ? Math.abs(adjustmentAmount) : 0,  // Customer paid less
    notes: notes || `Receipt adjustment ${adjustmentNo} for original receipt ${originalReceiptId}`,
    fy
  })
}

/**
 * Create ledger entry for refund paid to customer
 */
export async function recordRefundPaidTransaction(
  customerId: number,
  refundId: number,
  refundNo: string,
  refundAmount: number,
  transactionDate: number,
  paymentMode: number,
  fy: number,
  notes?: string
): Promise<void> {
  await createCustomerLedgerEntry({
    customer_id: customerId,
    transaction_date: transactionDate,
    transaction_type: 'REFUND_PAID',
    reference_type: 'REFUND',
    reference_id: refundId,
    reference_no: refundNo,
    payment_mode: paymentMode,
    debit: 0,
    credit: refundAmount,  // Money going out to customer
    notes: notes || `Refund paid ${refundNo}`,
    fy
  })
}

/**
 * Get customer transaction summary
 */
export async function getCustomerTransactionSummary(
  customerId: number,
  fy?: number
): Promise<{
  totalSales: number
  totalReturns: number
  totalReceipts: number
  outstandingBalance: number
  transactionCount: number
}> {
  const where: any = { customer_id: customerId }
  if (fy) {
    where.fy = fy
  }

  const summary = await prisma.customer_ledger.groupBy({
    by: ['transaction_type'],
    where,
    _sum: {
      debit: true,
      credit: true
    },
    _count: {
      id: true
    }
  })

  let totalSales = 0
  let totalReturns = 0
  let totalReceipts = 0
  let transactionCount = 0

  summary.forEach(item => {
    transactionCount += item._count.id
    const debit = item._sum.debit || 0
    const credit = item._sum.credit || 0

    switch (item.transaction_type) {
      case 'SALE':
      case 'SALEX':
        totalSales += debit
        break
      case 'CREDIT_NOTE':
        totalReturns += credit
        break
      case 'RECEIPT':
        totalReceipts += debit
        break
    }
  })

  const outstandingBalance = await getCustomerOutstandingBalance(customerId)

  return {
    totalSales,
    totalReturns,
    totalReceipts,
    outstandingBalance,
    transactionCount
  }
}

/**
 * Delete ledger entry (for corrections)
 */
export async function deleteCustomerLedgerEntry(entryId: number): Promise<void> {
  await prisma.customer_ledger.delete({
    where: { id: entryId }
  })
}

/**
 * Update ledger balances after a transaction correction
 * This is a complex operation that requires recalculating all balances
 * after the correction point
 */
export async function recalculateCustomerBalances(customerId: number, fromDate?: number): Promise<void> {
  // This is a complex operation that would require:
  // 1. Get all transactions after the fromDate
  // 2. Delete them
  // 3. Recreate them with correct balances
  // For now, we'll implement a simpler version

  const where: any = { customer_id: customerId }
  if (fromDate) {
    where.transaction_date = { gte: fromDate }
  }

  const entries = await prisma.customer_ledger.findMany({
    where,
    orderBy: { transaction_date: 'asc' }
  })

  let runningBalance = await calculateCustomerBalance(customerId, fromDate ? fromDate - 1 : undefined)

  for (const entry of entries) {
    if (entry.debit > 0) {
      runningBalance += entry.debit
    }
    if (entry.credit > 0) {
      runningBalance -= entry.credit
    }

    await prisma.customer_ledger.update({
      where: { id: entry.id },
      data: { balance: runningBalance }
    })
  }
}
