/**
 * Customer Balance Handler Service
 * Handles customer balance calculations and updates for all transaction types
 * Ensures transaction safety and consistency
 */

import { CustomerBalanceLogService, BalanceColumn, SourceType, BalanceLogEntry } from './customer-balance-log-service';

export interface BalanceUpdate {
  total_paid?: number;
  total_allocated?: number;
  total_refunded?: number;
  total_refund_allocated?: number;
}

export interface BalanceOperation {
  customerId: number;
  update: BalanceUpdate;
}

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
  /**
   * Money this document itself brought in, as opposed to the amount it
   * ALLOCATED. The two differ whenever a sale was settled from an existing
   * customer advance; conflating them is L-26 / L-30.
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

export class CustomerBalanceHandler {
  /**
   * Get balance operations for sale/salex creation with payment
   * Handles smart advance allocation for new transactions
   */
  getCreateBalanceOps(params: {
    customerId: number;
    total: number;
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
    type: 'sale' | 'salex';
  }): BalanceOperation | null {
    // Skip balance operations for "Other" customer (id = 0)
    if (params.customerId === 0) {
      return null;
    }
    
    // Calculate advance balance based on type
    const advanceBalance = params.currentBalance 
      ? (params.type === 'sale' || params.type === 'salex'
          ? params.currentBalance.total_paid - params.currentBalance.total_allocated
          : params.currentBalance.total_refunded - params.currentBalance.total_refund_allocated)
      : 0;
    
    // Scenario 1: Full advance available
    if (advanceBalance >= params.total) {
      return {
        customerId: params.customerId,
        update: params.type === 'sale' || params.type === 'salex'
          ? { total_allocated: params.total }
          : { total_refund_allocated: params.total }
      };
    }
    // Scenario 2: Partial advance available
    else if (advanceBalance > 0) {
      return {
        customerId: params.customerId,
        update: params.type === 'sale' || params.type === 'salex'
          ? { 
              total_paid: params.total - advanceBalance,
              total_allocated: params.total 
            }
          : { 
              total_refunded: params.total - advanceBalance,
              total_refund_allocated: params.total 
            }
      };
    }
    // Scenario 3: No advance available
    else {
      return {
        customerId: params.customerId,
        update: params.type === 'sale' || params.type === 'salex'
          ? { 
              total_paid: params.total,
              total_allocated: params.total 
            }
          : { 
              total_refunded: params.total,
              total_refund_allocated: params.total 
            }
      };
    }
  }
  
  /**
   * Get balance operations for sale/salex status changes
   * Handles all 9 cases for sale edit with smart advance allocation
   */
  getSaleBalanceOps(changes: ChangeSet): BalanceOperation | null {
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    // Calculate advance balance (customer has credit with us)
    const advanceBalance = changes.currentBalance 
      ? changes.currentBalance.total_paid - changes.currentBalance.total_allocated 
      : 0;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Paid
        // Scenario 1: Customer has enough credit to cover full bill
        if (advanceBalance >= changes.newTotal) {
          return {
            customerId: changes.customerId,
            update: {
              total_allocated: changes.newTotal  // Use advance only, no new payment
            }
          };
        }
        // Scenario 2: Customer has partial credit
        else if (advanceBalance > 0) {
          return {
            customerId: changes.customerId,
            update: {
              total_paid: changes.newTotal - advanceBalance,  // New payment for difference
              total_allocated: changes.newTotal  // Full allocation
            }
          };
        }
        // Scenario 3: No advance available
        else {
          return {
            customerId: changes.customerId,
            update: {
              total_paid: changes.newTotal,
              total_allocated: changes.newTotal
            }
          };
        }
        
      case '0→2': // Unpaid → Partial
        // P4-16 added this transition to the LEDGER handler and stopped there,
        // so the balance columns never moved for it (L-29). Same advance logic
        // as 0→1, over the amount actually allocated rather than the full bill.
        {
          const allocated = changes.totalAllocated || 0;
          if (allocated <= 0) return null;

          if (advanceBalance >= allocated) {
            return { customerId: changes.customerId, update: { total_allocated: allocated } };
          } else if (advanceBalance > 0) {
            return {
              customerId: changes.customerId,
              update: { total_paid: allocated - advanceBalance, total_allocated: allocated }
            };
          } else {
            return {
              customerId: changes.customerId,
              update: { total_paid: allocated, total_allocated: allocated }
            };
          }
        }

      case '2→1': // Partial → Paid
        const remaining = changes.newTotal - (changes.totalAllocated || 0);
        
        // Scenario 1: Advance covers remaining amount
        if (advanceBalance >= remaining) {
          return {
            customerId: changes.customerId,
            update: {
              total_allocated: remaining  // Use advance for remaining
            }
          };
        }
        // Scenario 2: Partial advance available
        else if (advanceBalance > 0) {
          return {
            customerId: changes.customerId,
            update: {
              total_paid: remaining - advanceBalance,
              total_allocated: remaining
            }
          };
        }
        // Scenario 3: No advance
        else {
          return {
            customerId: changes.customerId,
            update: {
              total_paid: remaining,
              total_allocated: remaining
            }
          };
        }
        
      case '1→0': // Paid → Unpaid (restore advance)
        return {
          customerId: changes.customerId,
          update: {
            // See the vendor twin (L-30): the allocation reverses in full, the
            // payment only by what this document actually brought in.
            total_paid: -(changes.paidByThisDocument ?? changes.oldTotal),
            total_allocated: -changes.oldTotal
          }
        };
        
      case '2→0': // Partial → Unpaid (restore partial advance)
        return {
          customerId: changes.customerId,
          update: {
            total_paid: -(changes.paidByThisDocument ?? (changes.totalAllocated || 0)),
            total_allocated: -(changes.totalAllocated || 0)
          }
        };
        
      case '1→2': // Paid → Partial (amount increased)
        // No balance update needed - payment stays the same
        return null;
        
      case '0→0': // Unpaid → Unpaid (amount change)
        // No balance update - nothing paid yet
        return null;
        
      case '1→1': // Paid → Paid (amount change)
        // A bill paid through allocations (Type A): no money moves. Lowered below what is
        // allocated, the allocation shrinks and the rest stays as advance (owner, 2026-10-03;
        // trimAllocations); raised, it becomes part paid (never 1→1). Only total_allocated moves.
        if (changes.amountChanged && changes.isTypeA && changes.totalAllocated !== undefined) {
          const allocDiff = Math.min(changes.newTotal, changes.totalAllocated) - changes.totalAllocated;
          return allocDiff !== 0 ? { customerId: changes.customerId, update: { total_allocated: allocDiff } } : null;
        }
        if (changes.amountChanged) {
          const amountDiff = changes.newTotal - changes.oldTotal;
          return {
            customerId: changes.customerId,
            update: {
              total_paid: amountDiff,
              total_allocated: amountDiff
            }
          };
        }
        return null;
        
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged && changes.totalAllocated !== undefined) {
          const oldAllocated = changes.totalAllocated;
          const newAllocated = Math.min(changes.newTotal, changes.totalAllocated);
          const allocDiff = newAllocated - oldAllocated;
          
          if (allocDiff !== 0) {
            return {
              customerId: changes.customerId,
              // Only the allocation moves (L-31); the excess becomes an
              // unallocated advance rather than money that ceased to exist.
              update: {
                total_allocated: allocDiff
              }
            };
          }
        }
        return null;
        
      default:
        return null;
    }
  }
  
  /**
   * Get balance operations for return status changes
   * Handles all 9 cases for return edit with smart advance refund allocation
   */
  getReturnBalanceOps(changes: ChangeSet): BalanceOperation | null {
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    // Calculate advance refund balance (we owe customer refund)
    const advanceRefundBalance = changes.currentBalance 
      ? changes.currentBalance.total_refunded - changes.currentBalance.total_refund_allocated 
      : 0;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Refunded
        // Scenario 1: Advance refund covers full return
        if (advanceRefundBalance >= changes.newTotal) {
          return {
            customerId: changes.customerId,
            update: {
              total_refund_allocated: changes.newTotal  // Use advance refund only
            }
          };
        }
        // Scenario 2: Partial advance refund available
        else if (advanceRefundBalance > 0) {
          return {
            customerId: changes.customerId,
            update: {
              total_refunded: changes.newTotal - advanceRefundBalance,
              total_refund_allocated: changes.newTotal
            }
          };
        }
        // Scenario 3: No advance refund
        else {
          return {
            customerId: changes.customerId,
            update: {
              total_refunded: changes.newTotal,
              total_refund_allocated: changes.newTotal
            }
          };
        }
        
      case '0→2': // Incomplete → Partial
        // Missing for the same reason as the sale twin (L-29).
        {
          const allocatedR = changes.totalAllocated || 0;
          if (allocatedR <= 0) return null;

          if (advanceRefundBalance >= allocatedR) {
            return { customerId: changes.customerId, update: { total_refund_allocated: allocatedR } };
          } else if (advanceRefundBalance > 0) {
            return {
              customerId: changes.customerId,
              update: { total_refunded: allocatedR - advanceRefundBalance, total_refund_allocated: allocatedR }
            };
          } else {
            return {
              customerId: changes.customerId,
              update: { total_refunded: allocatedR, total_refund_allocated: allocatedR }
            };
          }
        }

      case '2→1': // Partial → Refunded
        const remaining = changes.newTotal - (changes.totalAllocated || 0);
        
        // Scenario 1: Advance refund covers remaining
        if (advanceRefundBalance >= remaining) {
          return {
            customerId: changes.customerId,
            update: {
              total_refund_allocated: remaining
            }
          };
        }
        // Scenario 2: Partial advance refund
        else if (advanceRefundBalance > 0) {
          return {
            customerId: changes.customerId,
            update: {
              total_refunded: remaining - advanceRefundBalance,
              total_refund_allocated: remaining
            }
          };
        }
        // Scenario 3: No advance refund
        else {
          return {
            customerId: changes.customerId,
            update: {
              total_refunded: remaining,
              total_refund_allocated: remaining
            }
          };
        }
        
      case '1→0': // Refunded → Unpaid (restore advance refund)
        return {
          customerId: changes.customerId,
          update: {
            total_refunded: -(changes.refundedByThisDocument ?? changes.oldTotal),
            total_refund_allocated: -changes.oldTotal
          }
        };
        
      case '2→0': // Partial → Unpaid (restore partial advance refund)
        return {
          customerId: changes.customerId,
          update: {
            total_refunded: -(changes.refundedByThisDocument ?? (changes.totalAllocated || 0)),
            total_refund_allocated: -(changes.totalAllocated || 0)
          }
        };
        
      case '1→2': // Refunded → Partial (amount increased)
        // No balance update needed - refund stays the same
        return null;
        
      case '0→0': // Unpaid → Unpaid (amount change)
        // No balance update - nothing refunded yet
        return null;
        
      case '1→1': // Refunded → Refunded (amount change)
        if (changes.amountChanged) {
          const amountDiff = changes.newTotal - changes.oldTotal;
          return {
            customerId: changes.customerId,
            update: {
              total_refunded: amountDiff,
              total_refund_allocated: amountDiff
            }
          };
        }
        return null;
        
      case '2→2': // Partial → Partial (amount change)
        if (changes.amountChanged && changes.totalAllocated !== undefined) {
          const oldAllocated = changes.totalAllocated;
          const newAllocated = Math.min(changes.newTotal, changes.totalAllocated);
          const allocDiff = newAllocated - oldAllocated;
          
          if (allocDiff !== 0) {
            return {
              customerId: changes.customerId,
              // See the sale twin (L-31).
              update: {
                total_refund_allocated: allocDiff
              }
            };
          }
        }
        return null;
        
      default:
        return null;
    }
  }
  
  /**
   * Optimized balance update using Prisma increment
   * FASTER - uses single UPDATE with increment operations
   * NOW WITH AUDIT LOGGING
   * 
   * @param tx - Prisma transaction client
   * @param customerId - Customer ID
   * @param updates - Balance updates (positive = add, negative = subtract)
   * @param source - Optional source info for audit log
   */
  async incrementBalanceInTransaction(
    tx: any,
    customerId: number,
    updates: BalanceUpdate,
    source?: {
      type: SourceType;
      id: number;
      reference_no?: string;
      userId?: number;
      notes?: string;
    }
  ): Promise<void> {
    // Get current balance BEFORE update (for logging)
    const currentBalance = await tx.customer_details.findUnique({
      where: { id: customerId },
      select: {
        total_paid: true,
        total_allocated: true,
        total_refunded: true,
        total_refund_allocated: true
      }
    });

    if (!currentBalance) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const data: any = {};
    const logEntries: BalanceLogEntry[] = [];
    
    // Process each column update
    if (updates.total_paid !== undefined && updates.total_paid !== 0) {
      data.total_paid = { increment: updates.total_paid };
      
      if (source) {
        logEntries.push({
          customer_id: customerId,
          column_name: 'total_paid',
          change_amount: updates.total_paid,
          old_value: Number(currentBalance.total_paid),
          new_value: Number(currentBalance.total_paid) + updates.total_paid,
          source_type: source.type,
          source_id: source.id,
          reference_no: source.reference_no,
          created_by: source.userId,
          notes: source.notes
        });
      }
    }
    
    if (updates.total_allocated !== undefined && updates.total_allocated !== 0) {
      data.total_allocated = { increment: updates.total_allocated };
      
      if (source) {
        logEntries.push({
          customer_id: customerId,
          column_name: 'total_allocated',
          change_amount: updates.total_allocated,
          old_value: Number(currentBalance.total_allocated),
          new_value: Number(currentBalance.total_allocated) + updates.total_allocated,
          source_type: source.type,
          source_id: source.id,
          reference_no: source.reference_no,
          created_by: source.userId,
          notes: source.notes
        });
      }
    }
    
    if (updates.total_refunded !== undefined && updates.total_refunded !== 0) {
      data.total_refunded = { increment: updates.total_refunded };
      
      if (source) {
        logEntries.push({
          customer_id: customerId,
          column_name: 'total_refunded',
          change_amount: updates.total_refunded,
          old_value: Number(currentBalance.total_refunded),
          new_value: Number(currentBalance.total_refunded) + updates.total_refunded,
          source_type: source.type,
          source_id: source.id,
          reference_no: source.reference_no,
          created_by: source.userId,
          notes: source.notes
        });
      }
    }
    
    if (updates.total_refund_allocated !== undefined && updates.total_refund_allocated !== 0) {
      data.total_refund_allocated = { increment: updates.total_refund_allocated };
      
      if (source) {
        logEntries.push({
          customer_id: customerId,
          column_name: 'total_refund_allocated',
          change_amount: updates.total_refund_allocated,
          old_value: Number(currentBalance.total_refund_allocated),
          new_value: Number(currentBalance.total_refund_allocated) + updates.total_refund_allocated,
          source_type: source.type,
          source_id: source.id,
          reference_no: source.reference_no,
          created_by: source.userId,
          notes: source.notes
        });
      }
    }
    
    // Calculate balance increment
    const balanceIncrement = 
      (updates.total_paid || 0) - 
      (updates.total_allocated || 0) - 
      (updates.total_refunded || 0) + 
      (updates.total_refund_allocated || 0);
    
    if (balanceIncrement !== 0) {
      data.account_balance = { increment: balanceIncrement };
    }
    
    // Only update if there are changes
    if (Object.keys(data).length > 0) {
      // Update customer balance
      await tx.customer_details.update({
        where: { id: customerId },
        data
      });

      // Log all changes (if source provided)
      if (logEntries.length > 0) {
        await CustomerBalanceLogService.logMultipleChanges(tx, logEntries);
      }
    }
  }
}

// Export singleton instance
export const customerBalanceHandler = new CustomerBalanceHandler();
