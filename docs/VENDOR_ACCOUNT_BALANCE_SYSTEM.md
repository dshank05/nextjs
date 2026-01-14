# Vendor Account Balance System - Implementation Guide

**Document Version:** 1.0  
**Created:** January 11, 2026  
**Status:** 📋 READY FOR IMPLEMENTATION  
**Purpose:** Add vendor account balance tracking to support direct payments and credit management

---

## 🎯 OBJECTIVE

Enable vendors to have account balances by:
1. **Direct Payments** - Pay vendor without allocating to specific bills
2. **Credit Management** - Track unallocated payments as vendor credit
3. **Allocate Later** - Use vendor credit to pay future bills
4. **Negative Balance** - Track when vendor owes money back

---

## 📊 CURRENT LIMITATION

**What you CAN do:**
```
Pay ₹10,000 → Must allocate to Invoice #12 (₹10,000)
```

**What you CANNOT do:**
```
Pay ₹50,000 → Keep as vendor credit (no invoice allocation)
Later: Use credit to pay Invoice #12, #13, #14
```

---

## ✅ SOLUTION: ADD BALANCE FIELDS TO MASTER TABLES

### **Why This Approach?**
- ✅ No new tables needed
- ✅ Fast lookups (single query)
- ✅ Vendor data stays in one place
- ✅ Minimal schema changes
- ✅ Easy to maintain

---

## 🗄️ DATABASE CHANGES

### **Migration SQL:**

```sql
-- Add balance tracking fields to vendor_details
ALTER TABLE vendor_details
ADD COLUMN account_balance DECIMAL(10, 2) DEFAULT 0 COMMENT 'Current account balance',
ADD COLUMN total_paid DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payments made',
ADD COLUMN total_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payment allocations',
ADD COLUMN total_refunded DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refunds received',
ADD COLUMN total_refund_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refund allocations',
ADD COLUMN balance_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add index for balance queries
CREATE INDEX idx_vendor_balance ON vendor_details(account_balance);

-- Add balance tracking fields to customer_details
ALTER TABLE customer_details
ADD COLUMN account_balance DECIMAL(10, 2) DEFAULT 0 COMMENT 'Current account balance',
ADD COLUMN total_paid DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payments received',
ADD COLUMN total_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payment allocations',
ADD COLUMN total_refunded DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refunds given',
ADD COLUMN total_refund_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refund allocations',
ADD COLUMN balance_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add index for balance queries
CREATE INDEX idx_customer_balance ON customer_details(account_balance);
```

---

### **Prisma Schema Update:**

```prisma
model vendor_details {
  id                      Int     @id @default(autoincrement())
  vendor_name             String  @db.VarChar(255)
  // ... existing fields ...
  status                  String  @default("Active") @db.VarChar(20)
  tax_id                  String? @db.VarChar(50)
  
  // ✅ NEW BALANCE FIELDS
  account_balance         Decimal @default(0) @db.Decimal(10, 2)
  total_paid              Decimal @default(0) @db.Decimal(10, 2)
  total_allocated         Decimal @default(0) @db.Decimal(10, 2)
  total_refunded          Decimal @default(0) @db.Decimal(10, 2)
  total_refund_allocated  Decimal @default(0) @db.Decimal(10, 2)
  balance_updated_at      DateTime? @updatedAt
  
  purchases               Purchase[]
  returns                 purchase_returns[]
  payments                vendor_payments[]
  refunds                 vendor_refunds[]

  @@index([vendor_name], map: "idx_vendor_name")
  @@index([account_balance], map: "idx_vendor_balance")
}

model customer_details {
  id                      Int     @id @default(autoincrement())
  billing_name            String  @db.VarChar(200)
  // ... existing fields ...
  status                  String  @default("Active") @db.VarChar(20)
  
  // ✅ NEW BALANCE FIELDS
  account_balance         Decimal @default(0) @db.Decimal(10, 2)
  total_paid              Decimal @default(0) @db.Decimal(10, 2)
  total_allocated         Decimal @default(0) @db.Decimal(10, 2)
  total_refunded          Decimal @default(0) @db.Decimal(10, 2)
  total_refund_allocated  Decimal @default(0) @db.Decimal(10, 2)
  balance_updated_at      DateTime? @updatedAt
  
  customer_payments       customer_payments[]
  customer_refunds        customer_refunds[]
}
```

---

## 🔢 BALANCE FORMULA

```typescript
account_balance = total_paid - total_allocated - total_refunded + total_refund_allocated
```

**For Vendors:**
- `total_paid` = Money we paid to vendor
- `total_allocated` = Applied to purchase bills
- `total_refunded` = Money vendor returned to us
- `total_refund_allocated` = Applied to return bills
- **Positive balance** = We owe vendor (credit)
- **Negative balance** = Vendor owes us (debit)

---

## 🚨 IMPORTANT: NO CHANGES TO EXISTING QUERIES

### **Answer to User's Question:**

**Q: Do we have to update everywhere vendor_details is called or updated?**

**A: NO! Here's why:**

#### **1. SELECT Queries (Read Operations):**
```typescript
// Existing code - NO CHANGES NEEDED
const vendor = await prisma.vendor_details.findUnique({
  where: { id: vendorId },
  select: { vendor_name: true, contact_no: true }
});
```
✅ **Works as-is** - New fields have default values (0)
✅ **Optional** - Only select balance fields when needed

#### **2. INSERT Queries (Create Vendor):**
```typescript
// Existing code - NO CHANGES NEEDED
const vendor = await prisma.vendor_details.create({
  data: {
    vendor_name: "ABC Supplier",
    contact_no: "1234567890"
    // balance fields auto-default to 0
  }
});
```
✅ **Works as-is** - Database defaults handle new fields

#### **3. UPDATE Queries (Edit Vendor):**
```typescript
// Existing code - NO CHANGES NEEDED
await prisma.vendor_details.update({
  where: { id: vendorId },
  data: {
    vendor_name: "Updated Name",
    contact_no: "9876543210"
    // balance fields untouched
  }
});
```
✅ **Works as-is** - Only updates specified fields

---

### **ONLY Update Balance in These Specific Places:**

| Operation | Update Required | Location |
|-----------|----------------|----------|
| **Payment Created** | ✅ YES | `POST /api/vendor-payments` |
| **Payment Allocation Created** | ✅ YES | `POST /api/vendor-payments` |
| **Refund Created** | ✅ YES | `POST /api/vendor-refunds` |
| **Refund Allocation Created** | ✅ YES | `POST /api/vendor-refunds` |
| **Purchase Marked Paid** | ✅ YES | `POST /api/purchases` (paid)<br>`PUT /api/purchases/[id]` (mark paid) |
| **Purchase Unmarked** | ✅ YES | `PUT /api/purchases/[id]` (unmark) |
| **Return Marked Refunded** | ✅ YES | `POST /api/purchase-returns` (refunded)<br>`PUT /api/purchase-returns/[id]` (mark refunded) |
| **Return Unmarked** | ✅ YES | `PUT /api/purchase-returns/[id]` (unmark) |
| **Vendor List** | ❌ NO | Just SELECT balance fields |
| **Vendor Create** | ❌ NO | Auto-defaults to 0 |
| **Vendor Edit** | ❌ NO | Balance unchanged |

---

## 📋 IMPLEMENTATION CHECKLIST

### **Phase 1: Database Migration** (5 min)
- [ ] Create migration file: `scripts/add_vendor_customer_balance.sql`
- [ ] Add fields to `vendor_details` table
- [ ] Add fields to `customer_details` table
- [ ] Run migration on database
- [ ] Update `prisma/schema.prisma`
- [ ] Run `npx prisma generate` to update Prisma client

### **Phase 2: Balance Service** (15 min)
- [ ] Create `lib/vendor-balance-service.ts`
- [ ] Add `updateVendorBalance()` function
- [ ] Add `updateCustomerBalance()` function
- [ ] Add `getVendorBalance()` function
- [ ] Add `initializeVendorBalances()` function (for existing data)

### **Phase 3: Update Validation** (10 min)
- [ ] Update `lib/payment-allocation-service.ts`
- [ ] Modify `validatePaymentAllocation()` to accept `payment_type`
- [ ] Allow empty allocations for `DIRECT` payment type
- [ ] Modify `validateRefundAllocation()` to accept `refund_type`
- [ ] Allow empty allocations for `DIRECT` refund type

### **Phase 4: Update Payment APIs** (20 min)
- [ ] Update `POST /api/vendor-payments/index.ts`
  - [ ] Pass `payment_type` to validation
  - [ ] Handle empty allocations (DIRECT payments)
  - [ ] Call `updateVendorBalance()` after payment creation
- [ ] Update `POST /api/vendor-refunds/index.ts`
  - [ ] Pass `refund_type` to validation
  - [ ] Handle empty allocations (DIRECT refunds)
  - [ ] Call `updateVendorBalance()` after refund creation

### **Phase 5: Update Purchase APIs** (20 min)
- [ ] Update `POST /api/purchases/index.ts`
  - [ ] Call `updateVendorBalance()` when `payment_status = 1`
- [ ] Update `PUT /api/purchases/[id].ts`
  - [ ] Call `updateVendorBalance()` when marking as paid (0→1)
  - [ ] Call `updateVendorBalance()` when unmarking (1→0)

### **Phase 6: Update Return APIs** (15 min)
- [ ] Update `POST /api/purchase-returns/vendor-return.ts`
  - [ ] Call `updateVendorBalance()` when `payment_status = 1`
- [ ] Update `PUT /api/purchase-returns/[id].ts`
  - [ ] Call `updateVendorBalance()` when marking as refunded (0→1)
  - [ ] Call `updateVendorBalance()` when unmarking (1→0)

### **Phase 7: Add Allocation Endpoint** (15 min)
- [ ] Create `pages/api/vendor-payments/[id]/allocate.ts`
- [ ] Implement allocation logic
- [ ] Update vendor balance after allocation
- [ ] Update purchase payment_status

### **Phase 8: Display Balance** (10 min)
- [ ] Add balance to vendor list API response
- [ ] Add balance to vendor ledger page
- [ ] Show unallocated amount in payment history
- [ ] Add balance column to vendor table

### **Phase 9: Testing** (20 min)
- [ ] Test direct payment (no allocations)
- [ ] Test mixed payment (partial allocations)
- [ ] Test allocate later
- [ ] Test negative balance (overpayment)
- [ ] Test balance calculation accuracy
- [ ] Test existing vendor CRUD operations (should work unchanged)

---

## 🔧 CODE EXAMPLES

### **1. Balance Service (`lib/vendor-balance-service.ts`):**

```typescript
import { prisma } from './db';

/**
 * Update vendor account balance
 */
export async function updateVendorBalance(
  vendorId: number,
  updates: {
    total_paid?: number;
    total_allocated?: number;
    total_refunded?: number;
    total_refund_allocated?: number;
  }
) {
  // Get current values
  const vendor = await prisma.vendor_details.findUnique({
    where: { id: vendorId },
    select: {
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!vendor) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  // Calculate new values
  const newTotalPaid = Number(vendor.total_paid) + (updates.total_paid || 0);
  const newTotalAllocated = Number(vendor.total_allocated) + (updates.total_allocated || 0);
  const newTotalRefunded = Number(vendor.total_refunded) + (updates.total_refunded || 0);
  const newTotalRefundAllocated = Number(vendor.total_refund_allocated) + (updates.total_refund_allocated || 0);

  // Calculate balance
  const newBalance = newTotalPaid - newTotalAllocated - newTotalRefunded + newTotalRefundAllocated;

  // Update vendor
  await prisma.vendor_details.update({
    where: { id: vendorId },
    data: {
      total_paid: newTotalPaid,
      total_allocated: newTotalAllocated,
      total_refunded: newTotalRefunded,
      total_refund_allocated: newTotalRefundAllocated,
      account_balance: newBalance
    }
  });

  return newBalance;
}

/**
 * Get vendor balance
 */
export async function getVendorBalance(vendorId: number) {
  const vendor = await prisma.vendor_details.findUnique({
    where: { id: vendorId },
    select: {
      account_balance: true,
      total_paid: true,
      total_allocated: true,
      total_refunded: true,
      total_refund_allocated: true
    }
  });

  if (!vendor) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  return {
    balance: Number(vendor.account_balance),
    total_paid: Number(vendor.total_paid),
    total_allocated: Number(vendor.total_allocated),
    total_refunded: Number(vendor.total_refunded),
    total_refund_allocated: Number(vendor.total_refund_allocated),
    unallocated_payment: Number(vendor.total_paid) - Number(vendor.total_allocated),
    unallocated_refund: Number(vendor.total_refunded) - Number(vendor.total_refund_allocated)
  };
}
```

---

### **2. Update Payment API:**

```typescript
// In POST /api/vendor-payments/index.ts

// After creating payment and allocations
if (payment_type === 'DIRECT') {
  // Direct payment - no allocations
  await updateVendorBalance(vendor_id, {
    total_paid: payment_amount
  });
} else {
  // Bill-specific payment - has allocations
  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_amount, 0);
  
  await updateVendorBalance(vendor_id, {
    total_paid: payment_amount,
    total_allocated: totalAllocated
  });
}
```

---

### **3. Update Purchase API (Mark as Paid):**

```typescript
// In PUT /api/purchases/[id].ts

// After creating payment allocation records
await updateVendorBalance(existingPurchase.vendor_id, {
  total_paid: newTotal,
  total_allocated: newTotal
});
```

---

## 📊 EXPECTED RESULTS

### **Scenario 1: Direct Payment**
```
Action: Pay vendor ₹50,000 (no bill allocation)

Database Updates:
├─ vendor_payments: Created (payment_type = 'DIRECT')
├─ payment_allocations: NONE
├─ vendor_details.total_paid: +₹50,000
├─ vendor_details.total_allocated: +₹0
└─ vendor_details.account_balance: +₹50,000

Result: Vendor has ₹50,000 credit
```

### **Scenario 2: Allocate Later**
```
Action: Allocate ₹30,000 to Invoice #12

Database Updates:
├─ payment_allocations: Created
├─ purchase.payment_status: Updated to 1 (Paid)
├─ vendor_details.total_allocated: +₹30,000
└─ vendor_details.account_balance: -₹30,000 (now ₹20,000)

Result: ₹20,000 credit remaining
```

### **Scenario 3: Mixed Payment**
```
Action: Pay ₹100,000, allocate ₹60,000 to bills

Database Updates:
├─ vendor_payments: Created (payment_type = 'MIXED')
├─ payment_allocations: Created (₹60,000)
├─ vendor_details.total_paid: +₹100,000
├─ vendor_details.total_allocated: +₹60,000
└─ vendor_details.account_balance: +₹40,000

Result: ₹40,000 unallocated credit
```

---

## ⚡ PERFORMANCE

**Before (Runtime Calculation):**
```
4 aggregation queries per vendor = ~200-500ms
```

**After (Cached in Master Table):**
```
1 simple SELECT query = ~5-10ms
40-100x faster! ✅
```

---

## 🎯 SUCCESS CRITERIA

- [ ] Can make direct payments without bill allocation
- [ ] Can allocate vendor credit to bills later
- [ ] Balance updates automatically on all transactions
- [ ] Balance displayed in vendor list
- [ ] Balance displayed in vendor ledger
- [ ] Negative balance supported (vendor owes money)
- [ ] All existing vendor CRUD operations work unchanged
- [ ] Performance is fast (<10ms for balance lookup)

---

## 🚀 DEPLOYMENT STEPS

1. **Backup database** (always!)
2. **Run migration** to add balance fields
3. **Update Prisma schema** and generate client
4. **Deploy code changes** (balance service + API updates)
5. **Initialize balances** for existing vendors (run script)
6. **Test** with a few transactions
7. **Monitor** for any issues

---

**END OF DOCUMENT**
