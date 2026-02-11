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
   * ✅ FIXED: Checks for existing PAYMENT entries to avoid duplicates
   * ✅ FIXED: Shows advance balance usage in payment notes
   */
  getPurchaseLedgerOps(changes: ChangeSet): LedgerOperation[] {
    const ops: LedgerOperation[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    const timestamp = Math.floor(Date.now() / 1000);
    
    switch (statusChange) {
      case '1→0': // Paid → Unpaid
        // First: Reverse payment
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: timestamp,
            transaction_type: 'PAYMENT_REVERSAL',
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            reference_no: changes.invoiceNo!,
            debit: changes.oldTotal,
            credit: 0,
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `Payment reversed for purchase ${changes.invoiceNo} - unmarked as unpaid`,
            fy: changes.fy
          },
          description: 'Payment reversal'
        });
        
        // Second: If amount changed, adjust purchase
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: difference > 0 ? difference : 0,
              credit: difference < 0 ? Math.abs(difference) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (after unmarking)`,
              fy: changes.fy
            },
            description: 'Purchase adjustment after unmarking'
          });
        }
        break;
        
      case '0→1': // Unpaid → Paid
        // First: If amount changed, adjust purchase
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: difference > 0 ? difference : 0,
              credit: difference < 0 ? Math.abs(difference) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (before marking as paid)`,
              fy: changes.fy
            },
            description: 'Purchase adjustment before marking paid'
          });
        }
        
        // Second: Create payment with advance information
        // ✅ FIXED: Uses advance breakdown to determine actual new payment amount
        // ✅ FIXED: Only creates PAYMENT entry if new money is paid (not using 100% advance)
        // ✅ FIXED: Checks for existing PAYMENT and uses PAYMENT_ADJUSTMENT if found
        const breakdown01 = this.calculateAdvanceBreakdown(changes.newTotal, changes.currentBalance);
        
        if (breakdown01.newPayment > 0) {
          ops.push({
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
        
        // First: If amount changed, adjust purchase
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: difference > 0 ? difference : 0,
              credit: difference < 0 ? Math.abs(difference) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (before marking as fully paid)`,
              fy: changes.fy
            },
            description: 'Purchase adjustment before marking fully paid'
          });
        }
        
        // Second: Create payment for remaining amount with advance information
        // ✅ FIXED: Uses advance breakdown to determine actual new payment amount
        // ✅ FIXED: Only creates PAYMENT entry if new money is paid (not using 100% advance)
        // ✅ FIXED: Checks for existing PAYMENT and uses PAYMENT_ADJUSTMENT if found
        const breakdown21 = this.calculateAdvanceBreakdown(remainingAmount, changes.currentBalance);
        
        if (breakdown21.newPayment > 0) {
          ops.push({
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
        // First: Reverse all payments
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: timestamp,
            transaction_type: 'PAYMENT_REVERSAL',
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            reference_no: changes.invoiceNo!,
            debit: changes.totalAllocated || 0,
            credit: 0,
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `All payments (₹${changes.totalAllocated}) reversed for purchase ${changes.invoiceNo} - unmarked as unpaid`,
            fy: changes.fy
          },
          description: 'Payment reversal for all allocations'
        });
        
        // Second: If amount changed, adjust purchase
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: difference > 0 ? difference : 0,
              credit: difference < 0 ? Math.abs(difference) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (after unmarking)`,
              fy: changes.fy
            },
            description: 'Purchase adjustment after unmarking'
          });
        }
        break;
        
      case '1→2': // Paid → Partial (amount increased)
        const difference = changes.newTotal - changes.oldTotal;
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: timestamp,
            transaction_type: 'PURCHASE_ADJUSTMENT',
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            reference_no: changes.invoiceNo!,
            debit: difference,
            credit: 0,
            notes: `Purchase ${changes.invoiceNo} amount increased by ₹${difference} (now partially paid)`,
            fy: changes.fy
          },
          description: 'Purchase adjustment (paid to partial)'
        });
        break;
        
      case '0→0': // Unpaid → Unpaid (amount change)
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged) {
          const diff = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: diff > 0 ? diff : 0,
              credit: diff < 0 ? Math.abs(diff) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${diff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(diff)}`,
              fy: changes.fy
            },
            description: 'Purchase adjustment'
          });
        }
        break;
        
      case '1→1': // Paid → Paid (amount change)
        if (changes.amountChanged) {
          const diff = changes.newTotal - changes.oldTotal;
          
          // Purchase adjustment
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase',
              reference_id: changes.purchaseId!,
              reference_no: changes.invoiceNo!,
              debit: diff > 0 ? diff : 0,
              credit: diff < 0 ? Math.abs(diff) : 0,
              notes: `Purchase ${changes.invoiceNo} amount ${diff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(diff)}`,
              fy: changes.fy
            },
            description: 'Purchase adjustment'
          });
          
          // If Type B (no allocations), also adjust payment
          // ✅ FIXED: Uses advance breakdown for amount increases
          if (!changes.isTypeA) {
            if (diff > 0) {
              // Amount increased - check if advance can cover the increase
              const breakdown11 = this.calculateAdvanceBreakdown(diff, changes.currentBalance);
              
              // Only create PAYMENT_ADJUSTMENT if new payment needed
              if (breakdown11.newPayment > 0) {
                ops.push({
                  entry: {
                    vendor_id: changes.vendorId,
                    transaction_date: timestamp,
                    transaction_type: 'PAYMENT_ADJUSTMENT',
                    reference_type: 'purchase',
                    reference_id: changes.purchaseId!,
                    reference_no: changes.invoiceNo!,
                    debit: 0,
                    credit: breakdown11.newPayment,  // ✅ Only NEW payment, not full diff
                    payment_mode: changes.paymentMode,
                    payment_status: 1,
                    notes: breakdown11.hasAdvance 
                      ? `Payment increased by ₹${breakdown11.newPayment.toFixed(2)} (₹${breakdown11.advanceUsed.toFixed(2)} from advance) for purchase ${changes.invoiceNo}`
                      : `Payment increased by ₹${Math.abs(diff)} for purchase ${changes.invoiceNo}`,
                    fy: changes.fy
                  },
                  description: 'Payment adjustment (Type B increase)'
                });
              }
            } else {
              // Amount decreased - always create reversal adjustment
              ops.push({
                entry: {
                  vendor_id: changes.vendorId,
                  transaction_date: timestamp,
                  transaction_type: 'PAYMENT_ADJUSTMENT',
                  reference_type: 'purchase',
                  reference_id: changes.purchaseId!,
                  reference_no: changes.invoiceNo!,
                  debit: Math.abs(diff),
                  credit: 0,
                  payment_mode: changes.paymentMode,
                  payment_status: 1,
                  notes: `Payment decreased by ₹${Math.abs(diff)} for purchase ${changes.invoiceNo}`,
                  fy: changes.fy
                },
                description: 'Payment adjustment (Type B decrease)'
              });
            }
          }
        }
        break;
    }
    
    return ops;
  }
  
  /**
   * Get ledger operations for return status changes
   * ✅ FIXED: Returns only use DEBIT_NOTE (not PURCHASE_ADJUSTMENT)
   * Handles: CREATE DEBIT_NOTE when reaching status=1, REFUND_REVERSAL when leaving status=1
   * Note: Amount changes handled via ledgerService.updateDebitNoteEntry() in transaction handler
   */
  getReturnLedgerOps(changes: ChangeSet): LedgerOperation[] {
    const ops: LedgerOperation[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    const returnDate = changes.returnDate || Math.floor(Date.now() / 1000);  // ✅ Use return_date not payment_date
    
    switch (statusChange) {
      case '0→1': // Incomplete → Complete
      case '2→1': // Partial → Complete
        // ✅ CREATE DEBIT_NOTE if it doesn't exist (first time reaching status=1)
        if (!changes.hasExistingDebitNote) {
          ops.push({
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
        // ✅ REFUND_REVERSAL: When moving away from complete status
        // Reverses the original DEBIT_NOTE credit by creating a DEBIT entry
        // Note: We don't delete DEBIT_NOTE, just reverse its effect
        // The DEBIT_NOTE amount adjustment is handled via updateDebitNoteEntry()
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: returnDate,  // ✅ Use return_date
            transaction_type: 'REFUND_REVERSAL',
            reference_type: 'purchase_return',
            reference_id: changes.returnId!,
            reference_no: changes.debitNoteNo!,
            debit: changes.oldTotal,  // ✅ FIX: DEBIT reverses the original CREDIT
            credit: 0,                 // ✅ FIX: No credit
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `Return ${changes.debitNoteNo} unmarked from complete status`,
            fy: changes.fy
          },
          description: 'Refund reversal (unmarking complete)'
        });
        break;
        
      case '2→0': // Partial → Incomplete
        // ✅ REFUND_REVERSAL: Only if DEBIT_NOTE exists
        // Reverses the FULL DEBIT_NOTE credit (not just refund allocations)
        if (changes.hasExistingDebitNote) {
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: returnDate,  // ✅ Use return_date
              transaction_type: 'REFUND_REVERSAL',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: changes.oldTotal,  // ✅ FIX: Always reverse full DEBIT_NOTE amount
              credit: 0,                 // ✅ FIX: No credit
              payment_mode: changes.paymentMode,
              payment_status: 0,
              notes: `Return ${changes.debitNoteNo} unmarked from partial to incomplete status`,
              fy: changes.fy
            },
            description: 'Refund reversal (partial to incomplete)'
          });
        }
        break;
        
      case '0→0': // Incomplete → Incomplete (amount change)
      case '1→1': // Complete → Complete (amount change)
      case '2→2': // Partial → Partial (amount change)
      case '1→2': // Complete → Partial (amount increase)
      case '0→2': // Incomplete → Partial
        // ✅ Amount changes handled via updateDebitNoteEntry() in API (not here)
        // No ledger operations needed from handler
        break;
    }
    
    return ops;
  }
}

// Export singleton instance
export const ledgerHandler = new LedgerHandler();
