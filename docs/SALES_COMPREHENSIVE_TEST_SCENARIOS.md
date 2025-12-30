# Comprehensive Test Scenarios - Customer Payment & Return System (SALES)

**Document Version:** 1.0  
**Created:** December 29, 2025  
**Status:** 📋 READY FOR TESTING  
**Total Scenarios:** 100  
**Coverage:** Sale, Payment, Return, Refund, Integration, Edge Cases

---

## 📊 TESTING PROGRESS TRACKER

| Batch | Category | Total | Completed | Status |
|-------|----------|-------|-----------|--------|
| 1 | Sale Creation | 10 | 0 | ⏳ Pending |
| 2 | Sale Edit | 12 | 0 | ⏳ Pending |
| 3 | Payment Allocation | 15 | 0 | ⏳ Pending |
| 4 | Return Creation | 10 | 0 | ⏳ Pending |
| 5 | Return Edit | 8 | 0 | ⏳ Pending |
| 6 | Refund Allocation | 15 | 0 | ⏳ Pending |
| 7 | Complex Integration | 12 | 0 | ⏳ Pending |
| 8 | Edge Cases | 10 | 0 | ⏳ Pending |
| 9 | Data Integrity | 8 | 0 | ⏳ Pending |
| **TOTAL** | **All Batches** | **100** | **0** | **0%** |

---

## 🎯 TESTING INSTRUCTIONS

### **How to Use This Document:**

1. **Test in Order**: Complete batches sequentially (1→2→3...)
2. **Check Boxes**: Mark `[ ]` as `[x]` when test passes
3. **Document Failures**: Add notes in the "Notes" section for failed tests
4. **Use Helper Scripts**: 
   - `scripts/view-test-data.js` - View current DB state
   - `scripts/clear-test-data.js` - Clean up test data between batches

### **DB Verification Method:**

After each action, run:
```bash
node scripts/view-test-data.js
```

This will show you the current state of all relevant tables.

---

## 🔑 KEY DIFFERENCES FROM PURCHASE SYSTEM

### **Sales vs Purchase:**

| Aspect | Purchase System | Sales System |
|--------|----------------|--------------|
| **Entity** | Vendor | Customer |
| **Transaction** | Purchase | Sale (Invoice) |
| **Ledger** | vendor_ledger | customer_ledger |
| **Stock Impact** | Increases (+) | Decreases (-) |
| **Money Flow** | We owe vendor | Customer owes us |
| **Debit/Credit** | Debit = We owe | Debit = Customer owes |
| **Payment** | We pay vendor | Customer pays us |
| **Return** | We return to vendor | Customer returns to us |
| **Refund** | Vendor refunds us | We refund customer |

### **Ledger Entry Direction:**

**Purchase System:**
- PURCHASE: Debit (we owe vendor)
- PAYMENT: Credit (we pay vendor)

**Sales System:**
- SALE: Debit (customer owes us)
- RECEIPT: Credit (customer pays us)

---

## BATCH 1: Sale Creation (10 Scenarios)

### ✅ Test 1.1: Create Unpaid Sale (No Tax)

**Pre-conditions:**
- Customer exists (use any existing customer)
- Product exists with stock ≥ 10

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`: 1 new record
  - `payment_status` = 0
  - `total` = 10000
  - `payment_mode` = NULL
- [ ] `invoiceitems`: 1 new record
  - `qty` = 10
  - `rate` = 1000
  - `subtotal` = 10000
- [ ] `bill_tosales`: 1 new record with customer details
- [ ] `product`: stock decreased by 10
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'SALE'
  - `debit` = 10000 (customer owes us)
  - `credit` = 0
  - `balance` = previous_balance + 10000

**Pass Criteria:**
✅ All DB checks pass  
✅ API returns 201 status  
✅ No console errors  
✅ Balance increases correctly (customer owes more)

**Notes:**
_Add any observations here_

---

### ✅ Test 1.2: Create Unpaid Sale (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Unpaid
5. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 0
  - `total` = 11800 (10000 + 1800 tax)
  - `total_tax` = 1800
  - `total_cgst` = 900 (if intra-state)
  - `total_sgst` = 900 (if intra-state)
  - `total_igst` = 1800 (if inter-state)
- [ ] `invoiceitems`:
  - `tax` = 1800
  - `cgst` = 900 or `igst` = 1800 (based on customer state)
- [ ] `customer_ledger`:
  - `debit` = 11800
  - `balance` = previous_balance + 11800

**Pass Criteria:**
✅ Tax calculations correct  
✅ CGST/SGST for intra-state OR IGST for inter-state  
✅ Total includes tax

**Notes:**
_Document whether intra-state or inter-state was tested_

---

### ✅ Test 1.3: Create Paid Sale - Cash (No Tax)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Paid
5. Set payment_mode = Cash
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 1
  - `payment_mode` = 0 (Cash)
  - `total` = 10000
- [ ] `customer_ledger`: 2 new entries
  - Entry 1: `transaction_type` = 'SALE', `debit` = 10000
  - Entry 2: `transaction_type` = 'RECEIPT', `credit` = 10000, `payment_mode` = 0
  - Final `balance` = previous_balance + 0 (10000 - 10000)

**Pass Criteria:**
✅ 2 ledger entries created  
✅ Balance returns to original (paid immediately)  
✅ Payment mode = 0 (Cash)

**Notes:**
_Add any observations_

---

### ✅ Test 1.4: Create Paid Sale - Cash (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Paid
5. Set payment_mode = Cash
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 1
  - `payment_mode` = 0
  - `total` = 11800
- [ ] `customer_ledger`: 2 entries
  - SALE: debit = 11800
  - RECEIPT: credit = 11800
  - Final balance = previous_balance + 0

**Pass Criteria:**
✅ Paid with correct total including tax  
✅ Balance = 0 after immediate payment

---

### ✅ Test 1.5: Create Paid Sale - Bank (No Tax)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Paid
5. Set payment_mode = Bank
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 1
  - `payment_mode` = 1 (Bank)
- [ ] `customer_ledger`:
  - RECEIPT entry has `payment_mode` = 1

**Pass Criteria:**
✅ Payment mode = 1 (Bank) stored correctly

---

### ✅ Test 1.6: Create Paid Sale - Bank (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Paid
5. Set payment_mode = Bank
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 1
  - `payment_mode` = 1
  - `total` = 11800
- [ ] `customer_ledger`:
  - SALE: debit = 11800
  - RECEIPT: credit = 11800, payment_mode = 1

**Pass Criteria:**
✅ All tax and payment data correct

---

### ✅ Test 1.7: Create Sale with Multiple Items

**Pre-conditions:**
- Customer exists
- 3+ products exist

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 3 products:
   - Product 1: qty=5, rate=1000, tax=18%
   - Product 2: qty=10, rate=500, tax=12%
   - Product 3: qty=2, rate=2000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = (5×1000×1.18) + (10×500×1.12) + (2×2000) = 5900 + 5600 + 4000 = 15500
- [ ] `invoiceitems`: 3 new records
- [ ] Each product: stock decreased by respective qty
- [ ] `customer_ledger`: debit = 15500

**Pass Criteria:**
✅ All 3 items created  
✅ Total calculated correctly  
✅ Each product stock updated

---

### ✅ Test 1.8: Create Sale with Freight Charges

**Pre-conditions:**
- Customer exists
- Product exists

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Enter Freight: 500
5. Set payment_status = Unpaid
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 10000 + 500 = 10500
  - `freight` = 500
- [ ] `customer_ledger`: debit = 10500

**Pass Criteria:**
✅ Freight included in total  
✅ Freight field saved correctly

---

### ✅ Test 1.9: Create Sale with Transport Details

**Pre-conditions:**
- Customer exists
- Product exists

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Enter Transport Name: "Test Transport"
5. Enter Vehicle Number: "UP 12 AB 1234"
6. Set payment_status = Unpaid
7. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 10000
- [ ] `transport_details`:
  - `trans_mode` = "Test Transport"
  - `vehicle_no` = "UP 12 AB 1234"
- [ ] `customer_ledger`: debit = 10000

**Pass Criteria:**
✅ Transport details saved  
✅ Total correct

---

### ✅ Test 1.10: Create Sale with "Other" Customer

**Pre-conditions:**
- None (testing "Other" customer)

**Action Steps:**
1. Navigate to `/sale/create`
2. Select customer = "Other"
3. Fill manual customer details:
   - Name: "Walk-in Customer"
   - Phone: "9999999999"
   - State: "Uttar Pradesh"
4. Add 1 product: qty=10, rate=1000, tax=0%
5. Set payment_status = Unpaid
6. Click "Create Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `select_customer` = 0 or NULL
- [ ] `bill_tosales`:
  - `user_name` = "Walk-in Customer"
  - `mobile` = "9999999999"
  - `state` = "Uttar Pradesh"
- [ ] `customer_ledger`:
  - Entry created with customer_id = 0 or specific handling

**Pass Criteria:**
✅ "Other" customer saved correctly  
✅ Manual details saved in bill_tosales table  
✅ Ledger entry created

**Notes:**
_Document how "Other" customer is handled in sales_

---

## BATCH 2: Sale Edit (12 Scenarios)

### ✅ Test 2.1: Edit Unpaid Sale (No Change)

**Pre-conditions:**
- Unpaid sale exists (from Test 1.1)

**Action Steps:**
1. Navigate to sale view page
2. Click "Edit"
3. Don't change anything
4. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`: No changes to data
- [ ] `customer_ledger`: No new entries
- [ ] `product`: Stock unchanged

**Pass Criteria:**
✅ No unnecessary DB updates  
✅ No ledger entries created

---

### ✅ Test 2.2: Edit Unpaid Sale (Amount Increase)

**Pre-conditions:**
- Unpaid sale exists: total = 10000

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 15
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 15000 (increased)
- [ ] `invoiceitems`:
  - `qty` = 15 (updated)
- [ ] `product`:
  - Stock decreased by additional 5 (total -15 from original)
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'SALE_ADJUSTMENT'
  - `debit` = 5000 (difference)
  - `credit` = 0
  - New `balance` = previous_balance + 5000

**Pass Criteria:**
✅ Amount increased correctly  
✅ SALE_ADJUSTMENT entry created  
✅ Stock adjusted properly

---

### ✅ Test 2.3: Edit Unpaid Sale (Amount Decrease)

**Pre-conditions:**
- Unpaid sale exists: total = 10000

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 7
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 7000 (decreased)
- [ ] `invoiceitems`:
  - `qty` = 7
- [ ] `product`:
  - Stock increased by +3 (returned to inventory)
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'SALE_ADJUSTMENT'
  - `debit` = 0
  - `credit` = 3000 (negative adjustment)
  - New `balance` = previous_balance - 3000

**Pass Criteria:**
✅ Amount decreased correctly  
✅ Credit entry for reduction  
✅ Stock restored

---

### ✅ Test 2.4: Edit Unpaid → Mark as Paid

**Pre-conditions:**
- Unpaid sale exists: payment_status = 0, total = 10000

**Action Steps:**
1. Navigate to sale edit page
2. Change payment_status from Unpaid → Paid
3. Select payment_mode = Cash
4. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 1
  - `payment_mode` = 0
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'RECEIPT'
  - `debit` = 0
  - `credit` = 10000
  - New `balance` = previous_balance - 10000

**Pass Criteria:**
✅ Status changed to Paid  
✅ RECEIPT entry created  
✅ Balance reduced (customer paid)

---

### ✅ Test 2.5: Edit Unpaid → Mark as Paid (With Amount Change)

**Pre-conditions:**
- Unpaid sale exists: total = 10000

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 12
3. Change payment_status from Unpaid → Paid
4. Select payment_mode = Bank
5. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 12000
  - `payment_status` = 1
  - `payment_mode` = 1
- [ ] `customer_ledger`: 2 new entries
  - Entry 1: 'SALE_ADJUSTMENT', debit = 2000
  - Entry 2: 'RECEIPT', credit = 12000
  - Final `balance` = previous_balance + 2000 - 12000 = previous_balance - 10000

**Pass Criteria:**
✅ Both amount and status changed  
✅ 2 ledger entries created  
✅ Balance adjusted correctly

---

### ✅ Test 2.6: Edit Paid Sale (No Change)

**Pre-conditions:**
- Paid sale exists (from Test 1.3)

**Action Steps:**
1. Navigate to sale edit page
2. Don't change anything
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] No changes to any tables
- [ ] No new ledger entries

**Pass Criteria:**
✅ No unnecessary updates

---

### ✅ Test 2.7: Edit Paid Sale (Amount Increase While Paid)

**Pre-conditions:**
- Paid sale exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 12
3. Keep payment_status = Paid
4. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 12000
  - `payment_status` = 1 (still paid)
- [ ] `customer_ledger`: 2 new entries
  - Entry 1: 'SALE_ADJUSTMENT', debit = 2000
  - Entry 2: 'RECEIPT_ADJUSTMENT', credit = 2000
  - Final `balance` = previous_balance + 2000 - 2000 = previous_balance (unchanged)

**Pass Criteria:**
✅ Amount increased  
✅ Automatic payment adjustment  
✅ Balance stays 0 (still fully paid)

---

### ✅ Test 2.8: Edit Paid Sale (Amount Decrease While Paid)

**Pre-conditions:**
- Paid sale exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 8
3. Keep payment_status = Paid
4. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 8000
  - `payment_status` = 1
- [ ] `customer_ledger`: 2 new entries
  - Entry 1: 'SALE_ADJUSTMENT', credit = 2000
  - Entry 2: 'RECEIPT_ADJUSTMENT', debit = 2000
  - Final `balance` = previous_balance - 2000 + 2000 = previous_balance (unchanged)

**Pass Criteria:**
✅ Amount decreased  
✅ Automatic payment reversal for difference  
✅ Balance stays 0

---

### ✅ Test 2.9: Edit Paid → Unmark as Paid

**Pre-conditions:**
- Paid sale exists: payment_status = 1, total = 10000

**Action Steps:**
1. Navigate to sale edit page
2. Change payment_status from Paid → Unpaid
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `payment_status` = 0
  - `payment_mode` = NULL
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'RECEIPT_REVERSAL'
  - `debit` = 10000
  - `credit` = 0
  - New `balance` = previous_balance + 10000

**Pass Criteria:**
✅ Status changed to Unpaid  
✅ RECEIPT_REVERSAL created  
✅ Balance restored (customer owes again)

---

### ✅ Test 2.10: Edit Paid → Unmark as Paid (With Amount Change)

**Pre-conditions:**
- Paid sale exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to sale edit page
2. Change item qty from 10 → 15
3. Change payment_status from Paid → Unpaid
4. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoice`:
  - `total` = 15000
  - `payment_status` = 0
- [ ] `customer_ledger`: 2 new entries
  - Entry 1: 'SALE_ADJUSTMENT', debit = 5000
  - Entry 2: 'RECEIPT_REVERSAL', debit = 10000
  - Final `balance` = previous_balance + 5000 + 10000 = previous_balance + 15000

**Pass Criteria:**
✅ Amount and status changed  
✅ 2 ledger entries  
✅ Balance = full unpaid amount

---

### ✅ Test 2.11: Edit Sale - Add Item

**Pre-conditions:**
- Sale exists with 1 item

**Action Steps:**
1. Navigate to sale edit page
2. Add a 2nd product
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoiceitems`: 2 records now
- [ ] `invoice`: total increased
- [ ] Both products: stock decreased
- [ ] `customer_ledger`: SALE_ADJUSTMENT for new item total

**Pass Criteria:**
✅ 2nd item added successfully  
✅ Total recalculated  
✅ Both stocks updated

---

### ✅ Test 2.12: Edit Sale - Remove Item

**Pre-conditions:**
- Sale exists with 2+ items

**Action Steps:**
1. Navigate to sale edit page
2. Delete 1 item
3. Click "Update Sale"

**Verify DB Tables:**
- [ ] `invoiceitems`: 1 record removed
- [ ] `invoice`: total decreased
- [ ] Deleted item's product: stock increased by removed qty
- [ ] `customer_ledger`: SALE_ADJUSTMENT (credit) for removed amount

**Pass Criteria:**
✅ Item removed  
✅ Stock restored  
✅ Total adjusted

---

## BATCH 3: Payment Allocation (15 Scenarios)

### ✅ Test 3.1: Create Payment - Full Payment (Single Invoice)

**Pre-conditions:**
- Unpaid sale exists: ID=1, total=50000, balance=50000

**Action Steps:**
1. Navigate to `/entry/customer-payment`
2. Select customer
3. Enter payment amount = 50000
4. Allocate to Invoice #1: 50000
5. Set payment_mode = Bank
6. Click "Process Payment"

**Verify DB Tables:**
- [ ] `customer_payments`: 1 new record
  - `payment_amount` = 50000
  - `payment_mode` = 1
  - `payment_type` = 'INVOICE_SPECIFIC'
- [ ] `customer_payment_allocations`: 1 new record
  - `payment_id` = [new payment ID]
  - `invoice_id` = 1
  - `allocated_amount` = 50000
- [ ] `invoice`:
  - `payment_status` = 1 (Fully Paid)
- [ ] `customer_ledger`: 1 new entry
  - `transaction_type` = 'RECEIPT'
  - `credit` = 50000
  - New `balance` = previous_balance - 50000

**Pass Criteria:**
✅ Payment recorded  
✅ Allocation linked  
✅ Invoice status = Paid  
✅ Balance = 0

---

### ✅ Test 3.2: Create Payment - Partial Payment (Single Invoice)

**Pre-conditions:**
- Unpaid sale exists: ID=1, total=50000, balance=50000

**Action Steps:**
1. Navigate to `/entry/customer-payment`
2. Select customer
3. Enter payment amount = 30000
4. Allocate to Invoice #1: 30000
5. Set payment_mode = Cash
6. Click "Process Payment"

**Verify DB Tables:**
- [ ] `customer_payments`:
  - `payment_amount` = 30000
  - `payment_mode` = 0
- [ ] `customer_payment_allocations`:
  - `allocated_amount` = 30000
- [ ] `invoice`:
  - `payment_status` = 2 (Partially Paid) ⭐ NEW STATUS
- [ ] `customer_ledger`:
  - `transaction_type` = 'RECEIPT'
  - `credit` = 30000
  - New `balance` = previous_balance - 30000 = 20000 remaining

**Pass Criteria:**
✅ Partial payment recorded  
✅ Status = 2 (Partially Paid)  
✅ Balance shows remaining amount

**Notes:**
_Document: This is NEW payment_status value (0=Unpaid, 1=Paid, 2=Partially Paid)_

---

### ✅ Test 3.3: Multiple Partial Payments → Full Payment

**Pre-conditions:**
- Unpaid sale exists: ID=1, total=50000

**Action Steps:**
1. Make Payment #1: 20000 allocated to Invoice #1
2. Verify status = 2 (Partially Paid), balance = 30000
3. Make Payment #2: 15000 allocated to Invoice #1
4. Verify status = 2 (still partial), balance = 15000
5. Make Payment #3: 15000 allocated to Invoice #1
6. Verify status = 1 (Fully Paid), balance = 0

**Verify DB Tables (After Payment #3):**
- [ ] `customer_payments`: 3 records total
- [ ] `customer_payment_allocations`: 3 records for Invoice #1
  - Sum of allocated_amount = 50000
- [ ] `invoice`:
  - `payment_status` = 1 (Fully Paid after 3rd payment)
- [ ] `customer_ledger`: 3 RECEIPT entries
  - Total credits = 50000
  - Final balance = 0

**Pass Criteria:**
✅ Status transitions: 0→2→2→1  
✅ All 3 payments tracked  
✅ Final balance = 0

---

### ✅ Test 3.4: One Payment → Multiple Invoices (Full Payment Each)

**Pre-conditions:**
- 3 Unpaid sales exist:
  - Invoice #1: total=40000
  - Invoice #2: total=40000
  - Invoice #3: total=20000

**Action Steps:**
1. Navigate to `/entry/customer-payment`
2. Select customer
3. Enter payment amount = 100000
4. Allocate:
   - Invoice #1: 40000
   - Invoice #2: 40000
   - Invoice #3: 20000
5. Click "Process Payment"

**Verify DB Tables:**
- [ ] `customer_payments`: 1 record
  - `payment_amount` = 100000
- [ ] `customer_payment_allocations`: 3 records
  - Invoice #1: 40000
  - Invoice #2: 40000
  - Invoice #3: 20000
- [ ] All 3 invoices:
  - `payment_status` = 1 (all fully paid)
- [ ] `customer_ledger`: 3 RECEIPT entries
  - Total credits = 100000
  - Notes mention all 3 invoice IDs

**Pass Criteria:**
✅ 1 payment splits to 3 invoices  
✅ All 3 invoices marked as paid  
✅ 3 separate ledger entries

---

### ✅ Test 3.5: One Payment → Multiple Invoices (Partial on Last)

**Pre-conditions:**
- 3 Unpaid sales exist:
  - Invoice #1: total=40000
  - Invoice #2: total=40000
  - Invoice #3: total=40000

**Action Steps:**
1. Make payment = 100000
2. Allocate:
   - Invoice #1: 40000 (full)
   - Invoice #2: 40000 (full)
   - Invoice #3: 20000 (partial)

**Verify DB Tables:**
- [ ] `customer_payments`: 1 record (100000)
- [ ] `customer_payment_allocations`: 3 records
- [ ] Invoice #1: payment_status = 1 (paid)
- [ ] Invoice #2: payment_status = 1 (paid)
- [ ] Invoice #3: payment_status = 2 (partial - 20k of 40k paid)
- [ ] `customer_ledger`: 3 entries
  - Each entry credits respective amount
  - Invoice #3 balance = 20000 remaining

**Pass Criteria:**
✅ Mixed full/partial allocations  
✅ Correct status for each invoice  
✅ Remaining balance calculated

---

### ✅ Test 3.6: Payment with Different Modes

**Pre-conditions:**
- 2 Unpaid sales exist

**Action Steps:**
1. Payment #1: 30000, mode=Cash, allocated to Invoice #1
2. Payment #2: 20000, mode=Bank, allocated to Invoice #1
3. Verify both payment modes stored correctly

**Verify DB Tables:**
- [ ] `customer_payments`: 2 records
  - Payment #1: payment_mode = 0 (Cash)
  - Payment #2: payment_mode = 1 (Bank)
- [ ] `customer_ledger`: 2 entries
  - Each has correct payment_mode value

**Pass Criteria:**
✅ Different payment modes tracked  
✅ Modes stored in ledger

---

### ✅ Test 3.7: Payment Status Calculation Accuracy

**Pre-conditions:**
- Sale exists: total=50000

**Action Steps:**
1. Make payment: 0.01 allocated to invoice
2. Verify status = 2 (partially paid) not 1

**Verify DB Tables:**
- [ ] `invoice`:
  - Calculate: total_paid / total
  - If < total: status must be 2
  - If = total: status must be 1
  - If 0: status must be 0

**Pass Criteria:**
✅ Even tiny payment triggers status = 2  
✅ Only exactly matching amount triggers status = 1

---

### ✅ Test 3.8: View Payment History

**Pre-conditions:**
- Invoice with 3 payments exists (from Test 3.3)

**Action Steps:**
1. Navigate to invoice view page
2. Check payment history section

**Verify Display:**
- [ ] Shows 3 payments with dates, amounts, modes
- [ ] Total paid = sum of all payments
- [ ] Remaining balance shown

**Pass Criteria:**
✅ All payments displayed  
✅ Totals calculated correctly

---

### ✅ Test 3.9: Payment to Wrong Customer (Should Fail)

**Pre-conditions:**
- Invoice exists for Customer A

**Action Steps:**
1. Try to create payment for Customer B
2. Try to allocate to Customer A's invoice

**Verify:**
- [ ] System prevents cross-customer allocation
- [ ] Error message shown

**Pass Criteria:**
✅ Cannot allocate payment to wrong customer's invoices

---

### ✅ Test 3.10: Overpayment Validation (Should Fail)

**Pre-conditions:**
- Invoice exists: total=50000, unpaid

**Action Steps:**
1. Try to allocate 60000 to this invoice
2. System should reject

**Verify:**
- [ ] Validation error shown
- [ ] Cannot allocate more than invoice total

**Pass Criteria:**
✅ Overpayment prevented

---

### ✅ Test 3.11: Payment Allocation Sum Validation

**Pre-conditions:**
- Multiple invoices exist

**Action Steps:**
1. Enter payment amount = 100000
2. Try to allocate: Invoice1=50000, Invoice2=60000 (total=110000)
3. System should reject

**Verify:**
- [ ] Error: "Allocation sum exceeds payment amount"

**Pass Criteria:**
✅ Allocation validation works

---

### ✅ Test 3.12: Payment with Notes

**Pre-conditions:**
- Unpaid invoice exists

**Action Steps:**
1. Create payment with notes: "Partial payment via bank transfer"
2. Verify notes saved

**Verify DB Tables:**
- [ ] `customer_payments`: notes field contains text
- [ ] Notes displayed in payment history

**Pass Criteria:**
✅ Notes saved and displayed

---

### ✅ Test 3.13: Outstanding Invoices List

**Pre-conditions:**
- Multiple invoices exist (mix of paid/unpaid/partial)

**Action Steps:**
1. Navigate to payment entry page
2. Select customer
3. Check outstanding invoices list

**Verify Display:**
- [ ] Shows only unpaid and partially paid invoices
- [ ] Shows remaining amount for each
- [ ] Excludes fully paid invoices

**Pass Criteria:**
✅ Only outstanding invoices shown  
✅ Amounts correct

---

### ✅ Test 3.14: Payment Allocation to Oldest Invoices First

**Pre-conditions:**
- 3 invoices exist with different dates

**Action Steps:**
1. Make payment
2. Observe auto-suggestion for allocation

**Verify:**
- [ ] System suggests oldest invoices first
- [ ] User can override if needed

**Pass Criteria:**
✅ FIFO suggestion works

---

### ✅ Test 3.15: Delete/Reverse Payment

**Pre-conditions:**
- Payment exists with allocations

**Action Steps:**
1. Navigate to payment list
2. Click "Reverse Payment"
3. Confirm reversal

**Verify DB Tables:**
- [ ] New payment record created with negative amount
- [ ] New allocation records with negative amounts
- [ ] Invoice status reverted
- [ ] Customer balance restored
- [ ] Ledger has reversal entries

**Pass Criteria:**
✅ Payment reversed completely  
✅ All data restored  
✅ No deletion (audit trail maintained)

---

## 📝 DOCUMENT STATUS & PROGRESS

### **Completed Sections:**
✅ **Batch 1: Sale Creation** (10 tests) - COMPLETE  
✅ **Batch 2: Sale Edit** (12 tests) - COMPLETE  
✅ **Batch 3: Payment Allocation** (15 tests) - COMPLETE  

**Total Completed: 37 out of 100 tests (37%)**

### **Remaining Sections:**
⏳ **Batch 4: Return Creation** (10 tests) - PENDING  
⏳ **Batch 5: Return Edit** (8 tests) - PENDING  
⏳ **Batch 6: Refund Allocation** (15 tests) - PENDING  
⏳ **Batch 7: Complex Integration** (12 tests) - PENDING  
⏳ **Batch 8: Edge Cases** (10 tests) - PENDING  
⏳ **Batch 9: Data Integrity** (8 tests) - PENDING  

**Total Remaining: 63 tests**

---

## 📋 BATCH 4-9 OUTLINE (To Be Completed)

### **BATCH 4: Return Creation (10 tests)**
Similar to Purchase Return tests, adapted for Sales:
- Test 4.1: Create Unpaid Return (No Tax)
- Test 4.2: Create Unpaid Return (With Tax)
- Test 4.3: Create Return with Refund Issued (Cash)
- Test 4.4: Create Return with Refund Issued (Bank)
- Test 4.5: Partial Return (Some Items)
- Test 4.6: Full Return (All Items)
- Test 4.7: Return Quantity Validation
- Test 4.8: Multiple Returns from Same Sale
- Test 4.9: Return with Credit Note Number
- Test 4.10: Return Reason Tracking

**Key Differences from Purchase:**
- sale_returns (not purchase_returns)
- CREDIT_NOTE (not DEBIT_NOTE)
- Stock increases (not decreases)
- Customer returns to us (not we return to vendor)

---

### **BATCH 5: Return Edit (8 tests)**
- Test 5.1: Edit Unpaid Return (Amount Change)
- Test 5.2: Try to Edit Refunded Return (Should Block)
- Test 5.3: Edit Return - Add Item
- Test 5.4: Edit Return - Remove Item
- Test 5.5: Cannot Edit Return After Partial Refund
- Test 5.6: Edit Return Reason
- Test 5.7: Edit Return Validation (Exceed Available Qty)
- Test 5.8: Delete Return (Unpaid Only)

---

### **BATCH 6: Refund Allocation (15 tests)**
Similar to Vendor Refund tests, adapted for Customer Refunds:
- Test 6.1: Create Refund - Full (Single Return)
- Test 6.2: Create Refund - Partial (Single Return)
- Test 6.3: Multiple Partial Refunds → Full
- Test 6.4: One Refund → Multiple Returns (Full Each)
- Test 6.5: One Refund → Multiple Returns (Partial on Last)
- Test 6.6: Refund with Different Modes
- Test 6.7: Refund Status Calculation
- Test 6.8: View Refund History
- Test 6.9: Over-Refund Validation (Should Fail)
- Test 6.10: Refund Allocation Sum Validation
- Test 6.11: Refund with Notes
- Test 6.12: Outstanding Returns List
- Test 6.13: Refund to Wrong Customer (Should Fail)
- Test 6.14: Reverse Refund
- Test 6.15: Auto-Allocate Refund (FIFO)

**Key Differences:**
- customer_refunds (not vendor_refunds)
- REFUND_PAID (we pay customer, not vendor pays us)
- Refund decreases our cash (not increases)

---

### **BATCH 7: Complex Integration (12 tests)**
End-to-end workflow tests:
- Test 7.1: Full Cycle (Sale → Payment → Return → Refund)
- Test 7.2: Partial Cycle (Partial Payment + Partial Refund)
- Test 7.3: Multiple Sales → Bulk Payment → Multiple Returns → Bulk Refund
- Test 7.4: Sale → Edit Amount → Payment → Edit Again
- Test 7.5: Return → Edit Amount → Refund → Edit Again
- Test 7.6: Payment Reversal → Re-Payment
- Test 7.7: Sale with Return Before Full Payment
- Test 7.8: Multiple Financial Years
- Test 7.9: Customer with 50+ Transactions
- Test 7.10: Sale → Return → Edit Sale (Should Update Return)
- Test 7.11: Concurrent Transactions
- Test 7.12: Customer Balance Summary Report

---

### **BATCH 8: Edge Cases (10 tests)**
Boundary and error condition tests:
- Test 8.1: Zero Amount Sale (Should Fail)
- Test 8.2: Negative Amount Validation
- Test 8.3: Very Large Amount Transaction
- Test 8.4: Decimal Precision
- Test 8.5: Special Characters in Notes
- Test 8.6: Very Long Product Names
- Test 8.7: Deleted Product in Sale
- Test 8.8: Deleted Customer in Sale
- Test 8.9: Date Edge Cases
- Test 8.10: Simultaneous Edits (Two Users)

---

### **BATCH 9: Data Integrity (8 tests)**
Database consistency verification:
- Test 9.1: Verify Payment Status Matches Allocations
- Test 9.2: Verify Refund Status Matches Allocations
- Test 9.3: Verify Ledger Balance Calculation
- Test 9.4: Verify No Orphaned Payment Allocations
- Test 9.5: Verify No Orphaned Refund Allocations
- Test 9.6: Verify Stock Levels Match Transaction History
- Test 9.7: Verify Financial Year Consistency
- Test 9.8: Comprehensive Data Integrity Report

---

## 🎯 IMPLEMENTATION NOTES

**For Batches 4-9:**
Each test will follow the same detailed format as Batches 1-3:
- Pre-conditions
- Step-by-step action steps
- Database verification checklist
- Pass criteria
- Notes section

**Key Adaptations from Purchase System:**
1. **Tables:** purchase → invoice, vendor_ledger → customer_ledger
2. **Stock:** Increases on purchase → Decreases on sale
3. **Money Flow:** We owe vendor → Customer owes us
4. **Transactions:** PURCHASE/PAYMENT → SALE/RECEIPT
5. **Returns:** DEBIT_NOTE → CREDIT_NOTE
6. **Refunds:** We receive → We pay

---

## 📞 NEXT STEPS

To complete this document:
1. Add detailed test scenarios for Batches 4-6 (Returns & Refunds)
2. Add detailed test scenarios for Batches 7-9 (Integration & Data Integrity)
3. Update progress tracker as tests are completed
4. Create corresponding SALEX document (tax-exempt version)

**Estimated Completion:**
- Batches 4-6: ~30-40 pages of detailed scenarios
- Batches 7-9: ~25-30 pages of detailed scenarios
- Total document: ~100-120 pages when complete

---

**Document Version:** 1.0 (In Progress)  
**Last Updated:** December 29, 2025  
**Status:** 37% Complete (37/100 tests documented)  
**Next Milestone:** Complete Batches 4-6 (Return & Refund scenarios)
