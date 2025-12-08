# Complete Test Scenarios - All Cases

**Document Version:** 1.0  
**Created:** December 7, 2025  
**Total Test Cases:** 22  

---

## 📊 SUMMARY

| Category | Test Cases | Description |
|----------|-----------|-------------|
| **Purchase Creation** | 6 | Create purchases (paid/unpaid, tax/no-tax, cash/bank) |
| **Purchase Edit** | 8 | Edit purchases (status changes, amount changes) |
| **Return Creation** | 6 | Create returns (paid/unpaid, tax/no-tax, cash/bank) |
| **Return Edit** | 2 | Edit returns (unpaid works, paid blocked) |
| **TOTAL** | **22** | **Complete coverage** |

---

## 🛒 PURCHASE CREATION SCENARIOS (6 Cases)

### **Test 1: Create Unpaid Purchase (No Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 0%
- Payment Status: 0 (Unpaid)

Expected Ledger:
- PURCHASE (Dr ₹10,000, Cr 0) → Balance: ₹10,000

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Ledger entry created correctly
```

### **Test 2: Create Unpaid Purchase (With Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 18% (₹1,800)
- Total: ₹11,800
- Payment Status: 0 (Unpaid)

Expected Ledger:
- PURCHASE (Dr ₹11,800, Cr 0) → Balance: ₹11,800

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Tax correctly included in ledger amount
```

### **Test 3: Create Paid Purchase - Cash (No Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 0%
- Payment Status: 1 (Paid)
- Payment Mode: 0 (Cash)

Expected Ledger:
- PURCHASE (Dr ₹10,000, Cr 0) → Balance: ₹10,000
- PAYMENT (Dr 0, Cr ₹10,000) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Both PURCHASE and PAYMENT entries created, balance = ₹0
```

### **Test 4: Create Paid Purchase - Cash (With Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 18% (₹1,800)
- Total: ₹11,800
- Payment Status: 1 (Paid)
- Payment Mode: 0 (Cash)

Expected Ledger:
- PURCHASE (Dr ₹11,800, Cr 0) → Balance: ₹11,800
- PAYMENT (Dr 0, Cr ₹11,800) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Tax included in both entries, balance = ₹0
```

### **Test 5: Create Paid Purchase - Bank (No Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 0%
- Payment Status: 1 (Paid)
- Payment Mode: 1 (Bank)

Expected Ledger:
- PURCHASE (Dr ₹10,000, Cr 0) → Balance: ₹10,000
- PAYMENT (Dr 0, Cr ₹10,000) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Bank payment mode works same as Cash
```

### **Test 6: Create Paid Purchase - Bank (With Tax)** ✅
```
Input:
- Vendor: Test Vendor
- Items: 1 product, ₹10,000
- Tax: 18% (₹1,800)
- Total: ₹11,800
- Payment Status: 1 (Paid)
- Payment Mode: 1 (Bank)

Expected Ledger:
- PURCHASE (Dr ₹11,800, Cr 0) → Balance: ₹11,800
- PAYMENT (Dr 0, Cr ₹11,800) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - All purchase creation scenarios working correctly
```

---

## ✏️ PURCHASE EDIT SCENARIOS (8 Cases)

### **Test 7: Edit Unpaid → Unpaid (No Change)** ✅
```
Setup: Create unpaid purchase (₹10,000)
Action: Edit but don't change anything

Expected Result:
- Submit button disabled (no changes detected)
- No API call made

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Change detection working!
Notes: 
- ✅ FIX APPLIED: Change detection implemented in UI
- ✅ Submit button correctly disabled when no changes
- ✅ Tooltip shows "No changes to save"
- ✅ Prevents unnecessary API calls
- See: pages/purchases/create.tsx hasChanges useMemo()
```

### **Test 8: Edit Unpaid → Unpaid (Amount Change)** ✅
```
Setup: Create unpaid purchase (₹10,000)
Action: Edit amount from ₹10,000 → ₹15,000

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: ₹15,000

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Amount adjustment working correctly
```

### **Test 9: Edit Unpaid → Paid** ✅
```
Setup: Create unpaid purchase (₹10,000)
Action: Change payment_status from 0 → 1

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PAYMENT (Cr ₹10,000) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Payment entry created correctly
```

### **Test 10: Edit Unpaid → Paid (With Amount Change)** ✅
```
Setup: Create unpaid purchase (₹10,000)
Action: Change to paid + change amount to ₹15,000

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: ₹15,000
- PAYMENT (Cr ₹15,000) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Both adjustment and payment entries correct
```

### **Test 11: Edit Paid → Paid (No Change)** ✅
```
Setup: Create paid purchase (₹10,000)
Action: Edit but don't change anything

Expected Result:
- Submit button disabled (no changes detected)
- No API call made

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Change detection working for paid purchases too
Notes:
- ✅ Submit button disabled with no changes
- ✅ Works same as Test 7 but for paid status
```

### **Test 12: Edit Paid → Paid (Amount Change)** ✅
```
Setup: Create paid purchase (₹10,000)
Action: Change amount from ₹10,000 → ₹15,000 (while paid)

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PAYMENT (Cr ₹10,000)
- PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: ₹5,000
- PAYMENT_ADJUSTMENT (Cr ₹5,000) → Balance: ₹0

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Dual adjustments (purchase + payment) working
```

### **Test 13: Edit Paid → Unpaid** ✅
```
Setup: Create paid purchase (₹10,000)
Action: Change payment_status from 1 → 0 (unmark as paid)

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PAYMENT (Cr ₹10,000)
- PAYMENT_REVERSAL (Dr ₹10,000) → Balance: ₹10,000

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Payment reversal working correctly
```

### **Test 14: Edit Paid → Unpaid (With Amount Change)** ✅
```
Setup: Create paid purchase (₹10,000)
Action: Unmark as paid + change amount to ₹15,000

Expected Ledger:
- PURCHASE (Dr ₹10,000)
- PAYMENT (Cr ₹10,000)
- PAYMENT_REVERSAL (Dr ₹10,000) → Balance: ₹10,000
- PURCHASE_ADJUSTMENT (Dr ₹5,000) → Balance: ₹15,000

Status: [x] Pass [ ] Fail
Date Tested: 2025-12-07
Result: PASSED - Complex scenario (reversal + adjustment) working
```

---

## 🔄 RETURN CREATION SCENARIOS (6 Cases)

### **Test 15: Create Unpaid Return (No Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 0%
- Payment Status: 0 (Unpaid/Pending Refund)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,000) → Balance: -₹5,000

Status: [ ] Pass [ ] Fail
```

### **Test 16: Create Unpaid Return (With Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 18% (₹900)
- Total Refund: ₹5,900
- Payment Status: 0 (Unpaid)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,900) → Balance: -₹5,900

Status: [ ] Pass [ ] Fail
```

### **Test 17: Create Paid Return - Cash (No Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 0%
- Payment Status: 1 (Refunded)
- Payment Mode: 0 (Cash)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,000) → Balance: -₹5,000
- REFUND_RECEIVED (Dr ₹5,000, Cr 0) → Balance: ₹0

Status: [ ] Pass [ ] Fail
```

### **Test 18: Create Paid Return - Cash (With Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 18% (₹900)
- Total Refund: ₹5,900
- Payment Status: 1 (Refunded)
- Payment Mode: 0 (Cash)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,900) → Balance: -₹5,900
- REFUND_RECEIVED (Dr ₹5,900, Cr 0) → Balance: ₹0

Status: [ ] Pass [ ] Fail
```

### **Test 19: Create Paid Return - Bank (No Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 0%
- Payment Status: 1 (Refunded)
- Payment Mode: 1 (Bank)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,000) → Balance: -₹5,000
- REFUND_RECEIVED (Dr ₹5,000, Cr 0) → Balance: ₹0

Status: [ ] Pass [ ] Fail
```

### **Test 20: Create Paid Return - Bank (With Tax)**
```
Input:
- Vendor: Test Vendor
- Return Amount: ₹5,000
- Tax: 18% (₹900)
- Total Refund: ₹5,900
- Payment Status: 1 (Refunded)
- Payment Mode: 1 (Bank)

Expected Ledger:
- DEBIT_NOTE (Dr 0, Cr ₹5,900) → Balance: -₹5,900
- REFUND_RECEIVED (Dr ₹5,900, Cr 0) → Balance: ₹0

Status: [ ] Pass [ ] Fail
```

---

## 🔧 RETURN EDIT SCENARIOS (2 Cases)

### **Test 21: Edit Unpaid Return (Should Work)**
```
Setup: Create unpaid return (₹5,000)
Action: Edit amount from ₹5,000 → ₹7,000

Expected Result:
- ✅ Edit allowed
- Ledger updated with new amount
- No REFUND_RECEIVED entry (still unpaid)

Status: [ ] Pass [ ] Fail
```

### **Test 22: Try to Edit Paid Return (Should Be Blocked)**
```
Setup: Create paid/refunded return (₹5,000)
Action: Try to edit the return

Expected Result:
- ❌ Edit blocked
- Error message: "Cannot edit a refunded return"
- Suggestion: Create new return if needed

Status: [ ] Pass [ ] Fail
```

---

## 📋 TESTING CHECKLIST

### **Purchase Creation** (6 tests) ✅ **ALL PASSED**
- [x] Test 1: Unpaid (No Tax)
- [x] Test 2: Unpaid (With Tax)
- [x] Test 3: Paid Cash (No Tax)
- [x] Test 4: Paid Cash (With Tax)
- [x] Test 5: Paid Bank (No Tax)
- [x] Test 6: Paid Bank (With Tax)

### **Purchase Edit** (8 tests) ✅ **ALL PASSED**
- [x] Test 7: Unpaid → Unpaid (No Change)
- [x] Test 8: Unpaid → Unpaid (Amount Change)
- [x] Test 9: Unpaid → Paid
- [x] Test 10: Unpaid → Paid (Amount Change)
- [x] Test 11: Paid → Paid (No Change)
- [x] Test 12: Paid → Paid (Amount Change)
- [x] Test 13: Paid → Unpaid
- [x] Test 14: Paid → Unpaid (Amount Change)

### **Return Creation** (6 tests)
- [ ] Test 15: Unpaid (No Tax)
- [ ] Test 16: Unpaid (With Tax)
- [ ] Test 17: Paid Cash (No Tax)
- [ ] Test 18: Paid Cash (With Tax)
- [ ] Test 19: Paid Bank (No Tax)
- [ ] Test 20: Paid Bank (With Tax)

### **Return Edit** (2 tests)
- [ ] Test 21: Edit Unpaid Return
- [ ] Test 22: Try Edit Paid Return (Blocked)

---

## 🎯 TESTING PRIORITIES

### **CRITICAL (Must Pass)** 🔴
These are the most important scenarios that must work:
1. Test 1: Create Unpaid Purchase
2. Test 6: Create Paid Purchase (Bank)
3. Test 9: Mark Purchase as Paid
4. Test 13: Unmark Purchase as Paid
5. Test 16: Create Unpaid Return
6. Test 20: Create Paid Return (Bank)
7. Test 22: Block Edit of Paid Return

### **HIGH PRIORITY** 🟡
Important scenarios to verify:
- Test 8: Amount change (unpaid)
- Test 12: Amount change (paid)
- Test 21: Edit unpaid return

### **MEDIUM PRIORITY** 🟢
Good to verify but less critical:
- All tax variations
- Cash vs Bank differences

---

## 📊 TEST EXECUTION TEMPLATE

### **Session Info**
- **Date**: _______________
- **Tester**: _______________
- **Environment**: _______________

### **Results Summary**
```
Total Tests: 22
Passed: ___
Failed: ___
Not Tested: ___
Pass Rate: ___%
```

### **Critical Issues Found**
```
1. 
2. 
3. 
```

### **Non-Critical Issues**
```
1. 
2. 
3. 
```

---

## 🔍 VERIFICATION QUERIES

### **After Each Test, Run These**:

```sql
-- 1. Check all ledger entries for vendor
SELECT 
  id,
  transaction_type,
  debit,
  credit,
  balance,
  notes,
  FROM_UNIXTIME(transaction_date) as date
FROM vendor_ledger
WHERE vendor_id = [test_vendor_id]
ORDER BY transaction_date ASC;

-- 2. Verify final balance
SELECT 
  vendor_id,
  SUM(debit - credit) as balance
FROM vendor_ledger
WHERE vendor_id = [test_vendor_id]
GROUP BY vendor_id;

-- 3. Count transaction types
SELECT 
  transaction_type,
  COUNT(*) as count
FROM vendor_ledger
WHERE vendor_id = [test_vendor_id]
GROUP BY transaction_type;
```

---

## ✅ SUCCESS CRITERIA

### **All Tests Pass When**:
- [ ] All 22 test cases execute without errors
- [ ] Ledger entries created correctly for each scenario
- [ ] Balances calculate accurately
- [ ] Reversal entries work (no deletions)
- [ ] Edit blocking works for paid returns
- [ ] Payment mode validation works
- [ ] Audit trail is complete

### **Ready to Proceed When**:
- [ ] At least 7 critical tests pass
- [ ] No blocking bugs found
- [ ] Ledger balance calculations are accurate
- [ ] Documentation updated with results

---

---

## 🐛 BUGS FIXED DURING TESTING

### **Issue 1: Payment Mode Default** ✅ FIXED
**Problem**: Payment mode defaulted to Bank (1) instead of Cash (0)
**Fix**: Changed default from `payment_mode: 1` to `payment_mode: 0`
**Location**: `pages/purchases/create.tsx` line 337
**Status**: Fixed & Verified

### **Issue 2: Tax → Rate Calculation** ✅ FIXED
**Problem**: When entering total, rate calculation ignored tax percentage
**Fix**: Enhanced calculation to back out tax: `rate = total / (qty × (1 + gstPercent / 100))`
**Location**: `pages/purchases/create.tsx` lines 3154-3177
**Status**: Fixed & Verified

### **Issue 3: No Change Detection** ✅ FIXED
**Problem**: Edit form allowed submission without any changes
**Fix**: Added comprehensive change detection logic + disabled submit button
**Features**:
- Compares all form fields (transport, packing, notes, payment)
- Compares vendor changes
- Compares item changes (qty, rate, gst, product_id)
- Shows tooltip "No changes to save" when disabled
**Location**: `pages/purchases/create.tsx` lines 1080-1111, 4218
**Status**: Fixed & Verified

---

**Document History**:

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-07 | Complete list of all 22 test scenarios |
| 1.1 | 2025-12-07 | Updated with Purchase test results (Tests 1-14 completed) |
| 1.2 | 2025-12-07 | Added bugs found & fixed section |
