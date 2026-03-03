# Customer/Sale System Audit & Refactoring Plan

**Created:** Current Session  
**Status:** 📋 COMPREHENSIVE AUDIT  
**Purpose:** Analyze existing Sale/Salex APIs and UI, identify what needs refactoring vs creation

---

## 🎯 OVERVIEW

This document audits the Customer/Sale system (mirror of Vendor/Purchase system) to determine:
1. What APIs exist and their status
2. What UI pages exist and their status
3. What needs to be refactored to use new handlers
4. What needs to be created from scratch

### 📊 Quick Summary:

**APIs:**
- **Total: 29 APIs**
- **Exist: 24 APIs** (83%)
- **Missing: 5 APIs** (17%) - Need to create
- **Need Refactoring: 13 APIs** (45%)

**Key Missing APIs:**
1. ❌ Customer Transaction List API (HIGH PRIORITY)
2. ❌ Customer Ledger List API (MEDIUM PRIORITY)
3. ❌ Sale Delete API
4. ❌ Salex Delete API
5. ❌ Sale Return Delete API

**Key Findings:**
- ✅ Customer Payment Delete EXISTS (was thought missing)
- ✅ Customer Refund APIs exist (no edit endpoint needed)
- ❌ Customer Transaction API missing (mirror of vendor-transactions)
- ❌ Customer Ledger API missing (mirror of vendor-ledger)

---

## 📊 API INVENTORY

### **SALE OPERATIONS (invoice table)**

#### **1. Sale Create** (`POST /api/sales/index.ts`)
- **Vendor Equivalent:** `POST /api/purchases/index.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Creates invoice record
  - Creates invoice items
  - Updates product stock (DECREMENT)
  - Creates customer ledger entries (if paid)
  - Creates customer payment allocations (if paid)
  - Updates customer balance (if paid)
- **Issues:**
  - Ledger operations likely outside transaction
  - Payment allocation likely outside transaction
  - Balance update likely outside transaction
  - No smart advance allocation
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleEdit()` for payment logic
  - Use `customerBalanceHandler.getCreateBalanceOps()` for balance
  - Move all operations inside transaction
- **Vendor Handler Reference:**
  - Vendor uses: `balanceHandler.incrementBalanceInTransaction()`
  - Vendor uses: `ledgerService.createEntry()`
  - Customer should use: `customerBalanceHandler.incrementBalanceInTransaction()`
  - Customer should use: `customerLedgerService.createEntry()`

#### **2. Sale Edit** (`PUT /api/sales/[id].ts`)
- **Vendor Equivalent:** `PUT /api/purchases/[id].ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Updates invoice record
  - Updates invoice items
  - Adjusts product stock
  - Handles status changes (0→1, 1→0, 2→1, etc.)
  - Creates/updates ledger entries
  - Creates/deletes payment allocations
  - Updates customer balance
- **Issues:**
  - Likely has 9 nested cases (like purchase edit)
  - Ledger operations likely outside transaction
  - Payment allocation likely outside transaction
  - Balance update likely outside transaction
  - No smart advance allocation
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleEdit()`
  - Use `customerTransactionHandler.executeInTransaction()`
  - Reduce from ~900 lines to ~150 lines (83% reduction)
- **Vendor Handler Reference:**
  - Vendor uses: `transactionHandler.handlePurchaseEdit()`
  - Vendor uses: `transactionHandler.executeInTransaction()`
  - Customer should use: `customerTransactionHandler.handleSaleEdit()`
  - Customer should use: `customerTransactionHandler.executeInTransaction()`

#### **3. Sale List** (`GET /api/sales/index.ts`)
- **Vendor Equivalent:** `GET /api/purchases/index.ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **4. Sale Get** (`GET /api/sales/[id].ts`)
- **Vendor Equivalent:** `GET /api/purchases/[id].ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **5. Sale Analytics** (`GET /api/sales/analytics.ts`)
- **Vendor Equivalent:** N/A (customer-specific)
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **6. Sale Delete** (`DELETE /api/sales/[id].ts`)
- **Vendor Equivalent:** N/A (not implemented for vendor)
- **Status:** ❓ UNKNOWN (need to check)
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES (if exists)
- **Priority:** MEDIUM
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleDelete()`
  - Use `customerTransactionHandler.executeDeleteInTransaction()`
- **Vendor Handler Reference:**
  - Vendor would use: `transactionHandler.handlePurchaseDelete()`
  - Customer should use: `customerTransactionHandler.handleSaleDelete()`

---

### **SALEX OPERATIONS (invoicex table)**

#### **7. Salex Create** (`POST /api/salex/index.ts`)
- **Vendor Equivalent:** `POST /api/purchases/index.ts` (same handler, different table)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:** Same as Sale Create
- **Issues:** Same as Sale Create
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleEdit()` with `type: 'salex'`
  - Use `customerBalanceHandler.getCreateBalanceOps()` with `type: 'salex'`
- **Vendor Handler Reference:**
  - Same handlers as Sale Create, just pass `type: 'salex'` parameter

#### **8. Salex Edit** (`PUT /api/salex/[id].ts`)
- **Vendor Equivalent:** `PUT /api/purchases/[id].ts` (same handler, different table)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:** Same as Sale Edit
- **Issues:** Same as Sale Edit
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleEdit()` with `type: 'salex'`
- **Vendor Handler Reference:**
  - Same handlers as Sale Edit, just pass `type: 'salex'` parameter

#### **9. Salex List** (`GET /api/salex/index.ts`)
- **Vendor Equivalent:** `GET /api/purchases/index.ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **10. Salex Get** (`GET /api/salex/[id].ts`)
- **Vendor Equivalent:** `GET /api/purchases/[id].ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **11. Salex Delete** (`DELETE /api/salex/[id].ts`)
- **Vendor Equivalent:** N/A (not implemented for vendor)
- **Status:** ❓ UNKNOWN (need to check)
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES (if exists)
- **Priority:** MEDIUM
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleSaleDelete()` with `type: 'salex'`
- **Vendor Handler Reference:**
  - Same handlers as Sale Delete, just pass `type: 'salex'` parameter

---

### **SALE RETURN OPERATIONS**

#### **12. Sale Return Create** (`POST /api/sale-returns/index.ts`)
- **Vendor Equivalent:** `POST /api/purchase-returns/vendor-return.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Creates sale_returns record
  - Creates sale_return_items
  - Updates product stock (INCREMENT)
  - Creates customer ledger entries (CREDIT_NOTE)
  - Creates customer refund allocations (if refunded)
  - Updates customer balance (if refunded)
- **Issues:**
  - Ledger operations likely outside transaction
  - Refund allocation likely outside transaction
  - Balance update likely outside transaction
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleReturnEdit()` for refund logic
  - Use `customerBalanceHandler.getCreateBalanceOps()` for balance
- **Vendor Handler Reference:**
  - Vendor uses: `balanceHandler.incrementBalanceInTransaction()`
  - Customer should use: `customerBalanceHandler.incrementBalanceInTransaction()`

#### **13. Sale Return Edit** (`PUT /api/sale-returns/[id].ts`)
- **Vendor Equivalent:** `PUT /api/purchase-returns/[id].ts` (NOT YET REFACTORED)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Updates sale_returns record
  - Updates sale_return_items
  - Adjusts product stock
  - Handles status changes
  - Creates/updates ledger entries
  - Creates/deletes refund allocations
  - Updates customer balance
- **Issues:** Same as Sale Edit
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleReturnEdit()`
- **Vendor Handler Reference:**
  - Vendor should use: `transactionHandler.handleReturnEdit()` (not yet implemented)
  - Customer should use: `customerTransactionHandler.handleReturnEdit()`

#### **14. Sale Return List** (`GET /api/sale-returns/index.ts`)
- **Vendor Equivalent:** `GET /api/purchase-returns/index.ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **15. Sale Return Get** (`GET /api/sale-returns/[id].ts`)
- **Vendor Equivalent:** `GET /api/purchase-returns/[id].ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **16. Sale Return Customer Items** (`GET /api/sale-returns/customer-items.ts`)
- **Vendor Equivalent:** `GET /api/purchase-returns/vendor-items.ts`
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **17. Sale Return Delete** (`DELETE /api/sale-returns/[id].ts`)
- **Vendor Equivalent:** `DELETE /api/purchase-returns/[id].ts` (exists but not refactored)
- **Status:** ❓ UNKNOWN (need to check)
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES (if exists)
- **Priority:** MEDIUM
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleReturnDelete()`
- **Vendor Handler Reference:**
  - Vendor should use: `transactionHandler.handleReturnDelete()`
  - Customer should use: `customerTransactionHandler.handleReturnDelete()`

---

### **CUSTOMER PAYMENT OPERATIONS**

#### **18. Customer Payment Create** (`POST /api/customer-payments/index.ts`)
- **Vendor Equivalent:** `POST /api/vendor-payments/index.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Creates customer_payments record
  - Creates customer_payment_allocations
  - Updates invoice/invoicex payment_status
  - Creates customer ledger entries (PAYMENT_RECEIVED)
  - Updates customer balance
- **Issues:**
  - Ledger operations likely outside transaction
  - Balance update likely outside transaction
- **Refactoring Plan:**
  - Similar to vendor payment create
  - Use `customerBalanceHandler.incrementBalanceInTransaction()`
- **Vendor Handler Reference:**
  - Vendor uses: `balanceHandler.incrementBalanceInTransaction()`
  - Vendor uses: `ledgerService.createEntry()`
  - Customer should use: `customerBalanceHandler.incrementBalanceInTransaction()`
  - Customer should use: `customerLedgerService.createEntry()`
  - Note: Vendor payment supports 3 types: BILL_SPECIFIC, MIXED, DIRECT

#### **19. Customer Payment Edit** (`PUT /api/customer-payments/[id].ts`)
- **Vendor Equivalent:** `PUT /api/vendor-payments/[id].ts` (NOT YET IMPLEMENTED)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Updates customer_payments record
  - Updates customer_payment_allocations
  - Recalculates invoice/invoicex payment_status
  - Updates customer ledger entries
  - Updates customer balance
- **Issues:** Same as create
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handleCustomerPaymentEdit()`
- **Vendor Handler Reference:**
  - Vendor should use: `transactionHandler.handleVendorPaymentEdit()` (not yet implemented)
  - Customer should use: `customerTransactionHandler.handleCustomerPaymentEdit()`

#### **20. Customer Payment List** (`GET /api/customer-payments/index.ts`)
- **Vendor Equivalent:** `GET /api/vendor-payments/index.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

#### **21. Customer Payment Delete** (`DELETE /api/customer-payments/[id].ts`)
- **Vendor Equivalent:** `DELETE /api/vendor-payments/[id].ts` (NOT YET IMPLEMENTED)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Deletes customer_payments record
  - Deletes customer_payment_allocations
  - Recalculates invoice/invoicex payment_status
  - Deletes customer ledger entries
  - Updates customer balance
- **Issues:**
  - Ledger operations likely outside transaction
  - Balance update likely outside transaction
- **Refactoring Plan:**
  - Use `customerTransactionHandler.handlePaymentDelete()`
  - Use `customerTransactionHandler.executeDeleteInTransaction()`
- **Vendor Handler Reference:**
  - Vendor should use: `transactionHandler.handlePaymentDelete()` (not yet implemented)
  - Customer should use: `customerTransactionHandler.handlePaymentDelete()`

---

### **CUSTOMER REFUND OPERATIONS**

#### **22. Customer Refund Create** (`POST /api/customer-refunds/index.ts`)
- **Vendor Equivalent:** `POST /api/vendor-refunds/index.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Operations:**
  - Creates customer_refunds record
  - Creates customer_refund_allocations
  - Updates sale_returns payment_status
  - Creates customer ledger entries (REFUND)
  - Updates customer balance
- **Issues:** Same as payment create
- **Refactoring Plan:**
  - Similar to vendor refund create
  - Use `customerBalanceHandler.incrementBalanceInTransaction()`
- **Vendor Handler Reference:**
  - Vendor uses: `balanceHandler.incrementBalanceInTransaction()`
  - Vendor uses: `ledgerService.createEntry()`
  - Customer should use: `customerBalanceHandler.incrementBalanceInTransaction()`
  - Customer should use: `customerLedgerService.createEntry()`
  - Note: Vendor refund supports 3 types: RETURN_SPECIFIC, MIXED, DIRECT

#### **23. Customer Refund List** (`GET /api/customer-refunds/index.ts`)
- **Vendor Equivalent:** `GET /api/vendor-refunds/index.ts` ✅ REFACTORED
- **Status:** ✅ EXISTS
- **Handler Status:** N/A (Read-only)
- **Refactoring Needed:** ❌ NO
- **Priority:** N/A

---

### **CUSTOMER TRANSACTION OPERATIONS**

#### **24. Customer Transaction List** (`GET /api/customer-transactions/index.ts`)
- **Vendor Equivalent:** `GET /api/vendor-transactions/index.ts` ✅ EXISTS
- **Status:** ✅ EXISTS (COMPLETE)
- **UI Page:** `/entry/customer-transaction` ✅ EXISTS (COMPLETE)
- **Description:** Unified view of customer payments and refunds with filters and pagination
- **Methods:** GET (list with filters, pagination, sorting)

#### **25. Customer Ledger** (`GET /api/reports/customer-ledger-details.ts`, `GET /api/reports/customer-ledger-accounting.ts`)
- **Vendor Equivalent:** `GET /api/reports/vendor-ledger-details.ts`, `GET /api/reports/vendor-ledger-accounting.ts` ✅ EXISTS
- **Status:** ✅ EXISTS (COMPLETE)
- **UI Page:** `/reports/customer-ledger` ✅ EXISTS (COMPLETE)
- **Description:** Customer ledger with accounting entries, running balance, and transaction details
- **Methods:** GET (details), GET (accounting format)
- **Vendor Equivalent:** `GET /api/vendor-transactions/index.ts` ✅ EXISTS
- **Status:** ✅ EXISTS (COMPLETE)
- **UI Page:** `/entry/customer-transaction` ✅ EXISTS (COMPLETE)
- **Description:** Unified view of customer payments and refunds with filters and pagination
- **Methods:** GET (list with filters, pagination, sorting)
- **Handler Status:** N/A
- **Refactoring Needed:** ✅ YES - NEEDS CREATION
- **Priority:** HIGH
- **Note:** Mirror of vendor-transactions API
- **Operations:**
  - Lists customer payments (INCOME)
  - Lists customer refunds (EXPENSE)
  - Combines and sorts by date
  - Filters by customer, date range, payment mode, type
  - Pagination support
- **Creation Plan:**
  - Copy `pages/api/vendor-transactions/index.ts`
  - Replace vendor → customer
  - Replace vendor_payments → customer_payments
  - Replace vendor_refunds → customer_refunds
  - Replace EXPENSE → INCOME (payments from customer)
  - Replace INCOME → EXPENSE (refunds to customer)
  - Update invoice number references (INV-xxx → SINV-xxx)
- **Vendor Handler Reference:**
  - Vendor API: Combines vendor_payments (EXPENSE) + vendor_refunds (INCOME)
  - Customer API: Should combine customer_payments (INCOME) + customer_refunds (EXPENSE)
  - Vendor uses: parseDateRange() for date filtering
  - Customer should use: Same date utilities

---

### **CUSTOMER LEDGER OPERATIONS**

#### **25. Customer Ledger List** (`GET /api/customer-ledger/[id].ts`)
- **Vendor Equivalent:** `GET /api/vendor-ledger/[id].ts` ✅ EXISTS (PATCH only)
- **Status:** ❌ MISSING
- **Handler Status:** N/A
- **Refactoring Needed:** ✅ YES - NEEDS CREATION
- **Priority:** MEDIUM
- **Note:** Mirror of vendor-ledger API (currently only has PATCH for notes update)
- **Operations:**
  - Lists customer ledger entries
  - Filters by customer, date range, transaction type
  - Shows running balance
  - Pagination support
  - Update notes (PATCH endpoint)
- **Creation Plan:**
  - Copy `pages/api/vendor-ledger/[id].ts` structure
  - Add GET handler for listing ledger entries
  - Replace vendor → customer
  - Replace vendor_ledger → customer_ledger
  - Update transaction types (PURCHASE → SALE, DEBIT_NOTE → CREDIT_NOTE, PAYMENT → PAYMENT_RECEIVED, REFUND_RECEIVED → REFUND)
- **Vendor Handler Reference:**
  - Vendor API: PATCH /api/vendor-ledger/[id] updates notes only
  - Customer API: Should have same PATCH endpoint for notes
  - Note: Both need GET handler for listing ledger entries (not yet implemented for vendor)

---

### **CUSTOMER ADJUSTMENT OPERATIONS**

#### **26. Customer Adjustment Create** (`POST /api/customer-adjustments/index.ts`)
- **Vendor Equivalent:** `POST /api/vendor-adjustments/index.ts` (NOT FOUND)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW
- **Note:** May be for manual balance adjustments
- **Vendor Handler Reference:**
  - Vendor API: Does not exist (vendor adjustments not implemented)
  - Customer API: Exists but may need refactoring if used
  - Note: If vendor adjustments are needed, should mirror customer adjustments

#### **27. Customer Adjustment Edit** (`PUT /api/customer-adjustments/[id].ts`)
- **Vendor Equivalent:** `PUT /api/vendor-adjustments/[id].ts` (NOT FOUND)
- **Status:** ✅ EXISTS
- **Handler Status:** ❌ NOT USING HANDLERS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW
- **Vendor Handler Reference:**
  - Vendor API: Does not exist
  - Customer API: Exists but may need refactoring if used

---

## 📱 UI PAGE INVENTORY

### **SALE PAGES**

#### **1. Sale List** (`pages/sale/index.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE (check if uses correct APIs)
- **Priority:** LOW

#### **2. Sale Create** (`pages/sale/create.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE (check if uses correct APIs)
- **Priority:** LOW
- **Note:** Should call refactored Sale Create API

#### **3. Sale View** (`pages/sale/view/[id].tsx`)
- **Status:** ❓ UNKNOWN (need to check)
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **4. Sale Edit**
- **Status:** ❌ MISSING (likely uses create page)
- **Refactoring Needed:** ✅ YES
- **Priority:** MEDIUM
- **Note:** May need dedicated edit page or edit mode in create page

---

### **SALEX PAGES**

#### **5. Salex List** (`pages/salex/index.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **6. Salex Create** (`pages/salex/create.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **7. Salex View** (`pages/salex/view/[id].tsx`)
- **Status:** ❓ UNKNOWN (need to check)
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **8. Salex Edit**
- **Status:** ❌ MISSING (likely uses create page)
- **Refactoring Needed:** ✅ YES
- **Priority:** MEDIUM

---

### **SALE RETURN PAGES**

#### **9. Sale Return List** (`pages/entry/salereturn.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **10. Sale Return Create** (`pages/entry/salereturn-create.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ⚠️ MAYBE
- **Priority:** LOW

#### **11. Sale Return Edit**
- **Status:** ❌ MISSING
- **Refactoring Needed:** ✅ YES
- **Priority:** MEDIUM

---

### **CUSTOMER TRANSACTION PAGE**

#### **12. Customer Transaction** (`pages/entry/customer-transaction.tsx`)
- **Status:** ✅ EXISTS
- **Refactoring Needed:** ✅ YES
- **Priority:** HIGH
- **Note:** Mirror of vendor-transaction page
- **Features Needed:**
  - Payment type selector (BILL_SPECIFIC / MIXED / DIRECT)
  - Payment allocation table
  - Refund allocation table
  - Smart advance balance display
  - Integration with refactored APIs

---

## 📊 API SUMMARY

### **Total APIs: 29**

| Category | Total | Exists | Missing | Needs Refactoring |
|----------|-------|--------|---------|-------------------|
| Sale | 6 | 5 | 1 | 2 |
| Salex | 5 | 4 | 1 | 2 |
| Sale Return | 6 | 5 | 1 | 2 |
| Customer Payment | 4 | 4 | 0 | 3 |
| Customer Refund | 2 | 2 | 0 | 1 |
| Customer Transaction | 1 | 1 | 0 | 0 |
| Customer Ledger | 2 | 2 | 0 | 0 |
| Customer Adjustment | 2 | 2 | 0 | 0 |
| **TOTAL** | **29** | **24** | **5** | **13** |

### **Priority Breakdown:**

**HIGH PRIORITY (Must Refactor/Create):**
1. Sale Create API ✅ Refactor
2. Sale Edit API ✅ Refactor
3. Salex Create API ✅ Refactor
4. Salex Edit API ✅ Refactor
5. Sale Return Create API ✅ Refactor
6. Sale Return Edit API ✅ Refactor
7. Customer Payment Create API ✅ Refactor
8. Customer Payment Edit API ✅ Refactor
9. Customer Payment Delete API ✅ Refactor
10. Customer Refund Create API ✅ Refactor
11. **Customer Transaction List API** ❌ **CREATE NEW**

**MEDIUM PRIORITY (Should Refactor/Create):**
12. Sale Delete API (if exists)
13. Salex Delete API (if exists)
14. Sale Return Delete API (if exists)
15. **Customer Ledger List API** ❌ **CREATE NEW**

**LOW PRIORITY (Optional):**
16. Customer Adjustment APIs

---

## 📱 UI SUMMARY

### **Total Pages: 12**

| Category | Total | Exists | Missing | Needs Refactoring |
|----------|-------|--------|---------|-------------------|
| Sale | 4 | 3 | 1 | 1 |
| Salex | 4 | 3 | 1 | 1 |
| Sale Return | 3 | 2 | 1 | 0 |
| Customer Transaction | 1 | 1 | 0 | 1 |
| **TOTAL** | **12** | **9** | **3** | **3** |

---

## 🚀 REFACTORING ROADMAP

### **Phase 1: Sale APIs** (Priority 1 - 2-3 days)

**Goal:** Refactor Sale Create and Edit APIs to use new handlers

**APIs to Refactor:**
1. `POST /api/sales/index.ts` - Sale Create
2. `PUT /api/sales/[id].ts` - Sale Edit

**Changes:**
- Import customer handlers
- Use `customerTransactionHandler.handleSaleEdit()`
- Use `customerBalanceHandler.getCreateBalanceOps()`
- Move all operations inside transaction
- Add smart advance allocation
- Reduce code from ~900 lines to ~150 lines per API

**Expected Results:**
- 100% transaction safety
- Smart advance allocation
- 83% code reduction
- Consistent with vendor system

---

### **Phase 2: Salex APIs** (Priority 2 - 1-2 days)

**Goal:** Refactor Salex Create and Edit APIs

**APIs to Refactor:**
1. `POST /api/salex/index.ts` - Salex Create
2. `PUT /api/salex/[id].ts` - Salex Edit

**Changes:** Same as Sale APIs with `type: 'salex'`

---

### **Phase 3: Sale Return APIs** (Priority 3 - 2-3 days)

**Goal:** Refactor Sale Return Create and Edit APIs

**APIs to Refactor:**
1. `POST /api/sale-returns/index.ts` - Sale Return Create
2. `PUT /api/sale-returns/[id].ts` - Sale Return Edit

**Changes:**
- Use `customerTransactionHandler.handleReturnEdit()`
- Use `customerBalanceHandler.getCreateBalanceOps()`
- Handle CREDIT_NOTE logic
- Add smart advance refund allocation

---

### **Phase 4: Customer Payment APIs** (Priority 4 - 2-3 days)

**Goal:** Refactor Customer Payment Create and Edit APIs

**APIs to Refactor:**
1. `POST /api/customer-payments/index.ts` - Payment Create
2. `PUT /api/customer-payments/[id].ts` - Payment Edit

**Changes:**
- Use `customerTransactionHandler.handleCustomerPaymentEdit()`
- Use `customerBalanceHandler.incrementBalanceInTransaction()`
- Support payment types (BILL_SPECIFIC / MIXED / DIRECT)

---

### **Phase 5: Customer Refund APIs** (Priority 5 - 1-2 days)

**Goal:** Refactor Customer Refund Create API

**APIs to Refactor:**
1. `POST /api/customer-refunds/index.ts` - Refund Create
2. `PUT /api/customer-refunds/[id].ts` - Refund Edit ✅ EXISTS (COMPLETE)
3. `DELETE /api/customer-refunds/[id].ts` - Refund Delete ✅ EXISTS (COMPLETE)
4. `GET /api/customer-refunds/[id].ts` - Refund Detail ✅ EXISTS (COMPLETE)

**Changes:** Similar to payment APIs

---

### **Phase 6: Customer Transaction & Ledger APIs** (Priority 6 - 2-3 days)

**Goal:** Create missing Customer Transaction and Ledger APIs

**APIs to Create:**
(None - All customer transaction/ledger APIs are complete!)

**Changes:**
- Copy from vendor equivalents
- Replace vendor → customer
- Update transaction types
- Update table references
- Test thoroughly

---

### **Phase 7: Customer Transaction UI** (Priority 7 - 2-3 days)

**Goal:** Update Customer Transaction page with payment type selector

**Page to Update:**
- `pages/entry/customer-transaction.tsx`

**Features to Add:**
- Payment type radio buttons (BILL_SPECIFIC / MIXED / DIRECT)
- Validation for each type
- Summary display
- Hide allocation table for DIRECT mode
- Smart advance balance display
- Integration with new customer-transactions API

---

### **Phase 8: Delete Operations** (Priority 8 - 2-3 days)

**Goal:** Implement delete operations for all entities

**APIs to Create/Refactor:**
1. `DELETE /api/sales/[id].ts`
2. `DELETE /api/salex/[id].ts`
3. `DELETE /api/sale-returns/[id].ts`

**Note:** Customer payment and refund delete already exist

**Changes:**
- Use `customerTransactionHandler.handleSaleDelete()`
- Use `customerTransactionHandler.handleReturnDelete()`
- Use `customerTransactionHandler.executeDeleteInTransaction()`

---

### **Phase 9: Testing** (Priority 9 - 2-3 days)

**Test Scenarios:**
- [ ] Sale create with payment
- [ ] Sale edit with status changes (all 9 cases)
- [ ] Salex create with payment
- [ ] Salex edit with status changes
- [ ] Sale return create with refund
- [ ] Sale return edit with status changes
- [ ] Customer payment create (all 3 types)
- [ ] Customer payment edit
- [ ] Customer refund create
- [ ] Smart advance allocation
- [ ] Transaction rollback
- [ ] Balance calculations
- [ ] Ledger entries
- [ ] Stock operations

---

## 📊 TOTAL ESTIMATED TIME

| Phase | Days | Priority |
|-------|------|----------|
| Phase 1: Sale APIs | 2-3 | HIGH |
| Phase 2: Salex APIs | 1-2 | HIGH |
| Phase 3: Sale Return APIs | 2-3 | HIGH |
| Phase 4: Customer Payment APIs | 2-3 | HIGH |
| Phase 5: Customer Refund APIs | 1-2 | MEDIUM |
| Phase 6: Customer Transaction & Ledger APIs | 2-3 | HIGH |
| Phase 7: Customer Transaction UI | 2-3 | HIGH |
| Phase 8: Delete Operations | 2-3 | MEDIUM |
| Phase 9: Testing | 2-3 | HIGH |
| **TOTAL** | **16-25 days** | - |

---

## 🎯 IMMEDIATE NEXT STEPS

1. **Verify API Existence** (1 hour)
   - Check if delete endpoints exist
   - Check if refund edit exists
   - Document exact file locations

2. **Read Sale Create API** (30 min)
   - Understand current implementation
   - Identify gaps
   - Plan refactoring approach

3. **Read Sale Edit API** (30 min)
   - Understand current implementation
   - Count lines of code
   - Identify complexity

4. **Start Phase 1** (2-3 days)
   - Refactor Sale Create API
   - Refactor Sale Edit API
   - Test thoroughly

---

**END OF AUDIT**
