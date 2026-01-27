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
  fy: number;
  totalAllocated?: number;
  isTypeA?: boolean; // Has existing allocations
  amountChanged: boolean;
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
   * Handles all 9 cases for return edit
   */
  getReturnLedgerOps(changes: ChangeSet): LedgerOperation[] {
    const ops: LedgerOperation[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    const timestamp = Math.floor(Date.now() / 1000);
    
    switch (statusChange) {
      case '1→0': // Refunded → Unpaid
        // Reverse refund
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: timestamp,
            transaction_type: 'REFUND_REVERSAL',
            reference_type: 'purchase_return',
            reference_id: changes.returnId!,
            reference_no: changes.debitNoteNo!,
            debit: 0,
            credit: changes.oldTotal,
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `Refund reversed for ${changes.debitNoteNo} - unmarked as unpaid`,
            fy: changes.fy
          },
          description: 'Refund reversal'
        });
        
        // If amount changed, adjust return
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: difference < 0 ? Math.abs(difference) : 0,
              credit: difference > 0 ? difference : 0,
              notes: `Return ${changes.debitNoteNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (after unmarking)`,
              fy: changes.fy
            },
            description: 'Return adjustment after unmarking'
          });
        }
        break;
        
      case '0→1': // Unpaid → Refunded
        // If amount changed, adjust return first
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: difference < 0 ? Math.abs(difference) : 0,
              credit: difference > 0 ? difference : 0,
              notes: `Return ${changes.debitNoteNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (before marking as complete)`,
              fy: changes.fy
            },
            description: 'Return adjustment before marking complete'
          });
        }
        
        // ❌ COMMENTED OUT - Issue #6: No REFUND_RECEIVED entry for returns
        // Balance adjusts automatically from DEBIT_NOTE entry
        // ops.push({
        //   entry: {
        //     vendor_id: changes.vendorId,
        //     transaction_date: changes.paymentDate || timestamp,
        //     transaction_type: 'REFUND_RECEIVED',
        //     reference_type: 'purchase_return',
        //     reference_id: changes.returnId!,
        //     reference_no: changes.debitNoteNo!,
        //     debit: changes.newTotal,
        //     credit: 0,
        //     payment_mode: changes.paymentMode,
        //     payment_status: 1,
        //     payment_date: changes.paymentDate || timestamp,
        //     notes: `Refund received for ${changes.debitNoteNo}`,
        //     fy: changes.fy
        //   },
        //   description: 'Refund received'
        // });
        break;
        
      case '2→1': // Partial → Complete
        // If amount changed, adjust return first
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: difference < 0 ? Math.abs(difference) : 0,
              credit: difference > 0 ? difference : 0,
              notes: `Return ${changes.debitNoteNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (before marking as complete)`,
              fy: changes.fy
            },
            description: 'Return adjustment before marking complete'
          });
        }
        
        // ❌ COMMENTED OUT - Issue #6: No REFUND_RECEIVED entry for returns
        // Balance adjusts automatically from DEBIT_NOTE entry
        // const remainingAmount = changes.newTotal - (changes.totalAllocated || 0);
        // ops.push({
        //   entry: {
        //     vendor_id: changes.vendorId,
        //     transaction_date: changes.paymentDate || timestamp,
        //     transaction_type: 'REFUND_RECEIVED',
        //     reference_type: 'purchase_return',
        //     reference_id: changes.returnId!,
        //     reference_no: changes.debitNoteNo!,
        //     debit: remainingAmount,
        //     credit: 0,
        //     payment_mode: changes.paymentMode,
        //     payment_status: 1,
        //     payment_date: changes.paymentDate || timestamp,
        //     notes: `Refund for remaining amount ₹${remainingAmount} for ${changes.debitNoteNo} (marked as fully complete)`,
        //     fy: changes.fy
        //   },
        //   description: 'Refund for remaining amount'
        // });
        break;
        
      case '2→0': // Partial → Unpaid
        // Reverse all refunds
        ops.push({
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: timestamp,
            transaction_type: 'REFUND_REVERSAL',
            reference_type: 'purchase_return',
            reference_id: changes.returnId!,
            reference_no: changes.debitNoteNo!,
            debit: 0,
            credit: changes.totalAllocated || 0,
            payment_mode: changes.paymentMode,
            payment_status: 0,
            notes: `All refunds (₹${changes.totalAllocated}) reversed for ${changes.debitNoteNo} - unmarked as unpaid`,
            fy: changes.fy
          },
          description: 'Refund reversal for all allocations'
        });
        
        // If amount changed, adjust return
        if (changes.amountChanged) {
          const difference = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: difference < 0 ? Math.abs(difference) : 0,
              credit: difference > 0 ? difference : 0,
              notes: `Return ${changes.debitNoteNo} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} (after unmarking)`,
              fy: changes.fy
            },
            description: 'Return adjustment after unmarking'
          });
        }
        break;
        
      case '0→0': // Unpaid → Unpaid (amount change)
      case '1→1': // Refunded → Refunded (amount change)
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged) {
          const diff = changes.newTotal - changes.oldTotal;
          ops.push({
            entry: {
              vendor_id: changes.vendorId,
              transaction_date: timestamp,
              transaction_type: 'PURCHASE_ADJUSTMENT',
              reference_type: 'purchase_return',
              reference_id: changes.returnId!,
              reference_no: changes.debitNoteNo!,
              debit: diff < 0 ? Math.abs(diff) : 0,
              credit: diff > 0 ? diff : 0,
              notes: `Return ${changes.debitNoteNo} amount ${diff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(diff)}`,
              fy: changes.fy
            },
            description: 'Return adjustment'
          });
        }
        break;
    }
    
    return ops;
  }
}

// Export singleton instance
export const ledgerHandler = new LedgerHandler();
