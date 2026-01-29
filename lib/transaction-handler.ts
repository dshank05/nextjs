/**
 * Transaction Handler Service
 * Orchestrates all operations for purchase and return transactions
 * Coordinates ledger, balance, and allocation operations
 */

import { ledgerHandler, LedgerOperation, ChangeSet } from './ledger-handler';
import { balanceHandler, BalanceOperation } from './balance-handler';
import { ledgerService } from './ledger-service';

export interface AllocationChange {
  action: 'CREATE' | 'DELETE';
  type: 'PAYMENT' | 'REFUND';
  data?: any;
  where?: any;
}

export interface TransactionResult {
  ledgerOps: LedgerOperation[];
  balanceOp: BalanceOperation | null;
  allocationChanges: AllocationChange[];
}

export class TransactionHandler {
  /**
   * Handle purchase edit transaction
   * Returns all operations to perform
   */
  async handlePurchaseEdit(params: {
    oldStatus: number;
    newStatus: number;
    oldTotal: number;
    newTotal: number;
    vendorId: number;
    purchaseId: number;
    invoiceNo: string;
    paymentMode?: number;
    paymentDate?: number;
    fy: number;
    totalAllocated?: number;
    isTypeA?: boolean;
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
  }): Promise<TransactionResult> {
    // Build change set
    const changes: ChangeSet = {
      oldStatus: params.oldStatus,
      newStatus: params.newStatus,
      oldTotal: params.oldTotal,
      newTotal: params.newTotal,
      vendorId: params.vendorId,
      purchaseId: params.purchaseId,
      invoiceNo: params.invoiceNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      fy: params.fy,
      totalAllocated: params.totalAllocated,
      isTypeA: params.isTypeA,
      amountChanged: params.oldTotal !== params.newTotal,
      currentBalance: params.currentBalance
    };
    
    // Get ledger operations
    const ledgerOps = ledgerHandler.getPurchaseLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = balanceHandler.getPurchaseBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getPurchaseAllocationChanges(changes);
    
    return {
      ledgerOps,
      balanceOp,
      allocationChanges
    };
  }
  
  /**
   * Handle return edit transaction
   * ✅ REFACTORED: Now handles ALL logic including DEBIT_NOTE checks and updates
   * Returns all operations to perform
   */
  async handleReturnEdit(params: {
    oldStatus: number;
    newStatus: number;
    oldTotal: number;
    newTotal: number;
    vendorId: number;
    returnId: number;
    debitNoteNo: string;
    paymentMode?: number;
    paymentDate?: number;
    returnDate: number;    // ✅ NEW: Return date for DEBIT_NOTE
    fy: number;
    totalAllocated?: number;
    totalAmount: number;  // ✅ For DEBIT_NOTE updates
    totalTax: number;     // ✅ For DEBIT_NOTE updates
    tx: any;              // ✅ Transaction context for DB operations
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
  }): Promise<TransactionResult> {
    // ✅ CHECK IF DEBIT_NOTE EXISTS (moved from API)
    const existingDebitNote = await params.tx.vendor_ledger.findFirst({
      where: {
        vendor_id: params.vendorId,
        transaction_type: 'DEBIT_NOTE',
        reference_type: 'purchase_return',
        reference_id: params.returnId
      },
      orderBy: { id: 'desc' }
    });

    // ✅ UPDATE DEBIT_NOTE if exists and amount changed (moved from API)
    const amountChanged = Math.abs(params.newTotal - params.oldTotal) > 0.01;
    if (existingDebitNote && amountChanged) {
      await ledgerService.updateDebitNoteEntry({
        vendor_id: params.vendorId,
        reference_id: params.returnId,
        reference_no: params.debitNoteNo,
        new_total_amount: params.totalAmount,
        new_total_tax: params.totalTax,
        fy: params.fy
      });
    }

    // Build change set
    const changes: ChangeSet = {
      oldStatus: params.oldStatus,
      newStatus: params.newStatus,
      oldTotal: params.oldTotal,
      newTotal: params.newTotal,
      vendorId: params.vendorId,
      returnId: params.returnId,
      debitNoteNo: params.debitNoteNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      returnDate: params.returnDate,  // ✅ Pass return_date to ledger handler
      fy: params.fy,
      totalAllocated: params.totalAllocated,
      hasExistingDebitNote: !!existingDebitNote,  // ✅ Determined internally now
      amountChanged: amountChanged,
      currentBalance: params.currentBalance
    };
    
    // Get ledger operations
    const ledgerOps = ledgerHandler.getReturnLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = balanceHandler.getReturnBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getReturnAllocationChanges(changes);
    
    return {
      ledgerOps,
      balanceOp,
      allocationChanges
    };
  }
  
  /**
   * Handle vendor payment edit transaction
   * Returns all operations to perform when editing a vendor payment
   */
  async handleVendorPaymentEdit(params: {
    paymentId: number;
    vendorId: number;
    oldAmount: number;
    newAmount: number;
    oldAllocations: Array<{ purchase_id: number; allocated_amount: number }>;
    newAllocations: Array<{ purchase_id: number; allocated_amount: number }>;
    paymentMode: number;
    paymentDate: number;
    paymentType: string;
    fy: number;
  }): Promise<{
    purchasesToUpdate: number[];
    amountDiff: number;
    allocDiff: number;
    ledgerOps: LedgerOperation[];
  }> {
    const amountDiff = params.newAmount - params.oldAmount;
    
    // Get all affected purchases
    const oldPurchaseIds = params.oldAllocations.map(a => a.purchase_id);
    const newPurchaseIds = params.newAllocations.map(a => a.purchase_id);
    const allIds = [...oldPurchaseIds, ...newPurchaseIds];
    const purchasesToUpdate = allIds.filter((id, index) => allIds.indexOf(id) === index);
    
    // Calculate allocation difference for balance update
    const oldTotalAllocated = params.oldAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const newTotalAllocated = params.newAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const allocDiff = newTotalAllocated - oldTotalAllocated;
    
    // Create ledger operation ONLY if amount changed
    const ledgerOps: LedgerOperation[] = [];
    if (amountDiff !== 0) {
      ledgerOps.push({
        description: `Payment amount ${amountDiff > 0 ? 'increase' : 'decrease'}`,
        entry: {
          vendor_id: params.vendorId,
          transaction_date: params.paymentDate,
          transaction_type: 'PAYMENT_ADJUSTMENT',
          reference_type: 'purchase',
          reference_id: params.paymentId,
          reference_no: `PAY-${params.paymentId}`,
          payment_mode: params.paymentMode,
          payment_status: 1,
          payment_date: params.paymentDate,
          debit: amountDiff < 0 ? Math.abs(amountDiff) : 0,
          credit: amountDiff > 0 ? amountDiff : 0,
          notes: `Payment #${params.paymentId} amount ${amountDiff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(amountDiff).toFixed(2)}${params.paymentType === 'MIXED' ? ' (Mixed: partial allocation + advance)' : params.paymentType === 'DIRECT' ? ' (Direct advance)' : ' (Bill specific)'}`,
          fy: params.fy
        }
      });
    }
    
    return {
      purchasesToUpdate,
      amountDiff,
      allocDiff,
      ledgerOps
    };
  }
  
  /**
   * Handle vendor refund edit transaction
   * Returns all operations to perform when editing a vendor refund
   * NOTE: Currently not fully implemented - vendor refunds don't need complex ledger adjustments
   */
  async handleVendorRefundEdit(params: {
    refundId: number;
    vendorId: number;
    oldAmount: number;
    newAmount: number;
    oldAllocations: Array<{ return_id: number; allocated_amount: number }>;
    newAllocations: Array<{ return_id: number; allocated_amount: number }>;
    refundMode: number;
    refundDate: number;
    refundType: string;
    fy: number;
  }): Promise<{
    returnsToUpdate: number[];
    amountDiff: number;
    allocDiff: number;
    ledgerOps: LedgerOperation[];
  }> {
    const amountDiff = params.newAmount - params.oldAmount;
    
    // Get all affected returns
    const oldReturnIds = params.oldAllocations.map(a => a.return_id);
    const newReturnIds = params.newAllocations.map(a => a.return_id);
    const allIds = [...oldReturnIds, ...newReturnIds];
    const returnsToUpdate = allIds.filter((id, index) => allIds.indexOf(id) === index);
    
    // Calculate allocation difference for balance update
    const oldTotalAllocated = params.oldAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const newTotalAllocated = params.newAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const allocDiff = newTotalAllocated - oldTotalAllocated;
    
    // TODO: Add ledger operation when REFUND_ADJUSTMENT type is added to schema
    const ledgerOps: LedgerOperation[] = [];
    
    return {
      returnsToUpdate,
      amountDiff,
      allocDiff,
      ledgerOps
    };
  }
  
  /**
   * Execute all operations within a transaction
   * This is the main method that APIs should call
   */
  async executeInTransaction(
    tx: any,
    result: TransactionResult
  ): Promise<void> {
    // 1. Execute ledger operations and track adjustment entries
    const adjustmentEntryIds: { vendorId: number; entryId: number }[] = [];
    
    for (const op of result.ledgerOps) {
      // Create the entry
      const createdEntry = await tx.vendor_ledger.create({
        data: {
          vendor_id: op.entry.vendor_id,
          transaction_date: op.entry.transaction_date,
          transaction_type: op.entry.transaction_type,
          reference_type: op.entry.reference_type,
          reference_id: op.entry.reference_id,
          reference_no: op.entry.reference_no,
          payment_mode: op.entry.payment_mode,
          payment_status: op.entry.payment_status,
          payment_date: op.entry.payment_date,
          debit: op.entry.debit,
          credit: op.entry.credit,
          balance: await ledgerService.getLatestBalance(op.entry.vendor_id, tx) + op.entry.debit - op.entry.credit,
          notes: op.entry.notes || '',
          fy: op.entry.fy
        }
      });
      
      // Track if this is an adjustment entry
      if (op.entry.transaction_type.includes('_ADJUSTMENT')) {
        adjustmentEntryIds.push({
          vendorId: op.entry.vendor_id,
          entryId: createdEntry.id
        });
      }
    }
    
    // 1b. Recalculate ledger balances if any adjustment entries were created
    for (const adjustment of adjustmentEntryIds) {
      await ledgerService.recalculateBalancesAfter(
        adjustment.vendorId,
        adjustment.entryId,
        tx
      );
    }
    
    // 2. Execute allocation changes
    for (const change of result.allocationChanges) {
      await this.executeAllocationChange(tx, change);
    }
    
    // 3. Execute balance update
    if (result.balanceOp) {
      await balanceHandler.incrementBalanceInTransaction(
        tx,
        result.balanceOp.vendorId,
        result.balanceOp.update
      );
    }
  }
  
  /**
   * Get allocation changes for purchase status transitions
   */
  private getPurchaseAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Paid
      case '2→1': // Partial → Paid
        // Create payment and allocation
        allocationChanges.push({
          action: 'CREATE',
          type: 'PAYMENT',
          data: {
            vendorId: changes.vendorId,
            purchaseId: changes.purchaseId,
            amount: statusChange === '0→1' ? changes.newTotal : (changes.newTotal - (changes.totalAllocated || 0)),
            paymentMode: changes.paymentMode,
            paymentDate: changes.paymentDate,
            fy: changes.fy,
            invoiceNo: changes.invoiceNo
          }
        });
        break;
        
      case '1→0': // Paid → Unpaid
      case '2→0': // Partial → Unpaid
        // Delete payment allocations
        allocationChanges.push({
          action: 'DELETE',
          type: 'PAYMENT',
          where: {
            purchaseId: changes.purchaseId
          }
        });
        break;
    }
    
    return allocationChanges;
  }
  
  /**
   * Get allocation changes for return status transitions
   * ❌ COMMENTED OUT - Issue #6 & #7: No refund allocations for returns
   */
  private getReturnAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    // ❌ All refund allocation logic commented out
    // Balance adjusts automatically from DEBIT_NOTE ledger entry
    // const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    // switch (statusChange) {
    //   case '0→1': // Unpaid → Complete
    //   case '2→1': // Partial → Complete
    //     // Create refund and allocation
    //     allocationChanges.push({
    //       action: 'CREATE',
    //       type: 'REFUND',
    //       data: {
    //         vendorId: changes.vendorId,
    //         returnId: changes.returnId,
    //         amount: statusChange === '0→1' ? changes.newTotal : (changes.newTotal - (changes.totalAllocated || 0)),
    //         refundMode: changes.paymentMode,
    //         refundDate: changes.paymentDate,
    //         fy: changes.fy,
    //         debitNoteNo: changes.debitNoteNo
    //       }
    //     });
    //     break;
        
    //   case '1→0': // Complete → Unpaid
    //   case '2→0': // Partial → Unpaid
    //     // Delete refund allocations
    //     allocationChanges.push({
    //       action: 'DELETE',
    //       type: 'REFUND',
    //       where: {
    //         returnId: changes.returnId
    //       }
    //     });
    //     break;
    // }
    
    return allocationChanges;
  }
  
  /**
   * Execute a single allocation change
   */
  private async executeAllocationChange(
    tx: any,
    change: AllocationChange
  ): Promise<void> {
    if (change.action === 'CREATE') {
      if (change.type === 'PAYMENT') {
        // Create payment record
        const payment = await tx.vendor_payments.create({
          data: {
            vendor_id: change.data.vendorId,
            payment_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
            payment_amount: change.data.amount,
            payment_mode: change.data.paymentMode || 1,
            payment_type: 'BILL_SPECIFIC',
            notes: `Payment for purchase ${change.data.invoiceNo}`,
            fy: change.data.fy
          }
        });
        
        // Create allocation record
        await tx.payment_allocations.create({
          data: {
            payment_id: payment.id,
            purchase_id: change.data.purchaseId,
            allocated_amount: change.data.amount,
            allocation_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
            notes: 'Allocated during purchase edit'
          }
        });
      } else if (change.type === 'REFUND') {
        // Create refund record
        const refund = await tx.vendor_refunds.create({
          data: {
            vendor_id: change.data.vendorId,
            refund_date: change.data.refundDate || Math.floor(Date.now() / 1000),
            refund_amount: change.data.amount,
            refund_mode: change.data.refundMode || 1,
            refund_type: 'RETURN_SPECIFIC',
            notes: `Refund for return ${change.data.debitNoteNo}`,
            fy: change.data.fy
          }
        });
        
        // Create allocation record
        await tx.refund_allocations.create({
          data: {
            refund_id: refund.id,
            return_id: change.data.returnId,
            allocated_amount: change.data.amount,
            allocation_date: change.data.refundDate || Math.floor(Date.now() / 1000),
            notes: 'Allocated during return edit'
          }
        });
      }
    } else if (change.action === 'DELETE') {
      if (change.type === 'PAYMENT') {
        // Get allocations to delete
        const allocations = await tx.payment_allocations.findMany({
          where: { purchase_id: change.where.purchaseId },
          select: { payment_id: true }
        });
        
        // Delete allocations
        await tx.payment_allocations.deleteMany({
          where: { purchase_id: change.where.purchaseId }
        });
        
        // Delete vendor_payments if no other allocations exist
        for (const alloc of allocations) {
          const remainingAllocs = await tx.payment_allocations.count({
            where: { payment_id: alloc.payment_id }
          });
          
          if (remainingAllocs === 0) {
            await tx.vendor_payments.delete({
              where: { id: alloc.payment_id }
            });
          }
        }
      } else if (change.type === 'REFUND') {
        // Get allocations to delete
        const allocations = await tx.refund_allocations.findMany({
          where: { return_id: change.where.returnId },
          select: { refund_id: true }
        });
        
        // Delete allocations
        await tx.refund_allocations.deleteMany({
          where: { return_id: change.where.returnId }
        });
        
        // Delete vendor_refunds if no other allocations exist
        for (const alloc of allocations) {
          const remainingAllocs = await tx.refund_allocations.count({
            where: { refund_id: alloc.refund_id }
          });
          
          if (remainingAllocs === 0) {
            await tx.vendor_refunds.delete({
              where: { id: alloc.refund_id }
            });
          }
        }
      }
    }
  }
}

// Export singleton instance
export const transactionHandler = new TransactionHandler();
