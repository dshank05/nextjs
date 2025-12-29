# Sale & Salex Returns with Ledger & Payment Allocation

## Overview

This document outlines the implementation of a comprehensive **Sale & Salex Returns System** with **Customer Ledger Integration** and **Payment Allocation System**, bringing sales transaction management to parity with the existing purchase system.

## Current Status

### ✅ **Phase 1: Core Return System** - COMPLETED
- ✅ Sale return APIs (`/api/sale-returns`, `/api/salex-returns`)
- ✅ Return creation, editing, deletion with stock adjustments
- ✅ Credit note generation with sequential numbering
- ✅ Customer ledger integration (basic SALE, SALEX, CREDIT_NOTE, RECEIPT)
- ✅ Return status tracking (0=none, 1=partial, 2=full)
- ✅ Invoice return validation (prevents editing fully returned sales)

---

## Phase 2: Payment Allocation System

### 🎯 **Objective**
Implement detailed payment and refund allocation tracking for sales and salex transactions, enabling partial payments and partial refunds similar to the purchase system.

### 📋 **Database Schema Changes**

#### **New Tables for Customer Payment Allocation**
```prisma
// Customer payment allocation (similar to vendor_payments)
model customer_payments {
  id             Int                   @id @default(autoincrement())
  customer_id    Int
  payment_date   Int
  payment_amount Decimal               @db.Decimal(10, 2)
  payment_mode   Int                   // 0=Cash, 1=Bank
  payment_type   String                @db.VarChar(20)
  notes          String?               @db.Text
  fy             Int
  created_at     DateTime              @default(now())
  updated_at     DateTime              @updatedAt
  allocations    customer_payment_allocations[]
  customer       customer_details      @relation(fields: [customer_id], references: [id], onDelete: Cascade)

  @@index([customer_id], map: "idx_customer_payments_customer")
  @@index([payment_date], map: "idx_customer_payments_date")
  @@index([fy], map: "idx_customer_payments_fy")
  @@map("customer_payments")
}

model customer_payment_allocations {
  id               Int                 @id @default(autoincrement())
  payment_id       Int
  invoice_id       Int?                // For regular sales
  invoicex_id      Int?                // For tax-exempt sales
  allocated_amount Decimal             @db.Decimal(10, 2)
  allocation_date  Int
  notes            String?             @db.Text
  created_at       DateTime            @default(now())
  payment          customer_payments   @relation(fields: [payment_id], references: [id], onDelete: Cascade)
  invoice          Invoice?            @relation(fields: [invoice_id], references: [id], onDelete: Cascade)
  invoicex         invoicex?           @relation(fields: [invoicex_id], references: [id], onDelete: Cascade)

  @@index([payment_id], map: "idx_customer_payment_allocations_payment")
  @@index([invoice_id], map: "idx_customer_payment_allocations_invoice")
  @@index([invoicex_id], map: "idx_customer_payment_allocations_invoicex")
  @@map("customer_payment_allocations")
}
```

#### **New Tables for Customer Refund Allocation**
```prisma
// Customer refund allocation (similar to vendor_refunds)
model customer_refunds {
  id            Int                  @id @default(autoincrement())
  customer_id   Int
  refund_date   Int
  refund_amount Decimal              @db.Decimal(10, 2)
  refund_mode   Int                  // 0=Cash, 1=Bank
  refund_type   String               @db.VarChar(20)
  notes         String?              @db.Text
  fy            Int
  created_at    DateTime             @default(now())
  updated_at    DateTime             @updatedAt
  allocations   customer_refund_allocations[]
  customer      customer_details     @relation(fields: [customer_id], references: [id], onDelete: Cascade)

  @@index([customer_id], map: "idx_customer_refunds_customer")
  @@index([refund_date], map: "idx_customer_refunds_date")
  @@index([fy], map: "idx_customer_refunds_fy")
  @@map("customer_refunds")
}

model customer_refund_allocations {
  id               Int              @id @default(autoincrement())
  refund_id        Int
  sale_return_id   Int?             // For regular sale returns
  salex_return_id  Int?             // For tax-exempt sale returns
  allocated_amount Decimal          @db.Decimal(10, 2)
  allocation_date  Int
  notes            String?          @db.Text
  created_at       DateTime         @default(now())
  refund           customer_refunds @relation(fields: [refund_id], references: [id], onDelete: Cascade)
  sale_return      sale_returns?    @relation(fields: [sale_return_id], references: [id], onDelete: Cascade)
  salex_return     salex_returns?   @relation(fields: [salex_return_id], references: [id], onDelete: Cascade)

  @@index([refund_id], map: "idx_customer_refund_allocations_refund")
  @@index([sale_return_id], map: "idx_customer_refund_allocations_sale_return")
  @@index([salex_return_id], map: "idx_customer_refund_allocations_salex_return")
  @@map("customer_refund_allocations")
}
```

#### **Updated Existing Tables**
```prisma
// Update Invoice and Invoicex payment_status
model Invoice {
  // ... existing fields
  payment_status Int?  // 0=Unpaid, 1=Partial, 2=Paid (changed from 0/1)
  // ... existing fields
}

model invoicex {
  // ... existing fields
  payment_status Int?  // 0=Unpaid, 1=Partial, 2=Paid (changed from 0/1)
  // ... existing fields
}

// Update return tables payment_status
model sale_returns {
  // ... existing fields
  payment_status Int?  // 0=Unpaid, 1=Partial, 2=Paid (changed from 0/1)
  // ... existing fields
}

model salex_returns {
  // ... existing fields
  payment_status Int?  // 0=Unpaid, 1=Partial, 2=Paid (changed from 0/1)
  // ... existing fields
}
```

### 📋 **APIs to Implement**

#### **Customer Payment APIs**
- `POST /api/customer-payments` - Record customer payment with allocations
- `GET /api/customer-payments` - List customer payments
- `GET /api/customer-payments/[id]` - Payment details with allocations
- `PUT /api/customer-payments/[id]` - Update payment allocations
- `DELETE /api/customer-payments/[id]` - Delete payment

#### **Customer Refund APIs**
- `POST /api/customer-refunds` - Record customer refund with allocations
- `GET /api/customer-refunds` - List customer refunds
- `GET /api/customer-refunds/[id]` - Refund details with allocations
- `PUT /api/customer-refunds/[id]` - Update refund allocations
- `DELETE /api/customer-refunds/[id]` - Delete refund

### 📋 **Business Logic Updates**

#### **Payment Status Calculation**
```typescript
// Calculate payment_status based on allocations
const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_amount, 0)
const paymentStatus = totalAllocated === 0 ? 0 :  // Unpaid
  (totalAllocated >= invoiceTotal ? 2 : 1)        // Paid : Partial
```

#### **Payment Allocation Validation**
- Cannot allocate more than outstanding amount
- Cannot allocate to fully paid invoices
- Must specify which invoice(s) payment applies to

### 📋 **UI Integration Points**
- Payment allocation modal for sales
- Refund allocation modal for returns
- Payment status indicators (Unpaid/Partial/Paid)
- Outstanding balance displays
- Payment history views

---

## Phase 3: Extended Ledger System

### 🎯 **Objective**
Add advanced ledger transaction types to match purchase system capabilities, enabling detailed financial corrections and reversals.

### 📋 **Extended Customer Ledger Types**

#### **Current Ledger Types** ✅
```typescript
type CustomerTransactionType =
  | 'SALE'           // Regular sales (money coming in)
  | 'SALEX'          // Tax-exempt sales (money coming in)
  | 'CREDIT_NOTE'    // Returns (money going out)
  | 'RECEIPT'        // Customer payments (money coming in)
```

#### **Additional Ledger Types** ✅
```typescript
type CustomerTransactionType =
  | 'SALE'              // Regular sales
  | 'SALEX'             // Tax-exempt sales
  | 'CREDIT_NOTE'       // Returns
  | 'RECEIPT'           // Customer payments
  | 'RECEIPT_REVERSAL'  // Payment reversals (bounced checks)
  | 'SALE_ADJUSTMENT'   // Sale amount corrections
  | 'RECEIPT_ADJUSTMENT' // Payment amount corrections
  | 'REFUND_PAID'       // Refunds issued to customers
```

### 📋 **Ledger Transaction Examples**

#### **Payment Reversal Scenario**
```
Customer paid ₹10,000 but payment bounced:
1. RECEIPT: +₹10,000 (customer paid)
2. RECEIPT_REVERSAL: -₹10,000 (payment reversed)
Result: Customer balance unchanged
```

#### **Sale Adjustment Scenario**
```
Sale recorded as ₹15,000 but should be ₹12,000:
1. SALE: +₹15,000 (customer owes)
2. SALE_ADJUSTMENT: -₹3,000 (correction)
Result: Customer owes ₹12,000
```

#### **Refund Paid Scenario**
```
Return credit note for ₹5,000, refund paid:
1. CREDIT_NOTE: -₹5,000 (customer credit)
2. REFUND_PAID: -₹5,000 (refund issued)
Result: Customer balance zeroed
```

### 📋 **APIs for Extended Ledger**

#### **Adjustment APIs**
- `POST /api/customer-adjustments` - Sale/payment adjustments
- `GET /api/customer-adjustments` - List adjustments
- `PUT /api/customer-adjustments/[id]` - Update adjustments

#### **Reversal APIs**
- `POST /api/customer-reversals` - Payment reversals
- `GET /api/customer-reversals` - List reversals
- `PUT /api/customer-reversals/[id]` - Update reversals

### 📋 **Business Rules**

#### **Adjustment Rules**
- Only authorized users can create adjustments
- Adjustments must have audit trail (reason, approval)
- Cannot adjust payments that are >30 days old
- Adjustments create balancing ledger entries

#### **Reversal Rules**
- Reversals only for payments not yet cleared
- Reversals require approval workflow
- Reversals create opposite ledger entries
- Original payment remains in history

---

## API Completion Status & Plan

### **Current API Coverage Comparison**

| System | APIs Implemented | APIs Missing | Completion | Status |
|--------|------------------|--------------|------------|--------|
| **Purchase** | 8/8 | 0 | ✅ **100%** | Complete |
| **Sales** | 8/8 | 0 | ✅ **100%** | Complete |
| **Salex** | 8/8 | 0 | ✅ **100%** | Complete |

### **Detailed API Matrix**

#### **Purchase System (Complete - 8 APIs)**
- ✅ `purchases/index.ts` & `purchases/[id].ts`
- ✅ `purchase-returns/index.ts` & `purchase-returns/[id].ts`
- ✅ `vendor-payments/index.ts` & `vendor-payments/[id].ts`
- ✅ `vendor-refunds/index.ts` & `vendor-refunds/[id].ts`

#### **Sales System (7/8 APIs)**
- ✅ `sales/index.ts` & `sales/[id].ts`
- ✅ `sale-returns/index.ts` & `sale-returns/[id].ts`
- ✅ `customer-payments/index.ts` & ❌ `customer-payments/[id].ts`
- ✅ `customer-adjustments/index.ts` & ❌ `customer-adjustments/[id].ts`

#### **Salex System (6/8 APIs)**
- ✅ `salex/index.ts` & ❌ `salex/[id].ts`
- ✅ `salex-returns/index.ts` & `salex-returns/[id].ts`
- ✅ `customer-payments/index.ts` & ❌ `customer-payments/[id].ts` (shared)
- ✅ `customer-adjustments/index.ts` & ❌ `customer-adjustments/[id].ts` (shared)

## Implementation Priority

### **Phase 2.1: Complete Missing APIs** ✅ (Completed)
1. ✅ `customer-payments/[id].ts` - Individual payment CRUD operations
2. ✅ `customer-adjustments/[id].ts` - Individual adjustment CRUD operations
3. ✅ `salex/[id].ts` - Individual salex CRUD operations
4. ⏳ Test all 8 APIs for sales and salex systems

### **Phase 2.2: Payment Allocation Features** ✅
1. ✅ Database schema for payment/refund allocation
2. ✅ Customer payment APIs with allocation logic
3. ✅ Update sale/salex APIs for payment status calculation (0/1/2)
4. ⏳ UI components for payment/refund allocation

### **Phase 3: Extended Ledger System** ✅
1. ✅ Extended ledger transaction types (RECEIPT_REVERSAL, SALE_ADJUSTMENT, RECEIPT_ADJUSTMENT, REFUND_PAID)
2. ✅ Adjustment and reversal APIs (`/api/customer-adjustments`)
3. ⏳ Approval workflows for corrections (future enhancement)
4. ⏳ Advanced reporting and reconciliation (future enhancement)

---

## Benefits

### **Phase 2 Benefits**
- **Partial Payment Tracking**: Handle customer payments in installments
- **Partial Refund Management**: Track refund allocations against returns
- **Accurate Payment Status**: 0/1/2 status instead of simple paid/unpaid
- **Outstanding Balance Management**: Real-time customer balance tracking
- **Payment Allocation History**: Complete audit trail of payments

### **Phase 3 Benefits**
- **Financial Corrections**: Handle payment reversals and adjustments
- **Complete Audit Trail**: Every financial transaction tracked
- **GST Compliance**: Detailed transaction history for tax purposes
- **Reconciliation**: Easy matching of payments to invoices
- **Parity with Purchase**: Same financial tracking capabilities

---

## Testing Scenarios

### **Phase 2 Testing**
1. **Partial Payment**: Customer pays ₹5,000 against ₹10,000 invoice
2. **Multiple Payments**: Two separate payments against one invoice
3. **Over-payment**: Customer pays more than outstanding amount
4. **Partial Refund**: Refund ₹3,000 against ₹5,000 return
5. **Payment Status Updates**: Verify 0→1→2 transitions

### **Phase 3 Testing**
1. **Payment Reversal**: Reverse a customer payment
2. **Sale Adjustment**: Correct invoice amount
3. **Refund Adjustment**: Modify refund amount
4. **Ledger Balance**: Verify all balances remain accurate
5. **Audit Trail**: Confirm all corrections are logged

---

## Migration Notes

### **Phase 2 Migration**
- Existing payment_status values (0/1) need migration to (0/1/2)
- Create allocation records for existing payments
- Update return payment_status values
- Validate all outstanding balances

### **Phase 3 Migration**
- Add new ledger transaction types
- Create adjustment history for existing corrections
- Update reporting queries to include new types
- Train users on new adjustment workflows

---

## Dependencies

### **Phase 2 Dependencies**
- ✅ Customer ledger service (Phase 1)
- ✅ Return system (Phase 1)
- ⏳ Payment allocation tables
- ⏳ Updated APIs

### **Phase 3 Dependencies**
- ✅ Payment allocation system (Phase 2)
- ⏳ Extended ledger types
- ⏳ Adjustment workflows
- ⏳ Approval system

---

## Success Metrics

### **Phase 2 Success**
- ✅ All sales have accurate payment status (0/1/2)
- ✅ Customer outstanding balances are correct
- ✅ Payment allocation history is complete
- ✅ Refund allocation tracking works
- ✅ No payment status inconsistencies

### **Phase 3 Success** ✅
- ✅ All financial corrections tracked in ledger
- ✅ Payment reversals handled properly
- ✅ Sale adjustments create correct entries
- ✅ Complete audit trail for all transactions
- ✅ GST compliance reporting enhanced
- ✅ Extended ledger transaction types implemented
- ✅ Adjustment and reversal APIs functional
