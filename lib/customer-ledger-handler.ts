/**
 * Customer Ledger Handler Service
 * Handles ledger entry creation for all transaction types and status changes
 * Centralizes ledger logic to eliminate duplication across APIs
 */

import { CustomerLedgerEntryData } from './customer-ledger-service';

export interface ChangeSet {
  oldStatus: number;
  newStatus: number;
  oldTotal: number;
  newTotal: number;
  customerId: number;
  invoiceId?: number;
  returnId?: number;
  invoiceNo?: string;
  creditNoteNo?: string;
  paymentMode?: number;
  paymentDate?: number;
  returnDate?: number;
  fy: number;
  totalAllocated?: number;
  isTypeA?: boolean;
  hasPaymentLedger?: boolean;
  amountChanged: boolean;
  hasExistingCreditNote?: boolean;
  currentBalance?: {
    total_paid: number;
    total_allocated: number;
    total_refunded: number;
    total_refund_allocated: number;
  };
}

export interface LedgerOperation {
  entry: CustomerLedgerEntryData;
  description: string;
  checkExisting?: {
    transactionType: string;
    useAdjustmentIfExists: boolean;
  };
}

export interface LedgerUpdateOperation {
  description: string;
  where: {
    reference_type?: 'sale' | 'salex' | 'sale_return' | 'salex_return' | 'payment';
    reference_id?: number;
    transaction_type: 'SALE' | 'PAYMENT_RECEIVED' | 'CREDIT_NOTE' | 'REFUND';
    transaction_id?: number;
  };
  data: {
    debit?: number;
    credit?: number;
    notes?: string;
  };
}

export interface LedgerDeleteOperation {
  description: string;
  where: {
    reference_type?: 'sale' | 'salex' | 'sale_return' | 'salex_return' | 'payment';
    reference_id?: number;
    transaction_type: 'SALE' | 'PAYMENT_RECEIVED' | 'CREDIT_NOTE' | 'REFUND';
    transaction_id?: number;
  };
}

export class CustomerLedgerHandler {
  /**
   * Calculate advance breakdown and payment breakdown
   * Helper for payment ledger notes
   */
  private calculateAdvanceBreakdown(
    total: number,
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    }
  ): { advanceUsed: number; newPayment: number; hasAdvance: boolean } {
    // Include both unallocated payments AND unallocated refunds
    const advanceBalance = currentBalance 
      ? (Number(currentBalance.total_paid) - Number(currentBalance.total_allocated)) +
        (Number(currentBalance.total_refunded) - Number(currentBalance.total_refund_allocated))
      : 0;
    
    const advanceUsed = Math.min(Math.max(0, advanceBalance), total);
    const newPayment = total - advanceUsed;
    
    return {
      advanceUsed,
      newPayment,
      hasAdvance: advanceUsed > 0
    };
  }
  
  /**
   * Generate payment notes with advance information
   */
  private generatePaymentNotes(
    invoiceNo: string,
    total: number,
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    }
  ): string {
    const { advanceUsed, newPayment, hasAdvance } = this.calculateAdvanceBreakdown(total, currentBalance);
    
    if (advanceUsed >= total) {
      return `Payment for sale ${invoiceNo} (fully from ₹${advanceUsed.toFixed(2)} advance)`;
    } else if (hasAdvance) {
      return `Payment for sale ${invoiceNo} (₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment)`;
    } else {
      return `Payment received for sale ${invoiceNo}`;
    }
  }
  
  /**
   * Get ledger operations for sale/salex status changes
   * Handles all 9 cases for sale edit
   * Returns mixed CREATE/UPDATE/DELETE operations
   */
  getSaleLedgerOps(changes: ChangeSet): {
    creates: LedgerOperation[];
    updates: LedgerUpdateOperation[];
    deletes: LedgerDeleteOperation[];
  } {
    const creates: LedgerOperation[] = [];
    const updates: LedgerUpdateOperation[] = [];
    const deletes: LedgerDeleteOperation[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    const timestamp = Math.floor(Date.now() / 1000);
    
    switch (statusChange) {
      case '1→0': // Paid → Unpaid
        // DELETE PAYMENT_RECEIVED entries (was PAYMENT_REVERSAL)
        if (changes.hasPaymentLedger) {
          deletes.push({
            description: 'Delete payment entries (unmarking)',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'PAYMENT_RECEIVED'
            }
          });
        }
        
        // If amount changed, UPDATE SALE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update sale amount',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '0→1': // Unpaid → Paid
        // If amount changed, UPDATE SALE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update sale amount before marking paid',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        
        // Create payment with advance information
        const breakdown01 = this.calculateAdvanceBreakdown(changes.newTotal, changes.currentBalance);
        
        if (breakdown01.newPayment > 0) {
          creates.push({
            entry: {
              customer_id: changes.customerId,
              transaction_date: changes.paymentDate || timestamp,
              transaction_type: 'PAYMENT_RECEIVED',
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              reference_no: changes.invoiceNo!,
              debit: breakdown01.newPayment,  // Only NEW payment, not full total
              credit: 0,
              payment_mode: changes.paymentMode,
              payment_status: 1,
              payment_date: changes.paymentDate || timestamp,
              notes: this.generatePaymentNotes(changes.invoiceNo!, changes.newTotal, changes.currentBalance),
              fy: changes.fy
            },
            description: 'Payment received creation',
            checkExisting: {
              transactionType: 'PAYMENT_RECEIVED',
              useAdjustmentIfExists: true
            }
          });
        }
        break;
        
      case '2→1': // Partial → Paid
        const remainingAmount = changes.newTotal - (changes.totalAllocated || 0);
        
        // If amount changed, UPDATE SALE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update sale amount before marking fully paid',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        
        // Create payment for remaining amount with advance information
        const breakdown21 = this.calculateAdvanceBreakdown(remainingAmount, changes.currentBalance);
        
        if (breakdown21.newPayment > 0) {
          creates.push({
            entry: {
              customer_id: changes.customerId,
              transaction_date: changes.paymentDate || timestamp,
              transaction_type: 'PAYMENT_RECEIVED',
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              reference_no: changes.invoiceNo!,
              debit: breakdown21.newPayment,  // Only NEW payment, not full remaining
              credit: 0,
              payment_mode: changes.paymentMode,
              payment_status: 1,
              payment_date: changes.paymentDate || timestamp,
              notes: this.generatePaymentNotes(changes.invoiceNo!, remainingAmount, changes.currentBalance),
              fy: changes.fy
            },
            description: 'Payment for remaining amount',
            checkExisting: {
              transactionType: 'PAYMENT_RECEIVED',
              useAdjustmentIfExists: true
            }
          });
        }
        break;
        
      case '2→0': // Partial → Unpaid
        // DELETE PAYMENT_RECEIVED entries (was PAYMENT_REVERSAL)
        if (changes.hasPaymentLedger) {
          deletes.push({
            description: 'Delete all payment entries (unmarking partial)',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'PAYMENT_RECEIVED'
            }
          });
        }
        
        // If amount changed, UPDATE SALE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update sale amount after unmarking',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '1→2': // Paid → Partial (amount increased)
        // UPDATE SALE (was SALE_ADJUSTMENT)
        updates.push({
          description: 'Update sale amount (paid to partial)',
          where: {
            reference_type: changes.invoiceId ? 'sale' : 'salex',
            reference_id: changes.invoiceId!,
            transaction_type: 'SALE'
          },
          data: {
            debit: changes.newTotal,
            notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
          }
        });
        break;
        
      case '0→0': // Unpaid → Unpaid (amount change)
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged) {
          // UPDATE SALE (was SALE_ADJUSTMENT)
          updates.push({
            description: 'Update sale amount',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '1→1': // Paid → Paid (amount change)
        if (changes.amountChanged) {
          // UPDATE SALE (was SALE_ADJUSTMENT)
          updates.push({
            description: 'Update sale amount',
            where: {
              reference_type: changes.invoiceId ? 'sale' : 'salex',
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
          
          // If Type B (no allocations), UPDATE PAYMENT_RECEIVED (was PAYMENT_ADJUSTMENT)
          if (!changes.isTypeA && changes.hasPaymentLedger) {
            updates.push({
              description: 'Update payment amount for Type B sale',
              where: {
                reference_type: changes.invoiceId ? 'sale' : 'salex',
                reference_id: changes.invoiceId!,
                transaction_type: 'PAYMENT_RECEIVED'
              },
              data: {
                debit: changes.newTotal,
                notes: `Payment updated to ₹${changes.newTotal} for sale ${changes.invoiceNo}`
              }
            });
          }
        }
        break;
    }
    
    return { creates, updates, deletes };
  }
  
  /**
   * Get ledger operations for return status changes
   * Returns mixed CREATE/UPDATE/DELETE operations
   */
  getReturnLedgerOps(changes: ChangeSet): {
    creates: LedgerOperation[];
    updates: LedgerUpdateOperation[];
    deletes: LedgerDeleteOperation[];
  } {
    const creates: LedgerOperation[] = [];
    const updates: LedgerUpdateOperation[] = [];
    const deletes: LedgerDeleteOperation[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    const returnDate = changes.returnDate || Math.floor(Date.now() / 1000);
    
    switch (statusChange) {
      case '0→1': // Incomplete → Complete
      case '2→1': // Partial → Complete
        // CREATE CREDIT_NOTE if it doesn't exist (first time reaching status=1)
        if (!changes.hasExistingCreditNote) {
          creates.push({
            entry: {
              customer_id: changes.customerId,
              transaction_date: returnDate,
              transaction_type: 'CREDIT_NOTE',
              reference_type: changes.returnId ? 'sale_return' : 'salex_return',
              reference_id: changes.returnId!,
              reference_no: changes.creditNoteNo!,
              debit: 0,
              credit: changes.newTotal,
              notes: `Credit note ${changes.creditNoteNo} - return marked as complete`,
              fy: changes.fy
            },
            description: 'Create CREDIT_NOTE entry (first time complete)'
          });
        }
        break;
        
      case '1→0': // Complete → Incomplete
        // DELETE REFUND_REVERSAL entries (was CREATE)
        deletes.push({
          description: 'Delete refund reversal entries (unmarking)',
          where: {
            reference_type: changes.returnId ? 'sale_return' : 'salex_return',
            reference_id: changes.returnId!,
            transaction_type: 'CREDIT_NOTE'
          }
        });
        
        // If amount changed, UPDATE CREDIT_NOTE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update CREDIT_NOTE amount',
            where: {
              reference_type: changes.returnId ? 'sale_return' : 'salex_return',
              reference_id: changes.returnId!,
              transaction_type: 'CREDIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Credit note ${changes.creditNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '2→0': // Partial → Incomplete
        // DELETE REFUND_REVERSAL entries (was CREATE)
        if (changes.hasExistingCreditNote) {
          deletes.push({
            description: 'Delete refund reversal entries (partial to incomplete)',
            where: {
              reference_type: changes.returnId ? 'sale_return' : 'salex_return',
              reference_id: changes.returnId!,
              transaction_type: 'CREDIT_NOTE'
            }
          });
        }
        
        // If amount changed, UPDATE CREDIT_NOTE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update CREDIT_NOTE amount',
            where: {
              reference_type: changes.returnId ? 'sale_return' : 'salex_return',
              reference_id: changes.returnId!,
              transaction_type: 'CREDIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Credit note ${changes.creditNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '0→0': // Incomplete → Incomplete (amount change)
      case '1→1': // Complete → Complete (amount change)
      case '2→2': // Partial → Partial (amount change)
      case '1→2': // Complete → Partial (amount increase)
      case '0→2': // Incomplete → Partial
        // UPDATE CREDIT_NOTE for amount changes
        if (changes.amountChanged && changes.hasExistingCreditNote) {
          updates.push({
            description: 'Update CREDIT_NOTE amount',
            where: {
              reference_type: changes.returnId ? 'sale_return' : 'salex_return',
              reference_id: changes.returnId!,
              transaction_type: 'CREDIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Credit note ${changes.creditNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
    }
    
    return { creates, updates, deletes };
  }
}

// Export singleton instance
export const customerLedgerHandler = new CustomerLedgerHandler();
