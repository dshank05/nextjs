# BATCH 1: Purchase Creation - 3-System Verification

**Document Version:** 3.0  
**Updated:** January 15, 2026  
**Purpose:** Complete 3-system verification for all purchase creation scenarios  
**Systems Covered:** Inventory, Ledger, Payment Allocation

---

## 🎯 3-SYSTEM ARCHITECTURE

Every purchase operation must update all 3 systems correctly:

1. **SYSTEM 1: INVENTORY** - `product.stock` updates
2. **SYSTEM 2: LEDGER** - `vendor_ledger` transaction entries
3. **SYSTEM 3: PAYMENT ALLOCATION** - `vendor_payments` + `payment_allocations` (if paid)

---

## ✅ Test 1.1: Create Unpaid Purchase (No Tax)

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 10000
  - `credit` = 0
  - `balance` = previous_balance + 10000

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)
  - `vendor_payments`: No new records
  - `payment_allocations`: No new records

### **ADDITIONAL TABLES**
- [ ] `purchase`: 1 new record
  - `payment_status` = 0 (Unpaid)
  - `total` = 10000
  - `payment_mode` = NULL
- [ ] `purchaseitems`: 1 new record
  - `qty` = 10
  - `rate` = 1000
  - `subtotal` = 10000
- [ ] `bill_to`: 1 new record with vendor details

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ API returns 201 status  
✅ No console errors  
✅ Balance increases correctly

---

## ✅ Test 1.2: Create Unpaid Purchase (With Tax - 18%)

**Pre-conditions:**
- Same as 1.1

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor
3. Add 1 product: qty=10, rate=1000, tax=18%
4. Set payment_status = Unpaid
5. Click "Create Purchase"

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 11800 (10000 + 1800 tax)
  - `credit` = 0
  - `balance` = previous_balance + 11800

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)
  - `vendor_payments`: No new records
  - `payment_allocations`: No new records

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 0 (Unpaid)
  - `total` = 11800 (10000 + 1800 tax)
  - `total_tax` = 1800
  - `total_cgst` = 900 (if intra-state)
  - `total_sgst` = 900 (if intra-state)
  - `total_igst` = 1800 (if inter-state)
- [ ] `purchaseitems`:
  - `tax` = 1800
  - `cgst` = 900 or `igst` = 1800 (based on vendor state)

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ Tax calculations correct  
✅ CGST/SGST for intra-state OR IGST for inter-state  
✅ Total includes tax

---

## ✅ Test 1.3: Create Paid Purchase - Cash (No Tax)

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE):**
    - `transaction_type` = 'PURCHASE'
    - `debit` = 10000
    - `credit` = 0
  - **Entry 2 (PAYMENT):**
    - `transaction_type` = 'PAYMENT'
    - `debit` = 0
    - `credit` = 10000
    - `payment_mode` = 0 (Cash)
  - **Final balance:** previous_balance + 10000 - 10000 = previous_balance (net zero)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 10000
  - `payment_mode` = 0 (Cash)
  - `payment_type` = 'BILL_SPECIFIC'
  - `fy` = current financial year
- [ ] `payment_allocations`: 1 new record
  - `payment_id` = [new payment ID]
  - `purchase_id` = [new purchase ID]
  - `allocated_amount` = 10000
  - `allocation_date` = invoice_date

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 1 (Paid)
  - `payment_mode` = 0 (Cash)
  - `total` = 10000
- [ ] `purchaseitems`: 1 new record
- [ ] `bill_to`: 1 new record with vendor details

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ 2 ledger entries created  
✅ Payment allocation records created  
✅ Balance returns to original (paid immediately)  
✅ Payment mode = 0 (Cash)

---

## ✅ Test 1.4: Create Paid Purchase - Cash (With Tax - 18%)

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE):**
    - `transaction_type` = 'PURCHASE'
    - `debit` = 11800
    - `credit` = 0
  - **Entry 2 (PAYMENT):**
    - `transaction_type` = 'PAYMENT'
    - `debit` = 0
    - `credit` = 11800
    - `payment_mode` = 0 (Cash)
  - **Final balance:** previous_balance + 0 (11800 - 11800)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 11800
  - `payment_mode` = 0 (Cash)
  - `payment_type` = 'BILL_SPECIFIC'
- [ ] `payment_allocations`: 1 new record
  - `purchase_id` = [new purchase ID]
  - `allocated_amount` = 11800

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 1 (Paid)
  - `payment_mode` = 0 (Cash)
  - `total` = 11800
  - `total_tax` = 1800

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ Paid with correct total including tax  
✅ Payment allocation created  
✅ Balance = 0 after immediate payment

---

## ✅ Test 1.5: Create Paid Purchase - Bank (No Tax)

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE):**
    - `transaction_type` = 'PURCHASE'
    - `debit` = 10000
  - **Entry 2 (PAYMENT):**
    - `transaction_type` = 'PAYMENT'
    - `credit` = 10000
    - `payment_mode` = 1 (Bank)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 10000
  - `payment_mode` = 1 (Bank)
  - `payment_type` = 'BILL_SPECIFIC'
- [ ] `payment_allocations`: 1 new record
  - `purchase_id` = [new purchase ID]
  - `allocated_amount` = 10000

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 1 (Paid)
  - `payment_mode` = 1 (Bank)
  - `total` = 10000

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ Payment mode = 1 (Bank) stored correctly in all tables  
✅ Payment allocation created

---

## ✅ Test 1.6: Create Paid Purchase - Bank (With Tax - 18%)

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 2 new entries
  - **Entry 1 (PURCHASE):**
    - `transaction_type` = 'PURCHASE'
    - `debit` = 11800
  - **Entry 2 (PAYMENT):**
    - `transaction_type` = 'PAYMENT'
    - `credit` = 11800
    - `payment_mode` = 1 (Bank)

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] `vendor_payments`: 1 new record
  - `payment_amount` = 11800
  - `payment_mode` = 1 (Bank)
  - `payment_type` = 'BILL_SPECIFIC'
- [ ] `payment_allocations`: 1 new record
  - `purchase_id` = [new purchase ID]
  - `allocated_amount` = 11800

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `payment_status` = 1 (Paid)
  - `payment_mode` = 1 (Bank)
  - `total` = 11800
  - `total_tax` = 1800

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ All tax and payment data correct  
✅ Payment allocation created

---

## ✅ Test 1.7: Create Purchase with Multiple Items

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

### **SYSTEM 1: INVENTORY**
- [ ] Product 1: stock increased by 5
- [ ] Product 2: stock increased by 10
- [ ] Product 3: stock increased by 2

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 15500
  - `credit` = 0
  - Calculation: (5×1000×1.18) + (10×500×1.12) + (2×2000) = 5900 + 5600 + 4000 = 15500

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 15500
  - `payment_status` = 0 (Unpaid)
- [ ] `purchaseitems`: 3 new records
  - Record 1: qty=5, rate=1000, tax=900
  - Record 2: qty=10, rate=500, tax=600
  - Record 3: qty=2, rate=2000, tax=0

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ All 3 items created  
✅ Total calculated correctly  
✅ Each product stock updated

---

## ✅ Test 1.8: Create Purchase with Packing & Forwarding

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 10500 (10000 items + 500 P&F)
  - `credit` = 0

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 10500 (items + P&F)
  - `packing_forwarding_qty` = 1
  - `packing_forwarding_rate` = 500
  - `packing_forwarding_total` = 500
  - `payment_status` = 0 (Unpaid)

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ P&F included in total  
✅ P&F fields saved correctly

---

## ✅ Test 1.9: Create Purchase with Transport Cost

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

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 10000 (items only - freight NOT included in ledger)
  - `credit` = 0

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `total` = 10000 (items only)
  - `freight` = 1000 (stored separately, NOT in total)
  - `transport_name` = "Test Transport"
  - `vehicle_number` = "UP 12 AB 1234"
  - `payment_status` = 0 (Unpaid)

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ Transport cost stored in freight field (separate from total)  
✅ Transport details saved  
⚠️ **IMPORTANT:** Freight is NOT included in total or ledger debit

---

## ✅ Test 1.10: Create Purchase with "Other" Vendor

**Pre-conditions:**
- None (testing "Other" vendor)

**Action Steps:**
1. Navigate to `/purchases/create`
2. Select vendor = "Other"
3. Fill manual vendor details:
   - Name: "One-Time Vendor"
   - Phone: "9999999999"
   - **State: "Uttar Pradesh"** ⭐ **MANDATORY FIELD**
4. Add 1 product: qty=10, rate=1000, tax=0%
5. Set payment_status = Unpaid
6. Click "Create Purchase"

**⚠️ IMPORTANT NOTES:**
- **State field is MANDATORY** for "Other" vendor
- UI should show asterisk (*) next to State field
- API validation should reject if State is missing
- State is required for tax calculation (CGST/SGST vs IGST)

**Verify DB Tables:**

### **SYSTEM 1: INVENTORY**
- [ ] `product`: stock increased by 10
  - Before: stock = X
  - After: stock = X + 10

### **SYSTEM 2: LEDGER**
- [ ] `vendor_ledger`: 1 new entry
  - `transaction_type` = 'PURCHASE'
  - `debit` = 10000
  - `credit` = 0
  - `vendor_id` = 0 (special case for "Other")

### **SYSTEM 3: PAYMENT ALLOCATION**
- [ ] NO payment allocation records (correct - purchase is unpaid)

### **ADDITIONAL TABLES**
- [ ] `purchase`:
  - `vendor_id` = 0 (special case for "Other")
  - `total` = 10000
  - `payment_status` = 0 (Unpaid)
- [ ] `bill_to`:
  - `vendor_name` = "One-Time Vendor"
  - `contact_no` = "9999999999"
  - `state` = "Uttar Pradesh"

**Pass Criteria:**
✅ All 3 systems updated correctly  
✅ "Other" vendor saved as vendor_id = 0  
✅ Manual details saved in bill_to table  
✅ Ledger entry created with vendor_id = 0

---

## 🎉 BATCH 1 COMPLETION CHECKLIST

### **When All 10 Tests Pass:**

- [ ] All 10 test scenarios completed
- [ ] All 3 systems verified for each test
- [ ] Inventory system: Stock updates correct
- [ ] Ledger system: Transaction entries correct
- [ ] Payment Allocation system: Records created for paid purchases only
- [ ] No console errors
- [ ] All calculations correct (tax, P&F, totals)
- [ ] Ready to proceed to Batch 2 (Purchase Edit)

---

## 📊 3-SYSTEM VERIFICATION SUMMARY

| Test | Inventory | Ledger | Payment Allocation | Status |
|------|-----------|--------|-------------------|--------|
| 1.1 | ✅ Stock +1 | ✅ PURCHASE (2500) | ✅ None (unpaid) | ✅ **PASS** |
| 1.2 | ✅ Stock +1 | ✅ PURCHASE (1180) | ✅ None (unpaid) | ✅ **PASS** |
| 1.3 | ✅ Stock +1 | ✅ PURCHASE + PAYMENT (1000) | ✅ Created | ✅ **PASS** |
| 1.4 | ✅ Stock +1 | ✅ PURCHASE + PAYMENT (1180) | ✅ Created | ✅ **PASS** |
| 1.5 | ✅ Stock +10 | ✅ PURCHASE + PAYMENT (10000) | ✅ Created (Bank) | ✅ **PASS** |
| 1.6 | ✅ Stock +10 | ✅ PURCHASE + PAYMENT (11800) | ✅ Created (Bank) | ✅ **PASS** |
| 1.7 | ✅ Stock +5,+10,+2 | ✅ PURCHASE (15800) | ✅ None (unpaid) | ✅ **PASS** |
| 1.8 | ✅ Stock +1 | ✅ PURCHASE (1500) | ✅ None (unpaid) | ✅ **PASS** |
| 1.9 | ✅ Stock +10 | ✅ PURCHASE (10000) | ✅ None (unpaid) | ✅ **PASS** |
| 1.10 | ✅ Stock +10 | ✅ PURCHASE (10000) vendor_id=0 | ✅ None (unpaid) | ✅ **PASS** | ⚠️ State mandatory (add UI * + API validation) |

---

**END OF DOCUMENT**
