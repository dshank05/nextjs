# Vendor Payment Overpayment - Edit Mode Fix

**Date:** February 1, 2026  
**Status:** Pending Implementation  
**Priority:** High

---

## Problem Summary

When editing a BILL_SPECIFIC vendor payment where the underlying purchase bill was reduced (creating an overpayment scenario), the UI displays confusing data and allows invalid operations.

### Example Scenario

**Initial State:**
- Purchase #17: ₹5,000 (Paid with ₹5,000 via BILL_SPECIFIC payment)

**After Purchase Edit:**
- Purchase #17 reduced to: ₹3,000
- Payment allocation still shows: ₹5,000
- Outstanding: **-₹2,000** (overpayment)

---

## Current Behavior

### Ledger Entries (Correct ✅)

```
PURCHASE: ₹5,000 debit
PURCHASE_ADJUSTMENT: -₹2,000 credit (reduces to ₹3k)
PAYMENT: ₹5,000 credit
---
Net: ₹5k - ₹2k - ₹5k = -₹2k (₹2k advance balance) ✅
```

**Merged Ledger View:**
```
Purchase: ₹3,000 debit (5k - 2k adjustment)
Payment: ₹5,000 credit
Balance: -₹2,000 (₹2k advance) ✅
```

### Backend Handling (Correct ✅)

When user edits payment from ₹5k → ₹3k:

1. **Vendor Payments API** (`/api/vendor-payments/[id]` PUT)
   - Calculates: `amountDiff = 3000 - 5000 = -2000`
   - Creates: `PAYMENT_ADJUSTMENT` with ₹2,000 debit
   - Updates: `vendor_payments.payment_amount = 3000`
   - Updates: `payment_allocations.allocated_amount = 3000`
   - Updates: `vendor_balance.total_paid -= 2000`

2. **Result:**
   - Ledger: PAYMENT_ADJUSTMENT reverses ₹2k
   - Payment record: Updated to ₹3k ✅
   - Balance: ₹2k returned to advance ✅
   - Bill: Treated as fresh ₹3k bill with ₹3k paid ✅

---

## UI Issues (Needs Fix ❌)

### Issue 1: Negative Outstanding Display

**Current:**
```
Invoice #17:
- Total Bill: ₹3,000
- Paid: ₹5,000
- Outstanding: -₹2,000 ❌ Confusing!
```

**Expected:**
```
Outstanding: ₹0 (show overpayment separately)
```

### Issue 2: Can Allocate More Than Bill Amount

**Current:** User can type ₹5,000 in allocation field for ₹3,000 bill ❌

**Expected:** Max allocation = ₹3,000 (bill total)

### Issue 3: Update Button Enabled When Invalid

**Current Scenarios:**

| Amount | Type | Allocated | Outstanding | Button State | Expected |
|--------|------|-----------|-------------|--------------|----------|
| ₹5,000 | BILL_SPECIFIC | ₹5,000 | -₹2,000 | ENABLED ❌ | DISABLED |
| ₹5,000 | BILL_SPECIFIC | ₹3,000 | -₹2,000 | ENABLED ❌ | DISABLED |
| ₹3,000 | BILL_SPECIFIC | ₹3,000 | -₹2,000 | ENABLED ❌ | ENABLED ✅ |

### Issue 4: No Overpayment Warning

User receives no indication that the bill is overpaid or what actions to take.

---

## Solution Plan

### Fix 1: Cap Outstanding Display

**File:** `pages/entry/vendor-transaction.tsx`  
**Location:** `fetchTransactionForEdit()`

```typescript
const allocatedBills: OutstandingBill[] = transaction.allocations.map(alloc => ({
  purchase_id: alloc.purchase_id,
  invoice_no: alloc.invoice_no,
  total_bill: alloc.purchase_total,
  total_paid: alloc.allocated_amount,
  // ✅ FIX: Cap outstanding at 0 for display
  outstanding_amount: Math.max(0, alloc.purchase_total - alloc.allocated_amount),
  payment_status: alloc.payment_status,
  allocated: alloc.allocated_amount
}))
```

**Result:** Outstanding shows ₹0 instead of -₹2,000

---

### Fix 2: Limit Allocation Input

**File:** `pages/entry/vendor-transaction.tsx`  
**Location:** Allocation input field

```tsx
<input
  type="number"
  max={bill.total_bill}  // ✅ Can't allocate more than bill amount
  value={bill.allocated || ''}
  onChange={(e) => handleBillAllocationChange(bill.purchase_id, e.target.value)}
/>
```

**Result:** User cannot type more than ₹3,000 for ₹3,000 bill

---

### Fix 3: Validate Over-Allocation

**File:** `pages/entry/vendor-transaction.tsx`  
**Location:** `isRecordDisabled()`

```typescript
if (paymentType === 'BILL_SPECIFIC') {
  // ✅ NEW: Check if any bill has allocation > total_bill
  const hasOverAllocation = outstandingBills.some(
    bill => (bill.allocated || 0) > bill.total_bill
  )
  if (hasOverAllocation) return true  // DISABLE button
  
  // Existing validations...
  if (allocated === 0) return true
  if (Math.abs(amountNum - allocated) > 0.01) return true
  return false
}
```

**Result:** Button disabled when allocation exceeds bill amount

---

### Fix 4: Show Overpayment Warning

**File:** `pages/entry/vendor-transaction.tsx`  
**Location:** `handleRecordTransaction()`

```typescript
if (paymentType === 'BILL_SPECIFIC') {
  const overAllocatedBills = outstandingBills.filter(
    bill => (bill.allocated || 0) > bill.total_bill
  )
  
  if (overAllocatedBills.length > 0) {
    setError(
      `Cannot allocate more than bill amount. ` +
      `Options: 1) Reduce payment amount, or 2) Switch to MIXED payment type.`
    )
    return
  }
}
```

**Result:** Clear error message explaining the issue and solutions

---

## Payment Type Validation Rules

### BILL_SPECIFIC
- `amount <= total_bill` ✅
- `outstanding >= 0` ✅
- `allocated <= total_bill` ✅
- `allocated === amount` ✅

### MIXED
- `amount` = any amount
- `outstanding >= 0` (display only)
- `allocated` = any amount <= bill total
- `amount - allocated` = goes to vendor advance

### DIRECT
- No allocation needed
- All amount goes to vendor advance

---

## Test Scenarios

### Scenario 1: Reduce Payment Amount (BILL_SPECIFIC)

**Steps:**
1. Edit payment: ₹5,000 → ₹3,000
2. Clear allocations
3. Auto-allocate (should allocate ₹3,000)
4. Click Update

**Expected:**
- Outstanding shows: ₹0 (not -₹2,000)
- Allocated: ₹3,000
- Difference: ₹0
- Button: ENABLED ✅
- API creates: PAYMENT_ADJUSTMENT -₹2,000 debit

---

### Scenario 2: Switch to MIXED

**Steps:**
1. Edit payment: Keep amount ₹5,000
2. Change type: BILL_SPECIFIC → MIXED
3. Allocate ₹3,000 to bill
4. Click Update

**Expected:**
- Outstanding shows: ₹0
- Allocated: ₹3,000
- Difference: ₹2,000 (Unallocated/Advance)
- Button: ENABLED ✅
- API creates: PAYMENT_ADJUSTMENT -₹2,000 debit (for de-allocation)

---

### Scenario 3: Try to Over-Allocate (Should Fail)

**Steps:**
1. Edit payment: Amount ₹5,000
2. Try to allocate ₹5,000 to ₹3,000 bill

**Expected:**
- Input field caps at ₹3,000 (max attribute)
- If user bypasses: Button DISABLED
- Error message shown
- Cannot submit ❌

---

## Implementation Checklist

- [ ] Fix 1: Cap outstanding display to ₹0 in `fetchTransactionForEdit()`
- [ ] Fix 2: Add `max={bill.total_bill}` to allocation input
- [ ] Fix 3: Add over-allocation check in `isRecordDisabled()`
- [ ] Fix 4: Add error message in `handleRecordTransaction()`
- [ ] Test Scenario 1: Reduce payment amount
- [ ] Test Scenario 2: Switch to MIXED
- [ ] Test Scenario 3: Try to over-allocate
- [ ] Verify backend PAYMENT_ADJUSTMENT creation
- [ ] Verify ledger balance calculations
- [ ] Document in user manual

---

## Notes

### Why Backend Doesn't Need Changes

The existing vendor payment edit API (`/api/vendor-payments/[id]`) already correctly:
1. Calculates amount differences
2. Creates PAYMENT_ADJUSTMENT ledger entries
3. Updates payment records
4. Updates allocations
5. Recalculates balances

**The issue is ONLY in the UI validation and display.**

### Related Files

- `pages/entry/vendor-transaction.tsx` - Edit form (needs fixes)
- `pages/api/vendor-payments/[id].ts` - Payment API (working correctly)
- `lib/transaction-handler.ts` - Business logic (working correctly)
- `lib/ledger-handler.ts` - Ledger operations (working correctly)

---

## Conclusion

This is a **UI-only fix** to prevent user confusion and invalid data entry when editing payments for reduced-amount bills. The backend already handles the accounting correctly through PAYMENT_ADJUSTMENT entries.

**Key Insight:** When a bill is reduced after payment, the excess becomes vendor advance automatically through ledger adjustments. The UI just needs to prevent over-allocation and display this clearly to the user.
