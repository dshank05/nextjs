# Ledger Refactoring: Direct Operations Analysis

**Document Version:** 1.0  
**Created:** February 13, 2026  
**Status:** 📊 COMPREHENSIVE ANALYSIS  
**Purpose:** Transition from ADJUSTMENT/REVERSAL pattern to direct UPDATE/DELETE operations

---

## 🎯 PHILOSOPHY CHANGE

### **OLD APPROACH (Audit Trail)**
Never modify or delete entries - always append new entries:
- **CREATE** → INSERT entry
- **UPDATE** → INSERT adjustment entry
- **DELETE** → INSERT reversal entry

**Problems:**
- Complex merge logic required
- Ledger bloat (3x entries)
- Merge bugs and edge cases
- Hard to maintain

### **NEW APPROACH (Direct Operations)**
Match database CRUD operations directly:
- **CREATE** → INSERT entry
- **UPDATE** → UPDATE entry
- **DELETE** → DELETE entry

**Benefits:**
- No merge logic needed
- Clean ledger (1x entries)
- Simple to understand
- Easy to maintain
- Matches user expectations

---

## 📋 API INVENTORY

### **Purchase APIs**
1. `POST /api/purchases/index.ts` - Purchase Create ✅ SIMPLE
2. `PUT /api/purchases/[id].ts` - Purchase Edit ⚠️ COMPLEX
3. `DELETE /api/purchases/[id].ts` - Purchase Delete ⚠️ HALF-DONE

### **Return APIs**
4. `POST /api/purchase-returns/vendor-return.ts` - Return Create ✅ SIMPLE
5. `PUT /api/purchase-returns/[id].ts` - Return Edit ⚠️ COMPLEX
6. `DELETE /api/purchase-returns/[id].ts` - Return Delete ⚠️ HALF-DONE

### **Payment APIs**
7. `POST /api/vendor-payments/index.ts` - Payment Create ✅ SIMPLE
8. `PUT /api/vendor-payments/[id].ts` - Payment Edit ⚠️ COMPLEX
9. `DELETE /api/vendor-payments/[id].ts` - Payment Delete ⚠️ HALF-DONE

### **Refund APIs**
10. `POST /api/vendor-refunds/index.ts` - Refund Create ✅ SIMPLE
11. `PUT /api/vendor-refunds/[id].ts` - Refund Edit ⚠️ COMPLEX
12. `DELETE /api/vendor-refunds/[id].ts` - Refund Delete ⚠️ HALF-DONE

---

## 📊 OPERATION ANALYSIS BY API

---

## 1. PURCHASE CREATE (POST /api/purchases/index.ts)

### **Current State:** ✅ SIMPLE - Already correct

**Ledger Operations:**
```typescript
// Creates PURCHASE entry
await ledgerService.createEntry({
  transaction_type: 'PURCHASE',
  reference_type: 'purchase',
  reference_id: purchaseId,
  debit: total,
  credit: 0
})

// If marked as PAID, creates PAYMENT entry
await ledgerService.createEntry({
  transaction_type: 'PAYMENT',
  reference_type: 'purchase',
  reference_id: purchaseId,
  debit: 0,
  credit: paymentAmount
})
```

**Status:** ✅ NO CHANGES NEEDED

---

## 2. PURCHASE EDIT (PUT /api/purchases/[id].ts)

### **Current State:** ⚠️ COMPLEX - Uses ADJUSTMENT entries

**Current Ledger Operations:**
```typescript
// Amount changes → PURCHASE_ADJUSTMENT
await ledgerService.createEntry({
  transaction_type: 'PURCHASE_ADJUSTMENT',  // ❌ REMOVE
  debit: amountDiff > 0 ? amountDiff : 0,
  credit: amountDiff < 0 ? Math.abs(amountDiff) : 0
})

// Status changes (Paid→Unpaid) → PAYMENT_REVERSAL
await ledgerService.createEntry({
  transaction_type: 'PAYMENT_REVERSAL',  // ❌ REMOVE
  debit: paymentAmount,
  credit: 0
})
```

### **NEW APPROACH:**

**1. Amount Changes:**
```typescript
// Instead of creating PURCHASE_ADJUSTMENT
// UPDATE existing PURCHASE entry
await tx.vendor_ledger.updateMany({
  where: {
    reference_type: 'purchase',
    reference_id: purchaseId,
    transaction_type: 'PURCHASE'
  },
  data: {
    debit: newTotal,  // Update to new amount
    notes: `Purchase ${invoiceNo} updated to ₹${newTotal}`
  }
})
```

**2. Payment Status Changes:**

**Case: Unpaid → Paid (0→1)**
```typescript
// Check if PAYMENT entry exists
const existingPayment = await tx.vendor_ledger.findFirst({
  where: {
    reference_type: 'purchase',
    reference_id: purchaseId,
    transaction_type: 'PAYMENT'
  }
})

if (existingPayment) {
  // UPDATE existing
  await tx.vendor_ledger.update({
    where: { id: existingPayment.id },
    data: { credit: newPaymentAmount }
  })
} else {
  // CREATE new
  await ledgerService.createEntry({
    transaction_type: 'PAYMENT',
    credit: newPaymentAmount
  })
}
```

**Case: Paid → Unpaid (1→0)**
```typescript
// Instead of creating PAYMENT_REVERSAL
// DELETE existing PAYMENT entry
await tx.vendor_ledger.deleteMany({
  where: {
    reference_type: 'purchase',
    reference_id: purchaseId,
    transaction_type: 'PAYMENT'
  }
})
```

**Complexity:** HIGH - Handles 9 status transition cases

---

## 3. PURCHASE DELETE (DELETE /api/purchases/[id].ts)

### **Current State:** ⚠️ HALF-DONE - Already uses DELETE

**Current Implementation:**
```typescript
// ✅ Already using DELETE (correct!)
await tx.vendor_ledger.deleteMany({
  where: {
    reference_type: 'purchase',
    reference_id: purchaseId
  }
})
```

**Status:** ✅ ALREADY CORRECT - Uses DELETE

---

## 4. RETURN CREATE (POST /api/purchase-returns/vendor-return.ts)

### **Current State:** ✅ SIMPLE - Already correct

**Ledger Operations:**
```typescript
// Creates DEBIT_NOTE entry
await ledgerService.createEntry({
  transaction_type: 'DEBIT_NOTE',
  reference_type: 'purchase_return',
  reference_id: returnId,
  debit: 0,
  credit: returnAmount
})

// If refunded, creates REFUND_RECEIVED entry
await ledgerService.createEntry({
  transaction_type: 'REFUND_RECEIVED',
  reference_type: 'purchase_return',
  reference_id: returnId,
  debit: refundAmount,
  credit: 0
})
```

**Status:** ✅ NO CHANGES NEEDED

---

## 5. RETURN EDIT (PUT /api/purchase-returns/[id].ts)

### **Current State:** ⚠️ COMPLEX - Uses REVERSAL entries

**Current Ledger Operations:**
```typescript
// Amount changes → Updates DEBIT_NOTE directly (CORRECT!)
await ledgerService.updateDebitNoteEntry({
  reference_id: returnId,
  new_total_amount: newAmount
})

// Status changes (Complete→Incomplete) → REFUND_REVERSAL
await ledgerService.createEntry({
  transaction_type: 'REFUND_REVERSAL',  // ❌ REMOVE
  debit: refundAmount,
  credit: 0
})
```

### **NEW APPROACH:**

**1. Amount Changes:**
```typescript
// ✅ Already correct - updates DEBIT_NOTE directly
await tx.vendor_ledger.updateMany({
  where: {
    reference_type: 'purchase_return',
    reference_id: returnId,
    transaction_type: 'DEBIT_NOTE'
  },
  data: {
    credit: newAmount,
    notes: `Return ${debitNoteNo} updated to ₹${newAmount}`
  }
})
```

**2. Refund Status Changes:**

**Case: Incomplete → Complete (0→1)**
```typescript
// Check if DEBIT_NOTE exists
const existingDebitNote = await tx.vendor_ledger.findFirst({
  where: {
    reference_type: 'purchase_return',
    reference_id: returnId,
    transaction_type: 'DEBIT_NOTE'
  }
})

if (!existingDebitNote) {
  // CREATE new DEBIT_NOTE
  await ledgerService.createEntry({
    transaction_type: 'DEBIT_NOTE',
    credit: returnAmount
  })
}
```

**Case: Complete → Incomplete (1→0)**
```typescript
// Instead of creating REFUND_REVERSAL
// DELETE existing DEBIT_NOTE entry
await tx.vendor_ledger.deleteMany({
  where: {
    reference_type: 'purchase_return',
    reference_id: returnId,
    transaction_type: 'DEBIT_NOTE'
  }
})
```

**Complexity:** HIGH - Handles 9 status transition cases

---

## 6. RETURN DELETE (DELETE /api/purchase-returns/[id].ts)

### **Current State:** ⚠️ HALF-DONE - Already uses DELETE

**Current Implementation:**
```typescript
// ✅ Already using DELETE (correct!)
await tx.vendor_ledger.deleteMany({
  where: {
    reference_type: 'purchase_return',
    reference_id: returnId
  }
})
```

**Status:** ✅ ALREADY CORRECT - Uses DELETE

---

## 7. PAYMENT CREATE (POST /api/vendor-payments/index.ts)

### **Current State:** ✅ SIMPLE - Already correct

**Ledger Operations:**
```typescript
// For each allocation, creates PAYMENT entry
await ledgerService.createEntry({
  transaction_type: 'PAYMENT',
  reference_type: 'purchase',
  reference_id: purchaseId,
  debit: 0,
  credit: allocatedAmount,
  transaction_id: paymentId  // Links payment entries
})
```

**Status:** ✅ NO CHANGES NEEDED

---

## 8. PAYMENT EDIT (PUT /api/vendor-payments/[id].ts)

### **Current State:** ⚠️ COMPLEX - Uses ADJUSTMENT entries

**Current Ledger Operations:**
```typescript
// Amount changes → PAYMENT_ADJUSTMENT
await ledgerService.createEntry({
  transaction_type: 'PAYMENT_ADJUSTMENT',  // ❌ REMOVE
  debit: amountDiff < 0 ? Math.abs(amountDiff) : 0,
  credit: amountDiff > 0 ? amountDiff : 0,
  transaction_id: paymentId
})
```

### **NEW APPROACH:**

**Amount Changes:**
```typescript
// Instead of creating PAYMENT_ADJUSTMENT
// UPDATE existing PAYMENT entries
await tx.vendor_ledger.updateMany({
  where: {
    transaction_id: paymentId,
    transaction_type: 'PAYMENT'
  },
  data: {
    credit: newPaymentAmount,
    notes: `Payment #${paymentId} updated to ₹${newPaymentAmount}`
  }
})
```

**Special Case - Advance-Only Payments:**
```typescript
// If payment was created from advance (no PAYMENT entry exists)
const existingPayment = await tx.vendor_ledger.findFirst({
  where: { transaction_id: paymentId, transaction_type: 'PAYMENT' }
})

if (!existingPayment) {
  // No ledger entry - payment was from advance
  // Only update payment_allocations and balances
  // NO ledger operations needed
}
```

**Complexity:** MEDIUM - Simpler than purchases

---

## 9. PAYMENT DELETE (DELETE /api/vendor-payments/[id].ts)

### **Current State:** ⚠️ HALF-DONE - Already uses DELETE

**Current Implementation:**
```typescript
// ✅ Already using DELETE (correct!)
await tx.vendor_ledger.deleteMany({
  where: {
    transaction_id: paymentId,
    transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
  }
})
```

**NEW APPROACH:**
```typescript
// Simpler - only PAYMENT type now
await tx.vendor_ledger.deleteMany({
  where: {
    transaction_id: paymentId,
    transaction_type: 'PAYMENT'
  }
})
```

**Status:** ✅ MOSTLY CORRECT - Just remove ADJUSTMENT type

---

## 10. REFUND CREATE (POST /api/vendor-refunds/index.ts)

### **Current State:** ✅ SIMPLE - Already correct

**Ledger Operations:**
```typescript
// For each allocation, creates REFUND_RECEIVED entry
await ledgerService.createEntry({
  transaction_type: 'REFUND_RECEIVED',
  reference_type: 'purchase_return',
  reference_id: returnId,
  debit: allocatedAmount,
  credit: 0,
  transaction_id: refundId  // Links refund entries
})
```

**Status:** ✅ NO CHANGES NEEDED

---

## 11. REFUND EDIT (PUT /api/vendor-refunds/[id].ts)

### **Current State:** ⚠️ COMPLEX - Uses ADJUSTMENT entries

**Current Ledger Operations:**
```typescript
// Amount changes → REFUND_ADJUSTMENT
await ledgerService.createEntry({
  transaction_type: 'REFUND_ADJUSTMENT',  // ❌ REMOVE
  debit: amountDiff > 0 ? amountDiff : 0,
  credit: amountDiff < 0 ? Math.abs(amountDiff) : 0,
  transaction_id: refundId
})
```

### **NEW APPROACH:**

**Amount Changes:**
```typescript
// Instead of creating REFUND_ADJUSTMENT
// UPDATE existing REFUND_RECEIVED entries
await tx.vendor_ledger.updateMany({
  where: {
    transaction_id: refundId,
    transaction_type: 'REFUND_RECEIVED'
  },
  data: {
    debit: newRefundAmount,
    notes: `Refund #${refundId} updated to ₹${newRefundAmount}`
  }
})
```

**Complexity:** MEDIUM - Similar to payment edit

---

## 12. REFUND DELETE (DELETE /api/vendor-refunds/[id].ts)

### **Current State:** ⚠️ HALF-DONE - Already uses DELETE

**Current Implementation:**
```typescript
// ✅ Already using DELETE (correct!)
await tx.vendor_ledger.deleteMany({
  where: {
    transaction_id: refundId,
    transaction_type: { in: ['REFUND_RECEIVED', 'REFUND_ADJUSTMENT'] }
  }
})
```

**NEW APPROACH:**
```typescript
// Simpler - only REFUND_RECEIVED type now
await tx.vendor_ledger.deleteMany({
  where: {
    transaction_id: refundId,
    transaction_type: 'REFUND_RECEIVED'
  }
})
```

**Status:** ✅ MOSTLY CORRECT - Just remove ADJUSTMENT type

---

## 🔧 HANDLER CHANGES REQUIRED

### **ledger-handler.ts**

**REMOVE These Transaction Types:**
- ❌ `PURCHASE_ADJUSTMENT`
- ❌ `PAYMENT_ADJUSTMENT`
- ❌ `PAYMENT_REVERSAL`
- ❌ `REFUND_ADJUSTMENT`
- ❌ `REFUND_REVERSAL`
- ❌ `DEBIT_NOTE_REVERSAL`

**KEEP These Transaction Types:**
- ✅ `PURCHASE`
- ✅ `PAYMENT`
- ✅ `DEBIT_NOTE`
- ✅ `REFUND_RECEIVED`

**NEW Methods Needed:**
```typescript
// Instead of creating ADJUSTMENT entries
// Return UPDATE operations
interface LedgerUpdateOperation {
  where: {
    reference_type: string;
    reference_id: number;
    transaction_type: string;
  };
  data: {
    debit?: number;
    credit?: number;
    notes?: string;
  };
}

// Instead of creating REVERSAL entries
// Return DELETE operations
interface LedgerDeleteOperation {
  where: {
    reference_type: string;
    reference_id: number;
    transaction_type: string;
  };
}
```

---

### **transaction-handler.ts**

**Current Methods:**
```typescript
handlePurchaseEdit() // Returns CREATE operations
handleReturnEdit()   // Returns CREATE operations
handleVendorPaymentEdit()  // Returns CREATE operations
handleVendorRefundEdit()   // Returns CREATE operations
```

**NEW Methods:**
```typescript
handlePurchaseEdit() // Returns CREATE/UPDATE/DELETE operations
handleReturnEdit()   // Returns CREATE/UPDATE/DELETE operations
handleVendorPaymentEdit()  // Returns UPDATE operations
handleVendorRefundEdit()   // Returns UPDATE operations
```

**NEW Return Types:**
```typescript
interface TransactionResult {
  ledgerCreates: LedgerOperation[];     // New entries
  ledgerUpdates: LedgerUpdateOperation[]; // Updates to existing
  ledgerDeletes: LedgerDeleteOperation[]; // Entries to delete
  balanceOp: BalanceOperation | null;
  allocationChanges: AllocationChange[];
}
```

---

### **ledger-merge-utils.ts**

**Current Logic:**
- Groups PAYMENT + PAYMENT_ADJUSTMENT by transaction_id
- Merges them into single entry
- Calculates NET amounts

**NEW Logic:**
```typescript
// ✅ MUCH SIMPLER!
// No merging needed - each entry is already correct
export function mergeLedgerEntries(entries: LedgerEntry[]): LedgerEntry[] {
  // Just sort by date and recalculate balance
  return entries.sort((a, b) => a.date - b.date);
}
```

**Code Reduction:** ~90% reduction (300 lines → 30 lines)

---

## 📊 COMPLEXITY MATRIX

| API | Current | New | Complexity | Priority | Status |
|-----|---------|-----|------------|----------|--------|
| Purchase Create | ✅ Simple | ✅ No Change | LOW | - | ✅ VERIFIED |
| **Purchase Edit** | ⚠️ ADJUSTMENT | ✅ UPDATE | **HIGH** | 1 | ⏳ PENDING |
| Purchase Delete | ✅ DELETE | ✅ No Change | LOW | - | ✅ VERIFIED |
| Return Create | ✅ Simple | ✅ No Change | LOW | - | ✅ VERIFIED |
| **Return Edit** | ⚠️ REVERSAL | ✅ UPDATE/DELETE | **HIGH** | 2 | ⏳ PENDING |
| Return Delete | ✅ DELETE | ✅ No Change | LOW | - | ✅ VERIFIED |
| Payment Create | ✅ Simple | ✅ No Change | LOW | - | ✅ VERIFIED |
| **Payment Edit** | ⚠️ ADJUSTMENT | ✅ UPDATE | **MEDIUM** | 3 | ⏳ PENDING |
| Payment Delete | ✅ DELETE | ✅ No Change | LOW | - | ✅ VERIFIED |
| Refund Create | ✅ Simple | ✅ No Change | LOW | - | ✅ VERIFIED |
| **Refund Edit** | ⚠️ ADJUSTMENT | ✅ UPDATE | **MEDIUM** | 5 | ⏳ PENDING |
| Refund Delete | ✅ DELETE | ✅ No Change | LOW | - | ✅ VERIFIED |

**Progress: Phase 1 Complete (DELETE Verification) - 6/12 APIs verified ✅**

---

## 🎯 IMPLEMENTATION ROADMAP

### **Phase 1: Payment/Refund Edit (MEDIUM Complexity)**
**APIs:** Payment Edit, Refund Edit  
**Time:** 3-4 hours  
**Reason:** Simpler than purchase/return - only amount changes, no complex status transitions

**Steps:**
1. Update `handleVendorPaymentEdit()` to return UPDATE operations
2. Update `handleVendorRefundEdit()` to return UPDATE operations
3. Modify APIs to execute UPDATE instead of CREATE
4. Test payment/refund editing

---

### **Phase 2: Purchase Edit (HIGH Complexity)**
**API:** Purchase Edit  
**Time:** 4-5 hours  
**Reason:** 9 status transition cases + amount changes

**Steps:**
1. Update `handlePurchaseEdit()` to return CREATE/UPDATE/DELETE operations
2. Handle all 9 status transition cases
3. Modify API to execute mixed operations
4. Test all transition cases

---

### **Phase 3: Return Edit (HIGH Complexity)**
**API:** Return Edit  
**Time:** 4-5 hours  
**Reason:** 9 status transition cases + DEBIT_NOTE handling

**Steps:**
1. Update `handleReturnEdit()` to return CREATE/UPDATE/DELETE operations
2. Handle all 9 status transition cases
3. Modify API to execute mixed operations
4. Test all transition cases

---

### **Phase 4: Delete Operations (LOW Complexity)**
**APIs:** Payment Delete, Refund Delete  
**Time:** 1 hour  
**Reason:** Remove ADJUSTMENT from delete filters

**Steps:**
1. Update delete queries to remove ADJUSTMENT types
2. Test deletions

---

### **Phase 5: Ledger Merge Utility (MAJOR Simplification)**
**File:** ledger-merge-utils.ts  
**Time:** 2 hours  
**Reason:** Remove all merging logic

**Steps:**
1. Remove ADJUSTMENT/REVERSAL grouping logic
2. Remove NET calculation logic
3. Simplify to just sorting
4. Test ledger display

---

### **Phase 6: Handler Cleanup**
**Files:** ledger-handler.ts, transaction-handler.ts  
**Time:** 2 hours  
**Reason:** Remove unused code

**Steps:**
1. Remove ADJUSTMENT/REVERSAL methods
2. Remove transaction type enums
3. Update TypeScript interfaces
4. Clean up comments

---

### **Total Time Estimate: 16-19 hours (2-3 days)**

---

## 📈 EXPECTED BENEFITS

### **Code Reduction:**
- ledger-handler.ts: 600 lines → 200 lines (67% reduction)
- ledger-merge-utils.ts: 300 lines → 30 lines (90% reduction)
- APIs: Cleaner, easier to read

### **Performance:**
- No merge logic overhead
- Fewer database queries
- Faster ledger display

### **Maintenance:**
- Much easier to understand
- Fewer bugs
- Direct mapping to business logic

### **User Experience:**
- Ledger shows exactly what happened
- No confusing adjustment entries
- Clear audit trail

---

## ⚠️ RISKS & MITIGATION

### **Risk 1: Audit Trail Loss**
**Old:** All changes tracked via adjustment/reversal entries  
**New:** Direct updates - change history lost

**Mitigation:**
- Add `updated_at` timestamp to ledger entries
- Consider adding `audit_log` table for change history
- Or: Accept simpler system with less history

**Decision:** Accept simpler system for now

---

### **Risk 2: Migration of Existing Data**
**Old:** Existing ledger has ADJUSTMENT/REVERSAL entries  
**New:** System won't know how to handle them

**Mitigation:**
- Run migration script to merge existing entries
- Or: Keep merge logic for old data, use direct operations for new

**Decision:** Keep merge logic for old data temporarily

---

### **Risk 3: Concurrent Edits**
**Old:** Append-only - no conflicts  
**New:** UPDATE operations - potential race conditions

**Mitigation:**
- All operations already in transactions
- Add optimistic locking if needed
- Use `updated_at` for version checking

**Decision:** Current transaction isolation is sufficient

---

## 🧪 TESTING STRATEGY

### **Test Scenarios per API:**

**Purchase Edit:**
- [ ] Edit unpaid purchase (amount change)
- [ ] Mark unpaid as paid
- [ ] Mark paid as unpaid
- [ ] Mark paid as partial (amount increase)
- [ ] Mark partial as paid
- [ ] Mark partial as unpaid
- [ ] Edit paid purchase (amount change)
- [ ] Edit partial purchase (amount change)

**Return Edit:**
- [ ] Edit incomplete return (amount change)
- [ ] Mark incomplete as complete
- [ ] Mark complete as incomplete
- [ ] Mark complete as partial (amount increase)
- [ ] Mark partial as complete
- [ ] Mark partial as incomplete
- [ ] Edit complete return (amount change)
- [ ] Edit partial return (amount change)

**Payment/Refund Edit:**
- [ ] Increase amount
- [ ] Decrease amount
- [ ] Edit advance-only payment (no ledger entry)
- [ ] Edit real payment (has ledger entry)

**Delete Operations:**
- [ ] Delete purchase with payment
- [ ] Delete return with refund
- [ ] Delete payment with allocations
- [ ] Delete refund with allocations

---

**END OF ANALYSIS**
