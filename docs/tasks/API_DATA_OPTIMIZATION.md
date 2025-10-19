# API Data Optimization Task

## Overview
The index pages for products, purchases, invoices, and invoice C (salex) are fetching more data than they display in the UI. This causes unnecessary database queries, data transfer, and processing overhead. This document identifies what data is shown vs. fetched for each page.

## Products Page (`pages/products/index.tsx`)

**API Endpoint:** `/api/products/optimized`

### Fields Displayed in UI
- `id` (as index number)
- `product_name`
- `stock`
- `min_stock`
- `rate` (display_rate)
- `part_no`
- `categoryName`
- `companyName`
- `subcategoryName` (singular - combined subcategory + car models)
- `carModelsDisplay` (separate car models column)
- `latestPurchaseRate`

**Correction Applied:** Fixed field names to match UI expectations (`subcategoryName` + `carModelsDisplay`)

### Additional Fields Fetched But Not Displayed
- All base product table fields (created_at, updated_at, opening_stock, opening_rate, hsn, descriptions, mrp, discount, margin, warehouse_id, gst_rate_id, rack_id, rack_number, notes, is_active, latest_purchase_rate, last_purchase_date, etc.)
- `gst_rate` relationship data
- Calculated fields: `calculated_selling_price`, `selling_price`, `gst_rate_percentage`, `last_purchase_date`

**Optimization:** Remove unused product fields and relationships from the API response. Keep `subcategoryName` (combined) and `carModelsDisplay` (separate) as expected by UI.

## Purchases Page (`pages/purchases/index.tsx`)

**API Endpoint:** `/api/purchases`

### Fields Displayed in UI (via TransactionTable)
- `id`
- `invoice_no`
- `vendor_name` (fetched separately via vendor ID)
- `vendor_address` (fetched separately)
- `vendor_gstin` (fetched separately)
- `items_total`
- `freight` (as transport_cost)
- `total_taxable_value`
- `taxrate`
- `total_cgst`
- `total_sgst`
- `total_igst`
- `total_tax`
- `total`
- `notes`
- `invoice_date` (formatted)
- `payment_status` (mapped to status)
- `payment_mode`
- `fy`
- `transport`
- `item_count`
- `bill_reference`

### Additional Fields Fetched But Not Displayed
- `vendor_id` (used for fetching vendor details separately)
- `formattedTotal` (formatted currency string)
- `type` (hardcoded as 'purchase')
- `formattedDate` (formatted date string - UI handles formatting)

**Optimization:** Remove formatted strings and type field from API response since UI handles formatting.

## Sales/Invoice Page (`pages/sale/index.tsx`)

**API Endpoint:** `/api/sales`

### Fields Displayed in UI (via TransactionTable)
- `id`
- `invoice_no`
- `customer_name`
- `customer_address` (not fetched by API)
- `customer_gstin`
- `items_total`
- `freight`
- `total_taxable_value`
- `taxrate`
- `total_cgst`
- `total_sgst`
- `total_igst`
- `total_tax`
- `total`
- `notes`
- `invoice_date`
- `payment_status` (mapped to status)
- `payment_mode`
- `fy`
- `mode`
- `type`
- `item_count`
- `bill_reference`

### Additional Fields Fetched But Not Displayed
- `select_customer` (customer ID)
- `formattedTotal` (formatted currency string)
- `formattedDate` (formatted date string - UI handles formatting)

**Optimization:** Remove formatted strings and select_customer ID from API response.

### Additional Fields Commented Out (After Removing Expanded Rows)
Since the expanded row functionality was removed entirely, the following fields were also commented out as they were only used in expanded details:

**Transaction APIs (Purchases, Sales, Salex):**
- `transport` (transport details)
- `items_total` (subtotal before freight/tax)
- `freight` (shipping/freight cost)
- `total_taxable_value` (calculated taxable value)
- `total_cgst` (CGST amount)
- `total_sgst` (SGST amount)
- `total_igst` (IGST amount)
- `total_tax` (total tax amount)
- `notes` (transaction notes)
- `items` (detailed items array - only `item_count` used in table)

**Component Changes:**
- Removed expanded row functionality from `TransactionTable.tsx`
- Removed `expandedRows` state and `toggleRowExpansion` function
- Removed all expanded details JSX rendering
- Significantly simplified the component

## Salex/Invoice C Page (`pages/salex/index.tsx`)

**API Endpoint:** `/api/salex`

### Fields Displayed in UI (via TransactionTable)
- `id`
- `invoice_no`
- `customer_name`
- `customer_address` (not fetched by API)
- `customer_gstin`
- `items_total`
- `freight`
- `total_taxable_value`
- `taxrate`
- `total_cgst`
- `total_sgst`
- `total_igst`
- `total_tax`
- `total`
- `notes`
- `bill_reference`
- `invoice_date`
- `payment_status` (mapped to status)
- `payment_mode`
- `fy`
- `mode`
- `type`
- `item_count`

### Additional Fields Fetched But Not Displayed
- `select_customer` (customer ID)
- `formattedTotal` (formatted currency string)
- `formattedDate` (formatted date string - UI handles formatting)

**Optimization:** Remove formatted strings and select_customer ID from API response.

## Recommendations

1. **Products API**: Optimize `/api/products/optimized` to only return UI-required fields plus the enhanced names (categoryName, companyName, subcategoryName, carModelsDisplay, latestPurchaseRate)

2. **Purchases API**: Remove `formattedTotal`, `formattedDate`, and `type` fields from `/api/purchases` response

3. **Sales API**: Remove `formattedTotal`, `formattedDate`, and `select_customer` from `/api/sales` response

4. **Salex API**: Remove `formattedTotal`, `formattedDate`, and `select_customer` from `/api/salex` response

5. **General**: Ensure customer_address is fetched where needed, or remove from UI interface if not displayed

### Benefits
- Reduced database query complexity
- Faster API response times
- Lower bandwidth usage
- Improved frontend performance
- Cleaner API contracts
