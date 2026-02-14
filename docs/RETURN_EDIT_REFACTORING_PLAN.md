# Return Edit Refactoring Implementation Plan

## [Overview]

Refactor return edit operations to use direct UPDATE/DELETE operations instead of REFUND_REVERSAL and adjustment entries, mirroring the purchase edit refactoring pattern.

This refactoring addresses the same issues as purchase edit:
- Eliminates REFUND_REVERSAL entries that clutter the ledger
- Moves from `updateDebitNoteEntry()` to direct UPDATE operations
- DELETE REFUND_REVERSAL entries instead of creating new ones
- Provides cleaner ledger with direct operations reflecting actual state

The return edit system currently:
1. Uses CREATE for REFUND_REVERSAL when unmarking complete status
2. Uses `ledgerService.updateDebitNoteEntry()` for amount changes
3. Manually deletes REFUND_REVERSAL entries in transaction-handler

After refactoring:
1. DELETE REFUND_REVERSAL entries directly (no CREATE)
2. UPDATE DEBIT_NOTE entries for amount changes (no separate method)
3. Cleaner transaction-handler without manual deletion logic

## [Types]

Update return ledger operation types to support mixed operations.

**Current:**
```typescript
getReturnLedgerOps(changes: ChangeSet): LedgerOperation[]
```

**New:**
```typescript
getReturnLedgerOps(changes: ChangeSet): {
  creates: LedgerOperation[];
  updates: LedgerUpdateOperation[];
  deletes: LedgerDeleteOperation[];
}
```

The existing `LedgerUpdateOperation` and `LedgerDeleteOperation` interfaces already support `DEBIT_NOTE` transaction type, so no type changes needed.

## [Files]

Modify existing files to implement direct UPDATE/DELETE for returns.

**Modified Files:**

1. **lib/ledger-handler.ts**
   - Change `getReturnLedgerOps()` return type to `{ creates, updates, deletes }`
   - Replace REFUND_REVERSAL CREATE with DELETE operations
   - Add UPDATE operations for DEBIT_NOTE amount changes
   - Remove reliance on external `updateDebitNoteEntry()` method

2. **lib/transaction-handler.ts**
   - Update `handleReturnEdit()` to unpack new structure from `getReturnLedgerOps()`
   - Remove manual `updateDebitNoteEntry()` calls (now handled by UPDATE operations)
   - Remove manual REFUND_REVERSAL deletion logic (now handled by DELETE operations)
   - Update to use `ledgerCreates`, `ledgerUpdates`, `ledgerDeletes` arrays

3. **lib/ledger-service.ts** (potentially)
   - Keep `updateDebitNoteEntry()` for backward compatibility
   - Mark as deprecated if not used elsewhere

**No new files needed.**

## [Functions]

Modify return ledger operations to use direct UPDATE/DELETE.

**Modified Functions:**

1. **`getReturnLedgerOps()` in lib/ledger-handler.ts**
   - **Current signature:** `getReturnLedgerOps(changes: ChangeSet): LedgerOperation[]`
   - **New signature:** `getReturnLedgerOps(changes: ChangeSet): { creates: LedgerOperation[]; updates: LedgerUpdateOperation[]; deletes: LedgerDeleteOperation[]; }`
   - **Changes:**
     - Case 1→0 (Complete → Incomplete): DELETE REFUND_REVERSAL instead of CREATE
     - Case 2→0 (Partial → Incomplete): DELETE REFUND_REVERSAL instead of CREATE
     - Cases 0→0, 1→1, 2→2, 1→2: UPDATE DEBIT_NOTE for amount changes
     - Cases 0→1, 2→1: Keep CREATE for DEBIT_NOTE (first time)

2. **`handleReturnEdit()` in lib/transaction-handler.ts**
   - **Current:** Calls `getReturnLedgerOps()`, manually calls `updateDebitNoteEntry()`, manually deletes REFUND_REVERSAL
   - **New:** Unpack `{ creates, updates, deletes }` from `getReturnLedgerOps()`, pass to `executeInTransaction()`
   - **Changes:**
     - Remove manual `updateDebitNoteEntry()` call (line ~160)
     - Remove manual REFUND_REVERSAL deletion blocks (lines ~180-225)
     - Return structure matching purchase edit pattern

**No functions removed.**

## [Classes]

No class structure changes needed.

The `LedgerHandler` class already contains both `getPurchaseLedgerOps()` and `getReturnLedgerOps()`. Only method signatures and internal logic change.

## [Dependencies]

No dependency changes required.

All required interfaces (`LedgerUpdateOperation`, `LedgerDeleteOperation`) already exist and support `DEBIT_NOTE` transaction type.

## [Testing]

Manual testing approach for return edit scenarios.

**Test Cases:**

1. **Status Changes:**
   - Complete → Incomplete (1→0): Verify REFUND_REVERSAL deleted
   - Incomplete → Complete (0→1): Verify DEBIT_NOTE created
   - Partial → Incomplete (2→0): Verify REFUND_REVERSAL deleted
   - Partial → Complete (2→1): Verify DEBIT_NOTE created/updated

2. **Amount Changes:**
   - Complete with amount change (1→1): Verify DEBIT_NOTE updated
   - Incomplete with amount change (0→0): Verify DEBIT_NOTE updated (if exists)
   - Partial with amount change (2→2): Verify DEBIT_NOTE updated

3. **Balance Verification:**
   - Check vendor balance after each operation
   - Verify no REFUND_REVERSAL entries created
   - Verify ledger shows clean UPDATE/DELETE operations

4. **Edge Cases:**
   - Return without existing DEBIT_NOTE
   - Multiple edits in sequence
   - Status change + amount change together

**Test Validation:**
- Query vendor_ledger for REFUND_REVERSAL entries (should be 0 after refactoring)
- Query vendor_ledger for DEBIT_NOTE with updated amounts
- Verify vendor balance matches expected value

## [Implementation Order]

Sequential steps to implement return edit refactoring.

1. **Update getReturnLedgerOps() Return Type**
   - Change signature to return `{ creates, updates, deletes }`
   - Initialize three arrays: creates, updates, deletes

2. **Refactor Case 1→0 (Complete → Incomplete)**
   - Replace REFUND_REVERSAL CREATE with DELETE operation
   - Delete where: `reference_type: 'purchase_return', reference_id, transaction_type: 'REFUND_REVERSAL'`

3. **Refactor Case 2→0 (Partial → Incomplete)**
   - Same as 1→0: DELETE REFUND_REVERSAL instead of CREATE

4. **Add UPDATE Operations for Amount Changes**
   - Cases 1→1, 0→0, 2→2, 1→2, 0→2:
   - UPDATE DEBIT_NOTE where: `reference_type: 'purchase_return', reference_id, transaction_type: 'DEBIT_NOTE'`
   - Set data: `credit: newTotal, notes: updated description`

5. **Update handleReturnEdit() in transaction-handler**
   - Change `const ledgerOps = ledgerHandler.getReturnLedgerOps(changes)` to:
   - `const ledgerResult = ledgerHandler.getReturnLedgerOps(changes)`
   - Remove manual `updateDebitNoteEntry()` call (line ~160)
   - Remove all manual REFUND_REVERSAL deletion blocks (lines ~180-225)
   - Return: `{ ledgerOps: ledgerResult.creates, ledgerCreates: ledgerResult.creates, ledgerUpdates: ledgerResult.updates, ledgerDeletes: ledgerResult.deletes, balanceOp, allocationChanges }`

6. **Update Return Statement**
   - Change return structure to match purchase edit pattern
   - Ensure backward compatibility with `ledgerOps` field

7. **Test Compilation**
   - Run `npx tsc --noEmit` to verify no TypeScript errors

8. **Manual Testing**
   - Test each status transition case
   - Verify ledger cleanliness (no REFUND_REVERSAL creates)
   - Check vendor balance correctness

9. **Verify Infrastructure**
   - Confirm `executeLedgerUpdates()` handles DEBIT_NOTE updates
   - Confirm `executeLedgerDeletes()` handles REFUND_REVERSAL deletions
   - Check balance recalculation works correctly

10. **Documentation**
    - Update comments to reflect new approach
    - Mark old `updateDebitNoteEntry()` approach as deprecated
    - Document new UPDATE/DELETE pattern
