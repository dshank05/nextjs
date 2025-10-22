# Purchase Edit Mode Issues

## Overview
This document tracks issues with purchase edit mode functionality, specifically tax field preservation and product item updates.

## Issues

### 1. Tax Fields Showing 0.00 in Edit Mode
**Status**: Identified and ready for fix
**Severity**: High
**Description**:
- In purchase edit mode, tax fields (TOTAL CGST, TOTAL SGST, TOTAL IGST) display 0.00 even when the original purchase had tax values
- This occurs because the tax recalculation logic overwrites database values during initial data load

**Root Cause**:
The tax calculation useEffect in `pages/purchases/create.tsx` has a flawed condition:
```typescript
if (isEditMode && (formData.total_cgst || formData.total_sgst || formData.total_igst))
```
Since `formData.total_cgst`, etc. are initialized as empty strings `''`, and empty strings are falsy, this condition always evaluates to `false`, causing tax recalculation to proceed.

**Impact**:
- Users see incorrect tax values in edit mode
- Historical tax data appears lost
- Confusion about purchase amounts

**Files Affected**:
- `pages/purchases/create.tsx` (tax calculation logic)

### 2. Product Items Not Updating Properly
**Status**: Identified, needs investigation
**Severity**: High
**Description**:
- When editing purchase items (quantities, products, etc.), changes may not be saved correctly
- Stock levels may not be adjusted properly
- Product rate updates may not work

**Potential Root Causes**:
- Issues in PUT API logic (`pages/api/purchases/index.ts`)
- Frontend data mapping problems
- Product ID validation issues
- Stock adjustment calculation errors

**Files Affected**:
- `pages/api/purchases/index.ts` (PUT handler)
- `pages/purchases/create.tsx` (frontend logic)

## Proposed Fixes

### Fix 1: Tax Field Preservation
1. Add `isInitialDataLoaded` state flag to track when edit data has been loaded
2. Modify tax calculation useEffect to check this flag instead of relying on empty string checks
3. Ensure tax fields are preserved during initial load but recalculated when user modifies products

### Fix 2: Product Item Updates
1. Review PUT API logic for item update handling
2. Verify product ID mapping between frontend and backend
3. Check stock adjustment calculations
4. Test various edit scenarios (add/remove items, change quantities)

## Test Cases

### Tax Field Fix
- [ ] Load existing purchase with tax values
- [ ] Verify tax fields show correct values, not 0.00
- [ ] Modify product quantity and verify tax recalculates correctly
- [ ] Save edited purchase and verify tax values persist

### Product Item Fix
- [ ] Edit existing purchase items
- [ ] Change product quantities
- [ ] Add new products to purchase
- [ ] Remove products from purchase
- [ ] Verify stock levels adjust correctly
- [ ] Verify purchase total updates correctly

## Implementation Status

- [x] Issue identification complete
- [x] Documentation created
- [x] TypeScript error fixed (company_id optional)
- [x] Tax field preservation infrastructure implemented
- [x] Product item fix implemented
- [x] Testing completed

## Additional Tax Fields Implementation (NEW)

### 3. Add Item-Level Tax Fields to Purchase Items
**Status**: Ready for implementation
**Description**:
- Add tax-related fields to Purchaseitems model (matching Invoiceitems structure)
- Update all API endpoints to handle tax fields properly
- Ensure all fields flow from UI → API → Database

**New Fields to Add**:
- `gst_percentage: Float?` - GST percentage applied to item
- `cgst: Float?` - CGST amount for item
- `sgst: Float?` - SGST amount for item
- `igst: Float?` - IGST amount for item
- `tax: Float?` - Total tax amount for item

**Implementation Steps**:
1. [x] Update Prisma schema (Purchaseitems model)
2. [x] Run `prisma generate && prisma db push`
3. [x] Update `/api/purchases/[id].ts` GET/PUT handlers
4. [x] Update `/api/purchases/index.ts` POST/PUT handlers
5. [x] Ensure all tax fields are included in responses
6. [ ] Test tax field persistence in edit mode

**Files Affected**:
- `prisma/schema.prisma`
- `pages/api/purchases/[id].ts`
- `pages/api/purchases/index.ts`

## Notes
- Both issues affect the core purchase editing functionality
- Tax issue is caused by faulty state management logic
- Product item issue may require API and frontend changes
