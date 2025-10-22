# Bug Fix: Company Name Undefined in Sale Create Page

## Issue Description
When selecting a car model in the product selection dropdown on the sale create page, the company name field would display "undefined" in the UI.

## Root Cause Analysis

### 1. **generateDynamicProductName Function Issues**
- The original `generateDynamicProductName` function was using inconsistent company ID lookups
- When a model was selected, the function would try to access `products[model]?.company` for the company name, but this was unreliable due to cache/data structure issues
- Multiple company lookup patterns were being used across the codebase:
  - `products[model]?.company`
  - `companies[product.company_id]?.name`
  - Direct company ID comparison

### 2. **Race Conditions**
- Product data was loaded asynchronously, causing timing issues where company information wasn't available when the function executed
- Cache updates weren't being propagated consistently to all components

### 3. **API Response Structure Inconsistencies**
- The sales view API was returning a different payload structure than expected by the frontend
- Missing derived properties for customer, transport, and staff information
- Invoice item properties didn't match interface definitions

## Solutions Implemented

### 1. **Created Helper Functions**
Added a consistent `getCompanyInfoById` helper function in `pages/sale/create.tsx`:

```typescript
const getCompanyInfoById = (companyId: number | undefined): string => {
  if (!companyId || !companies[companyId]) return 'Unknown Company';
  return companies[companyId].name || 'Unknown Company';
};
```

### 2. **Updated generateDynamicProductName**
Modified the function to use the helper consistently:

```typescript
const generateDynamicProductName = (product: ProductItem, model?: string): string => {
  const parts = [];

  // Get company name using helper function
  const companyInfo = getCompanyInfoById(product.company_id);
  if (companyInfo !== 'Unknown Company') parts.push(companyInfo);

  // Model information
  if (model && model !== 'default') {
    parts.push(model);
  } else if (product.name) {
    parts.push(product.name);
  }

  // Category, subcategory, part
  if (product.category) parts.push(product.category);
  if (product.subcategory) parts.push(product.subcategory);
  if (product.part) parts.push(`Part: ${product.part}`);

  return parts.length > 0 ? parts.join(' - ') : 'Unknown Product';
};
```

### 3. **Updated All Company Name References**
Modified all locations using company name display to use the helper:
- `addProductToInvoice` function
- Template row creation logic
- Existing row updates when editing

### 4. **Fixed Sales View API Issues**
- Updated `pages/api/sales/[id].ts` to return POST payload format for consistency
- Added proper data transformation to match expected structure

### 5. **Fixed Sales View UI**
- Updated `pages/sale/view/[id].tsx` to handle new API payload structure
- Added derived properties for customer, staff, mechanic, transport details
- Fixed TypeScript interface mismatches
- Updated property references to match actual data structure

## Files Modified

1. `pages/sale/create.tsx` - Main bug fix implementation
2. `pages/api/sales/[id].ts` - API response structure update
3. `pages/sale/view/[id].tsx` - UI fixes for new payload structure

## Testing Results

✅ Company names now display correctly when selecting car models
✅ Product names are generated consistently with proper company information
✅ API returns expected payload structure
✅ Sales view page displays all information correctly without TypeScript errors
✅ Edit functionality works with proper data preservation

## Future Considerations

1. **Data Loading**: Consider implementing loading states for async company data
2. **Error Handling**: Add more robust error handling for missing company data
3. **Performance**: Cache company lookups if this becomes a performance bottleneck
4. **Type Safety**: Consider creating more specific TypeScript interfaces for product relationships

## Related Issues Resolved

- Product name generation now works reliably
- Company name display consistency across all product selection scenarios
- Sales view page compatibility with updated API responses
- TypeScript compilation errors eliminated

## Commit Summary

This fix resolves the critical UX bug where selecting car models resulted in "undefined" company names, ensuring consistent product name generation and proper data display throughout the sales flow.
