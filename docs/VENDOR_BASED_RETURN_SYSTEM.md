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

### New Fields in `purchase_return_items`
```sql
ALTER TABLE purchase_return_items
ADD COLUMN original_bill_reference VARCHAR(255),
ADD COLUMN original_purchase_id INT;
```

### Return Tracking
- Returns are now vendor-based instead of invoice-based
- Each return item tracks which original bill it came from
- Maintains audit trail for GST compliance

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

This implementation provides an efficient, user-friendly system for bulk returns while maintaining full tax compliance and audit capabilities.
