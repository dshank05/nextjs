# Debit & Credit Note Implementation Plan

**Document Version:** 1.0  
**Created:** November 30, 2025  
**Status:** Planning Phase

---

## Overview

This document outlines the complete implementation plan for adding proper debit notes (purchase returns) and credit notes (sale returns) with integrated ledger tracking system.

---

## Implementation Phases

### ✅ Phase 1: Enable Tax in Purchases (PRIORITY 1)
**Goal:** Add optional tax toggle for purchases to support both tax-inclusive and tax-exclusive scenarios

#### 1.1 Database Changes

```sql
-- Add enable_tax field to purchase table
ALTER TABLE purchase ADD COLUMN enable_tax BOOLEAN DEFAULT true AFTER total;

-- Add index for performance
CREATE INDEX idx_purchase_enable_tax ON purchase(enable_tax);
```

#### 1.2 API Changes

**File:** `pages/api/purchases/[id].ts`
- Update GET endpoint to include `enable_tax` field
- Update PUT endpoint to accept `enable_tax` parameter
- Modify tax calculation logic to conditionally calculate based on flag

**File:** `pages/api/purchases/index.ts`
- Update POST endpoint to accept `enable_tax` parameter
- Conditionally calculate tax fields (CGST, SGST, IGST) based on flag

#### 1.3 UI Changes

**File:** `pages/purchases/create.tsx`
- Add "Enable Tax" checkbox near the top of the form
- Show/hide tax-related fields based on checkbox state
- Update calculations to include/exclude tax based on flag
- Default to `true` (tax enabled) for backward compatibility

**File:** `pages/purchases/view/[id].tsx`
- Display tax status (enabled/disabled)
- Show tax breakdown only if enabled

#### 1.4 Business Logic

```javascript
// Tax Calculation Logic
if (enable_tax) {
  const subtotal = qty * rate;
  const taxAmount = (subtotal * gst_percentage) / 100;
  
  // Determine CGST/SGST vs IGST based on vendor state
  if (vendorStateCode === BUSINESS_STATE_CODE) {
    cgst = taxAmount / 2;
    sgst = taxAmount / 2;
    igst = 0;
  } else {
    cgst = 0;
    sgst = 0;
    igst = taxAmount;
  }
  
  total = subtotal + taxAmount;
} else {
  // No tax calculation
  cgst = 0;
  sgst = 0;
  igst = 0;
  total = qty * rate;
}
```

#### 1.5 Testing Checklist

- [ ] Create purchase with tax enabled
- [ ] Create purchase with tax disabled
- [ ] Verify tax calculations are correct when enabled
- [ ] Verify no tax calculations when disabled
- [ ] Edit existing purchase and toggle tax
- [ ] Verify backward compatibility (existing purchases show tax)
- [ ] Test with intra-state vendor (CGST/SGST)
- [ ] Test with inter-state vendor (IGST)

---

### ✅ Phase 2: Enable Tax in Purchase Returns (PRIORITY 2)
**Goal:** Add tax toggle for purchase returns with inheritance from original purchase

#### 2.1 Database Changes

```sql
-- Add enable_tax field to purchase_returns table
ALTER TABLE purchase_returns ADD COLUMN enable_tax BOOLEAN DEFAULT true AFTER total_tax;

-- Add index
CREATE INDEX idx_purchase_returns_enable_tax ON purchase_returns(enable_tax);
```

#### 2.2 API Changes

**File:** `pages/api/purchase-returns/[id].ts`
- Update GET endpoint to include `enable_tax` field
- Update PUT endpoint to accept `enable_tax` parameter
- Modify tax calculations conditionally

**File:** `pages/api/purchase-returns/vendor-return.ts`
- Update POST endpoint to accept `enable_tax` parameter
- Option to inherit tax setting from original purchase
- Conditionally calculate tax breakdown

#### 2.3 UI Changes

**File:** `pages/entry/purchasereturn-vendor-create.tsx`
- Add "Enable Tax" checkbox
- Auto-populate from original purchase if available
- Show/hide tax columns in item table
- Update summary calculations

**File:** `pages/entry/purchasereturn-vendor/[id].tsx`
- Display tax status in view
- Show tax breakdown only if enabled

#### 2.4 Business Logic

```javascript
// When creating return from a purchase
const originalPurchase = await getOriginalPurchase(purchase_id);
const enable_tax = originalPurchase?.enable_tax ?? true; // Default true

// Tax calculation for return items
if (enable_tax) {
  const subtotal = return_qty * unit_price;
  const taxAmount = (subtotal * tax_rate) / 100;
  
  // CGST/SGST vs IGST logic (same as purchase)
  // ...
} else {
  // No tax
  total_tax = 0;
}
```

#### 2.5 Testing Checklist

- [ ] Create return with tax enabled
- [ ] Create return with tax disabled
- [ ] Verify tax inheritance from original purchase
- [ ] Override inherited tax setting
- [ ] Edit return and toggle tax
- [ ] Verify calculations with tax on/off
- [ ] Test refund calculations

---

### ✅ Phase 3: Ledger System (PRIORITY 3)
**Goal:** Implement party-wise ledger tracking for vendors and customers

#### 3.1 Database Schema

```sql
-- Vendor Ledger Table
CREATE TABLE vendor_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  vendor_id INT NOT NULL,
  transaction_date INT NOT NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'PURCHASE', 'DEBIT_NOTE', 'PAYMENT', 'OPENING_BALANCE'
  reference_type VARCHAR(50),            -- 'purchase', 'purchase_return', 'payment'
  reference_id INT,                      -- ID of the reference transaction
  reference_no VARCHAR(100),             -- Display number (invoice/DN/payment ref)
  
  -- Payment tracking
  payment_mode INT,                      -- 0=Cash, 1=Bank
  payment_status INT,                    -- 0=Unpaid, 1=Paid
  payment_date INT,                      -- When payment was made
  
  -- Accounting columns
  debit FLOAT DEFAULT 0,                 -- Money you OWE vendor (purchases)
  credit FLOAT DEFAULT 0,                -- Money vendor OWES you (returns, payments)
  balance FLOAT NOT NULL,                -- Running balance
  
  -- Additional info
  notes TEXT,
  fy INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (vendor_id) REFERENCES vendor_details(id) ON DELETE CASCADE,
  
  INDEX idx_vendor_ledger_vendor_date (vendor_id, transaction_date),
  INDEX idx_vendor_ledger_type (transaction_type),
  INDEX idx_vendor_ledger_fy (fy),
  INDEX idx_vendor_ledger_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Customer Ledger Table
CREATE TABLE customer_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  transaction_date INT NOT NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'SALE', 'CREDIT_NOTE', 'RECEIPT', 'OPENING_BALANCE'
  reference_type VARCHAR(50),            -- 'invoice', 'invoicex', 'sale_return', 'receipt'
  reference_id INT,
  reference_no VARCHAR(100),
  
  -- Payment tracking
  payment_mode INT,
  payment_status INT,
  payment_date INT,
  
  -- Accounting columns
  debit FLOAT DEFAULT 0,                 -- Money customer OWES you (sales)
  credit FLOAT DEFAULT 0,                -- Money you OWE customer (returns, receipts)
  balance FLOAT NOT NULL,
  
  notes TEXT,
  fy INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customer_details(id) ON DELETE CASCADE,
  
  INDEX idx_customer_ledger_customer_date (customer_id, transaction_date),
  INDEX idx_customer_ledger_type (transaction_type),
  INDEX idx_customer_ledger_fy (fy),
  INDEX idx_customer_ledger_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 3.2 Ledger Posting Logic

**Auto-posting triggers:**

1. **Purchase Created**
```javascript
// Post to vendor_ledger
await createLedgerEntry({
  vendor_id: purchase.vendor_id,
  transaction_date: purchase.invoice_date,
  transaction_type: 'PURCHASE',
  reference_type: 'purchase',
  reference_id: purchase.id,
  reference_no: purchase.invoice_no,
  payment_mode: purchase.payment_mode,
  payment_status: purchase.payment_status,
  debit: purchase.total,  // You owe vendor
  credit: 0,
  balance: previousBalance + purchase.total,
  fy: purchase.fy
});

// If cash/paid immediately, post payment
if (purchase.payment_mode === 0 || purchase.payment_status === 1) {
  await createLedgerEntry({
    // ... payment entry (credit)
    credit: purchase.total,
    balance: previousBalance
  });
}
```

2. **Debit Note Created (Purchase Return)**
```javascript
await createLedgerEntry({
  vendor_id: return.vendor_id,
  transaction_type: 'DEBIT_NOTE',
  reference_type: 'purchase_return',
  reference_id: return.id,
  reference_no: return.debit_note_no, // Phase 4
  debit: 0,
  credit: return.total_amount,  // Vendor owes you
  balance: previousBalance - return.total_amount
});
```

3. **Sale Created**
```javascript
await createLedgerEntry({
  customer_id: invoice.select_customer,
  transaction_type: 'SALE',
  reference_type: 'invoice',
  debit: invoice.total,  // Customer owes you
  credit: 0,
  balance: previousBalance + invoice.total
});
```

4. **Credit Note Created (Sale Return)**
```javascript
await createLedgerEntry({
  customer_id: return.customer_id,
  transaction_type: 'CREDIT_NOTE',
  reference_type: 'sale_return',
  debit: 0,
  credit: return.total_amount,  // You owe customer
  balance: previousBalance - return.total_amount
});
```

#### 3.3 API Endpoints

**New APIs to create:**

```
GET  /api/ledger/vendor/[id]      - Get vendor ledger statement
GET  /api/ledger/customer/[id]    - Get customer ledger statement
GET  /api/ledger/vendor-outstanding - List all vendors with outstanding
GET  /api/ledger/customer-outstanding - List all customers with outstanding
POST /api/ledger/payment          - Record payment transaction
GET  /api/ledger/summary          - Get overall ledger summary
```

#### 3.4 Ledger Service

**File:** `lib/ledger-service.ts`

```typescript
export class LedgerService {
  // Get latest balance for a party
  async getLatestBalance(partyType: 'vendor' | 'customer', partyId: number): Promise<number> {
    const table = partyType === 'vendor' ? 'vendor_ledger' : 'customer_ledger';
    const idField = partyType === 'vendor' ? 'vendor_id' : 'customer_id';
    
    const latest = await prisma[table].findFirst({
      where: { [idField]: partyId },
      orderBy: { id: 'desc' }
    });
    
    return latest?.balance || 0;
  }
  
  // Create ledger entry with balance calculation
  async createEntry(data: LedgerEntryData): Promise<void> {
    const currentBalance = await this.getLatestBalance(data.partyType, data.partyId);
    const newBalance = currentBalance + data.debit - data.credit;
    
    await prisma[data.table].create({
      data: {
        ...data,
        balance: newBalance
      }
    });
  }
  
  // Get statement for date range
  async getStatement(partyType: string, partyId: number, fromDate: number, toDate: number) {
    // Implementation
  }
}
```

#### 3.5 Integration Points

**Modify these files to add ledger posting:**

1. `pages/api/purchases/index.ts` - POST (create purchase)
2. `pages/api/purchases/[id].ts` - PUT (update purchase)
3. `pages/api/purchase-returns/vendor-return.ts` - POST (create return)
4. `pages/api/purchase-returns/[id].ts` - PUT (update return)
5. `pages/api/invoices/index.ts` - POST (create sale)
6. `pages/api/sale-returns/index.ts` - POST (create return)

#### 3.6 Testing Checklist

- [ ] Create purchase (credit) - verify ledger entry
- [ ] Create purchase (cash) - verify immediate settlement
- [ ] Create purchase return - verify credit entry
- [ ] Get vendor statement - verify balance
- [ ] Create sale (credit) - verify ledger entry
- [ ] Create sale return - verify credit entry
- [ ] Test balance calculations
- [ ] Test outstanding reports
- [ ] Test "Other" vendor handling

---

### ✅ Phase 4: Debit/Credit Note Numbering
**Goal:** Add formal note numbering system

#### 4.1 Database Changes

```sql
-- Purchase Returns (Debit Notes)
ALTER TABLE purchase_returns ADD COLUMN debit_note_no VARCHAR(50) AFTER id;
ALTER TABLE purchase_returns ADD COLUMN note_type VARCHAR(20) DEFAULT 'DEBIT' AFTER debit_note_no;
CREATE INDEX idx_purchase_returns_debit_note_no ON purchase_returns(debit_note_no);

-- Sale Returns (Credit Notes)
ALTER TABLE sale_returns ADD COLUMN credit_note_no VARCHAR(50) AFTER id;
ALTER TABLE sale_returns ADD COLUMN note_type VARCHAR(20) DEFAULT 'CREDIT' AFTER credit_note_no;
CREATE INDEX idx_sale_returns_credit_note_no ON sale_returns(credit_note_no);

ALTER TABLE salex_returns ADD COLUMN credit_note_no VARCHAR(50) AFTER id;
ALTER TABLE salex_returns ADD COLUMN note_type VARCHAR(20) DEFAULT 'CREDIT' AFTER credit_note_no;
CREATE INDEX idx_salex_returns_credit_note_no ON salex_returns(credit_note_no);

-- Note counters table (or extend existing invoice_counter logic)
CREATE TABLE note_counters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  note_type VARCHAR(20) NOT NULL,    -- 'DEBIT', 'CREDIT'
  fy INT NOT NULL,
  last_number INT DEFAULT 0,
  UNIQUE KEY unique_note_type_fy (note_type, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 4.2 Numbering Format

```
Debit Notes:  DN-[FY]-[NUMBER]
  Example: DN-2024-001, DN-2024-002

Credit Notes: CN-[FY]-[NUMBER]
  Example: CN-2024-001, CN-2024-002
```

#### 4.3 Note Generator Service

**File:** `lib/note-counter.ts`

```typescript
export async function generateNoteNumber(
  noteType: 'DEBIT' | 'CREDIT',
  fy: number
): Promise<string> {
  // Get or create counter
  let counter = await prisma.note_counters.findUnique({
    where: {
      unique_note_type_fy: { note_type: noteType, fy }
    }
  });

  if (!counter) {
    counter = await prisma.note_counters.create({
      data: { note_type: noteType, fy, last_number: 0 }
    });
  }

  // Increment
  const nextNumber = counter.last_number + 1;
  
  await prisma.note_counters.update({
    where: { id: counter.id },
    data: { last_number: nextNumber }
  });

  // Format: DN-2024-001
  const prefix = noteType === 'DEBIT' ? 'DN' : 'CN';
  const paddedNumber = String(nextNumber).padStart(3, '0');
  
  return `${prefix}-${fy}-${paddedNumber}`;
}
```

#### 4.4 Implementation

- Auto-generate note number on return creation
- Display prominently in UI
- Use in ledger entries
- Show in reports

#### 4.5 Testing Checklist

- [ ] Generate first debit note number
- [ ] Verify sequential numbering
- [ ] Test across financial years
- [ ] Generate first credit note number
- [ ] Verify numbering persistence after restart

---

### ✅ Phase 5: PDF Generation
**Goal:** Generate printable debit and credit notes

#### 5.1 Template Structure

**Debit Note PDF:**
```
┌─────────────────────────────────────────────────┐
│           DEBIT NOTE                            │
│                                                 │
│  No: DN-2024-001        Date: 30/11/2024      │
│                                                 │
│  To: [Vendor Name]                             │
│      [Address]                                 │
│      GSTIN: [GSTIN]                           │
│                                                 │
│  Original Invoice: INV-123  Date: 01/11/2024  │
│                                                 │
│  Items Returned:                               │
│  ┌──────────────┬─────┬────────┬──────────┐  │
│  │ Product      │ Qty │ Rate   │ Amount   │  │
│  ├──────────────┼─────┼────────┼──────────┤  │
│  │ Part A       │ 2   │ 500.00 │ 1,000.00 │  │
│  └──────────────┴─────┴────────┴──────────┘  │
│                                                 │
│  Subtotal:                         ₹ 1,000.00 │
│  CGST @ 9%:                        ₹    90.00 │
│  SGST @ 9%:                        ₹    90.00 │
│  Total:                            ₹ 1,180.00 │
│                                                 │
│  Reason: Defective Item                        │
│                                                 │
│  [Signature]           [Authorized Signatory] │
└─────────────────────────────────────────────────┘
```

**Credit Note PDF:** (Similar structure for sales)

#### 5.2 Implementation

**File:** `lib/pdf-templates.ts`
- Extend existing PDF generation logic
- Add `generateDebitNotePDF()`
- Add `generateCreditNotePDF()`

#### 5.3 Testing

- [ ] Generate debit note PDF
- [ ] Verify all details correct
- [ ] Generate credit note PDF
- [ ] Test print functionality

---

### ✅ Phase 6: Reports & Analytics
**Goal:** Comprehensive reporting for accounting

#### 6.1 Reports to Implement

1. **Debit Notes Register**
   - All debit notes for date range
   - Filter by vendor, status, FY
   - Export capability

2. **Credit Notes Register**
   - All credit notes for date range
   - Filter by customer, status, FY
   - Export capability

3. **Vendor Outstanding Report**
   - All vendors with pending balance
   - Age-wise analysis (30/60/90 days)
   - Payment due tracking

4. **Customer Outstanding Report**
   - All customers with pending balance
   - Age-wise analysis
   - Collection tracking

5. **Vendor Ledger Statement**
   - Party-wise transaction history
   - Date range filter
   - Running balance

6. **Customer Ledger Statement**
   - Party-wise transaction history
   - Date range filter
   - Running balance

7. **Tax Adjustment Report**
   - Input tax credit from purchases
   - Input tax credit reversal from returns
   - Output tax from sales
   - Output tax reversal from returns

#### 6.2 UI Pages

```
pages/reports/
  ├── debit-notes.tsx         (Debit notes register)
  ├── credit-notes.tsx        (Credit notes register)
  ├── vendor-outstanding.tsx  (Vendor outstanding)
  ├── customer-outstanding.tsx (Customer outstanding)
  └── ledger-statement.tsx    (Party ledger view)
```

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Phase 1: Tax toggle in purchases
- [ ] Testing and bug fixes

### Week 2: Returns Enhancement
- [ ] Phase 2: Tax toggle in purchase returns
- [ ] Testing and bug fixes

### Week 3: Ledger System - Part 1
- [ ] Phase 3: Database setup
- [ ] Phase 3: Ledger service
- [ ] Phase 3: Vendor ledger integration

### Week 4: Ledger System - Part 2
- [ ] Phase 3: Customer ledger integration
- [ ] Phase 3: API endpoints
- [ ] Testing

### Week 5: Note Numbering
- [ ] Phase 4: Database changes
- [ ] Phase 4: Number generation
- [ ] Phase 4: UI updates

### Week 6: Documentation & Reports
- [ ] Phase 5: PDF templates
- [ ] Phase 6: Reports UI
- [ ] Final testing
- [ ] Documentation

---

## Rollback Plans

### Phase 1 Rollback
```sql
ALTER TABLE purchase DROP COLUMN enable_tax;
DROP INDEX idx_purchase_enable_tax ON purchase;
```

### Phase 2 Rollback
```sql
ALTER TABLE purchase_returns DROP COLUMN enable_tax;
DROP INDEX idx_purchase_returns_enable_tax ON purchase_returns;
```

### Phase 3 Rollback
```sql
DROP TABLE vendor_ledger;
DROP TABLE customer_ledger;
-- Remove ledger posting code from APIs
```

### Phase 4 Rollback
```sql
ALTER TABLE purchase_returns DROP COLUMN debit_note_no;
ALTER TABLE purchase_returns DROP COLUMN note_type;
ALTER TABLE sale_returns DROP COLUMN credit_note_no;
ALTER TABLE sale_returns DROP COLUMN note_type;
ALTER TABLE salex_returns DROP COLUMN credit_note_no;
ALTER TABLE salex_returns DROP COLUMN note_type;
DROP TABLE note_counters;
```

---

## Key Considerations

### 1. Data Migration
- Existing purchases: Set `enable_tax = true`
- Existing returns: Set `enable_tax = true`
- Historical ledger: Consider creating opening balance entries

### 2. Performance
- Add appropriate indexes
- Use transactions for ledger posting
- Consider batch processing for reports

### 3. Validation
- Prevent negative balances (configurable)
- Validate tax calculations
- Ensure ledger balance integrity

### 4. "Other" Vendor/Customer Handling
**Option A:** No ledger tracking for "Other"
- Only track registered vendors/customers
- "Other" transactions are cash-only

**Option B:** Create generic "Other" party
- Create vendor_id = 1 as "Other/Cash"
- All unregistered transactions go here
- Optional: Skip ledger for this party

### 5. GST Compliance
- Proper tax breakdown (CGST/SGST/IGST)
- Note numbering follows GST rules
- Tax adjustment reports for filing

### 6. Audit Trail
- All ledger entries immutable
- Track created_at, updated_at
- Link to original transactions

---

## Success Criteria

- [ ] Tax can be toggled on/off in purchases
- [ ] Tax can be toggled on/off in returns
- [ ] Ledger tracks all vendor transactions
- [ ] Ledger tracks all customer transactions
- [ ] Running balance calculates correctly
- [ ] Debit notes have formal numbering
- [ ] Credit notes have formal numbering
- [ ] PDF generation works
- [ ] Reports show accurate data
- [ ] Outstanding reports work
- [ ] No regression in existing functionality

---

## Notes & Questions

1. **Tax Rates:** What happens if tax rate changes between purchase and return?
   - **Decision:** Use original purchase tax rate for return

2. **Partial Returns:** How to handle multiple returns from same purchase?
   - **Decision:** Each return gets its own debit note

3. **Payment Adjustments:** Can return amount be adjusted against outstanding?
   - **Decision:** Yes, via ledger balance adjustment

4. **Multi-FY:** How to handle returns in different FY than purchase?
   - **Decision:** Return posts in its own FY, maintains reference to original

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-30 | System | Initial draft |

---

**Next Steps:**
1. Review this document with stakeholders
2. Approve Phase 1 implementation
3. Create database backup before changes
4. Begin Phase 1: Tax toggle in purchases
