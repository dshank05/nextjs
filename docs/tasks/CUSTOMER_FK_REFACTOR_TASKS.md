# Customer FK Refactor: Update bill_tosales and bill_tosalesx to use customer_id FK

## Overview
Refactor the sales and salex creation flow to eliminate data duplication by storing only `customer_id` foreign key in `bill_tosales` and `bill_tosalesx` tables instead of duplicating customer billing information.

## Current State
- `bill_tosales` and `bill_tosalesx` tables store full customer details (user_name, address, etc.)
- Frontend collects customer selection and sends full billing details in payload
- API saves full customer info in these tables

## Target State
- `bill_tosales` and `bill_tosalesx` tables contain only: `id`, `invoice_no` (unique), `customer_id` (FK to customer_details.id)
- Frontend sends `customer_id` instead of full billing details in `billingDetails.customer_id`
- API saves only `customer_id` in bill_to_sales tables
- Customer details fetched via joins when listing invoices

## Tasks

### 1. Schema Updates
- [x] Update `bill_tosales` model in `schema.prisma`:
  - Remove fields: `user_name`, `address`, `address2`, `mobile`, `email`, `state`, `state_code`, `gstin`
  - Add field: `customer_id Int?` with relation to `customer_details`
  - Ensure `invoice_no` has `@unique` constraint
- [x] Update `bill_tosalesx` model with same changes
- [x] Generate and run Prisma migration

### 2. API Updates - Sales (invoices)
- [x] Update `pages/api/invoices/index.ts` POST handler:
  - Change `billingDetails` parameter to `customer_id`
  - Create `bill_tosales` record with only `invoice_no` and `customer_id`
- [x] Update `pages/api/invoices/index.ts` GET handler:
  - Modify customer data fetching to join with `customer_details` using `customer_id`
  - Update customer name and GSTIN fetching logic

### 3. API Updates - Salex
- [x] Update `pages/api/salex/index.ts` POST handler:
  - Change `billingDetails` parameter to `customer_id`
  - Create `bill_tosalesx` record with only `invoice_no` and `customer_id`
- [x] Update `pages/api/salex/index.ts` GET handler:
  - Modify customer data fetching to join with `customer_details` using `customer_id`

### 4. Frontend Updates
- [x] Update `pages/sale/create.tsx`:
  - Change payload from `billingDetails: {...}` to `customer_id: selectedCustomerId`
  - Remove billing details object construction
- [x] Update `pages/salex/create.tsx`:
  - Same changes as sale create

### 5. Additional API Files
- [ ] Check and update `pages/api/invoices/[id].ts` if it fetches billing details
- [ ] Check and update `pages/api/salex/[id].ts` if it fetches billing details

### 6. Testing & Verification
- [ ] Test sales invoice creation
- [ ] Test salex invoice creation
- [ ] Verify customer details display correctly in listing pages
- [ ] Test invoice edit functionality
- [ ] Check that customer information is properly fetched via joins

## Files to Modify
- `prisma/schema.prisma` - Schema changes
- `pages/api/invoices/index.ts` - Sales API updates
- `pages/api/salex/index.ts` - Salex API updates
- `pages/sale/create.tsx` - Sales create page
- `pages/salex/create.tsx` - Salex create page
- `pages/api/invoices/[id].ts` - Individual invoice API (if needed)
- `pages/api/salex/[id].ts` - Individual salex API (if needed)

## Notes
- Database has been emptied, so no migration data handling needed
- Keep existing relations intact where not related to this refactor
- Ensure all customer data display still works by proper joins
