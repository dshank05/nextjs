import { prisma } from './db'

/**
 * Customer Ledger Service
 * Manages customer transaction records for sales, returns, and receipts
 * Tracks customer balances and transaction history
 *
 * Only the CustomerLedgerService class is live. Sixteen older exports
 * (createCustomerLedgerEntry, recordSaleTransaction, getCustomerLedger, ...)
 * had no caller - three were imported and never used - and read as the
 * authoritative API (SA audit, L-40 class). Removed in Phase 5 Block D.
 */

export interface CustomerLedgerEntryData {
  customer_id: number;
  transaction_date: number;
  transaction_type: 'SALE' | 'CREDIT_NOTE' | 'PAYMENT_RECEIVED' | 'REFUND' | 
                    'PAYMENT_REVERSAL' | 'REFUND_REVERSAL' | 
                    'SALE_ADJUSTMENT' | 'PAYMENT_ADJUSTMENT';
  reference_type?: 'sale' | 'salex' | 'sale_return' | 'salex_return' | 'payment';
  reference_id?: number;
  reference_no?: string;
  payment_mode?: number;
  payment_status?: number;
  payment_date?: number;
  /** What the customer owes more: a sale, a refund paid out. */
  debit: number;
  /** What the customer owes less: a payment received, a credit note. */
  credit: number;
  notes?: string;
  fy: number;
  transaction_id?: number; // payment_id or refund_id
}

export class CustomerLedgerService {
  /**
   * Create ledger entry (transaction-safe)
   * Used by customer-transaction-handler
   */
  async createEntry(entry: CustomerLedgerEntryData, tx?: any): Promise<void> {
    const db = tx || prisma;
    
    // Get latest balance
    const latestBalance = await this.getLatestBalance(entry.customer_id, tx);
    
    // Calculate new balance
    const newBalance = latestBalance + entry.debit - entry.credit;
    
    await db.customer_ledger.create({
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
        balance: newBalance,
        notes: entry.notes,
        fy: entry.fy,
        transaction_id: entry.transaction_id
      }
    });
  }
  
  /**
   * Get latest balance for customer
   * Used by customer-transaction-handler
   */
  async getLatestBalance(customerId: number, tx?: any): Promise<number> {
    const db = tx || prisma;
    
    const latestEntry = await db.customer_ledger.findFirst({
      where: { customer_id: customerId },
      orderBy: { id: 'desc' },
      select: { balance: true }
    });
    
    return latestEntry ? Number(latestEntry.balance) : 0;
  }
  
  /**
   * Recalculate balances after a specific entry
   * Used after UPDATE or DELETE operations
   */
  async recalculateBalancesAfter(
    customerId: number,
    entryId: number,
    tx?: any
  ): Promise<void> {
    const db = tx || prisma;
    
    // Get all entries after the specified entry
    const entries = await db.customer_ledger.findMany({
      where: {
        customer_id: customerId,
        id: { gte: entryId }
      },
      orderBy: { id: 'asc' }
    });
    
    if (entries.length === 0) return;
    
    // Get balance before first entry
    let runningBalance = 0;
    if (entryId > 0) {
      const previousEntry = await db.customer_ledger.findFirst({
        where: {
          customer_id: customerId,
          id: { lt: entryId }
        },
        orderBy: { id: 'desc' },
        select: { balance: true }
      });
      
      runningBalance = previousEntry ? Number(previousEntry.balance) : 0;
    }
    
    // Recalculate and update each entry
    for (const entry of entries) {
      runningBalance = runningBalance + Number(entry.debit) - Number(entry.credit);
      
      await db.customer_ledger.update({
        where: { id: entry.id },
        data: { balance: runningBalance }
      });
    }
  }
  
  /**
   * Get ledger entries for customer
   * Used by customer-transaction-handler
   */
  async getEntries(
    customerId: number,
    filters?: {
      referenceType?: string;
      referenceId?: number;
      transactionType?: string;
      fy?: number;
    },
    tx?: any
  ): Promise<any[]> {
    const db = tx || prisma;
    
    const where: any = { customer_id: customerId };
    
    if (filters) {
      if (filters.referenceType) where.reference_type = filters.referenceType;
      if (filters.referenceId) where.reference_id = filters.referenceId;
      if (filters.transactionType) where.transaction_type = filters.transactionType;
      if (filters.fy) where.fy = filters.fy;
    }
    
    return await db.customer_ledger.findMany({
      where,
      orderBy: { id: 'asc' }
    });
  }
}

// Export singleton instance
export const customerLedgerService = new CustomerLedgerService();
