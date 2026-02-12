/**
 * Balance Handler Service
 * Handles vendor balance calculations and updates for all transaction types
 * Ensures transaction safety and consistency
 */

export interface BalanceUpdate {
  total_paid?: number;
  total_allocated?: number;
  total_refunded?: number;
  total_refund_allocated?: number;
}

export interface BalanceOperation {
  vendorId: number;
  update: BalanceUpdate;
}

export interface ChangeSet {
  oldStatus: number;
  newStatus: number;
  oldTotal: number;
  newTotal: number;
  vendorId: number;
  totalAllocated?: number;
  amountChanged: boolean;
  currentBalance?: {
    total_paid: number;
    total_allocated: number;
    total_refunded: number;
    total_refund_allocated: number;
  };
}

export class BalanceHandler {
  /**
   * Get balance operations for purchase/return creation with payment/refund
   * Handles smart advance allocation for new transactions
   */
  getCreateBalanceOps(params: {
    vendorId: number;
    total: number;
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
    type: 'PURCHASE' | 'RETURN';
  }): BalanceOperation | null {
    // Skip balance operations for "Other" vendor (id = 0)
    if (params.vendorId === 0) {
      return null;
    }
    
    // Calculate advance balance based on type
    const advanceBalance = params.currentBalance 
      ? (params.type === 'PURCHASE'
          ? params.currentBalance.total_paid - params.currentBalance.total_allocated
          : params.currentBalance.total_refunded - params.currentBalance.total_refund_allocated)
      : 0;
    
    // Scenario 1: Full advance available
    if (advanceBalance >= params.total) {
      return {
        vendorId: params.vendorId,
        update: params.type === 'PURCHASE'
          ? { total_allocated: params.total }
          : { total_refund_allocated: params.total }
      };
    }
    // Scenario 2: Partial advance available
    else if (advanceBalance > 0) {
      return {
        vendorId: params.vendorId,
        update: params.type === 'PURCHASE'
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
        vendorId: params.vendorId,
        update: params.type === 'PURCHASE'
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
   * Get balance operations for purchase status changes
   * Handles all 9 cases for purchase edit with smart advance allocation
   */
  getPurchaseBalanceOps(changes: ChangeSet): BalanceOperation | null {
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    // Calculate advance balance (vendor owes us money)
    const advanceBalance = changes.currentBalance 
      ? changes.currentBalance.total_paid - changes.currentBalance.total_allocated 
      : 0;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Paid
        // Scenario 1: Vendor owes us enough to cover full bill
        if (advanceBalance >= changes.newTotal) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_allocated: changes.newTotal  // Use advance only, no new payment
            }
          };
        }
        // Scenario 2: Vendor owes us partially
        else if (advanceBalance > 0) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_paid: changes.newTotal - advanceBalance,  // New payment for difference
              total_allocated: changes.newTotal  // Full allocation
            }
          };
        }
        // Scenario 3: No advance available
        else {
          return {
            vendorId: changes.vendorId,
            update: {
              total_paid: changes.newTotal,
              total_allocated: changes.newTotal
            }
          };
        }
        
      case '2→1': // Partial → Paid
        const remaining = changes.newTotal - (changes.totalAllocated || 0);
        
        // Scenario 1: Advance covers remaining amount
        if (advanceBalance >= remaining) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_allocated: remaining  // Use advance for remaining
            }
          };
        }
        // Scenario 2: Partial advance available
        else if (advanceBalance > 0) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_paid: remaining - advanceBalance,
              total_allocated: remaining
            }
          };
        }
        // Scenario 3: No advance
        else {
          return {
            vendorId: changes.vendorId,
            update: {
              total_paid: remaining,
              total_allocated: remaining
            }
          };
        }
        
      case '1→0': // Paid → Unpaid (restore advance)
        return {
          vendorId: changes.vendorId,
          update: {
            total_paid: -changes.oldTotal,
            total_allocated: -changes.oldTotal
          }
        };
        
      case '2→0': // Partial → Unpaid (restore partial advance)
        return {
          vendorId: changes.vendorId,
          update: {
            total_paid: -(changes.totalAllocated || 0),
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
        // ✅ FIX: Update balance when amount changes while status stays Paid
        if (changes.amountChanged) {
          const amountDiff = changes.newTotal - changes.oldTotal;
          return {
            vendorId: changes.vendorId,
            update: {
              total_paid: amountDiff,
              total_allocated: amountDiff
            }
          };
        }
        return null;
        
      case '2→2': // Partial → Partial (amount change)
        // ✅ FIX: Update balance if total allocated changes
        // This happens when partial payment amount changes
        if (changes.amountChanged && changes.totalAllocated !== undefined) {
          // Calculate how much the allocation changed
          const oldAllocated = changes.totalAllocated;
          const newAllocated = Math.min(changes.newTotal, changes.totalAllocated);
          const allocDiff = newAllocated - oldAllocated;
          
          if (allocDiff !== 0) {
            return {
              vendorId: changes.vendorId,
              update: {
                total_paid: allocDiff,
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
    
    // Calculate advance refund balance (vendor owes us refund)
    const advanceRefundBalance = changes.currentBalance 
      ? changes.currentBalance.total_refunded - changes.currentBalance.total_refund_allocated 
      : 0;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Refunded
        // Scenario 1: Advance refund covers full return
        if (advanceRefundBalance >= changes.newTotal) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refund_allocated: changes.newTotal  // Use advance refund only
            }
          };
        }
        // Scenario 2: Partial advance refund available
        else if (advanceRefundBalance > 0) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refunded: changes.newTotal - advanceRefundBalance,
              total_refund_allocated: changes.newTotal
            }
          };
        }
        // Scenario 3: No advance refund
        else {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refunded: changes.newTotal,
              total_refund_allocated: changes.newTotal
            }
          };
        }
        
      case '2→1': // Partial → Refunded
        const remaining = changes.newTotal - (changes.totalAllocated || 0);
        
        // Scenario 1: Advance refund covers remaining
        if (advanceRefundBalance >= remaining) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refund_allocated: remaining
            }
          };
        }
        // Scenario 2: Partial advance refund
        else if (advanceRefundBalance > 0) {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refunded: remaining - advanceRefundBalance,
              total_refund_allocated: remaining
            }
          };
        }
        // Scenario 3: No advance refund
        else {
          return {
            vendorId: changes.vendorId,
            update: {
              total_refunded: remaining,
              total_refund_allocated: remaining
            }
          };
        }
        
      case '1→0': // Refunded → Unpaid (restore advance refund)
        return {
          vendorId: changes.vendorId,
          update: {
            total_refunded: -changes.oldTotal,
            total_refund_allocated: -changes.oldTotal
          }
        };
        
      case '2→0': // Partial → Unpaid (restore partial advance refund)
        return {
          vendorId: changes.vendorId,
          update: {
            total_refunded: -(changes.totalAllocated || 0),
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
        // ✅ FIX: Update balance when amount changes while status stays Complete
        if (changes.amountChanged) {
          const amountDiff = changes.newTotal - changes.oldTotal;
          return {
            vendorId: changes.vendorId,
            update: {
              total_refunded: amountDiff,
              total_refund_allocated: amountDiff
            }
          };
        }
        return null;
        
      case '2→2': // Partial → Partial (amount change)
        // ✅ FIX: Update balance if total allocated changes
        if (changes.amountChanged && changes.totalAllocated !== undefined) {
          const oldAllocated = changes.totalAllocated;
          const newAllocated = Math.min(changes.newTotal, changes.totalAllocated);
          const allocDiff = newAllocated - oldAllocated;
          
          if (allocDiff !== 0) {
            return {
              vendorId: changes.vendorId,
              update: {
                total_refunded: allocDiff,
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
   * Update vendor balance INSIDE transaction
   * Transaction-safe method that uses the provided transaction client
   * 
   * @param tx - Prisma transaction client
   * @param vendorId - Vendor ID
   * @param updates - Balance updates (positive = add, negative = subtract)
   */
  async updateBalanceInTransaction(
    tx: any,
    vendorId: number,
    updates: BalanceUpdate
  ): Promise<void> {
    // Get current values
    const vendor = await tx.vendor_details.findUnique({
      where: { id: vendorId },
      select: {
        total_paid: true,
        total_allocated: true,
        total_refunded: true,
        total_refund_allocated: true
      }
    });

    if (!vendor) {
      throw new Error(`Vendor ${vendorId} not found`);
    }

    // Calculate new values
    const newTotalPaid = Number(vendor.total_paid) + (updates.total_paid || 0);
    const newTotalAllocated = Number(vendor.total_allocated) + (updates.total_allocated || 0);
    const newTotalRefunded = Number(vendor.total_refunded) + (updates.total_refunded || 0);
    const newTotalRefundAllocated = Number(vendor.total_refund_allocated) + (updates.total_refund_allocated || 0);

    // Calculate balance
    // Balance = Money In - Money Out
    // Money In: Payments (we pay vendor)
    // Money Out: Allocations (applied to bills) + Refunds (vendor returns money) - Refund Allocations (applied to returns)
    const newBalance = newTotalPaid - newTotalAllocated - newTotalRefunded + newTotalRefundAllocated;

    // Update vendor USING TRANSACTION CLIENT
    await tx.vendor_details.update({
      where: { id: vendorId },
      data: {
        total_paid: newTotalPaid,
        total_allocated: newTotalAllocated,
        total_refunded: newTotalRefunded,
        total_refund_allocated: newTotalRefundAllocated,
        account_balance: newBalance
      }
    });
  }
  
  /**
   * Optimized balance update using Prisma increment
   * FASTER - uses single UPDATE with increment operations
   * 
   * @param tx - Prisma transaction client
   * @param vendorId - Vendor ID
   * @param updates - Balance updates (positive = add, negative = subtract)
   */
  async incrementBalanceInTransaction(
    tx: any,
    vendorId: number,
    updates: BalanceUpdate
  ): Promise<void> {
    const data: any = {};
    
    if (updates.total_paid !== undefined && updates.total_paid !== 0) {
      data.total_paid = { increment: updates.total_paid };
    }
    if (updates.total_allocated !== undefined && updates.total_allocated !== 0) {
      data.total_allocated = { increment: updates.total_allocated };
    }
    if (updates.total_refunded !== undefined && updates.total_refunded !== 0) {
      data.total_refunded = { increment: updates.total_refunded };
    }
    if (updates.total_refund_allocated !== undefined && updates.total_refund_allocated !== 0) {
      data.total_refund_allocated = { increment: updates.total_refund_allocated };
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
      await tx.vendor_details.update({
        where: { id: vendorId },
        data
      });
    }
  }
}

// Export singleton instance
export const balanceHandler = new BalanceHandler();
