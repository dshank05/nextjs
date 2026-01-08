# Integrated Vendor Payment & Return System - Complete Architecture

**Document Version:** 1.0  
**Created:** January 8, 2026  
**Status:** 🔧 IMPLEMENTATION GUIDE  
**Purpose:** Fix disconnected payment/refund tracking and integrate all vendor systems

---

## 📋 TABLE OF CONTENTS

1. [Current System Pieces](#current-system-pieces)
2. [The Disconnects (Problems)](#the-disconnects-problems)
3. [The Fix - Integrated System](#the-fix---integrated-system)
4. [Implementation Checklist](#implementation-checklist)
5. [Expected Results](#expected-results)

---

## 📊 SECTION 1: CURRENT SYSTEM PIECES

### **Table 1: Core Operations & Database Tables**

| Operation | API Endpoint | Tables Affected | Ledger Entries | Payment/Refund Tracking |
|-----------|-------------|-----------------|----------------|------------------------|
| **Purchase Create** | `POST /api/purchases` | `purchase`, `purchaseitems`, `bill_to`, `product` (stock+) | `PURCHASE` (Dr), `PAYMENT` (Cr) if paid | ❌ No `payment_allocations` |
| **Purchase Edit** | `PUT /api/purchases/[id]` | `purchase`, `purchaseitems`, `product` (stock±) | `PURCHASE_ADJUSTMENT`, `PAYMENT_ADJUSTMENT`, `PAYMENT_REVERSAL` | ❌ No `payment_allocations` sync |
| **Purchase Return** | `POST /api/purchase-returns/vendor-return` | `purchase_returns`, `purchase_return_items`, `product` (stock-), `purchase` (return_status) | `DEBIT_NOTE` (Cr), `REFUND_RECEIVED` (Dr) if refunded | ❌ No `refund_allocations` |
| **Vendor Payment** | `POST /api/vendor-payments` | `vendor_payments`, `payment_allocations`, `purchase` (payment_status) | `PAYMENT` (Cr) per allocation | ✅ Full integration |
| **Vendor Refund** | `POST /api/vendor-refunds` | `vendor_refunds`, `refund_allocations`, `purchase_returns` (payment_status) | `REFUND_RECEIVED` (Dr) per allocation | ✅ Full integration |

---

### **Table 2: What Affects What (Current System)**

| Action | Directly Updates | Indirectly Affects | Missing Connections |
|--------|-----------------|-------------------|-------------------|
| **Create Purchase (Paid)** | `purchase.payment_status = 1` | `vendor_ledger` balance | ❌ `vendor_payments`, `payment_allocations` |
| **Edit Purchase (Unmark Paid)** | `purchase.payment_status = 0` | `vendor_ledger` (reversal) | ❌ No `payment_allocations` cleanup |
| **Create Payment** | `vendor_payments`, `payment_allocations` | `purchase.payment_status`, `vendor_ledger` | ✅ Fully connected |
| **Create Return (Refunded)** | `purchase_returns.payment_status = 1` | `vendor_ledger` balance | ❌ `vendor_refunds`, `refund_allocations` |
| **Create Refund** | `vendor_refunds`, `refund_allocations` | `purchase_returns.payment_status`, `vendor_ledger` | ✅ Fully connected |

---

### **Table 3: Status Fields Across System**

| Table | Status Field | Values | Current Behavior | Desired Behavior |
|-------|-------------|--------|-----------------|------------------|
| `purchase` | `payment_status` | 0=Unpaid, 1=Paid, 2=Partial | Set manually OR via payment allocation | Should ONLY be set via payment allocation |
| `purchase` | `return_status` | 0=None, 1=Partial, 2=Full | ✅ Auto-calculated from returns | ✅ Working correctly |
| `purchase_returns` | `status` | 0=Incomplete, 1=Completed | Hardcoded to 1 | ✅ Manual tracking (physical goods/money) |
| `purchase_returns` | `payment_status` | 0=Unpaid, 1=Refunded, 2=Partial | Set manually OR via refund allocation | Should ONLY be set via refund allocation |

---

## 🔴 SECTION 2: THE DISCONNECTS (Problems)

### **Problem 1: Dual Payment Tracking**

**Scenario:** Create purchase with `payment_status = 1`

```
Current Flow:
├─ purchase.payment_status = 1 ✅
├─ vendor_ledger: PAYMENT entry ✅
├─ vendor_payments: NONE ❌
└─ payment_allocations: NONE ❌

Result: Shows "Paid" but payment history is empty!
```

**Why This Happens:**
- `POST /api/purchases` creates ledger entry but NOT payment allocation records
- Payment history queries `payment_allocations` table
- No records = empty history

---

### **Problem 2: Dual Refund Tracking**

**Scenario:** Create return with `payment_status = 1`

```
Current Flow:
├─ purchase_returns.payment_status = 1 ✅
├─ vendor_ledger: REFUND_RECEIVED entry ✅
├─ vendor_refunds: NONE ❌
└─ refund_allocations: NONE ❌

Result: Shows "Refunded" but refund history is empty!
```

**Why This Happens:**
- `POST /api/purchase-returns/vendor-return` creates ledger entry but NOT refund allocation records
- Refund history queries `refund_allocations` table
- No records = empty history

---

### **Problem 3: Bill-Specific Only Payments**

**Current Limitation:**
```javascript
// Can only pay against specific bills
POST /api/vendor-payments
{
  vendor_id: 5,
  payment_amount: 100000,
  allocations: [
    { purchase_id: 1, allocated_amount: 100000 }
  ]
}
```

**Missing Feature:**
```javascript
// Cannot make generic vendor payment
POST /api/vendor-payments
{
  vendor_id: 5,
  payment_amount: 100000,
  payment_type: 'DIRECT',
  allocations: []  // ← Validation fails!
}
```

**Use Cases Not Supported:**
- Advance payments to vendor
- Generic vendor account credits
- Pay now, allocate to bills later

---

## ✅ SECTION 3: THE FIX - INTEGRATED SYSTEM

### **Fix 1: Bridge Purchase Payment Gap**

#### **File:** `pages/api/purchases/index.ts` (POST handler)

**Location:** After ledger entry creation (around line 550)

```typescript
// ===== STEP 5: LEDGER OPERATIONS =====
await ledgerService.createPurchaseEntry({
  id: purchase.id,
  vendor_id: parseInt(vendor_id),
  invoice_no: purchase.invoice_no,
  invoice_date: Math.floor(invoiceDate),
  total: calculatedGrandTotal,
  fy: currentFy
})

if (payment_status === 1) {
  await ledgerService.createEntry({
    vendor_id: parseInt(vendor_id),
    transaction_date: Math.floor(invoiceDate),
    transaction_type: 'PAYMENT',
    reference_type: 'purchase',
    reference_id: purchase.id,
    reference_no: purchase.invoice_no.toString(),
    debit: 0,
    credit: calculatedGrandTotal,
    payment_mode: payment_mode,
    payment_status: 1,
    payment_date: Math.floor(invoiceDate),
    notes: `Payment made for purchase ${purchase.invoice_no}`,
    fy: currentFy
  })
}

// ✅ ADD THIS: Create payment allocation records
if (payment_status === 1) {
  // Create vendor_payments record
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
  
  // Create payment_allocations record
  await prisma.payment_allocations.create({
    data: {
      payment_id: payment.id,
      purchase_id: purchase.id,
      allocated_amount: calculatedGrandTotal,
      allocation_date: Math.floor(invoiceDate),
      notes: 'Allocated during purchase creation'
    }
  });
}
```

---

#### **File:** `pages/api/purchases/[id].ts` (PUT handler)

**Location:** In ledger handling section (after transaction, around line 750)

```typescript
// ===== LEDGER HANDLING WITH REVERSAL ENTRIES =====
const oldPaymentStatus = existingPurchase.payment_status
const newPaymentStatus = parsedPaymentStatus
const oldTotal = existingPurchase.total
const newTotal = result.total
const timestamp = new Date()?.toLocaleString('en-IN')

try {
  // Case 1: Changed from PAID to UNPAID (unmarking)
  if (oldPaymentStatus === 1 && newPaymentStatus === 0) {
    // FIRST: Create PAYMENT_REVERSAL to reverse the payment
    const paymentEntry = await prisma.vendor_ledger.findFirst({
      where: {
        reference_type: 'purchase',
        reference_id: purchaseId,
        transaction_type: 'PAYMENT'
      },
      orderBy: { id: 'desc' }
    })
    
    if (paymentEntry) {
      // Create REVERSAL entry (don't delete original!)
      await ledgerService.createEntry({
        vendor_id: existingPurchase.vendor_id,
        transaction_date: Math.floor(Date.now() / 1000),
        transaction_type: 'PAYMENT_REVERSAL',
        reference_type: 'purchase',
        reference_id: purchaseId,
        reference_no: existingPurchase.invoice_no.toString(),
        debit: paymentEntry.credit,
        credit: 0,
        payment_mode: existingPurchase.payment_mode,
        payment_status: 0,
        notes: `Payment reversed for purchase ${existingPurchase.invoice_no} - unmarked as unpaid on ${timestamp} for editing`,
        fy: existingPurchase.fy
      })
    }
    
    // ✅ ADD THIS: Delete payment allocation records
    const allocations = await prisma.payment_allocations.findMany({
      where: { purchase_id: purchaseId },
      select: { payment_id: true }
    });
    
    // Delete allocations
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
    
    // Handle amount change if it occurred when unmarking
    if (oldTotal !== newTotal) {
      const difference = newTotal - oldTotal
      
      await ledgerService.createEntry({
        vendor_id: existingPurchase.vendor_id,
        transaction_date: Math.floor(Date.now() / 1000),
        transaction_type: 'PURCHASE_ADJUSTMENT',
        reference_type: 'purchase',
        reference_id: purchaseId,
        reference_no: existingPurchase.invoice_no.toString(),
        debit: difference > 0 ? difference : 0,
        credit: difference < 0 ? Math.abs(difference) : 0,
        notes: `Purchase ${existingPurchase.invoice_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} on ${timestamp} (after unmarking)`,
        fy: existingPurchase.fy
      })
    }
  }

  // Case 2: Changed from UNPAID to PAID (marking as paid)
  if (oldPaymentStatus === 0 && newPaymentStatus === 1) {
    // FIRST: Handle amount change if it occurred before marking as paid
    if (oldTotal !== newTotal) {
      const difference = newTotal - oldTotal
      
      await ledgerService.createEntry({
        vendor_id: existingPurchase.vendor_id,
        transaction_date: Math.floor(Date.now() / 1000),
        transaction_type: 'PURCHASE_ADJUSTMENT',
        reference_type: 'purchase',
        reference_id: purchaseId,
        reference_no: existingPurchase.invoice_no.toString(),
        debit: difference > 0 ? difference : 0,
        credit: difference < 0 ? Math.abs(difference) : 0,
        notes: `Purchase ${existingPurchase.invoice_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} on ${timestamp} (before marking as paid)`,
        fy: existingPurchase.fy
      })
    }
    
    // SECOND: Check if this is a re-mark (was previously paid and reversed)
    const hasReversal = await prisma.vendor_ledger.findFirst({
      where: {
        reference_type: 'purchase',
        reference_id: purchaseId,
        transaction_type: 'PAYMENT_REVERSAL'
      }
    })
    
    const notes = hasReversal
      ? `Payment made for purchase ${existingPurchase.invoice_no} (re-marked as paid after editing on ${timestamp})`
      : `Payment made for purchase ${existingPurchase.invoice_no}`
    
    // THIRD: Create new PAYMENT entry with the new total
    await ledgerService.createEntry({
      vendor_id: existingPurchase.vendor_id,
      transaction_date: Math.floor(Date.now() / 1000),
      transaction_type: 'PAYMENT',
      reference_type: 'purchase',
      reference_id: purchaseId,
      reference_no: existingPurchase.invoice_no.toString(),
      debit: 0,
      credit: newTotal,
      payment_mode: parsedPaymentMode,
      payment_status: 1,
      payment_date: existingPurchase.invoice_date,
      notes: notes,
      fy: existingPurchase.fy
    })
    
    // ✅ ADD THIS: Create payment allocation records
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
  }

  // Rest of cases remain the same...
} catch (error) {
  console.error('Purchase Update - Failed to create ledger entries:', error);
}
```

---

### **Fix 2: Bridge Return Refund Gap**

#### **File:** `pages/api/purchase-returns/vendor-return.ts` (POST handler)

**Location:** After ledger entry creation (around line 280)

```typescript
// Create ledger entry for debit note (outside transaction)
await ledgerService.createDebitNoteEntry({
  id: result.id,
  vendor_id: parseInt(vendor_id),
  debit_note_no: debitNoteNo,
  return_date: returnDateTimestamp,
  total_amount: totalAmount,
  total_tax: totalTax,
  packing_forwarding_amount: packingForwardingAmount,
  freight_amount: freightAmount,
  fy: financialYear
})

// If refunded immediately, create refund received ledger entry
if (paymentStatusValue === 1) {
  await ledgerService.createEntry({
    vendor_id: parseInt(vendor_id),
    transaction_date: paymentDateValue || returnDateTimestamp,
    transaction_type: 'REFUND_RECEIVED',
    reference_type: 'purchase_return',
    reference_id: result.id,
    reference_no: debitNoteNo,
    debit: refundAmount,
    credit: 0,
    payment_mode: paymentModeValue,
    payment_status: 1,
    payment_date: paymentDateValue,
    notes: `Refund received for ${debitNoteNo}`,
    fy: financialYear
  })
}

// ✅ ADD THIS: Create refund allocation records
if (paymentStatusValue === 1) {
  // Create vendor_refunds record
  const refund = await prisma.vendor_refunds.create({
    data: {
      vendor_id: parseInt(vendor_id),
      refund_date: returnDateTimestamp,
      refund_amount: refundAmount,
      refund_mode: paymentModeValue,
      refund_type: 'RETURN_SPECIFIC',
      notes: `Refund for return ${debitNoteNo}`,
      fy: financialYear
    }
  });
  
  // Create refund_allocations record
  await prisma.refund_allocations.create({
    data: {
      refund_id: refund.id,
      return_id: result.id,
      allocated_amount: refundAmount,
      allocation_date: returnDateTimestamp,
      notes: 'Allocated during return creation'
    }
  });
}
```

---

### **Fix 3: Add Direct Payments (Optional - Future Enhancement)**

#### **File:** `lib/payment-allocation-service.ts`

```typescript
export async function validatePaymentAllocation(
  vendor_id: number,
  payment_amount: number,
  allocations: any[],
  payment_type: string = 'BILL_SPECIFIC'
) {
  // Allow empty allocations for DIRECT payments
  if (payment_type === 'DIRECT') {
    return { valid: true };
  }
  
  // Existing bill-specific validation
  if (!allocations || allocations.length === 0) {
    return {
      valid: false,
      errors: ['Allocations required for BILL_SPECIFIC payments']
    };
  }
  
  // ... rest of validation
}
```

#### **File:** `pages/api/vendor-payments/index.ts`

```typescript
async function handleCreatePayment(req, res) {
  const {
    vendor_id,
    payment_amount,
    payment_mode,
    payment_date,
    payment_type = 'BILL_SPECIFIC',
    notes,
    allocations,
    fy
  } = req.body;

  // Validate allocations
  const validation = await validatePaymentAllocation(
    vendor_id,
    payment_amount,
    allocations,
    payment_type  // ← Pass payment_type
  );

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: validation.errors
    });
  }

  // Create payment and allocations in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create payment record
    const payment = await tx.vendor_payments.create({
      data: {
        vendor_id,
        payment_date,
        payment_amount,
        payment_mode,
        payment_type,
        notes,
        fy: financialYear
      }
    });

    if (payment_type === 'DIRECT') {
      // No allocations - just create ledger entry
      await ledgerService.createEntry({
        vendor_id,
        transaction_date: payment_date,
        transaction_type: 'PAYMENT',
        reference_type: 'vendor_payment',
        reference_id: payment.id,
        reference_no: `VP-${payment.id}`,
        payment_mode,
        payment_status: 0, // Not allocated yet
        payment_date,
        debit: 0,
        credit: payment_amount,
        notes: `Direct payment ₹${payment_amount} to vendor account`,
        fy: financialYear
      });
      
      return { payment, allocations: [] };
    } else {
      // Existing bill-specific logic
      // ...
    }
  });

  return res.status(201).json({
    success: true,
    message: 'Payment created successfully',
    data: result
  });
}
```

---

## 📋 SECTION 4: IMPLEMENTATION CHECKLIST

### **Phase 1: Quick Fix (COMPLETED ✅)**
- [x] Hide "Mark as Paid" button when `payment_status = 1`
- [x] File: `pages/purchases/view/[id].tsx`

### **Phase 2: Bridge the Gap (REQUIRED)**

#### **2A: Purchase Payment Integration**
- [ ] Update `POST /api/purchases/index.ts`
  - [ ] Add payment_allocations creation after ledger entry
  - [ ] Test purchase creation with `payment_status = 1`
  - [ ] Verify payment history appears

- [ ] Update `PUT /api/purchases/[id].ts`
  - [ ] Add payment_allocations creation when marking as paid
  - [ ] Add payment_allocations deletion when unmarking
  - [ ] Test purchase edit (mark as paid/unpaid)
  - [ ] Verify payment history syncs correctly

#### **2B: Return Refund Integration**
- [ ] Update `POST /api/purchase-returns/vendor-return.ts`
  - [ ] Add refund_allocations creation after ledger entry
  - [ ] Test return creation with `payment_status = 1`
  - [ ] Verify refund history appears

### **Phase 3: Direct Payments (OPTIONAL - Future)**
- [ ] Update `lib/payment-allocation-service.ts`
  - [ ] Allow empty allocations for DIRECT type
- [ ] Update `POST /api/vendor-payments/index.ts`
  - [ ] Handle DIRECT payment type
  - [ ] Create ledger entry without allocations
- [ ] Create `POST /api/vendor-payments/[id]/allocate` endpoint
  - [ ] Allow later allocation to bills
- [ ] Update UI to support direct payments

### **Phase 4: Testing**
- [ ] Test purchase creation (paid)
- [ ] Test purchase edit (mark as paid)
- [ ] Test purchase edit (unmark as paid)
- [ ] Test return creation (refunded)
- [ ] Verify payment history shows correctly
- [ ] Verify refund history shows correctly
- [ ] Test ledger balance calculations

### **Phase 5: Migration (OPTIONAL)**
- [ ] Create script to backfill `payment_allocations` for existing paid purchases
- [ ] Create script to backfill `refund_allocations` for existing refunded returns
- [ ] Test migration on copy of production data
- [ ] Run migration on production

---

## 🎯 SECTION 5: EXPECTED RESULTS

### **After Phase 2A & 2B Implementation:**

#### **Purchase Payment Flow (FIXED):**
```
1. Create Purchase (Paid)
   ├─ purchase.payment_status = 1 ✅
   ├─ vendor_ledger: PURCHASE (Dr) + PAYMENT (Cr) ✅
   ├─ vendor_payments: Record created ✅
   └─ payment_allocations: Record created ✅

2. View Purchase
   ├─ Shows "Paid" status ✅
   └─ Payment history shows payment ✅

Result: All systems connected! ✅
```

#### **Return Refund Flow (FIXED):**
```
1. Create Return (Refunded)
   ├─ purchase_returns.payment_status = 1 ✅
   ├─ vendor_ledger: DEBIT_NOTE (Cr) + REFUND_RECEIVED (Dr) ✅
   ├─ vendor_refunds: Record created ✅
   └─ refund_allocations: Record created ✅

2. View Return
   ├─ Shows "Refunded" status ✅
   └─ Refund history shows refund ✅

Result: All systems connected! ✅
```

#### **Your Original Issue (RESOLVED):**
```
Before: Purchase shows "Paid" but payment history empty ❌
After:  Purchase shows "Paid" AND payment history shows payment ✅
```

---

## 📊 SECTION 6: UPDATED STATUS TRACKING

### **After Integration:**

| Status Field | Controlled By | Values | Meaning |
|-------------|---------------|--------|---------|
| `purchase.payment_status` | `payment_allocations` + manual | 0=Unpaid, 1=Paid, 2=Partial | Can be set manually OR via allocation |
| `purchase.return_status` | Return items | 0=None, 1=Partial, 2=Full | Auto-calculated from returns |
| `purchase_returns.status` | Manual tracking | 0=Incomplete, 1=Completed | Physical tracking (goods/money) |
| `purchase_returns.payment_status` | `refund_allocations` + manual | 0=Unpaid, 1=Refunded, 2=Partial | Can be set manually OR via allocation |

---

## 🚀 SECTION 7: FUTURE ENHANCEMENTS

### **1. Fully Automated Status (Phase 3+)**
- Remove manual `payment_status` setting
- Calculate ONLY from `payment_allocations`
- Prevents any disconnects

### **2. Direct Payments (Phase 3)**
- Pay vendor without allocating to bills
- Track vendor account balance
- Allocate later when bills arrive

### **3. Payment Reversal UI**
- Add "Reverse Payment" button
- Create reversal records (not delete)
- Complete audit trail

### **4. Bulk Payment Allocation**
- Select multiple unpaid bills
- Create single payment
- Auto-allocate across bills

---

## 📝 NOTES

### **Design Decisions:**

1. **Why not delete payment_allocations?**
   - Audit trail preservation
   - Can track payment history even after reversal
   - Matches existing ledger reversal pattern

2. **Why allow manual payment_status?**
   - Backward compatibility
   - Quick data entry during purchase creation
   - Bridge between old and new systems

3. **Why not require approval for returns?**
   - `status` field is for physical tracking (manual)
   - Software doesn't control physical goods movement
   - Confirmation happens during return creation

4. **Why keep bill-specific AND direct payments?**
   - Bill-specific: Most common use case
   - Direct: Advance payments, adjustments
   - Flexibility for different workflows

---

## ✅ SUCCESS CRITERIA

- [ ] Purchase created as "Paid" shows payment in history
- [ ] Purchase edited to "Paid" shows payment in history
- [ ] Purchase edited to "Unpaid" removes payment from history
- [ ] Return created as "Refunded" shows refund in history
- [ ] Ledger balance matches payment/refund allocations
- [ ] No orphaned payment_allocations or refund_allocations
- [ ] All existing functionality still works

---

**Document End**

**Next Steps:** Implement Phase 2A and 2B to fix the disconnected payment/refund tracking.
