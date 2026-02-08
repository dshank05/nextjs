import { prisma } from './db'

/**
 * Vendor Ledger Service
 * Manages double-entry accounting for vendor transactions
 * Debit: You owe vendor (purchases)
 * Credit: Vendor owes you (debit notes/returns)
 */

export interface LedgerEntryData {
  vendor_id: number
  transaction_date: number
  transaction_type: 'PURCHASE' | 'DEBIT_NOTE' | 'DEBIT_NOTE_REVERSAL' | 'PAYMENT' | 'REFUND_RECEIVED' | 'PAYMENT_REVERSAL' | 'REFUND_REVERSAL' | 'PURCHASE_ADJUSTMENT' | 'PAYMENT_ADJUSTMENT' | 'REFUND_ADJUSTMENT'
  reference_type?: 'purchase' | 'purchase_return' | 'payment'
  reference_id?: number
  reference_no?: string
  payment_mode?: number
  payment_status?: number
  payment_date?: number
  debit: number
  credit: number
  notes?: string
  fy: number
}

export class LedgerService {
  /**
   * Create a new ledger entry
   * @param data - Ledger entry data
   * @param client - Prisma client (transaction or global) - REQUIRED for transaction safety
   */
  async createEntry(data: LedgerEntryData, client: any): Promise<void> {
    // Get current balance for this vendor
    const currentBalance = await this.getLatestBalance(data.vendor_id, client)
    
    // Calculate new balance
    // Debit increases balance (you owe more)
    // Credit decreases balance (you owe less)
    const newBalance = currentBalance + data.debit - data.credit

    // Get vendor name for "other" vendors (vendor_id = 0)
    let entryNotes = data.notes || ''
    if (data.vendor_id === 0 && data.reference_no) {
      const billToRecord = await prisma.bill_to.findFirst({
        where: { invoice_no: parseInt(data.reference_no) },
        select: { vendor_name: true }
      })
      if (billToRecord) {
        entryNotes = billToRecord.vendor_name
      }
    }

    // Create ledger entry using provided client
    await client.vendor_ledger.create({
      data: {
        vendor_id: data.vendor_id,
        transaction_date: data.transaction_date,
        transaction_type: data.transaction_type,
        reference_type: data.reference_type,
        reference_id: data.reference_id,
        reference_no: data.reference_no,
        payment_mode: data.payment_mode,
        payment_status: data.payment_status,
        payment_date: data.payment_date,
        debit: data.debit,
        credit: data.credit,
        balance: newBalance,
        notes: entryNotes,
        fy: data.fy
      }
    })
  }

  /**
   * Get latest balance for a vendor
   * @param vendor_id - Vendor ID
   * @param client - Prisma client (transaction or global) - REQUIRED for transaction safety
   */
  async getLatestBalance(vendor_id: number, client: any): Promise<number> {
    const latest = await client.vendor_ledger.findFirst({
      where: { vendor_id },
      orderBy: { id: 'desc' },
      select: { balance: true }
    })
    
    return latest?.balance || 0
  }

  /**
   * Get ledger entries for a vendor
   */
  async getVendorLedger(
    vendor_id: number,
    options?: {
      fy?: number
      startDate?: number
      endDate?: number
      limit?: number
    }
  ) {
    const where: any = { vendor_id }
    
    if (options?.fy) {
      where.fy = options.fy
    }
    
    if (options?.startDate || options?.endDate) {
      const dateRange: any = {}
      if (options.startDate) {
        dateRange.gte = options.startDate
      }
      if (options.endDate) {
        dateRange.lte = options.endDate
      }
      where.transaction_date = dateRange
    }

    return await prisma.vendor_ledger.findMany({
      where,
      orderBy: { transaction_date: 'desc' },
      take: options?.limit
      // Note: vendor_ledger doesn't have a relation to vendor_details in schema
      // This is intentional to support vendor_id = 0 (other vendors)
    })
  }

  /**
   * Get vendor outstanding balance (what you owe)
   * NOTE: This method uses global prisma client - only for read operations outside transactions
   */
  async getVendorOutstanding(vendor_id: number): Promise<number> {
    return await this.getLatestBalance(vendor_id, prisma)
  }

  /**
   * Get all vendors with outstanding balances
   */
  async getAllOutstanding(fy?: number) {
    const query: any = {}
    if (fy) {
      query.fy = fy
    }

    // Get latest entry for each vendor
    const vendors = await prisma.vendor_ledger.groupBy({
      by: ['vendor_id'],
      where: query,
      _max: {
        id: true
      }
    })

    // Get the actual entries with balances
    const outstandingList = await Promise.all(
      vendors.map(async (v) => {
        const entry = await prisma.vendor_ledger.findUnique({
          where: { id: v._max.id! }
        })
        return {
          vendor_id: v.vendor_id,
          balance: entry?.balance || 0
        }
      })
    )

    // Filter to only non-zero balances
    return outstandingList.filter(item => item.balance !== 0)
  }

  /**
   * Create purchase ledger entry
   * @param purchase - Purchase data
   * @param client - Prisma client (transaction or global) - REQUIRED for transaction safety
   */
  async createPurchaseEntry(purchase: {
    id: number
    vendor_id: number
    invoice_no: number
    invoice_date: number
    total: number
    fy: number
  }, client: any) {
    await this.createEntry({
      vendor_id: purchase.vendor_id || 0,
      transaction_date: purchase.invoice_date,
      transaction_type: 'PURCHASE',
      reference_type: 'purchase',
      reference_id: purchase.id,
      reference_no: purchase.invoice_no.toString(),
      debit: purchase.total,
      credit: 0,
      fy: purchase.fy
    }, client)
  }

  /**
   * Create debit note ledger entry
   * @param purchaseReturn - Purchase return data
   * @param client - Prisma client (transaction or global) - REQUIRED for transaction safety
   */
  async createDebitNoteEntry(purchaseReturn: {
    id: number
    vendor_id: number
    debit_note_no: string
    return_date: number
    total_amount: number
    total_tax: number
    packing_forwarding_amount: number
    freight_amount: number
    fy: number
  }, client: any) {
    const totalCredit = 
      purchaseReturn.total_amount + 
      purchaseReturn.total_tax + 
      purchaseReturn.packing_forwarding_amount + 
      purchaseReturn.freight_amount

    await this.createEntry({
      vendor_id: purchaseReturn.vendor_id || 0,
      transaction_date: purchaseReturn.return_date,
      transaction_type: 'DEBIT_NOTE',
      reference_type: 'purchase_return',
      reference_id: purchaseReturn.id,
      reference_no: purchaseReturn.debit_note_no,
      debit: 0,
      credit: totalCredit,
      fy: purchaseReturn.fy
    }, client)
  }

  /**
   * Update debit note ledger entry (for return edits)
   */
  async updateDebitNoteEntry(params: {
    vendor_id: number
    reference_id: number
    reference_no: string
    new_total_amount: number
    new_total_tax: number
    fy: number
  }) {
    // Find the existing DEBIT_NOTE entry
    const existingEntry = await prisma.vendor_ledger.findFirst({
      where: {
        vendor_id: params.vendor_id,
        transaction_type: 'DEBIT_NOTE',
        reference_type: 'purchase_return',
        reference_id: params.reference_id
      },
      orderBy: { id: 'desc' }
    })

    if (!existingEntry) {
      throw new Error(`DEBIT_NOTE entry not found for return ${params.reference_no}`)
    }

    // Calculate new credit amount
    const newCredit = params.new_total_amount + params.new_total_tax
    const creditDifference = newCredit - existingEntry.credit

    // If no change in amount, skip update
    if (creditDifference === 0) {
      return
    }

    // Update the DEBIT_NOTE entry with new credit
    const newBalance = existingEntry.balance - creditDifference
    await prisma.vendor_ledger.update({
      where: { id: existingEntry.id },
      data: {
        credit: newCredit,
        balance: newBalance
      }
    })

    // Recalculate balances for all subsequent entries
    await this.recalculateBalancesAfter(params.vendor_id, existingEntry.id, prisma)
  }

  /**
   * Recalculate balances for all entries after a specific entry
   * PUBLIC: Called by transactionHandler after creating adjustment entries
   */
  async recalculateBalancesAfter(vendor_id: number, after_entry_id: number, client: any) {
    // Get all entries after the modified one, ordered by ID
    const subsequentEntries = await client.vendor_ledger.findMany({
      where: {
        vendor_id,
        id: { gt: after_entry_id }
      },
      orderBy: { id: 'asc' }
    })

    // Get the balance from the modified entry
    const modifiedEntry = await client.vendor_ledger.findUnique({
      where: { id: after_entry_id },
      select: { balance: true }
    })

    let runningBalance = modifiedEntry?.balance || 0

    // Update each subsequent entry
    for (const entry of subsequentEntries) {
      runningBalance = runningBalance + entry.debit - entry.credit
      await client.vendor_ledger.update({
        where: { id: entry.id },
        data: { balance: runningBalance }
      })
    }
  }
}

// Export singleton instance
export const ledgerService = new LedgerService()
