# Complete Sales & Salex Payment Allocation System Implementation

**Document Version:** 2.0
**Created:** December 28, 2025
**Updated:** December 28, 2025
**Scope:** Complete 6-screen system with full payment allocation, returns, refunds, and payments

---

## 🎯 OBJECTIVE

Implement a complete **Sales & Salex Payment Allocation System** that provides **100% parity with the purchase system**, including:

- **Payment Allocation**: Track partial payments against multiple invoices (like purchase system)
- **Return Management**: Item-level returns with stock adjustments
- **Refund Processing**: Allocate refunds against multiple returns (like purchase system)
- **Payment Status Tracking**: 0/1/2 status (Unpaid/Partial/Paid) with automatic calculation
- **Outstanding Balance Management**: Real-time balance tracking
- **Ledger Integration**: Complete audit trail matching purchase system

---

## 📊 SYSTEM ARCHITECTURE

### **Database Schema Updates Required**

#### **1. customer_payment_allocations** (Links payments to invoices - like payment_allocations)
```sql
CREATE TABLE customer_payment_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  payment_id INT NOT NULL,
  invoice_id INT NULL,        -- For regular sales
  invoicex_id INT NULL,       -- For tax-exempt sales
  allocated_amount DECIMAL(10,2) NOT NULL,
  allocation_date INT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_customer_payment_allocations_payment (payment_id),
  INDEX idx_customer_payment_allocations_invoice (invoice_id),
  INDEX idx_customer_payment_allocations_invoicex (invoicex_id),

  FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoice(id) ON DELETE CASCADE,
  FOREIGN KEY (invoicex_id) REFERENCES invoicex(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### **2. customer_refund_allocations** (Links refunds to returns - like refund_allocations)
```sql
CREATE TABLE customer_refund_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  refund_id INT NOT NULL,
  sale_return_id INT NULL,    -- For regular sale returns
  salex_return_id INT NULL,   -- For tax-exempt sale returns
  allocated_amount DECIMAL(10,2) NOT NULL,
  allocation_date INT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_customer_refund_allocations_refund (refund_id),
  INDEX idx_customer_refund_allocations_sale_return (sale_return_id),
  INDEX idx_customer_refund_allocations_salex_return (salex_return_id),

  FOREIGN KEY (refund_id) REFERENCES customer_refunds(id) ON DELETE CASCADE,
  FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (salex_return_id) REFERENCES salex_returns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### **3. Updated Payment Status Fields (like purchase system)**
```sql
-- Update invoice and invoicex tables (like purchase table)
ALTER TABLE invoice ADD COLUMN payment_status INT DEFAULT 0;    -- 0=Unpaid, 1=Paid, 2=Partial
ALTER TABLE invoicex ADD COLUMN payment_status INT DEFAULT 0;   -- 0=Unpaid, 1=Paid, 2=Partial

-- Update return tables (like purchase_returns table)
ALTER TABLE sale_returns ADD COLUMN payment_status INT DEFAULT 0;   -- 0=Unpaid, 1=Refunded, 2=Partial
ALTER TABLE salex_returns ADD COLUMN payment_status INT DEFAULT 0;  -- 0=Unpaid, 1=Refunded, 2=Partial
```

#### **4. Prisma Schema Updates**
```prisma
// Add to existing customer_payments model
model customer_payments {
  // ... existing fields
  allocations     customer_payment_allocations[]
}

// Add to existing customer_refunds model
model customer_refunds {
  // ... existing fields
  allocations     customer_refund_allocations[]
}

// Add new allocation models
model customer_payment_allocations {
  id               Int                 @id @default(autoincrement())
  payment_id       Int
  invoice_id       Int?                // For sales
  invoicex_id      Int?                // For salex
  allocated_amount Decimal             @db.Decimal(10,2)
  allocation_date  Int
  notes            String?             @db.Text
  created_at       DateTime            @default(now())

  payment          customer_payments   @relation(fields: [payment_id], references: [id])
  invoice          invoice?            @relation(fields: [invoice_id], references: [id])
  invoicex         invoicex?           @relation(fields: [invoicex_id], references: [id])

  @@index([payment_id])
  @@index([invoice_id])
  @@index([invoicex_id])
  @@map("customer_payment_allocations")
}

model customer_refund_allocations {
  id               Int                 @id @default(autoincrement())
  refund_id        Int
  sale_return_id   Int?                // For sale returns
  salex_return_id  Int?                // For salex returns
  allocated_amount Decimal             @db.Decimal(10,2)
  allocation_date  Int
  notes            String?             @db.Text
  created_at       DateTime            @default(now())

  refund           customer_refunds     @relation(fields: [refund_id], references: [id])
  sale_return      sale_returns?       @relation(fields: [sale_return_id], references: [id])
  salex_return     salex_returns?      @relation(fields: [salex_return_id], references: [id])

  @@index([refund_id])
  @@index([sale_return_id])
  @@index([salex_return_id])
  @@map("customer_refund_allocations")
}

// Update existing models
model invoice {
  // ... existing fields
  payment_status  Int?  // 0=Unpaid, 1=Paid, 2=Partial
  payment_allocations customer_payment_allocations[]
}

model invoicex {
  // ... existing fields
  payment_status  Int?  // 0=Unpaid, 1=Paid, 2=Partial
  payment_allocations customer_payment_allocations[]
}

model sale_returns {
  // ... existing fields
  payment_status  Int?  // 0=Unpaid, 1=Refunded, 2=Partial
  refund_allocations customer_refund_allocations[]
}

model salex_returns {
  // ... existing fields
  payment_status  Int?  // 0=Unpaid, 1=Refunded, 2=Partial
  refund_allocations customer_refund_allocations[]
}
```

---

## 📱 6 CORE SCREENS & API REQUIREMENTS

### **1. salereturn.tsx - Sale Return Management** 📦

**Purpose:** List all sales, enable return creation, track return status

**Current Status:** ✅ **Exists** (`pages/entry/salereturn.tsx`)

**Required API Updates:**

#### **GET /api/sales (Enhanced)**
```typescript
// Current: Basic sale listing
// Needed: Payment history, outstanding amounts, return status

Query Parameters:
- customer_id: Filter by customer
- payment_status: 0/1/2 (Unpaid/Partial/Paid)
- return_status: 0/1/2 (No return/Partial/Full return)
- dateFrom/dateTo: Date range
- outstanding_min/max: Filter by outstanding amount

Response Enhancement:
{
  sales: [{
    id, invoice_no, customer_name, total,
    payment_status: 0|1|2,           // NEW
    outstanding_amount: 5000,        // NEW
    return_status: 0|1|2,            // NEW
    total_allocated: 5000,           // NEW
    payment_allocations: [{...}],    // NEW
    return_count: 2                  // NEW
  }],
  pagination: {...}
}
```

#### **POST /api/sale-returns (Enhanced)**
```typescript
// Current: Basic return creation
// Needed: Full return option, credit note generation

Request Body Enhancement:
{
  invoice_id: 123,
  return_type: 'sale',  // 'sale' or 'salex'
  full_return: true,    // NEW: Full order return flag
  return_items: [       // For partial returns
    { product_id: 1, qty: 5, reason: "Damaged" }
  ],
  return_date: 1706140800,
  notes: "Full return processed"
}

// Response includes credit note number
{
  success: true,
  return: {
    id: 456,
    credit_note_no: "CN-001",
    total_refund: 10000
  }
}
```

**UI Features:**
- Filter by payment status (Unpaid/Partial/Paid)
- Filter by outstanding amount
- "Process Return" button for partial returns
- "Return Whole Order" button for full returns
- Payment allocation history display
- Outstanding balance indicators

---

### **2. salereturn-create.tsx - Item-Level Return Creation** 🛠️

**Purpose:** Create detailed returns with item selection, quantities, reasons

**Current Status:** ❌ **Missing** (`pages/entry/salereturn-create.tsx`)

**Required APIs:**

#### **GET /api/sales/[id] (Enhanced)**
```typescript
// Get sale details with items for return creation
Response:
{
  sale: {
    id, invoice_no, customer_name, total,
    items: [{
      id, product_id, product_name, qty: 10, rate: 100,
      returned_qty: 3,      // NEW: Already returned
      available_qty: 7      // NEW: Available for return
    }],
    payment_allocations: [...],  // NEW
    return_history: [...]        // NEW
  }
}
```

#### **POST /api/sale-returns (Item-Level)**
```typescript
Request Body:
{
  invoice_id: 123,
  return_items: [
    {
      product_id: 1,
      qty: 2,
      reason: "Wrong size",
      condition: "New"
    }
  ],
  return_date: 1706140800,
  notes: "Partial return for wrong items"
}

Response:
{
  success: true,
  return: {
    id: 456,
    credit_note_no: "CN-002",
    total_refund: 2000,
    items_returned: 2
  }
}
```

**UI Features:**
- Invoice selection or pre-filled from URL param
- Item table with checkboxes for return selection
- Quantity input with validation (can't exceed available)
- Reason dropdown (Damaged, Wrong Item, Changed Mind, etc.)
- Condition assessment (New, Used, Damaged)
- Automatic credit note generation
- Stock adjustment preview

---

### **3. salexreturn.tsx - Salex Return Management** 📦

**Purpose:** List all salex transactions, enable return creation, track return status

**Current Status:** ❌ **Missing** (`pages/entry/salexreturn.tsx`)

**Required API Updates:**

#### **GET /api/salex (Enhanced)**
```typescript
// Similar to sales but for salex
Query Parameters: Same as sales API
Response: Same structure but for salex transactions
```

#### **POST /api/salex-returns (Enhanced)**
```typescript
// Similar to sale-returns but for salex
Request Body: Same structure as sale-returns
```

**UI Features:**
- Identical to salereturn.tsx but for salex transactions
- Tax-exempt indicators
- Same filtering and action capabilities

---

### **4. salexreturn-create.tsx - Salex Item-Level Return Creation** 🛠️

**Purpose:** Create detailed salex returns with item selection

**Current Status:** ❌ **Missing** (`pages/entry/salexreturn-create.tsx`)

**Required APIs:**

#### **GET /api/salex/[id] (Enhanced)**
```typescript
// Similar to sales/[id] but for salex
Response: Same structure but for salex transaction
```

#### **POST /api/salex-returns (Item-Level)**
```typescript
// Similar to sale-returns but for salex
Request Body: Same structure as sale-returns
```

**UI Features:**
- Identical to salereturn-create.tsx but for salex
- Tax-exempt calculations
- Same item selection and validation

---

### **5. customer-payment.tsx - Customer Payment Allocation** 💰

**Purpose:** Record customer payments and allocate to multiple invoices

**Current Status:** ❌ **Missing** (`pages/entry/customer-payment.tsx`)

**Required APIs:**

#### **GET /api/customers/[id]/outstanding (New)**
```typescript
// Get customer's outstanding invoices
Response:
{
  customer: { id, name, total_outstanding: 25000 },
  outstanding_invoices: [
    {
      id, invoice_no, type: 'sale'|'salex',
      total: 10000, outstanding: 5000,
      due_date: 1706140800
    }
  ]
}
```

#### **POST /api/customer-payments (Enhanced)**
```typescript
Request Body:
{
  customer_id: 123,
  payment_amount: 15000,
  payment_mode: 1,  // 0=Cash, 1=Bank
  payment_date: 1706140800,
  notes: "Payment via bank transfer",
  allocations: [
    { invoice_id: 456, allocated_amount: 10000 },
    { invoicex_id: 789, allocated_amount: 5000 }
  ]
}

Response:
{
  success: true,
  payment: {
    id: 101,
    payment_no: "PAY-001",
    total_allocated: 15000,
    allocations_count: 2
  }
}
```

#### **GET /api/customer-payments (Enhanced)**
```typescript
// List payments with allocation details
Response:
{
  payments: [{
    id, payment_no, customer_name, payment_amount,
    payment_date, payment_mode, total_allocated,
    allocations: [
      { invoice_no: "INV-001", amount: 10000, type: 'sale' }
    ]
  }],
  pagination: {...}
}
```

**UI Features:**
- Customer selection with outstanding balance display
- Payment amount input
- Outstanding invoices table with checkboxes
- Auto-allocation button (oldest first)
- Manual allocation with amount inputs
- Payment mode selection (Cash/Bank)
- Allocation validation (can't exceed outstanding)
- Real-time balance updates

---

### **6. customer-refund.tsx - Customer Refund Processing** 💸

**Purpose:** Record customer refunds and allocate to multiple returns

**Current Status:** ❌ **Missing** (`pages/entry/customer-refund.tsx`)

**Required APIs:**

#### **GET /api/customers/[id]/pending-refunds (New)**
```typescript
// Get customer's pending refunds (returns not yet refunded)
Response:
{
  customer: { id, name, total_pending_refund: 15000 },
  pending_returns: [
    {
      id, return_no, type: 'sale'|'salex',
      refund_amount: 8000, outstanding_refund: 5000
    }
  ]
}
```

#### **POST /api/customer-refunds (Enhanced)**
```typescript
Request Body:
{
  customer_id: 123,
  refund_amount: 10000,
  refund_mode: 1,  // 0=Cash, 1=Bank
  refund_date: 1706140800,
  notes: "Refund for returned items",
  allocations: [
    { sale_return_id: 456, allocated_amount: 6000 },
    { salex_return_id: 789, allocated_amount: 4000 }
  ]
}

Response:
{
  success: true,
  refund: {
    id: 201,
    refund_no: "REF-001",
    total_allocated: 10000,
    allocations_count: 2
  }
}
```

#### **GET /api/customer-refunds (Enhanced)**
```typescript
// List refunds with allocation details
Response:
{
  refunds: [{
    id, refund_no, customer_name, refund_amount,
    refund_date, refund_mode, total_allocated,
    allocations: [
      { return_no: "CN-001", amount: 6000, type: 'sale' }
    ]
  }],
  pagination: {...}
}
```

**UI Features:**
- Customer selection with pending refund display
- Refund amount input
- Pending returns table with checkboxes
- Auto-allocation button
- Manual allocation with amount inputs
- Refund mode selection (Cash/Bank)
- Allocation validation (can't exceed refund amount)
- Real-time refund balance updates

---

## 🔧 BUSINESS LOGIC IMPLEMENTATION

### **Payment Status Calculation (0/1/2)**

#### **For Sales/Invoices:**
```typescript
function calculatePaymentStatus(invoiceId: number, type: 'sale'|'salex'): number {
  // Get invoice total
  const invoice = type === 'sale'
    ? await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { total: true } })
    : await prisma.invoicex.findUnique({ where: { id: invoiceId }, select: { total: true } });

  if (!invoice) return 0;

  // Get total allocated payments
  const allocations = type === 'sale'
    ? await prisma.customer_payment_allocations.aggregate({
        where: { invoice_id: invoiceId },
        _sum: { allocated_amount: true }
      })
    : await prisma.customer_payment_allocations.aggregate({
        where: { invoicex_id: invoiceId },
        _sum: { allocated_amount: true }
      });

  const totalPaid = allocations._sum.allocated_amount || 0;
  const totalAmount = invoice.total;

  if (totalPaid === 0) return 0;        // Unpaid
  if (totalPaid >= totalAmount) return 1; // Fully Paid
  return 2;                             // Partially Paid
}
```

#### **For Returns/Refunds:**
```typescript
function calculateRefundStatus(returnId: number, type: 'sale'|'salex'): number {
  // Get return refund amount
  const returnRecord = type === 'sale'
    ? await prisma.sale_returns.findUnique({ where: { id: returnId }, select: { refund_amount: true } })
    : await prisma.salex_returns.findUnique({ where: { id: returnId }, select: { refund_amount: true } });

  if (!returnRecord) return 0;

  // Get total allocated refunds
  const allocations = type === 'sale'
    ? await prisma.customer_refund_allocations.aggregate({
        where: { sale_return_id: returnId },
        _sum: { allocated_amount: true }
      })
    : await prisma.customer_refund_allocations.aggregate({
        where: { salex_return_id: returnId },
        _sum: { allocated_amount: true }
      });

  const totalRefunded = allocations._sum.allocated_amount || 0;
  const totalRefund = returnRecord.refund_amount;

  if (totalRefunded === 0) return 0;        // Unpaid
  if (totalRefunded >= totalRefund) return 1; // Fully Refunded
  return 2;                                 // Partially Refunded
}
```

### **Outstanding Amount Calculation**
```typescript
function getOutstandingAmount(invoiceId: number, type: 'sale'|'salex'): number {
  const totalAmount = getInvoiceTotal(invoiceId, type);
  const totalPaid = getTotalAllocatedPayments(invoiceId, type);
  return Math.max(0, totalAmount - totalPaid);
}
```

---

## 📋 IMPLEMENTATION CHECKLIST

### **Phase 1: Database & Core APIs** ⏳
- [ ] Create customer_payment_allocations table
- [ ] Create customer_refund_allocations table
- [ ] Update payment_status fields in invoice/invoicex/return tables
- [ ] Update Prisma schema and generate client
- [ ] Implement payment/refund status calculation functions
- [ ] Update existing sales/salex APIs with payment history
- [ ] Update existing return APIs with refund history

### **Phase 2: Enhanced APIs** ⏳
- [ ] Enhance customer-payments API with allocation logic
- [ ] Enhance customer-refunds API with allocation logic
- [ ] Add outstanding balance APIs
- [ ] Add payment/refund allocation validation
- [ ] Test all API enhancements

### **Phase 3: UI Screens** ⏳
- [ ] Create salereturn-create.tsx (item-level returns)
- [ ] Create salexreturn.tsx (salex return management)
- [ ] Create salexreturn-create.tsx (salex item returns)
- [ ] Create customer-payment.tsx (payment allocation)
- [ ] Create customer-refund.tsx (refund processing)
- [ ] Update navigation with new menu items

### **Phase 4: Integration & Testing** ⏳
- [ ] Integrate all screens with APIs
- [ ] Test payment allocation workflows
- [ ] Test refund allocation workflows
- [ ] Test return creation workflows
- [ ] Test status calculations (0/1/2)
- [ ] Test outstanding balance updates

---

## 🎯 SUCCESS CRITERIA

### **Complete System When:**
- [ ] All 6 screens implemented and functional
- [ ] Payment allocation works across multiple invoices
- [ ] Refund allocation works across multiple returns
- [ ] Payment status automatically updates (0/1/2)
- [ ] Outstanding balances calculate correctly
- [ ] Return creation updates stock and generates credit notes
- [ ] Ledger entries created for all transactions
- [ ] No data inconsistencies in payment/refund tracking

### **User Experience:**
- [ ] Intuitive payment allocation interface
- [ ] Clear outstanding balance displays
- [ ] Easy return creation with item selection
- [ ] Comprehensive payment/refund history
- [ ] Real-time validation and feedback

---

## 🚀 NEXT STEPS

**Immediate Actions:**
1. ✅ Create this implementation plan
2. ⏳ Implement database schema updates
3. ⏳ Update existing APIs with allocation support
4. ⏳ Create the 6 UI screens
5. ⏳ Test complete payment allocation system

**This plan provides the complete blueprint for a production-ready sales/salex payment allocation system!** 🎉
