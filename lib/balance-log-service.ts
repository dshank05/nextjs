export type BalanceColumn = 'total_paid' | 'total_allocated' | 'total_refunded' | 'total_refund_allocated';

export type SourceType = 
  | 'purchase_create' | 'purchase_edit' | 'purchase_delete'
  | 'return_edit' | 'return_delete'
  | 'payment_create' | 'payment_edit' | 'payment_delete'
  | 'refund_create' | 'refund_edit' | 'refund_delete';

export interface BalanceLogEntry {
  vendor_id: number;
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

export class BalanceLogService {
  /**
   * Log a balance column change
   * Should be called AFTER the balance update in the same transaction
   */
  static async logChange(
    tx: any,  // Prisma transaction
    entry: BalanceLogEntry
  ): Promise<void> {
    await tx.vendor_balance_logs.create({
      data: {
        vendor_id: entry.vendor_id,
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

export const balanceLogService = new BalanceLogService();
