/**
 * Customer Ledger Handler Service
 * Handles ledger entry creation for all transaction types and status changes
 * Centralizes ledger logic to eliminate duplication across APIs
 */

import { CustomerLedgerEntryData } from './customer-ledger-service';
import { availableAdvance } from './advance-allocation';

export interface ChangeSet {
  oldStatus: number;
  newStatus: number;
  oldTotal: number;
  newTotal: number;
  customerId: number;
  invoiceId?: number;
  returnId?: number;
  /**
   * Which family the document belongs to. Required by every sale/return
   * operation: the type used to be guessed as `invoiceId ? 'sale' : 'salex'`,
   * which is always 'sale' because both PUTs set invoiceId - so a salex edit
   * read and wrote the ledger rows of the SALE with the same id (SA-01, L-8).
   */
  docType?: 'sale' | 'salex';
  invoiceNo?: string;
  creditNoteNo?: string;
  paymentMode?: number;
  paymentDate?: number;
  returnDate?: number;
  fy: number;
  totalAllocated?: number;
  /**
   * Money this document itself brought in, as opposed to the amount it
   * ALLOCATED. They differ whenever the document was settled from an existing
   * advance; conflating them is L-26 / L-30.
   */
  paidByThisDocument?: number;
  /** The return-side equivalent. */
  refundedByThisDocument?: number;
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

function saleRef(changes: ChangeSet): 'sale' | 'salex' {
  if (changes.docType !== 'sale' && changes.docType !== 'salex') {
    throw new Error('ChangeSet.docType is required (sale or salex)');
  }
  return changes.docType;
}

function returnRef(changes: ChangeSet): 'sale_return' | 'salex_return' {
  return saleRef(changes) === 'sale' ? 'sale_return' : 'salex_return';
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
    // Unallocated payments less unallocated refunds (H1: refunds were added)
    const advanceBalance = availableAdvance(currentBalance);
    
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
              reference_id: changes.invoiceId!,
              reference_no: changes.invoiceNo!,
              debit: 0,
              credit: breakdown01.newPayment,  // Only NEW payment, not full total
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
              reference_id: changes.invoiceId!,
              reference_no: changes.invoiceNo!,
              debit: 0,
              credit: breakdown21.newPayment,  // Only NEW payment, not full remaining
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
        
      case '0→2': // Unpaid → Partial
        // The ninth case. Both this handler and its vendor twin documented
        // themselves as handling "all 9 cases" and implemented EIGHT - this one
        // was missing from both, while the RETURN handlers in the same files do
        // implement it. So an unpaid sale that became partially paid
        // produced NO ledger operation at all: no PAYMENT entry for the money
        // that moved, and - because the amountChanged branch lives inside each
        // case - no update to the SALE debit either, even when the amount
        // had changed too.
        //
        // Worth noting how this stayed hidden: both twins were wrong in exactly
        // the same way, so comparing them against each other could never reveal
        // it. Only enumerating the state space does (P4-16, lead L-7).
        if (changes.amountChanged) {
          updates.push({
            description: 'Update sale amount (unpaid to partial)',
            where: {
              reference_type: saleRef(changes),
              reference_id: changes.invoiceId!,
              transaction_type: 'SALE'
            },
            data: {
              debit: changes.newTotal,
              notes: `Sale ${changes.invoiceNo} updated to ₹${changes.newTotal}`
            }
          });
        }

        // A PAYMENT for what has actually been allocated, not for the full
        // total - that is what makes the status partial rather than paid.
        const allocatedSale02 = changes.totalAllocated || 0;
        const breakdownSale02 = this.calculateAdvanceBreakdown(allocatedSale02, changes.currentBalance);

        if (breakdownSale02.newPayment > 0) {
          creates.push({
            entry: {
              customer_id: changes.customerId,
              transaction_date: changes.paymentDate || timestamp,
              transaction_type: 'PAYMENT_RECEIVED',
              reference_type: saleRef(changes),
              reference_id: changes.invoiceId!,
              reference_no: changes.invoiceNo!,
              debit: 0,
              credit: breakdownSale02.newPayment,
              payment_mode: changes.paymentMode,
              payment_status: 2,
              payment_date: changes.paymentDate || timestamp,
              notes: this.generatePaymentNotes(changes.invoiceNo!, allocatedSale02, changes.currentBalance),
              fy: changes.fy
            },
            description: 'Partial payment on a previously unpaid sale',
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
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
            reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
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
              reference_type: saleRef(changes),
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
                reference_type: saleRef(changes),
                reference_id: changes.invoiceId!,
                transaction_type: 'PAYMENT_RECEIVED'
              },
              data: {
                credit: changes.newTotal,
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
              reference_type: returnRef(changes),
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
            reference_type: returnRef(changes),
            reference_id: changes.returnId!,
            transaction_type: 'CREDIT_NOTE'
          }
        });
        
        // If amount changed, UPDATE CREDIT_NOTE
        if (changes.amountChanged) {
          updates.push({
            description: 'Update CREDIT_NOTE amount',
            where: {
              reference_type: returnRef(changes),
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
              reference_type: returnRef(changes),
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
              reference_type: returnRef(changes),
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
              reference_type: returnRef(changes),
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
