# PURCHASE API DATA INTEGRITY ISSUES

## Issue Overview
Purchase API has critical data integrity problems where fields are not being saved to database despite being present in the payload.

## Test Case Details

### POST Payload
```json
{
    "invoice_number": "1",
    "bill_reference": "100",
    "staff_id": "1",
    "date": "2025-10-20",
    "vendor_id": 4,
    "transport_name": "TN",
    "vehicle_number": "14211",
    "transport_cost": 100,
    "items": [
        {
            "product_id": 23,
            "product_name": "Expansion Valve-Rear-Honda City T6 Petrol-Passio",
            "category_id": 7,
            "subcategory_id": 13,
            "company_id": 10,
            "model_id": 14,
            "car_model": "Honda City T6 Petrol",
            "part": "241231",
            "qty": 1,
            "rate": 1050,
            "tax": 105,
            "total": 1155
        }
    ],
    "descriptions": "desc",
    "packing_forwarding_qty": 1,
    "packing_forwarding_rate": 1000,
    "packing_forwarding_total": 1000,
    "total_cgst": 0,
    "total_sgst": 0,
    "total_igst": 105,
    "notes": "notes",
    "total_tax": 105,
    "payment_status": 1,
    "payment_mode": 2
}
```

### POST Success Response
```json
{
    "message": "Purchase created successfully",
    "purchase": {
        "id": 19,
        "invoice_no": 1,
        "total": 2255,
        "vendor_name": "Swastik"
    }
}
```

### GET Response (Issues)
```json
{
    "id": 19,
    "invoice_no": 1,
    "bill_reference": "100",
    "staff_details": null,        // ❌ NULL despite payload having staff_id
    "vendor_id": 4,
    "items_total": 1050,
    "freight": 100,
    "total_taxable_value": 1050,
    "taxrate": null,              // ❌ NULL
    "total_cgst": 0,
    "total_sgst": 0,
    "total_igst": 105,
    "total_tax": 105,
    "total": 2255,
    "notes": "notes",
    "descriptions": "desc",
    "packing_forwarding_qty": 1,
    "packing_forwarding_rate": 1000,
    "packing_forwarding_total": 1000,
    "basic_value": null,          // ❌ NULL
    "bill": null,                 // ❌ NULL
    "tax": null,                  // ❌ NULL
    "invoice_date": "2025-10-20",
    "updated_at": "2025-10-20",
    "payment_mode": 2,
    "transport": "TN",
    "transport_name": "TN",
    "vehicle_number": "14211",
    "fy": 2025,
    "payment_status": 1,
    "staff_id": 1,               // ✅ CORRECTLY SAVED
    "items": [
        {
            "id": 22,
            "invoice_no": 1,
            "product_id": null,      // ❌ CRITICAL: NULL despite payload having 23
            "name_of_product": "Expansion Valve-Rear-Honda City T6 Petrol-Passio",
            "category_id": 7,
            "subcategory_id": 13,
            "model_id": 14,
            "company_id": 10,
            "car_model": "Honda City T6 Petrol",
            "vendor_id": 4,
            "hsn": null,             // ❌ NULL
            "part": "241231",
            "qty": 1,
            "unit": null,            // ❌ NULL (deprecated field, can be removed)
            "rate": 1050,
            "subtotal": 1155,
            "fy": 2025,
            "invoice_date": 1760918400
        }
    ],
    "formattedDate": "2025-10-20"
}
```

## Root Causes

### 1. Critical: product_id Not Saved in PurchaseItems
**Location**: `pages/api/purchases/index.ts` - POST handler, purchaseitems creation
**Issue**: `product_id` field is completely missing from the purchaseitems.create() call
**Impact**: Purchase items lose their product relationship, breaking inventory tracking

### 2. Missing Field Mappings in Purchase Table
**Location**: `pages/api/purchases/index.ts` - POST handler, purchase creation
**Issues**:
- `staff_details` not saved (though staff_id is saved correctly) → **SOLUTION: Drop staff_details column, fetch from staff table**
- `taxrate` commented out → **SOLUTION: Calculate as total_tax/total_taxable_value (invoice level)**
- `bill` and `tax` fields commented out
- `basic_value` not provided in payload

### 3. GET API Returns Limited Data
**Location**: `pages/api/purchases/index.ts` - GET handler
**Issue**: GET API doesn't return full purchase details with items. The response shown above seems to come from a different endpoint or view.

### 4. Vendor & Staff Details Not Fetched in GET Response
**Location**: `pages/api/purchases/[id].ts` - GET handler
**Issue**: UI requires vendor and staff details but API returns vendor_id and staff_id only
**Solution**: Fetch vendor details from vendor_details table, staff details from staff table

### 5. Deprecated Schema Fields
**Location**: Database schema
**Issue**: `unit` in purchase_items table and `staff_details` in purchase table are deprecated
**Solution**: Drop these columns and update code accordingly

## ✅ Fixes Applied

### 1. Fixed PurchaseItems Creation (Critical) ✅
**Location**: `pages/api/purchases/index.ts` - POST and PUT handlers
**Fix Applied**: Added `product_id: parseInt(item.product_id)` to purchaseitems.create() calls

**Before**:
```typescript
await prisma.purchaseitems.create({
  data: {
    invoice_no: purchase.invoice_no,
    name_of_product: productName,
    // ❌ MISSING: product_id field
    // ... rest of fields
  }
})
```

**After**:
```typescript
await prisma.purchaseitems.create({
  data: {
    invoice_no: purchase.invoice_no,
    product_id: parseInt(item.product_id), // ✅ ADDED: Critical fix
    name_of_product: productName,
    // ... rest of fields
  }
})
```

### 2. Fixed GET API Response ✅
**Issue Identified**: User was calling `/api/purchases/[id].ts` endpoint for detailed view
**Solution**: The individual purchase view endpoint already returns full purchase data with items
**Verification**: Product ID now properly returned in items array

### 3. Enhanced GET Response with Vendor & Staff Details ✅
**Location**: `pages/api/purchases/[id].ts` - GET handler
**Fix Applied**: Added fetching of vendor and staff details from master tables

**Before**:
```typescript
// Remove vendor details from response - send vendor_id instead
// vendor_name: vendorData?.vendor_name || purchase.bill_reference || 'Unknown Vendor',
// contact_number: vendorData?.contact_no || null,
// email_id: vendorData?.email || null
// staff_details: purchase.staff_details, // Returns null
```

**After**:
```typescript
vendor_name: vendorData?.vendor_name || purchase.bill_reference || 'Unknown Vendor',
contact_number: vendorData?.contact_no || null,
email_id: vendorData?.email || null,
vendor_gstin: vendorData?.tax_id || null,
staff_details: staffData ? `${staffData.name} (${staffData.phone})` : 'N/A',
taxrate: purchase.total_taxable_value > 0 ? purchase.total_tax / purchase.total_taxable_value : 0
```

### 4. Schema Cleanup ✅
**Location**: Database schema and API handlers
**Fix Applied**: Removed deprecated fields and updated code

**Changes**:
- Dropped `unit` field from `purchase_items` table and API responses
- Dropped `staff_details` field from `purchase` table
- Updated POST/PUT handlers to exclude deprecated fields
- Updated GET responses to not include deprecated fields

### 5. Field Status Assessment
- ✅ `staff_details`: Now fetched from staff table using staff_id
- ✅ `taxrate`: Calculated as total_tax/total_taxable_value (invoice level)
- ❌ `bill`: Intentionally commented out (legacy field, unclear purpose)
- ❌ `tax`: Intentionally commented out (legacy field, unclear purpose)
- ❌ `basic_value`: Not provided in current payload, intentionally commented out
- ❌ `hsn`: Intentionally commented out in purchaseitems (can be populated from product if needed)
- ✅ `unit`: Removed from schema and API (deprecated field)

**Decision**: UI-required fields (vendor_name, staff_details, taxrate) now properly fetched/calculated.

## Testing
- Create purchase with the test payload
- Verify all fields are saved correctly
- Confirm GET response includes product_id and other missing fields
