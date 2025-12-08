# Ledger Entries Testing Checklist

**Document Version:** 1.0  
**Created:** December 7, 2025  
**Status:** 🧪 TESTING PHASE  
**Scope:** Test Existing Ledger Entry Implementation  

---

## 🎯 OBJECTIVE

Test that all existing ledger entries are being created correctly for:
- Purchase creation (paid/unpaid)
- Purchase editing (payment status changes, amount changes)
- Return creation (refunded/unrefunded)
- Return editing

**Why Test First?**
- Verify existing implementation works correctly
- Catch any bugs before adding payment allocation
- Ensure ledger balances are accurate
- Build confidence in the foundation before extending it

---

## 📋 TEST CASES

### **Test 1: Purchase Creation with Payment** ✅

**Scenario**: Create a purchase and mark it as paid immediately

**Steps**:
1. Create purchase via UI or API:
   ```json
   {
     "vendor_id": 1,
     "date": "2025-12-07",
     "items": [...],
     "total": 50000,
     "payment_status": 1,
     "payment_mode": 1
   }
   ```

2. Check `vendor_ledger` table:
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = 1 
   ORDER BY transaction_date DESC 
   LIMIT 2;
   ```

**Expected Results**:
- ✅ Two ledger entries created:
  1. `PURCHASE` entry:
     - `transaction_type`: 'PURCHASE'
     - `debit`: 50000
     - `credit`: 0
     - `balance`: 50000
     - `notes`: Contains purchase invoice number
  
  2. `PAYMENT` entry:
     - `transaction_type`: 'PAYMENT'
     - `debit`: 0
     - `credit`: 50000
     - `balance`: 0
     - `payment_mode`: 1 (Bank)
     - `payment_status`: 1
     - `notes`: Contains payment information

**Verification**:
```sql
-- Check final balance for vendor
SELECT 
  vendor_id,
  SUM(debit - credit) as balance
FROM vendor_ledger
WHERE vendor_id = 1
GROUP BY vendor_id;
```
Expected: `balance = 0`

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

**Notes**:
```
Date tested: _______
Result: _______
Issues found: _______
```

---

### **Test 2: Purchase Edit (Paid → Unpaid)** ✅

**Scenario**: Create paid purchase, then unmark it as paid (reversal)

**Steps**:
1. Create paid purchase (Test 1)
2. Edit purchase, change `payment_status` from 1 → 0:
   ```json
   PUT /api/purchases/[id]
   {
     "payment_status": 0
   }
   ```

3. Check ledger entries:
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = 1 
   ORDER BY transaction_date DESC 
   LIMIT 3;
   ```

**Expected Results**:
- ✅ Three ledger entries total:
  1. Original `PURCHASE` (Dr ₹50,000)
  2. Original `PAYMENT` (Cr ₹50,000)
  3. NEW `PAYMENT_REVERSAL` entry:
     - `transaction_type`: 'PAYMENT_REVERSAL'
     - `debit`: 50000
     - `credit`: 0
     - `balance`: 50000
     - `notes`: Contains reversal reason with timestamp

**Verification**:
```sql
-- Check final balance
SELECT SUM(debit - credit) as balance
FROM vendor_ledger
WHERE vendor_id = 1;
```
Expected: `balance = 50000` (back to unpaid)

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

**Notes**:
```
Date tested: _______
Result: _______
Issues found: _______
```

---

### **Test 3: Purchase Edit (Amount Change While Paid)** ✅

**Scenario**: Create paid purchase, then change the total amount

**Steps**:
1. Create paid purchase: ₹50,000
2. Edit purchase, change total from ₹50,000 → ₹60,000:
   ```json
   PUT /api/purchases/[id]
   {
     "total": 60000,
     "payment_status": 1
   }
   ```

3. Check ledger entries:
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = 1 
   ORDER BY transaction_date DESC 
   LIMIT 4;
   ```

**Expected Results**:
- ✅ Four ledger entries total:
  1. Original `PURCHASE` (Dr ₹50,000)
  2. Original `PAYMENT` (Cr ₹50,000)
  3. NEW `PURCHASE_ADJUSTMENT` entry:
     - `transaction_type`: 'PURCHASE_ADJUSTMENT'
     - `debit`: 10000 (increase)
     - `credit`: 0
     - `balance`: 10000
     - `notes`: "Purchase amount increased by ₹10,000"
  
  4. NEW `PAYMENT_ADJUSTMENT` entry:
     - `transaction_type`: 'PAYMENT_ADJUSTMENT'
     - `debit`: 0
     - `credit`: 10000 (additional payment)
     - `balance`: 0
     - `notes`: "Payment adjustment - additional ₹10,000"

**Verification**:
```sql
-- Check final balance
SELECT SUM(debit - credit) as balance
FROM vendor_ledger
WHERE vendor_id = 1;
```
Expected: `balance = 0` (still fully paid)

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

**Notes**:
```
Date tested: _______
Result: _______
Issues found: _______
```

---

### **Test 4: Return Creation with Refund** ✅

**Scenario**: Create a purchase return and mark it as refunded

**Steps**:
1. Create a purchase first
2. Create return via API:
   ```json
   POST /api/purchase-returns/vendor-return
   {
     "vendor_id": 1,
     "return_date": "2025-12-07",
     "items": [...],
     "total_amount": 10000,
     "total_tax": 1800,
     "payment_status": 1,
     "payment_mode": 1
   }
   ```

3. Check ledger entries:
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = 1 
   AND transaction_type IN ('DEBIT_NOTE', 'REFUND_RECEIVED')
   ORDER BY transaction_date DESC 
   LIMIT 2;
   ```

**Expected Results**:
- ✅ Two ledger entries created:
  1. `DEBIT_NOTE` entry:
     - `transaction_type`: 'DEBIT_NOTE'
     - `debit`: 0
     - `credit`: 11800 (total_amount + total_tax)
     - `reference_type`: 'purchase_return'
     - `reference_no`: Contains debit note number (e.g., "DN-0001")
     - `notes`: Contains debit note details
  
  2. `REFUND_RECEIVED` entry:
     - `transaction_type`: 'REFUND_RECEIVED'
     - `debit`: 11800
     - `credit`: 0
     - `payment_mode`: 1
     - `payment_status`: 1
     - `notes`: "Refund received for DN-XXXX"

**Verification**:
```sql
-- Check balance change
SELECT 
  transaction_type,
  debit,
  credit,
  balance,
  notes
FROM vendor_ledger
WHERE vendor_id = 1
ORDER BY id DESC
LIMIT 2;
```
Expected: Net balance change = 0 (debit note offset by refund)

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

**Notes**:
```
Date tested: _______
Result: _______
Issues found: _______
```

---

### **Test 5: Return Edit (Unpaid)** ✅

**Scenario**: Create unpaid return, then edit it

**Steps**:
1. Create unpaid return:
   ```json
   POST /api/purchase-returns/vendor-return
   {
     "vendor_id": 1,
     "return_date": "2025-12-07",
     "items": [...],
     "total_amount": 10000,
     "payment_status": 0
   }
   ```

2. Edit return (change amount):
   ```json
   PUT /api/purchase-returns/[id]
   {
     "total_amount": 15000
   }
   ```

3. Check ledger entries:
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = 1 
   AND transaction_type = 'DEBIT_NOTE'
   ORDER BY transaction_date DESC;
   ```

**Expected Results**:
- ✅ Ledger entry updated correctly:
  - Original `DEBIT_NOTE` entry should be updated OR
  - New adjustment entry should be created
  - Balance should reflect the new amount
  - No `REFUND_RECEIVED` entry (since unpaid)

**Verification**:
```sql
-- Check if return edit updates ledger correctly
SELECT 
  transaction_type,
  credit,
  balance,
  notes
FROM vendor_ledger
WHERE vendor_id = 1
AND reference_type = 'purchase_return'
ORDER BY id DESC;
```

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

**Notes**:
```
Date tested: _______
Result: _______
Issues found: _______
```

---

## 🔍 ADDITIONAL VERIFICATION TESTS

### **Test 6: Balance Calculation Accuracy**

**Purpose**: Verify running balance is calculated correctly

**Steps**:
```sql
-- Get all ledger entries for a vendor
SELECT 
  id,
  transaction_date,
  transaction_type,
  debit,
  credit,
  balance,
  notes
FROM vendor_ledger
WHERE vendor_id = 1
ORDER BY transaction_date ASC, id ASC;
```

**Expected**:
- ✅ Balance column matches cumulative (debit - credit)
- ✅ Each entry's balance = previous balance + debit - credit
- ✅ Final balance matches vendor outstanding

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

---

### **Test 7: Transaction Type Coverage**

**Purpose**: Verify all transaction types work

**Steps**:
```sql
-- Check which transaction types exist
SELECT 
  transaction_type,
  COUNT(*) as count,
  SUM(debit) as total_debit,
  SUM(credit) as total_credit
FROM vendor_ledger
GROUP BY transaction_type;
```

**Expected Transaction Types**:
- ✅ PURCHASE
- ✅ PAYMENT
- ✅ PAYMENT_REVERSAL
- ✅ PURCHASE_ADJUSTMENT
- ✅ PAYMENT_ADJUSTMENT
- ✅ DEBIT_NOTE
- ✅ REFUND_RECEIVED

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

---

### **Test 8: Audit Trail Integrity**

**Purpose**: Verify no ledger entries are deleted

**Steps**:
1. Count ledger entries before operations
2. Perform multiple operations (create, edit, reverse)
3. Count ledger entries after

**Expected**:
- ✅ Entry count only increases, never decreases
- ✅ Reversal entries exist instead of deletions
- ✅ All entries have timestamps
- ✅ All entries have notes explaining the action

**Status**: [ ] Pass [ ] Fail [ ] Not Tested

---

## 🐛 COMMON ISSUES TO CHECK

### **Issue 1: Missing Ledger Entries**
- [ ] Check if `ledgerService.createEntry()` is called
- [ ] Check if transaction completes successfully
- [ ] Check error logs for failures

### **Issue 2: Incorrect Balance**
- [ ] Verify debit/credit amounts are correct
- [ ] Check balance calculation logic
- [ ] Ensure all entries are included in sum

### **Issue 3: Missing Reversal Entries**
- [ ] Check if PAYMENT_REVERSAL is created on unmark
- [ ] Verify no entries are deleted
- [ ] Check timestamp and notes are included

### **Issue 4: Wrong Transaction Type**
- [ ] Verify correct type used for each operation
- [ ] Check if new types are recognized
- [ ] Ensure ledger service handles all types

---

## 📊 TEST EXECUTION LOG

### **Testing Session 1**

**Date**: _______________  
**Tester**: _______________  
**Environment**: [ ] Development [ ] Staging [ ] Production  

**Results**:

| Test # | Test Name | Status | Issues Found | Notes |
|--------|-----------|--------|--------------|-------|
| 1 | Purchase with Payment | [ ] Pass [ ] Fail | | |
| 2 | Paid → Unpaid | [ ] Pass [ ] Fail | | |
| 3 | Amount Change (Paid) | [ ] Pass [ ] Fail | | |
| 4 | Return with Refund | [ ] Pass [ ] Fail | | |
| 5 | Return Edit (Unpaid) | [ ] Pass [ ] Fail | | |
| 6 | Balance Calculation | [ ] Pass [ ] Fail | | |
| 7 | Transaction Types | [ ] Pass [ ] Fail | | |
| 8 | Audit Trail | [ ] Pass [ ] Fail | | |

**Summary**:
- Total Tests: 8
- Passed: ___
- Failed: ___
- Not Tested: ___

**Critical Issues Found**:
```
1. 
2. 
3. 
```

**Minor Issues Found**:
```
1. 
2. 
3. 
```

---

## ✅ TEST COMPLETION CRITERIA

- [ ] All 8 tests pass successfully
- [ ] No critical issues found
- [ ] All ledger entries create correctly
- [ ] Balances calculate accurately
- [ ] Reversal entries work (no deletions)
- [ ] Audit trail is complete
- [ ] Documentation updated with findings

---

## 🚀 NEXT STEPS

**If All Tests Pass**:
1. ✅ Mark existing implementation as verified
2. ✅ Proceed with payment allocation implementation
3. ✅ Update PAYMENT_ALLOCATION_SYSTEM.md status

**If Tests Fail**:
1. ❌ Document all issues found
2. ❌ Fix critical issues first
3. ❌ Re-run failed tests
4. ❌ Only proceed when all tests pass

---

## 📝 MANUAL TESTING GUIDE

### **How to Test Manually**:

1. **Setup Test Vendor**:
   ```sql
   -- Create test vendor if needed
   INSERT INTO vendor_details (vendor_name, contact_no, status)
   VALUES ('Test Vendor', '1234567890', 'Active');
   
   -- Get vendor ID
   SELECT id FROM vendor_details WHERE vendor_name = 'Test Vendor';
   ```

2. **Create Test Purchase** (via UI or Postman):
   - Navigate to `/purchases/create`
   - Fill in vendor, items, amount
   - Select payment status
   - Submit

3. **Check Ledger** (via database):
   ```sql
   SELECT * FROM vendor_ledger 
   WHERE vendor_id = [test_vendor_id]
   ORDER BY transaction_date DESC;
   ```

4. **Verify Results**:
   - Check transaction_type is correct
   - Check debit/credit amounts
   - Check balance calculation
   - Check notes field has description

5. **Clean Up** (after testing):
   ```sql
   -- Optional: Delete test data
   DELETE FROM vendor_ledger WHERE vendor_id = [test_vendor_id];
   DELETE FROM purchase WHERE vendor_id = [test_vendor_id];
   DELETE FROM vendor_details WHERE id = [test_vendor_id];
   ```

---

**Document History**:

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-07 | Initial testing checklist for ledger entries |
