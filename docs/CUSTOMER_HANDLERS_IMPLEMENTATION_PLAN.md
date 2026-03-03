# Customer Handlers Implementation Plan

**Created:** [Current Date]  
**Status:** 📋 DETAILED PLAN  
**Purpose:** Step-by-step plan to create 5 customer handlers for Sale/Salex system

---

## ✅ TABLE VERIFICATION

### **Existing Tables (Confirmed):**
1. ✅ `customer_details` - Has balance fields (total_paid, total_allocated, total_refunded, total_refund_allocated, account_balance)
2. ✅ `customer_ledger` - Has all required fields (transaction_type, debit, credit, balance, etc.)
3. ✅ `customer_payments` - Payment records
4. ✅ `customer_payment_allocations` - Payment to invoice/invoicex allocations
5. ✅ `customer_refunds` - Refund records
6. ✅ `customer_refund_allocations` - Refund to return allocations
7. ✅ `invoice` - Sale records
8. ✅ `invoicex` - Salex records
9. ✅ `sale_returns` - Sale return records
10. ✅ `salex_returns` - Salex return records

### **Missing Tables:**
1. ❌ `customer_balance_logs` - **NEEDS TO BE CREATED**

### **Action Required:**
Create migration for `customer_balance_logs` table (mirrors `vendor_balance_logs`)

---

## 📋 IMPLEMENTATION ORDER

### **Step 0: Create Missing Table** (30 minutes)

**File:** `prisma/schema.prisma`

Add after `customer_ledger` model:

```prisma
model customer_balance_logs {
  id            Int      @id @default(autoincrement())
  customer_id   Int
  column_name   String   @db.VarChar(50) // 'total_paid' | 'total_allocated' | 'total_refunded' | 'total_refund_allocated'
  change_amount Decimal  @db.Decimal(10, 2)
  old_value     Decimal  @db.Decimal(10, 2)
  new_value     Decimal  @db.Decimal(10, 2)
  source_type   String   @db.VarChar(50) // 'sale_create' | 'sale_edit' | 'payment_create' | etc.
  source_id     Int
  reference_no  String?  @db.VarChar(50)
  created_at    DateTime @default(now())
  created_by    Int?
  notes         String?  @db.Text
  customer      customer_details @relation(fields: [customer_id], references: [id], onDelete: Cascade)

  @@index([customer_id, created_at(sort: Desc)], map: "idx_customer_date")
  @@index([column_name], map: "idx_column")
  @@index([source_type, source_id], map: "idx_source")
  @@map("customer_balance_logs")
}
```

**Also add to customer_details model:**
```prisma
model customer_details {
  // ... existing fields ...
  balance_logs            customer_balance_logs[]  // Add this line
}
```

**Run migration:**
```bash
npx prisma migrate dev --name add_customer_balance_logs
npx prisma generate
```

---

### **Step 1: Create customer-balance-log-service.ts** (1 hour)

**File:** `lib/customer-balance-log-service.ts`

**Source Template:** Copy from `lib/balance-log-service.ts`

**Changes Required:**
- Replace `vendor_id` → `customer_id`
- Replace `vendor_balance_logs` → `customer_balance_logs`
- Update source types:
  - `purchase_create` → `sale_create`
  - `purchase_edit` → `sale_edit`
  - `payment_create` → `payment_received_create`
  - `payment_edit` → `payment_received_edit`
  - `refund_create` → `refund_issued_create`
  - `refund_edit` → `refund_issued_edit`

**Key Methods:**
```typescript
export type SourceType = 
  | 'sale_create' | 'sale_edit' | 'sale_delete'
  | 'salex_create' | 'salex_edit' | 'salex_delete'
  | 'return_create' | 'return_edit' | 'return_delete'
  | 'payment_received_create' | 'payment_received_edit' | 'payment_received_delete'
  | 'refund_issued_create' | 'refund_issued_edit' | 'refund_issued_delete'
  | 'status_change';

export class CustomerBalanceLogService {
  static async logChange(tx: any, entry: BalanceLogEntry): Promise<void>
  static async logMultipleChanges(tx: any, entries: BalanceLogEntry[]): Promise<void>
}
```

---

### **Step 2: Create customer-balance-handler.ts** (2-3 hours)

**File:** `lib/customer-balance-handler.ts`

**Source Template:** Copy from `lib/balance-handler.ts`

**Changes Required:**
1. Replace `vendor_id` → `customer_id`
2. Replace `vendor_details` → `customer_details`
3. Replace `VendorBalance` → `CustomerBalance`
4. Update method names:
   - `getPurchaseBalanceOps` → `getSaleBalanceOps`
   - `getReturnBalanceOps` → `getReturnBalanceOps` (same name, different logic)
5. Import `CustomerBalanceLogService` instead of `BalanceLogService`
6. Add `type: 'sale' | 'salex'` parameter to methods

**Key Methods:**
```typescript
export class CustomerBalanceHandler {
  // For sale/salex creation with payment
  getCreateBalanceOps(params: {
    customerId: number;
    total: number;
    type: 'sale' | 'salex';
    currentBalance?: {...};
  }): BalanceOperation | null
  
  // For sale/salex status changes (0→1, 1→0, 2→1, etc.)
  getSaleBalanceOps(changes: ChangeSet): BalanceOperation | null
  
  // For return status changes
  getReturnBalanceOps(changes: ChangeSet): BalanceOperation | null
  
  // Update balance in transaction
  updateBalanceInTransaction(tx, customerId, updates): Promise<void>
  
  // Optimized increment with logging
  incrementBalanceInTransaction(tx, customerId, updates, source?): Promise<void>
}
```

**Balance Formula (Same as Vendor):**
```typescript
account_balance = total_paid - total_allocated - total_refunded + total_refund_allocated
```

**Smart Advance Allocation Logic:**
- Check `total_paid - total_allocated` for advance balance
- Use advance first before creating new payment
- Support BILL_SPECIFIC, MIXED, DIRECT payment types

---

### **Step 3: Extend customer-ledger-service.ts** (1-2 hours)

**File:** `lib/customer-ledger-service.ts` (already exists)

**Current Status:** Has basic methods, needs enhancement

**Add Methods:**
```typescript
export interface CustomerLedgerEntryData {
  customer_id: number;
  transaction_date: number;
  transaction_type: 'SALE' | 'CREDIT_NOTE' | 'PAYMENT_RECEIVED' | 'REFUND' | 
                    'PAYMENT_REVERSAL' | 'REFUND_REVERSAL' | 
                    'SALE_ADJUSTMENT' | 'PAYMENT_ADJUSTMENT';
  reference_type?: 'sale' | 'salex' | 'sale_return' | 'salex_return' | 'payment';
  reference_id?: number;
  reference_no?: string;
  payment_mode?: number;
  payment_status?: number;
  payment_date?: number;
  debit: number;  // Money coming in (sales, payments received)
  credit: number; // Money going out (returns, refunds issued)
  notes?: string;
  fy: number;
  transaction_id?: number; // payment_id or refund_id
}

export class CustomerLedgerService {
  // Create ledger entry
  async createEntry(entry: CustomerLedgerEntryData, tx?: any): Promise<void>
  
  // Get latest balance for customer
  async getLatestBalance(customerId: number, tx?: any): Promise<number>
  
  // Recalculate balances after a specific entry
  async recalculateBalancesAfter(customerId: number, entryId: number, tx?: any): Promise<void>
  
  // Get ledger entries for customer
  async getEntries(customerId: number, filters?: any): Promise<any[]>
}
```

**Key Differences from Vendor:**
- `debit` = Money IN (sales, payments received)
- `credit` = Money OUT (returns, refunds issued)
- Transaction types: SALE, CREDIT_NOTE, PAYMENT_RECEIVED, REFUND

---

### **Step 4: Create customer-ledger-handler.ts** (2-3 hours)

**File:** `lib/customer-ledger-handler.ts`

**Source Template:** Copy from `lib/ledger-handler.ts`

**Changes Required:**
1. Replace `vendor_id` → `customer_id`
2. Replace `vendor_ledger` → `customer_ledger`
3. Update transaction types:
   - `PURCHASE` → `SALE`
   - `DEBIT_NOTE` → `CREDIT_NOTE`
   - `PAYMENT` → `PAYMENT_RECEIVED`
   - `REFUND_RECEIVED` → `REFUND`
4. Swap debit/credit logic (opposite direction)
5. Add `type: 'sale' | 'salex'` parameter

**Key Methods:**
```typescript
export class CustomerLedgerHandler {
  // Get ledger operations for sale/salex status changes
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
  
  // Helper: Calculate advance breakdown
  private calculateAdvanceBreakdown(total, currentBalance): {...}
  
  // Helper: Generate payment notes
  private generatePaymentNotes(invoiceNo, total, currentBalance): string
}
```

**9 Status Transition Cases (Same as Purchase):**
```
0→1: Unpaid → Paid
1→0: Paid → Unpaid
2→1: Partial → Paid
2→0: Partial → Unpaid
1→2: Paid → Partial
0→0: Unpaid → Unpaid (amount change)
1→1: Paid → Paid (amount change)
2→2: Partial → Partial (amount change)
```

---

### **Step 5: Create customer-transaction-handler.ts** (3-4 hours)

**File:** `lib/customer-transaction-handler.ts`

**Source Template:** Copy from `lib/transaction-handler.ts`

**Changes Required:**
1. Replace all vendor references with customer
2. Replace purchase/return with sale/return
3. Add `type: 'sale' | 'salex'` parameter to all methods
4. Update table names in operations
5. Import customer handlers instead of vendor handlers

**Key Methods:**
```typescript
export class CustomerTransactionHandler {
  // Handle sale/salex edit
  async handleSaleEdit(params: {
    type: 'sale' | 'salex';
    oldStatus: number;
    newStatus: number;
    oldTotal: number;
    newTotal: number;
    customerId: number;
    invoiceId: number;
    invoiceNo: string;
    // ... other params
  }): Promise<TransactionResult>
  
  // Handle return edit
  async handleReturnEdit(params: {
    type: 'sale' | 'salex';
    // ... params
  }): Promise<TransactionResult>
  
  // Handle customer payment edit
  async handleCustomerPaymentEdit(params): Promise<TransactionResult>
  
  // Handle customer refund edit
  async handleCustomerRefundEdit(params): Promise<TransactionResult>
  
  // Handle sale deletion
  async handleSaleDelete(params: {
    type: 'sale' | 'salex';
    // ... params
  }): Promise<DeleteResult>
  
  // Handle return deletion
  async handleReturnDelete(params): Promise<DeleteResult>
  
  // Handle payment deletion
  async handlePaymentDelete(params): Promise<DeleteResult>
  
  // Handle refund deletion
  async handleRefundDelete(params): Promise<DeleteResult>
  
  // Execute operations in transaction
  async executeInTransaction(tx, result): Promise<void>
  
  // Execute delete operations
  async executeDeleteInTransaction(tx, result): Promise<void>
}
```

---

## 🔄 KEY DIFFERENCES: VENDOR vs CUSTOMER

### **1. Money Flow Direction**
| Aspect | Vendor (Purchase) | Customer (Sale) |
|--------|------------------|-----------------|
| Money In | We pay vendor | Customer pays us |
| Money Out | Vendor refunds us | We refund customer |
| Debit | Purchase (we owe) | Sale (they owe) |
| Credit | Payment (we pay) | Payment received (they pay) |

### **2. Ledger Entry Types**
| Vendor Ledger | Customer Ledger |
|---------------|-----------------|
| PURCHASE | SALE |
| DEBIT_NOTE | CREDIT_NOTE |
| PAYMENT | PAYMENT_RECEIVED |
| REFUND_RECEIVED | REFUND |
| PAYMENT_REVERSAL | PAYMENT_REVERSAL |
| REFUND_REVERSAL | REFUND_REVERSAL |
| PURCHASE_ADJUSTMENT | SALE_ADJUSTMENT |
| PAYMENT_ADJUSTMENT | PAYMENT_ADJUSTMENT |

### **3. Stock Operations**
| Operation | Vendor (Purchase) | Customer (Sale) |
|-----------|------------------|-----------------|
| Create | INCREMENT stock | DECREMENT stock |
| Return | DECREMENT stock | INCREMENT stock |

### **4. Table Names**
| Vendor | Customer |
|--------|----------|
| vendor_details | customer_details |
| vendor_ledger | customer_ledger |
| vendor_payments | customer_payments |
| payment_allocations | customer_payment_allocations |
| vendor_refunds | customer_refunds |
| refund_allocations | customer_refund_allocations |
| purchase | invoice / invoicex |
| purchase_returns | sale_returns / salex_returns |

---

## ✅ TESTING CHECKLIST

After creating each handler:

### **customer-balance-log-service.ts**
- [ ] Test logChange method
- [ ] Test logMultipleChanges method
- [ ] Verify entries created in customer_balance_logs table

### **customer-balance-handler.ts**
- [ ] Test getCreateBalanceOps (with/without advance)
- [ ] Test getSaleBalanceOps (all 9 cases)
- [ ] Test getReturnBalanceOps (all 9 cases)
- [ ] Test updateBalanceInTransaction
- [ ] Test incrementBalanceInTransaction
- [ ] Verify balance calculations

### **customer-ledger-service.ts**
- [ ] Test createEntry
- [ ] Test getLatestBalance
- [ ] Test recalculateBalancesAfter
- [ ] Verify ledger entries created correctly

### **customer-ledger-handler.ts**
- [ ] Test getSaleLedgerOps (all 9 cases)
- [ ] Test getReturnLedgerOps (all 9 cases)
- [ ] Test CREATE operations
- [ ] Test UPDATE operations
- [ ] Test DELETE operations
- [ ] Verify advance breakdown calculations

### **customer-transaction-handler.ts**
- [ ] Test handleSaleEdit (all cases)
- [ ] Test handleReturnEdit (all cases)
- [ ] Test handleCustomerPaymentEdit
- [ ] Test handleCustomerRefundEdit
- [ ] Test handleSaleDelete
- [ ] Test handleReturnDelete
- [ ] Test handlePaymentDelete
- [ ] Test handleRefundDelete
- [ ] Test executeInTransaction
- [ ] Test executeDeleteInTransaction
- [ ] Verify transaction rollback

---

## 📊 IMPLEMENTATION STATUS

| Step | Task | Status | Time Spent | Notes |
|------|------|--------|------------|-------|
| 0 | Create customer_balance_logs table | ⏳ PENDING | - | Need to add to schema |
| 1 | customer-balance-log-service.ts | ✅ COMPLETE | ~1 hour | Fully implemented |
| 2 | customer-balance-handler.ts | ✅ COMPLETE | ~2-3 hours | All methods implemented |
| 3 | Extend customer-ledger-service.ts | ✅ COMPLETE | ~1-2 hours | Enhanced with new methods |
| 4 | customer-ledger-handler.ts | ✅ COMPLETE | ~2-3 hours | All 9 cases handled |
| 5 | customer-transaction-handler.ts | ⏳ PENDING | - | Next to implement |
| **Testing** | All handlers | ⏳ PENDING | - | After Step 5 |

**Progress: 4/6 Steps Complete (67%)**

**Remaining Work:**
1. Create `customer_balance_logs` table migration
2. Create `customer-transaction-handler.ts`
3. Test all handlers together

---

## 🚀 NEXT STEPS

1. **Create migration** for customer_balance_logs table
2. **Create handlers** in order (1 → 2 → 3 → 4 → 5)
3. **Test each handler** individually
4. **Integration test** all handlers together
5. **Document** any deviations from plan

---

**Ready to start implementation?**

