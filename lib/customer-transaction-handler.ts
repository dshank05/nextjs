/**
 * Customer Transaction Handler Service
 * Orchestrates all operations for sale/salex and return transactions
 * Coordinates ledger, balance, and allocation operations
 */

import { customerLedgerHandler, LedgerOperation, LedgerUpdateOperation, LedgerDeleteOperation, ChangeSet } from './customer-ledger-handler';
import { customerBalanceHandler, BalanceOperation } from './customer-balance-handler';
import { customerLedgerService } from './customer-ledger-service';

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
      invoiceNo: params.invoiceNo,
      paymentMode: params.paymentMode,
      paymentDate: params.paymentDate,
      fy: params.fy,
      totalAllocated: params.totalAllocated,
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
          debit: params.newAmount,
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
        where: {
          transaction_id: params.refundId,
          transaction_type: 'REFUND'
        },
        data: {
          credit: params.newAmount,
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
      if (change.action === 'CREATE') {
        if (change.type === 'PAYMENT') {
          // Create payment record
          const payment = await tx.customer_payments.create({
            data: {
              customer_id: change.data.customerId,
              payment_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
              payment_amount: change.data.amount,
              payment_mode: change.data.paymentMode || 1,
              payment_type: change.data.paymentType || 'BILL_SPECIFIC',
              notes: change.data.notes || `Payment for ${change.data.type} ${change.data.invoiceNo}`,
              fy: change.data.fy
            }
          });
          
          // Store payment ID for this invoice
          paymentMap.set(change.data.invoiceId, payment.id);
          
          // Create allocation record
          await tx.customer_payment_allocations.create({
            data: {
              payment_id: payment.id,
              invoice_id: change.data.type === 'sale' ? change.data.invoiceId : undefined,
              invoicex_id: change.data.type === 'salex' ? change.data.invoiceId : undefined,
              allocated_amount: change.data.amount,
              allocation_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
              notes: 'Allocated during sale edit'
            }
          });
        } else if (change.type === 'REFUND') {
          // Create refund record
          const refund = await tx.customer_refunds.create({
            data: {
              customer_id: change.data.customerId,
              refund_date: change.data.refundDate || Math.floor(Date.now() / 1000),
              refund_amount: change.data.amount,
              refund_mode: change.data.refundMode || 1,
              refund_type: 'RETURN_SPECIFIC',
              notes: `Refund for return ${change.data.creditNoteNo}`,
              fy: change.data.fy
            }
          });
          
          // Store refund ID for this return
          refundMap.set(change.data.returnId, refund.id);
          
          // Create allocation record
          await tx.customer_refund_allocations.create({
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
        // Handle deletions
        await this.executeAllocationChange(tx, change);
      }
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
            updatedNotes = `Payment ₹${entryToCreate.debit} for bill ${entryToCreate.reference_no} via Payment #${transactionId}`;
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
          sourceType = 'payment_received_edit';
          sourceId = firstOp.entry.transaction_id;
          referenceNo = `PAY-${firstOp.entry.transaction_id}`;
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
    
    // Determine payment type based on allocation mix
    const paymentType = (advanceUsed > 0 && newPayment > 0) ? 'MIXED' : 'BILL_SPECIFIC';
    
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
          paymentMode: changes.paymentMode,
          paymentDate: changes.paymentDate,
          paymentType: paymentType,
          fy: changes.fy,
          invoiceNo: changes.invoiceNo,
          type: changes.invoiceId ? 'sale' : 'salex',
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
          paymentType: paymentType,
          fy: changes.fy,
          invoiceNo: changes.invoiceNo,
          type: changes.invoiceId ? 'sale' : 'salex'
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
            invoiceId: changes.invoiceId
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
   * Execute a single allocation change
   */
  private async executeAllocationChange(
    tx: any,
    change: AllocationChange
  ): Promise<void> {
    if (change.action === 'CREATE') {
      if (change.type === 'PAYMENT') {
        // Create payment record
        const payment = await tx.customer_payments.create({
          data: {
            customer_id: change.data.customerId,
            payment_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
            payment_amount: change.data.amount,
            payment_mode: change.data.paymentMode || 1,
            payment_type: change.data.paymentType || 'BILL_SPECIFIC',
            notes: change.data.notes || `Payment for ${change.data.type} ${change.data.invoiceNo}`,
            fy: change.data.fy
          }
        });
        
        // Create allocation record
        await tx.customer_payment_allocations.create({
          data: {
            payment_id: payment.id,
            invoice_id: change.data.type === 'sale' ? change.data.invoiceId : undefined,
            invoicex_id: change.data.type === 'salex' ? change.data.invoiceId : undefined,
            allocated_amount: change.data.amount,
            allocation_date: change.data.paymentDate || Math.floor(Date.now() / 1000),
            notes: 'Allocated during sale edit'
          }
        });
      } else if (change.type === 'REFUND') {
        // Create refund record
        const refund = await tx.customer_refunds.create({
          data: {
            customer_id: change.data.customerId,
            refund_date: change.data.refundDate || Math.floor(Date.now() / 1000),
            refund_amount: change.data.amount,
            refund_mode: change.data.refundMode || 1,
            refund_type: 'RETURN_SPECIFIC',
            notes: `Refund for return ${change.data.creditNoteNo}`,
            fy: change.data.fy
          }
        });
        
        // Create allocation record
        await tx.customer_refund_allocations.create({
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
        const allocations = await tx.customer_payment_allocations.findMany({
          where: { 
            invoice_id: change.where.invoiceId,
            invoicex_id: change.where.invoiceId
          },
          select: { payment_id: true }
        });
        
        // Delete allocations
        await tx.customer_payment_allocations.deleteMany({
          where: { 
            invoice_id: change.where.invoiceId,
            invoicex_id: change.where.invoiceId
          }
        });
        
        // Delete customer_payments if no other allocations exist
        for (const alloc of allocations) {
          const remainingAllocs = await tx.customer_payment_allocations.count({
            where: { payment_id: alloc.payment_id }
          });
          
          if (remainingAllocs === 0) {
            await tx.customer_payments.delete({
              where: { id: alloc.payment_id }
            });
          }
        }
      } else if (change.type === 'REFUND') {
        // Get allocations to delete
        const allocations = await tx.customer_refund_allocations.findMany({
          where: { return_id: change.where.returnId },
          select: { refund_id: true }
        });
        
        // Delete allocations
        await tx.customer_refund_allocations.deleteMany({
          where: { return_id: change.where.returnId }
        });
        
        // Delete customer_refunds if no other allocations exist
        for (const alloc of allocations) {
          const remainingAllocs = await tx.customer_refund_allocations.count({
            where: { refund_id: alloc.refund_id }
          });
          
          if (remainingAllocs === 0) {
            await tx.customer_refunds.delete({
              where: { id: alloc.refund_id }
            });
          }
        }
      }
    }
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
        invoiceNo: params.invoiceNo,
        type: params.type
      },
      parallel: true
    });
    
    // Operation 2: Delete allocations if paid
    if (params.paymentStatus === 1 || params.paymentStatus === 2) {
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
    if (params.paymentStatus === 1 || params.paymentStatus === 2) {
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
          returnId: params.returnId
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
    if (data.invoiceNo !== undefined) {
      // Sale/Salex: restore stock for all items (INCREMENT stock - reverse of sale)
      const itemTable = data.type === 'sale' ? 'invoiceitems' : 'invoicexitems';
      const items = await tx[itemTable].findMany({
        where: { invoice_no: data.invoiceNo },
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
      const returnTable = data.type === 'sale' ? 'sale_return_items' : 'salex_return_items';
      const returnItems = await tx[returnTable].findMany({
        where: { 
          sale_return_id: data.type === 'sale' ? data.returnId : undefined,
          salex_return_id: data.type === 'salex' ? data.returnId : undefined
        },
        select: { invoice_item_id: true, return_qty: true }
      });
      
      const itemTable = data.type === 'sale' ? 'invoiceitems' : 'invoicexitems';
      const invoiceItemIds = returnItems.map(item => item.invoice_item_id);
      const invoiceItems = await tx[itemTable].findMany({
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
      const allocations = await tx.customer_payment_allocations.findMany({
        where: { 
          invoice_id: data.entityType === 'sale' ? data.entityId : undefined,
          invoicex_id: data.entityType === 'salex' ? data.entityId : undefined
        },
        select: { payment_id: true, allocated_amount: true }
      });
      
      const totalPaid = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Delete allocations
      await tx.customer_payment_allocations.deleteMany({
        where: { 
          invoice_id: data.entityType === 'sale' ? data.entityId : undefined,
          invoicex_id: data.entityType === 'salex' ? data.entityId : undefined
        }
      });
      
      const paymentIds = Array.from(new Set(allocations.map(a => a.payment_id)));
      for (const paymentId of paymentIds) {
        const remainingAllocs = await tx.customer_payment_allocations.count({
          where: { payment_id: paymentId }
        });
        
        if (remainingAllocs === 0) {
          const payment = await tx.customer_payments.findUnique({
            where: { id: paymentId },
            select: { payment_type: true, payment_amount: true }
          });
          
          if (payment?.payment_type === 'BILL_SPECIFIC') {
            await tx.customer_payments.delete({ where: { id: paymentId } });
          } else if (payment?.payment_type === 'MIXED') {
            await tx.customer_payments.update({
              where: { id: paymentId },
              data: { payment_type: 'DIRECT' }
            });
          }
        }
      }
      
      data.totalPaid = totalPaid;
      context.totalPaid = totalPaid;
      
    } else if (data.entityType === 'return') {
      const allocations = await tx.customer_refund_allocations.findMany({
        where: { return_id: data.entityId },
        select: { refund_id: true, allocated_amount: true }
      });
      
      const totalRefunded = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      // Delete allocations
      await tx.customer_refund_allocations.deleteMany({
        where: { return_id: data.entityId }
      });
      
      // Delete customer_refunds records (they were auto-created with return)
      const refundIds = Array.from(new Set(allocations.map(a => a.refund_id)));
      for (const refundId of refundIds) {
        const remainingAllocs = await tx.customer_refund_allocations.count({
          where: { refund_id: refundId }
        });
        
        if (remainingAllocs === 0) {
          await tx.customer_refunds.delete({ where: { id: refundId } });
        }
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
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
      
      data.allocatedInvoiceIds = invoiceIds;
      context.allocatedInvoiceIds = invoiceIds;
      context.totalAllocatedPayment = totalAllocated;
      
      await tx.customer_payment_allocations.deleteMany({
        where: { payment_id: data.entityId }
      });
      
    } else if (data.entityType === 'refund') {
      // Store allocated return IDs AND amounts before deletion
      const allocations = await tx.customer_refund_allocations.findMany({
        where: { refund_id: data.entityId },
        select: { return_id: true, allocated_amount: true }
      });
      const returnIds = allocations.map(a => a.return_id);
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
      // Delete related returns FIRST to avoid FK constraint violations
      const itemTable = data.type === 'sale' ? 'invoiceitems' : 'invoicexitems';
      const invoiceItems = await tx[itemTable].findMany({
        where: { invoice_no: data.invoiceNo },
        select: { id: true }
      });
      
      const itemIds = invoiceItems.map(item => item.id);
      
      if (itemIds.length > 0) {
        // Get return IDs that reference these invoice items
        const returnTable = data.type === 'sale' ? 'sale_return_items' : 'salex_return_items';
        const returnItems = await tx[returnTable].findMany({
          where: { invoice_item_id: { in: itemIds } },
          select: { 
            sale_return_id: data.type === 'sale' ? true : undefined,
            salex_return_id: data.type === 'salex' ? true : undefined
          },
          distinct: data.type === 'sale' ? ['sale_return_id'] : ['salex_return_id']
        });
        
        const returnIds = returnItems.map(r => 
          data.type === 'sale' ? r.sale_return_id : r.salex_return_id
        ).filter(Boolean);
        
        if (returnIds.length > 0) {
          // DELETE CREDIT_NOTE ledger entries directly (no reversal needed)
          await tx.customer_ledger.deleteMany({
            where: {
              reference_type: data.type === 'sale' ? 'sale_return' : 'salex_return',
              reference_id: { in: returnIds },
              transaction_type: 'CREDIT_NOTE'
            }
          });
          
          // Delete return items first (child records)
          await tx[returnTable].deleteMany({
            where: { invoice_item_id: { in: itemIds } }
          });
          
          // Delete return records (parent records)
          const returnMainTable = data.type === 'sale' ? 'sale_returns' : 'salex_returns';
          await tx[returnMainTable].deleteMany({
            where: { id: { in: returnIds } }
          });
        }
      }
      
      // NOW safe to delete invoice items (no more FK references)
      await tx[itemTable].deleteMany({ where: { invoice_no: data.invoiceNo } });
      
      // Delete main invoice record
      const invoiceTable = data.type === 'sale' ? 'invoice' : 'invoicex';
      await tx[invoiceTable].delete({ where: { id: data.invoiceId } });
      
    } else if (data.type === 'return') {
      const returnTable = data.returnType === 'sale' ? 'sale_return_items' : 'salex_return_items';
      await tx[returnTable].deleteMany({ 
        where: { 
          sale_return_id: data.returnType === 'sale' ? data.returnId : undefined,
          salex_return_id: data.returnType === 'salex' ? data.returnId : undefined
        } 
      });
      
      const returnMainTable = data.returnType === 'sale' ? 'sale_returns' : 'salex_returns';
      await tx[returnMainTable].delete({ where: { id: data.returnId } });
      
    } else if (data.type === 'payment') {
      await tx.customer_payments.delete({ where: { id: data.paymentId } });
      
    } else if (data.type === 'refund') {
      await tx.customer_refunds.delete({ where: { id: data.refundId } });
    }
  }
  
  private async executeRecalculateStatus(tx: any, data: any, context: any): Promise<void> {
    if (data.entityType === 'payment') {
      // Use invoice IDs from shared context (already captured before deletion)
      const invoiceIds = context.allocatedInvoiceIds || [];
      
      // Recalculate in parallel
      await Promise.all(
        invoiceIds.map(invoiceId => 
          require('./payment-allocation-service').recalculateInvoiceStatus(invoiceId, tx)
        )
      );
      
    } else if (data.entityType === 'refund') {
      // Use return IDs from shared context (already captured before deletion)
      const returnIds = context.allocatedReturnIds || [];
      
      // Recalculate in parallel
      await Promise.all(
        returnIds.map(returnId => 
          require('./payment-allocation-service').recalculateSaleReturnStatus(returnId, tx)
        )
      );
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
      
      ledgerEntries = await tx.customer_ledger.findMany({
        where: {
          transaction_id: data.entityId,
          transaction_type: 'REFUND'
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
      await Promise.all(
        ledgerEntries.map(entry => 
          customerLedgerService.createEntry({
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
          }, tx)
        )
      );
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
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx, 
        data.customerId, 
        {
          total_allocated: -context.totalPaid
        },
        {
          type: 'sale_delete',
          id: data.invoiceId || 0,
          reference_no: `INV-${data.invoiceNo || '?'}`,
          notes: `Sale deleted: deallocated ₹${context.totalPaid}`
        }
      );
      
    } else if (context.totalRefunded !== undefined) {
      // Return deletion - use context.totalRefunded shared from DELETE_ALLOCATIONS
      await customerBalanceHandler.incrementBalanceInTransaction(
        tx, 
        data.customerId, 
        {
          total_refund_allocated: -context.totalRefunded
        },
        {
          type: 'return_delete',
          id: data.returnId || 0,
          reference_no: `CN-${data.returnId || '?'}`,
          notes: `Return deleted: deallocated ₹${context.totalRefunded}`
        }
      );
    }
  }
}

// Export singleton instance
export const customerTransactionHandler = new CustomerTransactionHandler();
