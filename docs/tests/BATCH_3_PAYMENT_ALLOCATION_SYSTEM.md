# BATCH 3: Payment Allocation System - Complete Testing

**Document Version:** 1.0  
**Created:** January 16, 2026  
**Purpose:** Complete testing of vendor payment allocation system  
**Systems Covered:** Payment Allocation, Ledger, Purchase Status

---

## 🎯 PAYMENT ALLOCATION ARCHITECTURE

The payment allocation system manages how vendor payments are distributed across multiple purchases:

1. **SYSTEM 1: PAYMENT RECORDS** - `vendor_payments` table (payment transactions)
2. **SYSTEM 2: ALLOCATIONS** - `payment_allocations` table (links payments to purchases)
3. **SYSTEM 3: LEDGER** - `vendor_ledger` entries (PAYMENT transaction type)
4. **SYSTEM 4: PURCHASE STATUS** - `purchase.payment_status` (0=Unpaid, 1=Paid, 2=Partially Paid)

---

## 📋 KEY CONCEPTS

### **Payment Status Values:**
- **0 = Unpaid** - No payments allocated
- **1 = Paid** - Fully paid (total_allocated >= purchase.total)
- **2 = Partially Paid** - Some payment allocated (0 < total_allocated < purchase.total)

### **Payment Types:**
- **BILL_SPECIFIC** - Payment allocated to specific purchase(s)
- **ADVANCE** - Payment made in advance (not yet allocated)
- **GENERAL** - General payment to vendor

### **Payment Modes:**
- **0 = Cash**
- **1 = Bank**

---

## ✅ Test 3.1: Create Payment - Full Payment (Single Bill)

**Pre-conditions:**
- Unpaid purchase exists: ID=1, total=50000, vendor_id=1, payment_status=0

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Navigate to `/purchases/create`
2. Create purchase: total=50000, vendor_id=1, payment_status=Unpaid
3. Note purchase ID
4. **Verify creation successful**

### **STEP 2: CREATE PAYMENT**
5. Navigate to `/entry/vendor-payment`
6. Select vendor (ID=1)
7. Enter payment amount = 50000
8. Allocate to Purchase #1: 50000
9. Set payment_mode = Bank
10. Click "Process Payment"
11. **Verify DB after payment**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: 1 new record
  - `vendor_id` = 1
  - `payment_amount` = 50000
  - `payment_mode` = 1 (Bank)
  - `payment_type` = 'BILL_SPECIFIC'
  - `payment_date` = current timestamp
  - `notes` = "Payment for purchase #1" (or similar)

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`: 1 new record
  - `payment_id` = [new payment ID]
  - `purchase_id` = 1
  - `allocated_amount` = 50000
  - `allocation_date` = current timestamp
  - `notes` = "Allocated during payment creation" (or similar)

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `vendor_id` = 1
  - `transaction_type` = 'PAYMENT'
  - `reference_type` = 'purchase'
  - `reference_id` = 1
  - `reference_no` = purchase invoice_no
  - `debit` = 0
  - `credit` = 50000
  - `payment_mode` = 1
  - `payment_status` = 1
  - New `balance` = previous_balance - 50000

### **SYSTEM 4: PURCHASE STATUS**
- [ ] `purchase`:
  - `payment_status` = 1 (changed from 0 to Paid)

**Pass Criteria:**
✅ Payment recorded in vendor_payments  
✅ Allocation linked in payment_allocations  
✅ Ledger entry created with PAYMENT type  
✅ Purchase status updated to 1 (Paid)  
✅ Vendor balance decreased by 50000

---

## ✅ Test 3.2: Create Payment - Partial Payment (Single Bill)

**Pre-conditions:**
- Unpaid purchase exists: ID=1, total=50000, vendor_id=1

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: total=50000, unpaid
2. Note purchase ID

### **STEP 2: CREATE PARTIAL PAYMENT**
3. Navigate to `/entry/vendor-payment`
4. Select vendor
5. Enter payment amount = 30000
6. Allocate to Purchase #1: 30000
7. Set payment_mode = Cash
8. Click "Process Payment"
9. **Verify DB after payment**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`:
  - `payment_amount` = 30000
  - `payment_mode` = 0 (Cash)
  - `payment_type` = 'BILL_SPECIFIC'

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`:
  - `allocated_amount` = 30000
  - Linked to purchase #1

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`:
  - `transaction_type` = 'PAYMENT'
  - `credit` = 30000
  - `payment_mode` = 0
  - New `balance` = previous_balance - 30000

### **SYSTEM 4: PURCHASE STATUS**
- [ ] `purchase`:
  - `payment_status` = 2 (Partially Paid) ⭐ NEW STATUS
  - Total allocated: 30000 of 50000
  - Remaining: 20000

**Pass Criteria:**
✅ Partial payment recorded  
✅ Status = 2 (Partially Paid)  
✅ Balance shows remaining amount (20000)  
✅ Payment mode = 0 (Cash) stored correctly

---

## ✅ Test 3.3: Multiple Partial Payments → Full Payment

**Pre-conditions:**
- Unpaid purchase exists: ID=1, total=50000

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: total=50000, unpaid

### **STEP 2: FIRST PARTIAL PAYMENT**
2. Make Payment #1: 20000 allocated to Purchase #1
3. **Verify status = 2 (Partially Paid), balance = 30000**

### **STEP 3: SECOND PARTIAL PAYMENT**
4. Make Payment #2: 15000 allocated to Purchase #1
5. **Verify status = 2 (still partial), balance = 15000**

### **STEP 4: FINAL PAYMENT**
6. Make Payment #3: 15000 allocated to Purchase #1
7. **Verify status = 1 (Fully Paid), balance = 0**

**Verify DB Tables (After Payment #3):**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: 3 records total
  - Payment #1: 20000
  - Payment #2: 15000
  - Payment #3: 15000
  - Total: 50000

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`: 3 records for Purchase #1
  - Allocation #1: 20000
  - Allocation #2: 15000
  - Allocation #3: 15000
  - Sum of allocated_amount = 50000

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`: 3 PAYMENT entries
  - Entry #1: credit = 20000
  - Entry #2: credit = 15000
  - Entry #3: credit = 15000
  - Total credits = 50000
  - Final balance = original_balance - 50000

### **SYSTEM 4: PURCHASE STATUS**
- [ ] `purchase`:
  - `payment_status` = 1 (Fully Paid after 3rd payment)
  - Status transitions: 0 → 2 → 2 → 1

**Pass Criteria:**
✅ Status transitions correctly: 0→2→2→1  
✅ All 3 payments tracked separately  
✅ All 3 allocations linked to purchase  
✅ 3 separate ledger entries created  
✅ Final balance = 0 (fully paid)

---

## ✅ Test 3.4: One Payment → Multiple Bills (Full Payment Each)

**Pre-conditions:**
- 3 Unpaid purchases exist:
  - Purchase #1: total=40000, vendor_id=1
  - Purchase #2: total=40000, vendor_id=1
  - Purchase #3: total=20000, vendor_id=1

**Action Steps:**

### **STEP 1: CREATE PURCHASES**
1. Create Purchase #1: 40000
2. Create Purchase #2: 40000
3. Create Purchase #3: 20000
4. All unpaid, same vendor

### **STEP 2: CREATE BULK PAYMENT**
5. Navigate to `/entry/vendor-payment`
6. Select vendor
7. Enter payment amount = 100000
8. Allocate:
   - Purchase #1: 40000
   - Purchase #2: 40000
   - Purchase #3: 20000
9. Click "Process Payment"
10. **Verify DB after payment**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: 1 record
  - `payment_amount` = 100000
  - `payment_type` = 'BILL_SPECIFIC'

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`: 3 records
  - Allocation #1: purchase_id=1, allocated_amount=40000
  - Allocation #2: purchase_id=2, allocated_amount=40000
  - Allocation #3: purchase_id=3, allocated_amount=20000
  - All linked to same payment_id

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`: 3 PAYMENT entries
  - Entry #1: reference_id=1, credit=40000
  - Entry #2: reference_id=2, credit=40000
  - Entry #3: reference_id=3, credit=20000
  - Total credits = 100000
  - Notes mention respective purchase IDs

### **SYSTEM 4: PURCHASE STATUS**
- [ ] All 3 purchases:
  - Purchase #1: `payment_status` = 1 (fully paid)
  - Purchase #2: `payment_status` = 1 (fully paid)
  - Purchase #3: `payment_status` = 1 (fully paid)

**Pass Criteria:**
✅ 1 payment splits to 3 bills  
✅ All 3 bills marked as paid  
✅ 3 separate ledger entries (one per bill)  
✅ All allocations linked to single payment  
✅ Total allocated = payment amount

---

## ✅ Test 3.5: One Payment → Multiple Bills (Partial on Last)

**Pre-conditions:**
- 3 Unpaid purchases exist:
  - Purchase #1: total=40000
  - Purchase #2: total=40000
  - Purchase #3: total=40000

**Action Steps:**

### **STEP 1: CREATE PURCHASES**
1. Create 3 purchases: 40000 each
2. All unpaid, same vendor

### **STEP 2: CREATE PARTIAL BULK PAYMENT**
3. Make payment = 100000
4. Allocate:
   - Purchase #1: 40000 (full)
   - Purchase #2: 40000 (full)
   - Purchase #3: 20000 (partial)
5. **Verify DB after payment**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: 1 record (100000)

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`: 3 records
  - Purchase #1: 40000
  - Purchase #2: 40000
  - Purchase #3: 20000
  - Sum = 100000

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`: 3 entries
  - Each entry credits respective amount
  - Purchase #3 balance = 20000 remaining

### **SYSTEM 4: PURCHASE STATUS**
- [ ] Purchase #1: payment_status = 1 (paid)
- [ ] Purchase #2: payment_status = 1 (paid)
- [ ] Purchase #3: payment_status = 2 (partial - 20k of 40k paid)

**Pass Criteria:**
✅ Mixed full/partial allocations work  
✅ Correct status for each bill  
✅ Remaining balance calculated correctly  
✅ Partial payment tracked properly

---

## ✅ Test 3.6: Payment with Different Modes

**Pre-conditions:**
- 1 Unpaid purchase exists: total=50000

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: 50000, unpaid

### **STEP 2: FIRST PAYMENT (CASH)**
2. Payment #1: 30000, mode=Cash, allocated to Purchase #1
3. **Verify payment_mode = 0 stored**

### **STEP 3: SECOND PAYMENT (BANK)**
4. Payment #2: 20000, mode=Bank, allocated to Purchase #1
5. **Verify payment_mode = 1 stored**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: 2 records
  - Payment #1: payment_mode = 0 (Cash), amount = 30000
  - Payment #2: payment_mode = 1 (Bank), amount = 20000

### **SYSTEM 3: LEDGER**
- [ ] `vendor_ledger`: 2 entries
  - Entry #1: payment_mode = 0, credit = 30000
  - Entry #2: payment_mode = 1, credit = 20000

**Pass Criteria:**
✅ Different payment modes tracked separately  
✅ Modes stored in both payments and ledger  
✅ Purchase fully paid with mixed modes

---

## ✅ Test 3.7: Payment Status Calculation Accuracy

**Pre-conditions:**
- Purchase exists: total=50000

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: 50000, unpaid

### **STEP 2: TINY PAYMENT**
2. Make payment: 0.01 allocated to purchase
3. **Verify status = 2 (partially paid) not 1**

### **STEP 3: EXACT PAYMENT**
4. Make payment: 49999.99 allocated to purchase
5. **Verify status = 1 (fully paid)**

**Verify DB Tables:**

### **SYSTEM 4: PURCHASE STATUS**
- [ ] After 0.01 payment:
  - Calculate: total_paid / total = 0.01 / 50000 = 0.00002%
  - Status must be 2 (not 0, not 1)
- [ ] After full payment:
  - Calculate: total_paid / total = 50000 / 50000 = 100%
  - Status must be 1

**Pass Criteria:**
✅ Even tiny payment triggers status = 2  
✅ Only exactly matching amount triggers status = 1  
✅ Status calculation uses >= comparison for full payment

---

## ✅ Test 3.8: View Payment History

**Pre-conditions:**
- Purchase with 3 payments exists (from Test 3.3)

**Action Steps:**

### **STEP 1: NAVIGATE TO PURCHASE VIEW**
1. Navigate to purchase view page
2. Check payment history section

**Verify Display:**
- [ ] Shows 3 payments with:
  - Payment dates
  - Payment amounts
  - Payment modes (Cash/Bank)
  - Allocated amounts
  - Notes
- [ ] Total paid = sum of all payments (50000)
- [ ] Remaining balance shown (0)
- [ ] Payment status badge shows "Paid"

**Pass Criteria:**
✅ All payments displayed in chronological order  
✅ Totals calculated correctly  
✅ Payment modes displayed  
✅ UI shows complete payment history

---

## ✅ Test 3.9: Payment to Wrong Vendor (Should Fail)

**Pre-conditions:**
- Purchase exists for Vendor A (ID=1)
- Vendor B exists (ID=2)

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase for Vendor A

### **STEP 2: TRY WRONG VENDOR PAYMENT**
2. Navigate to `/entry/vendor-payment`
3. Select Vendor B (ID=2)
4. Try to allocate to Vendor A's purchase
5. **System should prevent this**

**Verify:**
- [ ] System prevents cross-vendor allocation
- [ ] Error message shown: "Cannot allocate payment to different vendor's purchases"
- [ ] Payment not created
- [ ] No allocation records created

**Pass Criteria:**
✅ Cannot allocate payment to wrong vendor's bills  
✅ Validation error displayed  
✅ Data integrity maintained

---

## ✅ Test 3.10: Overpayment Validation (Should Fail)

**Pre-conditions:**
- Purchase exists: total=50000, unpaid

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: 50000, unpaid

### **STEP 2: TRY OVERPAYMENT**
2. Navigate to payment entry
3. Try to allocate 60000 to this purchase
4. **System should reject**

**Verify:**
- [ ] Validation error shown: "Cannot allocate more than bill total"
- [ ] Cannot allocate more than (purchase.total - already_allocated)
- [ ] Payment not created if validation fails

**Pass Criteria:**
✅ Overpayment prevented  
✅ Validation checks remaining amount  
✅ Error message clear and helpful

---

## ✅ Test 3.11: Payment Allocation Sum Validation

**Pre-conditions:**
- Multiple purchases exist

**Action Steps:**

### **STEP 1: CREATE PURCHASES**
1. Create Purchase #1: 50000
2. Create Purchase #2: 60000

### **STEP 2: TRY INVALID ALLOCATION**
3. Enter payment amount = 100000
4. Try to allocate:
   - Bill #1: 50000
   - Bill #2: 60000
   - Total allocation: 110000 (exceeds payment!)
5. **System should reject**

**Verify:**
- [ ] Error: "Allocation sum (110000) exceeds payment amount (100000)"
- [ ] Payment not created
- [ ] No allocations created

**Pass Criteria:**
✅ Allocation validation works  
✅ Sum of allocations cannot exceed payment amount  
✅ Clear error message

---

## ✅ Test 3.12: Payment with Notes

**Pre-conditions:**
- Unpaid purchase exists

**Action Steps:**

### **STEP 1: CREATE PURCHASE**
1. Create purchase: 50000, unpaid

### **STEP 2: CREATE PAYMENT WITH NOTES**
2. Create payment with notes: "Partial payment via bank transfer - Ref #12345"
3. **Verify notes saved**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] `vendor_payments`: notes field contains text
  - `notes` = "Partial payment via bank transfer - Ref #12345"

### **SYSTEM 2: ALLOCATIONS**
- [ ] `payment_allocations`: notes field can also have allocation-specific notes
  - `notes` = "Allocated during payment creation" (or custom)

**Verify Display:**
- [ ] Notes displayed in payment history
- [ ] Notes visible in payment details view

**Pass Criteria:**
✅ Notes saved in vendor_payments  
✅ Notes displayed in UI  
✅ Allocation notes also supported

---

## ✅ Test 3.13: Outstanding Bills List

**Pre-conditions:**
- Multiple purchases exist (mix of paid/unpaid/partial)
  - Purchase #1: 50000, paid
  - Purchase #2: 40000, unpaid
  - Purchase #3: 60000, partial (30000 paid)

**Action Steps:**

### **STEP 1: CREATE MIXED PURCHASES**
1. Create 3 purchases with different payment statuses

### **STEP 2: VIEW OUTSTANDING BILLS**
2. Navigate to payment entry page
3. Select vendor
4. Check outstanding bills list

**Verify Display:**
- [ ] Shows only unpaid and partially paid bills
  - Purchase #2: 40000 (unpaid)
  - Purchase #3: 30000 remaining (partial)
- [ ] Shows remaining amount for each
- [ ] Excludes fully paid bills (Purchase #1 not shown)
- [ ] Bills sorted by date (oldest first)

**Pass Criteria:**
✅ Only outstanding bills shown  
✅ Remaining amounts correct  
✅ Fully paid bills excluded  
✅ FIFO ordering (oldest first)

---

## ✅ Test 3.14: Payment Allocation to Oldest Bills First (FIFO)

**Pre-conditions:**
- 3 purchases exist with different dates
  - Purchase #1: 40000, date=Jan 1
  - Purchase #2: 30000, date=Jan 5
  - Purchase #3: 20000, date=Jan 10

**Action Steps:**

### **STEP 1: CREATE PURCHASES**
1. Create 3 purchases on different dates
2. All unpaid

### **STEP 2: MAKE PAYMENT**
3. Navigate to payment entry
4. Enter payment amount = 50000
5. **Observe auto-suggestion for allocation**

**Verify Display:**
- [ ] System suggests oldest bills first:
  - Purchase #1: 40000 (suggested)
  - Purchase #2: 10000 (suggested - remaining from payment)
  - Purchase #3: 0 (not suggested - payment exhausted)
- [ ] User can override if needed
- [ ] Suggestions follow FIFO principle

**Pass Criteria:**
✅ FIFO suggestion works  
✅ Oldest bills prioritized  
✅ User can override suggestions  
✅ Helpful for standard payment workflow

---

## ✅ Test 3.15: Delete/Reverse Payment

**Pre-conditions:**
- Payment exists with allocations
  - Payment ID: 1
  - Amount: 50000
  - Allocated to Purchase #1: 50000
  - Purchase status: 1 (Paid)

**Action Steps:**

### **STEP 1: CREATE PAYMENT**
1. Create payment: 50000 to Purchase #1
2. Verify purchase status = 1 (Paid)

### **STEP 2: REVERSE PAYMENT**
3. Navigate to payment list
4. Click "Reverse Payment" on Payment #1
5. Confirm reversal
6. **Verify DB after reversal**

**Verify DB Tables:**

### **SYSTEM 1: PAYMENT RECORDS**
- [ ] Original payment record still exists (not deleted)
- [ ] New payment record created with negative amount:
  - `payment_amount` = -50000
  - `payment_type` = 'REVERSAL'
  - `notes` = "Reversal of payment #1"

### **SYSTEM 2: ALLOCATIONS**
- [ ] Original allocation records still exist (not deleted)
- [ ] New allocation records with negative amounts:
  - `allocated_amount` = -50000
  - `notes` = "Reversal of allocation"

### **SYSTEM 3: LEDGER**
- [ ] New ledger entry created:
  - `transaction_type` = 'PAYMENT_REVERSAL'
  - `debit` = 50000 (reverses the credit)
  - `credit` = 0
  - `notes` = "Payment reversal for payment #1"

### **SYSTEM 4: PURCHASE STATUS**
- [ ] `purchase`:
  - `payment_status` = 0 (reverted to Unpaid)
  - Total allocated = 0 (50000 - 50000)

**Pass Criteria:**
✅ Payment reversed completely  
✅ All data restored to pre-payment state  
✅ No deletion (audit trail maintained)  
✅ Reversal entries created (negative amounts)  
✅ Purchase status reverted  
✅ Vendor balance restored

---

## 🎉 BATCH 3 COMPLETION CHECKLIST

### **When All 15 Tests Pass:**

- [ ] All 15 test scenarios completed
- [ ] All 4 systems verified for each test
- [ ] Payment allocation system working correctly
- [ ] Status calculations accurate (0, 1, 2)
- [ ] Ledger entries correct
- [ ] Validation rules enforced
- [ ] No console errors
- [ ] All calculations correct
- [ ] Audit trail maintained
- [ ] Ready to proceed to Batch 4 (Return Creation)

---

## 📊 4-SYSTEM VERIFICATION SUMMARY

| Test | Payments | Allocations | Ledger | Status | Result | Notes |
|------|----------|-------------|--------|--------|--------|-------|
| 3.1 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Full payment (single bill) |
| 3.2 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Partial payment (single bill) |
| 3.3 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Multiple partial → full |
| 3.4 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | One payment → multiple bills (full) |
| 3.5 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | One payment → multiple bills (partial) |
| 3.6 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Different payment modes |
| 3.7 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Status calculation accuracy |
| 3.8 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | View payment history |
| 3.9 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Wrong vendor validation |
| 3.10 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Overpayment validation |
| 3.11 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Allocation sum validation |
| 3.12 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Payment with notes |
| 3.13 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Outstanding bills list |
| 3.14 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | FIFO allocation |
| 3.15 | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | ⏳ Pending | Reverse payment |

---

**END OF DOCUMENT**
