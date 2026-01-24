# Vendor Transactions - Complete Management System Implementation

**Document Version:** 1.0  
**Created:** January 23, 2026  
**Status:** 📋 IMPLEMENTATION PLAN  
**Purpose:** Implement complete vendor transaction management with list, view, create, and edit functionality

---

## 🎯 OBJECTIVE

Transform the current create-only vendor transaction page into a complete management system with:
- **Landing page** with tabs for EXPENSE/INCOME transactions
- **View page** to see transaction details
- **Edit functionality** to modify existing transactions
- **Unified interface** while maintaining backend separation

---

## 📊 CURRENT STATE

### **Existing Backend APIs:**

#### **Vendor Payments (EXPENSE):**
- ✅ `POST /api/vendor-payments` - Create payment with allocations
- ✅ `GET /api/vendor-payments` - List payments with filters
- ✅ `GET /api/vendor-payments/[id]` - Get single payment details
- ❌ `PUT /api/vendor-payments/[id]` - **MISSING** (needed for edit)
- ❌ `DELETE /api/vendor-payments/[id]` - **MISSING** (optional)

#### **Vendor Refunds (INCOME):**
- ✅ `POST /api/vendor-refunds` - Create refund with allocations
- ✅ `GET /api/vendor-refunds` - List refunds with filters
- ✅ `GET /api/vendor-refunds/[id]` - Get single refund details
- ❌ `PUT /api/vendor-refunds/[id]` - **MISSING** (needed for edit)
- ❌ `DELETE /api/vendor-refunds/[id]` - **MISSING** (optional)

### **Existing Frontend:**
- ✅ `pages/entry/vendor-transaction.tsx` - Create-only page with operation type selection
- ❌ Landing/List page - **MISSING**
- ❌ View page - **MISSING**
- ❌ Edit functionality - **MISSING**

### **Database Schema:**
- ✅ `vendor_payments` - Stores payment records
- ✅ `payment_allocations` - Links payments to purchases
- ✅ `vendor_refunds` - Stores refund records
- ✅ `refund_allocations` - Links refunds to returns
- ✅ `vendor_details` - Balance tracking fields
- ✅ `vendor_ledger` - Ledger entries for all transactions

---

## 🏗️ ARCHITECTURE

### **URL Structure:**
```
/vendor-transactions                      → Landing page with EXPENSE/INCOME tabs
/vendor-transactions/view/[id]?type=X    → View page (unified for both types)
/entry/vendor-transaction                 → Create page (keep existing)
/entry/vendor-transaction?edit=X&type=Y  → Edit mode (same page)
```

### **Key Design Decisions:**

1. **Unified Frontend with Backend Separation**
   - Frontend: Single pages with tabs/type parameter
   - Backend: Separate APIs for payments/refunds (different tables)

2. **Type Parameter Approach**
   - View page uses `?type=expense|income` to know which API to call
   - Edit page uses `?edit={id}&type=expense|income`

3. **90% Code Reuse**
   - Same UI components for EXPENSE and INCOME
   - Same form logic with dynamic API endpoints
   - Same validation and error handling

---

## 📋 IMPLEMENTATION PLAN

### **PHASE 1: Backend APIs** (4-6 hours)

#### **Task 1.1: Implement PUT /api/vendor-payments/[id]** ⏳

**File:** `pages/api/vendor-payments/[id].ts`

**Requirements:**
- Add `PUT` method handler
- Validate payment exists and is editable
- Compare old vs new allocations
- Update in transaction:
  - Update payment record (amount, date, mode, notes)
  - Remove deleted allocations
  - Add new allocations
  - Update purchase payment_status for affected purchases
  - Create ledger adjustment entries
  - Update vendor balance

**Key Logic:**
```typescript
async function handleUpdatePayment(req, res) {
  const { id } = req.query
  const { payment_amount, payment_date, payment_mode, notes, allocations } = req.body
  
  await prisma.$transaction(async (tx) => {
    // 1. Fetch existing payment with allocations
    const existing = await tx.vendor_payments.findUnique({
      where: { id },
      include: { allocations: true }
    })
    
    // 2. Calculate differences
    const oldAmount = Number(existing.payment_amount)
    const newAmount = payment_amount
    const amountDiff = newAmount - oldAmount
    
    const oldAllocIds = existing.allocations.map(a => a.purchase_id)
    const newAllocIds = allocations.map(a => a.purchase_id)
    const removed = oldAllocIds.filter(id => !newAllocIds.includes(id))
    const added = newAllocIds.filter(id => !oldAllocIds.includes(id))
    
    // 3. Update payment record
    await tx.vendor_payments.update({
      where: { id },
      data: { payment_amount, payment_date, payment_mode, notes }
    })
    
    // 4. Delete removed allocations
    await tx.payment_allocations.deleteMany({
      where: { payment_id: id, purchase_id: { in: removed } }
    })
    
    // 5. Update existing allocations
    for (const alloc of allocations) {
      if (oldAllocIds.includes(alloc.purchase_id)) {
        await tx.payment_allocations.update({
          where: { 
            payment_id_purchase_id: { 
              payment_id: id, 
              purchase_id: alloc.purchase_id 
            }
          },
          data: { allocated_amount: alloc.allocated_amount }
        })
      }
    }
    
    // 6. Create new allocations
    for (const alloc of allocations) {
      if (added.includes(alloc.purchase_id)) {
        await tx.payment_allocations.create({
          data: {
            payment_id: id,
            purchase_id: alloc.purchase_id,
            allocated_amount: alloc.allocated_amount,
            allocation_date: payment_date
          }
        })
      }
    }
    
    // 7. Update purchase payment_status for all affected purchases
    const affectedPurchaseIds = [...oldAllocIds, ...newAllocIds]
    for (const purchaseId of affectedPurchaseIds) {
      await recalculatePurchaseStatus(tx, purchaseId)
    }
    
    // 8. Create ledger adjustment entries
    if (amountDiff !== 0) {
      await ledgerService.createEntry({
        vendor_id: existing.vendor_id,
        transaction_date: payment_date,
        transaction_type: 'PAYMENT_ADJUSTMENT',
        reference_type: 'payment',
        reference_id: id,
        debit: 0,
        credit: Math.abs(amountDiff),
        notes: `Payment adjustment: ${amountDiff > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(amountDiff)}`,
        fy: existing.fy
      }, tx)
    }
    
    // 9. Update vendor balance
    await balanceHandler.incrementBalanceInTransaction(tx, existing.vendor_id, {
      total_paid: amountDiff,
      total_allocated: calculateAllocDiff(existing.allocations, allocations)
    })
  })
}
```

**Estimated Time:** 2-3 hours

---

#### **Task 1.2: Implement PUT /api/vendor-refunds/[id]** ⏳

**File:** `pages/api/vendor-refunds/[id].ts`

**Requirements:**
- Similar to payment edit but for refunds
- Update refund record and allocations
- Update return payment_status
- Create ledger adjustments
- Update vendor balance

**Key Differences:**
- Works with `refund_allocations` and `purchase_returns`
- Uses `total_refunded` and `total_refund_allocated` for balance
- Ledger entry type: `REFUND_ADJUSTMENT`

**Estimated Time:** 2-3 hours

---

### **PHASE 2: Frontend Pages** (11-16 hours)

#### **Task 2.1: Create Landing Page** ⏳

**File:** `pages/vendor-transactions/index.tsx`

**Layout:**
```
┌────────────────────────────────────────────────┐
│ Vendor Transactions                            │
│ ┌──────────┬──────────┐                        │
│ │ EXPENSE  │ INCOME   │  ← Tab Switcher       │
│ └──────────┴──────────┘                        │
│                                                │
│ Filters:                                       │
│ [Search Vendor] [Date From] [Date To]         │
│ [Payment Mode ▼] [Payment Type ▼]             │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ ID │ Date │ Vendor │ Amount │ Type │ Mode │ │
│ ├────┼──────┼────────┼────────┼──────┼──────┤ │
│ │ 1  │ ... │ ABC Co │ ₹10,000│ BILL │ Bank │ │
│ │ 2  │ ... │ XYZ Ltd│ ₹5,000 │DIRECT│ Cash │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ Pagination: [< 1 2 3 >]                       │
│                                                │
│ [+ Add Transaction] button                     │
└────────────────────────────────────────────────┘
```

**Features:**
- Tab switcher between EXPENSE and INCOME
- On tab change: Switch API endpoint and refetch data
- Filters: Vendor dropdown, date range, payment mode, payment type
- Table with sorting and pagination
- Click row → Navigate to view page with type parameter
- Search functionality
- Export to Excel/PDF

**API Integration:**
```typescript
const [activeTab, setActiveTab] = useState<'EXPENSE' | 'INCOME'>('EXPENSE')

const fetchTransactions = async () => {
  const endpoint = activeTab === 'EXPENSE' 
    ? '/api/vendor-payments' 
    : '/api/vendor-refunds'
  
  const params = new URLSearchParams({
    vendor_id: filters.vendor || '',
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    payment_mode: filters.mode || '',
    page: page.toString(),
    limit: '50'
  })
  
  const response = await fetch(`${endpoint}?${params}`)
  const data = await response.json()
  setTransactions(data.data)
}
```

**Component Structure:**
```typescript
- VendorTransactionsPage
  - TabGroup (EXPENSE/INCOME)
  - FilterBar
    - VendorSelect
    - DateRangeFilter
    - PaymentModeSelect
    - PaymentTypeSelect
  - TransactionTable
    - Columns: ID, Date, Vendor, Amount, Type, Mode, Status
    - Click handler → navigate to view
  - Pagination
  - AddButton → navigate to create
```

**Estimated Time:** 3-4 hours

---

#### **Task 2.2: Create View Page** ⏳

**File:** `pages/vendor-transactions/view/[id].tsx`

**URL Format:** `/vendor-transactions/view/123?type=expense`

**Layout:** (Single card - follows UI guidelines)
```
┌────────────────────────────────────────────────┐
│ [Badge: 💰 EXPENSE / 💵 INCOME]                │
│                                                │
│ Transaction Details                            │
│ ┌──────────────────────────────────────────┐  │
│ │ Date        | Amount     | Mode  | Type  │  │
│ │ 23 Jan 2026 | ₹10,000   | Bank  | BILL  │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ Vendor Information                             │
│ ┌──────────────────────────────────────────┐  │
│ │ Name: ABC Company Pvt Ltd                │  │
│ │ Contact: +91-9876543210                  │  │
│ │ Email: abc@example.com                   │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ Allocation Details                             │
│ ┌────────────────────────────────────────────┐ │
│ │ Invoice │ Date │ Total │ Allocated │Status│ │
│ ├─────────┼──────┼───────┼───────────┼──────┤ │
│ │ INV-123 │ ... │₹8,000 │ ₹5,000   │Partial│ │
│ │ INV-124 │ ... │₹7,000 │ ₹5,000   │Full  │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ Summary                                        │
│ ┌──────────────────────────────────────────┐  │
│ │ Total Amount:    ₹10,000                 │  │
│ │ Total Allocated: ₹10,000                 │  │
│ │ Advance/Diff:    ₹0                      │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ Notes: Payment for pending invoices            │
│                                                │
│ Actions: [Edit] [Export PDF] [Delete]         │
└────────────────────────────────────────────────┘
```

**API Integration:**
```typescript
const fetchTransaction = async (id: string, type: string) => {
  const endpoint = type === 'expense'
    ? `/api/vendor-payments/${id}`
    : `/api/vendor-refunds/${id}`
  
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error('Transaction not found')
  
  const data = await response.json()
  return data.data
}
```

**Features:**
- Auto-detect transaction type from URL parameter
- Display all transaction details in single card
- Show vendor information
- Display allocation table with bill/return details
- Summary section with totals
- Edit button → Navigate to create page with edit params
- Export functionality (PDF)
- Optional: Delete functionality with confirmation

**Estimated Time:** 3-4 hours

---

#### **Task 2.3: Update Create Page for Edit Support** ⏳

**File:** `pages/entry/vendor-transaction.tsx`

**Changes Required:**

1. **Detect Edit Mode:**
```typescript
const router = useRouter()
const { edit, type } = router.query
const isEditMode = !!edit
const [transactionId, setTransactionId] = useState<number>(0)
```

2. **Fetch Transaction Data on Mount:**
```typescript
useEffect(() => {
  if (isEditMode && edit && type) {
    fetchTransactionForEdit(edit as string, type as string)
  }
}, [edit, type, isEditMode])

const fetchTransactionForEdit = async (id: string, type: string) => {
  const endpoint = type === 'expense'
    ? `/api/vendor-payments/${id}`
    : `/api/vendor-refunds/${id}`
  
  const response = await fetch(endpoint)
  const { data } = await response.json()
  
  // Populate form
  setTransactionId(data.id)
  setSelectedVendor(data.vendor.id)
  setOperationType(type === 'expense' ? 'EXPENSE' : 'INCOME')
  setPaymentType(data.payment_type)
  setAmount(data.payment_amount || data.refund_amount)
  setMode(data.payment_mode || data.refund_mode)
  setDate(new Date(data.payment_date || data.refund_date).toISOString().split('T')[0])
  setNotes(data.notes || '')
  
  // Set allocations
  if (type === 'expense') {
    setOutstandingBills(data.allocations.map(a => ({
      purchase_id: a.purchase_id,
      invoice_no: a.invoice_no,
      // ... populate with fetched data
      allocated: a.allocated_amount
    })))
  } else {
    setOutstandingReturns(data.allocations.map(a => ({
      return_id: a.return_id,
      return_no: a.debit_note_no,
      // ... populate with fetched data
      allocated: a.allocated_amount
    })))
  }
}
```

3. **Update Submit Logic:**
```typescript
const confirmRecordTransaction = async () => {
  setLoading(true)
  try {
    const method = isEditMode ? 'PUT' : 'POST'
    
    let endpoint = ''
    if (operationType === 'EXPENSE') {
      endpoint = isEditMode 
        ? `/api/vendor-payments/${transactionId}`
        : '/api/vendor-payments'
    } else {
      endpoint = isEditMode
        ? `/api/vendor-refunds/${transactionId}`
        : '/api/vendor-refunds'
    }
    
    const payload = { /* ... same as before ... */ }
    
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    const data = await res.json()
    
    if (res.ok && data.success) {
      showSnackbar('success', `Transaction ${isEditMode ? 'updated' : 'created'} successfully!`)
      router.push('/vendor-transactions')
    }
  } catch (error) {
    // Handle error
  } finally {
    setLoading(false)
  }
}
```

4. **Update Page Title:**
```typescript
<h1 className="text-2xl font-semibold text-slate-200">
  {isEditMode ? 'Edit' : 'Record'} Vendor Transaction
</h1>
```

**Estimated Time:** 1-2 hours

---

### **PHASE 3: Testing & Polish** (2-4 hours)

#### **Task 3.1: End-to-End Testing** ⏳

**Test Scenarios:**

1. **EXPENSE Transactions:**
   - ✅ Create new payment (BILL_SPECIFIC)
   - ✅ Create new payment (MIXED)
   - ✅ Create new payment (DIRECT)
   - ✅ View payment details
   - ✅ Edit payment amount
   - ✅ Edit payment allocations
   - ✅ Delete payment (if implemented)
   - ✅ Verify vendor balance updates
   - ✅ Verify ledger entries

2. **INCOME Transactions:**
   - ✅ Create new refund (RETURN_SPECIFIC)
   - ✅ Create new refund (DIRECT)
   - ✅ View refund details
   - ✅ Edit refund amount
   - ✅ Edit refund allocations
   - ✅ Delete refund (if implemented)
   - ✅ Verify vendor balance updates
   - ✅ Verify ledger entries

3. **UI/UX:**
   - ✅ Tab switching works smoothly
   - ✅ Filters apply correctly
   - ✅ Pagination works
   - ✅ Search functionality
   - ✅ Export functionality
   - ✅ Mobile responsiveness
   - ✅ Loading states
   - ✅ Error handling

**Estimated Time:** 2-3 hours

---

#### **Task 3.2: Bug Fixes & Polish** ⏳

- Fix any discovered bugs
- Improve loading states
- Add better error messages
- Polish UI details
- Add animations/transitions
- Performance optimization

**Estimated Time:** 1-2 hours

---

## 🔧 TECHNICAL SPECIFICATIONS

### **API Response Formats:**

#### **GET /api/vendor-payments (List)**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "vendor_id": 5,
      "vendor_name": "ABC Company",
      "payment_date": 1706054400,
      "payment_amount": 10000,
      "payment_mode": 1,
      "payment_type": "BILL_SPECIFIC",
      "notes": "Payment for invoices",
      "fy": 2024,
      "allocations": [...]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2
  }
}
```

#### **GET /api/vendor-payments/[id] (Single)**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "vendor": {
      "id": 5,
      "name": "ABC Company",
      "contact": "+91-9876543210",
      "email": "abc@example.com"
    },
    "payment_date": 1706054400,
    "payment_amount": 10000,
    "payment_mode": 1,
    "payment_mode_text": "Bank",
    "payment_type": "BILL_SPECIFIC",
    "notes": "Payment for pending invoices",
    "fy": 2024,
    "allocations": [
      {
        "allocation_id": 1,
        "purchase_id": 123,
        "invoice_no": 1001,
        "invoice_date": 1706054400,
        "allocated_amount": 5000,
        "purchase_total": 8000,
        "payment_status": 2,
        "payment_status_text": "Partially Paid"
      }
    ],
    "summary": {
      "payment_amount": 10000,
      "total_allocated": 10000,
      "allocation_count": 2,
      "difference": 0
    }
  }
}
```

#### **PUT /api/vendor-payments/[id] (Update)**
Request:
```json
{
  "payment_amount": 12000,
  "payment_date": 1706054400,
  "payment_mode": 1,
  "payment_type": "BILL_SPECIFIC",
  "notes": "Updated payment",
  "allocations": [
    {
      "purchase_id": 123,
      "allocated_amount": 6000
    },
    {
      "purchase_id": 124,
      "allocated_amount": 6000
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "message": "Payment updated successfully",
  "data": {
    "payment": { /* updated payment */ },
    "allocations": [ /* updated allocations */ ]
  }
}
```

---

## ⚠️ IMPORTANT CONSIDERATIONS

### **Edit Restrictions:**

Should prevent editing if:
- Financial year is closed
- Related purchases/returns have been deleted
- Complex downstream operations depend on this transaction

### **Ledger Entries:**

When editing, **create adjustment entries** (don't update existing):
- `PAYMENT_ADJUSTMENT` - for payment amount/allocation changes
- `REFUND_ADJUSTMENT` - for refund amount/allocation changes

### **Balance Updates:**

Must update vendor balance correctly:
```typescript
// If amount increases
await balanceHandler.incrementBalanceInTransaction(tx, vendor_id, {
  total_paid: amountDiff  // positive value
})

// If amount decreases
await balanceHandler.incrementBalanceInTransaction(tx, vendor_id, {
  total_paid: amountDiff  // negative value
})

// If allocations change
await balanceHandler.incrementBalanceInTransaction(tx, vendor_id, {
  total_allocated: allocDiff  // can be positive or negative
})
```

### **Transaction Safety:**

All operations must be in transaction:
```typescript
await prisma.$transaction(async (tx) => {
  // All database operations here
}, {
  timeout: 45000  // 45 seconds
})
```

---

## 📊 ESTIMATED TIMELINE

| Phase | Task | Estimated Time |
|-------|------|----------------|
| **Phase 1** | Backend APIs | **4-6 hours** |
| 1.1 | PUT /api/vendor-payments/[id] | 2-3 hours |
| 1.2 | PUT /api/vendor-refunds/[id] | 2-3 hours |
| **Phase 2** | Frontend Pages | **7-10 hours** |
| 2.1 | Landing page | 3-4 hours |
| 2.2 | View page | 3-4 hours |
| 2.3 | Update create page | 1-2 hours |
| **Phase 3** | Testing & Polish | **2-4 hours** |
| 3.1 | E2E testing | 2-3 hours |
| 3.2 | Bug fixes & polish | 1-2 hours |
| **TOTAL** | | **13-20 hours** |

---

## ✅ SUCCESS CRITERIA

1. ✅ Users can view list of all transactions (payments and refunds)
2. ✅ Users can switch between EXPENSE and INCOME tabs
3. ✅ Users can filter transactions by vendor, date, mode, type
4. ✅ Users can click a transaction to view details
5. ✅ Users can edit existing transactions
6. ✅ All operations update vendor balance correctly
7. ✅ All operations create proper ledger entries
8. ✅ All operations are transaction-safe (atomic)
9. ✅ UI follows existing design patterns (single card layout)
10. ✅ Code is well-documented and maintainable

---

## 📝 NOTES

- Keep existing create page URL unchanged (`/entry/vendor-transaction`)
- Operation type selection remains in create page (removed from landing)
- Backend separation (different tables) is unavoidable
- Frontend unification provides better UX
- Follow existing patterns from purchases/sales modules
- Ensure mobile responsiveness
- Add proper loading states and error handling
- Test thoroughly before marking complete

---

**END OF PLAN**
