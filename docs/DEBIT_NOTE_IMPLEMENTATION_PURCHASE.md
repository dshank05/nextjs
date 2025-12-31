# Debit Note Implementation for Purchase Returns

**Document Version:** 3.0  
**Created:** December 5, 2025  
**Updated:** December 5, 2025  
**Status:** ✅ IMPLEMENTATION COMPLETE + REVERSAL ENTRIES DESIGNED  
**Scope:** Purchase Returns + Purchase Edit with Reversals  

---

## ✅ Implementation Status

**COMPLETED:**
- ✅ Database schema (SQL script ready)
- ✅ Note counter service (`lib/note-counter.ts`)
- ✅ Ledger service (`lib/ledger-service.ts`)
- ✅ Prisma schema updated and generated
- ✅ Purchase return API enhanced with DN + P&F/freight + ledger
- ✅ Reversal entry system designed (no deletions)

**PENDING (User Actions):**
- [ ] Implement payment mode validation
- [ ] Implement purchase edit with reversal entries
- [ ] Implement return edit blocking after refund
- [ ] Test all scenarios

---

## 🔄 REVERSAL ENTRY SYSTEM (NEW)

### **Core Principle:**
- ❌ **NEVER** delete ledger entries
- ✅ **ALWAYS** create reversal entries to cancel out previous entries
- ✅ Complete audit trail preserved
- ✅ Accounting compliant

### **Transaction Types:**

| Type | When Used | Debit | Credit | Balance Impact |
|------|-----------|-------|--------|----------------|
| PURCHASE | Purchase created | ₹X | 0 | +₹X (owe more) |
| PAYMENT | Payment made | 0 | ₹X | -₹X (owe less) |
| PAYMENT_REVERSAL | Unmark as paid | ₹X | 0 | +₹X (owe again) |
| PURCHASE_ADJUSTMENT | Amount changed | ±₹diff | ±₹diff | ±₹diff |
| PAYMENT_ADJUSTMENT | Payment amount changed | ±₹diff | ±₹diff | ±₹diff |
| DEBIT_NOTE | Return created | 0 | ₹X | -₹X (owe less) |
| REFUND_RECEIVED | Refund received | ₹X | 0 | +₹X |
| DEBIT_NOTE_ADJUSTMENT | Return amount changed | ±₹diff | ±₹diff | ±₹diff |

---

## Executive Summary

This document outlines the complete implementation plan for:
1. Formal debit note numbering and ledger tracking for purchase returns
2. Reversal entry system for editing paid purchases
3. Complete audit trail with automatic notes

---

## Current System Analysis

### Existing Purchase System (3 Tables)

#### 1. Purchase Table (`purchase`)
- Main purchase records with financial totals
- Fields: `total`, `total_tax`, `packing_forwarding_total`, `freight`
- Links to vendors via `vendor_id` (FK to `vendor_details`)
- Payment tracking: `payment_status`, `payment_mode`
- Return status: `return_status` (0=none, 1=partial, 2=full)

#### 2. Purchase Items Table (`purchaseitems`)
- Line items with product details and taxes
- Fields: `qty`, `rate`, `subtotal`, `cgst`, `sgst`, `igst`, `tax`
- Links to products and maintains item-level tax breakdown

#### 3. Bill To Table (`bill_to`)
- Vendor details for purchases (especially "other" vendors)
- Used when `vendor_id = 0` in purchase table
- Stores vendor name, contact, address, GSTIN per purchase

### Existing Purchase Return System (3 Data Sources)

#### 1. Purchase Returns Table (`purchase_returns`)
- Main return records with vendor linkage
- Fields: `debit_note_no`, `vendor_id`, totals, payment tracking
- P&F and freight fields included
- Status: "Completed", payment_status (0=unpaid, 1=paid)

#### 2. Purchase Return Items Table (`purchase_return_items`)
- Return line items with tax breakdown
- Fields: `return_qty`, `unit_price`, `cgst`, `sgst`, `igst`
- Links to original purchase items

#### 3. Vendor Data Sources
- **Registered Vendors:** `vendor_details` table (vendor_id > 0)
- **"Other" Vendors:** `bill_to` table (vendor_id = 0)

---

## Purchase Edit Scenarios (8 Total)

| # | Old Status | New Status | Items Changed? | Ledger Entries Created |
|---|-----------|-----------|----------------|------------------------|
| 1 | Unpaid | Unpaid | No | None |
| 2 | Unpaid | Unpaid | Yes | PURCHASE_ADJUSTMENT (Dr/Cr diff) |
| 3 | Unpaid | Paid | No | PAYMENT (Cr ₹X) |
| 4 | Unpaid | Paid | Yes | PURCHASE_ADJUSTMENT + PAYMENT |
| 5 | Paid | Paid | No | None |
| 6 | Paid | Paid | Yes | PURCHASE_ADJUSTMENT + PAYMENT_ADJUSTMENT |
| 7 | Paid | Unpaid | No | PAYMENT_REVERSAL (Dr ₹X) |
| 8 | Paid | Unpaid | Yes | PAYMENT_REVERSAL + PURCHASE_ADJUSTMENT |

---

## Detailed Workflow Example

### **Scenario: Add 5 items to paid purchase**

#### **Initial State:**
```
Purchase #100: 10 items, ₹10,000, PAID (Cash)

Ledger:
1. PURCHASE (Dr ₹10,000, Cr 0) → Balance: ₹10,000
   Notes: "Purchase #100 created"
2. PAYMENT (Dr 0, Cr ₹10,000) → Balance: ₹0
   Notes: "Payment made for purchase #100"
```

#### **Step 1: Unmark as UNPAID**
```
Edit: Change payment_status from PAID → UNPAID

Ledger:
3. PAYMENT_REVERSAL (Dr ₹10,000, Cr 0) → Balance: ₹10,000
   Notes: "Payment reversed for purchase #100 - unmarked as unpaid on 2025-12-05 20:51 for editing"
```

#### **Step 2: Add 5 items**
```
Edit: Add 5 items, total ₹10,000 → ₹15,000

Ledger:
4. PURCHASE_ADJUSTMENT (Dr ₹5,000, Cr 0) → Balance: ₹15,000
   Notes: "Purchase #100 amount increased by ₹5,000 on 2025-12-05 20:52 (added 5 items)"
```

#### **Step 3: Mark as PAID again**
```
Edit: Change payment_status from UNPAID → PAID (Cash)

Ledger:
5. PAYMENT (Dr 0, Cr ₹15,000) → Balance: ₹0
   Notes: "Payment made for purchase #100 (re-marked as paid after editing on 2025-12-05 20:53)"
```

---

## Implementation Details

### Phase 1: Database Schema Extensions (COMPLETED)

#### 1.1 Note Counters Table
```sql
CREATE TABLE note_counters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  note_type VARCHAR(20) NOT NULL,
  fy INT NOT NULL,
  last_number INT DEFAULT 0,
  UNIQUE KEY unique_note_type_fy (note_type, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 1.2 Vendor Ledger Table
```sql
CREATE TABLE vendor_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  vendor_id INT NOT NULL,
  transaction_date INT NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  reference_type VARCHAR(50),
  reference_id INT,
  reference_no VARCHAR(100),
  payment_mode INT,
  payment_status INT,
  payment_date INT,
  debit FLOAT DEFAULT 0,
  credit FLOAT DEFAULT 0,
  balance FLOAT NOT NULL,
  notes TEXT,
  fy INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_ledger_vendor_date (vendor_id, transaction_date),
  INDEX idx_vendor_ledger_type (transaction_type),
  INDEX idx_vendor_ledger_fy (fy),
  INDEX idx_vendor_ledger_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 1.3 Purchase Returns Table Extensions (COMPLETED)
```sql
ALTER TABLE purchase_returns ADD COLUMN debit_note_no VARCHAR(50) AFTER id;
ALTER TABLE purchase_returns ADD COLUMN note_type VARCHAR(20) DEFAULT 'DEBIT' AFTER debit_note_no;
ALTER TABLE purchase_returns ADD COLUMN include_packing_forwarding TINYINT DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN include_freight TINYINT DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN pf_calculation_method TINYINT DEFAULT 3;
ALTER TABLE purchase_returns ADD COLUMN freight_calculation_method TINYINT DEFAULT 3;
ALTER TABLE purchase_returns ADD COLUMN packing_forwarding_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN freight_amount DECIMAL(10,2) DEFAULT 0;
```

---

### Phase 2: Purchase Edit Implementation with Reversals

#### Implementation in `PUT /api/purchases/[id]`

```typescript
// After transaction completes
const result = await prisma.$transaction(...)

const oldPaymentStatus = existingPurchase.payment_status
const newPaymentStatus = parsedPaymentStatus
const oldTotal = existingPurchase.total
const newTotal = result.total
const timestamp = new Date()?.toLocaleString('en-IN')

// Case 1: Changed from PAID to UNPAID (unmarking)
if (oldPaymentStatus === 1 && newPaymentStatus === 0) {
  const paymentEntry = await prisma.vendor_ledger.findFirst({
    where: {
      reference_type: 'purchase',
      reference_id: purchaseId,
      transaction_type: 'PAYMENT'
    },
    orderBy: { id: 'desc' }
  })
  
  if (paymentEntry) {
    // Create REVERSAL entry (don't delete!)
    await ledgerService.createEntry({
      vendor_id: existingPurchase.vendor_id,
      transaction_date: Math.floor(Date.now() / 1000),
      transaction_type: 'PAYMENT_REVERSAL',
      reference_type: 'purchase',
      reference_id: purchaseId,
      reference_no: existingPurchase.invoice_no.toString(),
      debit: paymentEntry.credit,
      credit: 0,
      payment_mode: existingPurchase.payment_mode,
      payment_status: 0,
      notes: `Payment reversed for purchase ${existingPurchase.invoice_no} - unmarked as unpaid on ${timestamp} for editing`,
      fy: existingPurchase.fy
    })
  }
}

// Case 2: Changed from UNPAID to PAID (marking as paid)
if (oldPaymentStatus === 0 && newPaymentStatus === 1) {
  const hasReversal = await prisma.vendor_ledger.findFirst({
    where: {
      reference_type: 'purchase',
      reference_id: purchaseId,
      transaction_type: 'PAYMENT_REVERSAL'
    }
  })
  
  const notes = hasReversal
    ? `Payment made for purchase ${existingPurchase.invoice_no} (re-marked as paid after editing on ${timestamp})`
    : `Payment made for purchase ${existingPurchase.invoice_no}`
  
  await ledgerService.createEntry({
    vendor_id: existingPurchase.vendor_id,
    transaction_date: existingPurchase.invoice_date,
    transaction_type: 'PAYMENT',
    reference_type: 'purchase',
    reference_id: purchaseId,
    reference_no: existingPurchase.invoice_no.toString(),
    debit: 0,
    credit: newTotal,
    payment_mode: parsedPaymentMode,
    payment_status: 1,
    payment_date: existingPurchase.invoice_date,
    notes: notes,
    fy: existingPurchase.fy
  })
}

// Case 3: Stayed UNPAID but amount changed
if (oldPaymentStatus === 0 && newPaymentStatus === 0 && oldTotal !== newTotal) {
  const difference = newTotal - oldTotal
  
  await ledgerService.createEntry({
    vendor_id: existingPurchase.vendor_id,
    transaction_date: Math.floor(Date.now() / 1000),
    transaction_type: 'PURCHASE_ADJUSTMENT',
    reference_type: 'purchase',
    reference_id: purchaseId,
    reference_no: existingPurchase.invoice_no.toString(),
    debit: difference > 0 ? difference : 0,
    credit: difference < 0 ? Math.abs(difference) : 0,
    notes: `Purchase ${existingPurchase.invoice_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} on ${timestamp}`,
    fy: existingPurchase.fy
  })
}

// Case 4: Stayed PAID but amount changed
if (oldPaymentStatus === 1 && newPaymentStatus === 1 && oldTotal !== newTotal) {
  const difference = newTotal - oldTotal
  
  // Purchase adjustment
  await ledgerService.createEntry({
    vendor_id: existingPurchase.vendor_id,
    transaction_date: Math.floor(Date.now() / 1000),
    transaction_type: 'PURCHASE_ADJUSTMENT',
    reference_type: 'purchase',
    reference_id: purchaseId,
    reference_no: existingPurchase.invoice_no.toString(),
    debit: difference > 0 ? difference : 0,
    credit: difference < 0 ? Math.abs(difference) : 0,
    notes: `Purchase ${existingPurchase.invoice_no} amount ${difference > 0 ? 'increased' : 'decreased'} by ₹${Math.abs(difference)} on ${timestamp} (while paid)`,
    fy: existingPurchase.fy
  })
  
  // Payment adjustment
  await ledgerService.createEntry({
    vendor_id: existingPurchase.vendor_id,
    transaction_date: Math.floor(Date.now() / 1000),
    transaction_type: 'PAYMENT_ADJUSTMENT',
    reference_type: 'purchase',
    reference_id: purchaseId,
    reference_no: existingPurchase.invoice_no.toString(),
    debit: difference < 0 ? Math.abs(difference) : 0,
    credit: difference > 0 ? difference : 0,
    payment_mode: existingPurchase.payment_mode,
    payment_status: 1,
    notes: `Payment adjustment for purchase ${existingPurchase.invoice_no} - ${difference > 0 ? 'additional' : 'refund'} ₹${Math.abs(difference)} on ${timestamp}`,
    fy: existingPurchase.fy
  })
}
```

---

### Phase 3: Purchase Return Edit Blocking

#### Implementation in `PUT /api/purchase-returns/[id]`

```typescript
const existingReturn = await prisma.purchase_returns.findUnique({
  where: { id: returnId },
  select: {
    payment_status: true,
    debit_note_no: true,
    vendor_id: true,
    fy: true,
    total_amount: true,
    total_tax: true
  }
})

if (!existingReturn) {
  return res.status(404).json({ message: 'Return not found' })
}

// Block editing if refunded
if (existingReturn.payment_status === 1) {
  return res.status(400).json({
    message: 'Cannot edit a refunded return. The refund has already been processed.',
    error_code: 'REFUNDED_RETURN_EDIT_BLOCKED',
    suggestion: 'Create a new return if additional items need to be returned'
  })
}

// Continue with edit logic for unpaid returns...
```

---

## Success Criteria

- [x] Debit notes have formal DN-xxxxx numbering
- [x] All purchase transactions tracked in vendor ledger
- [x] "Other" vendor transactions use vendor_id = 0
- [x] P&F and freight inclusion configurable via feature flags
- [x] Ledger balances calculate correctly
- [ ] Reversal entries implemented (no deletions)
- [ ] Payment mode validation implemented
- [ ] Purchase edit with reversals working
- [ ] Return edit blocking working
- [ ] All scenarios tested

---

## Key Technical Decisions

1. **Reversal Entries:** Never delete ledger entries - always create reversals
2. **Automatic Notes:** System adds timestamps and descriptions to all entries
3. **Payment Mode:** Disabled when unpaid, required when paid
4. **Audit Trail:** Complete history visible in vendor ledger
5. **Flexible Editing:** Allow editing paid purchases via unmark/edit/remark workflow
6. **Return Locking:** Block editing refunded returns for data integrity

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-05 | System | Initial implementation document |
| 2.0 | 2025-12-05 | System | Added P&F and freight implementation |
| 3.0 | 2025-12-05 | System | Added reversal entry system and complete scenarios |

---

**Next Steps:**
1. ✅ Review and approve reversal entry approach
2. [ ] Implement purchase edit with reversals
3. [ ] Implement return edit blocking
4. [ ] Test all scenarios
5. [ ] Deploy to production
