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

export interface DeleteOperation {
  type: 'STOCK_RESTORE' | 'DELETE_ALLOCATIONS' | 'DELETE_RECORD' | 'RECALCULATE_STATUS' | 'LEDGER_REVERSAL' | 'BALANCE_UPDATE';
  data: any;
  parallel?: boolean; // Can be executed in parallel with other operations
}

export interface DeleteResult {
  operations: DeleteOperation[];
  vendorId: number;
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

    // ✅ DELETE EXISTING REFUND_REVERSAL ENTRIES to prevent duplicates
    // When user edits Complete→Incomplete multiple times, we want only ONE reversal entry
    // This ensures clean ledger and prevents accumulation of duplicate reversals
    if (params.oldStatus === 1 && params.newStatus === 0) {
      await params.tx.vendor_ledger.deleteMany({
        where: {
          vendor_id: params.vendorId,
          reference_type: 'purchase_return',
          reference_id: params.returnId,
          transaction_type: 'REFUND_REVERSAL'
        }
      });
    }

    // ✅ Also handle Partial→Incomplete case (2→0)
    if (params.oldStatus === 2 && params.newStatus === 0) {
      await params.tx.vendor_ledger.deleteMany({
        where: {
          vendor_id: params.vendorId,
          reference_type: 'purchase_return',
          reference_id: params.returnId,
          transaction_type: 'REFUND_REVERSAL'
        }
      });
    }

    // ✅ FIX: Delete REFUND_REVERSAL when going Incomplete→Complete
    // This handles the 1→0→1 path where REFUND_REVERSAL was created on 1→0
    // When going 0→1 again, delete the reversal so DEBIT_NOTE stands alone
    if (params.oldStatus === 0 && params.newStatus === 1) {
      await params.tx.vendor_ledger.deleteMany({
        where: {
          vendor_id: params.vendorId,
          reference_type: 'purchase_return',
          reference_id: params.returnId,
          transaction_type: 'REFUND_REVERSAL'
        }
      });
    }

    // ✅ FIX: Also handle Partial→Complete case (2→1)
    if (params.oldStatus === 2 && params.newStatus === 1) {
      await params.tx.vendor_ledger.deleteMany({
        where: {
          vendor_id: params.vendorId,
          reference_type: 'purchase_return',
          reference_id: params.returnId,
          transaction_type: 'REFUND_REVERSAL'
        }
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
    
    // ✅ FIX: Get purchase ID for PAYMENT_ADJUSTMENT ledger entry to enable proper merging
    // PAYMENT_ADJUSTMENT must use same reference_id as original PAYMENT for ledger merge to work
    const purchaseId = params.newAllocations[0]?.purchase_id || 
                       params.oldAllocations[0]?.purchase_id || 
                       params.paymentId; // Fallback for DIRECT payments (though shouldn't have adjustments)
    
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
          reference_id: purchaseId, // ✅ FIX: Use purchaseId instead of paymentId for proper ledger merging
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
   * ✅ FIXED: Now creates REFUND_ADJUSTMENT ledger entries when amount changes
   * ✅ FIXED: Copies reference from existing REFUND_RECEIVED entry for proper merge
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
    tx?: any; // ✅ NEW: Transaction context for querying existing entry
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
    
    // ✅ FIX: Create ledger operation when amount changes
    const ledgerOps: LedgerOperation[] = [];
    if (amountDiff !== 0 && params.tx) {
      // ✅ QUERY: Find existing REFUND_RECEIVED entry to copy references from
      const existingEntry = await params.tx.vendor_ledger.findFirst({
        where: {
          vendor_id: params.vendorId,
          transaction_type: 'REFUND_RECEIVED',
          OR: [
            { reference_no: params.refundId.toString() },  // Direct refund
            { notes: { contains: `Refund #${params.refundId}` } }  // Return-specific refund
          ]
        },
        orderBy: { id: 'desc' }
      });
      
      if (existingEntry) {
        ledgerOps.push({
          description: `Refund amount ${amountDiff > 0 ? 'increase' : 'decrease'}`,
          entry: {
            vendor_id: params.vendorId,
            transaction_date: params.refundDate,
            transaction_type: 'REFUND_ADJUSTMENT',
            reference_type: existingEntry.reference_type as any,  // ✅ Copy from existing!
            reference_id: existingEntry.reference_id || undefined,  // ✅ Copy from existing!
            reference_no: existingEntry.reference_no || `REF-${params.refundId}`,  // ✅ Copy from existing!
            payment_mode: params.refundMode,
            payment_status: 1,
            payment_date: params.refundDate,
            debit: amountDiff > 0 ? amountDiff : 0,  // ✅ FIX: Increase = DEBIT (adds to balance)
            credit: amountDiff < 0 ? Math.abs(amountDiff) : 0,  // ✅ FIX: Decrease = CREDIT (reduces balance)
            notes: `Refund #${params.refundId} amount ${amountDiff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(amountDiff).toFixed(2)}${params.refundType === 'DIRECT' ? ' (Direct)' : ' (Return specific)'}`,
            fy: params.fy
          }
        });
      }
    }
    
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
   * ✅ FIXED: Checks for existing PAYMENT entries to avoid duplicates
   */
  async executeInTransaction(
    tx: any,
    result: TransactionResult
  ): Promise<void> {
    // 1. Execute ledger operations and track adjustment entries
    const adjustmentEntryIds: { vendorId: number; entryId: number }[] = [];
    
    for (const op of result.ledgerOps) {
      let entryToCreate = op.entry;
      
      // ✅ Check if this operation requires existence check
      if (op.checkExisting && op.checkExisting.useAdjustmentIfExists) {
        const existingEntry = await tx.vendor_ledger.findFirst({
          where: {
            vendor_id: op.entry.vendor_id,
            transaction_type: op.checkExisting.transactionType,
            reference_type: op.entry.reference_type,
            reference_id: op.entry.reference_id
          },
          select: { credit: true }
        });
        
        if (existingEntry) {
          // Entry exists - use PAYMENT_ADJUSTMENT instead
          const creditDiff = op.entry.credit - Number(existingEntry.credit);
          entryToCreate = {
            ...op.entry,
            transaction_type: 'PAYMENT_ADJUSTMENT',
            credit: creditDiff > 0 ? creditDiff : 0,
            debit: creditDiff < 0 ? Math.abs(creditDiff) : 0,
            notes: `Payment ${creditDiff > 0 ? 'increased' : 'adjusted'} by ₹${Math.abs(creditDiff).toFixed(2)} for purchase ${op.entry.reference_no}`
          };
        }
      }
      
      // Create the entry
      const createdEntry = await tx.vendor_ledger.create({
        data: {
          vendor_id: entryToCreate.vendor_id,
          transaction_date: entryToCreate.transaction_date,
          transaction_type: entryToCreate.transaction_type,
          reference_type: entryToCreate.reference_type,
          reference_id: entryToCreate.reference_id,
          reference_no: entryToCreate.reference_no,
          payment_mode: entryToCreate.payment_mode,
          payment_status: entryToCreate.payment_status,
          payment_date: entryToCreate.payment_date,
          debit: entryToCreate.debit,
          credit: entryToCreate.credit,
          balance: await ledgerService.getLatestBalance(entryToCreate.vendor_id, tx) + entryToCreate.debit - entryToCreate.credit,
          notes: entryToCreate.notes || '',
          fy: entryToCreate.fy
        }
      });
      
      // Track if this is an adjustment entry
      if (entryToCreate.transaction_type.includes('_ADJUSTMENT')) {
        adjustmentEntryIds.push({
          vendorId: entryToCreate.vendor_id,
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
  
  /**
   * Handle purchase deletion
   * Returns all operations needed to delete a purchase
   */
  async handlePurchaseDelete(params: {
    purchaseId: number;
    vendorId: number;
    invoiceNo: number;
    paymentStatus: number;
    returnStatus: number;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Get and restore stock (parallel)
    operations.push({
      type: 'STOCK_RESTORE',
      data: { invoiceNo: params.invoiceNo },
      parallel: true
    });
    
    // Operation 2: Delete allocations if paid
    if (params.paymentStatus === 1 || params.paymentStatus === 2) {
      operations.push({
        type: 'DELETE_ALLOCATIONS',
        data: { 
          entityType: 'purchase',
          entityId: params.purchaseId,
          paymentStatus: params.paymentStatus
        },
        parallel: false
      });
    }
    
    // Operation 3: Delete items and bill_to
    operations.push({
      type: 'DELETE_RECORD',
      data: {
        type: 'purchase',
        invoiceNo: params.invoiceNo,
        purchaseId: params.purchaseId
      },
      parallel: false
    });
    
    // Operation 4: Create ledger reversals (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'purchase',
        entityId: params.purchaseId,
        vendorId: params.vendorId
      },
      parallel: true
    });
    
    // Operation 5: Update balance if paid
    if (params.paymentStatus === 1 || params.paymentStatus === 2) {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          vendorId: params.vendorId,
          paymentStatus: params.paymentStatus
        },
        parallel: false
      });
    }
    
    return {
      operations,
      vendorId: params.vendorId
    };
  }
  
  /**
   * Handle purchase return deletion
   * Returns all operations needed to delete a return
   */
  async handleReturnDelete(params: {
    returnId: number;
    vendorId: number;
    paymentStatus: number;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Get and restore stock (parallel)
    operations.push({
      type: 'STOCK_RESTORE',
      data: { returnId: params.returnId },
      parallel: true
    });
    
    // Operation 2: Delete refund allocations if refunded
    if (params.paymentStatus === 1) {
      operations.push({
        type: 'DELETE_ALLOCATIONS',
        data: { 
          entityType: 'return',
          entityId: params.returnId,
          paymentStatus: params.paymentStatus
        },
        parallel: false
      });
    }
    
    // Operation 3: Delete return items
    operations.push({
      type: 'DELETE_RECORD',
      data: {
        type: 'return',
        returnId: params.returnId
      },
      parallel: false
    });
    
    // Operation 4: Create ledger reversals (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'purchase_return',
        entityId: params.returnId,
        vendorId: params.vendorId
      },
      parallel: true
    });
    
    // Operation 5: Update balance if refunded
    if (params.paymentStatus === 1) {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          vendorId: params.vendorId,
          paymentStatus: params.paymentStatus
        },
        parallel: false
      });
    }
    
    return {
      operations,
      vendorId: params.vendorId
    };
  }
  
  /**
   * Handle payment deletion
   * Returns all operations needed to delete a payment
   */
  async handlePaymentDelete(params: {
    paymentId: number;
    vendorId: number;
    paymentAmount: number;
    paymentType: string;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Delete allocations and recalculate statuses
    operations.push({
      type: 'DELETE_ALLOCATIONS',
      data: { 
        entityType: 'payment',
        entityId: params.paymentId
      },
      parallel: false
    });
    
    // Operation 2: Recalculate purchase statuses (can be parallel)
    operations.push({
      type: 'RECALCULATE_STATUS',
      data: {
        entityType: 'payment',
        entityId: params.paymentId
      },
      parallel: true
    });
    
    // Operation 3: Delete payment record
    operations.push({
      type: 'DELETE_RECORD',
      data: {
        type: 'payment',
        paymentId: params.paymentId
      },
      parallel: false
    });
    
    // Operation 4: Create ledger reversals (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'payment',
        entityId: params.paymentId,
        vendorId: params.vendorId
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        vendorId: params.vendorId,
        paymentAmount: params.paymentAmount,
        paymentType: params.paymentType
      },
      parallel: false
    });
    
    return {
      operations,
      vendorId: params.vendorId
    };
  }
  
  /**
   * Handle refund deletion
   * Returns all operations needed to delete a refund
   */
  async handleRefundDelete(params: {
    refundId: number;
    vendorId: number;
    refundAmount: number;
    refundType: string;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Delete allocations and recalculate statuses
    operations.push({
      type: 'DELETE_ALLOCATIONS',
      data: { 
        entityType: 'refund',
        entityId: params.refundId
      },
      parallel: false
    });
    
    // Operation 2: Recalculate return statuses (can be parallel)
    operations.push({
      type: 'RECALCULATE_STATUS',
      data: {
        entityType: 'refund',
        entityId: params.refundId
      },
      parallel: true
    });
    
    // Operation 3: Delete refund record
    operations.push({
      type: 'DELETE_RECORD',
      data: {
        type: 'refund',
        refundId: params.refundId
      },
      parallel: false
    });
    
    // Operation 4: Create ledger reversals (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'refund',
        entityId: params.refundId,
        vendorId: params.vendorId
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        vendorId: params.vendorId,
        refundAmount: params.refundAmount,
        refundType: params.refundType
      },
      parallel: false
    });
    
    return {
      operations,
      vendorId: params.vendorId
    };
  }
  
  /**
   * Execute DELETE operations within a transaction
   * Optimized with parallel execution where safe
   * ✅ FIX: Uses shared context to pass data between operations
   */
  async executeDeleteInTransaction(
    tx: any,
    result: DeleteResult
  ): Promise<void> {
    // ✅ Create shared context for operations to communicate
    const sharedContext: any = {};
    
    for (const operation of result.operations) {
      switch (operation.type) {
        case 'STOCK_RESTORE':
          await this.executeStockRestore(tx, operation.data, sharedContext);
          break;
          
        case 'DELETE_ALLOCATIONS':
          await this.executeDeleteAllocations(tx, operation.data, sharedContext);
          break;
          
        case 'DELETE_RECORD':
          await this.executeDeleteRecord(tx, operation.data, sharedContext);
          break;
          
        case 'RECALCULATE_STATUS':
          await this.executeRecalculateStatus(tx, operation.data, sharedContext);
          break;
          
        case 'LEDGER_REVERSAL':
          await this.executeLedgerReversal(tx, operation.data, sharedContext);
          break;
          
        case 'BALANCE_UPDATE':
          await this.executeBalanceUpdate(tx, operation.data, sharedContext);
          break;
      }
    }
  }
  
  // Helper methods for DELETE operations
  // ✅ All methods now accept shared context for passing data between operations
  
  private async executeStockRestore(tx: any, data: any, context: any): Promise<void> {
    if (data.invoiceNo !== undefined) {
      // Purchase: restore stock for all items
      const items = await tx.purchaseitems.findMany({
        where: { invoice_no: data.invoiceNo },
        select: { product_id: true, qty: true }
      });
      
      // Parallel stock updates
      await Promise.all(
        items.map(item => 
          item.product_id && item.qty ? 
          tx.product.update({
            where: { id: item.product_id },
            data: { stock: { decrement: item.qty } }
          }) : Promise.resolve()
        )
      );
    } else if (data.returnId !== undefined) {
      // Return: restore stock for all items
      const returnItems = await tx.purchase_return_items.findMany({
        where: { purchase_return_id: data.returnId },
        select: { purchase_item_id: true, return_qty: true }
      });
      
      const purchaseItemIds = returnItems.map(item => item.purchase_item_id);
      const purchaseItems = await tx.purchaseitems.findMany({
        where: { id: { in: purchaseItemIds } },
        select: { id: true, product_id: true }
      });
      
      const itemMap = new Map(purchaseItems.map(pi => [pi.id, pi.product_id]));
      
      // Parallel stock updates
      await Promise.all(
        returnItems.map(item => {
          const productId = itemMap.get(item.purchase_item_id);
          return productId ? 
          tx.product.update({
            where: { id: productId },
            data: { stock: { increment: item.return_qty } }
          }) : Promise.resolve();
        })
      );
    }
  }
  
  private async executeDeleteAllocations(tx: any, data: any, context: any): Promise<void> {
    if (data.entityType === 'purchase') {
      const allocations = await tx.payment_allocations.findMany({
        where: { purchase_id: data.entityId },
        select: { payment_id: true, allocated_amount: true }
      });
      
      const totalPaid = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Delete allocations
      await tx.payment_allocations.deleteMany({
        where: { purchase_id: data.entityId }
      });
      
      // ✅ FIX: Delete vendor_payments records (they were auto-created with purchase)
      // Clean approach: "Delete is the reverse of create"
      const paymentIds = Array.from(new Set(allocations.map(a => a.payment_id)));
      for (const paymentId of paymentIds) {
        // Only delete if no other allocations exist for this payment
        const remainingAllocs = await tx.payment_allocations.count({
          where: { payment_id: paymentId }
        });
        
        if (remainingAllocs === 0) {
          await tx.vendor_payments.delete({ where: { id: paymentId } });
        }
      }
      
      // Store for balance update
      data.totalPaid = totalPaid;
      
    } else if (data.entityType === 'return') {
      const allocations = await tx.refund_allocations.findMany({
        where: { return_id: data.entityId },
        select: { refund_id: true, allocated_amount: true }
      });
      
      const totalRefunded = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Delete allocations
      await tx.refund_allocations.deleteMany({
        where: { return_id: data.entityId }
      });
      
      // ✅ FIX: Delete vendor_refunds records (they were auto-created with return)
      // Clean approach: "Delete is the reverse of create"
      const refundIds = Array.from(new Set(allocations.map(a => a.refund_id)));
      for (const refundId of refundIds) {
        // Only delete if no other allocations exist for this refund
        const remainingAllocs = await tx.refund_allocations.count({
          where: { refund_id: refundId }
        });
        
        if (remainingAllocs === 0) {
          await tx.vendor_refunds.delete({ where: { id: refundId } });
        }
      }
      
      // Store for balance update
      data.totalRefunded = totalRefunded;
      
    } else if (data.entityType === 'payment') {
      // ✅ Store allocated purchase IDs before deletion for ledger reversal AND status recalculation
      const allocations = await tx.payment_allocations.findMany({
        where: { payment_id: data.entityId },
        select: { purchase_id: true }
      });
      const purchaseIds = allocations.map(a => a.purchase_id);
      
      // Store in both data (for backward compatibility) and shared context
      data.allocatedPurchaseIds = purchaseIds;
      context.allocatedPurchaseIds = purchaseIds; // ✅ NEW: Share with other operations
      
      await tx.payment_allocations.deleteMany({
        where: { payment_id: data.entityId }
      });
      
    } else if (data.entityType === 'refund') {
      // ✅ Store allocated return IDs before deletion for ledger reversal AND status recalculation
      const allocations = await tx.refund_allocations.findMany({
        where: { refund_id: data.entityId },
        select: { return_id: true }
      });
      const returnIds = allocations.map(a => a.return_id);
      
      // Store in both data (for backward compatibility) and shared context
      data.allocatedReturnIds = returnIds;
      context.allocatedReturnIds = returnIds; // ✅ NEW: Share with other operations
      
      await tx.refund_allocations.deleteMany({
        where: { refund_id: data.entityId }
      });
    }
  }
  
  private async executeDeleteRecord(tx: any, data: any, context: any): Promise<void> {
    if (data.type === 'purchase') {
      // ✅ FIX: Delete related returns FIRST to avoid FK constraint violations
      // Get all purchase item IDs for this invoice
      const purchaseItems = await tx.purchaseitems.findMany({
        where: { invoice_no: data.invoiceNo },
        select: { id: true }
      });
      
      const itemIds = purchaseItems.map(item => item.id);
      
      if (itemIds.length > 0) {
        // Get return IDs that reference these purchase items
        const returnItems = await tx.purchase_return_items.findMany({
          where: { purchase_item_id: { in: itemIds } },
          select: { purchase_return_id: true },
          distinct: ['purchase_return_id']
        });
        
        const returnIds = returnItems.map(r => r.purchase_return_id);
        
        if (returnIds.length > 0) {
          // ✅ FIX: Create DEBIT_NOTE reversals BEFORE deleting returns
          for (const returnId of returnIds) {
            const debitNoteEntries = await tx.vendor_ledger.findMany({
              where: {
                reference_type: 'purchase_return',
                reference_id: returnId,
                transaction_type: 'DEBIT_NOTE'
              }
            });
            
            // Create DEBIT_NOTE_REVERSAL for each DEBIT_NOTE
            for (const entry of debitNoteEntries) {
              await ledgerService.createEntry({
                vendor_id: entry.vendor_id,
                transaction_date: Math.floor(Date.now() / 1000),
                transaction_type: 'DEBIT_NOTE_REVERSAL',
                reference_type: 'purchase_return',
                reference_id: entry.reference_id,
                reference_no: entry.reference_no || '',
                payment_mode: entry.payment_mode,
                debit: entry.credit,  // Reverse: swap credit → debit
                credit: entry.debit,  // Reverse: swap debit → credit
                notes: `Reversal: DEBIT_NOTE deleted (purchase deletion)`,
                fy: entry.fy
              }, tx);
            }
          }
          
          // Delete return items first (child records)
          await tx.purchase_return_items.deleteMany({
            where: { purchase_item_id: { in: itemIds } }
          });
          
          // Delete purchase_returns records (parent records)
          await tx.purchase_returns.deleteMany({
            where: { id: { in: returnIds } }
          });
        }
      }
      
      // NOW safe to delete purchase items (no more FK references)
      await tx.purchaseitems.deleteMany({ where: { invoice_no: data.invoiceNo } });
      await tx.bill_to.deleteMany({ where: { invoice_no: data.invoiceNo } });
      await tx.purchase.delete({ where: { id: data.purchaseId } });
      
    } else if (data.type === 'return') {
      await tx.purchase_return_items.deleteMany({ where: { purchase_return_id: data.returnId } });
      await tx.purchase_returns.delete({ where: { id: data.returnId } });
      
    } else if (data.type === 'payment') {
      await tx.vendor_payments.delete({ where: { id: data.paymentId } });
      
    } else if (data.type === 'refund') {
      await tx.vendor_refunds.delete({ where: { id: data.refundId } });
    }
  }
  
  private async executeRecalculateStatus(tx: any, data: any, context: any): Promise<void> {
    if (data.entityType === 'payment') {
      // ✅ FIX: Use purchase IDs from shared context (already captured before deletion)
      const purchaseIds = context.allocatedPurchaseIds || [];
      
      // Recalculate in parallel
      await Promise.all(
        purchaseIds.map(purchaseId => 
          require('./payment-allocation-service').recalculatePurchaseStatus(purchaseId, tx)
        )
      );
      
    } else if (data.entityType === 'refund') {
      // ✅ FIX: Use return IDs from shared context (already captured before deletion)
      const returnIds = context.allocatedReturnIds || [];
      
      // Recalculate in parallel
      await Promise.all(
        returnIds.map(returnId => 
          require('./payment-allocation-service').recalculatePurchaseReturnStatus(returnId, tx)
        )
      );
    }
  }
  
  private async executeLedgerReversal(tx: any, data: any, context: any): Promise<void> {
    let ledgerEntries = [];
    
    // ✅ Special handling for payment/refund deletion
    if (data.entityType === 'payment') {
      // Get DIRECT/unallocated payment entries
      const directEntries = await tx.vendor_ledger.findMany({
        where: {
          reference_type: 'payment',
          reference_id: data.entityId
        }
      });
      
      // Get allocated payment entries - filter by notes containing payment ID
      const allocatedEntries = data.allocatedPurchaseIds?.length > 0 ? await tx.vendor_ledger.findMany({
        where: {
          transaction_type: 'PAYMENT',
          reference_type: 'purchase',
          reference_id: { in: data.allocatedPurchaseIds },
          notes: { contains: `Payment #${data.entityId}` }
        }
      }) : [];
      
      ledgerEntries = [...directEntries, ...allocatedEntries];
      
    } else if (data.entityType === 'refund') {
      // Get DIRECT/unallocated refund entries (no reference_type or undefined)
      const directEntries = await tx.vendor_ledger.findMany({
        where: {
          transaction_type: 'REFUND_RECEIVED',
          reference_type: null
        }
      });
      
      // Get allocated refund entries - filter by notes containing refund ID
      const allocatedEntries = data.allocatedReturnIds?.length > 0 ? await tx.vendor_ledger.findMany({
        where: {
          transaction_type: 'REFUND_RECEIVED',
          reference_type: 'purchase_return',
          reference_id: { in: data.allocatedReturnIds },
          notes: { contains: `Refund #${data.entityId}` }
        }
      }) : [];
      
      ledgerEntries = [...directEntries, ...allocatedEntries];
      
    } else {
      // Standard handling for purchase/return
      ledgerEntries = await tx.vendor_ledger.findMany({
        where: {
          reference_type: data.entityType,
          reference_id: data.entityId
        }
      });
    }
    
    // Create reversals in parallel
    await Promise.all(
      ledgerEntries.map(entry => 
        ledgerService.createEntry({
          vendor_id: entry.vendor_id,
          transaction_date: Math.floor(Date.now() / 1000),
          transaction_type: `${entry.transaction_type}_REVERSAL` as any,
          reference_type: entry.reference_type,
          reference_id: entry.reference_id,
          reference_no: entry.reference_no || '',
          payment_mode: entry.payment_mode,
          debit: entry.credit,
          credit: entry.debit,
          notes: `Reversal: ${entry.transaction_type} deleted`,
          fy: entry.fy
        }, tx)
      )
    );
  }
  
  private async executeBalanceUpdate(tx: any, data: any, context: any): Promise<void> {
    if (data.paymentAmount !== undefined) {
      // Payment deletion
      const totalAllocated = data.paymentType === 'DIRECT' ? 0 : data.paymentAmount;
      await balanceHandler.incrementBalanceInTransaction(tx, data.vendorId, {
        total_paid: -Number(data.paymentAmount),
        total_allocated: -totalAllocated
      });
      
    } else if (data.refundAmount !== undefined) {
      // Refund deletion
      const totalAllocated = data.refundType === 'DIRECT' ? 0 : data.refundAmount;
      await balanceHandler.incrementBalanceInTransaction(tx, data.vendorId, {
        total_refunded: -Number(data.refundAmount),
        total_refund_allocated: -totalAllocated
      });
      
    } else if (data.totalPaid !== undefined) {
      // Purchase deletion - only update allocated (payment record kept)
      await balanceHandler.incrementBalanceInTransaction(tx, data.vendorId, {
        total_allocated: -data.totalPaid
      });
      
    } else if (data.totalRefunded !== undefined) {
      // Return deletion - only update refund_allocated (refund record kept)
      await balanceHandler.incrementBalanceInTransaction(tx, data.vendorId, {
        total_refund_allocated: -data.totalRefunded
      });
    }
  }
}

// Export singleton instance
export const transactionHandler = new TransactionHandler();
