# Complete Payment Allocation Test Scenarios

**Document Version:** 2.0  
**Created:** December 9, 2025  
**Total Test Cases:** 28  
**Status:** Ready for Testing

---

## 📊 SUMMARY

| Category | Test Cases | Description |
|----------|-----------|-------------|
| **Purchase Creation** | 4 | Unpaid, paid via allocation, partial payment |
| **Purchase Edit** | 4 | Amount changes, payment status changes |
| **Payment Scenarios** | 8 | Full, partial, multiple bills, validation |
| **Return Creation** | 4 | Unpaid, refunded via allocation, partial refund |
| **Return Edit** | 2 | Edit unpaid, block paid edits |
| **Refund Scenarios** | 6 | Full, partial, multiple returns, validation |
| **TOTAL** | **28** | **Complete coverage of old + new features** |

---

## 🔄 TESTING WORKFLOW

Each test follows this pattern:
1. **Setup** - Create data via UI
2. **Verify Before** - Run `node scripts/view-test-data.js`
3. **Action** - Perform operation
4. **Verify After** - Run `node scripts/view-test-data.js`
5. **Clean Up** - Run `node scripts/clear-test-data.js` (before next test)

---

## 🛒 PURCHASE CREATION & BASIC PAYMENT (4 Tests)

### **Test 1: Create Unpaid Purchase (No Tax)** ✅

**Purpose:** Verify unpaid purchase creation and ledger entry

**Setup:**
```
1. Navigate to /purchases/create
2. Vendor: Test Vendor
3. Items: 1 product, ₹10,000
4. Tax: 0%
5. Payment Status: 0 (Unpaid)
6. Save
```

**Verify DB After:**
```bash
node scripts/view-test-data.js
```

**Expected Output:**
```
🛒 PURCHASES: 1 record
payment_status: 0 (Unpaid)
total: 10000

💰 VENDOR LEDGER: 1 record
Entry: PURCHASE (Dr ₹10,000, Cr 0) → Balance: 10,000

💵 VENDOR PAYMENTS: 0 records
🔗 PAYMENT ALLOCATIONS: 0 records
```

**Status**: [x] Pass [ ] Fail

---

### **Test 2: Create Unpaid Purchase (With Tax)** ✅

**Purpose:** Verify tax calculation in unpaid purchase

**Setup:**
```
Same as Test 1 but:
- Tax: 18% (₹1,800)
- Total: ₹11,800
```

**Expected:**
```
💰 VENDOR LEDGER:
Entry: PURCHASE (Dr ₹11,800, Cr 0) → Balance: 11,800
```

**Status**: [x] Pass [ ] Fail

---

### **Test 3: Create Purchase → Pay Full Amount** ✅

**Purpose:** Test full payment via payment allocation system

**Setup:**
```
1. Create unpaid purchase (₹11,800 with tax)
2. Verify purchase created (payment_status = 0)
```

**Action:**
```
1. Navigate to /entry/vendor-payment
2. Select vendor
3. Payment Amount: ₹11,800
4. Payment Mode: Bank (1)
5. Click "Auto Allocate"c
6. Verify shows ₹11,800 to Invoice #1
7. Click "Record Payment"
```

**Expected After Payment:**
```
🛒 PURCHASES:
payment_status: 0 → 1 (Fully Paid) ⭐

💵 VENDOR PAYMENTS: 1 record ⭐ NEW
amount: 11800, mode: Bank

🔗 PAYMENT ALLOCATIONS: 1 record ⭐ NEW
payment_id: 1, purchase_id: 1, allocated_amount: 11800

💰 VENDOR LEDGER: 2 records
Entry 1: PURCHASE (Dr ₹11,800)
Entry 2: PAYMENT (Cr ₹11,800) → Balance: 0 ⭐
```

**Status**: [x] Pass [ ] Fail
**Retested**: 12/9/2025 - PASSED ✅

---

### **Test 4: Create Purchase → Pay Partial Amount** ✅

**Purpose:** Test partial payment and payment_status = 2

**Setup:**
```
Create unpaid purchase (₹11,800)
```

**Action:**
```
Pay ₹5,000 via /entry/vendor-payment
```

**Expected:**
```
payment_status: 0 → 2 (Partially Paid) ⭐
Balance: 11800 → 6800 (₹6,800 outstanding)
```

**Status**: [x] Pass [ ] Fail

---

## ✏️ PURCHASE EDIT & PAYMENT CHANGES (4 Tests)

### **Test 5: Edit Unpaid Purchase (Amount Change Only)** ✅

**Purpose:** Test amount adjustment for unpaid purchase

**Setup:**
```
Create unpaid purchase (₹10,000)
```

**Action:**
```
Edit amount: ₹10,000 → ₹15,000
```

**Expected Ledger:**
```
Entry 1: PURCHASE (Dr ₹10,000)
Entry 2: PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: 15,000
```

**Status**: [x] Pass [ ] Fail

---

### **Test 6: Create Unpaid → Pay Later → Edit Amount** ✅

**Purpose:** Test payment then amount adjustment

**Setup:**
```
1. Create unpaid purchase (₹10,000)
2. Pay ₹10,000 via /entry/vendor-payment
```

**Action:**
```
Edit purchase amount: ₹10,000 → ₹15,000
```

**Expected Ledger:**
```
Entry 1: PURCHASE (Dr ₹10,000)
Entry 2: PAYMENT (Cr ₹10,000) via allocation
Entry 3: PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: 5,000 ⭐
Entry 4: PAYMENT_ADJUSTMENT (Cr ₹5,000) → Balance: 0
```

**Expected Tables:**
```
payment_allocations: allocated_amount updated to 15000
```

**Status**: [x] Pass [ ] Fail

---

### **Test 7: Pay Full → Edit Amount (While Paid)** ✅

**Purpose:** Test amount change on fully paid purchase

**Setup:**
```
1. Create unpaid purchase (₹10,000)
2. Pay ₹10,000 (fully paid)
3. payment_status = 1
```

**Action:**
```
Edit amount: ₹10,000 → ₹15,000 (while paid)
```

**Expected:**
```
PURCHASE_ADJUSTMENT: Dr ₹5,000
PAYMENT_ADJUSTMENT: Cr ₹5,000
Balance: 0 (still fully paid)
payment_allocations: amount updated to 15000
```

**Status**: [x] Pass [ ] Fail

---

### **Test 8: Reverse Payment (Unmark as Paid)** ✅

**Purpose:** Test payment reversal via allocation system

**Setup:**
```
1. Create purchase (₹10,000)
2. Pay ₹10,000 fully
```

**Action:**
```
Delete/reverse the payment via system
(Implementation depends on UI - may need reversal API)
```

**Expected:**
```
Creates reversal records:
- vendor_payments: amount = -10000 (reversal)
- payment_allocations: amount = -10000 (reversal)
- PAYMENT_REVERSAL ledger entry (Dr ₹10,000)
Balance: 0 → 10,000
payment_status: 1 → 0
```

**Status**: [ ] Pass [ ] Fail

---

## 💵 ADVANCED PAYMENT SCENARIOS (8 Tests)

### **Test 9: Multiple Partial Payments → Full Payment** ✅

**Purpose:** Test payment status progression (0→2→1)

**Setup:**
```
Create unpaid purchase (₹10,000)
```

**Actions:**
```
Payment 1: ₹3,000 → payment_status = 2 (Partial)
Payment 2: ₹4,000 → payment_status = 2 (Still Partial)
Payment 3: ₹3,000 → payment_status = 1 (Fully Paid)
```

**Expected:**
```
vendor_payments: 3 records
payment_allocations: 3 records (all to same purchase)
Balance: 10000 → 7000 → 3000 → 0
```

**Status**: [x] Pass [ ] Fail

---

### **Test 10: One Payment → Multiple Bills** ✅

**Purpose:** Test payment allocation across multiple purchases

**Setup:**
```
Create 3 unpaid purchases:
- Purchase 1: ₹10,000
- Purchase 2: ₹15,000
- Purchase 3: ₹20,000
Total: ₹45,000
```

**Action:**
```
One payment of ₹30,000 allocated:
- Purchase 1: ₹10,000 (full)
- Purchase 2: ₹15,000 (full)
- Purchase 3: ₹5,000 (partial)
```

**Expected:**
```
vendor_payments: 1 record (₹30,000)
payment_allocations: 3 records
Purchase 1: payment_status = 1
Purchase 2: payment_status = 1
Purchase 3: payment_status = 2 (₹15,000 outstanding)
Ledger: 3 PAYMENT entries
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 11: Auto-Allocate Feature** ✅

**Purpose:** Test auto-allocation of payment to bills

**Setup:**
```
Create 3 unpaid purchases:
- Purchase 1: ₹5,000
- Purchase 2: ₹10,000
- Purchase 3: ₹15,000
```

**Action:**
```
Payment: ₹20,000
Click "Auto Allocate"
```

**Expected Auto-Allocation:**
```
Purchase 1: ₹5,000 (full)
Purchase 2: ₹10,000 (full)
Purchase 3: ₹5,000 (partial) ⭐ Oldest bills first
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 12: Overpayment Validation (Should Fail)** ❌

**Purpose:** Test validation prevents overpayment

**Setup:**
```
Create 1 unpaid purchase: ₹10,000
```

**Action:**
```
Try to pay ₹15,000 to this single bill
```

**Expected Result:**
```
❌ API Error: "Allocation would exceed bill amount"
❌ No records created in any table
✅ Validation working
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 13: Payment with Cash Mode** ✅

**Purpose:** Test payment mode = Cash (0)

**Setup:**
```
Create unpaid purchase (₹10,000)
```

**Action:**
```
Pay ₹10,000 with Payment Mode: Cash (0)
```

**Expected:**
```
vendor_payments: mode = 0 (Cash) ⭐
Rest same as Test 3
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 14: Payment History Display** ✅

**Purpose:** Verify payment history shows correctly

**Setup:**
```
1. Create purchase (₹10,000)
2. Make 3 payments: ₹3k, ₹4k, ₹3k
```

**Action:**
```
View purchase detail page
Check payment history section
```

**Expected UI:**
```
Payment History Table:
┌────────────┬────────┬──────┬────────────┐
│ Date       │ Amount │ Mode │ Allocation │
├────────────┼────────┼──────┼────────────┤
│ 12/9/2025  │ 3,000  │ Bank │ #1         │
│ 12/9/2025  │ 4,000  │ Bank │ #2         │
│ 12/9/2025  │ 3,000  │ Bank │ #3         │
└────────────┴────────┴──────┴────────────┘
Total Paid: ₹10,000
Status: Fully Paid
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 15: Outstanding Bills List** ✅

**Purpose:** Verify outstanding bills API

**Setup:**
```
Create 5 purchases for same vendor:
- 2 fully paid
- 2 partially paid
- 1 unpaid
```

**Action:**
```
Call API: GET /api/purchases?vendor=X&status=0,2
OR check /entry/vendor-payment screen outstanding bills
```

**Expected:**
```
Returns only 3 purchases (2 partial + 1 unpaid)
Correct outstanding amounts shown
Fully paid purchases excluded
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 16: Payment Summary per Purchase** ✅

**Purpose:** Verify purchase payment summary

**Setup:**
```
1. Create purchase (₹50,000)
2. Pay ₹30,000 (partial)
```

**Action:**
```
View purchase detail or call summary API
```

**Expected:**
```
Total Bill: ₹50,000
Total Paid: ₹30,000
Outstanding: ₹20,000
Payment Status: Partially Paid (2)
Payment Count: 1
```

**Status**: [ ] Pass [ ] Fail

---

## 🔄 RETURN CREATION & BASIC REFUND (4 Tests)

### **Test 17: Create Unpaid Return (No Tax)** ✅

**Purpose:** Verify unpaid return creation

**Setup:**
```
1. Navigate to /entry/purchasereturn-vendor-create
2. Select vendor
3. Return Amount: ₹5,000
4. Tax: 0%
5. Payment Status: 0 (Unpaid)
6. Save
```

**Expected:**
```
💰 VENDOR LEDGER:
Entry: DEBIT_NOTE (Dr 0, Cr ₹5,000) → Balance: -5,000

💰 VENDOR REFUNDS: 0 records
🔗 REFUND ALLOCATIONS: 0 records
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 18: Create Unpaid Return (With Tax)** ✅

**Purpose:** Verify tax in unpaid return

**Setup:**
```
Same as Test 17 but:
- Return: ₹5,000
- Tax: 18% (₹900)
- Total Refund: ₹5,900
```

**Expected:**
```
DEBIT_NOTE: Cr ₹5,900 → Balance: -5,900
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 19: Create Return → Receive Full Refund** ✅

**Purpose:** Test full refund via refund allocation

**Setup:**
```
1. Create unpaid return (₹5,900 with tax)
2. Verify return created (payment_status = 0)
```

**Action:**
```
1. Navigate to /entry/vendor-refund
2. Select vendor
3. Refund Amount: ₹5,900
4. Refund Mode: Bank (1)
5. Click "Auto Allocate"
6. Click "Record Refund"
```

**Expected:**
```
payment_status: 0 → 1 (Fully Refunded) ⭐

💰 VENDOR REFUNDS: 1 record
amount: 5900, mode: Bank

🔗 REFUND ALLOCATIONS: 1 record
refund_id: 1, return_id: 1, allocated_amount: 5900

💰 VENDOR LEDGER:
Entry 1: DEBIT_NOTE (Cr ₹5,900)
Entry 2: REFUND_RECEIVED (Dr ₹5,900) → Balance: 0
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 20: Create Return → Receive Partial Refund** ✅

**Purpose:** Test partial refund and payment_status = 2

**Setup:**
```
Create unpaid return (₹5,900)
```

**Action:**
```
Receive refund of ₹3,000 via /entry/vendor-refund
```

**Expected:**
```
payment_status: 0 → 2 (Partially Refunded) ⭐
Balance: -5900 → -2900 (₹2,900 still owed by vendor)
```

**Status**: [ ] Pass [ ] Fail

---

## 🔧 RETURN EDIT SCENARIOS (2 Tests)

### **Test 21: Edit Unpaid Return (Amount Change)** ✅

**Purpose:** Verify unpaid return can be edited

**Setup:**
```
Create unpaid return (₹5,000)
```

**Action:**
```
Edit amount: ₹5,000 → ₹7,000
```

**Expected:**
```
✅ Edit allowed
DEBIT_NOTE updated: Cr ₹7,000
No refund_allocations (still unpaid)
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 22: Try to Edit Refunded Return (Should Block)** ❌

**Purpose:** Verify refunded return cannot be edited

**Setup:**
```
1. Create return (₹5,000)
2. Receive full refund
3. payment_status = 1
```

**Action:**
```
Try to edit the return
```

**Expected:**
```
❌ Edit blocked
❌ Error message shown
✅ Refund allocations prevent edit
```

**Status**: [ ] Pass [ ] Fail

---

## 💰 ADVANCED REFUND SCENARIOS (6 Tests)

### **Test 23: Multiple Partial Refunds → Full Refund** ✅

**Purpose:** Test refund status progression (0→2→1)

**Setup:**
```
Create unpaid return (₹10,000)
```

**Actions:**
```
Refund 1: ₹4,000 → payment_status = 2 (Partial)
Refund 2: ₹3,000 → payment_status = 2 (Still Partial)
Refund 3: ₹3,000 → payment_status = 1 (Fully Refunded)
```

**Expected:**
```
vendor_refunds: 3 records
refund_allocations: 3 records (all to same return)
Balance: -10000 → -6000 → -3000 → 0
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 24: One Refund → Multiple Returns** ✅

**Purpose:** Test refund allocation across multiple returns

**Setup:**
```
Create 3 unpaid returns:
- Return 1: ₹2,000
- Return 2: ₹3,000
- Return 3: ₹5,000
Total: ₹10,000
```

**Action:**
```
One refund of ₹7,000 allocated:
- Return 1: ₹2,000 (full)
- Return 2: ₹3,000 (full)
- Return 3: ₹2,000 (partial)
```

**Expected:**
```
vendor_refunds: 1 record (₹7,000)
refund_allocations: 3 records
Return 1: payment_status = 1
Return 2: payment_status = 1
Return 3: payment_status = 2 (₹3,000 outstanding)
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 25: Auto-Allocate Refund** ✅

**Purpose:** Test auto-allocation of refund

**Setup:**
```
Create 3 unpaid returns:
- Return 1: ₹2,000
- Return 2: ₹3,000
- Return 3: ₹5,000
```

**Action:**
```
Refund: ₹7,000
Click "Auto Allocate"
```

**Expected:**
```
Return 1: ₹2,000 (full)
Return 2: ₹3,000 (full)
Return 3: ₹2,000 (partial)
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 26: Over-Refund Validation (Should Fail)** ❌

**Purpose:** Test validation prevents over-refund

**Setup:**
```
Create 1 unpaid return: ₹5,000
```

**Action:**
```
Try to receive ₹7,000 refund on this return
```

**Expected:**
```
❌ API Error: "Allocation would exceed return amount"
❌ No records created
✅ Validation working
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 27: Refund History Display** ✅

**Purpose:** Verify refund history shows correctly

**Setup:**
```
1. Create return (₹10,000)
2. Receive 3 refunds: ₹4k, ₹3k, ₹3k
```

**Action:**
```
View return detail page
Check refund history section
```

**Expected UI:**
```
Refund History Table showing all 3 refunds
Total Refunded: ₹10,000
Status: Fully Refunded
```

**Status**: [ ] Pass [ ] Fail

---

### **Test 28: Outstanding Returns List** ✅

**Purpose:** Verify outstanding returns API

**Setup:**
```
Create 5 returns for same vendor:
- 2 fully refunded
- 2 partially refunded
- 1 unpaid
```

**Action:**
```
Check /entry/vendor-refund screen outstanding returns
```

**Expected:**
```
Returns only 3 returns (2 partial + 1 unpaid)
Correct outstanding refund amounts shown
Fully refunded returns excluded
```

**Status**: [ ] Pass [ ] Fail

---

## 📋 COMPLETE TESTING CHECKLIST

### **Purchase Creation** (4 tests)
- [ ] Test 1: Unpaid (No Tax)
- [ ] Test 2: Unpaid (With Tax)
- [ ] Test 3: Pay Full via Allocation
- [ ] Test 4: Pay Partial via Allocation

### **Purchase Edit** (4 tests)
- [ ] Test 5: Edit Unpaid Amount
- [ ] Test 6: Pay → Edit Amount
- [ ] Test 7: Paid → Edit Amount
- [ ] Test 8: Reverse Payment

### **Payment Scenarios** (8 tests)
- [ ] Test 9: Multiple Partial Payments
- [ ] Test 10: One Payment → Multiple Bills
- [ ] Test 11: Auto-Allocate
- [ ] Test 12: Overpayment Validation
- [ ] Test 13: Cash Mode Payment
- [ ] Test 14: Payment History
- [ ] Test 15: Outstanding Bills
- [ ] Test 16: Payment Summary

### **Return Creation** (4 tests)
- [ ] Test 17: Unpaid (No Tax)
- [ ] Test 18: Unpaid (With Tax)
- [ ] Test 19: Receive Full Refund
- [ ] Test 20: Receive Partial Refund

### **Return Edit** (2 tests)
- [ ] Test 21: Edit Unpaid Return
- [ ] Test 22: Block Refunded Edit

### **Refund Scenarios** (6 tests)
- [ ] Test 23: Multiple Partial Refunds
- [ ] Test 24: One Refund → Multiple Returns
- [ ] Test 25: Auto-Allocate Refund
- [ ] Test 26: Over-Refund Validation
- [ ] Test 27: Refund History
- [ ] Test 28: Outstanding Returns

---

## 🔍 DATABASE VERIFICATION QUERIES

### **After Each Test:**

```sql
-- 1. Check purchases
SELECT id, invoice_no, total, payment_status, payment_mode
FROM purchase
WHERE vendor_id = [test_vendor_id]
ORDER BY id;

-- 2. Check vendor payments
SELECT id, vendor_id, payment_amount, payment_mode, payment_date
FROM vendor_payments
WHERE vendor_id = [test_vendor_id]
ORDER BY id;

-- 3. Check payment allocations
SELECT pa.id, pa.payment_id, pa.purchase_id, pa.allocated_amount,
       p.invoice_no, p.total, vp.payment_amount
FROM payment_allocations pa
JOIN purchase p ON pa.purchase_id = p.id
JOIN vendor_payments vp ON pa.payment_id = vp.id
WHERE p.vendor_id = [test_vendor_id]
ORDER BY pa.id;

-- 4. Check vendor ledger
SELECT id, transaction_type, debit, credit, balance, notes
FROM vendor_ledger
WHERE vendor_id = [test_vendor_id]
ORDER BY transaction_date ASC, id ASC;

-- 5. Calculate outstanding per purchase
SELECT p.id, p.invoice_no, p.total,
       COALESCE(SUM(pa.allocated_amount), 0) as paid,
       p.total - COALESCE(SUM(pa.allocated_amount), 0) as outstanding
FROM purchase p
LEFT JOIN payment_allocations pa ON p.id = pa.purchase_id
WHERE p.vendor_id = [test_vendor_id]
GROUP BY p.id;

-- 6. Check returns
SELECT id, debit_note_no, total_amount, total_tax, payment_status
FROM purchase_returns
WHERE vendor_id = [test_vendor_id]
ORDER BY id;

-- 7. Check vendor refunds
SELECT id, vendor_id, refund_amount, refund_mode, refund_date
FROM vendor_refunds
WHERE vendor_id = [test_vendor_id]
ORDER BY id;

-- 8. Check refund allocations
SELECT ra.id, ra.refund_id, ra.return_id, ra.allocated_amount,
       pr.debit_note_no, (pr.total_amount + pr.total_tax) as total,
       vr.refund_amount
FROM refund_allocations ra
JOIN purchase_returns pr ON ra.return_id = pr.id
JOIN vendor_refunds vr ON ra.refund_id = vr.id
WHERE pr.vendor_id = [test_vendor_id]
ORDER BY ra.id;
```

---

## ✅ SUCCESS CRITERIA

### **All Tests Pass When:**
- [ ] All 28 test cases execute without errors
- [ ] Payment allocations create correctly
- [ ] Payment status calculates accurately (0/1/2)
- [ ] Refund allocations create correctly
- [ ] Refund status calculates accurately (0/1/2)
- [ ] Ledger entries match expectations
- [ ] Balances calculate correctly
- [ ] Validation prevents overpayment/over-refund
- [ ] Auto-allocate features work
- [ ] History displays correctly
- [ ] Outstanding lists accurate
- [ ] view-test-data.js shows all tables
- [ ] clear-test-data.js cleans all tables

### **Ready for Production When:**
- [ ] Critical tests pass (1-4, 9-12, 17-20, 23-26)
- [ ] No blocking bugs found
- [ ] Payment/refund calculations accurate
- [ ] Ledger balance accurate
- [ ] Documentation complete

---

## 🎯 TESTING PRIORITIES

### **CRITICAL (Must Pass)** 🔴
1. Test 1-2: Unpaid purchases
2. Test 3-4: Pay via allocation (full/partial)
3. Test 9: Multiple partial payments
4. Test 10: One payment → multiple bills
5. Test 12: Overpayment validation
6. Test 17-18: Unpaid returns
7. Test 19-20: Refund via allocation
8. Test 23: Multiple partial refunds
9. Test 24: One refund → multiple returns
10. Test 26: Over-refund validation

### **HIGH PRIORITY** 🟡
- Test 5-8: Purchase edits
- Test 14-16: Payment history/outstanding
- Test 21-22: Return edits
- Test 27-28: Refund history/outstanding

### **MEDIUM PRIORITY** 🟢
- Test 11, 13, 25: Auto-allocate and mode variations

---

## 📝 MANUAL TESTING GUIDE

### **Quick Start:**

```bash
# 1. Clear all data
node scripts/clear-test-data.js

# 2. Run a test (create data via UI)

# 3. Verify database state
node scripts/view-test-data.js

# 4. Perform action (pay/refund via UI)

# 5. Verify changes
node scripts/view-test-data.js

# 6. Clean up before next test
node scripts/clear-test-data.js
```

---

## 📚 REFERENCES

**Related Documents:**
- `PAYMENT_ALLOCATION_SYSTEM.md` - System design
- `COMPLETE_TEST_SCENARIOS.md` - Original 22 test scenarios (archived)

**API Endpoints:**
- `POST /api/vendor-payments` - Create payment
- `GET /api/vendor-payments` - List payments
- `POST /api/vendor-refunds` - Create refund
- `GET /api/vendor-refunds` - List refunds

**Helper Functions:**
- `calculatePurchasePaymentStatus()` - Calculate payment status (0/1/2)
- `calculateReturnRefundStatus()` - Calculate refund status (0/1/2)
- `validatePaymentAllocation()` - Validate payments
- `validateRefundAllocation()` - Validate refunds

---

## 🚀 FUTURE IMPROVEMENTS

### **1. Partial Payment During Purchase Creation** 💡

**Current Workflow:**
1. Create purchase (unpaid)
2. Navigate to `/entry/vendor-payment`
3. Allocate and pay

**Proposed Enhancement:**
Add "Partially Paid" option in purchase creation screen with amount field.

**Benefits:**
- Faster data entry
- Common use case
- Still uses payment allocation behind scenes

**Priority:** Medium  
**Effort:** 2-3 days  
**Target:** Phase 2

---

**Document History:**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-09 | Initial 18 payment allocation tests |
| 2.0 | 2025-12-09 | Comprehensive 28 tests covering old + new features |

---

**Document End**
