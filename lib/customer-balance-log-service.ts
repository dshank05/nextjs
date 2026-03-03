export type BalanceColumn = 'total_paid' | 'total_allocated' | 'total_refunded' | 'total_refund_allocated';

export type SourceType = 
  | 'sale_create' | 'sale_edit' | 'sale_delete'
  | 'salex_create' | 'salex_edit' | 'salex_delete'
  | 'return_create' | 'return_edit' | 'return_delete'
  | 'payment_received_create' | 'payment_received_edit' | 'payment_received_delete'
  | 'refund_issued_create' | 'refund_issued_edit' | 'refund_issued_delete'
  | 'status_change';

export interface BalanceLogEntry {
  customer_id: number;
  column_name: BalanceColumn;
  change_amount: number;
  old_value: number;
  new_value: number;
  source_type: SourceType;
  source_id: number;
  reference_no?: string;
  created_by?: number;
  notes?: string;
}

export class CustomerBalanceLogService {
  /**
   * Log a balance column change
   * Should be called AFTER the balance update in the same transaction
   */
  static async logChange(
    tx: any,  // Prisma transaction
    entry: BalanceLogEntry
  ): Promise<void> {
    await tx.customer_balance_logs.create({
      data: {
        customer_id: entry.customer_id,
        column_name: entry.column_name,
        change_amount: entry.change_amount,
        old_value: entry.old_value,
        new_value: entry.new_value,
        source_type: entry.source_type,
        source_id: entry.source_id,
        reference_no: entry.reference_no,
        created_by: entry.created_by,
        notes: entry.notes
      }
    });
  }

  /**
   * Log multiple changes at once (for operations that update multiple columns)
   */
  static async logMultipleChanges(
    tx: any,
    entries: BalanceLogEntry[]
  ): Promise<void> {
    await Promise.all(
      entries.map(entry => this.logChange(tx, entry))
    );
  }
}

export const customerBalanceLogService = new CustomerBalanceLogService();
