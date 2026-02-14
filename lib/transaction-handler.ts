/**
 * Transaction Handler Service
 * Orchestrates all operations for purchase and return transactions
 * Coordinates ledger, balance, and allocation operations
 */

import { ledgerHandler, LedgerOperation, LedgerUpdateOperation, LedgerDeleteOperation, ChangeSet } from './ledger-handler';
import { balanceHandler, BalanceOperation } from './balance-handler';
import { ledgerService } from './ledger-service';

export interface AllocationChange {
  action: 'CREATE' | 'DELETE';
  type: 'PAYMENT' | 'REFUND';
  data?: any;
  where?: any;
}

export interface TransactionResult {
  ledgerOps: LedgerOperation[];           // CREATE operations (keep for backward compatibility)
  ledgerCreates: LedgerOperation[];       // NEW: Explicit CREATE operations
  ledgerUpdates: LedgerUpdateOperation[]; // NEW: UPDATE operations
  ledgerDeletes: LedgerDeleteOperation[]; // NEW: DELETE operations
  balanceOp: BalanceOperation | null;
  allocationChanges: AllocationChange[];
  context?: {                             // NEW: Context for balance logging
    entityType?: 'purchase' | 'return' | 'payment' | 'refund';
    entityId?: number;
    referenceNo?: string;
  };
  metadata?: {                            // ✅ NEW: Additional metadata for specific operations
    amountDiff?: number;
    allocDiff?: number;
    purchasesToUpdate?: number[];
  };
}

export interface DeleteOperation {
  type: 'STOCK_RESTORE' | 'DELETE_ALLOCATIONS' | 'DELETE_RECORD' | 'RECALCULATE_STATUS' | 'LEDGER_REVERSAL' | 'BALANCE_UPDATE';
  data: any;
  parallel?: boolean; // Can be executed in parallel with other operations
}

export interface LedgerReversalData {
  entityType: 'purchase' | 'purchase_return' | 'payment' | 'refund';
  entityId: number;
  vendorId: number;
  isDeletion?: boolean; // ✅ NEW: If true, DELETE entries instead of creating reversals
  allocatedPurchaseIds?: number[];
  allocatedReturnIds?: number[];
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
    hasPaymentLedger?: boolean;  // ✅ NEW: Indicates if PAYMENT/PAYMENT_ADJUSTMENT exists (real payment vs advance)
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
      hasPaymentLedger: params.hasPaymentLedger,  // ✅ NEW: Pass to ledger handler
      amountChanged: params.oldTotal !== params.newTotal,
      currentBalance: params.currentBalance
    };
    
    // Get ledger operations (NEW: Returns mixed CREATE/UPDATE/DELETE)
    const ledgerResult = ledgerHandler.getPurchaseLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = balanceHandler.getPurchaseBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getPurchaseAllocationChanges(changes);
    
    return {
      ledgerOps: ledgerResult.creates,     // For backward compatibility
      ledgerCreates: ledgerResult.creates,
      ledgerUpdates: ledgerResult.updates,
      ledgerDeletes: ledgerResult.deletes,
      balanceOp,
      allocationChanges,
      context: {                           // ✅ NEW: Pass purchase context for logging
        entityType: 'purchase',
        entityId: params.purchaseId,
        referenceNo: params.invoiceNo
      }
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
    // ✅ CHECK IF DEBIT_NOTE EXISTS (for ledger handler)
    const existingDebitNote = await params.tx.vendor_ledger.findFirst({
      where: {
        vendor_id: params.vendorId,
        transaction_type: 'DEBIT_NOTE',
        reference_type: 'purchase_return',
        reference_id: params.returnId
      },
      orderBy: { id: 'desc' }
    });

    // Calculate if amount changed
    const amountChanged = Math.abs(params.newTotal - params.oldTotal) > 0.01;

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
    
    // Get ledger operations (NEW: Returns mixed CREATE/UPDATE/DELETE)
    const ledgerResult = ledgerHandler.getReturnLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = balanceHandler.getReturnBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getReturnAllocationChanges(changes);
    
    return {
      ledgerOps: ledgerResult.creates,     // For backward compatibility
      ledgerCreates: ledgerResult.creates,
      ledgerUpdates: ledgerResult.updates,
      ledgerDeletes: ledgerResult.deletes,
      balanceOp,
      allocationChanges
    };
  }
  
  /**
   * Handle vendor payment edit transaction
   * ✅ REFACTORED: Returns UPDATE operations instead of PAYMENT_ADJUSTMENT
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
  }): Promise<TransactionResult> {
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
    
    const ledgerUpdates: LedgerUpdateOperation[] = [];
    
    // UPDATE PAYMENT ledger entry if amount changed
    if (amountDiff !== 0) {
      ledgerUpdates.push({
        description: 'Update payment amount',
        where: {
          transaction_id: params.paymentId,
          transaction_type: 'PAYMENT'
        },
        data: {
          credit: params.newAmount,
          notes: `Payment #${params.paymentId} updated to ₹${params.newAmount.toFixed(2)}${params.paymentType === 'MIXED' ? ' (Mixed: partial allocation + advance)' : params.paymentType === 'DIRECT' ? ' (Direct advance)' : ' (Bill specific)'}`
        }
      });
    }
    
    // Balance update
    const balanceOp: BalanceOperation | null = (amountDiff !== 0 || allocDiff !== 0) ? {
      vendorId: params.vendorId,
      update: {
        total_paid: amountDiff,
        total_allocated: allocDiff
      }
    } : null;
    
    return {
      ledgerOps: [],
      ledgerCreates: [],
      ledgerUpdates,
      ledgerDeletes: [],
      balanceOp,
      allocationChanges: [],  // Handled separately in API
      metadata: {
        amountDiff,
        allocDiff,
        purchasesToUpdate
      }
    };
  }
  
  /**
   * Handle vendor refund edit transaction
   * ✅ REFACTORED: Returns UPDATE operations instead of REFUND_ADJUSTMENT
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
    tx?: any;
  }): Promise<TransactionResult> {
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
    
    const ledgerUpdates: LedgerUpdateOperation[] = [];
    
    // UPDATE REFUND_RECEIVED ledger entry if amount changed
    if (amountDiff !== 0) {
      ledgerUpdates.push({
        description: 'Update refund amount',
        where: {
          transaction_id: params.refundId,
          transaction_type: 'REFUND_RECEIVED'
        },
        data: {
          debit: params.newAmount,
          notes: `Refund #${params.refundId} updated to ₹${params.newAmount.toFixed(2)}${params.refundType === 'DIRECT' ? ' (Direct)' : ' (Return specific)'}`
        }
      });
    }
    
    // Balance update
    const balanceOp: BalanceOperation | null = (amountDiff !== 0 || allocDiff !== 0) ? {
      vendorId: params.vendorId,
      update: {
        total_refunded: amountDiff,
        total_refund_allocated: allocDiff
      }
    } : null;
    
    return {
      ledgerOps: [],
      ledgerCreates: [],
      ledgerUpdates,
      ledgerDeletes: [],
      balanceOp,
      allocationChanges: []  // Handled separately in API
    };
  }
  
  /**
   * Execute ledger UPDATE operations
   * Updates existing ledger entries and recalculates balances
   */
  private async executeLedgerUpdates(
    tx: any,
    updates: LedgerUpdateOperation[]
  ): Promise<void> {
    for (const update of updates) {
      console.log(`[LEDGER UPDATE] ${update.description}`, update.where);
      
      // Get entries before update for balance recalculation
      const entries = await tx.vendor_ledger.findMany({
        where: update.where,
        select: { id: true, vendor_id: true }
      });
      
      if (entries.length === 0) {
        console.warn(`[LEDGER UPDATE] No entries found for update:`, update.where);
        continue;
      }
      
      // Execute UPDATE
      await tx.vendor_ledger.updateMany({
        where: update.where,
        data: update.data
      });
      
      // Recalculate balances after update
      const firstEntry = entries[0];
      await ledgerService.recalculateBalancesAfter(
        firstEntry.vendor_id,
        firstEntry.id,
        tx
      );
      
      console.log(`[LEDGER UPDATE] Updated ${entries.length} entries and recalculated balances`);
    }
  }
  
  /**
   * Execute ledger DELETE operations
   * Deletes ledger entries and recalculates balances
   */
  private async executeLedgerDeletes(
    tx: any,
    deletes: LedgerDeleteOperation[]
  ): Promise<void> {
    for (const deleteOp of deletes) {
      console.log(`[LEDGER DELETE] ${deleteOp.description}`, deleteOp.where);
      
      // Get entry info before deletion for balance recalculation
      const entries = await tx.vendor_ledger.findMany({
        where: deleteOp.where,
        select: { id: true, vendor_id: true }
      });
      
      if (entries.length === 0) {
        console.warn(`[LEDGER DELETE] No entries found for deletion:`, deleteOp.where);
        continue;
      }
      
      const vendorId = entries[0].vendor_id;
      
      // Delete entries
      await tx.vendor_ledger.deleteMany({
        where: deleteOp.where
      });
      
      // Recalculate balances after deletion (from start)
      await ledgerService.recalculateBalancesAfter(vendorId, 0, tx);
      
      console.log(`[LEDGER DELETE] Deleted ${entries.length} entries and recalculated balances`);
    }
  }
  
  /**
   * Execute all operations within a transaction
   * This is the main method that APIs should call
   * ✅ FIXED: Checks for existing PAYMENT entries to avoid duplicates
   * ✅ NEW: Creates payments BEFORE ledger entries to set transaction_id during creation
   * ✅ NEW: Executes UPDATE and DELETE operations
   */
  async executeInTransaction(
    tx: any,
    result: TransactionResult
  ): Promise<void> {
    // 0. Execute allocation changes FIRST to create payments and get payment IDs
    const paymentMap = new Map<number, number>(); // purchase_id -> payment_id
    const refundMap = new Map<number, number>(); // return_id -> refund_id
    
    for (const change of result.allocationChanges) {
      if (change.action === 'CREATE') {
        if (change.type === 'PAYMENT') {
          // Create payment record
          const payment = await tx.vendor_payments.create({
            data: {
              vendor_id: change.data.vendorId,
              payment_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
              payment_amount: change.data.amount,
              payment_mode: change.data.paymentMode || 1,
              payment_type: change.data.paymentType || 'BILL_SPECIFIC',
              notes: change.data.notes || `Payment for purchase ${change.data.invoiceNo}`,
              fy: change.data.fy
            }
          });
          
          // Store payment ID for this purchase
          paymentMap.set(change.data.purchaseId, payment.id);
          
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
          
          // Store refund ID for this return
          refundMap.set(change.data.returnId, refund.id);
          
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
        // Handle deletions (this was previously in executeAllocationChange)
        await this.executeAllocationChange(tx, change);
      }
    }
    
    // 1. Execute ledger operations and track adjustment entries
    const adjustmentEntryIds: { vendorId: number; entryId: number }[] = [];
    
    for (const op of result.ledgerOps) {
      let entryToCreate = op.entry;
      
      // ✅ Issue 6 FIX: Skip ledger creation for advance allocations
      // When marking unpaid→paid using advance balance, we only create payment_allocations
      // The PAYMENT ledger entry already exists from the original advance payment
      const isAdvanceAllocation = entryToCreate.notes?.includes('Allocated from advance balance');
      
      if (!isAdvanceAllocation) {
        // ✅ NEW: Get transaction_id from payment/refund maps
        let transactionId: number | undefined;
        let updatedNotes = entryToCreate.notes || '';
        
        if (entryToCreate.transaction_type === 'PAYMENT' && entryToCreate.reference_id) {
          transactionId = paymentMap.get(entryToCreate.reference_id);
          
          // ✅ NEW: Update notes to include payment ID
          if (transactionId) {
            updatedNotes = `Payment ₹${entryToCreate.credit} for bill INV-${entryToCreate.reference_no} via Payment #${transactionId}`;
          }
        } else if (entryToCreate.transaction_type === 'REFUND_RECEIVED' && entryToCreate.reference_id) {
          transactionId = refundMap.get(entryToCreate.reference_id);
          
          // ✅ NEW: Update notes to include refund ID
          if (transactionId) {
            updatedNotes = `Refund ₹${entryToCreate.debit} for return ${entryToCreate.reference_no} via Refund #${transactionId}`;
          }
        }
        
        // Create the entry (only for new payments, not advance allocations)
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
            notes: updatedNotes,  // ✅ NEW: Use updated notes with payment/refund ID
            fy: entryToCreate.fy,
            transaction_id: transactionId  // ✅ NEW: Set transaction_id if payment/refund
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
    }
    
    // 1b. Recalculate ledger balances if any adjustment entries were created
    for (const adjustment of adjustmentEntryIds) {
      await ledgerService.recalculateBalancesAfter(
        adjustment.vendorId,
        adjustment.entryId,
        tx
      );
    }
    
    // 1c. Execute ledger UPDATES (NEW)
    if (result.ledgerUpdates && result.ledgerUpdates.length > 0) {
      await this.executeLedgerUpdates(tx, result.ledgerUpdates);
    }
    
    // 1d. Execute ledger DELETES (NEW)
    if (result.ledgerDeletes && result.ledgerDeletes.length > 0) {
      await this.executeLedgerDeletes(tx, result.ledgerDeletes);
    }
    
    // NOTE: Old step 2 "Execute allocation changes" has been MOVED to step 0 above
    // This allows us to create payments BEFORE ledger entries, so transaction_id can be
    // set during ledger creation instead of requiring an UPDATE query later.
    // CREATE operations are now inline in step 0, DELETE operations call executeAllocationChange.
    
    // 2. Execute balance update
    if (result.balanceOp) {
      // Determine source type and details based on balance operation context
      let sourceType: any;
      let sourceId: number | undefined;
      let referenceNo: string | undefined;
      let notes: string | undefined;
      
      // Check what type of operation this is based on what data is present
      if (result.ledgerCreates.length > 0) {
        const firstOp = result.ledgerCreates[0];
        if (firstOp.entry.transaction_type === 'PURCHASE') {
          sourceType = 'purchase_edit';
          sourceId = firstOp.entry.reference_id;
          referenceNo = `INV-${firstOp.entry.reference_no}`;
          notes = 'Purchase edited';
        } else if (firstOp.entry.transaction_type === 'DEBIT_NOTE') {
          sourceType = 'return_edit';
          sourceId = firstOp.entry.reference_id;
          referenceNo = firstOp.entry.reference_no;
          notes = 'Return edited';
        } else if (firstOp.entry.transaction_type === 'PAYMENT') {
          sourceType = 'payment_edit';
          sourceId = firstOp.entry.transaction_id;
          referenceNo = `PAY-${firstOp.entry.transaction_id}`;
          notes = 'Payment edit via status change';
        }
      }
      
      // ✅ NEW: Use context if we couldn't determine from ledger operations
      if (!sourceType && result.context) {
        if (result.context.entityType === 'purchase') {
          sourceType = 'purchase_edit';
          sourceId = result.context.entityId;
          referenceNo = `INV-${result.context.referenceNo}`;
          notes = 'Purchase status changed';
        } else if (result.context.entityType === 'return') {
          sourceType = 'return_edit';
          sourceId = result.context.entityId;
          referenceNo = result.context.referenceNo || '';
          notes = 'Return status changed';
        }
      }
      
      // Default source if we still couldn't determine
      if (!sourceType) {
        sourceType = 'status_change';
        notes = 'Balance adjusted via status change';
      }
      
      await balanceHandler.incrementBalanceInTransaction(
        tx,
        result.balanceOp.vendorId,
        result.balanceOp.update,
        sourceId && referenceNo ? {
          type: sourceType,
          id: sourceId,
          reference_no: referenceNo,
          notes: notes || 'Balance update'
        } : undefined
      );
    }
  }
  
  /**
   * Helper method to create payment allocations with advance balance check
   * Returns array of allocations (0, 1, or 2) for advance usage and new payment
   */
  private createPaymentAllocation(
    amount: number,
    changes: ChangeSet
  ): AllocationChange[] {
    const allocations: AllocationChange[] = [];
    
    // Calculate advance balance - include both unallocated payments AND unallocated refunds
    const advanceBalance = changes.currentBalance 
      ? (Number(changes.currentBalance.total_paid) - Number(changes.currentBalance.total_allocated)) +
        (Number(changes.currentBalance.total_refunded) - Number(changes.currentBalance.total_refund_allocated))
      : 0;
    
    // Calculate how much advance can be used and how much new payment is needed
    const advanceUsed = Math.min(Math.max(0, advanceBalance), amount);
    const newPayment = amount - advanceUsed;
    
    // ✅ FIX: Determine payment type based on allocation mix
    // - MIXED: Both advance and new payment used
    // - BILL_SPECIFIC: Only advance OR only new payment (both are bill-specific)
    const paymentType = (advanceUsed > 0 && newPayment > 0) ? 'MIXED' : 'BILL_SPECIFIC';
    
    // Create allocation for advance portion
    if (advanceUsed > 0) {
      console.log(`[PAYMENT ALLOCATION] Creating advance allocation: ₹${advanceUsed.toFixed(2)} from advance balance`);
      allocations.push({
        action: 'CREATE',
        type: 'PAYMENT',
        data: {
          vendorId: changes.vendorId,
          purchaseId: changes.purchaseId,
          amount: advanceUsed,
          paymentMode: changes.paymentMode,
          paymentDate: changes.paymentDate,
          paymentType: paymentType,  // ✅ Use MIXED or BILL_SPECIFIC
          fy: changes.fy,
          invoiceNo: changes.invoiceNo,
          notes: `Allocated from advance balance: ₹${advanceUsed.toFixed(2)}`
        }
      });
    }
    
    // Create allocation for new payment portion
    if (newPayment > 0) {
      console.log(`[PAYMENT ALLOCATION] Creating new payment: ₹${newPayment.toFixed(2)} new payment`);
      allocations.push({
        action: 'CREATE',
        type: 'PAYMENT',
        data: {
          vendorId: changes.vendorId,
          purchaseId: changes.purchaseId,
          amount: newPayment,
          paymentMode: changes.paymentMode,
          paymentDate: changes.paymentDate,
          paymentType: paymentType,  // ✅ Use MIXED or BILL_SPECIFIC
          fy: changes.fy,
          invoiceNo: changes.invoiceNo
        }
      });
    }
    
    if (allocations.length === 0) {
      console.log(`[PAYMENT ALLOCATION] No allocations created (amount: ₹${amount}, advance: ₹${advanceBalance})`);
    }
    
    return allocations;
  }
  
  /**
   * Get allocation changes for purchase status transitions
   * ✅ FIXED: Now creates allocations for both advance and new payment
   */
  private getPurchaseAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Paid
        // ✅ Use helper to check advance balance and create allocations
        const allocations01 = this.createPaymentAllocation(changes.newTotal, changes);
        allocationChanges.push(...allocations01);
        break;
        
      case '2→1': // Partial → Paid
        // ✅ Use helper to check advance balance for remaining amount
        const remainingAmount = changes.newTotal - (changes.totalAllocated || 0);
        const allocations21 = this.createPaymentAllocation(remainingAmount, changes);
        allocationChanges.push(...allocations21);
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
            payment_type: change.data.paymentType || 'BILL_SPECIFIC',
            notes: change.data.notes || `Payment for purchase ${change.data.invoiceNo}`,
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
    
    // Operation 4: Delete ledger entries (parallel)
    // ✅ FIX: For purchase deletion, DELETE entries instead of creating reversals
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'purchase',
        entityId: params.purchaseId,
        vendorId: params.vendorId,
        isDeletion: true  // ✅ NEW: Delete entries, don't create reversals
      },
      parallel: true
    });
    
    // Operation 5: Update balance if paid
    if (params.paymentStatus === 1 || params.paymentStatus === 2) {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          vendorId: params.vendorId,
          paymentStatus: params.paymentStatus,
          purchaseId: params.purchaseId,  // ✅ Pass for logging
          invoiceNo: params.invoiceNo      // ✅ Pass for logging
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
    
    // Operation 4: Delete ledger entries (parallel)
    // ✅ FIX: For return deletion, DELETE entries instead of creating reversals
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: 'purchase_return',
        entityId: params.returnId,
        vendorId: params.vendorId,
        isDeletion: true  // ✅ NEW: Delete entries, don't create reversals
      },
      parallel: true
    });
    
    // Operation 5: Update balance if refunded
    if (params.paymentStatus === 1) {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          vendorId: params.vendorId,
          paymentStatus: params.paymentStatus,
          returnId: params.returnId  // ✅ FIX: Add returnId
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
        vendorId: params.vendorId,
        paymentType: params.paymentType  // ✅ Pass payment type for query selection
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        vendorId: params.vendorId,
        paymentAmount: params.paymentAmount,
        paymentType: params.paymentType,
        paymentId: params.paymentId  // ✅ FIX: Add paymentId
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
        vendorId: params.vendorId,
        refundType: params.refundType  // ✅ Pass refund type for query selection
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        vendorId: params.vendorId,
        refundAmount: params.refundAmount,
        refundType: params.refundType,
        refundId: params.refundId  // ✅ FIX: Add refundId
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
      context.totalPaid = totalPaid; // ✅ FIX: Share with BALANCE_UPDATE operation
      
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
      context.totalRefunded = totalRefunded; // ✅ FIX: Share with BALANCE_UPDATE operation
      
    } else if (data.entityType === 'payment') {
      // ✅ Store allocated purchase IDs AND amounts before deletion
      const allocations = await tx.payment_allocations.findMany({
        where: { payment_id: data.entityId },
        select: { purchase_id: true, allocated_amount: true }
      });
      const purchaseIds = allocations.map(a => a.purchase_id);
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Store in both data (for backward compatibility) and shared context
      data.allocatedPurchaseIds = purchaseIds;
      context.allocatedPurchaseIds = purchaseIds; // ✅ Share with other operations
      context.totalAllocatedPayment = totalAllocated; // ✅ NEW: Share total allocated for balance update
      
      await tx.payment_allocations.deleteMany({
        where: { payment_id: data.entityId }
      });
      
    } else if (data.entityType === 'refund') {
      // ✅ Store allocated return IDs AND amounts before deletion
      const allocations = await tx.refund_allocations.findMany({
        where: { refund_id: data.entityId },
        select: { return_id: true, allocated_amount: true }
      });
      const returnIds = allocations.map(a => a.return_id);
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Store in both data (for backward compatibility) and shared context
      data.allocatedReturnIds = returnIds;
      context.allocatedReturnIds = returnIds; // ✅ Share with other operations
      context.totalAllocatedRefund = totalAllocated; // ✅ NEW: Share total allocated for balance update
      
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
          // ✅ DELETE DEBIT_NOTE ledger entries directly (no reversal needed)
          await tx.vendor_ledger.deleteMany({
            where: {
              reference_type: 'purchase_return',
              reference_id: { in: returnIds },
              transaction_type: 'DEBIT_NOTE'
            }
          });
          
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
    
    // ✅ SIMPLIFIED: All payment/refund types now have transaction_id, so just query by it!
    if (data.entityType === 'payment') {
      console.log(`[LEDGER REVERSAL] Deleting PAYMENT ledger entries for payment_id=${data.entityId}`);
      
      ledgerEntries = await tx.vendor_ledger.findMany({
        where: {
          transaction_id: data.entityId,
          transaction_type: 'PAYMENT'  // No more PAYMENT_ADJUSTMENT
        }
      });
      
      console.log(`[LEDGER REVERSAL] Found ${ledgerEntries.length} PAYMENT ledger entries`);
      
    } else if (data.entityType === 'refund') {
      console.log(`[LEDGER REVERSAL] Deleting REFUND ledger entries for refund_id=${data.entityId}`);
      
      ledgerEntries = await tx.vendor_ledger.findMany({
        where: {
          transaction_id: data.entityId,
          transaction_type: 'REFUND_RECEIVED'  // No more REFUND_ADJUSTMENT
        }
      });
      
      console.log(`[LEDGER REVERSAL] Found ${ledgerEntries.length} REFUND ledger entries`);
      
    } else {
      // Standard handling for purchase/return
      ledgerEntries = await tx.vendor_ledger.findMany({
        where: {
          reference_type: data.entityType,
          reference_id: data.entityId
        }
      });
    }
    
    // ✅ FIX: For ALL deletions (purchase/return/payment/refund), delete entries instead of creating reversals
    // Philosophy: "Delete is the reverse of Create" - we remove what was added
    // For payment/refund: Always treat as deletion (no isDeletion flag needed)
    // For purchase/return: Only delete if isDeletion flag is set
    const shouldDelete = 
      data.entityType === 'payment' || 
      data.entityType === 'refund' ||
      (data.isDeletion && (data.entityType === 'purchase' || data.entityType === 'purchase_return'));
    
    if (shouldDelete) {
      // Delete ledger entries (as if the transaction never happened)
      await Promise.all(
        ledgerEntries.map(entry => 
          tx.vendor_ledger.delete({ where: { id: entry.id } })
        )
      );
      
      // ✅ Recalculate balances for all subsequent entries
      if (ledgerEntries.length > 0) {
        const vendorId = ledgerEntries[0].vendor_id;
        await ledgerService.recalculateBalancesAfter(vendorId, 0, tx);
      }
    } else {
      // ✅ EXISTING LOGIC: For status change edits, create reversal entries
      // This preserves audit trail for status changes
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
  }
  
  private async executeBalanceUpdate(tx: any, data: any, context: any): Promise<void> {
    if (data.paymentAmount !== undefined) {
      // Payment deletion - use ACTUAL allocated amount from context, not paymentAmount
      // ✅ FIX: For MIXED payments (e.g., ₹50k total with ₹30k allocated), we need:
      //   total_paid: -50000 (full payment amount)
      //   total_allocated: -30000 (actual allocated, NOT 50000!)
      const actualAllocated = context.totalAllocatedPayment !== undefined 
        ? context.totalAllocatedPayment 
        : (data.paymentType === 'DIRECT' ? 0 : data.paymentAmount);
      
      await balanceHandler.incrementBalanceInTransaction(
        tx, 
        data.vendorId, 
        {
          total_paid: -Number(data.paymentAmount),
          total_allocated: -actualAllocated
        },
        {
          type: 'payment_delete',
          id: data.paymentId || 0,  // ✅ FIX: Use data.paymentId instead of context
          reference_no: `PAY-${data.paymentId || '?'}`,
          notes: `Payment deleted: ₹${data.paymentAmount}`
        }
      );
      
    } else if (data.refundAmount !== undefined) {
      // Refund deletion - use ACTUAL allocated amount from context, not refundAmount
      // ✅ FIX: Same logic as payment - use actual allocated amount
      const actualAllocated = context.totalAllocatedRefund !== undefined 
        ? context.totalAllocatedRefund 
        : (data.refundType === 'DIRECT' ? 0 : data.refundAmount);
      
      await balanceHandler.incrementBalanceInTransaction(
        tx, 
        data.vendorId, 
        {
          total_refunded: -Number(data.refundAmount),
          total_refund_allocated: -actualAllocated
        },
        {
          type: 'refund_delete',
          id: data.refundId || 0,  // ✅ FIX: Use data.refundId instead of context
          reference_no: `REF-${data.refundId || '?'}`,
          notes: `Refund deleted: ₹${data.refundAmount}`
        }
      );
      
    } else if (context.totalPaid !== undefined) {
      // ✅ Purchase deletion - use context.totalPaid shared from DELETE_ALLOCATIONS
      await balanceHandler.incrementBalanceInTransaction(
        tx, 
        data.vendorId, 
        {
          total_allocated: -context.totalPaid
        },
        {
          type: 'purchase_delete',
          id: data.purchaseId || 0,
          reference_no: `INV-${data.invoiceNo || '?'}`,
          notes: `Purchase deleted: deallocated ₹${context.totalPaid}`
        }
      );
      
    } else if (context.totalRefunded !== undefined) {
      // ✅ Return deletion - use context.totalRefunded shared from DELETE_ALLOCATIONS
      await balanceHandler.incrementBalanceInTransaction(
        tx, 
        data.vendorId, 
        {
          total_refund_allocated: -context.totalRefunded
        },
        {
          type: 'return_delete',
          id: data.returnId || 0,  // ✅ FIX: Use data.returnId instead of context
          reference_no: `DN-${data.returnId || '?'}`,
          notes: `Return deleted: deallocated ₹${context.totalRefunded}`
        }
      );
    }
  }
}

// Export singleton instance
export const transactionHandler = new TransactionHandler();
