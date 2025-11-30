# Vendor-Based Purchase Return System

## Overview
A simplified return system following the same pattern as purchases: List page → Create page → View page. Allows returning items from multiple purchase invoices of the same vendor simultaneously. Returns happen infrequently (every 2-3 months) but involve multiple items from multiple bills when they occur.

## Current System Problems
- Returns are tied to specific purchase invoices
- Cannot return items from multiple invoices in one operation
- Complex for collective returns after 2-3 months
- Partial returns create fragmented records

## New System Benefits
- Return any items from any vendor's invoices in one operation
- Simplified 3-page workflow: List → Create → View
- Optimized for bulk returns with smart data loading
- Better inventory management across multiple purchases

---

## UI Workflow & Screens

### 1. Return List Page
**URL:** `/entry/purchasereturn-vendor`

**Purpose:** Shows all purchase returns with filtering and search

```
┌─────────────────────────────────────────────────────────────┐
│ 🛒 Purchase Returns                                        │
│                                                             │
│ ┌─────────────────┬─────────────────┬─────────────────┐     │
│ │ Return #       │ Vendor          │ Status │ Actions │     │
│ ├─────────────────┼─────────────────┼─────────────────┤     │
│ │ PR-001         │ ABC Auto Parts  │ Completed       │     │
│ │ ₹25,000        │ 15 Jan 2025     │ [View] [Edit]   │     │
│ ├─────────────────┼─────────────────┼─────────────────┤     │
│ │ PR-002         │ XYZ Motors      │ Completed       │     │
│ │ ₹45,000        │ 20 Feb 2025     │ [View] [Edit]   │     │
│ └─────────────────┴─────────────────┴─────────────────┘     │
│                                                             │
│ [+ Create Return]                                           │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Create Return Page (Main UI)
**URL:** `/entry/purchasereturn-vendor-create`

**Purpose:** Combined vendor selection + item selection from multiple bills

```
┌─────────────────────────────────────────────────────────────┐
│ 📦 Create Purchase Return                                  │
│                                                             │
│ Vendor: [ABC Auto Parts ▼]                           [+Add] │
│                                                             │
│ 🔍 Search Items/Bills: [brake pads___________________]     │
│ 📅 Date Range: [2025-09-01] to [2025-11-28]          [Load More] │
│ 👁️ [Focus View: Hide bills with no selections]             │
│                                                             │
│ Loaded: 3 months (15 bills, 234 items)                     │
│                                                             │
│ ┌─ 📄 Bill #INV-015 (2025-11-15) - ₹45,000 ──────────────┐ │
│ │ ▼ Expanded (contains "brake pads")                      │
│ │                                                         │
│ │ ┌─────────────────────────────────────────────────────────────┐ │
│ │ │Product│Part#│Qty Avail│Return│Unit│Tax│Tax│Return│Total│ │
│ │ │Name   │     │         │Qty   │Price│%  │Amt │Reason│     │ │
│ │ ├─────────────────────────────────────────────────────────────┤ │
│ │ │Brake  │BP-001│10     │[5]  │₹100│18%│₹90│[Defect▼]│₹590│ │
│ │ │Pads   │     │        │      │    │   │   │        │     │ │
│ │ └─────────────────────────────────────────────────────────────┘ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 📄 Bill #INV-012 (2025-10-20) - ₹35,000 ──────────────┐ │
│ │ ▶ Collapsed                                              │
│ │ Items: 8 | Available: 6 | No matching items            │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 📄 Bill #INV-008 (2025-09-10) - ₹55,000 ──────────────┐ │
│ │ ▼ Expanded (contains matching items)                   │
│ │ [Item table with brake pads...]                        │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🎯 Return Summary                                        │
│ │ Items Selected: 2                                        │
│ │ Total Return Value: ₹1,190                               │
│ │ Total Tax Credit: ₹90                                    │
│ │                                                         │
│ │ Tax Breakdown:                                           │
│ │ • CGST: ₹45 | SGST: ₹45 | IGST: ₹0                      │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Return Notes: [________________________________________]   │
│                                                             │
│ [Process Return] [Cancel]                                  │
└─────────────────────────────────────────────────────────────┘
```

**Smart Data Loading:**
- **Default:** Loads last 3 months of bills initially
- **Load More:** Adds previous 3 months cumulatively
- **No Data Loss:** Existing bills preserved when loading more
- **Progressive:** Start with recent, expand backward as needed

**Item-Centric Search:**
- **Local Search:** Searches within loaded bills (no API calls)
- **Smart Filtering:** Shows only bills containing matching items
- **Auto-Expand:** Bills with matches expand automatically
- **Bill Context:** Still shows bill info for each item

**Focus View:**
- **Toggle Option:** Hide bills with no item selections
- **Clean Interface:** Focus on bills being used for return
- **Dynamic:** Updates as user selects/deselects items

**Key UI Features:**
- **Combined Flow:** Vendor selection + item selection in one page
- **Accordion Layout:** Bills collapsed by default, smart expansion
- **Real-time Search:** Instant filtering without API calls
- **Progressive Loading:** Load more data without losing current work
- **Focus Mode:** Hide irrelevant bills for cleaner workflow

---

### 4. Return Processing & Confirmation

**Modal/Dialog for Return Confirmation:**
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ Confirm Return Processing                               │
│                                                             │
│ You are about to process a return for:                     │
│ • ABC Auto Parts                                            │
│ • 2 items from 1 bill                                       │
│ • Total value: ₹1,190                                       │
│ • Tax credit: ₹90                                           │
│                                                             │
│ This will:                                                  │
│ ✅ Increase inventory stock                                 │
│ ✅ Create vendor credit                                     │
│ ✅ Generate return record                                   │
│                                                             │
│ [Process Return] [Cancel]                                   │
└─────────────────────────────────────────────────────────────┘
```

---

### 5. Return Success & Summary

**After Processing:**
```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Return Processed Successfully                           │
│                                                             │
│ Return #RTN-001 created                                     │
│                                                             │
│ 📊 Summary:                                                 │
│ • Vendor: ABC Auto Parts                                    │
│ • Items Returned: 2                                         │
│ • Total Value: ₹1,190                                       │
│ • Tax Credit: ₹90                                           │
│                                                             │
│ 📄 Return Details:                                          │
│ • Return Date: 2025-11-25                                   │
│ • Status: Completed                                         │
│ • Reference: RTN-001                                        │
│                                                             │
│ [View Return Details] [Create Another Return] [Done]        │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow & Processing

### 1. Item Selection Logic
```javascript
// When user selects items from multiple bills
selectedItems = [
  {
    purchase_item_id: 123,  // From Bill INV-001
    return_qty: 5,
    unit_price: 100,
    tax_rate: 18,
    bill_reference: "INV-001"
  },
  {
    purchase_item_id: 456,  // From Bill INV-002
    return_qty: 3,
    unit_price: 200,
    tax_rate: 0,
    bill_reference: "INV-002"
  }
];
```

### 2. Tax Processing
```javascript
// For each selected item
for (const item of selectedItems) {
  const subtotal = item.return_qty * item.unit_price;
  const taxAmount = (subtotal * item.tax_rate) / 100;

  // Determine CGST/SGST vs IGST based on vendor state
  if (vendorState === businessState) {
    // Intra-state
    item.cgst = taxAmount / 2;
    item.sgst = taxAmount / 2;
    item.igst = 0;
  } else {
    // Inter-state
    item.cgst = 0;
    item.sgst = 0;
    item.igst = taxAmount;
  }

  item.total = subtotal + taxAmount;
}
```

### 3. Inventory Updates
```javascript
// Update product stock
for (const item of selectedItems) {
  await prisma.product.update({
    where: { id: item.product_id },
    data: {
      stock: { increment: item.return_qty }
    }
  });
}
```

### 4. Return Record Creation
```javascript
// Create main return record
const returnRecord = await prisma.purchase_returns.create({
  data: {
    vendor_id: selectedVendor.id,
    return_date: new Date(),
    total_amount: totalReturnAmount,
    total_tax: totalTaxAmount,
    status: 'Completed',
    notes: returnNotes,
    fy: currentFY
  }
});

// Create return items
for (const item of selectedItems) {
  await prisma.purchase_return_items.create({
    data: {
      purchase_return_id: returnRecord.id,
      purchase_item_id: item.purchase_item_id,
      return_qty: item.return_qty,
      unit_price: item.unit_price,
      tax_amount: item.cgst + item.sgst + item.igst,
      cgst: item.cgst,
      sgst: item.sgst,
      igst: item.igst,
      return_reason_id: selectedReason.id,
      notes: item.notes,
      // Track original bill for audit
      original_bill_reference: item.bill_reference
    }
  });
}
```

---

## API Endpoints

### 1. Get Vendor's Purchase Items
```
GET /api/purchase-returns/vendor-items?vendor_id=123
```
**Response:**
```json
{
  "success": true,
  "data": {
    "vendor": {
      "id": 123,
      "name": "ABC Auto Parts",
      "state": "Uttar Pradesh"
    },
    "bills": [
      {
        "bill_reference": "INV-001",
        "invoice_date": "2025-01-15",
        "total_amount": 50000,
        "has_tax": true,
        "items": [
          {
            "id": 456,
            "product_name": "Brake Pads",
            "available_qty": 10,
            "unit_price": 100,
            "tax_rate": 18,
            "part_number": "BP-001"
          }
        ]
      }
    ]
  }
}
```

### 2. Process Vendor Return
```
POST /api/purchase-returns/vendor-return
```
**Request:**
```json
{
  "vendor_id": 123,
  "return_date": "2025-11-25",
  "return_notes": "Bulk return after 2 months",
  "return_reason_id": 1,
  "items": [
    {
      "purchase_item_id": 456,
      "return_qty": 5,
      "unit_price": 100,
      "tax_rate": 18
    }
  ]
}
```

---

## Database Schema Changes

### Updated `purchase_returns` Table
```sql
-- Add vendor_id for vendor-based returns
ALTER TABLE purchase_returns
ADD COLUMN vendor_id INT NOT NULL,
ADD CONSTRAINT purchase_returns_vendor_fkey
FOREIGN KEY (vendor_id) REFERENCES vendor_details(id);

-- Remove purchase_id constraint (vendor-based, not purchase-based)
ALTER TABLE purchase_returns
DROP CONSTRAINT purchase_returns_purchase_fkey,
ALTER COLUMN purchase_id DROP NOT NULL;
```

### Updated `purchase_return_items` Table
```sql
-- Add timestamp for audit trail
ALTER TABLE purchase_return_items
ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### Return Tracking
- Returns are now **vendor-based** instead of invoice-based
- Each return is linked to a vendor, not a single purchase
- Return items track back to original purchase items from any bill
- Single "Completed" status (no approval workflow needed)
- Maintains full audit trail for GST compliance

---

## Migration Strategy

### Phase 1: Parallel Implementation
- Build new vendor-based system alongside existing
- Keep existing per-invoice returns working
- Test new system with sample data

### Phase 2: Gradual Migration
- Update navigation to use new system
- Keep old system as fallback
- Train users on new workflow

### Phase 3: Complete Replacement
- Remove old per-invoice return pages
- Update all references
- Clean up old code

---

## Benefits Summary

1. **Simplified Workflow:** One return for multiple bills
2. **Better for Bulk Returns:** Perfect for 2-3 month collective returns
3. **Tax Compliance:** Maintains proper GST tracking
4. **Inventory Accuracy:** Proper stock updates across bills
5. **Audit Trail:** Complete tracking of original purchases
6. **Flexible Selection:** Return any items from any vendor bills

---

## 🚨 **CRITICAL ISSUES FOUND - MUST FIX BEFORE USE**

### **1. Stock Calculation Bug (BREAKING)**
**Problem:** Return API has **wrong stock direction**
```typescript
// ❌ CURRENT (WRONG): Increases stock when returning to vendor
stock: { increment: item.return_qty }

// ✅ SHOULD BE: Decreases stock when returning to vendor
stock: { decrement: item.return_qty }
```

**Impact:**
- Purchase 10 items → Stock: 10 ✅
- Return 3 items → Stock: 13 ❌ (should be 7)
- **Stock levels completely wrong!**

### **2. Missing CRUD Operations**
**Problem:** Return API only supports CREATE, missing UPDATE/DELETE
- ❌ No way to modify return quantities
- ❌ No way to cancel returns
- ❌ No stock adjustments for updates/deletions

### **3. Incomplete Tax Calculations**
**Problem:** Return API missing CGST/SGST/IGST breakdown
```typescript
// Purchase API (Complete):
cgst: 90, sgst: 90, igst: 0, tax: 180

// Return API (Incomplete):
tax_amount: 180  // Missing cgst/sgst/igst breakdown
```

### **4. No Return Rate Tracking**
**Problem:** No equivalent to purchase rate tracking
```typescript
// Purchase API tracks:
latest_purchase_rate: 100
last_purchase_date: timestamp

// Return API tracks: NOTHING
```

---

## 🔧 **REQUIRED FIXES BEFORE SYSTEM CAN BE USED**

### **Phase 1: Fix Critical Stock Logic**
1. **Change stock direction** in `pages/api/purchase-returns/vendor-return.ts`:
   ```typescript
   // Line ~85: Change increment to decrement
   stock: { decrement: item.return_qty }
   ```

2. **Test stock levels** with sample returns

### **Phase 2: Add Missing CRUD Operations**
1. **Add PUT handler** in `pages/api/purchase-returns/[id].ts`:
   ```typescript
   case 'PUT':
     // Handle return quantity changes with stock adjustments
     break;
   ```

2. **Add DELETE handler** in `pages/api/purchase-returns/[id].ts`:
   ```typescript
   case 'DELETE':
     // Restore stock when canceling returns
     stock: { increment: return_qty }  // Restore items
     break;
   ```

### **Phase 3: Complete Tax Calculations**
1. **Add CGST/SGST/IGST breakdown** to return processing:
   ```typescript
   const BUSINESS_STATE_CODE = 9; // Uttar Pradesh
   if (vendor.state_code === BUSINESS_STATE_CODE) {
     cgst = taxAmount / 2;
     sgst = taxAmount / 2;
   } else {
     igst = taxAmount;
   }
   ```

2. **Store tax breakdown** in return items table

### **Phase 4: Add Return Rate Tracking**
1. **Add return rate fields** to product table (optional):
   ```sql
   ALTER TABLE product ADD COLUMN latest_return_rate DECIMAL(10,2);
   ALTER TABLE product ADD COLUMN last_return_date TIMESTAMP;
   ```

### **Phase 5: UI Integration**
1. **Show return status** in purchase views
2. **Add return history** to purchase pages
3. **Enable return creation** from purchase context

---

## 📊 **STOCK CALCULATION COMPARISON**

### **Purchase API (Correct):**
```typescript
// CREATE: Buy items
stock: { increment: qty }  // +10 items

// UPDATE: Change quantity
stock: { increment: difference }  // +/- difference

// DELETE: Remove purchase
stock: { decrement: qty }  // -10 items
```

### **Return API (Currently Wrong):**
```typescript
// CREATE: Return items (WRONG)
stock: { increment: qty }  // ❌ +3 items (should be -3)

// UPDATE: Change return qty (MISSING)
// DELETE: Cancel return (MISSING)
```

### **Return API (After Fixes):**
```typescript
// CREATE: Return items
stock: { decrement: qty }  // ✅ -3 items

// UPDATE: Change return qty
stock: { increment: -difference }  // Adjust based on change

// DELETE: Cancel return
stock: { increment: qty }  // ✅ +3 items (restore)
```

---

## 🎯 **IMPLEMENTATION PRIORITIES**

### **🔴 IMMEDIATE (Critical - System Broken):**
1. Fix stock direction in return CREATE
2. Test with sample data

### **🟡 HIGH (Missing Features):**
1. Add PUT handler for return updates
2. Add DELETE handler for return cancellations
3. Add stock adjustments to both handlers

### **🟢 MEDIUM (Completeness):**
1. Add CGST/SGST/IGST tax breakdown
2. Add return rate tracking
3. Complete tax calculations

### **🔵 LOW (Integration):**
1. UI integration with purchase pages
2. Return status indicators
3. Return history sections

---

## Implementation Details

### ✅ **Decided Approaches:**

1. **Bill Loading:** Progressive loading with 3-month defaults
   - Initial: Load last 3 months of bills
   - Load More: Add previous 3 months cumulatively
   - No data loss when expanding date range

2. **Search Strategy:** Local item-centric search
   - Search within loaded bills (no API calls)
   - Filter to show only bills containing matching items
   - Auto-expand bills with matches
   - Preserve all loaded data during search

3. **Performance Optimization:** Smart data management
   - Start with reasonable dataset (3 months)
   - Expand as needed without losing work
   - Local search prevents API overhead
   - Focus view reduces visual clutter

4. **Return Numbering:** PR-XXX format (PR-001, PR-002, etc.)

5. **Status Tracking:** Completed (single status for simplicity)

6. **Report Integration:** Compatible with existing return reports

### **Key Technical Features:**

- **Combined UI:** Vendor selection + item selection in one page
- **Smart Defaults:** 3-month date range, local search, focus view
- **Progressive Loading:** Load more data without losing current selections
- **Item-Centric UX:** Search items first, discover bills containing them
- **Tax Compliance:** Proper CGST/SGST/IGST calculations
- **Audit Trail:** Track original bills for each returned item

---

## ✅ **SYSTEM STATUS: CORE FUNCTIONALITY IMPLEMENTED**

**The vendor-based return system has been successfully implemented with all critical fixes:**

1. ✅ **Stock calculations fixed** (decreases stock when returning to vendor)
2. ✅ **CRUD operations complete** (CREATE, READ, UPDATE, DELETE with proper stock adjustments)
3. ✅ **Tax calculations complete** (CGST/SGST/IGST breakdown implemented)
4. ✅ **Database schema updated** (added tax breakdown fields)
5. 🔄 **Purchase integration in progress** (adding return status to purchase editing)

---

## 🎯 **CURRENT IMPLEMENTATION STATUS**

### **✅ COMPLETED:**
- **Stock Logic Fixed:** Returns now properly decrease inventory stock
- **Full CRUD:** Create, read, update, delete returns with stock adjustments
- **Tax Compliance:** Complete CGST/SGST/IGST calculations and storage
- **Database Migration:** Added cgst/sgst/igst fields to purchase_return_items
- **API Endpoints:** All return APIs working with proper business logic

### **🔄 IN PROGRESS:**
- **Purchase Integration:** Adding return status indicators to purchase pages
- **Edit Restrictions:** Disabling purchase/item editing based on return status
- **UI Indicators:** Showing return status badges and available quantities

### **📋 UPCOMING:**
- **Return Status Filtering:** Add return status column to purchase table
- **Return History:** Show return history in purchase views
- **Workflow Integration:** Seamless return creation from purchase context

---

## 🛡️ **PURCHASE EDITING RULES WITH RETURNS**

### **Return Status Logic:**

1. **Whole Bill Returned:** Purchase edit disabled if ALL items are completely returned
2. **Individual Item Returned:** Specific items disabled if completely returned
3. **Partial Returns:** Items remain editable with reduced available quantities

### **Purchase Edit Permissions:**

```typescript
// Purchase-level edit disabled if:
purchase.return_status === 'FULLY_RETURNED'

// Individual item edit disabled if:
item.is_fully_returned === true

// Available quantity for editing:
item.available_qty = item.original_qty - item.returned_qty
```

### **UI Behavior:**

**Purchase View Page:**
- Show return status badge ("No Returns", "Partial Return", "Fully Returned")
- Disable "Edit Purchase" button if any item is fully returned
- Show per-item return status in the items table

**Purchase Edit Page:**
- Disable editing of completely returned items
- Show original/returned/available quantities
- Allow editing only remaining quantities
- Prevent changes to returned items

**Purchase Table:**
- Add "Return Status" column
- Show return status badges
- Disable return actions for fully returned purchases

---

## 🔧 **IMPLEMENTATION DETAILS**

### **Return Status Calculation:**

```typescript
interface PurchaseItemReturnStatus {
  original_qty: number;        // Original purchased quantity
  returned_qty: number;        // Total quantity returned
  available_qty: number;       // Remaining quantity for editing
  is_fully_returned: boolean;  // True if returned_qty >= original_qty
}

interface PurchaseReturnStatus {
  has_returns: boolean;           // Any items have been returned
  fully_returned_items: number;   // Count of completely returned items
  total_items: number;            // Total items in purchase
  is_fully_returned: boolean;     // All items completely returned
  status: 'NO_RETURNS' | 'PARTIAL_RETURN' | 'FULLY_RETURNED';
}
```

### **API Response Enhancement:**

**Purchase Detail API** (`/api/purchases/[id]`):
```json
{
  "purchase": { ... },
  "return_status": {
    "has_returns": true,
    "fully_returned_items": 1,
    "total_items": 3,
    "is_fully_returned": false,
    "status": "PARTIAL_RETURN"
  },
  "items": [
    {
      "id": 123,
      "product_name": "Brake Pads",
      "original_qty": 10,
      "returned_qty": 0,
      "available_qty": 10,
      "is_fully_returned": false,
      "return_history": []
    },
    {
      "id": 456,
      "product_name": "Oil Filter",
      "original_qty": 5,
      "returned_qty": 5,
      "available_qty": 0,
      "is_fully_returned": true,
      "return_history": [
        { "return_id": "PR-001", "qty": 5, "date": "2025-11-25" }
      ]
    }
  ]
}
```

### **UI Components Needed:**

1. **ReturnStatusBadge:** Shows return status with color coding
2. **ItemReturnIndicator:** Shows return details for each item
3. **PurchaseEditGuard:** Disables editing based on return status
4. **QuantityBreakdown:** Shows original/returned/available quantities

---

## 📊 **STOCK CALCULATION VERIFICATION**

### **Return API (Now Correct):**
```typescript
// CREATE: Return items to vendor
stock: { decrement: return_qty }  // ✅ Correctly decreases stock

// UPDATE: Change return quantity
// 1. Restore original return qty
stock: { increment: old_return_qty }
// 2. Apply new return qty
stock: { decrement: new_return_qty }

// DELETE: Cancel return
stock: { increment: return_qty }  // ✅ Restores stock
```

### **Purchase Edit with Returns:**
```typescript
// When editing purchase with returned items:
// 1. Cannot change quantities of fully returned items
// 2. Can only edit remaining quantities of partially returned items
// 3. Stock adjustments account for existing returns
// 4. Maintains data integrity across return and purchase systems
```

---

## 🎯 **NEXT STEPS**

### **Immediate Tasks:**
1. **Update Purchase API** to include return status data
2. **Add Return Status Badges** to purchase view and table
3. **Implement Edit Guards** for returned items/purchases
4. **Show Quantity Breakdowns** in edit interfaces

### **Integration Features:**
1. **Return Creation Links** from purchase pages
2. **Return History Display** in purchase views
3. **Status Filtering** in purchase table
4. **Workflow Optimization** for return-heavy scenarios

---

## ✅ **SYSTEM READY FOR TESTING**

**The vendor-based return system is now fully functional:**
- ✅ Correct stock calculations
- ✅ Complete CRUD operations
- ✅ Tax compliance
- ✅ Data integrity
- 🔄 Purchase integration in progress

**Ready for production use once purchase integration is complete.**
