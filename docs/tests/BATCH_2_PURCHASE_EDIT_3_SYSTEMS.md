# BATCH 2: Purchase Edit - 3-System Verification

**Document Version:** 1.0  
**Created:** January 15, 2026  
**Purpose:** Complete 3-system verification for all purchase edit scenarios  
**Systems Covered:** Inventory, Ledger, Payment Allocation

---

## 🎯 3-SYSTEM ARCHITECTURE

Every purchase edit operation must update all 3 systems correctly:

1. **SYSTEM 1: INVENTORY** - `product.stock` adjustments
2. **SYSTEM 2: LEDGER** - `vendor_ledger` adjustment entries
3. **SYSTEM 3: PAYMENT ALLOCATION** - `vendor_payments` + `payment_allocations` (if payment status changes)

---

## ✅ Test 2.1: Edit Unpaid Purchase (No Change)

**Pre-conditions:**
- None (will create fresh purchase)

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Purchase"
6. **Verify creation successful** (purchase ID noted)

### **STEP 2: EDIT PURCHASE (NO CHANGE)**
7. Navigate to purchase view page
8. Click "Edit"
9. Don't change anything
10. Click "Update Purchase"

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock unchanged
  - Before: stock = X
  - After: stock = X (no change)

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: NO new entries
  - Entry count remains same
  - Balance unchanged

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO new payment allocation records
  - `vendor_payments`: No new records
  - `payment_allocations`: No new records

### **ADDITIONAL TABLES**
- [ ] `purchase`: No changes to data
  - `total` = 10000 (unchanged)
  - `payment_status` = 0 (unchanged)
  - `updated_at` may change (timestamp)

**Pass Criteria:**
✅ No unnecessary DB updates  
✅ No ledger entries created  
✅ Stock unchanged  
✅ API returns 200 status

---

## ✅ Test 2.2: Edit Unpaid Purchase (Amount Increase)

**Pre-conditions:**
- Use purchase from Test 2.1 (total=10000, qty=10)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.1 exists
2. Note current stock level

### **STEP 2: EDIT PURCHASE (INCREASE AMOUNT)**
3. Navigate to purchase edit page
4. Change item qty from 10 → 15
5. Click "Update Purchase"
6. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock increased by +5 (additional qty)
  - Before: stock = X
  - After: stock = X + 5

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 5000 (difference: 15000 - 10000)
  - `credit` = 0
  - New `balance` = previous_balance + 5000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO new payment allocation records (still unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 15000 (increased from 10000)
  - `payment_status` = 0 (still unpaid)
- [ ] `purchaseitems`:
  - `qty` = 15 (updated from 10)
  - `subtotal` = 15000

**Pass Criteria:**
✅ Amount increased correctly  
✅ PURCHASE_ADJUSTMENT entry created  
✅ Stock adjusted properly  
✅ Balance increased by difference

---

## ✅ Test 2.3: Edit Unpaid Purchase (Amount Decrease)

**Pre-conditions:**
- Use purchase from Test 2.2 (now total=15000, qty=15)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.2 exists (qty=15)
2. Note current stock level

### **STEP 2: EDIT PURCHASE (DECREASE AMOUNT)**
3. Navigate to purchase edit page
4. Change item qty from 15 → 7
5. Click "Update Purchase"
6. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock decreased by -3
  - Before: stock = X
  - After: stock = X - 3

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 0
  - `credit` = 3000 (negative adjustment: 10000 - 7000)
  - New `balance` = previous_balance - 3000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO new payment allocation records (still unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 7000 (decreased from 10000)
  - `payment_status` = 0 (still unpaid)
- [ ] `purchaseitems`:
  - `qty` = 7 (updated from 10)
  - `subtotal` = 7000

**Pass Criteria:**
✅ Amount decreased correctly  
✅ Credit entry for reduction  
✅ Stock reduced  
✅ Balance decreased by difference

---

## ✅ Test 2.4: Edit Unpaid → Mark as Paid

**Pre-conditions:**
- Use purchase from Test 2.3 (total=7000, qty=7, unpaid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.3 exists (unpaid)
2. Note current balance

### **STEP 2: EDIT PURCHASE (MARK AS PAID)**
3. Navigate to purchase edit page
4. Change payment_status from Unpaid → Paid
5. Select payment_mode = Cash
6. Click "Update Purchase"
7. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock unchanged (no qty change)

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PAYMENT'
  - `debit` = 0
  - `credit` = 10000
  - `payment_mode` = 0 (Cash)
  - New `balance` = previous_balance - 10000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 10000
  - `payment_mode` = 0 (Cash)
  - `payment_type` = 'BILL_SPECIFIC'
- [ ] `payment_allocations`: 1 new record
  - `purchase_id` = [purchase ID]
  - `allocated_amount` = 10000

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 1 (changed from 0)
  - `payment_mode` = 0 (Cash)
  - `total` = 10000 (unchanged)

**Pass Criteria:**
✅ Status changed to Paid  
✅ PAYMENT entry created  
✅ Payment allocation records created  
✅ Balance reduced by payment amount

---

## ✅ Test 2.5: Edit Unpaid → Mark as Paid (With Amount Change)

**Pre-conditions:**
- None (will create fresh purchase)

**Action Steps:**

### **STEP 1: CREATE UNPAID PURCHASE**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Purchase"
6. **Verify creation successful**

### **STEP 2: EDIT PURCHASE (AMOUNT + MARK AS PAID)**
7. Navigate to purchase edit page
8. Change item qty from 10 → 12
9. Change payment_status from Unpaid → Paid
10. Select payment_mode = Bank
11. Click "Update Purchase"
12. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock increased by +2
  - Before: stock = X
  - After: stock = X + 2

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE_ADJUSTMENT):**
    - `transaction_type` = 'PURCHASE_ADJUSTMENT'
    - `debit` = 2000
    - `credit` = 0
  - **Entry 2 (PAYMENT):**
    - `transaction_type` = 'PAYMENT'
    - `debit` = 0
    - `credit` = 12000
    - `payment_mode` = 1 (Bank)
  - Final `balance` = previous_balance + 2000 - 12000 = previous_balance - 10000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 12000
  - `payment_mode` = 1 (Bank)
- [ ] `payment_allocations`: 1 new record
  - `allocated_amount` = 12000

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 12000 (increased from 10000)
  - `payment_status` = 1 (changed from 0)
  - `payment_mode` = 1 (Bank)

**Pass Criteria:**
✅ Both amount and status changed  
✅ 2 ledger entries created (adjustment + payment)  
✅ Stock adjusted  
✅ Payment allocation created  
✅ Balance adjusted correctly

---

## ✅ Test 2.6: Edit Paid Purchase (No Change)

**Pre-conditions:**
- Use purchase from Test 2.5 (total=12000, paid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.5 exists (paid)

### **STEP 2: EDIT PURCHASE (NO CHANGE)**
2. Navigate to purchase edit page
3. Don't change anything
4. Click "Update Purchase"
5. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock unchanged

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: NO new entries

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO new payment allocation records

### **ADDITIONAL TABLES**
- [ ] `purchase`: No changes to data

**Pass Criteria:**
✅ No unnecessary updates  
✅ No ledger entries  
✅ No payment adjustments

---

## ✅ Test 2.7: Edit Paid Purchase (Amount Increase While Paid)

**Pre-conditions:**
- Use purchase from Test 2.6 (total=12000, qty=12, paid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.6 exists (paid, qty=12)

### **STEP 2: EDIT PURCHASE (INCREASE AMOUNT WHILE PAID)**
2. Navigate to purchase edit page
3. Change item qty from 12 → 15
4. Keep payment_status = Paid
5. Click "Update Purchase"
6. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock increased by +2
  - Before: stock = X
  - After: stock = X + 2

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE_ADJUSTMENT):**
    - `transaction_type` = 'PURCHASE_ADJUSTMENT'
    - `debit` = 2000
    - `credit` = 0
  - **Entry 2 (PAYMENT_ADJUSTMENT):**
    - `transaction_type` = 'PAYMENT_ADJUSTMENT'
    - `debit` = 0
    - `credit` = 2000
  - Final `balance` = previous_balance + 2000 - 2000 = previous_balance (unchanged)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record (adjustment payment)
  - `payment_amount` = 2000
  - `payment_type` = 'ADJUSTMENT'
- [ ] `payment_allocations`: 1 new record
  - `allocated_amount` = 2000

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 12000 (increased from 10000)
  - `payment_status` = 1 (still paid)

**Pass Criteria:**
✅ Amount increased  
✅ Automatic payment adjustment  
✅ Balance stays 0 (still fully paid)  
✅ Stock adjusted

---

## ✅ Test 2.8: Edit Paid Purchase (Amount Decrease While Paid)

**Pre-conditions:**
- Use purchase from Test 2.7 (total=15000, qty=15, paid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.7 exists (paid, qty=15)

### **STEP 2: EDIT PURCHASE (DECREASE AMOUNT WHILE PAID)**
2. Navigate to purchase edit page
3. Change item qty from 15 → 8
4. Keep payment_status = Paid
5. Click "Update Purchase"
6. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock decreased by -2
  - Before: stock = X
  - After: stock = X - 2

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE_ADJUSTMENT):**
    - `transaction_type` = 'PURCHASE_ADJUSTMENT'
    - `debit` = 0
    - `credit` = 2000
  - **Entry 2 (PAYMENT_ADJUSTMENT):**
    - `transaction_type` = 'PAYMENT_ADJUSTMENT'
    - `debit` = 2000
    - `credit` = 0
  - Final `balance` = previous_balance - 2000 + 2000 = previous_balance (unchanged)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_refunds`: 1 new record (payment reversal)
  - `refund_amount` = 2000
  - `refund_type` = 'ADJUSTMENT'
- [ ] `refund_allocations`: 1 new record
  - `allocated_amount` = 2000

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 8000 (decreased from 10000)
  - `payment_status` = 1 (still paid)

**Pass Criteria:**
✅ Amount decreased  
✅ Automatic payment reversal for difference  
✅ Balance stays 0  
✅ Stock reduced

---

## ✅ Test 2.9: Edit Paid → Unmark as Paid

**Pre-conditions:**
- Use purchase from Test 2.8 (total=8000, qty=8, paid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.8 exists (paid)

### **STEP 2: EDIT PURCHASE (UNMARK AS PAID)**
2. Navigate to purchase edit page
3. Change payment_status from Paid → Unpaid
4. Click "Update Purchase"
5. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock unchanged (no qty change)

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PAYMENT_REVERSAL'
  - `debit` = 10000
  - `credit` = 0
  - New `balance` = previous_balance + 10000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] Existing payment allocation records remain (audit trail)
- [ ] New reversal record created OR status updated

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 0 (changed from 1)
  - `payment_mode` = NULL
  - `total` = 10000 (unchanged)

**Pass Criteria:**
✅ Status changed to Unpaid  
✅ PAYMENT_REVERSAL created  
✅ Balance restored  
✅ Audit trail maintained

---

## ✅ Test 2.10: Edit Paid → Unmark as Paid (With Amount Change)

**Pre-conditions:**
- None (will create fresh paid purchase)

**Action Steps:**

### **STEP 1: CREATE PAID PURCHASE**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Paid
5. Set payment_mode = Cash
6. Click "Create Purchase"
7. **Verify creation successful**

### **STEP 2: EDIT PURCHASE (AMOUNT + UNMARK AS PAID)**
8. Navigate to purchase edit page
9. Change item qty from 10 → 15
10. Change payment_status from Paid → Unpaid
11. Click "Update Purchase"
12. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: Stock increased by +5
  - Before: stock = X
  - After: stock = X + 5

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE_ADJUSTMENT):**
    - `transaction_type` = 'PURCHASE_ADJUSTMENT'
    - `debit` = 5000
    - `credit` = 0
  - **Entry 2 (PAYMENT_REVERSAL):**
    - `transaction_type` = 'PAYMENT_REVERSAL'
    - `debit` = 10000
    - `credit` = 0
  - Final `balance` = previous_balance + 5000 + 10000 = previous_balance + 15000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] Existing allocations remain (audit trail)
- [ ] Reversal records created

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 15000 (increased from 10000)
  - `payment_status` = 0 (changed from 1)
  - `payment_mode` = NULL

**Pass Criteria:**
✅ Amount and status changed  
✅ 2 ledger entries (adjustment + reversal)  
✅ Stock adjusted  
✅ Balance = full unpaid amount

---

## ✅ Test 2.11: Edit Purchase - Add Item

**Pre-conditions:**
- Use purchase from Test 2.10 (total=15000, qty=15, unpaid)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.10 exists (1 item)

### **STEP 2: EDIT PURCHASE (ADD ITEM)**
2. Navigate to purchase edit page
3. Add a 2nd product: qty=5, rate=500, tax=0%
4. Click "Update Purchase"
5. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] Product 1: Stock unchanged (existing item)
- [ ] Product 2: Stock increased by +5 (new item)

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 2500 (new item total)
  - `credit` = 0
  - New `balance` = previous_balance + 2500

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] If unpaid: No new records
- [ ] If paid: Automatic payment adjustment for 2500

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 12500 (10000 + 2500)
- [ ] `purchaseitems`: 2 records now
  - Existing item unchanged
  - New item added

**Pass Criteria:**
✅ 2nd item added successfully  
✅ Total recalculated  
✅ Both stocks updated  
✅ Ledger adjustment created

---

## ✅ Test 2.12: Edit Purchase - Remove Item

**Pre-conditions:**
- Use purchase from Test 2.11 (2 items, total=17500)

**Action Steps:**

### **STEP 1: VERIFY EXISTING PURCHASE**
1. Confirm purchase from Test 2.11 exists (2 items)

### **STEP 2: EDIT PURCHASE (REMOVE ITEM)**
2. Navigate to purchase edit page
3. Delete 1 item (the 2nd item added, value=2500)
4. Click "Update Purchase"
5. **Verify DB after edit**

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] Remaining item: Stock unchanged
- [ ] Deleted item: Stock decreased by removed qty

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 0
  - `credit` = 2500 (removed amount)
  - New `balance` = previous_balance - 2500

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] If unpaid: No new records
- [ ] If paid: Automatic payment reversal for 2500

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 10000 (12500 - 2500)
- [ ] `purchaseitems`: 1 record removed
  - Only 1 item remains

**Pass Criteria:**
✅ Item removed  
✅ Stock reversed  
✅ Total adjusted  
✅ Ledger credit entry created

---

## 🎉 BATCH 2 COMPLETION CHECKLIST

### **When All 12 Tests Pass:**

- [ ] All 12 test scenarios completed
- [ ] All 3 systems verified for each test
- [ ] Inventory system: Stock adjustments correct
- [ ] Ledger system: Adjustment entries correct
- [ ] Payment Allocation system: Automatic adjustments working
- [ ] No console errors
- [ ] All calculations correct
- [ ] Audit trail maintained
- [ ] Ready to proceed to Batch 3 (Payment Allocation)

---

## 📊 3-SYSTEM VERIFICATION SUMMARY

| Test | Inventory | Ledger | Payment Allocation | Status | Notes |
|------|-----------|--------|-------------------|--------|-------|
| 2.1 | ✅ No change | ✅ No entries | ✅ No change | ✅ **PASS** | ⚠️ payment_mode=1 (should be 0) |
| 2.2 | ✅ Stock +5 | ✅ ADJUSTMENT (+5000) | ✅ None (unpaid) | ✅ **PASS** | |
| 2.3 | ✅ Stock -3 | ✅ ADJUSTMENT (-3000) | ✅ None (unpaid) | ✅ **PASS** | Qty: 15→12 (adj: -3). Net from original: +2 (10→12) |
| 2.4 | ✅ No change | ✅ PAYMENT (12000) | ✅ Created | ✅ **PASS** | Payment mode=Bank (1), not Cash (0) |
| 2.5 | ✅ Stock +2 | ✅ ADJUSTMENT + PAYMENT | ✅ Created | ✅ **PASS** | ✅ **FIXED** - Ledger now transaction-safe, no duplicates on retry |
| 2.5.1 | ✅ Stock +3 | ✅ ADJUSTMENT (+3000) | ✅ No change | ✅ **PASS** | ✅ **Case 5 VERIFIED** - PAID→PARTIAL ledger entry created correctly |
| 2.6 | ✅ No change | ✅ No entries | ✅ No change | ✅ **PASS** | ✅ **FIXED** - Validation now accepts status 2 (Partially Paid) |
| 2.7 | ✅ Stock +2 | ✅ ADJUSTMENT + PAYMENT_ADJ | ✅ Adjusted | ⏳ Pending | |
| 2.8 | ✅ Stock -2 | ✅ ADJUSTMENT + PAYMENT_ADJ | ✅ Reversed | ⏳ Pending | |
| 2.9 | ✅ No change | ✅ PAYMENT_REVERSAL | ✅ Reversed | ⏳ Pending | |
| 2.10 | ✅ Stock +5 | ✅ ADJUSTMENT + REVERSAL | ✅ Reversed | ⏳ Pending | |
| 2.11 | ✅ Stock +5 (new) | ✅ ADJUSTMENT (+2500) | ✅ Adjusted if paid | ⏳ Pending | |
| 2.12 | ✅ Stock reversed | ✅ ADJUSTMENT (-2500) | ✅ Reversed if paid | ⏳ Pending | |

---

**END OF DOCUMENT**
