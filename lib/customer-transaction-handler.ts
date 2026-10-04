/**
 * Customer Transaction Handler Service
 * Orchestrates all operations for sale/salex and return transactions
 * Coordinates ledger, balance, and allocation operations
 */

import { customerLedgerHandler, LedgerOperation, LedgerUpdateOperation, LedgerDeleteOperation, ChangeSet } from './customer-ledger-handler';
import { customerBalanceHandler, BalanceOperation } from './customer-balance-handler';
import { customerLedgerService } from './customer-ledger-service';
import { saleTables } from './sale';
import { allocateFromAdvance, releaseAllocations, returnCounterAmounts, availableAdvance } from './advance-allocation';
import { recalculateSaleStatus, recalculateSaleReturnRefundStatus } from './payment-allocation-service';

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
    entityType?: 'sale' | 'salex' | 'return' | 'payment' | 'refund';
    entityId?: number;
    referenceNo?: string;
  };
  metadata?: {                            // NEW: Additional metadata for specific operations
    amountDiff?: number;
    allocDiff?: number;
    invoicesToUpdate?: number[];
  };
}

export interface DeleteOperation {
  type: 'STOCK_RESTORE' | 'DELETE_ALLOCATIONS' | 'DELETE_RECORD' | 'RECALCULATE_STATUS' | 'LEDGER_REVERSAL' | 'BALANCE_UPDATE';
  data: any;
  parallel?: boolean; // Can be executed in parallel with other operations
}

export interface LedgerReversalData {
  entityType: 'sale' | 'salex' | 'sale_return' | 'salex_return' | 'payment' | 'refund';
  entityId: number;
  customerId: number;
  isDeletion?: boolean; // If true, DELETE entries instead of creating reversals
  allocatedInvoiceIds?: number[];
  allocatedReturnIds?: number[];
}

export interface DeleteResult {
  operations: DeleteOperation[];
  customerId: number;
}

/** Table names for the two invoice families - one map, in lib/sale.ts. */
const invoiceTables = saleTables;

export class CustomerTransactionHandler {
  /**
   * Handle sale/salex edit transaction
   * Returns all operations to perform
   */
  async handleSaleEdit(params: {
    type: 'sale' | 'salex';
    oldStatus: number;
    newStatus: number;
    oldTotal: number;
    newTotal: number;
    customerId: number;
    invoiceId: number;
    invoiceNo: string;
    paymentMode?: number;
    paymentDate?: number;
    fy: number;
    totalAllocated?: number;
    /** BILL_SPECIFIC money this bill brought in (L-30 twin, SA-12). */
    paidByThisDocument?: number;
    isTypeA?: boolean;
    hasPaymentLedger?: boolean;  // Indicates if PAYMENT_RECEIVED exists
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
  }): Promise<TransactionResult> {
    console.log(`[CUSTOMER TRANSACTION HANDLER] handleSaleEdit called with:`, JSON.stringify(params, null, 2));
    
    // Build change set
    const changes: ChangeSet = {
      oldStatus: params.oldStatus,
      newStatus: params.newStatus,
      oldTotal: params.oldTotal,
      newTotal: params.newTotal,
      customerId: params.customerId,
      invoiceId: params.invoiceId,
      docType: params.type,
      invoiceNo: params.invoiceNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      fy: params.fy,
      totalAllocated: params.totalAllocated,
      paidByThisDocument: params.paidByThisDocument,
      isTypeA: params.isTypeA,
      hasPaymentLedger: params.hasPaymentLedger,
      amountChanged: params.oldTotal !== params.newTotal,
      currentBalance: params.currentBalance
    };
    
    // Get ledger operations (NEW: Returns mixed CREATE/UPDATE/DELETE)
    const ledgerResult = customerLedgerHandler.getSaleLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = customerBalanceHandler.getSaleBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getSaleAllocationChanges(changes);
    
    return {
      ledgerOps: ledgerResult.creates,     // For backward compatibility
      ledgerCreates: ledgerResult.creates,
      ledgerUpdates: ledgerResult.updates,
      ledgerDeletes: ledgerResult.deletes,
      balanceOp,
      allocationChanges,
      context: {
        entityType: params.type,
        entityId: params.invoiceId,
        referenceNo: params.invoiceNo
      }
    };
  }

  /**
   * Handle return edit transaction
   * Returns all operations to perform
   */
  async handleReturnEdit(params: {
    type: 'sale' | 'salex';
    oldStatus: number;
    newStatus: number;
    oldTotal: number;
    newTotal: number;
    customerId: number;
    returnId: number;
    creditNoteNo: string;
    paymentMode?: number;
    paymentDate?: number;
    returnDate: number;
    fy: number;
    totalAllocated?: number;
    totalAmount: number;
    totalTax: number;
    tx: any;
    currentBalance?: {
      total_paid: number;
      total_allocated: number;
      total_refunded: number;
      total_refund_allocated: number;
    };
  }): Promise<TransactionResult> {
    // Check if CREDIT_NOTE exists (for ledger handler)
    const existingCreditNote = await params.tx.customer_ledger.findFirst({
      where: {
        customer_id: params.customerId,
        transaction_type: 'CREDIT_NOTE',
        reference_type: params.type === 'sale' ? 'sale_return' : 'salex_return',
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
      customerId: params.customerId,
      returnId: params.returnId,
      docType: params.type,
      creditNoteNo: params.creditNoteNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      returnDate: params.returnDate,
      fy: params.fy,
      totalAllocated: params.totalAllocated,
      hasExistingCreditNote: !!existingCreditNote,
      amountChanged: amountChanged,
      currentBalance: params.currentBalance
    };
    
    // Get ledger operations (NEW: Returns mixed CREATE/UPDATE/DELETE)
    const ledgerResult = customerLedgerHandler.getReturnLedgerOps(changes);
    
    // Get balance operation
    const balanceOp = customerBalanceHandler.getReturnBalanceOps(changes);
    
    // Get allocation changes
    const allocationChanges = this.getReturnAllocationChanges(changes);
    
    return {
      ledgerOps: ledgerResult.creates,
      ledgerCreates: ledgerResult.creates,
      ledgerUpdates: ledgerResult.updates,
      ledgerDeletes: ledgerResult.deletes,
      balanceOp,
      allocationChanges
    };
  }

  /**
   * Handle customer payment edit transaction
   * Returns UPDATE operations instead of PAYMENT_ADJUSTMENT
   */
  async handleCustomerPaymentEdit(params: {
    paymentId: number;
    customerId: number;
    oldAmount: number;
    newAmount: number;
    oldAllocations: Array<{ invoice_id?: number; invoicex_id?: number; allocated_amount: number }>;
    newAllocations: Array<{ invoice_id?: number; invoicex_id?: number; allocated_amount: number }>;
    paymentMode: number;
    paymentDate: number;
    paymentType: string;
    fy: number;
  }): Promise<TransactionResult> {
    const amountDiff = params.newAmount - params.oldAmount;
    
    // Get all affected invoices
    const oldInvoiceIds = params.oldAllocations.map(a => a.invoice_id || a.invoicex_id).filter(Boolean) as number[];
    const newInvoiceIds = params.newAllocations.map(a => a.invoice_id || a.invoicex_id).filter(Boolean) as number[];
    const allIds = [...oldInvoiceIds, ...newInvoiceIds];
    const invoicesToUpdate = allIds.filter((id, index) => allIds.indexOf(id) === index);
    
    // Calculate allocation difference for balance update
    const oldTotalAllocated = params.oldAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const newTotalAllocated = params.newAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const allocDiff = newTotalAllocated - oldTotalAllocated;
    
    const ledgerUpdates: LedgerUpdateOperation[] = [];
    
    // UPDATE PAYMENT_RECEIVED ledger entry if amount changed
    if (amountDiff !== 0) {
      ledgerUpdates.push({
        description: 'Update payment amount',
        where: {
          transaction_id: params.paymentId,
          transaction_type: 'PAYMENT_RECEIVED'
        },
        data: {
          // PAYMENT_RECEIVED is a credit everywhere it is created (SA-03).
          credit: params.newAmount,
          notes: `Payment #${params.paymentId} updated to ₹${params.newAmount.toFixed(2)}${params.paymentType === 'MIXED' ? ' (Mixed: partial allocation + advance)' : params.paymentType === 'DIRECT' ? ' (Direct advance)' : ' (Bill specific)'}`
        }
      });
    }
    
    // Balance update
    const balanceOp: BalanceOperation | null = (amountDiff !== 0 || allocDiff !== 0) ? {
      customerId: params.customerId,
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
        invoicesToUpdate
      }
    };
  }

  /**
   * Handle customer refund edit transaction
   * Returns UPDATE operations instead of REFUND_ADJUSTMENT
   */
  async handleCustomerRefundEdit(params: {
    refundId: number;
    customerId: number;
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
    
    // UPDATE REFUND ledger entry if amount changed
    if (amountDiff !== 0) {
      ledgerUpdates.push({
        description: 'Update refund amount',
        // The refund's own row (see executeLedgerReversal): REFUND_PAID,
        // reference_type 'refund' - 'REFUND' by id matched nothing, or a return.
        where: {
          transaction_id: params.refundId,
          reference_type: 'refund',
          transaction_type: { in: ['REFUND_PAID', 'REFUND'] }
        } as any,
        data: {
          // REFUND is a debit everywhere it is created (SA-03).
          debit: params.newAmount,
          notes: `Refund #${params.refundId} updated to ₹${params.newAmount.toFixed(2)}${params.refundType === 'DIRECT' ? ' (Direct)' : ' (Return specific)'}`
        }
      });
    }
    
    // Balance update
    const balanceOp: BalanceOperation | null = (amountDiff !== 0 || allocDiff !== 0) ? {
      customerId: params.customerId,
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
      allocationChanges: [],  // Handled separately in API
      // The route moves the counters from these (as for a payment edit); without
      // them a refund edit left total_refunded at the old amount (found 2026-10-03).
      metadata: { amountDiff, allocDiff }
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
      const entries = await tx.customer_ledger.findMany({
        where: update.where,
        select: { id: true, customer_id: true }
      });
      
      if (entries.length === 0) {
        console.warn(`[LEDGER UPDATE] No entries found for update:`, update.where);
        continue;
      }
      
      // Execute UPDATE
      await tx.customer_ledger.updateMany({
        where: update.where,
        data: update.data
      });
      
      // Recalculate balances after update
      const firstEntry = entries[0];
      await customerLedgerService.recalculateBalancesAfter(
        firstEntry.customer_id,
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
      const entries = await tx.customer_ledger.findMany({
        where: deleteOp.where,
        select: { id: true, customer_id: true }
      });
      
      if (entries.length === 0) {
        console.warn(`[LEDGER DELETE] No entries found for deletion:`, deleteOp.where);
        continue;
      }
      
      const customerId = entries[0].customer_id;
      
      // Delete entries
      await tx.customer_ledger.deleteMany({
        where: deleteOp.where
      });
      
      // Recalculate balances after deletion (from start)
      await customerLedgerService.recalculateBalancesAfter(customerId, 0, tx);
      
      console.log(`[LEDGER DELETE] Deleted ${entries.length} entries and recalculated balances`);
    }
  }

  /**
   * Execute all operations within a transaction
   * This is the main method that APIs should call
   * Creates payments BEFORE ledger entries to set transaction_id during creation
   * Executes UPDATE and DELETE operations
   */
  async executeInTransaction(
    tx: any,
    result: TransactionResult
  ): Promise<void> {
    // 0. Execute allocation changes FIRST to create payments and get payment IDs
    const paymentMap = new Map<number, number>(); // invoice_id -> payment_id
    const refundMap = new Map<number, number>(); // return_id -> refund_id
    
    for (const change of result.allocationChanges) {
      if (change.action === 'CREATE' && change.type === 'PAYMENT') {
        const paymentId = await this.createPaymentAllocation_execute(tx, change);
        if (paymentId !== null) paymentMap.set(change.data.invoiceId, paymentId);
      } else if (change.action === 'DELETE') {
        await this.executeAllocationChange(tx, change);
      }
      // Return-side allocation changes: none are produced (refunds are not
      // allocated on a return edit - see getReturnAllocationChanges). The
      // branch that would have run wrote `return_id`, a column that does not
      // exist on customer_refund_allocations, and was removed.
    }

    // 1. Execute ledger operations and track adjustment entries
    const adjustmentEntryIds: { customerId: number; entryId: number }[] = [];
    
    for (const op of result.ledgerOps) {
      let entryToCreate = op.entry;
      
      // Skip ledger creation for advance allocations
      const isAdvanceAllocation = entryToCreate.notes?.includes('Allocated from advance balance');
      
      if (!isAdvanceAllocation) {
        // Get transaction_id from payment/refund maps
        let transactionId: number | undefined;
        let updatedNotes = entryToCreate.notes || '';
        
        if (entryToCreate.transaction_type === 'PAYMENT_RECEIVED' && entryToCreate.reference_id) {
          transactionId = paymentMap.get(entryToCreate.reference_id);
          
          // Update notes to include payment ID
          if (transactionId) {
            updatedNotes = `Payment ₹${entryToCreate.credit} for bill ${entryToCreate.reference_no} via Payment #${transactionId}`;
          }
        } else if (entryToCreate.transaction_type === 'REFUND' && entryToCreate.reference_id) {
          transactionId = refundMap.get(entryToCreate.reference_id);
          
          // Update notes to include refund ID
          if (transactionId) {
            updatedNotes = `Refund ₹${entryToCreate.credit} for return ${entryToCreate.reference_no} via Refund #${transactionId}`;
          }
        }
        
        // Create the entry
        const createdEntry = await tx.customer_ledger.create({
          data: {
            customer_id: entryToCreate.customer_id,
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
            balance: await customerLedgerService.getLatestBalance(entryToCreate.customer_id, tx) + entryToCreate.debit - entryToCreate.credit,
            notes: updatedNotes,
            fy: entryToCreate.fy,
            transaction_id: transactionId
          }
        });
        
        // Track if this is an adjustment entry
        if (entryToCreate.transaction_type.includes('_ADJUSTMENT')) {
          adjustmentEntryIds.push({
            customerId: entryToCreate.customer_id,
            entryId: createdEntry.id
          });
        }
      }
    }
    
    // 1b. Recalculate ledger balances if any adjustment entries were created
    for (const adjustment of adjustmentEntryIds) {
      await customerLedgerService.recalculateBalancesAfter(
        adjustment.customerId,
        adjustment.entryId,
        tx
      );
    }
    
    // 1c. Execute ledger UPDATES
    if (result.ledgerUpdates && result.ledgerUpdates.length > 0) {
      await this.executeLedgerUpdates(tx, result.ledgerUpdates);
    }
    
    // 1d. Execute ledger DELETES
    if (result.ledgerDeletes && result.ledgerDeletes.length > 0) {
      await this.executeLedgerDeletes(tx, result.ledgerDeletes);
    }

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
        if (firstOp.entry.transaction_type === 'SALE') {
          sourceType = 'sale_edit';
          sourceId = firstOp.entry.reference_id;
          referenceNo = `INV-${firstOp.entry.reference_no}`;
          notes = 'Sale edited';
        } else if (firstOp.entry.transaction_type === 'CREDIT_NOTE') {
          sourceType = 'return_edit';
          sourceId = firstOp.entry.reference_id;
          referenceNo = firstOp.entry.reference_no;
          notes = 'Return edited';
        } else if (firstOp.entry.transaction_type === 'PAYMENT_RECEIVED') {
          // A payment written by a status change (unpaid -> paid) has no id on
          // the op: step 0 created it and holds it in paymentMap. Without one the
          // counters below moved with no balance-log row (found 2026-10-03).
          const paymentId = firstOp.entry.transaction_id ?? paymentMap.get(firstOp.entry.reference_id);
          sourceType = 'payment_received_edit';
          sourceId = paymentId;
          referenceNo = `PAY-${paymentId}`;
          notes = 'Payment edit via status change';
        }
      }
      // Check ledgerUpdates for payment/refund edits (no ledgerCreates)
      else if (result.ledgerUpdates && result.ledgerUpdates.length > 0) {
        const firstUpdate = result.ledgerUpdates[0];
        if (firstUpdate.where.transaction_type === 'PAYMENT_RECEIVED') {
          sourceType = 'payment_received_edit';
          sourceId = firstUpdate.where.transaction_id;
          referenceNo = `PAY-${firstUpdate.where.transaction_id}`;
          notes = 'Payment edited';
        } else if (firstUpdate.where.transaction_type === 'REFUND') {
          sourceType = 'refund_issued_edit';
          sourceId = firstUpdate.where.transaction_id;
          referenceNo = `REF-${firstUpdate.where.transaction_id}`;
          notes = 'Refund edited';
        }
      }
      
      // Use context if we couldn't determine from ledger operations
      if (!sourceType && result.context) {
        if (result.context.entityType === 'sale' || result.context.entityType === 'salex') {
          sourceType = result.context.entityType === 'sale' ? 'sale_edit' : 'salex_edit';
          sourceId = result.context.entityId;
          referenceNo = `INV-${result.context.referenceNo}`;
          notes = 'Sale status changed';
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
        
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx,
        result.balanceOp.customerId,
        result.balanceOp.update,
        // Always logged: a counter that moves without a log row makes the
        // balance-log report disagree with the party's figures.
        {
          type: sourceType,
          id: sourceId ?? 0,
          reference_no: referenceNo ?? '',
          notes: notes || 'Balance update'
        }
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
    
    // Unallocated payments less unallocated refunds (H1: refunds were added)
    
    const advanceBalance = availableAdvance(changes.currentBalance);
    
    // Calculate how much advance can be used and how much new payment is needed
    const advanceUsed = Math.min(Math.max(0, advanceBalance), amount);
    const newPayment = amount - advanceUsed;
    
    // The advance portion is allocated from existing payments when executed
    // (fromAdvance); only new money becomes a payment row, always
    // BILL_SPECIFIC - a MIXED row made here would survive the bill's deletion
    // as a phantom advance (SA-28 / L-26).
    
    // Create allocation for advance portion
    if (advanceUsed > 0) {
      console.log(`[PAYMENT ALLOCATION] Creating advance allocation: ₹${advanceUsed.toFixed(2)} from advance balance`);
      allocations.push({
        action: 'CREATE',
        type: 'PAYMENT',
        data: {
          customerId: changes.customerId,
          invoiceId: changes.invoiceId,
          amount: advanceUsed,
          fromAdvance: true,
          paymentMode: changes.paymentMode,
          paymentDate: changes.paymentDate,
          fy: changes.fy,
          invoiceNo: changes.invoiceNo,
          type: changes.docType,
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
          customerId: changes.customerId,
          invoiceId: changes.invoiceId,
          amount: newPayment,
          paymentMode: changes.paymentMode,
          paymentDate: changes.paymentDate,
          fy: changes.fy,
          invoiceNo: changes.invoiceNo,
          type: changes.docType
        }
      });
    }
    
    if (allocations.length === 0) {
      console.log(`[PAYMENT ALLOCATION] No allocations created (amount: ₹${amount}, advance: ₹${advanceBalance})`);
    }
    
    return allocations;
  }

  /**
   * Get allocation changes for sale status transitions
   * Uses helper to check advance balance and create allocations
   */
  private getSaleAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
    
    switch (statusChange) {
      case '0→1': // Unpaid → Paid
        // Use helper to check advance balance and create allocations
        const allocations01 = this.createPaymentAllocation(changes.newTotal, changes);
        allocationChanges.push(...allocations01);
        break;
        
      case '2→1': // Partial → Paid
        // Use helper to check advance balance for remaining amount
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
            invoiceId: changes.invoiceId,
            type: changes.docType
          }
        });
        break;
    }
    
    return allocationChanges;
  }
  
  /**
   * Get allocation changes for return status transitions
   * No refund allocations for returns - balance adjusts automatically from CREDIT_NOTE ledger entry
   */
  private getReturnAllocationChanges(changes: ChangeSet): AllocationChange[] {
    const allocationChanges: AllocationChange[] = [];
    // All refund allocation logic commented out
    // Balance adjusts automatically from CREDIT_NOTE ledger entry
    return allocationChanges;
  }
  
  /**
   * Create what a CREATE PAYMENT change asks for. The advance portion is
   * allocated from the customer's existing payments (no new row, SA-28); new
   * money is one BILL_SPECIFIC payment. Returns the new payment's id, if any.
   */
  private async createPaymentAllocation_execute(tx: any, change: AllocationChange): Promise<number | null> {
    const t = invoiceTables(change.data.type);
    const date = change.data.paymentDate || Math.floor(Date.now() / 1000);
    if (change.data.fromAdvance) {
      await allocateFromAdvance(tx, 'customer', change.data.customerId, { [t.allocFk]: change.data.invoiceId }, change.data.amount, date,
        { mode: change.data.paymentMode, fy: change.data.fy });
      return null;
    }
    const payment = await tx.customer_payments.create({
      data: {
        customer_id: change.data.customerId,
        payment_date: date,
        payment_amount: change.data.amount,
        payment_mode: change.data.paymentMode ?? 1,
        payment_type: 'BILL_SPECIFIC',
        notes: change.data.notes || `Payment for ${change.data.type} ${change.data.invoiceNo}`,
        fy: change.data.fy
      }
    });
    await tx.customer_payment_allocations.create({
      data: {
        payment_id: payment.id,
        [t.allocFk]: change.data.invoiceId,
        allocated_amount: change.data.amount,
        allocation_date: date,
        notes: 'Allocated during sale edit'
      }
    });
    return payment.id;
  }

  /**
   * DELETE PAYMENT: release the bill's allocations. Only payments this bill
   * created are deleted; an advance it used stays (it used to be deleted too).
   */
  private async executeAllocationChange(tx: any, change: AllocationChange): Promise<void> {
    if (change.action !== 'DELETE' || change.type !== 'PAYMENT') return;
    if (change.where.type !== 'sale' && change.where.type !== 'salex') {
      throw new Error('Payment allocation delete needs a document type');
    }
    // One column or the other - an allocation never has both set (SA-02).
    await releaseAllocations(tx, 'customer', { [invoiceTables(change.where.type).allocFk]: change.where.invoiceId });
  }

  /**
   * Handle sale/salex deletion
   * Returns all operations needed to delete a sale
   */
  async handleSaleDelete(params: {
    type: 'sale' | 'salex';
    invoiceId: number;
    customerId: number;
    invoiceNo: number;
    paymentStatus: number;
    returnStatus: number;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Get and restore stock (parallel)
    operations.push({
      type: 'STOCK_RESTORE',
      data: { 
        // Lines are keyed by the header id, not the printed number.
        invoiceId: params.invoiceId,
        type: params.type
      },
      parallel: true
    });
    
    // Operation 2: Delete allocations if paid
    // Always: a bill marked Unpaid can still hold allocations (SA-02 data);
    // with none, both operations are no-ops.
    {
      operations.push({
        type: 'DELETE_ALLOCATIONS',
        data: { 
          entityType: params.type,
          entityId: params.invoiceId,
          paymentStatus: params.paymentStatus
        },
        parallel: false
      });
    }
    
    // Operation 3: Delete items
    operations.push({
      type: 'DELETE_RECORD',
      data: {
        type: params.type,
        invoiceNo: params.invoiceNo,
        invoiceId: params.invoiceId
      },
      parallel: false
    });
    
    // Operation 4: Delete ledger entries (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: params.type,
        entityId: params.invoiceId,
        customerId: params.customerId,
        isDeletion: true  // Delete entries, don't create reversals
      },
      parallel: true
    });
    
    // Operation 5: Update balance if paid
    // Always: a bill marked Unpaid can still hold allocations (SA-02 data);
    // with none, both operations are no-ops.
    {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          customerId: params.customerId,
          paymentStatus: params.paymentStatus,
          invoiceId: params.invoiceId,
          invoiceNo: params.invoiceNo
        },
        parallel: false
      });
    }
    
    return {
      operations,
      customerId: params.customerId
    };
  }
  
  /**
   * Handle return deletion
   * Returns all operations needed to delete a return
   */
  async handleReturnDelete(params: {
    type: 'sale' | 'salex';
    returnId: number;
    customerId: number;
    paymentStatus: number;
    fy?: number;
    totalAmount?: number;
    totalTax?: number;
    creditNoteNo?: string;
    /** The return's refund amount: the fallback for a completion with no log rows. */
    refundAmount?: number;
  }): Promise<DeleteResult> {
    const operations: DeleteOperation[] = [];
    
    // Operation 1: Get and restore stock (parallel)
    operations.push({
      type: 'STOCK_RESTORE',
      data: { 
        returnId: params.returnId,
        type: params.type
      },
      parallel: true
    });
    
    // Operation 2: Delete refund allocations if refunded
    if (params.paymentStatus === 1) {
      operations.push({
        type: 'DELETE_ALLOCATIONS',
        data: { 
          entityType: 'return',
          entityId: params.returnId,
          returnType: params.type,
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
        returnId: params.returnId,
        returnType: params.type
      },
      parallel: false
    });
    
    // Operation 4: Delete ledger entries (parallel)
    operations.push({
      type: 'LEDGER_REVERSAL',
      data: {
        entityType: params.type === 'sale' ? 'sale_return' : 'salex_return',
        entityId: params.returnId,
        customerId: params.customerId,
        isDeletion: true  // Delete entries, don't create reversals
      },
      parallel: true
    });
    
    // Operation 5: Update balance if refunded
    if (params.paymentStatus === 1) {
      operations.push({
        type: 'BALANCE_UPDATE',
        data: {
          customerId: params.customerId,
          paymentStatus: params.paymentStatus,
          returnId: params.returnId,
          returnType: params.type,
          // The note numbers the completion was logged under (create path and
          // edit path spell them differently).
          references: [
            `${params.type === 'sale' ? 'SR' : 'SXR'}-${params.returnId}`,
            `${params.type === 'sale' ? 'SR' : 'SXR'}-${String(params.returnId).padStart(3, '0')}`,
            ...(params.creditNoteNo ? [params.creditNoteNo] : [])
          ],
          returnRefundAmount: params.refundAmount ?? 0
        },
        parallel: false
      });
    }
    
    return {
      operations,
      customerId: params.customerId
    };
  }
  
  /**
   * Handle payment deletion
   * Returns all operations needed to delete a payment
   */
  async handlePaymentDelete(params: {
    paymentId: number;
    customerId: number;
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
    
    // Operation 2: Recalculate invoice statuses (can be parallel)
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
        customerId: params.customerId,
        paymentType: params.paymentType
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        customerId: params.customerId,
        paymentAmount: params.paymentAmount,
        paymentType: params.paymentType,
        paymentId: params.paymentId
      },
      parallel: false
    });
    
    return {
      operations,
      customerId: params.customerId
    };
  }
  
  /**
   * Handle refund deletion
   * Returns all operations needed to delete a refund
   */
  async handleRefundDelete(params: {
    refundId: number;
    customerId: number;
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
        customerId: params.customerId,
        refundType: params.refundType
      },
      parallel: true
    });
    
    // Operation 5: Update balance
    operations.push({
      type: 'BALANCE_UPDATE',
      data: {
        customerId: params.customerId,
        refundAmount: params.refundAmount,
        refundType: params.refundType,
        refundId: params.refundId
      },
      parallel: false
    });
    
    return {
      operations,
      customerId: params.customerId
    };
  }

  /**
   * Execute DELETE operations within a transaction
   * Optimized with parallel execution where safe
   * Uses shared context to pass data between operations
   */
  async executeDeleteInTransaction(
    tx: any,
    result: DeleteResult
  ): Promise<void> {
    // Create shared context for operations to communicate
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
  // All methods accept shared context for passing data between operations
  
  private async executeStockRestore(tx: any, data: any, context: any): Promise<void> {
    if (data.invoiceId !== undefined) {
      // Sale/Salex: restore stock for all items (INCREMENT stock - reverse of sale)
      const items = await tx[invoiceTables(data.type).items].findMany({
        where: { invoice_no: data.invoiceId },
        select: { product_id: true, qty: true }
      });
      
      // Parallel stock updates (INCREMENT to restore)
      await Promise.all(
        items.map(item => 
          item.product_id && item.qty ? 
          tx.product.update({
            where: { id: item.product_id },
            data: { stock: { increment: item.qty } }
          }) : Promise.resolve()
        )
      );
    } else if (data.returnId !== undefined) {
      // Return: restore stock for all items (DECREMENT stock - reverse of return)
      const t = invoiceTables(data.type);
      const rawReturnItems = await tx[t.returnItems].findMany({
        where: { [t.returnFk]: data.returnId },
        select: { [t.returnItemFk]: true, return_qty: true }
      });
      const returnItems = rawReturnItems.map((r: any) => ({
        invoice_item_id: r[t.returnItemFk] as number,
        return_qty: r.return_qty
      }));
      
      const invoiceItemIds = returnItems.map(item => item.invoice_item_id);
      const invoiceItems = await tx[t.items].findMany({
        where: { id: { in: invoiceItemIds } },
        select: { id: true, product_id: true }
      });
      
      const itemMap = new Map(invoiceItems.map(ii => [ii.id, ii.product_id]));
      
      // Parallel stock updates (DECREMENT to restore)
      await Promise.all(
        returnItems.map(item => {
          const productId = itemMap.get(item.invoice_item_id);
          return productId ? 
          tx.product.update({
            where: { id: productId },
            data: { stock: { decrement: item.return_qty } }
          }) : Promise.resolve();
        })
      );
    }
  }

  private async executeDeleteAllocations(tx: any, data: any, context: any): Promise<void> {
    if (data.entityType === 'sale' || data.entityType === 'salex') {
      // Payments made with this bill go with it, and total_paid comes down by
      // them; an advance it used is only deallocated (L-26, ported from the
      // vendor side - the customer side left a phantom advance).
      const { deallocated, paymentsRemoved } = await releaseAllocations(
        tx, 'customer', { [invoiceTables(data.entityType).allocFk]: data.entityId }
      );
      data.totalPaid = deallocated;
      context.totalPaid = deallocated;
      context.paymentsRemoved = paymentsRemoved;
      
    } else if (data.entityType === 'return') {
      // The column is sale_return_id or salex_return_id; `return_id` does not
      // exist, so deleting a completed customer return threw here.
      const fk = data.returnType === 'salex' ? 'salex_return_id' : 'sale_return_id';
      const allocations = await tx.customer_refund_allocations.findMany({
        where: { [fk]: data.entityId },
        select: { refund_id: true, allocated_amount: true }
      });
      const totalRefunded = allocations.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0);
      await tx.customer_refund_allocations.deleteMany({ where: { [fk]: data.entityId } });
      // Only refunds made FOR this return go with it; a direct refund keeps
      // standing and is only deallocated.
      const refundIds: number[] = Array.from(new Set(allocations.map((a: any) => a.refund_id as number)));
      for (const refundId of refundIds) {
        if ((await tx.customer_refund_allocations.count({ where: { refund_id: refundId } })) > 0) continue;
        const refund = await tx.customer_refunds.findUnique({ where: { id: refundId }, select: { refund_type: true } });
        if (refund?.refund_type === 'RETURN_SPECIFIC') await tx.customer_refunds.delete({ where: { id: refundId } });
      }
      data.totalRefunded = totalRefunded;
      context.totalRefunded = totalRefunded;
      
    } else if (data.entityType === 'payment') {
      // Store allocated invoice IDs AND amounts before deletion
      const allocations = await tx.customer_payment_allocations.findMany({
        where: { payment_id: data.entityId },
        select: { invoice_id: true, invoicex_id: true, allocated_amount: true }
      });
      const invoiceIds = allocations.map(a => a.invoice_id || a.invoicex_id).filter(Boolean);
      context.allocatedBills = allocations.map((a: any) => a.invoice_id
        ? { type: 'sale' as const, id: a.invoice_id }
        : { type: 'salex' as const, id: a.invoicex_id }).filter((b: any) => b.id);
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      data.allocatedInvoiceIds = invoiceIds;
      context.allocatedInvoiceIds = invoiceIds;
      context.totalAllocatedPayment = totalAllocated;
      
      await tx.customer_payment_allocations.deleteMany({
        where: { payment_id: data.entityId }
      });
      
    } else if (data.entityType === 'refund') {
      // Store allocated return IDs AND amounts before deletion
      // sale_return_id / salex_return_id - there is no `return_id` column here.
      const allocations = await tx.customer_refund_allocations.findMany({
        where: { refund_id: data.entityId },
        select: { sale_return_id: true, salex_return_id: true, allocated_amount: true }
      });
      const returnIds = allocations.map((a: any) => a.sale_return_id || a.salex_return_id).filter(Boolean);
      context.allocatedReturns = allocations.map((a: any) => a.sale_return_id
        ? { type: 'sale' as const, id: a.sale_return_id }
        : { type: 'salex' as const, id: a.salex_return_id }).filter((r: any) => r.id);
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      data.allocatedReturnIds = returnIds;
      context.allocatedReturnIds = returnIds;
      context.totalAllocatedRefund = totalAllocated;
      
      await tx.customer_refund_allocations.deleteMany({
        where: { refund_id: data.entityId }
      });
    }
  }

  private async executeDeleteRecord(tx: any, data: any, context: any): Promise<void> {
    if (data.type === 'sale' || data.type === 'salex') {
      const t = invoiceTables(data.type);
      // Lines are keyed by the header id (invoice_no = invoice.id).
      const invoiceItems = await tx[t.items].findMany({
        where: { invoice_no: data.invoiceId },
        select: { id: true }
      });
      
      const itemIds = invoiceItems.map(item => item.id);
      
      if (itemIds.length > 0) {
        // Returns are refused at the route (sales/salex DELETE), so this only
        // runs if one slipped in between that check and here.
        const returnItems = await tx[t.returnItems].findMany({
          where: { [t.returnItemFk]: { in: itemIds } },
          select: { [t.returnFk]: true },
          distinct: [t.returnFk]
        });
        
        const returnIds = returnItems.map((r: any) => r[t.returnFk]).filter(Boolean);
        
        if (returnIds.length > 0) {
          // DELETE CREDIT_NOTE ledger entries directly (no reversal needed)
          await tx.customer_ledger.deleteMany({
            where: {
              reference_type: data.type === 'sale' ? 'sale_return' : 'salex_return',
              reference_id: { in: returnIds },
              transaction_type: 'CREDIT_NOTE'
            }
          });
          
          await tx[t.returnItems].deleteMany({
            where: { [t.returnItemFk]: { in: itemIds } }
          });
          
          await tx[t.returns].deleteMany({
            where: { id: { in: returnIds } }
          });
        }
      }
      
      await tx[t.items].deleteMany({ where: { invoice_no: data.invoiceId } });
      // The billing / shipping / transport snapshots, as the "Other"-customer
      // path in the routes already deletes them. They were left orphaned here.
      await tx[t.billTo].deleteMany({ where: { invoice_no: data.invoiceId } });
      await tx[t.shipTo].deleteMany({ where: { invoice_no: data.invoiceId } });
      await tx[t.transport].deleteMany({ where: { invoice_id: data.invoiceId } });
      if (data.type === 'salex') {
        await tx.incexpx.deleteMany({ where: { invoice_id: data.invoiceId } });
      }
      
      await tx[t.header].delete({ where: { id: data.invoiceId } });
      
    } else if (data.type === 'return') {
      const t = invoiceTables(data.returnType);
      await tx[t.returnItems].deleteMany({ where: { [t.returnFk]: data.returnId } });
      await tx[t.returns].delete({ where: { id: data.returnId } });
      
    } else if (data.type === 'payment') {
      await tx.customer_payments.delete({ where: { id: data.paymentId } });
      
    } else if (data.type === 'refund') {
      await tx.customer_refunds.delete({ where: { id: data.refundId } });
    }
  }
  
  private async executeRecalculateStatus(tx: any, data: any, context: any): Promise<void> {
    if (data.entityType === 'payment') {
      // Use invoice IDs from shared context (already captured before deletion)
      // Each with its own table: sale and salex ids overlap.
      const bills: Array<{ type: 'sale' | 'salex'; id: number }> = context.allocatedBills || [];
      for (const b of bills) await recalculateSaleStatus(b.type, b.id, tx);
      
    } else if (data.entityType === 'refund') {
      // Use return IDs from shared context (already captured before deletion)
      const returns: Array<{ type: 'sale' | 'salex'; id: number }> = context.allocatedReturns || [];
      for (const r of returns) await recalculateSaleReturnRefundStatus(r.type, r.id, tx);
    }
  }

  private async executeLedgerReversal(tx: any, data: any, context: any): Promise<void> {
    let ledgerEntries = [];
    
    // SIMPLIFIED: All payment/refund types now have transaction_id, so just query by it!
    if (data.entityType === 'payment') {
      console.log(`[LEDGER REVERSAL] Deleting PAYMENT_RECEIVED ledger entries for payment_id=${data.entityId}`);
      
      ledgerEntries = await tx.customer_ledger.findMany({
        where: {
          transaction_id: data.entityId,
          transaction_type: 'PAYMENT_RECEIVED'
        }
      });
      
      console.log(`[LEDGER REVERSAL] Found ${ledgerEntries.length} PAYMENT_RECEIVED ledger entries`);
      
    } else if (data.entityType === 'refund') {
      console.log(`[LEDGER REVERSAL] Deleting REFUND ledger entries for refund_id=${data.entityId}`);
      
      // The refund screen writes REFUND_PAID (reference_type 'refund'); this
      // looked for REFUND by transaction_id, which is what a COMPLETED RETURN
      // writes with the return's id - so it left the refund's own row and
      // deleted a return's row whenever the two ids matched.
      ledgerEntries = await tx.customer_ledger.findMany({
        where: {
          transaction_id: data.entityId,
          reference_type: 'refund',
          transaction_type: { in: ['REFUND_PAID', 'REFUND'] }
        }
      });
      
      console.log(`[LEDGER REVERSAL] Found ${ledgerEntries.length} REFUND ledger entries`);
      
    } else {
      // Standard handling for sale/salex/return
      ledgerEntries = await tx.customer_ledger.findMany({
        where: {
          reference_type: data.entityType,
          reference_id: data.entityId
        }
      });
    }
    
    // For ALL deletions (sale/salex/return/payment/refund), delete entries instead of creating reversals
    // Philosophy: "Delete is the reverse of Create" - we remove what was added
    const shouldDelete = 
      data.entityType === 'payment' || 
      data.entityType === 'refund' ||
      (data.isDeletion && (data.entityType === 'sale' || data.entityType === 'salex' || 
                           data.entityType === 'sale_return' || data.entityType === 'salex_return'));
    
    if (shouldDelete) {
      // Delete ledger entries (as if the transaction never happened)
      await Promise.all(
        ledgerEntries.map(entry => 
          tx.customer_ledger.delete({ where: { id: entry.id } })
        )
      );
      
      // Recalculate balances for all subsequent entries
      if (ledgerEntries.length > 0) {
        const customerId = ledgerEntries[0].customer_id;
        await customerLedgerService.recalculateBalancesAfter(customerId, 0, tx);
      }
    } else {
      // EXISTING LOGIC: For status change edits, create reversal entries
      // This preserves audit trail for status changes
      // One after another (2026-10-03): each reversal's stored running balance
      // starts from the latest row; written together they all read the same one.
      for (const entry of ledgerEntries) {
        await customerLedgerService.createEntry({
            customer_id: entry.customer_id,
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
          }, tx);
      }
    }
  }
  
  private async executeBalanceUpdate(tx: any, data: any, context: any): Promise<void> {
    if (data.paymentAmount !== undefined) {
      // Payment deletion - use ACTUAL allocated amount from context, not paymentAmount
      const actualAllocated = context.totalAllocatedPayment !== undefined 
        ? context.totalAllocatedPayment 
        : (data.paymentType === 'DIRECT' ? 0 : data.paymentAmount);
      
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx, 
        data.customerId, 
        {
          total_paid: -Number(data.paymentAmount),
          total_allocated: -actualAllocated
        },
        {
          type: 'payment_received_delete',
          id: data.paymentId || 0,
          reference_no: `PAY-${data.paymentId || '?'}`,
          notes: `Payment deleted: ₹${data.paymentAmount}`
        }
      );
      
    } else if (data.refundAmount !== undefined) {
      // Refund deletion - use ACTUAL allocated amount from context, not refundAmount
      const actualAllocated = context.totalAllocatedRefund !== undefined 
        ? context.totalAllocatedRefund 
        : (data.refundType === 'DIRECT' ? 0 : data.refundAmount);
      
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx, 
        data.customerId, 
        {
          total_refunded: -Number(data.refundAmount),
          total_refund_allocated: -actualAllocated
        },
        {
          type: 'refund_issued_delete',
          id: data.refundId || 0,
          reference_no: `REF-${data.refundId || '?'}`,
          notes: `Refund deleted: ₹${data.refundAmount}`
        }
      );
      
    } else if (context.totalPaid !== undefined) {
      // Sale deletion - use context.totalPaid shared from DELETE_ALLOCATIONS
      const paymentsRemoved = Number(context.paymentsRemoved || 0);
      // Nothing was allocated (an unpaid bill): nothing to move.
      if (!Number(context.totalPaid) && !paymentsRemoved) return;
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx, 
        data.customerId, 
        {
          total_allocated: -context.totalPaid,
          ...(paymentsRemoved > 0 ? { total_paid: -paymentsRemoved } : {})
        },
        {
          type: 'sale_delete',
          id: data.invoiceId || 0,
          reference_no: `INV-${data.invoiceNo || '?'}`,
          notes: paymentsRemoved > 0
            ? `Sale deleted: deallocated ₹${context.totalPaid}, removed ₹${paymentsRemoved} of payments made with it`
            : `Sale deleted: deallocated ₹${context.totalPaid} (advance payments left intact)`
        }
      );
      
    } else if (data.returnId !== undefined) {
      // Return deletion: take back what completing it added, plus any refund
      // allocated to it from the refund screen.
      const done = await returnCounterAmounts(tx, 'customer', data.customerId, data.references || [], Number(data.returnRefundAmount) || 0);
      const deallocated = Number(context.totalRefunded || 0);
      const update: any = {};
      if (done.refunded) update.total_refunded = -done.refunded;
      if (done.allocated + deallocated) update.total_refund_allocated = -(done.allocated + deallocated);
      if (Object.keys(update).length) {
        await customerBalanceHandler.incrementBalanceInTransaction(tx, data.customerId, update, {
          type: 'return_delete',
          id: data.returnId || 0,
          reference_no: (data.references || [])[1] || `CN-${data.returnId}`,
          notes: `Return deleted: refund counters reversed`
        });
      }
    }
  }
}

// Export singleton instance
export const customerTransactionHandler = new CustomerTransactionHandler();
