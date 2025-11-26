# Vendor-Based Purchase Return System

## Overview
A new return system that allows returning items from multiple purchase invoices of the same vendor simultaneously, independent of specific bills. This replaces the current per-invoice return system with a more flexible vendor-centric approach.

## Current System Problems
- Returns are tied to specific purchase invoices
- Cannot return items from multiple invoices in one operation
- Complex for collective returns after 2-3 months
- Partial returns create fragmented records

## New System Benefits
- Return any items from any vendor's invoices in one operation
- Bill-independent returns for collective processing
- Simplified workflow for bulk returns
- Better inventory management across multiple purchases

---

## UI Workflow & Screens

### 1. Entry Point - Purchase Return Listing
**URL:** `/entry/purchasereturn`

**Current UI Changes:**
- Replace "Process Return" button with "Create Vendor Return"
- Remove "Return Whole Order" button (handled by new system)
- Add "Vendor Returns" tab/section

```
┌─────────────────────────────────────────────────────────────┐
│ 🛒 Purchase Returns                                        │
│                                                             │
│ ┌─────────────────┬─────────────────┬─────────────────┐     │
│ │ Invoice #      │ Vendor          │ Actions          │     │
│ ├─────────────────┼─────────────────┼─────────────────┤     │
│ │ INV-001        │ ABC Auto Parts  │ [Create Vendor   │     │
│ │ ₹50,000        │                 │  Return]         │     │
│ ├─────────────────┼─────────────────┼─────────────────┤     │
│ │ INV-002        │ XYZ Motors      │ [Create Vendor   │     │
│ │ ₹75,000        │                 │  Return]         │     │
│ └─────────────────┴─────────────────┴─────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Vendor Selection Screen
**URL:** `/entry/purchasereturn-vendor`

**Purpose:** Select vendor to return items from

```
┌─────────────────────────────────────────────────────────────┐
│ 🏪 Select Vendor for Return                                │
│                                                             │
│ Vendor: [ABC Auto Parts ▼]                           [+Add] │
│                                                             │
│ 📊 Vendor Summary:                                          │
│ • Total Purchase Invoices: 15                               │
│ • Total Items Purchased: 234                                │
│ • Total Purchase Value: ₹12,45,000                          │
│ • Pending Returns: ₹0                                       │
│                                                             │
│ [Continue to Item Selection]                                │
└─────────────────────────────────────────────────────────────┘
```

---

### 3. Bill-Wise Item Selection (Main UI)
**URL:** `/entry/purchasereturn-vendor-create`

**Purpose:** Select items from multiple bills with accordion layout

```
┌─────────────────────────────────────────────────────────────┐
│ 📦 Return Items from ABC Auto Parts                        │
│                                                             │
│ 🔍 Search: [___________________________]                   │
│ 📅 Date Range: [2025-01-01] to [2025-12-31]                 │
│                                                             │
│ ┌─ 📄 Bill #INV-001 (2025-01-15) - ₹50,000 ──────────────┐ │
│ │ ▶ Expand/Collapse                                        │
│ │ Items: 12 | Available for Return: 8                     │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 📄 Bill #INV-002 (2025-02-10) - ₹75,000 ──────────────┐ │
│ │ ▼ Expanded                                              │
│ │                                                         │
│ │ ┌─────────────────────────────────────────────────────────────┐ │
│ │ │Product│Bill Ref│Qty Avail│Return│Unit│Tax│Tax│Return│Total│ │
│ │ │Name   │        │         │Qty   │Price│%  │Amt │Reason│     │ │
│ │ ├─────────────────────────────────────────────────────────────┤ │
│ │ │Brake  │INV-002 │10      │[5]  │₹100│18%│₹90│[Defect▼]│₹590│ │
│ │ │Pads   │        │        │      │    │   │   │        │     │ │
│ │ ├─────────────────────────────────────────────────────────────┤ │
│ │ │Oil    │INV-002 │8       │[3]  │₹200│0% │₹0 │[Wrong ▼]│₹600│ │
│ │ │Filter │        │        │      │    │   │   │Item    │     │ │
│ │ └─────────────────────────────────────────────────────────────┘ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 📄 Bill #INV-003 (2025-03-05) - ₹30,000 ──────────────┐ │
│ │ ▶ Expand/Collapse                                        │
│ │ Items: 6 | Available for Return: 6                      │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🎯 Return Summary                                        │
│ │ Items Selected: 2                                        │
│ │ Total Return Value: ₹1,190                               │
│ │ Total Tax Credit: ₹90                                    │
│ │                                                         │
│ │ Tax Breakdown:                                           │
│ │ • 18% GST: ₹90 (₹45 CGST + ₹45 SGST)                    │
│ │ • 0% GST: ₹0                                             │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Return Notes: [________________________________________]   │
│                                                             │
│ [Process Return] [Cancel]                                  │
└─────────────────────────────────────────────────────────────┘
```

**Key UI Features:**
- **Accordion Layout:** Bills collapsed by default, expandable
- **Bill Headers:** Show bill number, date, total, item counts
- **Item Table:** Product details with return quantity inputs
- **Tax Column:** Shows tax percentage and calculated amount
- **Real-time Totals:** Update as user selects items
- **Search/Filter:** Find specific products or bills
- **Validation:** Prevent returning more than available

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

## Questions for Implementation

1. **Bill Loading:** Load all bills at once or paginate?
2. **Search Performance:** How to handle vendors with 100+ bills?
3. **Return Numbering:** Format for return references (RTN-001, etc.)?
4. **Status Tracking:** Return statuses needed (Draft, Processing, Completed)?
5. **Report Integration:** How to integrate with existing return reports?

This design provides a much more efficient system for your collective return process while maintaining full tax compliance and audit capabilities.
