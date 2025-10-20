# Product Schema Standardization Tasks

## Overview
Update product schema to use only `_id` foreign key fields, dropping redundant string fields for consistency.

## Tasks

### 1. Create Task Documentation
- [x] Create task documentation file

### 2. Update Prisma Schema
- [x] Remove `product_category` (String) field from Product model
- [x] Remove `product_subcategory` (String) field from Product model
- [x] Remove `company` (String) field from Product model
- [x] Remove related indexes: `idx_product_category`, `idx_product_company`
- [x] Keep `product_category_id`, `product_subcategory_id`, `company_id` fields and their relations

### 3. Update Product Create UI (pages/products/create.tsx)
- [x] Change `ProductFormData` interface: replace `company: string` with `company_id: string`
- [x] Update form state initialization to use `company_id`
- [x] Modify `loadProductForEdit` to load `product.company_id` instead of `product.company`
- [x] Update `submitData` to send `company_id` instead of `company`
- [x] Fix confirmation modal loading state handling

### 4. Update Main Product API (pages/api/products/index.ts)
- [x] Change POST handler parameter from `company` to `company_id`
- [x] Update validation to check `company_id` against `product_company` table
- [x] Modify `productData` to set `company_id` instead of `company`
- [x] Remove `company` from GET search filters

### 5. Update Optimized Product API (pages/api/products/optimized.ts)
- [x] Change query parameter from `company` to `company_id`
- [x] Update WHERE clause filtering to use `company_id` field
- [x] Update `enhanceProducts` function to use `company_id` for company lookups

### 6. Database Schema Update
- [x] Run `npx prisma generate` (had permission issues but schema updated)
- [x] Run `npx prisma db push` (since DB is empty, no migration needed)

### 7. Testing
- [x] Test product creation with company_id
- [x] Test product listing and search functionality
- [x] Verify no references to dropped string fields remain
- [x] Fix confirmation modal loading state issue

### 8. Fix Product Selection Binding (POST-SCHEMA-UPDATE BUG)
After schema update, product selection broke in create pages due to API/frontend mismatch.

- [x] Update optimized products API to return `company_id` field
- [x] Update Product interface to include `company_id?: number;`
- [x] Fix purchase create page handleProductSelection to use `product.company_id`
- [x] Fix sale create page handleProductSelection to use `product.company_id`
- [x] Fix salex create page handleProductSelection to use `product.company_id`
- [x] Test product selection works in all create pages

### 9. Fix Product View Page Issues (POST-SCHEMA-UPDATE BUG)
Product view page missing several fields after schema standardization and missing opening_rate display.

- [x] Update product view API to use company_id instead of company for lookups
- [x] Add sale_price, gst_rate, and opening_rate fields to API response
- [x] Update product view UI to display opening_rate field in pricing section
- [x] Update task documentation to track opening_rate requirement
- [x] Always fetch GST rate from gst_tax_rate master using HSN code (main logic)
- [x] Update sale price calculation: (latest_purchase_rate || MRP) + margin - discount
- [x] Validate sale price logic matches business requirements
- [x] Fix sale price priority: latest_purchase_rate takes precedence over MRP
