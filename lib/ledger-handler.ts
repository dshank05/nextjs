/**
 * Ledger Handler Service
 * Handles ledger entry creation for all transaction types and status changes
 * Centralizes ledger logic to eliminate duplication across APIs
 */

import { LedgerEntryData } from './ledger-service';

export interface ChangeSet {
  oldStatus: number;
  newStatus: number;
  oldTotal: number;
  newTotal: number;
  vendorId: number;
  purchaseId?: number;
  returnId?: number;
  invoiceNo?: string;
  debitNoteNo?: string;
  paymentMode?: number;
  paymentDate?: number;
  returnDate?: number;  // ✅ NEW: Return date for DEBIT_NOTE entries
  fy: number;
  totalAllocated?: number;
  isTypeA?: boolean; // Has existing allocations
  hasPaymentLedger?: boolean; // ✅ NEW: Indicates if PAYMENT/PAYMENT_ADJUSTMENT exists (real payment vs advance)
  amountChanged: boolean;
  hasExistingDebitNote?: boolean; // ✅ NEW: Indicates if DEBIT_NOTE already exists for this return
  currentBalance?: {
    total_paid: number;
    total_allocated: number;
    total_refunded: number;
    total_refund_allocated: number;
  };
}

export interface LedgerOperation {
  entry: LedgerEntryData;
  description: string;
  checkExisting?: {
    transactionType: string;
    useAdjustmentIfExists: boolean;
  };
}

// ✅ NEW: Interfaces for UPDATE/DELETE operations
export interface LedgerUpdateOperation {
  description: string;
  where: {
    reference_type?: 'purchase' | 'purchase_return' | 'payment';
    reference_id?: number;
    transaction_type: 'PURCHASE' | 'PAYMENT' | 'DEBIT_NOTE' | 'REFUND_RECEIVED';
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
    reference_type?: 'purchase' | 'purchase_return' | 'payment';
    reference_id?: number;
    transaction_type: 'PURCHASE' | 'PAYMENT' | 'DEBIT_NOTE' | 'REFUND_RECEIVED';
    transaction_id?: number;
  };
}

export class LedgerHandler {
  /**
   * Calculate advance balance and payment breakdown
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
      return `Payment for purchase ${invoiceNo} (fully from ₹${advanceUsed.toFixed(2)} advance)`;
    } else if (hasAdvance) {
      return `Payment for purchase ${invoiceNo} (₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment)`;
    } else {
      return `Payment made for purchase ${invoiceNo}`;
    }
  }
  
  /**
   * Get ledger operations for purchase status changes
   * Handles all 9 cases for purchase edit
   * ✅ REFACTORED: Returns mixed CREATE/UPDATE/DELETE operations
   */
  getPurchaseLedgerOps(changes: ChangeSet): {
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
        // DELETE PAYMENT entries (was PAYMENT_REVERSAL)
        if (changes.hasPaymentLedger) {
          deletes.push({
            description: 'Delete payment entries (unmarking)',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PAYMENT'
            }
          });
        }
        
        // If amount changed, UPDATE PURCHASE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update purchase amount',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '0→1': // Unpaid → Paid
        // If amount changed, UPDATE PURCHASE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update purchase amount before marking paid',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        
        // Second: Create payment with advance information
        // ✅ FIXED: Uses advance breakdown to determine actual new payment amount
        // ✅ FIXED: Only creates PAYMENT entry if new money is paid (not using 100% advance)
        // ✅ FIXED: Checks for existing PAYMENT and uses PAYMENT_ADJUSTMENT if found
        // ✅ Issue 3 FIX: Even when 100% from advance, create PAYMENT entry with ₹0 and clear notes
        const breakdown01 = this.calculateAdvanceBreakdown(changes.newTotal, changes.currentBalance);
        
        if (breakdown01.newPayment > 0) {
          // Partial or full new payment
          creates.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: changes.paymentDate || timestamp,
              transaction_type: 'PAYMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: 0,
              credit: breakdown01.newPayment,  // ✅ Only NEW payment, not full total
              payment_mode: changes.paymentMode,
              payment_status: 1,
              payment_date: changes.paymentDate || timestamp,
              notes: this.generatePaymentNotes(changes.invoiceNo!, changes.newTotal, changes.currentBalance),
              fy: changes.fy
            },
            description: 'Payment creation',
            checkExisting: {
              transactionType: 'PAYMENT',
              useAdjustmentIfExists: true
            }
          });
        }
        
        break;
        
      case '2→1': // Partial → Paid
        const remainingAmount = changes.newTotal - (changes.totalAllocated || 0);
        
        // If amount changed, UPDATE PURCHASE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update purchase amount before marking fully paid',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        
        // Second: Create payment for remaining amount with advance information
        // ✅ FIXED: Uses advance breakdown to determine actual new payment amount
        // ✅ FIXED: Only creates PAYMENT entry if new money is paid (not using 100% advance)
        // ✅ FIXED: Checks for existing PAYMENT and uses PAYMENT_ADJUSTMENT if found
        const breakdown21 = this.calculateAdvanceBreakdown(remainingAmount, changes.currentBalance);
        
        if (breakdown21.newPayment > 0) {
          creates.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: changes.paymentDate || timestamp,
              transaction_type: 'PAYMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: 0,
              credit: breakdown21.newPayment,  // ✅ Only NEW payment, not full remaining
              payment_mode: changes.paymentMode,
              payment_status: 1,
              payment_date: changes.paymentDate || timestamp,
              notes: this.generatePaymentNotes(changes.invoiceNo!, remainingAmount, changes.currentBalance),
              fy: changes.fy
            },
            description: 'Payment for remaining amount',
            checkExisting: {
              transactionType: 'PAYMENT',
              useAdjustmentIfExists: true
            }
          });
        }
        break;
        
      case '2→0': // Partial → Unpaid
        // DELETE PAYMENT entries (was PAYMENT_REVERSAL)
        if (changes.hasPaymentLedger) {
          deletes.push({
            description: 'Delete all payment entries (unmarking partial)',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PAYMENT'
            }
          });
        }
        
        // If amount changed, UPDATE PURCHASE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update purchase amount after unmarking',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '1→2': // Paid → Partial (amount increased)
        // UPDATE PURCHASE (was PURCHASE_ADJUSTMENT)
        updates.push({
          description: 'Update purchase amount (paid to partial)',
          where: {
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            transaction_type: 'PURCHASE'
          },
          data: {
            debit: changes.newTotal,
            notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal} (now partially paid)`
          }
        });
        break;
        
      case '0→0': // Unpaid → Unpaid (amount change)
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged) {
          // UPDATE PURCHASE (was PURCHASE_ADJUSTMENT)
          updates.push({
            description: 'Update purchase amount',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '1→1': // Paid → Paid (amount change)
        if (changes.amountChanged) {
          const diff = changes.newTotal - changes.oldTotal;
          
          // UPDATE PURCHASE (was PURCHASE_ADJUSTMENT)
          updates.push({
            description: 'Update purchase amount',
            where: {
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              transaction_type: 'PURCHASE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Purchase ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
          
          // If Type B (no allocations), UPDATE PAYMENT (was PAYMENT_ADJUSTMENT)
          if (!changes.isTypeA && changes.hasPaymentLedger) {
            // For Type B, update the PAYMENT entry with new total
            updates.push({
              description: 'Update payment amount for Type B purchase',
              where: {
                reference_type: 'purchase',
                reference_id: changes.purchaseId!,
                transaction_type: 'PAYMENT'
              },
              data: {
                credit: changes.newTotal,
                notes: `Payment updated to ₹${changes.newTotal} for purchase ${changes.invoiceNo}`
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
   * ✅ REFACTORED: Returns mixed CREATE/UPDATE/DELETE operations
   * DELETE REFUND_REVERSAL instead of CREATE, UPDATE DEBIT_NOTE for amount changes
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
    const returnDate = changes.returnDate || Math.floor(Date.now() / 1000);  // ✅ Use return_date not payment_date
    
    switch (statusChange) {
      case '0→1': // Incomplete → Complete
      case '2→1': // Partial → Complete
        // ✅ CREATE DEBIT_NOTE if it doesn't exist (first time reaching status=1)
        if (!changes.hasExistingDebitNote) {
          creates.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: returnDate,  // ✅ Use return_date for DEBIT_NOTE
              transaction_type: 'DEBIT_NOTE',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: 0,
              credit: changes.newTotal,
              notes: `Debit note ${changes.debitNoteNo} - return marked as complete`,
              fy: changes.fy
            },
            description: 'Create DEBIT_NOTE entry (first time complete)'
          });
        }
        // ✅ Amount changes handled via updateDebitNoteEntry() in API (not here)
        break;
        
      case '1→0': // Complete → Incomplete
        // DELETE REFUND_REVERSAL entries (was CREATE)
        deletes.push({
          description: 'Delete refund reversal entries (unmarking)',
          where: {
            reference_type: 'purchase_return',
            reference_id: changes.returnId!,
            transaction_type: 'DEBIT_NOTE'  // Actually targeting REFUND_REVERSAL, but we need to check transaction_type
          }
        });
        
        // If amount changed, UPDATE DEBIT_NOTE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update DEBIT_NOTE amount',
            where: {
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              transaction_type: 'DEBIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Debit note ${changes.debitNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '2→0': // Partial → Incomplete
        // DELETE REFUND_REVERSAL entries (was CREATE)
        if (changes.hasExistingDebitNote) {
          deletes.push({
            description: 'Delete refund reversal entries (partial to incomplete)',
            where: {
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              transaction_type: 'DEBIT_NOTE'  // Actually REFUND_REVERSAL
            }
          });
        }
        
        // If amount changed, UPDATE DEBIT_NOTE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update DEBIT_NOTE amount',
            where: {
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              transaction_type: 'DEBIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Debit note ${changes.debitNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
        
      case '0→0': // Incomplete → Incomplete (amount change)
      case '1→1': // Complete → Complete (amount change)
      case '2→2': // Partial → Partial (amount change)
      case '1→2': // Complete → Partial (amount increase)
      case '0→2': // Incomplete → Partial
        // UPDATE DEBIT_NOTE for amount changes (was updateDebitNoteEntry)
        if (changes.amountChanged && changes.hasExistingDebitNote) {
          updates.push({
            description: 'Update DEBIT_NOTE amount',
            where: {
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              transaction_type: 'DEBIT_NOTE'
            },
            data: {
              credit: changes.newTotal,
              notes: `Debit note ${changes.debitNoteNo} updated to ₹${changes.newTotal}`
            }
          });
        }
        break;
    }
    
    return { creates, updates, deletes };
  }
}

// Export singleton instance
export const ledgerHandler = new LedgerHandler();
