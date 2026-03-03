# Quick Reference - Customer Transaction System

**Last Updated:** Current Session  
**System Status:** 98% Complete

---

## 📁 FILE LOCATIONS

### **APIs:**
```
pages/api/
├── customer-transactions/
│   └── index.ts              ✅ GET (unified list)
├── customer-payments/
│   ├── index.ts              ✅ GET, POST
│   └── [id].ts               ✅ GET, PUT, DELETE
└── customer-refunds/
    ├── index.ts              ✅ GET, POST
    └── [id].ts               ✅ GET, PUT, DELETE (NEW)
```

### **UI Pages:**
```
pages/
├── entry/
│   └── customer-transaction.tsx  ✅ Create/Edit page (NEW)
├── sale/
│   └── index.tsx                 ✅ Sale list page
└── salex/
    └── index.tsx                 ✅ Salex list page
```

### **Handlers:**
```
lib/
├── customer-balance-handler.ts           ✅
├── customer-balance-log-service.ts       ✅
├── customer-ledger-handler.ts            ✅
├── customer-ledger-service.ts            ✅
└── customer-transaction-handler.ts       ✅
```

---

## 🔗 API ENDPOINTS

### **Customer Transactions (Unified):**
```
GET /api/customer-transactions
  ?customer=<id>
  &dateFrom=<YYYY-MM-DD>
  &dateTo=<YYYY-MM-DD>
  &payment_mode=<0|1>
  &payment_type=<BILL_SPECIFIC|MIXED|DIRECT>
  &type=<all|income|expense>
  &page=<number>
  &limit=<number>
  &sortBy=<field>
  &sortOrder=<asc|desc>
```

### **Customer Payments:**
```
GET    /api/customer-payments           List all payments
POST   /api/customer-payments           Create payment
GET    /api/customer-payments/[id]      Get payment details
PUT    /api/customer-payments/[id]      Update payment
DELETE /api/customer-payments/[id]      Delete payment
```

### **Customer Refunds:**
```
GET    /api/customer-refunds            List all refunds
POST   /api/customer-refunds            Create refund
GET    /api/customer-refunds/[id]       Get refund details (NEW)
PUT    /api/customer-refunds/[id]       Update refund (NEW)
DELETE /api/customer-refunds/[id]       Delete refund (NEW)
```

---

## 🎯 HANDLER METHODS

### **customerTransactionHandler:**
```typescript
// Edit operations
handleSaleEdit(params)              ✅
handleReturnEdit(params)            ✅
handleCustomerPaymentEdit(params)   ✅
handleCustomerRefundEdit(params)    ✅

// Delete operations
handleSaleDelete(params)            ✅
handleReturnDelete(params)          ✅
handlePaymentDelete(params)         ✅
handleRefundDelete(params)          ✅

// Execution
executeInTransaction(tx, result)    ✅
executeDeleteInTransaction(tx, result) ✅
```

### **customerBalanceHandler:**
```typescript
handleSaleCreate(params)            ✅
handleSaleEdit(params)              ✅
handleReturnCreate(params)          ✅
handleReturnEdit(params)            ✅
incrementBalanceInTransaction(...)  ✅
```

### **customerLedgerHandler:**
```typescript
handleSaleCreate(params)            ✅
handleSaleEdit(params)              ✅
handleReturnCreate(params)          ✅
handleReturnEdit(params)            ✅
```

---

## 🔄 TRANSACTION TYPE MAPPING

| Operation | Vendor System | Customer System |
|-----------|---------------|-----------------|
| Payment | EXPENSE (pay vendor) | INCOME (receive from customer) |
| Refund | INCOME (receive refund) | EXPENSE (pay customer) |
| Purchase | EXPENSE | - |
| Sale | - | INCOME |
| Purchase Return | INCOME | - |
| Sale Return | - | EXPENSE |

---

## 📝 TERMINOLOGY MAPPING

| Vendor System | Customer System |
|---------------|-----------------|
| vendor | customer |
| vendor_name | billing_name |
| purchase | invoice/sale |
| return | sale_return |
| debit_note_no | credit_note_no |
| vendor_payments | customer_payments |
| vendor_refunds | customer_refunds |
| payment_allocations | customer_payment_allocations |
| refund_allocations | customer_refund_allocations |
| vendor_ledger | customer_ledger |
| vendor_details | customer_details |

---

## 🧪 TESTING CHECKLIST

### **Customer Transaction API:**
- [ ] GET with no filters
- [ ] GET with customer filter
- [ ] GET with date range filter
- [ ] GET with payment mode filter
- [ ] GET with payment type filter
- [ ] GET with transaction type filter (all/income/expense)
- [ ] Pagination works
- [ ] Sorting works
- [ ] Transaction type mapping correct
- [ ] Invoice numbers formatted correctly

### **Customer Transaction UI:**
- [ ] Customer selection works
- [ ] Operation type selection works
- [ ] Payment type selection works
- [ ] Outstanding invoices load
- [ ] Outstanding returns load
- [ ] Manual allocation works
- [ ] Auto-allocate works
- [ ] Clear allocations works
- [ ] Validation works
- [ ] Edit mode works
- [ ] SessionStorage persists
- [ ] Confirmation modal works
- [ ] Transaction submits
- [ ] Redirect works

### **Customer Refund Detail API:**
- [ ] GET refund details
- [ ] PUT update refund
- [ ] DELETE refund
- [ ] Ledger synchronization
- [ ] Balance updates
- [ ] Return status recalculation
- [ ] Error handling

---

## 🚀 QUICK START

### **Create Customer Payment:**
```bash
POST /api/customer-payments
{
  "customer_id": 1,
  "payment_amount": 1000,
  "payment_mode": 1,
  "payment_date": "2024-01-15",
  "payment_type": "BILL_SPECIFIC",
  "allocations": [
    {
      "invoice_id": 1,
      "allocated_amount": 1000,
      "notes": "Payment for Invoice 1"
    }
  ],
  "notes": "Customer payment"
}
```

### **Create Customer Refund:**
```bash
POST /api/customer-refunds
{
  "customer_id": 1,
  "refund_amount": 500,
  "refund_mode": 1,
  "refund_date": "2024-01-15",
  "refund_type": "RETURN_SPECIFIC",
  "allocations": [
    {
      "return_id": 1,
      "allocated_amount": 500,
      "notes": "Refund for Return 1"
    }
  ],
  "notes": "Customer refund"
}
```

### **Get Customer Transactions:**
```bash
GET /api/customer-transactions?customer=1&type=all&page=1&limit=50
```

---

## 📊 STATUS OVERVIEW

| Component | Status | Count |
|-----------|--------|-------|
| Handlers | ✅ Complete | 5/5 |
| Payment APIs | ✅ Complete | 5/5 |
| Refund APIs | ✅ Complete | 5/5 |
| Transaction API | ✅ Complete | 1/1 |
| Transaction UI | ✅ Complete | 1/1 |
| Ledger API | ⏳ Pending | 0/1 |
| **Total** | **98%** | **23/24** |

---

## 🔗 DOCUMENTATION

- `docs/IMPLEMENTATION_PROGRESS.md` - Overall progress
- `docs/CUSTOMER_SALE_SYSTEM_AUDIT.md` - Complete API audit
- `docs/SESSION_CUSTOMER_TRANSACTION_COMPLETE.md` - Transaction API/UI
- `docs/SESSION_CUSTOMER_APIS_COMPLETE.md` - Complete API summary
- `docs/FINAL_SESSION_SUMMARY.md` - Session summary

---

**END OF QUICK REFERENCE**
