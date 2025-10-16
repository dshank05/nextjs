# SessionStorage Implementation for All View/Create Page Pairs

This comprehensive task involves implementing SessionStorageService usage across all invoice/product/purchase pages to enable faster edit mode loading with proper resource management.

## Background
- View pages cache data when edit button is clicked (not during fetch)
- Create pages read cached data when in edit mode for better UX
- SessionStorage is cleaned up on successful update or cancel in edit mode
- Covers: Products, Purchases, Sale Invoices, and Salex Invoices

## Targets
- **Product**: `pages/products/view/[id].tsx` → `pages/products/create.tsx`
- **Purchase**: `pages/purchases/view/[id].tsx` → `pages/purchases/create.tsx`
- **Sale Invoice**: `pages/sale/view/[id].tsx` → `pages/sale/create.tsx`
- **Salex Invoice**: `pages/salex/view/[id].tsx` → `pages/salex/create.tsx`

## Tasks

### View Pages (Set SessionStorage on Edit Button Click)
- [x] Move SessionStorageService.set() from fetch functions to edit button click handlers
- [x] Implement for all four view pages (product, purchase, sale, salex)

### Create Pages (Read SessionStorage in Edit Mode)
- [x] Analyze SessionStorageService import usage across create pages
- [x] Identify and add missing imports for sale and salex create pages
- [x] Add SessionStorageService read logic in edit mode for sale and salex create pages
- [ ] Fix SessionStorageService removal criteria:
  - Remove on successful update/submit
  - Remove on cancel when in edit mode
- [ ] Implement for remaining pages (products/create.tsx)

### Testing
- [ ] Verify the edit flow works correctly (view → edit button → create page → submit/cancel)

## Implementation Details

### View Pages: Edit Button Handler Pattern
```typescript
const handleEditInvoice = async () => {
  // Cache invoice data before navigation
  try {
    const response = await fetch(`/api/invoices/${id}`);
    if (response.ok) {
      const data = await response.json();
      SessionStorageService.set('sales', id.toString(), {
        invoice: data.invoice,
        billingDetails: data.billingDetails,
        shippingDetails: data.shippingDetails,
        transportDetails: data.transportDetails,
        invoiceItems: data.invoiceItems
      });
      router.push(`/sale/create?edit=${id}`);
    }
  } catch (error) {
    showSnackbar('error', 'Failed to prepare invoice for editing');
  }
};
```

### Create Pages: Edit Mode Logic Pattern
```typescript
// Check for edit mode and fetch data
useEffect(() => {
  const { edit } = router.query;
  if (edit && typeof edit === 'string') {
    setIsEditMode(true);
    setEditInvoiceId(parseInt(edit));

    // First try to get data from sessionStorage
    const cachedData = SessionStorageService.get('sales', edit);
    if (cachedData) {
      console.log('🔄 Using cached invoice data from sessionStorage:', cachedData);
      populateFormWithInvoiceData(cachedData);
    } else {
      // Fallback to API call if no cached data
      fetchInvoiceForEdit(parseInt(edit));
    }
  }
}, [router.query]);
```

### Create Pages: Cleanup Pattern
```typescript
// On successful submit (remove cache)
const response = await fetch(url, { method, headers, body: JSON.stringify(submitData) });
if (response.ok) {
  // Clean up sessionStorage on successful update
  if (isEditMode && editId) {
    SessionStorageService.remove('entityType', editId.toString());
  }
  router.push('/entity-list');
}

// On cancel in edit mode (remove cache)
const handleCancel = () => {
  // Clean up sessionStorage when canceling edit
  if (isEditMode && editId) {
    SessionStorageService.remove('entityType', editId.toString());
  }
  router.push('/entity-list');
};
```

### Import Required
```typescript
import SessionStorageService from '../../lib/sessionStorage';
