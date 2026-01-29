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
}

export class LedgerHandler {
  /**
   * Get ledger operations for purchase status changes
   * Handles all 9 cases for purchase edit
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
        
        // Second: Create payment
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: changes.paymentDate || timestamp,
            transaction_type: 'PAYMENT',
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            reference_no: changes.invoiceNo!,
            debit: 0,
            credit: changes.newTotal,
            payment_mode: changes.paymentMode,
            payment_status: 1,
            payment_date: changes.paymentDate || timestamp,
            notes: `Payment made for purchase ${changes.invoiceNo}`,
            fy: changes.fy
          },
          description: 'Payment creation'
        });
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
        
        // Second: Create payment for remaining amount
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: changes.paymentDate || timestamp,
            transaction_type: 'PAYMENT',
            reference_type: 'purchase',
            reference_id: changes.purchaseId!,
            reference_no: changes.invoiceNo!,
            debit: 0,
            credit: remainingAmount,
            payment_mode: changes.paymentMode,
            payment_status: 1,
            payment_date: changes.paymentDate || timestamp,
            notes: `Payment for remaining amount ₹${remainingAmount} for purchase ${changes.invoiceNo} (marked as fully paid)`,
            fy: changes.fy
          },
          description: 'Payment for remaining amount'
        });
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
          if (!changes.isTypeA) {
            ops.push({
              entry: {
                vendor_id: changes.vendorId,
                transaction_date: timestamp,
                transaction_type: 'PAYMENT_ADJUSTMENT',
                reference_type: 'purchase',
                reference_id: changes.purchaseId!,
                reference_no: changes.invoiceNo!,
                debit: diff < 0 ? Math.abs(diff) : 0,
                credit: diff > 0 ? diff : 0,
                payment_mode: changes.paymentMode,
                payment_status: 1,
                notes: `Payment ${diff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(diff)} for purchase ${changes.invoiceNo}`,
                fy: changes.fy
              },
              description: 'Payment adjustment (Type B)'
            });
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
        // ❌ REFUND_REVERSAL: When moving away from complete status
        // Note: We don't actually delete DEBIT_NOTE, just mark status change
        // The DEBIT_NOTE amount adjustment is handled via updateDebitNoteEntry()
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: returnDate,  // ✅ Use return_date
            transaction_type: 'REFUND_REVERSAL',
            reference_type: 'purchase_return',
            reference_id: changes.returnId!,
            reference_no: changes.debitNoteNo!,
            debit: 0,
            credit: changes.oldTotal,
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `Return ${changes.debitNoteNo} unmarked from complete status`,
            fy: changes.fy
          },
          description: 'Refund reversal (unmarking complete)'
        });
        break;
        
      case '2→0': // Partial → Incomplete
        // ❌ REFUND_REVERSAL: Only if DEBIT_NOTE exists
        if (changes.hasExistingDebitNote) {
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: returnDate,  // ✅ Use return_date
              transaction_type: 'REFUND_REVERSAL',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: 0,
              credit: changes.totalAllocated || changes.oldTotal,
              payment_mode: changes.paymentMode,
              payment_status: 0,
              notes: `All refunds reversed for ${changes.debitNoteNo} - unmarked as incomplete`,
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
