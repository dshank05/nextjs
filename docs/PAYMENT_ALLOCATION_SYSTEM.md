# Payment & Refund Allocation System - Implementation Plan

**Document Version:** 2.0  
**Created:** December 7, 2025  
**Updated:** December 7, 2025  
**Status:** 🚧 IMPLEMENTATION IN PROGRESS  
**Scope:** Vendor Payment & Refund Allocation with Partial Payments/Refunds

---

## 🎯 OBJECTIVE

Implement a comprehensive **payment AND refund allocation system** that allows:

### **For Purchases (Money Out)**:
1. **Partial Payments**: Track payments on bills (₹30k paid on ₹50k bill)
2. **Payment Allocation**: Allocate one payment to multiple bills
3. **Bill Tagging**: Pay vendor directly and tag which bills to apply payment to
4. **Payment Reversal**: Reverse payments with proper audit trail (no deletions)
5. **Payment History**: Complete audit trail per purchase

### **For Returns (Money In)**:
1. **Partial Refunds**: Track refunds on returns (₹6k refunded on ₹10k return)
2. **Refund Allocation**: Allocate one refund to multiple returns
3. **Return Tagging**: Receive refund from vendor and tag which returns to apply to
4. **Refund Reversal**: Reverse refunds with proper audit trail (no deletions)
5. **Refund History**: Complete audit trail per return

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

### **New Tables** (4 tables total):

#### **1. vendor_payments** (Payments TO vendors)
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

#### **2. payment_allocations** (Link payments to bills)
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

#### **3. vendor_refunds** (Refunds FROM vendors)
Tracks all vendor refunds (master refund records)

```sql
CREATE TABLE vendor_refunds (
  id INT PRIMARY KEY AUTO_INCREMENT,
  vendor_id INT NOT NULL,
  refund_date INT NOT NULL,
  refund_amount DECIMAL(10,2) NOT NULL,
  refund_mode INT NOT NULL,  -- 0=Cash, 1=Bank
  refund_type VARCHAR(20) NOT NULL,  -- 'RETURN_SPECIFIC' or 'DIRECT'
  notes TEXT,
  fy INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_vendor_refunds_vendor (vendor_id),
  INDEX idx_vendor_refunds_date (refund_date),
  INDEX idx_vendor_refunds_fy (fy),
  
  FOREIGN KEY (vendor_id) REFERENCES vendor_details(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### **4. refund_allocations** (Link refunds to returns)
Tracks how refunds are allocated to specific returns

```sql
CREATE TABLE refund_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  refund_id INT NOT NULL,
  return_id INT NOT NULL,
  allocated_amount DECIMAL(10,2) NOT NULL,
  allocation_date INT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_refund_allocations_refund (refund_id),
  INDEX idx_refund_allocations_return (return_id),
  
  FOREIGN KEY (refund_id) REFERENCES vendor_refunds(id) ON DELETE CASCADE,
  FOREIGN KEY (return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### **Existing Tables - New Status Values**:

```sql
-- Purchase table: No schema change needed!
-- payment_status will use new values:
-- 0 = Unpaid (no payments)
-- 1 = Paid (fully paid) - EXISTING, backward compatible
-- 2 = Partially Paid (some payment made) - NEW

-- Purchase_returns table: No schema change needed!
-- payment_status will use new values:
-- 0 = Unpaid (no refund)
-- 1 = Fully Refunded - EXISTING, backward compatible
-- 2 = Partially Refunded (some refund received) - NEW
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

## 🔄 REFUND SCENARIOS

### **Scenario 6: Partial Refund on Return**
```
Return DN-001: ₹10,000 (Unpaid)
Refund: ₹6,000

Result:
├─ vendor_refunds: id=1, amount=6000
├─ refund_allocations: refund_id=1, return_id=7, amount=6000
├─ Return DN-001: payment_status=2 (Partially Refunded)
└─ Ledger: REFUND_RECEIVED (Dr ₹6,000)
   Notes: "Partial refund ₹6,000 for return DN-001 via Refund #1"

Vendor Balance: -₹10,000 + ₹6,000 = -₹4,000 (vendor still owes ₹4k)
```

### **Scenario 7: Multiple Refunds on Same Return**
```
Return DN-001: ₹10,000 (Unpaid)
Refund 1: ₹6,000
Refund 2: ₹4,000

Result:
├─ vendor_refunds: id=1 (₹6k), id=2 (₹4k)
├─ refund_allocations:
│  ├─ refund_id=1, return_id=7, amount=6000
│  └─ refund_id=2, return_id=7, amount=4000
├─ Return DN-001: payment_status=1 (Fully Refunded after 2nd)
└─ Ledger:
   ├─ REFUND_RECEIVED (Dr ₹6,000) via Refund #1
   └─ REFUND_RECEIVED (Dr ₹4,000) via Refund #2
```

### **Scenario 8: One Refund, Multiple Returns**
```
Outstanding Returns:
├─ DN-001: ₹5,000 (Unpaid)
├─ DN-002: ₹3,000 (Unpaid)
└─ DN-003: ₹4,000 (Unpaid)

Refund: ₹10,000 allocated as:
├─ DN-001: ₹5,000 (full)
├─ DN-002: ₹3,000 (full)
└─ DN-003: ₹2,000 (partial)

Result:
├─ vendor_refunds: id=2, amount=10000
├─ refund_allocations:
│  ├─ refund_id=2, return_id=7, amount=5000
│  ├─ refund_id=2, return_id=8, amount=3000
│  └─ refund_id=2, return_id=9, amount=2000
├─ Return DN-001: payment_status=1 (Fully Refunded)
├─ Return DN-002: payment_status=1 (Fully Refunded)
├─ Return DN-003: payment_status=2 (Partially Refunded - ₹2k of ₹4k)
└─ Ledger:
   ├─ REFUND_RECEIVED (Dr ₹5,000) for DN-001 via Refund #2
   ├─ REFUND_RECEIVED (Dr ₹3,000) for DN-002 via Refund #2
   └─ REFUND_RECEIVED (Dr ₹2,000) for DN-003 via Refund #2 (partial)
```

### **Scenario 9: Refund Reversal**
```
Original: Refund #2 (₹10,000) allocated to 3 returns
Reverse: Refund #2

Result:
├─ vendor_refunds: id=3, amount=-10000, type='REVERSAL'
├─ refund_allocations:
│  ├─ refund_id=3, return_id=7, amount=-5000
│  ├─ refund_id=3, return_id=8, amount=-3000
│  └─ refund_id=3, return_id=9, amount=-2000
├─ All returns revert to unpaid/partial status
└─ Ledger:
   ├─ REFUND_RECEIVED (negative - Cr ₹5,000) for DN-001
   ├─ REFUND_RECEIVED (negative - Cr ₹3,000) for DN-002
   └─ REFUND_RECEIVED (negative - Cr ₹2,000) for DN-003
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

## 🔧 REFUND STATUS CALCULATION

### **Helper Function**:

```typescript
async function calculateRefundStatus(returnId: number): Promise<number> {
  // Get return refund amount
  const returnRecord = await prisma.purchase_returns.findUnique({
    where: { id: returnId },
    select: { refund_amount: true }
  })
  
  if (!returnRecord) return 0
  
  // Get total allocated to this return
  const allocations = await prisma.refund_allocations.aggregate({
    where: { return_id: returnId },
    _sum: { allocated_amount: true }
  })
  
  const totalRefunded = allocations._sum.allocated_amount || 0
  const totalReturn = returnRecord.refund_amount
  
  if (totalRefunded === 0) {
    return 0 // Unpaid
  } else if (totalRefunded >= totalReturn) {
    return 1 // Fully Refunded (keep existing value!)
  } else {
    return 2 // Partially Refunded (new!)
  }
}
```

### **Usage**:

```typescript
// After creating refund allocation
const newStatus = await calculateRefundStatus(returnId)

await prisma.purchase_returns.update({
  where: { id: returnId },
  data: { payment_status: newStatus }
})
```

---

## 📋 API ENDPOINTS TO CREATE

### **PAYMENT APIs**:

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

### **4. POST /api/vendor-refunds** (Create Refund)

**Purpose**: Create a refund and allocate to returns

**Request Body**:
```typescript
{
  vendor_id: 5,
  refund_amount: 10000,
  refund_mode: 1, // 0=Cash, 1=Bank
  refund_date: 1706140800,
  refund_type: 'RETURN_SPECIFIC', // or 'DIRECT'
  notes: "Refund received via bank transfer",
  allocations: [
    { return_id: 7, allocated_amount: 5000, notes: "" },
    { return_id: 8, allocated_amount: 3000, notes: "" },
    { return_id: 9, allocated_amount: 2000, notes: "" }
  ]
}
```

**Logic**:
1. Validate total allocation = refund amount
2. Create vendor_refunds record
3. Create refund_allocations records
4. Update return payment_status for each return
5. Create REFUND_RECEIVED ledger entries

**Response**:
```typescript
{
  success: true,
  data: {
    refund: {
      id: 2,
      vendor_id: 5,
      amount: 10000,
      date: 1706140800,
      mode: 1,
      allocations: [...]
    }
  }
}
```

### **5. GET /api/vendor-refunds** (List Refunds)

**Purpose**: List all refunds with filters

**Query Parameters**:
```
?vendor_id=5
&dateFrom=2025-01-01
&dateTo=2025-01-31
&refund_mode=1
&page=1
&limit=50
```

**Response**:
```typescript
{
  refunds: [
    {
      id: 2,
      vendor_id: 5,
      vendor_name: "ABC Corp",
      refund_amount: 10000,
      refund_date: 1706140800,
      refund_mode: 1,
      refund_type: "RETURN_SPECIFIC",
      allocations: [
        { return_id: 7, debit_note_no: "DN-001", amount: 5000 },
        { return_id: 8, debit_note_no: "DN-002", amount: 3000 },
        { return_id: 9, debit_note_no: "DN-003", amount: 2000 }
      ]
    }
  ],
  pagination: { ... }
}
```

### **6. POST /api/vendor-refunds/[id]/reverse** (Reverse Refund)

**Purpose**: Reverse a refund (with audit trail)

**Request Body**:
```typescript
{
  reason: "Refund error - need to correct allocation"
}
```

**Logic**:
1. Create reversal vendor_refunds record (negative amount)
2. Create reversal refund_allocations (negative amounts)
3. Recalculate return payment_status
4. Create REFUND_RECEIVED ledger entries (reversed)

**Response**:
```typescript
{
  success: true,
  message: "Refund reversed successfully",
  data: {
    reversal_refund_id: 3
  }
}
```

---

## 📝 IMPLEMENTATION CHECKLIST

### **Phase 1: Database Setup** (Day 1)
- [ ] Create SQL migration script for all 4 tables
  - [ ] `vendor_payments` table
  - [ ] `payment_allocations` table
  - [ ] `vendor_refunds` table
  - [ ] `refund_allocations` table
- [ ] Update Prisma schema with new models
- [ ] Run `npx prisma generate`
- [ ] Run `npx prisma db push`
- [ ] Test database connection and relations

### **Phase 2: Helper Functions** (Day 1-2)
- [ ] Create `lib/payment-allocation-service.ts`
- [ ] Implement `calculatePurchasePaymentStatus()` helper
- [ ] Implement `calculateReturnRefundStatus()` helper
- [ ] Implement `validatePaymentAllocation()` helper
- [ ] Implement `validateRefundAllocation()` helper
- [ ] Implement `getPaymentHistory()` helper
- [ ] Implement `getRefundHistory()` helper
- [ ] Test all helper functions

### **Phase 3: New APIs - Payments** (Days 2-3)
- [ ] Implement `POST /api/vendor-payments` (create payment)
- [ ] Implement `GET /api/vendor-payments` (list payments)
- [ ] Implement `GET /api/vendor-payments/[id]` (payment details)
- [ ] Test payment APIs

### **Phase 4: New APIs - Refunds** (Days 3-4)
- [ ] Implement `POST /api/vendor-refunds` (create refund)
- [ ] Implement `GET /api/vendor-refunds` (list refunds)
- [ ] Implement `GET /api/vendor-refunds/[id]` (refund details)
- [ ] Test refund APIs

### **Phase 5: Update Existing APIs** (Days 4-5)
- [ ] Update `GET /api/purchases/[id]` with payment history
- [ ] Update `GET /api/purchases` to show payment status (0/1/2)
- [ ] Update `GET /api/purchase-returns/[id]` with refund history
- [ ] Update `GET /api/purchase-returns` to show refund status (0/1/2)
- [ ] Remove payment_status/mode/date from return creation API
- [ ] Test existing APIs still work

### **Phase 6: Frontend - New Screens** (Days 5-6)
- [ ] Create `pages/entry/vendor-payment.tsx` (payment entry screen)
- [ ] Create `pages/entry/vendor-refund.tsx` (refund entry screen)
- [ ] Create `pages/reports/payment-history.tsx` (payment report)
- [ ] Create `pages/reports/refund-history.tsx` (refund report)
- [ ] Add navigation menu items

### **Phase 7: Frontend - Update Existing** (Days 6-7)
- [ ] Update `pages/entry/purchasereturn-vendor-create.tsx`:
  - [ ] Remove payment_status, payment_mode, payment_date fields
  - [ ] Strengthen item quantity validation
  - [ ] Add visual indicators for available qty
- [ ] Update purchase detail view with payment history section
- [ ] Update return detail view with refund history section
- [ ] Update vendor outstanding reports

### **Phase 8: Testing** (Day 8)
**Payment Tests:**
- [ ] Test full payment scenario
- [ ] Test partial payment scenario
- [ ] Test multiple partial payments
- [ ] Test one payment → multiple bills
- [ ] Test payment status calculation (0/1/2)

**Refund Tests:**
- [ ] Test full refund scenario
- [ ] Test partial refund scenario
- [ ] Test multiple partial refunds
- [ ] Test one refund → multiple returns
- [ ] Test refund status calculation (0/1/2)

**Integration Tests:**
- [ ] Test ledger entries for all scenarios
- [ ] Test payment/refund reversal
- [ ] Test backward compatibility (existing 0/1 values)
- [ ] Test item validation (over-return prevention)

### **Phase 9: Documentation** (Day 8)
- [ ] Update API documentation
- [ ] Create user guide for payment entry
- [ ] Create user guide for refund entry
- [ ] Document all testing scenarios
- [ ] Update COMPLETE_TEST_SCENARIOS.md

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
