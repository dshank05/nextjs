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
    fy: number;
    totalAllocated?: number;
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
      returnId: params.returnId,
      debitNoteNo: params.debitNoteNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      fy: params.fy,
      totalAllocated: params.totalAllocated,
      amountChanged: params.oldTotal !== params.newTotal,
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
   * Execute all operations within a transaction
   * This is the main method that APIs should call
   */
  async executeInTransaction(
    tx: any,
    result: TransactionResult
  ): Promise<void> {
    // 1. Execute ledger operations
    for (const op of result.ledgerOps) {
      await ledgerService.createEntry(op.entry, tx);
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
   */
  private getReturnAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Refunded
      case '2→1': // Partial → Refunded
        // Create refund and allocation
        allocationChanges.push({
          action: 'CREATE',
          type: 'REFUND',
          data: {
            vendorId: changes.vendorId,
            returnId: changes.returnId,
            amount: statusChange === '0→1' ? changes.newTotal : (changes.newTotal - (changes.totalAllocated || 0)),
            refundMode: changes.paymentMode,
            refundDate: changes.paymentDate,
            fy: changes.fy,
            debitNoteNo: changes.debitNoteNo
          }
        });
        break;
        
      case '1→0': // Refunded → Unpaid
      case '2→0': // Partial → Unpaid
        // Delete refund allocations
        allocationChanges.push({
          action: 'DELETE',
          type: 'REFUND',
          where: {
            returnId: changes.returnId
          }
        });
        break;
    }
    
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
