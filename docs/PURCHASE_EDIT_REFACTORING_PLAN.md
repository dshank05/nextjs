# Purchase Edit Refactoring Plan

**Created:** February 13, 2026  
**Purpose:** Refactor purchase edit to use direct UPDATE/DELETE instead of ADJUSTMENT/REVERSAL entries

---

## [Overview]

Refactor purchase edit handler to use direct database UPDATE/DELETE operations while preserving all 9 status transition case logic.

This refactoring transitions from creating ADJUSTMENT/REVERSAL ledger entries to directly updating or deleting existing entries. All existing business logic is preserved including smart advance allocation, payment status calculations, and balance updates. The handler will continue to support all 9 status transition cases but will execute them through direct database operations rather than append-only ledger entries.

Key principles:
- Preserve ALL existing business logic
- Maintain 9 status transition cases (0→1, 1→0, 2→1, 2→0, 1→2, 0→0, 1→1, 2→2, 1→1 Type B)
- Keep handler pattern (ledger-handler → transaction-handler → API)
- Use existing utilities (ledger-service, balance-handler, payment-allocation-service)
- No new files - only modifications to existing handlers

---

## [Types]

Add new operation types to support UPDATE and DELETE alongside CREATE.

### **LedgerUpdateOperation** (New)
```typescript
interface LedgerUpdateOperation {
  description: string;
  where: {
    reference_type?: 'purchase' | 'purchase_return';
    reference_id?: number;
    transaction_type: 'PURCHASE' | 'PAYMENT' | 'DEBIT_NOTE';
    transaction_id?: number;  // For PAYMENT operations
  };
  data: {
    debit?: number;
    credit?: number;
    notes?: string;
  };
}
```

### **LedgerDeleteOperation** (New)
```typescript
interface LedgerDeleteOperation {
  description: string;
  where: {
    reference_type?: 'purchase' | 'purchase_return';
    reference_id?: number;
    transaction_type: 'PURCHASE' | 'PAYMENT' | 'DEBIT_NOTE';
    transaction_id?: number;  // For PAYMENT operations
  };
}
```

### **TransactionResult** (Modified)
```typescript
interface TransactionResult {
  ledgerCreates: LedgerOperation[];           // New entries (unchanged)
  ledgerUpdates: LedgerUpdateOperation[];     // NEW: Entries to update
  ledgerDeletes: LedgerDeleteOperation[];     // NEW: Entries to delete
  balanceOp: BalanceOperation | null;         // Unchanged
  allocationChanges: AllocationChange[];      // Unchanged
}
```

---

## [Files]

Modify 3 existing files - no new files needed.

### **Modified Files:**

1. **lib/ledger-handler.ts**
   - Modify `getPurchaseLedgerOps()` method
   - Remove PURCHASE_ADJUSTMENT generation
   - Remove PAYMENT_REVERSAL generation  
   - Add logic to return UPDATE operations for amount changes
   - Add logic to return DELETE operations for status Paid→Unpaid
   - Preserve all 9 case switch logic
   - Keep smart advance allocation logic

2. **lib/transaction-handler.ts**
   - Modify `TransactionResult` interface (add ledgerUpdates, ledgerDeletes)
   - Modify `executeInTransaction()` method
   - Add `executeLedgerUpdates()` private method
   - Add `executeLedgerDeletes()` private method
   - Keep all existing methods unchanged

3. **pages/api/purchases/[id].ts**
   - No changes to PUT handler logic
   - Handler already calls transaction-handler correctly
   - All operations remain transactional

---

## [Functions]

Detailed modifications to preserve all case logic.

### **lib/ledger-handler.ts**

**Modified: getPurchaseLedgerOps()**

Current: Returns only CREATE operations (ADJUSTMENT/REVERSAL)
New: Returns mixed CREATE/UPDATE/DELETE operations

```typescript
getPurchaseLedgerOps(changes: ChangeSet): {
  creates: LedgerOperation[];
  updates: LedgerUpdateOperation[];
  deletes: LedgerDeleteOperation[];
} {
  const creates: LedgerOperation[] = [];
  const updates: LedgerUpdateOperation[] = [];
  const deletes: LedgerDeleteOperation[] = [];
  
  const statusChange = `${changes.oldStatus}→${changes.newStatus}`;
  
  // PRESERVE ALL 9 CASES
  switch (statusChange) {
    case '1→0': // Paid → Unpaid
      // DELETE PAYMENT entries (was PAYMENT_REVERSAL)
      deletes.push({
        description: 'Delete payment (unmarking)',
        where: {
          reference_type: 'purchase',
          reference_id: changes.purchaseId,
          transaction_type: 'PAYMENT'
        }
      });
      
      // If amount changed, UPDATE PURCHASE
      if (changes.amountChanged) {
        updates.push({
          description: 'Update purchase amount',
          where: {
            reference_type: 'purchase',
            reference_id: changes.purchaseId,
            transaction_type: 'PURCHASE'
          },
          data: {
            debit: changes.newTotal
          }
        });
      }
      break;
      
    case '0→1': // Unpaid → Paid
      // If amount changed, UPDATE PURCHASE first
      if (changes.amountChanged) {
        updates.push({
          description: 'Update purchase amount',
          where: {
            reference_type: 'purchase',
            reference_id: changes.purchaseId,
            transaction_type: 'PURCHASE'
          },
          data: {
            debit: changes.newTotal
          }
        });
      }
      
      // CREATE PAYMENT (with advance logic)
      const breakdown = this.calculateAdvanceBreakdown(
        changes.newTotal,
        changes.currentBalance
      );
      
      if (breakdown.newPayment > 0) {
        creates.push({
          description: 'Create payment',
          entry: {
            vendor_id: changes.vendorId,
            transaction_date: changes.paymentDate,
            transaction_type: 'PAYMENT',
            reference_type: 'purchase',
            reference_id: changes.purchaseId,
            reference_no: changes.invoiceNo,
            debit: 0,
            credit: breakdown.newPayment,
            payment_mode: changes.paymentMode,
            payment_status: 1,
            payment_date: changes.paymentDate,
            notes: this.generatePaymentNotes(
              changes.invoiceNo,
              changes.newTotal,
              changes.currentBalance
            ),
            fy: changes.fy
          }
        });
      }
      break;
      
    // ... Continue for all 9 cases
  }
  
  return { creates, updates, deletes };
}
```

**Key Principle:** Each case preserved exactly, just using UPDATE/DELETE instead of ADJUSTMENT/REVERSAL

---

### **lib/transaction-handler.ts**

**New: executeLedgerUpdates()**
```typescript
private async executeLedgerUpdates(
  tx: any,
  updates: LedgerUpdateOperation[]
): Promise<void> {
  for (const update of updates) {
    // Execute UPDATE
    await tx.vendor_ledger.updateMany({
      where: update.where,
      data: update.data
    });
    
    // Recalculate balances after update
    const entries = await tx.vendor_ledger.findMany({
      where: update.where,
      select: { id: true, vendor_id: true }
    });
    
    if (entries.length > 0) {
      await ledgerService.recalculateBalancesAfter(
        entries[0].vendor_id,
        entries[0].id,
        tx
      );
    }
  }
}
```

**New: executeLedgerDeletes()**
```typescript
private async executeLedgerDeletes(
  tx: any,
  deletes: LedgerDeleteOperation[]
): Promise<void> {
  for (const deleteOp of deletes) {
    // Get entry info before deletion
    const entries = await tx.vendor_ledger.findMany({
      where: deleteOp.where,
      select: { id: true, vendor_id: true }
    });
    
    // Delete entries
    await tx.vendor_ledger.deleteMany({
      where: deleteOp.where
    });
    
    // Recalculate balances after deletion
    if (entries.length > 0) {
      await ledgerService.recalculateBalancesAfter(
        entries[0].vendor_id,
        0,  // Recalculate from beginning
        tx
      );
    }
  }
}
```

**Modified: executeInTransaction()**
```typescript
async executeInTransaction(
  tx: any,
  result: TransactionResult
): Promise<void> {
  // 1. Execute allocation changes (CREATE payments first)
  for (const change of result.allocationChanges) {
    await this.executeAllocationChange(tx, change);
  }
  
  // 2. Execute ledger CREATES
  for (const op of result.ledgerCreates) {
    await ledgerService.createEntry(op.entry, tx);
  }
  
  // 3. Execute ledger UPDATES (NEW)
  await this.executeLedgerUpdates(tx, result.ledgerUpdates);
  
  // 4. Execute ledger DELETES (NEW)
  await this.executeLedgerDeletes(tx, result.ledgerDeletes);
  
  // 5. Execute balance update
  if (result.balanceOp) {
    await balanceHandler.incrementBalanceInTransaction(
      tx,
      result.balanceOp.vendorId,
      result.balanceOp.update
    );
  }
}
```

---

## [Classes]

Modify existing classes - no new classes.

### **Modified: LedgerHandler**
- **getPurchaseLedgerOps()**: Return mixed operations instead of only CREATE
- **calculateAdvanceBreakdown()**: Keep unchanged (already works)
- **generatePaymentNotes()**: Keep unchanged (already works)
- All 9 status cases preserved in switch statement

### **Modified: TransactionHandler**
- **executeInTransaction()**: Add UPDATE/DELETE execution steps
- **executeLedgerUpdates()**: New private method
- **executeLedgerDeletes()**: New private method
- All other methods unchanged

---

## [Dependencies]

No new dependencies required - using existing Prisma operations.

Existing:
- Prisma ORM - Already supports updateMany() and deleteMany()
- TypeScript - For new interfaces
- All existing utilities unchanged

---

## [Testing]

Comprehensive test coverage for all 9 status transition cases.

### **Test Scenarios:**

**Status Transitions:**
1. **0→1 (Unpaid → Paid)**
   - With advance balance
   - Without advance balance
   - With partial advance
   - With amount change

2. **1→0 (Paid → Unpaid)**
   - Type A (has allocations)
   - Type B (marked paid on create)
   - With amount change

3. **2→1 (Partial → Paid)**
   - With advance for remaining
   - Without advance

4. **2→0 (Partial → Unpaid)**
   - Verify all allocations deleted

5. **1→2 (Paid → Partial)**
   - Amount increased

6. **0→0 (Unpaid → Unpaid)**
   - Amount change only

7. **1→1 (Paid → Paid)**
   - Type A: Amount change with allocations
   - Type B: Amount change without allocations

8. **2→2 (Partial → Partial)**
   - Amount change

**Verification for Each:**
- Ledger entries correct (UPDATE/DELETE executed)
- Balances recalculated properly
- Payment allocations synced
- Vendor balance updated
- All 4 systems consistent

---

## [Implementation Order]

Execute in strict sequence to avoid breaking existing functionality.

### **Step 1: Update Type Definitions**
- Add LedgerUpdateOperation interface to lib/ledger-handler.ts
- Add LedgerDeleteOperation interface to lib/ledger-handler.ts
- Modify TransactionResult interface in lib/transaction-handler.ts

### **Step 2: Modify Transaction Handler Execution**
- Add executeLedgerUpdates() method
- Add executeLedgerDeletes() method
- Modify executeInTransaction() to call new methods
- Test with empty arrays (no breaking changes)

### **Step 3: Refactor Status Case 1→0 (Simplest)**
- Modify case in getPurchaseLedgerOps()
- Return DELETE operation instead of REVERSAL
- Test thoroughly

### **Step 4: Refactor Status Case 0→1**
- Modify case in getPurchaseLedgerOps()
- Return UPDATE + CREATE operations
- Preserve advance allocation logic
- Test thoroughly

### **Step 5: Refactor Remaining Cases**
- Modify each case one by one: 2→1, 2→0, 1→2, 0→0, 1→1, 2→2
- Test each case before moving to next

### **Step 6: Remove Old Code**
- Remove ADJUSTMENT creation logic (now unused)
- Remove REVERSAL creation logic (now unused)
- Clean up comments

### **Step 7: Integration Testing**
- Test all 9 cases end-to-end
- Verify ledger display correct
- Verify balance calculations correct
- Performance testing

---

**END OF PLAN**
