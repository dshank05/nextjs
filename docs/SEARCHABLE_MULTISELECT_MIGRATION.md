# SearchableMultiSelect Migration Guide

## Overview
This document outlines the migration from HTML `<select>` elements to the enhanced `SearchableMultiSelect` component across the project.

## Component Enhancements
The `SearchableMultiSelect` component now supports both single and multi-selection modes:

### New Features
- **Mode Support**: `mode="single"` | `mode="multi"` (default: "multi")
- **Auto-focus**: Search input automatically focuses when dropdown opens
- **Single Mode**: Displays selected value as plain text, re-opens dropdown on click
- **Backward Compatibility**: Existing multi-select usage unchanged

### Single Mode Behavior
- Selected value displays as plain text (no X button)
- Clicking the component re-opens the dropdown
- Only one selection allowed
- Dropdown closes immediately after selection

### Multi Mode Behavior (unchanged)
- Selected values display as removable tags with X buttons
- Multiple selections allowed
- Close behavior controlled by `closeOnSelect` prop

## Migration Scope
Found **73 `<select>` elements** across the project:

### Categories:
- **Pagination Controls**: 20+ "Items per page" dropdowns
- **Status Filters**: 10+ status dropdowns in tables
- **Form Fields**: 40+ form inputs (categories, companies, payment modes, etc.)

### Priority Migration Order:
1. **Core Forms** (High Priority)
   - Customer/vendor creation forms
   - Product creation forms
   - Sale/purchase/salex creation forms

2. **Settings Pages**
   - All settings pages with form selects

3. **Table Filters**
   - Status filters and pagination in tables

4. **Entry Forms**
   - Return creation forms

## Migration Examples

### Before (HTML Select)
```tsx
<select
  value={formData.category}
  onChange={(e) => setFormData({...formData, category: e.target.value})}
  className="select w-full"
>
  <option value="">Select Category</option>
  {categories.map(cat => (
    <option key={cat.id} value={cat.id}>{cat.name}</option>
  ))}
</select>
```

### After (SearchableMultiSelect)
```tsx
<SearchableMultiSelect
  mode="single"
  options={categories.map(cat => ({ id: cat.id.toString(), name: cat.name }))}
  selectedValue={formData.category?.toString() || null}
  onSelectionChange={(value) => setFormData({...formData, category: value ? parseInt(value) : null})}
  placeholder="Select Category"
/>
```

### Multi-Select Example
```tsx
<SearchableMultiSelect
  options={carModels.map(model => ({ id: model.id.toString(), name: model.name }))}
  selectedValues={selectedCarModels}
  onSelectionChange={setSelectedCarModels}
  placeholder="Select car models..."
/>
```

## Data Structure Requirements
All options must follow this interface:
```tsx
interface Option {
  id: string;    // Must be string
  name: string;  // Display name
}
```

### Converting Existing Data:
```tsx
// Convert numeric IDs to strings
const options = categories.map(cat => ({
  id: cat.id.toString(),
  name: cat.name
}));

// Handle nullable values
selectedValue={formData.category_id?.toString() || null}
```

## Migration Checklist

### Phase 1: Core Forms
- [ ] `pages/customers/create.tsx` - State selections
- [ ] `pages/vendors/create.tsx` - State selections
- [ ] `pages/products/create.tsx` - Category, subcategory, company, warehouse, rack
- [ ] `pages/sale/create.tsx` - Staff, customer, mechanic, payment fields
- [ ] `pages/purchases/create.tsx` - Staff, vendor, payment fields ✅ DONE (car models)
- [ ] `pages/salex/create.tsx` - Staff, customer, mechanic, payment fields

### Phase 1.5: Table Filters (Started)
- [x] `components/products/ProductTable.tsx` - All filters migrated ✅ DONE
  - Category filter ✅
  - Company filter ✅
  - Subcategory filter ✅
  - Car models filter ✅

### Phase 2: Settings Pages
- [ ] `pages/settings/*.tsx` - All form selects in settings

### Phase 3: Table Filters
- [ ] `components/*/Table.tsx` - Status filters and pagination
- [ ] `components/transactions/TransactionFilters.tsx` - Status and type filters

### Phase 4: Entry Forms
- [ ] `pages/entry/*.tsx` - Return reason selections

## Special Considerations

### Pagination Selects
Most "Items per page" selects can be migrated to single mode:
```tsx
<SearchableMultiSelect
  mode="single"
  options={[
    { id: "10", name: "10 per page" },
    { id: "25", name: "25 per page" },
    { id: "50", name: "50 per page" }
  ]}
  selectedValue={itemsPerPage.toString()}
  onSelectionChange={(value) => setItemsPerPage(parseInt(value!))}
/>
```

### Status Filters
Status dropdowns work well with single mode:
```tsx
<SearchableMultiSelect
  mode="single"
  options={[
    { id: "active", name: "Active" },
    { id: "inactive", name: "Inactive" }
  ]}
  selectedValue={statusFilter}
  onSelectionChange={setStatusFilter}
/>
```

### Form Validation
Update validation logic to work with string IDs:
```tsx
// Before
if (!formData.category_id) { /* error */ }

// After
if (!selectedCategoryId) { /* error */ }
```

## Testing Checklist
- [ ] Component renders correctly in both modes
- [ ] Search functionality works
- [ ] Selection/deselection works as expected
- [ ] Form submission includes correct values
- [ ] Validation still works
- [ ] No console errors
- [ ] Responsive design maintained

## Rollback Plan
If issues arise, individual components can be rolled back to HTML selects by:
1. Reverting the component usage
2. Restoring original state management
3. Updating form handlers if needed

## Benefits After Migration
- **Better UX**: Searchable dropdowns with better filtering
- **Consistency**: Unified component across the application
- **Maintainability**: Single component to maintain vs 73 separate selects
- **Accessibility**: Better keyboard navigation and screen reader support
- **Performance**: Virtualized rendering for large option lists
