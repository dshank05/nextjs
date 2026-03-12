# Sale Return "Customer Not Found" Bug Fix

## Problem
When editing a sale return, the page showed "Customer not found" error and failed to load the return data properly.

## Root Cause
**Race condition in data loading sequence**

In `pages/entry/salereturn-create.tsx`, the `useEffect` hook was calling both `loadCustomers()` and `loadReturnForEdit()` simultaneously:

```typescript
useEffect(() => {
  loadReturnReasons();
  loadCustomers();        // Async function
  
  if (returnIdParam) {
    loadReturnForEdit(returnIdParam as string);  // Called immediately, doesn't wait
  }
}, [returnIdParam, invoiceIdParam]);
```

The problem:
1. `loadCustomers()` is async and takes time to fetch data
2. `loadReturnForEdit()` was called immediately without waiting
3. When `loadReturnForEdit()` tried to find the customer in the `customers` array, it was still empty
4. This caused the "Customer not found" error

## Solution
Changed the `useEffect` to wait for customers to load before loading return data:

```typescript
useEffect(() => {
  const initializePage = async () => {
    // Load return reasons and customers FIRST
    await Promise.all([
      loadReturnReasons(),
      loadCustomers()
    ]);

    // THEN check if we're in edit mode
    if (returnIdParam) {
      setIsEditMode(true);
      await loadReturnForEdit(returnIdParam as string);
    }
    // Or invoice mode
    else if (invoiceIdParam) {
      setIsInvoiceMode(true);
      setTargetInvoiceId(invoiceIdParam as string);
      await loadInvoiceForReturn(invoiceIdParam as string);
    }
  };

  initializePage();
}, [returnIdParam, invoiceIdParam]);
```

## Additional Improvements Made

### 1. Better Customer Validation in Edit Mode
Added proper customer validation logic in `loadReturnForEdit()`:

```typescript
// Check if customer exists in the customers list
const existingCustomer = customers.find(c => c.id === customerData.id.toString());

if (existingCustomer) {
  setCustomer(existingCustomer);
} else if (customerData.id && customerData.id !== 0) {
  // Customer not in list but has valid ID, create customer object
  setCustomer({
    id: customerData.id.toString(),
    billing_name: customerData.customer_name || customerData.billing_name || 'Unknown Customer',
    state: customerData.state,
    state_code: customerData.state_code
  });
} else {
  // Invalid or "Other" customer
  console.error('Invalid customer data:', customerData);
  showSnackbar('error', 'Customer not found. Please select a valid customer.');
  setIsLoadingEditData(false);
  return;
}
```

### 2. API Improvements (`pages/api/sale-returns/[id].ts`)
- Added validation to check if customer exists when invoice has a customer ID
- Returns proper error if customer is not found
- Improved customer response structure to include `billing_name` field
- Handles "Other" customer case (ID = 0) gracefully

### 3. View Page Improvements (`pages/entry/salereturn/[id].tsx`)
- Added fallback for missing customer name
- Uses `customer_name || billing_name || 'Other'` to ensure a name is always displayed

## Files Modified
1. `pages/entry/salereturn-create.tsx` - Fixed race condition in data loading
2. `pages/api/sale-returns/[id].ts` - Added customer validation and better error handling
3. `pages/entry/salereturn/[id].tsx` - Added fallback for customer name display

## Testing Checklist
- [x] Edit mode loads customer correctly
- [x] Create mode works normally
- [x] View mode displays customer name correctly
- [x] Handles "Other" customer (ID = 0) gracefully
- [x] Shows proper error message if customer is deleted/not found
- [x] No TypeScript errors

## Impact
- **Edit Mode**: Now works correctly, customer data loads properly
- **Create Mode**: No changes, continues to work as before
- **View Mode**: More robust, handles edge cases better
- **API**: Better error handling and validation

---

Date: March 7, 2026
Status: FIXED
