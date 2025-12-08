# Payment Allocation System - Implementation Plan

**Document Version:** 1.0  
**Created:** December 7, 2025  
**Status:** 📋 PLANNING PHASE  
**Scope:** Vendor Payment Allocation with Partial Payments  

---

## 🎯 OBJECTIVE

Implement a comprehensive payment allocation system that allows:
1. **Partial Payments**: Track payments on bills (₹30k paid on ₹50k bill)
2. **Payment Allocation**: Allocate one payment to multiple bills
3. **Bill Tagging**: Pay vendor directly and tag which bills to apply payment to
4. **Payment Reversal**: Reverse payments with proper audit trail (no deletions)
5. **Bulk Payments**: Pay multiple vendors at once

---

## 📊 CURRENT STATE ANALYSIS

### **Existing Purchase Flow**:

```
POST /api/purchases (CREATE)
├─ Creates purchase record
├─ Creates purchase items
├─ Updates product stock (+qty)
├─ Creates bill_to record
├─ Creates PURCHASE ledger entry (Dr)
└─ If payment_status=1: Creates PAYMENT ledger entry (Cr)

GET /api/purchases (LIST)
├─ Fetches all purchases with pagination
├─ Joins with vendors, staff, bill_to
└─ Calculates item counts

GET /api/purchases/[id] (DETAIL)
├─ Fetches single purchase with items
├─ Shows return status per item
└─ Includes payment history (future)

PUT /api/purchases/[id] (UPDATE) ✅ ALREADY IMPLEMENTED
├─ Handles 8 edit scenarios with reversal entries
├─ PAID → UNPAID: Creates PAYMENT_REVERSAL
├─ UNPAID → PAID: Creates PAYMENT
├─ Amount changes: Creates PURCHASE_ADJUSTMENT + PAYMENT_ADJUSTMENT
└─ Blocks editing if fully returned
```

### **Existing Return Flow**:

```
POST /api/purchase-returns/vendor-return (CREATE)
├─ Creates return with debit note number
├─ Creates return items
├─ Updates product stock (-qty)
├─ Creates DEBIT_NOTE ledger entry (Cr)
├─ If payment_status=1: Creates REFUND_RECEIVED ledger entry (Dr)
└─ Updates purchase return_status (0/1/2)

GET /api/purchase-returns (LIST)
├─ Fetches all returns with pagination
└─ Joins with vendors

GET /api/purchase-returns/[id] (DETAIL)
├─ Fetches single return with items
└─ Shows all purchase items (not just returned)

PUT /api/purchase-returns/[id] (UPDATE) ✅ ALREADY IMPLEMENTED
├─ Blocks editing if payment_status=1 (refunded)
├─ Allows editing unpaid returns
└─ Updates stock and recalculates return_status
```

### **Current Ledger Transaction Types**:

| Type | When Used | Debit | Credit | Balance Impact |
|------|-----------|-------|--------|----------------|
| PURCHASE | Purchase created | ₹X | 0 | +₹X (owe more) |
| PAYMENT | Payment made | 0 | ₹X | -₹X (owe less) |
| PAYMENT_REVERSAL | Unmark as paid | ₹X | 0 | +₹X (owe again) |
| PURCHASE_ADJUSTMENT | Amount changed | ±₹diff | ±₹diff | ±₹diff |
| PAYMENT_ADJUSTMENT | Payment amount changed | ±₹diff | ±₹diff | ±₹diff |
| DEBIT_NOTE | Return created | 0 | ₹X | -₹X (owe less) |
| REFUND_RECEIVED | Refund received | ₹X | 0 | +₹X |

---

## 🚀 WHAT'S MISSING

### **Current Limitations**:

1. ❌ **No Partial Payment Tracking**
   - `payment_status` is binary (0=Unpaid, 1=Paid)
   - Can't track ₹30k paid on ₹50k bill
   - No payment history per bill

2. ❌ **No Payment Allocation**
   - Can't allocate ₹1L payment to 3 different bills
   - Can't see which payment paid which bill
   - No payment-to-bill relationship

3. ❌ **No Payment Management**
   - No dedicated payment records
   - No payment reversal (except unmark purchase)
   - No bulk payment entry

4. ❌ **No Payment Reports**
   - Can't see payment history
   - Can't track vendor payment summary
   - Can't analyze payment trends

---

## 🗄️ DATABASE SCHEMA DESIGN

### **New Tables**:

#### **1. vendor_payments**
Tracks all vendor payments (master payment records)

```sql
CREATE TABLE vendor_payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  vendor_id INT NOT NULL,
  payment_date INT NOT NULL,
  payment_amount DECIMAL(10,2) NOT NULL,
  payment_mode INT NOT NULL,  -- 0=Cash, 1=Bank
  payment_type VARCHAR(20) NOT NULL,  -- 'BILL_SPECIFIC' or 'DIRECT'
  notes TEXT,
  fy INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_vendor_payments_vendor (vendor_id),
  INDEX idx_vendor_payments_date (payment_date),
  INDEX idx_vendor_payments_fy (fy),
  
  FOREIGN KEY (vendor_id) REFERENCES vendor_details(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### **2. payment_allocations**
Tracks how payments are allocated to specific bills

```sql
CREATE TABLE payment_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  payment_id INT NOT NULL,
  purchase_id INT NOT NULL,
  allocated_amount DECIMAL(10,2) NOT NULL,
  allocation_date INT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_payment_allocations_payment (payment_id),
  INDEX idx_payment_allocations_purchase (purchase_id),
  
  FOREIGN KEY (payment_id) REFERENCES vendor_payments(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_id) REFERENCES purchase(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### **Purchase Table Update**:

```sql
-- No schema change needed!
-- payment_status will use new values:
-- 0 = Unpaid (no payments)
-- 1 = Paid (fully paid) - EXISTING, backward compatible
-- 2 = Partially Paid (some payment made) - NEW
```

### **Prisma Schema Updates**:

```prisma
model Purchase {
  // Existing fields...
  payment_status  Int?  // 0=Unpaid, 1=Paid, 2=Partially Paid
  allocations     payment_allocations[]
}

model vendor_payments {
  id              Int      @id @default(autoincrement())
  vendor_id       Int
  payment_date    Int
  payment_amount  Decimal  @db.Decimal(10,2)
  payment_mode    Int
  payment_type    String   @db.VarChar(20)
  notes           String?  @db.Text
  fy              Int
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  allocations     payment_allocations[]
  vendor          vendor_details @relation(fields: [vendor_id], references: [id])
  
  @@index([vendor_id])
  @@index([payment_date])
  @@index([fy])
  @@map("vendor_payments")
}

model payment_allocations {
  id               Int      @id @default(autoincrement())
  payment_id       Int
  purchase_id      Int
  allocated_amount Decimal  @db.Decimal(10,2)
  allocation_date  Int
  notes            String?  @db.Text
  created_at       DateTime @default(now())
  
  payment          vendor_payments @relation(fields: [payment_id], references: [id])
  purchase         Purchase        @relation(fields: [purchase_id], references: [id])
  
  @@index([payment_id])
  @@index([purchase_id])
  @@map("payment_allocations")
}
```

---

## 🔄 PAYMENT SCENARIOS

### **Scenario 1: Full Payment (Simple)**
```
Purchase INV-001: ₹50,000 (Unpaid)
Payment: ₹50,000

Result:
├─ vendor_payments: id=1, amount=50000
├─ payment_allocations: payment_id=1, purchase_id=1, amount=50000
├─ Purchase INV-001: payment_status=1 (Fully Paid)
└─ Ledger: PAYMENT (Cr ₹50,000)
```

### **Scenario 2: Partial Payment**
```
Purchase INV-001: ₹50,000 (Unpaid)
Payment: ₹30,000

Result:
├─ vendor_payments: id=2, amount=30000
├─ payment_allocations: payment_id=2, purchase_id=1, amount=30000
├─ Purchase INV-001: payment_status=2 (Partially Paid)
└─ Ledger: PAYMENT (Cr ₹30,000)
   Notes: "Partial payment ₹30,000 for bill INV-001 via Payment #2"
```

### **Scenario 3: Multiple Partial Payments**
```
Purchase INV-001: ₹50,000 (Unpaid)
Payment 1: ₹20,000
Payment 2: ₹30,000

Result:
├─ vendor_payments: id=3 (₹20k), id=4 (₹30k)
├─ payment_allocations: 
│  ├─ payment_id=3, purchase_id=1, amount=20000
│  └─ payment_id=4, purchase_id=1, amount=30000
├─ Purchase INV-001: payment_status=1 (Fully Paid after 2nd payment)
└─ Ledger:
   ├─ PAYMENT (Cr ₹20,000) via Payment #3
   └─ PAYMENT (Cr ₹30,000) via Payment #4
```

### **Scenario 4: One Payment, Multiple Bills**
```
Vendor Outstanding:
├─ INV-001: ₹40,000 (Unpaid)
├─ INV-002: ₹40,000 (Unpaid)
└─ INV-003: ₹40,000 (Unpaid)

Payment: ₹1,00,000 allocated as:
├─ INV-001: ₹40,000 (full)
├─ INV-002: ₹40,000 (full)
└─ INV-003: ₹20,000 (partial)

Result:
├─ vendor_payments: id=5, amount=100000
├─ payment_allocations:
│  ├─ payment_id=5, purchase_id=1, amount=40000
│  ├─ payment_id=5, purchase_id=2, amount=40000
│  └─ payment_id=5, purchase_id=3, amount=20000
├─ Purchase INV-001: payment_status=1 (Fully Paid)
├─ Purchase INV-002: payment_status=1 (Fully Paid)
├─ Purchase INV-003: payment_status=2 (Partially Paid - ₹20k of ₹40k)
└─ Ledger:
   ├─ PAYMENT (Cr ₹40,000) for INV-001 via Payment #5
   ├─ PAYMENT (Cr ₹40,000) for INV-002 via Payment #5
   └─ PAYMENT (Cr ₹20,000) for INV-003 via Payment #5 (partial)
```

### **Scenario 5: Payment Reversal**
```
Original: Payment #5 (₹1,00,000) allocated to 3 bills
Reverse: Payment #5

Result:
├─ vendor_payments: id=6, amount=-100000, type='REVERSAL'
├─ payment_allocations:
│  ├─ payment_id=6, purchase_id=1, amount=-40000
│  ├─ payment_id=6, purchase_id=2, amount=-40000
│  └─ payment_id=6, purchase_id=3, amount=-20000
├─ All purchases revert to unpaid/partial status
└─ Ledger:
   ├─ PAYMENT_REVERSAL (Dr ₹40,000) for INV-001
   ├─ PAYMENT_REVERSAL (Dr ₹40,000) for INV-002
   └─ PAYMENT_REVERSAL (Dr ₹20,000) for INV-003
```

---

## 🔧 PAYMENT STATUS CALCULATION

### **Helper Function**:

```typescript
async function calculatePaymentStatus(purchaseId: number): Promise<number> {
  // Get purchase total
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { total: true }
  })
  
  if (!purchase) return 0
  
  // Get total allocated to this purchase
  const allocations = await prisma.payment_allocations.aggregate({
    where: { purchase_id: purchaseId },
    _sum: { allocated_amount: true }
  })
  
  const totalPaid = allocations._sum.allocated_amount || 0
  const totalBill = purchase.total
  
  if (totalPaid === 0) {
    return 0 // Unpaid
  } else if (totalPaid >= totalBill) {
    return 1 // Fully Paid (keep existing value!)
  } else {
    return 2 // Partially Paid (new!)
  }
}
```

### **Usage**:

```typescript
// After creating payment allocation
const newStatus = await calculatePaymentStatus(purchaseId)

await prisma.purchase.update({
  where: { id: purchaseId },
  data: { payment_status: newStatus }
})
```

---

## 📋 API ENDPOINTS TO CREATE

### **1. POST /api/vendor-payments** (Create Payment)

**Purpose**: Create a payment and allocate to bills

**Request Body**:
```typescript
{
  vendor_id: 5,
  payment_amount: 100000,
  payment_mode: 1, // 0=Cash, 1=Bank
  payment_date: 1706140800,
  payment_type: 'DIRECT', // or 'BILL_SPECIFIC'
  notes: "Payment via bank transfer",
  allocations: [
    { purchase_id: 1, allocated_amount: 40000, notes: "" },
    { purchase_id: 2, allocated_amount: 40000, notes: "" },
    { purchase_id: 3, allocated_amount: 20000, notes: "" }
  ]
}
```

**Logic**:
1. Validate total allocation = payment amount
2. Create vendor_payments record
3. Create payment_allocations records
4. Update purchase payment_status for each bill
5. Create PAYMENT ledger entries

**Response**:
```typescript
{
  success: true,
  data: {
    payment: {
      id: 5,
      vendor_id: 5,
      amount: 100000,
      date: 1706140800,
      mode: 1,
      allocations: [...]
    }
  }
}
```

### **2. GET /api/vendor-payments** (List Payments)

**Purpose**: List all payments with filters

**Query Parameters**:
```
?vendor_id=5
&dateFrom=2025-01-01
&dateTo=2025-01-31
&payment_mode=1
&page=1
&limit=50
```

**Response**:
```typescript
{
  payments: [
    {
      id: 5,
      vendor_id: 5,
      vendor_name: "ABC Corp",
      payment_amount: 100000,
      payment_date: 1706140800,
      payment_mode: 1,
      payment_type: "DIRECT",
      allocations: [
        { purchase_id: 1, invoice_no: "INV-001", amount: 40000 },
        { purchase_id: 2, invoice_no: "INV-002", amount: 40000 },
        { purchase_id: 3, invoice_no: "INV-003", amount: 20000 }
      ]
    }
  ],
  pagination: { ... }
}
```

### **3. POST /api/vendor-payments/[id]/reverse** (Reverse Payment)

**Purpose**: Reverse a payment (with audit trail)

**Request Body**:
```typescript
{
  reason: "Payment error - need to correct allocation"
}
```

**Logic**:
1. Create reversal vendor_payments record (negative amount)
2. Create reversal payment_allocations (negative amounts)
3. Recalculate purchase payment_status
4. Create PAYMENT_REVERSAL ledger entries

**Response**:
```typescript
{
  success: true,
  message: "Payment reversed successfully",
  data: {
    reversal_payment_id: 6
  }
}
```

---

## 📝 IMPLEMENTATION CHECKLIST

### **Phase 1: Database Setup** (Day 1)
- [ ] Create SQL migration script for `vendor_payments` table
- [ ] Create SQL migration script for `payment_allocations` table
- [ ] Update Prisma schema with new models
- [ ] Run `npx prisma generate`
- [ ] Test database connection and relations

### **Phase 2: Helper Functions** (Day 1)
- [ ] Create `calculatePaymentStatus()` helper
- [ ] Create `getPaymentHistory()` helper
- [ ] Create `validatePaymentAllocation()` helper
- [ ] Test helper functions

### **Phase 3: Payment APIs** (Days 2-3)
- [ ] Implement `POST /api/vendor-payments` (create payment)
- [ ] Implement `GET /api/vendor-payments` (list payments)
- [ ] Implement `GET /api/vendor-payments/[id]` (payment details)
- [ ] Implement `POST /api/vendor-payments/[id]/reverse` (reverse payment)
- [ ] Test all payment APIs

### **Phase 4: Update Existing APIs** (Day 4)
- [ ] Update `GET /api/purchases/[id]` with payment info
- [ ] Update `GET /api/purchases` to show payment status correctly
- [ ] Test existing purchase APIs still work
- [ ] Update ledger service notes for allocations

### **Phase 5: Testing** (Day 5)
- [ ] Test full payment scenario
- [ ] Test partial payment scenario
- [ ] Test multiple partial payments
- [ ] Test one payment → multiple bills
- [ ] Test payment reversal
- [ ] Test ledger entries are correct
- [ ] Test payment status calculation
- [ ] Test backward compatibility (existing 0/1 values)

---

## 🧪 TESTING PLAN

### **Phase 1: Test Existing Ledger Entries** ⚡ START HERE!

Before implementing payment allocation, test that existing ledger entries work correctly:

#### **Test 1: Purchase Creation with Payment**
```
1. Create purchase: ₹50,000, payment_status=1 (paid)
2. Verify ledger entries:
   - PURCHASE (Dr ₹50,000)
   - PAYMENT (Cr ₹50,000)
3. Verify balance = ₹0
```

#### **Test 2: Purchase Edit (Paid → Unpaid)**
```
1. Edit purchase: change payment_status from 1 → 0
2. Verify ledger entries:
   - PAYMENT_REVERSAL (Dr ₹50,000)
3. Verify balance = ₹50,000
```

#### **Test 3: Purchase Edit (Amount Change While Paid)**
```
1. Edit purchase: change total from ₹50k → ₹60k (while paid)
2. Verify ledger entries:
   - PURCHASE_ADJUSTMENT (Dr ₹10,000)
   - PAYMENT_ADJUSTMENT (Cr ₹10,000)
3. Verify balance = ₹0
```

#### **Test 4: Return Creation with Refund**
```
1. Create return: ₹10,000, payment_status=1 (refunded)
2. Verify ledger entries:
   - DEBIT_NOTE (Cr ₹10,000)
   - REFUND_RECEIVED (Dr ₹10,000)
3. Verify balance = ₹0
```

#### **Test 5: Return Edit (Unpaid)**
```
1. Create return: ₹10,000, payment_status=0 (unpaid)
2. Edit return: change amount to ₹15,000
3. Verify ledger updated correctly
```

### **Phase 2: Test Payment Allocation** (After Implementation)

Test new payment allocation features:

#### **Test 6: Partial Payment**
```
1. Create payment: ₹30k on ₹50k bill
2. Verify payment_status = 2 (partial)
3. Verify ledger: PAYMENT (Cr ₹30k)
4. Verify balance = ₹20k
```

#### **Test 7: Multiple Payments to Same Bill**
```
1. Payment 1: ₹20k
2. Payment 2: ₹30k
3. Verify payment_status = 1 (fully paid after 2nd)
4. Verify ledger has 2 PAYMENT entries
5. Verify balance = ₹0
```

#### **Test 8: One Payment to Multiple Bills**
```
1. Payment: ₹1L allocated to 3 bills
2. Verify each bill's payment_status
3. Verify ledger has 3 PAYMENT entries
4. Verify vendor balance correct
```

#### **Test 9: Payment Reversal**
```
1. Reverse payment from Test 8
2. Verify reversal payment created
3. Verify bill statuses reverted
4. Verify ledger has PAYMENT_REVERSAL entries
5. Verify vendor balance restored
```

---

## ✅ SUCCESS CRITERIA

- [ ] Can create partial payments on bills
- [ ] Can allocate one payment to multiple bills
- [ ] Payment status automatically calculated (0/1/2)
- [ ] Ledger entries created correctly for all scenarios
- [ ] Payment reversal works with complete audit trail
- [ ] No data deletion - everything uses reversal entries
- [ ] Backward compatible (existing 0/1 values still work)
- [ ] All existing purchase/return APIs still work
- [ ] Complete payment history visible per bill
- [ ] Vendor payment summary reports accurate

---

## 📊 BENEFITS

1. **Accurate Financial Tracking**: Know exactly what's paid vs outstanding
2. **Flexible Payment Management**: Pay bills in installments or bulk
3. **Complete Audit Trail**: Every payment change tracked with reversals
4. **Better Cash Flow Management**: See partial payments and pending amounts
5. **Vendor Relationship Insights**: Track payment history per vendor
6. **Accounting Compliance**: Proper double-entry with no deletions

---

## 🚀 NEXT STEPS

**Immediate Action**:
1. ✅ Create this documentation file
2. 🔄 Test existing ledger entries (5 test cases)
3. ⏳ Fix any bugs found in existing implementation
4. ⏳ Implement payment allocation system
5. ⏳ Build UI screens (later phase)

**Current Status**: 📋 PLANNING COMPLETE - READY FOR TESTING

---

**Document History**:

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-07 | Initial documentation with complete implementation plan |
