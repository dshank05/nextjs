# Complete Sale/Salex System Operations Analysis

**Document Version:** 1.0  
**Created:** [Current Date]  
**Status:** 📊 COMPREHENSIVE ANALYSIS  
**Purpose:** Document all Sale/Salex APIs, identify implementation gaps, and provide refactoring roadmap

---

## 🎯 THE 4 SYSTEMS (Customer Side)

### **System 1: INVENTORY**
- **Updates:** `product.stock`
- **Operations:** DECREMENT (sale), INCREMENT (return)
- **Triggers:** Sale create/edit, Return create/edit/delete

### **System 2: LEDGER**
- **Updates:** `customer_ledger`
- **Entry Types:** SALE, CREDIT_NOTE, PAYMENT_RECEIVED, REFUND, PAYMENT_REVERSAL, REFUND_REVERSAL, SALE_ADJUSTMENT, PAYMENT_ADJUSTMENT
- **Triggers:** All transaction operations

### **System 3: PAYMENT ALLOCATION**
- **Updates:** `customer_payments`, `customer_payment_allocations`, `customer_refunds`, `customer_refund_allocations`
- **Status Updates:** `invoice.payment_status`, `invoicex.payment_status`, `sale_returns.payment_status`, `salex_returns.payment_status`
- **Triggers:** Payment create, Refund create, Sale/Return status changes

### **System 4: BALANCE UPDATE**
- **Updates:** `customer_details.total_paid`, `total_allocated`, `total_refunded`, `total_refund_allocated`, `account_balance`
- **Formula:** `account_balance = total_paid - total_allocated - total_refunded + total_refund_allocated`
- **Triggers:** Payment/Refund operations, Sale/Return status changes

---

## 📊 PARALLEL STRUCTURE COMPARISON

| **Purchase (Vendor)** | **Sale (Customer)** | **Salex (Customer)** |
|----------------------|---------------------|----------------------|
| `purchase` | `invoice` | `invoicex` |
| `purchase_items` | `invoice_items` | `invoice_itemsx` |
| `purchase_returns` | `sale_returns` | `salex_returns` |
| `purchase_return_items` | `sale_return_items` | `salex_return_items` |
| `vendor_payments` | `customer_payments` | `customer_payments` |
| `payment_allocations` | `customer_payment_allocations` | `customer_payment_allocations` |
| `vendor_refunds` | `customer_refunds` | `customer_refunds` |
| `refund_allocations` | `customer_refund_allocations` | `customer_refund_allocations` |
| `vendor_details` | `customer_details` | `customer_details` |
| `vendor_ledger` | `customer_ledger` | `customer_ledger` |

---

## 📋 API INVENTORY

### **SALE OPERATIONS (Invoice)**
1. Sale Create (`POST /api/sales/index.ts`)
2. Sale Edit (`PUT /api/sales/[id].ts`)
3. Sale Get (`GET /api/sales/[id].ts`)

### **SALEX OPERATIONS (Invoicex)**
4. Salex Create (`POST /api/salex/index.ts`)
5. Salex Edit (`PUT /api/salex/[id].ts`)
6. Salex Get (`GET /api/salex/[id].ts`)

### **SALE RETURN OPERATIONS**
7. Sale Return Create (`POST /api/sale-returns/index.ts`)
8. Sale Return Edit (`PUT /api/sale-returns/[id].ts`)
9. Sale Return Get (`GET /api/sale-returns/[id].ts`)
10. Sale Return Delete (`DELETE /api/sale-returns/[id].ts`)
11. Sale Return Customer Items (`GET /api/sale-returns/customer-items.ts`)

### **CUSTOMER PAYMENT OPERATIONS**
12. Customer Payment Create (`POST /api/customer-payments/index.ts`)
13. Customer Payment Edit (`PUT /api/customer-payments/[id].ts`)
14. Customer Payment Get (`GET /api/customer-payments/[id].ts`)
15. Customer Payment Delete (`DELETE /api/customer-payments/[id].ts`)

### **CUSTOMER REFUND OPERATIONS**
16. Customer Refund Create (`POST /api/customer-refunds/index.ts`)
17. Customer Refund Edit (Not implemented yet)
18. Customer Refund Delete (Not implemented yet)

---

## 🔧 REQUIRED HANDLER FILES

To mirror the purchase system, we need to create customer-side handlers:

### **1. customer-balance-handler.ts** (NEW)
```typescript
export class CustomerBalanceHandler {
  // Get balance operations for sale/salex creation with payment
  getCreateBalanceOps(params): BalanceOperation | null
  
  // Get balance operations for sale status changes
  getSaleBalanceOps(changes: ChangeSet): BalanceOperation | null
  
  // Get balance operations for return status changes
  getReturnBalanceOps(changes: ChangeSet): BalanceOperation | null
  
  // Update customer balance INSIDE transaction
  updateBalanceInTransaction(tx, customerId, updates): Promise<void>
  
  // Optimized balance update using Prisma increment
  incrementBalanceInTransaction(tx, customerId, updates, source?): Promise<void>
}
```

### **2. customer-transaction-handler.ts** (NEW)
```typescript
export class CustomerTransactionHandler {
  // Handle sale edit transaction
  async handleSaleEdit(params): Promise<TransactionResult>
  
  // Handle return edit transaction
  async handleReturnEdit(params): Promise<TransactionResult>
  
  // Handle customer payment edit transaction
  async handleCustomerPaymentEdit(params): Promise<TransactionResult>
  
  // Handle customer refund edit transaction
  async handleCustomerRefundEdit(params): Promise<TransactionResult>
  
  // Handle sale deletion
  async handleSaleDelete(params): Promise<DeleteResult>
  
  // Handle return deletion
  async handleReturnDelete(params): Promise<DeleteResult>
  
  // Handle payment deletion
  async handlePaymentDelete(params): Promise<DeleteResult>
  
  // Handle refund deletion
  async handleRefundDelete(params): Promise<DeleteResult>
  
  // Execute all operations within a transaction
  async executeInTransaction(tx, result): Promise<void>
  
  // Execute DELETE operations within a transaction
  async executeDeleteInTransaction(tx, result): Promise<void>
}
```

### **3. customer-ledger-handler.ts** (NEW)
```typescript
export class CustomerLedgerHandler {
  // Get ledger operations for sale status changes
  getSaleLedgerOps(changes: ChangeSet): {
    creates: LedgerOperation[];
    updates: LedgerUpdateOperation[];
    deletes: LedgerDeleteOperation[];
  }
  
  // Get ledger operations for return status changes
  getReturnLedgerOps(changes: ChangeSet): {
    creates: LedgerOperation[];
    updates: LedgerUpdateOperation[];
    deletes: LedgerDeleteOperation[];
  }
}
```

### **4. customer-ledger-service.ts** (Extend existing)
```typescript
// Add customer ledger methods to existing customer-ledger-service.ts
export class CustomerLedgerService {
  async createEntry(entry: LedgerEntryData, tx?: any): Promise<void>
  async getLatestBalance(customerId: number, tx?: any): Promise<number>
  async recalculateBalancesAfter(customerId: number, entryId: number, tx?: any): Promise<void>
}
```

### **5. customer-balance-log-service.ts** (NEW)
```typescript
export class CustomerBalanceLogService {
  static async logChange(tx, entry: BalanceLogEntry): Promise<void>
  static async logMultipleChanges(tx, entries: BalanceLogEntry[]): Promise<void>
}
```

---

## 🎯 IMPLEMENTATION ROADMAP

### **Phase 1: Create Handler Infrastructure** (3-4 days)

**Step 1.1: Create customer-balance-handler.ts**
- Copy balance-handler.ts structure
- Adapt for customer_details table
- Implement smart advance allocation for customer payments
- Support BILL_SPECIFIC, MIXED, DIRECT payment types

**Step 1.2: Create customer-ledger-handler.ts**
- Copy ledger-handler.ts structure
- Adapt for customer_ledger table
- Handle SALE, CREDIT_NOTE, PAYMENT_RECEIVED, REFUND entry types
- Implement UPDATE/DELETE operations

**Step 1.3: Create customer-transaction-handler.ts**
- Copy transaction-handler.ts structure
- Adapt for sale/salex operations
- Implement all CRUD handlers
- Support both invoice and invoicex

**Step 1.4: Extend customer-ledger-service.ts**
- Add createEntry method
- Add balance recalculation methods
- Add getLatestBalance method

**Step 1.5: Create customer-balance-log-service.ts**
- Copy vendor-balance-log-service.ts structure
- Adapt for customer_balance_logs table
- Implement audit logging

---

### **Phase 2: Refactor Sale Create APIs** (2-3 days)

**Step 2.1: Refactor Sale Create (POST /api/sales/index.ts)**
- Add balance handler integration
- Implement smart advance allocation
- Move all operations inside transaction
- Add audit logging

**Step 2.2: Refactor Salex Create (POST /api/salex/index.ts)**
- Same as Sale Create
- Handle invoicex table differences

---

### **Phase 3: Refactor Sale Edit APIs** (3-4 days)

**Step 3.1: Refactor Sale Edit (PUT /api/sales/[id].ts)**
- Use customer-transaction-handler
- Handle all 9 status transition cases
- Implement balance updates
- Add ledger UPDATE/DELETE operations

**Step 3.2: Refactor Salex Edit (PUT /api/salex/[id].ts)**
- Same as Sale Edit
- Handle invoicex table differences

---

### **Phase 4: Refactor Return APIs** (3-4 days)

**Step 4.1: Refactor Sale Return Create (POST /api/sale-returns/index.ts)**
- Add balance handler integration
- Implement smart advance refund allocation
- Move all operations inside transaction

**Step 4.2: Refactor Sale Return Edit (PUT /api/sale-returns/[id].ts)**
- Use customer-transaction-handler
- Handle all status transition cases
- Implement balance updates

**Step 4.3: Refactor Sale Return Delete (DELETE /api/sale-returns/[id].ts)**
- Use customer-transaction-handler
- Implement balance reversal
- Delete ledger entries (not create reversals)

---

### **Phase 5: Refactor Payment APIs** (2-3 days)

**Step 5.1: Refactor Customer Payment Create (POST /api/customer-payments/index.ts)**
- Add balance handler integration
- Support BILL_SPECIFIC, MIXED, DIRECT types
- Move all operations inside transaction

**Step 5.2: Refactor Customer Payment Edit (PUT /api/customer-payments/[id].ts)**
- Use customer-transaction-handler
- Implement ledger UPDATE operations
- Implement balance updates

**Step 5.3: Refactor Customer Payment Delete (DELETE /api/customer-payments/[id].ts)**
- Use customer-transaction-handler
- Implement balance reversal
- Delete ledger entries

---

### **Phase 6: Implement Refund APIs** (2-3 days)

**Step 6.1: Refactor Customer Refund Create (POST /api/customer-refunds/index.ts)**
- Add balance handler integration
- Support RETURN_SPECIFIC, DIRECT types
- Move all operations inside transaction

**Step 6.2: Create Customer Refund Edit (PUT /api/customer-refunds/[id].ts)**
- Use customer-transaction-handler
- Implement ledger UPDATE operations
- Implement balance updates

**Step 6.3: Create Customer Refund Delete (DELETE /api/customer-refunds/[id].ts)**
- Use customer-transaction-handler
- Implement balance reversal
- Delete ledger entries

---

### **Phase 7: Testing & Verification** (3-4 days)

**Test Scenarios:**
- [ ] Test sale create with payment
- [ ] Test sale edit with status changes (all 9 cases)
- [ ] Test return create with refund
- [ ] Test return edit with status changes
- [ ] Test payment create (BILL_SPECIFIC, MIXED, DIRECT)
- [ ] Test payment edit
- [ ] Test payment delete
- [ ] Test refund create
- [ ] Test refund edit
- [ ] Test refund delete
- [ ] Test advance balance allocation
- [ ] Test balance calculations
- [ ] Test ledger entries
- [ ] Test transaction rollback
- [ ] Test parallel operations

---

## 📊 ESTIMATED TIMELINE

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Handler Infrastructure | 3-4 days | None |
| Phase 2: Sale Create APIs | 2-3 days | Phase 1 |
| Phase 3: Sale Edit APIs | 3-4 days | Phase 1 |
| Phase 4: Return APIs | 3-4 days | Phase 1 |
| Phase 5: Payment APIs | 2-3 days | Phase 1 |
| Phase 6: Refund APIs | 2-3 days | Phase 1 |
| Phase 7: Testing | 3-4 days | All phases |
| **TOTAL** | **18-25 days** | **(3-5 weeks)** |

---

## 🔑 KEY DIFFERENCES FROM PURCHASE SYSTEM

### **1. Direction of Money Flow**
- **Purchase:** We pay vendors (money out)
- **Sale:** Customers pay us (money in)

### **2. Balance Calculation**
- **Vendor:** `balance = total_paid - total_allocated - total_refunded + total_refund_allocated`
  - Positive = We owe vendor (advance payment)
  - Negative = Vendor owes us
- **Customer:** `balance = total_paid - total_allocated - total_refunded + total_refund_allocated`
  - Positive = Customer has advance (credit)
  - Negative = Customer owes us

### **3. Ledger Entry Types**
- **Vendor Ledger:** PURCHASE, DEBIT_NOTE, PAYMENT, REFUND_RECEIVED
- **Customer Ledger:** SALE, CREDIT_NOTE, PAYMENT_RECEIVED, REFUND

### **4. Stock Operations**
- **Purchase:** INCREMENT stock on purchase, DECREMENT on return
- **Sale:** DECREMENT stock on sale, INCREMENT on return

### **5. Dual Invoice System**
- **Sale:** `invoice` (with tax) and `invoicex` (tax-exempt)
- **Purchase:** Only `purchase` (single table)

---

## 📝 IMPLEMENTATION NOTES

### **Code Reusability:**
- 80% of purchase handler logic can be reused
- Main changes: table names, field names, direction of operations
- Ledger entry types need to be adapted

### **Testing Strategy:**
- Test each API independently
- Test integration between APIs
- Test edge cases (partial payments, returns, etc.)
- Test transaction rollback scenarios
- Test parallel operations

### **Migration Strategy:**
- Implement handlers first (no API changes)
- Refactor APIs one by one
- Keep old code until fully tested
- Deploy incrementally

---

**END OF ANALYSIS**
