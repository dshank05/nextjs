# Comprehensive Test Scenarios - Vendor Payment & Return System

**Document Version:** 2.0  
**Updated:** January 11, 2026  
**Testing Framework:** Playwright E2E  
**Approach:** Real Browser + Real API + Real Database  
**Status:** 📋 READY FOR IMPLEMENTATION  
**Total Scenarios:** 100  
**Coverage:** Purchase, Payment, Return, Refund, Integration, Edge Cases

---

## 🎯 TESTING APPROACH

**Framework:** Playwright End-to-End Testing

**What We Test:**
- ✅ **Real UI Interactions** - Actual button clicks, form fills, page navigation
- ✅ **Real API Calls** - HTTP requests to Next.js API routes (no mocking)
- ✅ **Real Database** - Verify data integrity in MySQL after each operation
- ✅ **Complete Workflows** - Full user journeys from start to finish

**Test Pattern:**
```typescript
test('Test Name', async ({ page }) => {
  // 1. Navigate to page
  await page.goto('/purchases/create');
  
  // 2. Interact with UI (makes REAL API call)
  await page.fill('[name="qty"]', '10');
  await page.click('button:has-text("Create")');
  
  // 3. Verify UI updated
  await expect(page.locator('.success')).toBeVisible();
  
  // 4. Verify DATABASE updated correctly
  const purchase = await prisma.purchase.findFirst({...});
  expect(purchase.total).toBe(10000);
  
  const items = await prisma.purchaseitems.findMany({...});
  expect(items.length).toBe(1);
  
  const product = await prisma.product.findUnique({...});
  expect(product.stock).toBe(10); // Stock increased
  
  const ledger = await prisma.vendor_ledger.findFirst({...});
  expect(ledger.debit).toBe(10000); // Ledger updated
});
```

**See:** `docs/E2E_TESTING_GUIDE.md` for complete implementation guide

---

## 📊 TESTING PROGRESS TRACKER

| Batch | Category | Total | Completed | Status |
|-------|----------|-------|-----------|--------|
| 1 | Purchase Creation | 10 | 0 | ⏳ Pending |
| 2 | Purchase Edit | 12 | 0 | ⏳ Pending |
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

## BATCH 1: Purchase Creation (10 Scenarios)

### ✅ Test 1.1: Create Unpaid Purchase (No Tax)

**Pre-conditions:**
- Vendor exists (use any existing vendor)
- Product exists with stock ≥ 0

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`: 1 new record
  - `payment_status` = 0
  - `total` = 10000
  - `payment_mode` = NULL
- [ ] `purchaseitems`: 1 new record
  - `qty` = 10
  - `rate` = 1000
  - `subtotal` = 10000
- [ ] `bill_to`: 1 new record with vendor details
- [ ] `product`: stock increased by 10
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 10000
  - `credit` = 0
  - `balance` = previous_balance + 10000

**Pass Criteria:**
✅ All DB checks pass  
✅ API returns 201 status  
✅ No console errors  
✅ Balance increases correctly

**Notes:**
_Add any observations here_

---

### ✅ Test 1.2: Create Unpaid Purchase (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Unpaid
5. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 0
  - `total` = 11800 (10000 + 1800 tax)
  - `total_tax` = 1800
  - `total_cgst` = 900 (if intra-state)
  - `total_sgst` = 900 (if intra-state)
  - `total_igst` = 1800 (if inter-state)
- [ ] `purchaseitems`:
  - `tax` = 1800
  - `cgst` = 900 or `igst` = 1800 (based on vendor state)
- [ ] `vendor_ledger`:
  - `debit` = 11800
  - `balance` = previous_balance + 11800

**Pass Criteria:**
✅ Tax calculations correct  
✅ CGST/SGST for intra-state OR IGST for inter-state  
✅ Total includes tax

**Notes:**
_Document whether intra-state or inter-state was tested_

---

### ✅ Test 1.3: Create Paid Purchase - Cash (No Tax)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Paid
5. Set payment_mode = Cash
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 1
  - `payment_mode` = 0 (Cash)
  - `total` = 10000
- [ ] `vendor_ledger`: 2 new entries
  - Entry 1: `transaction_type` = 'PURCHASE', `debit` = 10000
  - Entry 2: `transaction_type` = 'PAYMENT', `credit` = 10000, `payment_mode` = 0
  - Final `balance` = previous_balance + 0 (10000 - 10000)

**Pass Criteria:**
✅ 2 ledger entries created  
✅ Balance returns to original (paid immediately)  
✅ Payment mode = 0 (Cash)

**Notes:**
_Add any observations_

---

### ✅ Test 1.4: Create Paid Purchase - Cash (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Paid
5. Set payment_mode = Cash
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 1
  - `payment_mode` = 0
  - `total` = 11800
- [ ] `vendor_ledger`: 2 entries
  - PURCHASE: debit = 11800
  - PAYMENT: credit = 11800
  - Final balance = previous_balance + 0

**Pass Criteria:**
✅ Paid with correct total including tax  
✅ Balance = 0 after immediate payment

---

### ✅ Test 1.5: Create Paid Purchase - Bank (No Tax)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Set payment_status = Paid
5. Set payment_mode = Bank
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 1
  - `payment_mode` = 1 (Bank)
- [ ] `vendor_ledger`:
  - PAYMENT entry has `payment_mode` = 1

**Pass Criteria:**
✅ Payment mode = 1 (Bank) stored correctly

---

### ✅ Test 1.6: Create Paid Purchase - Bank (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Paid
5. Set payment_mode = Bank
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 1
  - `payment_mode` = 1
  - `total` = 11800
- [ ] `vendor_ledger`:
  - PURCHASE: debit = 11800
  - PAYMENT: credit = 11800, payment_mode = 1

**Pass Criteria:**
✅ All tax and payment data correct

---

### ✅ Test 1.7: Create Purchase with Multiple Items

**Pre-conditions:**
- Vendor exists
- 3+ products exist

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 3 products:
   - Product 1: qty=5, rate=1000, tax=18%
   - Product 2: qty=10, rate=500, tax=12%
   - Product 3: qty=2, rate=2000, tax=0%
4. Set payment_status = Unpaid
5. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = (5×1000×1.18) + (10×500×1.12) + (2×2000) = 5900 + 5600 + 4000 = 15500
- [ ] `purchaseitems`: 3 new records
- [ ] Each product: stock increased by respective qty
- [ ] `vendor_ledger`: debit = 15500

**Pass Criteria:**
✅ All 3 items created  
✅ Total calculated correctly  
✅ Each product stock updated

---

### ✅ Test 1.8: Create Purchase with Packing & Forwarding

**Pre-conditions:**
- Vendor exists
- Product exists

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Enter Packing & Forwarding: qty=1, rate=500
5. Set payment_status = Unpaid
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 10000 + 500 = 10500
  - `packing_forwarding_qty` = 1
  - `packing_forwarding_rate` = 500
  - `packing_forwarding_total` = 500
- [ ] `vendor_ledger`: debit = 10500

**Pass Criteria:**
✅ P&F included in total  
✅ P&F fields saved correctly

---

### ✅ Test 1.9: Create Purchase with Transport Cost

**Pre-conditions:**
- Vendor exists
- Product exists

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=0%
4. Enter Transport Name: "Test Transport"
5. Enter Vehicle Number: "UP 12 AB 1234"
6. Enter Transport Cost: 1000
7. Set payment_status = Unpaid
8. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 10000 + 1000 = 11000
  - `transport_name` = "Test Transport"
  - `vehicle_number` = "UP 12 AB 1234"
  - `freight` = 1000
- [ ] `vendor_ledger`: debit = 11000

**Pass Criteria:**
✅ Transport cost added to total  
✅ Transport details saved

---

### ✅ Test 1.10: Create Purchase with "Other" Vendor

**Pre-conditions:**
- None (testing "Other" vendor)

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor = "Other"
3. Fill manual vendor details:
   - Name: "One-Time Vendor"
   - Phone: "9999999999"
   - State: "Uttar Pradesh"
4. Add 1 product: qty=10, rate=1000, tax=0%
5. Set payment_status = Unpaid
6. Click "Create Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `vendor_id` = 0
- [ ] `bill_to`:
  - `vendor_name` = "One-Time Vendor"
  - `contact_no` = "9999999999"
  - `state` = "Uttar Pradesh"
- [ ] `vendor_ledger`:
  - Entry created with vendor_id = 0

**Pass Criteria:**
✅ "Other" vendor saved as vendor_id = 0  
✅ Manual details saved in bill_to table  
✅ Ledger entry created

---

## BATCH 2: Purchase Edit (12 Scenarios)

### ✅ Test 2.1: Edit Unpaid Purchase (No Change)

**Pre-conditions:**
- Unpaid purchase exists (from Test 1.1)

**Action Steps:**
1. Navigate to purchase view page
2. Click "Edit"
3. Don't change anything
4. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`: No changes to data
- [ ] `vendor_ledger`: No new entries
- [ ] `product`: Stock unchanged

**Pass Criteria:**
✅ No unnecessary DB updates  
✅ No ledger entries created

---

### ✅ Test 2.2: Edit Unpaid Purchase (Amount Increase)

**Pre-conditions:**
- Unpaid purchase exists: total = 10000

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 15
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 15000 (increased)
- [ ] `purchaseitems`:
  - `qty` = 15 (updated)
- [ ] `product`:
  - Stock increased by +5 (additional qty)
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 5000 (difference)
  - `credit` = 0
  - New `balance` = previous_balance + 5000

**Pass Criteria:**
✅ Amount increased correctly  
✅ PURCHASE_ADJUSTMENT entry created  
✅ Stock adjusted properly

---

### ✅ Test 2.3: Edit Unpaid Purchase (Amount Decrease)

**Pre-conditions:**
- Unpaid purchase exists: total = 10000

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 7
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 7000 (decreased)
- [ ] `purchaseitems`:
  - `qty` = 7
- [ ] `product`:
  - Stock decreased by -3
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE_ADJUSTMENT'
  - `debit` = 0
  - `credit` = 3000 (negative adjustment)
  - New `balance` = previous_balance - 3000

**Pass Criteria:**
✅ Amount decreased correctly  
✅ Credit entry for reduction  
✅ Stock reduced

---

### ✅ Test 2.4: Edit Unpaid → Mark as Paid

**Pre-conditions:**
- Unpaid purchase exists: payment_status = 0, total = 10000

**Action Steps:**
1. Navigate to purchase edit page
2. Change payment_status from Unpaid → Paid
3. Select payment_mode = Cash
4. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 1
  - `payment_mode` = 0
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PAYMENT'
  - `debit` = 0
  - `credit` = 10000
  - New `balance` = previous_balance - 10000

**Pass Criteria:**
✅ Status changed to Paid  
✅ PAYMENT entry created  
✅ Balance reduced

---

### ✅ Test 2.5: Edit Unpaid → Mark as Paid (With Amount Change)

**Pre-conditions:**
- Unpaid purchase exists: total = 10000

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 12
3. Change payment_status from Unpaid → Paid
4. Select payment_mode = Bank
5. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 12000
  - `payment_status` = 1
  - `payment_mode` = 1
- [ ] `vendor_ledger`: 2 new entries
  - Entry 1: 'PURCHASE_ADJUSTMENT', debit = 2000
  - Entry 2: 'PAYMENT', credit = 12000
  - Final `balance` = previous_balance + 2000 - 12000 = previous_balance - 10000

**Pass Criteria:**
✅ Both amount and status changed  
✅ 2 ledger entries created  
✅ Balance adjusted correctly

---

### ✅ Test 2.6: Edit Paid Purchase (No Change)

**Pre-conditions:**
- Paid purchase exists (from Test 1.3)

**Action Steps:**
1. Navigate to purchase edit page
2. Don't change anything
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] No changes to any tables
- [ ] No new ledger entries

**Pass Criteria:**
✅ No unnecessary updates

---

### ✅ Test 2.7: Edit Paid Purchase (Amount Increase While Paid)

**Pre-conditions:**
- Paid purchase exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 12
3. Keep payment_status = Paid
4. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 12000
  - `payment_status` = 1 (still paid)
- [ ] `vendor_ledger`: 2 new entries
  - Entry 1: 'PURCHASE_ADJUSTMENT', debit = 2000
  - Entry 2: 'PAYMENT_ADJUSTMENT', credit = 2000
  - Final `balance` = previous_balance + 2000 - 2000 = previous_balance (unchanged)

**Pass Criteria:**
✅ Amount increased  
✅ Automatic payment adjustment  
✅ Balance stays 0 (still fully paid)

---

### ✅ Test 2.8: Edit Paid Purchase (Amount Decrease While Paid)

**Pre-conditions:**
- Paid purchase exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 8
3. Keep payment_status = Paid
4. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 8000
  - `payment_status` = 1
- [ ] `vendor_ledger`: 2 new entries
  - Entry 1: 'PURCHASE_ADJUSTMENT', credit = 2000
  - Entry 2: 'PAYMENT_ADJUSTMENT', debit = 2000
  - Final `balance` = previous_balance - 2000 + 2000 = previous_balance (unchanged)

**Pass Criteria:**
✅ Amount decreased  
✅ Automatic payment reversal for difference  
✅ Balance stays 0

---

### ✅ Test 2.9: Edit Paid → Unmark as Paid

**Pre-conditions:**
- Paid purchase exists: payment_status = 1, total = 10000

**Action Steps:**
1. Navigate to purchase edit page
2. Change payment_status from Paid → Unpaid
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `payment_status` = 0
  - `payment_mode` = NULL
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PAYMENT_REVERSAL'
  - `debit` = 10000
  - `credit` = 0
  - New `balance` = previous_balance + 10000

**Pass Criteria:**
✅ Status changed to Unpaid  
✅ PAYMENT_REVERSAL created  
✅ Balance restored

---

### ✅ Test 2.10: Edit Paid → Unmark as Paid (With Amount Change)

**Pre-conditions:**
- Paid purchase exists: total = 10000, payment_status = 1

**Action Steps:**
1. Navigate to purchase edit page
2. Change item qty from 10 → 15
3. Change payment_status from Paid → Unpaid
4. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchase`:
  - `total` = 15000
  - `payment_status` = 0
- [ ] `vendor_ledger`: 2 new entries
  - Entry 1: 'PURCHASE_ADJUSTMENT', debit = 5000
  - Entry 2: 'PAYMENT_REVERSAL', debit = 10000
  - Final `balance` = previous_balance + 5000 + 10000 = previous_balance + 15000

**Pass Criteria:**
✅ Amount and status changed  
✅ 2 ledger entries  
✅ Balance = full unpaid amount

---

### ✅ Test 2.11: Edit Purchase - Add Item

**Pre-conditions:**
- Purchase exists with 1 item

**Action Steps:**
1. Navigate to purchase edit page
2. Add a 2nd product
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchaseitems`: 2 records now
- [ ] `purchase`: total increased
- [ ] Both products: stock updated
- [ ] `vendor_ledger`: PURCHASE_ADJUSTMENT for new item total

**Pass Criteria:**
✅ 2nd item added successfully  
✅ Total recalculated  
✅ Both stocks updated

---

### ✅ Test 2.12: Edit Purchase - Remove Item

**Pre-conditions:**
- Purchase exists with 2+ items

**Action Steps:**
1. Navigate to purchase edit page
2. Delete 1 item
3. Click "Update Purchase"

**Verify DB Tables:**
- [ ] `purchaseitems`: 1 record removed
- [ ] `purchase`: total decreased
- [ ] Deleted item's product: stock decreased by removed qty
- [ ] `vendor_ledger`: PURCHASE_ADJUSTMENT (credit) for removed amount

**Pass Criteria:**
✅ Item removed  
✅ Stock reversed  
✅ Total adjusted

---

## BATCH 3: Payment Allocation (15 Scenarios)

### ✅ Test 3.1: Create Payment - Full Payment (Single Bill)

**Pre-conditions:**
- Unpaid purchase exists: ID=1, total=50000, balance=50000

**Action Steps:**
1. Navigate to `/entry/vendor-payment`
2. Select vendor
3. Enter payment amount = 50000
4. Allocate to Purchase #1: 50000
5. Set payment_mode = Bank
6. Click "Process Payment"

**Verify DB Tables:**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 50000
  - `payment_mode` = 1
  - `payment_type` = 'BILL_SPECIFIC'
- [ ] `payment_allocations`: 1 new record
  - `payment_id` = [new payment ID]
  - `purchase_id` = 1
  - `allocated_amount` = 50000
- [ ] `purchase`:
  - `payment_status` = 1 (Fully Paid)
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PAYMENT'
  - `credit` = 50000
  - New `balance` = previous_balance - 50000

**Pass Criteria:**
✅ Payment recorded  
✅ Allocation linked  
✅ Purchase status = Paid  
✅ Balance = 0

---

### ✅ Test 3.2: Create Payment - Partial Payment (Single Bill)

**Pre-conditions:**
- Unpaid purchase exists: ID=1, total=50000, balance=50000

**Action Steps:**
1. Navigate to `/entry/vendor-payment`
2. Select vendor
3. Enter payment amount = 30000
4. Allocate to Purchase #1: 30000
5. Set payment_mode = Cash
6. Click "Process Payment"

**Verify DB Tables:**
- [ ] `vendor_payments`:
  - `payment_amount` = 30000
  - `payment_mode` = 0
- [ ] `payment_allocations`:
  - `allocated_amount` = 30000
- [ ] `purchase`:
  - `payment_status` = 2 (Partially Paid) ⭐ NEW STATUS
- [ ] `vendor_ledger`:
  - `transaction_type` = 'PAYMENT'
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
- Unpaid purchase exists: ID=1, total=50000

**Action Steps:**
1. Make Payment #1: 20000 allocated to Purchase #1
2. Verify status = 2 (Partially Paid), balance = 30000
3. Make Payment #2: 15000 allocated to Purchase #1
4. Verify status = 2 (still partial), balance = 15000
5. Make Payment #3: 15000 allocated to Purchase #1
6. Verify status = 1 (Fully Paid), balance = 0

**Verify DB Tables (After Payment #3):**
- [ ] `vendor_payments`: 3 records total
- [ ] `payment_allocations`: 3 records for Purchase #1
  - Sum of allocated_amount = 50000
- [ ] `purchase`:
  - `payment_status` = 1 (Fully Paid after 3rd payment)
- [ ] `vendor_ledger`: 3 PAYMENT entries
  - Total credits = 50000
  - Final balance = 0

**Pass Criteria:**
✅ Status transitions: 0→2→2→1  
✅ All 3 payments tracked  
✅ Final balance = 0

---

### ✅ Test 3.4: One Payment → Multiple Bills (Full Payment Each)

**Pre-conditions:**
- 3 Unpaid purchases exist:
  - Purchase #1: total=40000
  - Purchase #2: total=40000
  - Purchase #3: total=20000

**Action Steps:**
1. Navigate to `/entry/vendor-payment`
2. Select vendor
3. Enter payment amount = 100000
4. Allocate:
   - Purchase #1: 40000
   - Purchase #2: 40000
   - Purchase #3: 20000
5. Click "Process Payment"

**Verify DB Tables:**
- [ ] `vendor_payments`: 1 record
  - `payment_amount` = 100000
- [ ] `payment_allocations`: 3 records
  - Purchase #1: 40000
  - Purchase #2: 40000
  - Purchase #3: 20000
- [ ] All 3 purchases:
  - `payment_status` = 1 (all fully paid)
- [ ] `vendor_ledger`: 3 PAYMENT entries
  - Total credits = 100000
  - Notes mention all 3 purchase IDs

**Pass Criteria:**
✅ 1 payment splits to 3 bills  
✅ All 3 bills marked as paid  
✅ 3 separate ledger entries

---

### ✅ Test 3.5: One Payment → Multiple Bills (Partial on Last)

**Pre-conditions:**
- 3 Unpaid purchases exist:
  - Purchase #1: total=40000
  - Purchase #2: total=40000
  - Purchase #3: total=40000

**Action Steps:**
1. Make payment = 100000
2. Allocate:
   - Purchase #1: 40000 (full)
   - Purchase #2: 40000 (full)
   - Purchase #3: 20000 (partial)

**Verify DB Tables:**
- [ ] `vendor_payments`: 1 record (100000)
- [ ] `payment_allocations`: 3 records
- [ ] Purchase #1: payment_status = 1 (paid)
- [ ] Purchase #2: payment_status = 1 (paid)
- [ ] Purchase #3: payment_status = 2 (partial - 20k of 40k paid)
- [ ] `vendor_ledger`: 3 entries
  - Each entry credits respective amount
  - Purchase #3 balance = 20000 remaining

**Pass Criteria:**
✅ Mixed full/partial allocations  
✅ Correct status for each bill  
✅ Remaining balance calculated

---

### ✅ Test 3.6: Payment with Different Modes

**Pre-conditions:**
- 2 Unpaid purchases exist

**Action Steps:**
1. Payment #1: 30000, mode=Cash, allocated to Purchase #1
2. Payment #2: 20000, mode=Bank, allocated to Purchase #1
3. Verify both payment modes stored correctly

**Verify DB Tables:**
- [ ] `vendor_payments`: 2 records
  - Payment #1: payment_mode = 0 (Cash)
  - Payment #2: payment_mode = 1 (Bank)
- [ ] `vendor_ledger`: 2 entries
  - Each has correct payment_mode value

**Pass Criteria:**
✅ Different payment modes tracked  
✅ Modes stored in ledger

---

### ✅ Test 3.7: Payment Status Calculation Accuracy

**Pre-conditions:**
- Purchase exists: total=50000

**Action Steps:**
1. Make payment: 0.01 allocated to purchase
2. Verify status = 2 (partially paid) not 1

**Verify DB Tables:**
- [ ] `purchase`:
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
- Purchase with 3 payments exists (from Test 3.3)

**Action Steps:**
1. Navigate to purchase view page
2. Check payment history section

**Verify Display:**
- [ ] Shows 3 payments with dates, amounts, modes
- [ ] Total paid = sum of all payments
- [ ] Remaining balance shown

**Pass Criteria:**
✅ All payments displayed  
✅ Totals calculated correctly

---

### ✅ Test 3.9: Payment to Wrong Vendor (Should Fail)

**Pre-conditions:**
- Purchase exists for Vendor A

**Action Steps:**
1. Try to create payment for Vendor B
2. Try to allocate to Vendor A's purchase

**Verify:**
- [ ] System prevents cross-vendor allocation
- [ ] Error message shown

**Pass Criteria:**
✅ Cannot allocate payment to wrong vendor's bills

---

### ✅ Test 3.10: Overpayment Validation (Should Fail)

**Pre-conditions:**
- Purchase exists: total=50000, unpaid

**Action Steps:**
1. Try to allocate 60000 to this purchase
2. System should reject

**Verify:**
- [ ] Validation error shown
- [ ] Cannot allocate more than bill total

**Pass Criteria:**
✅ Overpayment prevented

---

### ✅ Test 3.11: Payment Allocation Sum Validation

**Pre-conditions:**
- Multiple purchases exist

**Action Steps:**
1. Enter payment amount = 100000
2. Try to allocate: Bill1=50000, Bill2=60000 (total=110000)
3. System should reject

**Verify:**
- [ ] Error: "Allocation sum exceeds payment amount"

**Pass Criteria:**
✅ Allocation validation works

---

### ✅ Test 3.12: Payment with Notes

**Pre-conditions:**
- Unpaid purchase exists

**Action Steps:**
1. Create payment with notes: "Partial payment via bank transfer"
2. Verify notes saved

**Verify DB Tables:**
- [ ] `vendor_payments`: notes field contains text
- [ ] Notes displayed in payment history

**Pass Criteria:**
✅ Notes saved and displayed

---

### ✅ Test 3.13: Outstanding Bills List

**Pre-conditions:**
- Multiple purchases exist (mix of paid/unpaid/partial)

**Action Steps:**
1. Navigate to payment entry page
2. Select vendor
3. Check outstanding bills list

**Verify Display:**
- [ ] Shows only unpaid and partially paid bills
- [ ] Shows remaining amount for each
- [ ] Excludes fully paid bills

**Pass Criteria:**
✅ Only outstanding bills shown  
✅ Amounts correct

---

### ✅ Test 3.14: Payment Allocation to Oldest Bills First

**Pre-conditions:**
- 3 purchases exist with different dates

**Action Steps:**
1. Make payment
2. Observe auto-suggestion for allocation

**Verify:**
- [ ] System suggests oldest bills first
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
- [ ] Purchase status reverted
- [ ] Vendor balance restored
- [ ] Ledger has reversal entries

**Pass Criteria:**
✅ Payment reversed completely  
✅ All data restored  
✅ No deletion (audit trail maintained)

---

## BATCH 4: Return Creation (10 Scenarios)

### ✅ Test 4.1: Create Unpaid Return (No Tax)

**Pre-conditions:**
- Purchase exists with items (qty available for return)

**Action Steps:**
1. Navigate to `/entry/purchasereturn-vendor-create`
2. Select vendor
3. Select items to return: qty=5, rate=1000, tax=0%
4. Set payment_status = Unpaid (no refund yet)
5. Click "Create Return"

**Verify DB Tables:**
- [ ] `purchase_returns`: 1 new record
  - `payment_status` = 0 (Unpaid)
  - `refund_amount` = 5000
- [ ] `purchase_return_items`: 1 record
- [ ] `product`: stock decreased by 5
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'DEBIT_NOTE'
  - `debit` = 0
  - `credit` = 5000
  - Balance decreased by 5000

**Pass Criteria:**
✅ Return created  
✅ Stock reduced  
✅ Vendor balance reduced (owes less)

---

### ✅ Test 4.2: Create Unpaid Return (With Tax)

**Pre-conditions:**
- Purchase exists with taxed items

**Action Steps:**
1. Create return with tax=18%
2. Return qty=5, rate=1000, tax=18%

**Verify DB Tables:**
- [ ] `purchase_returns`:
  - `refund_amount` = 5900
  - `total_tax` = 900
- [ ] `purchase_return_items`:
  - `cgst` = 450 or `igst` = 900
- [ ] `vendor_ledger`: credit = 5900

**Pass Criteria:**
✅ Tax calculated correctly  
✅ Balance reduced by total including tax

---

### ✅ Test 4.3: Create Return with Refund Received (Cash)

**Pre-conditions:**
- Purchase exists

**Action Steps:**
1. Create return: qty=5, rate=1000
2. Set payment_status = Refunded
3. Set payment_mode = Cash

**Verify DB Tables:**
- [ ] `purchase_returns`:
  - `payment_status` = 1 (Refunded)
  - `payment_mode` = 0 (Cash)
- [ ] `vendor_ledger`: 2 entries
  - DEBIT_NOTE: credit = 5000
  - REFUND_RECEIVED: debit = 5000
  - Balance change = -5000 + 5000 = 0

**Pass Criteria:**
✅ Return marked as refunded  
✅ 2 ledger entries  
✅ Balance netted out

---

### ✅ Test 4.4: Create Return with Refund Received (Bank)

**Pre-conditions:**
- Purchase exists

**Action Steps:**
1. Create return with refund
2. payment_mode = Bank

**Verify DB Tables:**
- [ ] `purchase_returns`: payment_mode = 1
- [ ] `vendor_ledger`: REFUND_RECEIVED has payment_mode = 1

**Pass Criteria:**
✅ Bank mode saved correctly

---

### ✅ Test 4.5: Partial Return (Some Items)

**Pre-conditions:**
- Purchase has 3 items

**Action Steps:**
1. Return only 2 of 3 items
2. Create return

**Verify DB Tables:**
- [ ] `purchase`: return_status = 1 (Partial)
- [ ] Only 2 items have return records
- [ ] 1 item remains unreturned

**Pass Criteria:**
✅ Partial return tracked  
✅ Return status = 1 (Partial)

---

### ✅ Test 4.6: Full Return (All Items)

**Pre-conditions:**
- Purchase has 3 items

**Action Steps:**
1. Return all 3 items
2. Create return

**Verify DB Tables:**
- [ ] `purchase`: return_status = 2 (Full)
- [ ] All 3 items marked as returned

**Pass Criteria:**
✅ Full return tracked  
✅ Return status = 2 (Full)

---

### ✅ Test 4.7: Return Quantity Validation

**Pre-conditions:**
- Purchase item: qty=10

**Action Steps:**
1. Try to return qty=15 (more than purchased)
2. System should reject

**Verify:**
- [ ] Validation error shown
- [ ] Cannot return more than purchased

**Pass Criteria:**
✅ Validation prevents over-return

---

### ✅ Test 4.8: Multiple Returns from Same Purchase

**Pre-conditions:**
- Purchase: qty=20

**Action Steps:**
1. Return #1: qty=5
2. Return #2: qty=3
3. Return #3: qty=2
4. Total returned = 10 of 20

**Verify DB Tables:**
- [ ] 3 return records
- [ ] Purchase: return_status = 1 (Partial)
- [ ] Item: returned_qty = 10, available_qty = 10

**Pass Criteria:**
✅ Multiple returns tracked  
✅ Running totals correct

---

### ✅ Test 4.9: Return with Debit Note Number

**Pre-conditions:**
- Purchase exists

**Action Steps:**
1. Create return
2. Verify debit note number auto-generated

**Verify DB Tables:**
- [ ] `purchase_returns`: debit_note_no populated
- [ ] Number follows DN-XXX format
- [ ] Number is unique

**Pass Criteria:**
✅ Debit note auto-numbered

---

### ✅ Test 4.10: Return Reason Tracking

**Pre-conditions:**
- Return reasons exist in DB

**Action Steps:**
1. Create return
2. Select reason: "Defective"
3. Add notes: "Item damaged"

**Verify DB Tables:**
- [ ] `purchase_return_items`: return_reason_id saved
- [ ] Notes field populated

**Pass Criteria:**
✅ Reason and notes saved

---

## BATCH 5: Return Edit (8 Scenarios)

### ✅ Test 5.1: Edit Unpaid Return (Amount Change)

**Pre-conditions:**
- Unpaid return exists: refund_amount=5000

**Action Steps:**
1. Navigate to return edit page
2. Change qty from 5 → 7
3. Click "Update Return"

**Verify DB Tables:**
- [ ] `purchase_returns`: refund_amount = 7000
- [ ] `purchase_return_items`: qty = 7
- [ ] `product`: stock adjusted (-2 additional)
- [ ] `vendor_ledger`: adjustment entry

**Pass Criteria:**
✅ Amount changed  
✅ Stock adjusted

---

### ✅ Test 5.2: Try to Edit Refunded Return (Should Block)

**Pre-conditions:**
- Return exists with payment_status=1 (refunded)

**Action Steps:**
1. Navigate to return edit page
2. Try to make changes
3. System should prevent edits

**Verify:**
- [ ] Edit button disabled or warning shown
- [ ] "Cannot edit refunded return" message

**Pass Criteria:**
✅ Refunded returns cannot be edited

---

### ✅ Test 5.3: Edit Return - Add Item

**Pre-conditions:**
- Return exists with 1 item

**Action Steps:**
1. Add 2nd item from same purchase
2. Update return

**Verify DB Tables:**
- [ ] `purchase_return_items`: 2 records
- [ ] Total refund amount increased
- [ ] Both items: stock adjusted

**Pass Criteria:**
✅ Item added successfully

---

### ✅ Test 5.4: Edit Return - Remove Item

**Pre-conditions:**
- Return exists with 2 items

**Action Steps:**
1. Remove 1 item
2. Update return

**Verify DB Tables:**
- [ ] `purchase_return_items`: 1 record removed
- [ ] Total decreased
- [ ] Removed item: stock restored

**Pass Criteria:**
✅ Item removed  
✅ Stock corrected

---

### ✅ Test 5.5: Cannot Edit Return After Partial Refund

**Pre-conditions:**
- Return with partial refund (payment_status=2)

**Action Steps:**
1. Try to edit return
2. Should be blocked

**Verify:**
- [ ] Editing prevented
- [ ] Warning message shown

**Pass Criteria:**
✅ Partially refunded returns locked

---

### ✅ Test 5.6: Edit Return Reason

**Pre-conditions:**
- Unpaid return exists

**Action Steps:**
1. Change return reason from "Defective" → "Wrong Item"
2. Update return

**Verify DB Tables:**
- [ ] `purchase_return_items`: return_reason_id updated

**Pass Criteria:**
✅ Reason updated

---

### ✅ Test 5.7: Edit Return Validation (Exceed Available Qty)

**Pre-conditions:**
- Purchase: original_qty=10, already_returned=5, available=5

**Action Steps:**
1. Try to edit return to return qty=8 (exceeds available 5)
2. Should fail

**Verify:**
- [ ] Validation error
- [ ] Cannot exceed available quantity

**Pass Criteria:**
✅ Validation works

---

### ✅ Test 5.8: Delete Return (Unpaid Only)

**Pre-conditions:**
- Unpaid return exists

**Action Steps:**
1. Delete return
2. Confirm deletion

**Verify DB Tables:**
- [ ] Return record marked as deleted/cancelled
- [ ] Stock restored
- [ ] Ledger: reversal entry
- [ ] Purchase: return_status updated

**Pass Criteria:**
✅ Return cancelled  
✅ All changes reversed

---

## BATCH 6: Refund Allocation (15 Scenarios)

### ✅ Test 6.1: Create Refund - Full Refund (Single Return)

**Pre-conditions:**
- Unpaid return exists: refund_amount=5000

**Action Steps:**
1. Navigate to `/entry/vendor-refund`
2. Select vendor
3. Enter refund amount = 5000
4. Allocate to Return #1: 5000
5. Set refund_mode = Bank
6. Click "Process Refund"

**Verify DB Tables:**
- [ ] `vendor_refunds`: 1 new record
  - `refund_amount` = 5000
  - `refund_mode` = 1
- [ ] `refund_allocations`: 1 record
  - `allocated_amount` = 5000
- [ ] `purchase_returns`: payment_status = 1 (Fully Refunded)
- [ ] `vendor_ledger`: REFUND_RECEIVED entry (debit 5000)

**Pass Criteria:**
✅ Refund recorded  
✅ Return marked as refunded  
✅ Balance adjusted

**Notes:**
_✅ Refund validation now supports vendor returns (flag-based approach implemented)_

---

### ✅ Test 6.2: Create Refund - Partial Refund (Single Return)

**Pre-conditions:**
- Unpaid return exists: refund_amount=10000

**Action Steps:**
1. Create refund = 6000
2. Allocate to Return #1: 6000

**Verify DB Tables:**
- [ ] `vendor_refunds`: refund_amount = 6000
- [ ] `purchase_returns`: payment_status = 2 (Partially Refunded)
- [ ] Remaining refund = 4000

**Pass Criteria:**
✅ Partial refund tracked  
✅ Status = 2 (Partially Refunded)

---

### ✅ Test 6.3: Multiple Partial Refunds → Full Refund

**Pre-conditions:**
- Return exists: refund_amount=10000

**Action Steps:**
1. Refund #1: 4000
2. Refund #2: 3000
3. Refund #3: 3000
4. Verify status progression: 0→2→2→1

**Verify DB Tables:**
- [ ] 3 refund records
- [ ] 3 allocation records
- [ ] Final status = 1 (Fully Refunded)
- [ ] 3 ledger entries

**Pass Criteria:**
✅ Status transitions correctly  
✅ All refunds tracked

---

### ✅ Test 6.4: One Refund → Multiple Returns (Full Each)

**Pre-conditions:**
- 3 returns exist: 5k, 3k, 2k

**Action Steps:**
1. Create refund = 10000
2. Allocate: Return1=5000, Return2=3000, Return3=2000

**Verify DB Tables:**
- [ ] 1 refund record
- [ ] 3 allocation records
- [ ] All 3 returns: payment_status = 1

**Pass Criteria:**
✅ 1 refund splits to 3 returns  
✅ All marked as refunded

---

### ✅ Test 6.5: One Refund → Multiple Returns (Partial on Last)

**Pre-conditions:**
- 3 returns exist: 5k each

**Action Steps:**
1. Create refund = 12000
2. Allocate: Return1=5000, Return2=5000, Return3=2000

**Verify DB Tables:**
- [ ] Return1, Return2: status = 1
- [ ] Return3: status = 2 (partial - 2k of 5k)

**Pass Criteria:**
✅ Mixed allocations work  
✅ Correct status for each

---

### ✅ Test 6.6: Refund with Different Modes

**Pre-conditions:**
- 2 returns exist

**Action Steps:**
1. Refund #1: Cash
2. Refund #2: Bank
3. Verify modes saved

**Verify DB Tables:**
- [ ] Each refund has correct refund_mode
- [ ] Modes in ledger entries

**Pass Criteria:**
✅ Modes tracked separately

---

### ✅ Test 6.7: Refund Status Calculation

**Pre-conditions:**
- Return: refund_amount=10000

**Action Steps:**
1. Allocate 0.01 to return
2. Verify status = 2 (not 1)

**Verify:**
- [ ] Partial refund triggers status = 2
- [ ] Only exact match triggers status = 1

**Pass Criteria:**
✅ Status calculation accurate

---

### ✅ Test 6.8: View Refund History

**Pre-conditions:**
- Return with 3 refunds

**Action Steps:**
1. View return details
2. Check refund history section

**Verify Display:**
- [ ] All 3 refunds shown
- [ ] Total refunded amount
- [ ] Remaining amount

**Pass Criteria:**
✅ History complete

---

### ✅ Test 6.9: Over-Refund Validation (Should Fail)

**Pre-conditions:**
- Return: refund_amount=5000

**Action Steps:**
1. Try to allocate 6000
2. Should fail

**Verify:**
- [ ] Validation error
- [ ] Cannot refund more than return amount

**Pass Criteria:**
✅ Over-refund prevented

---

### ✅ Test 6.10: Refund Allocation Sum Validation

**Pre-conditions:**
- Multiple returns

**Action Steps:**
1. Refund = 10000
2. Try to allocate 12000 total
3. Should fail

**Verify:**
- [ ] Error message

**Pass Criteria:**
✅ Allocation validation works

---

### ✅ Test 6.11: Refund with Notes

**Pre-conditions:**
- Return exists

**Action Steps:**
1. Create refund with notes
2. Verify saved

**Verify DB Tables:**
- [ ] Notes in vendor_refunds table
- [ ] Notes displayed in history

**Pass Criteria:**
✅ Notes saved

---

### ✅ Test 6.12: Outstanding Returns List

**Pre-conditions:**
- Mix of refunded/unrefunded/partial returns

**Action Steps:**
1. Navigate to refund entry
2. Check outstanding list

**Verify Display:**
- [ ] Shows only unrefunded and partial
- [ ] Shows remaining amounts
- [ ] Excludes fully refunded

**Pass Criteria:**
✅ Only outstanding shown

---

### ✅ Test 6.13: Refund to Wrong Vendor (Should Fail)

**Pre-conditions:**
- Return for Vendor A

**Action Steps:**
1. Try to allocate Vendor B's refund to it
2. Should fail

**Verify:**
- [ ] Cross-vendor allocation prevented

**Pass Criteria:**
✅ Validation works

---

### ✅ Test 6.14: Reverse Refund

**Pre-conditions:**
- Refund with allocations exists

**Action Steps:**
1. Reverse refund
2. Confirm

**Verify DB Tables:**
- [ ] Negative refund record
- [ ] Negative allocations
- [ ] Return status reverted
- [ ] Balance restored
- [ ] Reversal ledger entries

**Pass Criteria:**
✅ Refund reversed  
✅ Audit trail maintained

---

### ✅ Test 6.15: Auto-Allocate Refund (FIFO)

**Pre-conditions:**
- Multiple returns with different dates

**Action Steps:**
1. Create refund
2. Check auto-suggestion

**Verify:**
- [ ] Oldest returns suggested first

**Pass Criteria:**
✅ FIFO suggestion works

---

## BATCH 7: Complex Integration (12 Scenarios)

### ✅ Test 7.1: Full Cycle (Purchase → Pay → Return → Refund)

**Pre-conditions:**
- Clean vendor (balance=0)

**Action Steps:**
1. Create purchase: 50k (unpaid)
2. Verify balance = 50k
3. Pay 50k
4. Verify balance = 0
5. Create return: 20k (unpaid)
6. Verify balance = -20k
7. Receive refund: 20k
8. Verify balance = 0

**Verify Final State:**
- [ ] Vendor balance = 0
- [ ] All ledger entries correct
- [ ] Purchase: payment_status = 1
- [ ] Return: payment_status = 1

**Pass Criteria:**
✅ Complete cycle tracked  
✅ Final balance = 0

---

### ✅ Test 7.2: Partial Cycle (Partial Pay + Partial Refund)

**Pre-conditions:**
- Clean vendor

**Action Steps:**
1. Purchase: 50k (unpaid) → balance = 50k
2. Partial pay: 30k → balance = 20k
3. Return: 15k (unpaid) → balance = 5k
4. Partial refund: 10k → balance = 15k

**Verify:**
- [ ] Purchase: status = 2 (partial)
- [ ] Return: status = 2 (partial)
- [ ] Final balance = 15k (15k owed to vendor)

**Pass Criteria:**
✅ Partial tracking works  
✅ Balance calculation correct

---

### ✅ Test 7.3: Multiple Purchases → Bulk Payment → Multiple Returns → Bulk Refund

**Pre-conditions:**
- Clean vendor

**Action Steps:**
1. Create 5 purchases (mix of amounts)
2. Make 1 large payment → allocate to all
3. Create 3 returns from different purchases
4. Make 1 large refund → allocate to all returns

**Verify:**
- [ ] All purchases: correct payment status
- [ ] All returns: correct refund status
- [ ] Balance calculation includes all transactions

**Pass Criteria:**
✅ Bulk operations work  
✅ Cross-transaction tracking

---

### ✅ Test 7.4: Purchase → Edit Amount → Payment → Edit Again

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase: 50k (unpaid)
2. Edit to 60k
3. Pay 60k
4. Edit to 65k (automatic payment adjustment)

**Verify Ledger:**
- [ ] PURCHASE: 50k
- [ ] PURCHASE_ADJUSTMENT: 10k
- [ ] PAYMENT: 60k
- [ ] PURCHASE_ADJUSTMENT: 5k
- [ ] PAYMENT_ADJUSTMENT: 5k
- [ ] Final balance = 0

**Pass Criteria:**
✅ All adjustments tracked  
✅ Balance remains 0 (fully paid)

---

### ✅ Test 7.5: Return → Edit Amount → Refund → Edit Again

**Pre-conditions:**
- Purchase exists

**Action Steps:**
1. Create return: 10k (unpaid)
2. Edit to 12k
3. Receive refund: 12k
4. Try to edit (should be blocked)

**Verify:**
- [ ] Editing blocked after refund
- [ ] Balance reflects 12k refund

**Pass Criteria:**
✅ Cannot edit after refund  
✅ Balance correct

---

### ✅ Test 7.6: Payment Reversal → Re-Payment

**Pre-conditions:**
- Paid purchase exists

**Action Steps:**
1. Reverse payment
2. Verify status = 0 (unpaid)
3. Make new payment
4. Verify status = 1 (paid again)

**Verify Ledger:**
- [ ] Original PAYMENT
- [ ] PAYMENT_REVERSAL
- [ ] New PAYMENT
- [ ] Final balance = 0

**Pass Criteria:**
✅ Reversal and re-payment work  
✅ Audit trail complete

---

### ✅ Test 7.7: Purchase with Return Before Full Payment

**Pre-conditions:**
- None

**Action Steps:**
1. Purchase: 100k (unpaid)
2. Pay: 60k (partial)
3. Return: 30k (unpaid)
4. Pay: 40k (should fully pay remaining)

**Verify:**
- [ ] Balance: 100 - 60 - 30 = 10k
- [ ] After 2nd payment (40k): 10k - 40k = -30k
- [ ] Need refund of 30k for return

**Pass Criteria:**
✅ Complex balance calculation correct

---

### ✅ Test 7.8: Multiple Financial Years

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase in FY 2024
2. Make payment in FY 2025
3. Verify both transactions in correct FY

**Verify DB:**
- [ ] Purchase: fy = 2024
- [ ] Payment: fy = 2025
- [ ] Both linked correctly

**Pass Criteria:**
✅ Cross-FY tracking works

---

### ✅ Test 7.9: Vendor with 50+ Transactions

**Pre-conditions:**
- None

**Action Steps:**
1. Create 50+ mixed transactions
2. Verify ledger balance calculation

**Verify:**
- [ ] Ledger has all entries
- [ ] Balance calculated correctly
- [ ] No performance issues

**Pass Criteria:**
✅ Large transaction volume handled

---

### ✅ Test 7.10: Purchase → Return → Edit Purchase (Should Update Return)

**Pre-conditions:**
- Purchase with return exists

**Action Steps:**
1. Try to edit purchase that has returns
2. Verify restrictions

**Verify:**
- [ ] Cannot edit returned items
- [ ] Warning shown
- [ ] Edit blocked or restricted

**Pass Criteria:**
✅ Return restrictions enforced

---

### ✅ Test 7.11: Concurrent Transactions

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase
2. Simultaneously try to pay and return
3. Verify data integrity

**Verify:**
- [ ] No race conditions
- [ ] Both transactions complete correctly
- [ ] Balance correct

**Pass Criteria:**
✅ Concurrent operations safe

---

### ✅ Test 7.12: Vendor Balance Summary Report

**Pre-conditions:**
- Vendor with multiple transactions

**Action Steps:**
1. View vendor balance summary
2. Verify totals

**Verify Display:**
- [ ] Total purchases
- [ ] Total payments
- [ ] Total returns
- [ ] Total refunds
- [ ] Current balance
- [ ] All match ledger

**Pass Criteria:**
✅ Summary accurate

---

## BATCH 8: Edge Cases (10 Scenarios)

### ✅ Test 8.1: Zero Amount Purchase (Should Fail)

**Pre-conditions:**
- None

**Action Steps:**
1. Try to create purchase with 0 amount
2. Should fail validation

**Verify:**
- [ ] Error message shown
- [ ] Purchase not created

**Pass Criteria:**
✅ Zero validation works

---

### ✅ Test 8.2: Negative Amount Validation

**Pre-conditions:**
- None

**Action Steps:**
1. Try to enter negative qty or rate
2. Should fail

**Verify:**
- [ ] Validation prevents negative values

**Pass Criteria:**
✅ Negative validation works

---

### ✅ Test 8.3: Very Large Amount Transaction

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase: ₹10,00,00,000 (1 crore)
2. Verify handling

**Verify DB:**
- [ ] Amount stored correctly
- [ ] No overflow errors
- [ ] Ledger calculations correct

**Pass Criteria:**
✅ Large amounts handled

---

### ✅ Test 8.4: Decimal Precision

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase: qty=2.5, rate=333.33
2. Verify calculations

**Verify:**
- [ ] Subtotal = 833.325
- [ ] Stored with correct precision
- [ ] No rounding errors

**Pass Criteria:**
✅ Decimal handling correct

---

### ✅ Test 8.5: Special Characters in Notes

**Pre-conditions:**
- None

**Action Steps:**
1. Enter notes with special chars: <script>alert('test')</script>
2. Verify sanitization

**Verify:**
- [ ] No XSS vulnerability
- [ ] Special chars escaped or stripped

**Pass Criteria:**
✅ Input sanitized

---

### ✅ Test 8.6: Very Long Product Names

**Pre-conditions:**
- Product with 500+ char name

**Action Steps:**
1. Add to purchase
2. Verify display and storage

**Verify:**
- [ ] Name truncated in UI
- [ ] Full name stored in DB
- [ ] No overflow issues

**Pass Criteria:**
✅ Long text handled

---

### ✅ Test 8.7: Deleted Product in Purchase

**Pre-conditions:**
- Purchase with product A
- Product A deleted

**Action Steps:**
1. View purchase
2. Try to edit purchase

**Verify:**
- [ ] Product name still shows (from purchaseitems)
- [ ] Cannot add more of deleted product
- [ ] Historical data preserved

**Pass Criteria:**
✅ Deleted product handled

---

### ✅ Test 8.8: Deleted Vendor in Purchase

**Pre-conditions:**
- Purchase with vendor A
- Vendor A deleted

**Action Steps:**
1. View purchase
2. Try to make payment

**Verify:**
- [ ] Vendor name preserved (from bill_to)
- [ ] Payment still possible
- [ ] Historical data intact

**Pass Criteria:**
✅ Deleted vendor handled

---

### ✅ Test 8.9: Date Edge Cases

**Pre-conditions:**
- None

**Action Steps:**
1. Create purchase with past date
2. Create purchase with future date
3. Verify both accepted

**Verify:**
- [ ] Both dates saved correctly
- [ ] Ledger dates match
- [ ] No date validation errors

**Pass Criteria:**
✅ Date flexibility works

---

### ✅ Test 8.10: Simultaneous Edits (Two Users)

**Pre-conditions:**
- Purchase exists

**Action Steps:**
1. User A starts editing
2. User B starts editing same purchase
3. User A saves
4. User B tries to save

**Verify:**
- [ ] Conflict detected
- [ ] Last write wins OR error shown
- [ ] Data integrity maintained

**Pass Criteria:**
✅ Concurrency handled

---

## BATCH 9: Data Integrity (8 Scenarios)

### ✅ Test 9.1: Verify Payment Status Matches Allocations

**Pre-conditions:**
- Multiple purchases with various payment statuses

**Action Steps:**
1. Run verification query
2. Compare payment_status vs actual allocations

**Verify:**
```sql
SELECT 
  p.id, 
  p.total,
  p.payment_status,
  COALESCE(SUM(pa.allocated_amount), 0) as total_paid
FROM purchase p
LEFT JOIN payment_allocations pa ON p.id = pa.purchase_id
GROUP BY p.id
HAVING 
  (total_paid = 0 AND payment_status != 0) OR
  (total_paid >= p.total AND payment_status != 1) OR
  (total_paid > 0 AND total_paid < p.total AND payment_status != 2)
```
- [ ] Query returns 0 rows (all statuses correct)

**Pass Criteria:**
✅ All payment statuses match actual allocations

---

### ✅ Test 9.2: Verify Refund Status Matches Allocations

**Pre-conditions:**
- Multiple returns with various refund statuses

**Action Steps:**
1. Run verification query
2. Compare payment_status vs actual refund allocations

**Verify:**
```sql
SELECT 
  pr.id, 
  pr.refund_amount,
  pr.payment_status,
  COALESCE(SUM(ra.allocated_amount), 0) as total_refunded
FROM purchase_returns pr
LEFT JOIN refund_allocations ra ON pr.id = ra.return_id
GROUP BY pr.id
HAVING 
  (total_refunded = 0 AND payment_status != 0) OR
  (total_refunded >= pr.refund_amount AND payment_status != 1) OR
  (total_refunded > 0 AND total_refunded < pr.refund_amount AND payment_status != 2)
```
- [ ] Query returns 0 rows (all statuses correct)

**Pass Criteria:**
✅ All refund statuses match actual allocations

---

### ✅ Test 9.3: Verify Ledger Balance Calculation

**Pre-conditions:**
- Vendor with multiple transactions

**Action Steps:**
1. Calculate balance from ledger entries
2. Compare with latest balance field

**Verify:**
```sql
SELECT 
  vendor_id,
  SUM(debit) - SUM(credit) as calculated_balance,
  (SELECT balance FROM vendor_ledger WHERE vendor_id = vl.vendor_id ORDER BY id DESC LIMIT 1) as stored_balance
FROM vendor_ledger vl
GROUP BY vendor_id
HAVING calculated_balance != stored_balance
```
- [ ] Query returns 0 rows (all balances correct)

**Pass Criteria:**
✅ Calculated balances match stored balances

---

### ✅ Test 9.4: Verify No Orphaned Payment Allocations

**Pre-conditions:**
- Database with various transactions

**Action Steps:**
1. Check for orphaned allocation records

**Verify:**
```sql
-- Orphaned payment allocations (payment doesn't exist)
SELECT * FROM payment_allocations pa
LEFT JOIN vendor_payments vp ON pa.payment_id = vp.id
WHERE vp.id IS NULL;

-- Orphaned payment allocations (purchase doesn't exist)
SELECT * FROM payment_allocations pa
LEFT JOIN purchase p ON pa.purchase_id = p.id
WHERE p.id IS NULL;
```
- [ ] Both queries return 0 rows

**Pass Criteria:**
✅ No orphaned payment allocations

---

### ✅ Test 9.5: Verify No Orphaned Refund Allocations

**Pre-conditions:**
- Database with various transactions

**Action Steps:**
1. Check for orphaned refund allocation records

**Verify:**
```sql
-- Orphaned refund allocations (refund doesn't exist)
SELECT * FROM refund_allocations ra
LEFT JOIN vendor_refunds vr ON ra.refund_id = vr.id
WHERE vr.id IS NULL;

-- Orphaned refund allocations (return doesn't exist)
SELECT * FROM refund_allocations ra
LEFT JOIN purchase_returns pr ON ra.return_id = pr.id
WHERE pr.id IS NULL;
```
- [ ] Both queries return 0 rows

**Pass Criteria:**
✅ No orphaned refund allocations

---

### ✅ Test 9.6: Verify Stock Levels Match Transaction History

**Pre-conditions:**
- Products with purchase and return history

**Action Steps:**
1. Calculate stock from transactions
2. Compare with product.stock

**Verify:**
```sql
WITH stock_changes AS (
  SELECT 
    product_id,
    SUM(qty) as purchased
  FROM purchaseitems
  GROUP BY product_id
), stock_returns AS (
  SELECT 
    product_id,
    SUM(pri.return_qty) as returned
  FROM purchase_return_items pri
  GROUP BY product_id
)
SELECT 
  p.id,
  p.product_name,
  p.stock as current_stock,
  COALESCE(sc.purchased, 0) - COALESCE(sr.returned, 0) as calculated_stock
FROM product p
LEFT JOIN stock_changes sc ON p.id = sc.product_id
LEFT JOIN stock_returns sr ON p.id = sr.product_id
WHERE p.stock != COALESCE(sc.purchased, 0) - COALESCE(sr.returned, 0)
```
- [ ] Query returns 0 rows (adjust for opening stock if needed)

**Pass Criteria:**
✅ Stock levels match transaction history

---

### ✅ Test 9.7: Verify Financial Year Consistency

**Pre-conditions:**
- Transactions across multiple FYs

**Action Steps:**
1. Check all related records have same FY

**Verify:**
```sql
-- Purchases and their items should have same FY
SELECT p.id, p.fy as purchase_fy, pi.fy as item_fy
FROM purchase p
JOIN purchaseitems pi ON p.invoice_no = pi.invoice_no
WHERE p.fy != pi.fy;

-- Returns and their items should have same FY
SELECT pr.id, pr.fy as return_fy, pri.fy as item_fy
FROM purchase_returns pr
JOIN purchase_return_items pri ON pr.id = pri.purchase_return_id
WHERE pr.fy != pri.fy;
```
- [ ] Both queries return 0 rows

**Pass Criteria:**
✅ FY consistency maintained

---

### ✅ Test 9.8: Comprehensive Data Integrity Report

**Pre-conditions:**
- Complete system with all transaction types

**Action Steps:**
1. Run comprehensive integrity check
2. Generate report

**Verify All:**
- [ ] All payment statuses correct (Test 9.1)
- [ ] All refund statuses correct (Test 9.2)
- [ ] All ledger balances correct (Test 9.3)
- [ ] No orphaned payment allocations (Test 9.4)
- [ ] No orphaned refund allocations (Test 9.5)
- [ ] Stock levels match history (Test 9.6)
- [ ] FY consistency maintained (Test 9.7)
- [ ] All vendors have correct current balance
- [ ] All purchases have correct totals
- [ ] All returns have correct totals

**Pass Criteria:**
✅ 100% data integrity across all checks  
✅ No inconsistencies found  
✅ System ready for production

---

## 🎉 TESTING COMPLETION CHECKLIST

### **When All 100 Tests Pass:**

- [ ] All 9 batches completed
- [ ] All checkboxes marked
- [ ] No critical failures
- [ ] Data integrity verified
- [ ] Documentation updated with any findings
- [ ] System ready for production use

### **Final Sign-Off:**

**Tested By:** _________________  
**Date:** _________________  
**Result:** ☐ PASS  ☐ FAIL (with notes)  
**Notes:** 
_____________________________________________
_____________________________________________
_____________________________________________

---

## 📞 SUPPORT & ESCALATION

If you encounter issues during testing:

1. **Document the failure** in the test's Notes section
2. **Take screenshots** of error messages
3. **Run view-test-data.js** to capture DB state
4. **Check console logs** for detailed error information
5. **Report issues** using the provided feedback channels

---

**END OF DOCUMENT**
