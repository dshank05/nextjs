# Integrated Payment System - Complete Analysis

**Document Version:** 1.0  
**Created:** January 11, 2026  
**Status:** 📊 ANALYSIS COMPLETE  
**Purpose:** Document current behavior of 3-system architecture and identify gaps

---

## 🎯 THE 3 SYSTEMS

### **System 1: INVENTORY**
- **Updates:** `product.stock`
- **Triggers:** Purchase create/edit, Return create/edit

### **System 2: LEDGER**
- **Updates:** `vendor_ledger`
- **Triggers:** Purchase create/edit, Return create/edit, Payment create, Refund create

### **System 3: PAYMENT ALLOCATION**
- **Updates:** `vendor_payments`, `payment_allocations`, `vendor_refunds`, `refund_allocations`
- **Triggers:** Payment create, Refund create

---

## 📊 ENTRY POINT ANALYSIS

### **Entry Point 1: Purchase Create** (`POST /api/purchases/index.ts`)

#### **UNPAID Purchase (payment_status = 0):**
```typescript
✅ Inventory: product.stock += qty (Line 550)
✅ Ledger: PURCHASE entry (Line 555)
✅ Payment Allocation: NONE (correct - unpaid)
```

#### **PAID Purchase (payment_status = 1):**
```typescript
✅ Inventory: product.stock += qty (Line 550)
✅ Ledger: PURCHASE entry (Line 555)
✅ Ledger: PAYMENT entry (Line 560-575)
❌ Payment Allocation: MISSING! (BUG)
   - Should create vendor_payments record
   - Should create payment_allocations record
```

**Location to Add:** After line 575 (after PAYMENT ledger entry)

---

### **Entry Point 2: Purchase Edit** (`PUT /api/purchases/[id].ts`)

#### **Case A: Mark as PAID (0→1):**
```typescript
✅ Inventory: Already updated in transaction
✅ Ledger: PAYMENT entry (Line 750-770)
❌ Payment Allocation: MISSING! (BUG)
   - Should create vendor_payments record
   - Should create payment_allocations record
```

**Location to Add:** After line 770 (after PAYMENT ledger entry)

#### **Case B: Unmark (1→0):**
```typescript
✅ Inventory: Already updated in transaction
✅ Ledger: PAYMENT_REVERSAL entry (Line 720-740)
❌ Payment Allocation: NOT DELETED! (BUG)
   - Should delete payment_allocations records
   - Should delete vendor_payments record (if no other allocations)
```

**Location to Add:** After line 740 (after PAYMENT_REVERSAL ledger entry)

#### **Case C: Change Qty (paid, amount changed):**
```typescript
✅ Inventory: Stock adjusted in transaction
✅ Ledger: PURCHASE_ADJUSTMENT entry (Line 850-870)
✅ Ledger: PAYMENT_ADJUSTMENT entry (Line 880-900) [Type B only]
❌ Payment Allocation: NOT UPDATED! (BUG)
   - Type A (has allocations): Should recalculate payment_status
   - Type B (no allocations): Already handled with PAYMENT_ADJUSTMENT
```

**Location to Add:** After line 900 (in Type A branch)

---

### **Entry Point 3: Return Create** (`POST /api/purchase-returns/vendor-return.ts`)

#### **UNPAID Return (payment_status = 0):**
```typescript
✅ Inventory: product.stock -= qty
✅ Ledger: DEBIT_NOTE entry
✅ Payment Allocation: NONE (correct - unpaid)
```

#### **REFUNDED Return (payment_status = 1):**
```typescript
✅ Inventory: product.stock -= qty
✅ Ledger: DEBIT_NOTE entry
✅ Ledger: REFUND_RECEIVED entry
✅ Payment Allocation: CREATED! (FIXED in Phase 2B)
   - Creates vendor_refunds record
   - Creates refund_allocations record
```

**Status:** ✅ **COMPLETE** (documented in PURCHASE_RETURN_REFUND_ALLOCATION_FIX.md)

---

### **Entry Point 4: Return Edit** (`PUT /api/purchase-returns/[id].ts`)

#### **Case A: Mark as REFUNDED (0→1):**
```typescript
✅ Inventory: Already updated
✅ Ledger: REFUND_RECEIVED entry
✅ Payment Allocation: CREATED! (FIXED in Phase 2B)
   - Creates vendor_refunds record
   - Creates refund_allocations record
```

#### **Case B: Unmark (1→0):**
```typescript
✅ Inventory: Already updated
✅ Ledger: REFUND_REVERSAL entry
✅ Payment Allocation: DELETED! (FIXED in Phase 2B)
   - Deletes refund_allocations records
   - Deletes vendor_refunds record (if no other allocations)
```

**Status:** ✅ **COMPLETE** (documented in PURCHASE_RETURN_REFUND_ALLOCATION_FIX.md)

---

### **Entry Point 5: Payment Create** (`POST /api/vendor-payments/index.ts`)

```typescript
✅ Inventory: NONE (correct)
✅ Ledger: PAYMENT entry per allocation (Line 90-110)
✅ Payment Allocation: CREATED! (Line 50-85)
   - Creates vendor_payments record
   - Creates payment_allocations records
   - Updates purchase.payment_status
```

**Status:** ✅ **WORKING CORRECTLY**

---

### **Entry Point 6: Refund Create** (`POST /api/vendor-refunds/index.ts`)

```typescript
✅ Inventory: NONE (correct)
✅ Ledger: REFUND_RECEIVED entry per allocation
✅ Payment Allocation: CREATED!
   - Creates vendor_refunds record
   - Creates refund_allocations records
   - Updates purchase_returns.payment_status
```

**Status:** ✅ **WORKING CORRECTLY**

---

## 🔴 IDENTIFIED GAPS

### **Gap 1: Purchase Create (PAID)**
**File:** `pages/api/purchases/index.ts`  
**Line:** After 575  
**Missing:**
```typescript
// Create payment allocation records
const payment = await prisma.vendor_payments.create({
  data: {
    vendor_id: parseInt(vendor_id),
    payment_date: Math.floor(invoiceDate),
    payment_amount: calculatedGrandTotal,
    payment_mode: payment_mode,
    payment_type: 'BILL_SPECIFIC',
    notes: `Payment for purchase ${purchase.invoice_no}`,
    fy: currentFy
  }
});

await prisma.payment_allocations.create({
  data: {
    payment_id: payment.id,
    purchase_id: purchase.id,
    allocated_amount: calculatedGrandTotal,
    allocation_date: Math.floor(invoiceDate),
    notes: 'Allocated during purchase creation'
  }
});
```

---

### **Gap 2: Purchase Edit - Mark as PAID**
**File:** `pages/api/purchases/[id].ts`  
**Line:** After 770  
**Missing:**
```typescript
// Create payment allocation records
const payment = await prisma.vendor_payments.create({
  data: {
    vendor_id: existingPurchase.vendor_id,
    payment_date: Math.floor(Date.now() / 1000),
    payment_amount: newTotal,
    payment_mode: parsedPaymentMode,
    payment_type: 'BILL_SPECIFIC',
    notes: `Payment for purchase ${existingPurchase.invoice_no}`,
    fy: existingPurchase.fy
  }
});

await prisma.payment_allocations.create({
  data: {
    payment_id: payment.id,
    purchase_id: purchaseId,
    allocated_amount: newTotal,
    allocation_date: Math.floor(Date.now() / 1000),
    notes: 'Allocated during purchase edit'
  }
});
```

---

### **Gap 3: Purchase Edit - Unmark**
**File:** `pages/api/purchases/[id].ts`  
**Line:** After 740  
**Missing:**
```typescript
// Delete payment allocations
const allocations = await prisma.payment_allocations.findMany({
  where: { purchase_id: purchaseId },
  select: { payment_id: true }
});

await prisma.payment_allocations.deleteMany({
  where: { purchase_id: purchaseId }
});

// Delete vendor_payments if no other allocations exist
for (const alloc of allocations) {
  const remainingAllocs = await prisma.payment_allocations.count({
    where: { payment_id: alloc.payment_id }
  });
  
  if (remainingAllocs === 0) {
    await prisma.vendor_payments.delete({
      where: { id: alloc.payment_id }
    });
  }
}
```

---

### **Gap 4: Purchase Edit - Change Qty (Type A)**
**File:** `pages/api/purchases/[id].ts`  
**Line:** After 900 (in Type A branch)  
**Missing:**
```typescript
// Type A: Recalculate payment_status based on allocations
const totalAllocated = paymentAllocations.reduce(
  (sum, alloc) => sum + Number(alloc.allocated_amount),
  0
);

let newCalculatedStatus = 0;
if (totalAllocated >= newTotal) {
  newCalculatedStatus = 1; // Fully paid
} else if (totalAllocated > 0) {
  newCalculatedStatus = 2; // Partially paid
}

if (newCalculatedStatus !== newPaymentStatus) {
  await prisma.purchase.update({
    where: { id: purchaseId },
    data: { payment_status: newCalculatedStatus }
  });
}
```

**Note:** This is already implemented! (Line 890-910)

---

## 📋 DATABASE SCHEMA VERIFICATION

### **Payment Allocation Tables:**

#### **vendor_payments:**
```prisma
model vendor_payments {
  id             Int
  vendor_id      Int
  payment_date   Int
  payment_amount Decimal
  payment_mode   Int
  payment_type   String
  notes          String?
  fy             Int
  allocations    payment_allocations[]
}
```
✅ **Schema Correct**

#### **payment_allocations:**
```prisma
model payment_allocations {
  id               Int
  payment_id       Int
  purchase_id      Int
  allocated_amount Decimal
  allocation_date  Int
  notes            String?
  payment          vendor_payments
  purchase         Purchase
}
```
✅ **Schema Correct**

#### **purchase:**
```prisma
model Purchase {
  id                       Int
  payment_status           Int?  // 0=Unpaid, 1=Paid, 2=Partial
  payment_mode             Int?  // 0=Cash, 1=Bank
  payment_allocations      payment_allocations[]
}
```
✅ **Schema Correct**

---

## 🎯 SUMMARY OF REQUIRED FIXES

### **CRITICAL (Must Fix):**
1. ❌ **Purchase Create (PAID):** Add payment allocation creation
2. ❌ **Purchase Edit (Mark as PAID):** Add payment allocation creation
3. ❌ **Purchase Edit (Unmark):** Add payment allocation deletion

### **ALREADY WORKING:**
4. ✅ **Purchase Edit (Change Qty - Type A):** Already recalculates status
5. ✅ **Return Create/Edit:** Already has refund allocation (Phase 2B)
6. ✅ **Payment/Refund Create:** Already working correctly

---

## 🔧 IMPLEMENTATION PRIORITY

### **Phase 1: Fix Purchase Payment Allocation** ✅ **COMPLETE**
- [x] Add payment allocation to Purchase Create (PAID)
- [x] Add payment allocation to Purchase Edit (Mark as PAID)
- [x] Add payment allocation deletion to Purchase Edit (Unmark)

### **Phase 2: Add Restrictions** ✅ **COMPLETE**
- [x] Block deletion if payment_status = 1
- [ ] Block vendor change if payment_status = 1 (NOT NEEDED - vendor details stored in bill_to)
- [ ] Hide edit/delete buttons in UI if paid (OPTIONAL - API restrictions sufficient)

### **Phase 3: Testing** (REQUIRED)
- [ ] Test Invoice 12 issue (paid but no history)
- [ ] Test create paid purchase
- [ ] Test mark as paid
- [ ] Test unmark
- [ ] Test deletion restriction

---

## 📊 EXPECTED RESULTS

### **After Fix - Purchase Create (PAID):**
```
Before:
├─ purchase.payment_status = 1 ✅
├─ vendor_ledger: PURCHASE + PAYMENT ✅
├─ vendor_payments: NONE ❌
└─ payment_allocations: NONE ❌

After:
├─ purchase.payment_status = 1 ✅
├─ vendor_ledger: PURCHASE + PAYMENT ✅
├─ vendor_payments: CREATED ✅
└─ payment_allocations: CREATED ✅
```

### **After Fix - Purchase Edit (Mark as PAID):**
```
Before:
├─ purchase.payment_status = 1 ✅
├─ vendor_ledger: PAYMENT ✅
├─ vendor_payments: NONE ❌
└─ payment_allocations: NONE ❌

After:
├─ purchase.payment_status = 1 ✅
├─ vendor_ledger: PAYMENT ✅
├─ vendor_payments: CREATED ✅
└─ payment_allocations: CREATED ✅
```

### **After Fix - Purchase Edit (Unmark):**
```
Before:
├─ purchase.payment_status = 0 ✅
├─ vendor_ledger: PAYMENT_REVERSAL ✅
├─ vendor_payments: STILL EXISTS ❌
└─ payment_allocations: STILL EXISTS ❌

After:
├─ purchase.payment_status = 0 ✅
├─ vendor_ledger: PAYMENT_REVERSAL ✅
├─ vendor_payments: DELETED ✅
└─ payment_allocations: DELETED ✅
```

---

## 🎯 FINAL VERIFICATION CHECKLIST

After implementation, verify:

- [ ] Purchase created as "Paid" shows payment in history
- [ ] Purchase edited to "Paid" shows payment in history
- [ ] Purchase edited to "Unpaid" removes payment from history
- [ ] Invoice 12 issue resolved (shows payment history)
- [ ] Ledger balance matches payment allocations
- [ ] No orphaned payment_allocations records
- [ ] Cannot change vendor on paid purchase
- [ ] Cannot delete paid purchase
- [ ] All existing functionality still works

---

**END OF ANALYSIS**
