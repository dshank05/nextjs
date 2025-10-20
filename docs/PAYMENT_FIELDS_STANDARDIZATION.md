# Payment Fields Standardization Audit

## Overview
This document provides a comprehensive audit of all locations in the codebase where `payment_mode` and `payment_status` fields are used. The goal is to standardize these fields across the entire application to use consistent values and reduce bugs.

## Target Standard
- **payment_status**: `0` = Unpaid, `1` = Paid
- **payment_mode**: `0` = Cash, `1` = Bank

## Current Schema Definition
```prisma
payment_status           Int?      // Payment status: 0=Unpaid, 1=Paid
payment_mode             Int?      // Payment mode: 1=Cash, 2=Bank   // ❌ NEEDS UPDATE
```

## Issues Identified

1. **Schema Inconsistency**: payment_mode comments show "1=Cash, 2=Bank" but target is "0=Cash, 1=Bank"
2. **Validation Inconsistency**: Some APIs validate `[0,1]`, others `[1,2]` for payment_mode
3. **Default Value Inconsistency**: payment_mode defaults vary between 0 and 1
4. **UI Display Inconsistency**: Dropdown options use different value mappings

### Recently Fixed Bugs

5. **Payment Status Null in Edit Mode**: `pages/api/purchases/[id].ts` PUT method was setting `payment_status` to `null` instead of defaulting to `0` (Unpaid)
   - **Status**: ✅ FIXED - Added validation and defaults: payment_status=0, payment_mode=1
   - **Fix**: Added API validation to ensure values ∈ [0,1], with fallback defaults

6. **Product Name Not Updating in Edit**: Purchase edit API wasn't updating `name_of_product` and `car_model` fields when editing existing items
   - **Status**: ✅ FIXED - Now updates product details from frontend data
   - **Root Cause**: Existing item update logic only checked quantity changes, ignored product name/model updates
   - **Fix**: Enhanced update logic to sync `name_of_product` and `car_model` from UI changes

7. **Tax Summary Fields Not Populated in Edit Mode**: Main tax fields (TOTAL CGST, SGST, IGST, TAX) showed 0.00 instead of calculated values from product data
   - **Status**: ✅ FIXED - Removed condition preventing tax recalculation in edit mode
   - **Root Cause**: useEffect had `if (isEditMode && !isInitialDataLoaded) return;` preventing tax calculation updates
   - **Fix**: Tax fields now always calculate from current product data, ensuring UI displays correct tax breakdown

## Files Affected

### UI Components

#### Sales Pages
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/sale/create.tsx` | payment_status | Validates `[0,1]`, defaults to 1 | ✅ Correct | Update to default 0? |
| `pages/sale/create.tsx` | payment_mode | Validates `[1,2]`, defaults to 1 | ❌ Uses [1,2] | Change to [0,1], default 1 |
| `pages/sale/view/[id].tsx` | Both fields | Display only | ✅ Correct | No changes needed |
| `pages/sale/index.tsx` | Both fields | Filter/display | ✅ Correct | No changes needed |

#### Salex (Wholesale Sales) Pages
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/salex/create.tsx` | payment_status | Defaults to 1 | ✅ Correct | Update to default 0? |
| `pages/salex/create.tsx` | payment_mode | Defaults to 1 | ✅ Correct | No changes |
| `pages/salex/view/[id].tsx` | Both fields | Display only | ✅ Correct | No changes needed |
| `pages/salex/index.tsx` | Both fields | Filter/display | ✅ Correct | No changes needed |

#### Purchase Pages
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/purchases/create.tsx` | payment_status | Defaults to 0 | ✅ Correct | No changes |
| `pages/purchases/create.tsx` | payment_mode | Defaults to 1 | ✅ Correct | No changes |
| `pages/purchases/view/[id].tsx` | Both fields | Display only | ✅ Correct | No changes needed |
| `pages/purchases/index.tsx` | Both fields | Filter/display | ✅ Correct | No changes needed |

#### Return Pages
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/entry/salereturn-create.tsx` | payment_status | Defaults to 1 | ✅ Correct | Update to default 0? |
| `pages/entry/salereturn-create.tsx` | payment_mode | Defaults to 1 | ✅ Correct | No changes |
| `pages/entry/purchasereturn-create.tsx` | payment_status | Defaults to 0 | ✅ Correct | No changes |
| `pages/entry/purchasereturn-create.tsx` | payment_mode | Defaults to 1 | ✅ Correct | No changes |

### API Endpoints

#### Sales APIs
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/api/sales/index.ts` | payment_status | Filtering logic for 0,1 | ✅ Correct | No changes |
| `pages/api/sales/index.ts` | payment_mode | Filtering logic | ✅ Correct | No changes |
| `pages/api/sales/[id].ts` | payment_status | Update operations | ✅ Correct | No changes |
| `pages/api/sales/[id].ts` | payment_mode | Update operations | ❌ Uses 2 for Bank | Change to 1 |

#### Salex APIs
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/api/salex/index.ts` | payment_status | Filtering logic | ✅ Correct | No changes |
| `pages/api/salex/index.ts` | payment_mode | Filtering logic | ✅ Correct | No changes |
| `pages/api/salex/[id].ts` | payment_status | Update operations | ✅ Correct | No changes |
| `pages/api/salex/[id].ts` | payment_mode | Update operations | ❌ Uses 2 for Bank | Change to 1 |

#### Purchase APIs
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/api/purchases/index.ts` | payment_status | Validates `[0,1]` | ✅ Correct | No changes |
| `pages/api/purchases/index.ts` | payment_mode | Validates `[1,2]` | ❌ Uses [1,2] | Change to [0,1] |
| `pages/api/purchases/index.ts` | payment_mode | Defaults to 1 | ✅ Correct | No changes |
| `pages/api/purchases/[id].ts` | payment_status | Parse/conversion logic | ✅ Correct | No changes |
| `pages/api/purchases/[id].ts` | payment_mode | Parse/conversion logic | ✅ Correct | No changes |

#### Invoice APIs
| File | Field | Current Usage | Issues | Action Needed |
|------|-------|---------------|--------|---------------|
| `pages/api/invoices/index.ts` | payment_status | Maps from UI payment_status | ✅ Correct | No changes |
| `pages/api/invoices/index.ts` | payment_mode | Maps from UI payment_mode | ❌ Maps 2→2 | Change mapping |
| `pages/api/invoices/[id].ts` | payment_status | Update operations | ✅ Correct | No changes |
| `pages/api/invoices/[id].ts` | payment_mode | Update operations | ✅ Correct | No changes |

### UI Form Components

#### Select Dropdown Options
| File | Field | Current Values | Issues | Action Needed |
|------|-------|----------------|--------|---------------|
| `pages/sale/create.tsx` | payment_status | `[{value:0,text:"Unpaid"},{value:1,text:"Paid"}]` | ✅ Correct | No changes |
| `pages/sale/create.tsx` | payment_mode | `[{value:1,text:"Cash"},{value:2,text:"Bank"}]` | ❌ Uses 2 | Change to use 1 |
| `pages/salex/create.tsx` | payment_status | Similar pattern | ✅ Correct | No changes |
| `pages/salex/create.tsx` | payment_mode | Similar pattern | ❌ Uses 2 | Change to use 1 |
| `pages/purchases/create.tsx` | payment_status | Similar pattern | ✅ Correct | No changes |
| `pages/purchases/create.tsx` | payment_mode | Similar pattern | ❌ Uses 1 | No changes |

#### Display Components
| File | Field | Current Logic | Issues | Action Needed |
|------|-------|--------------|--------|---------------|
| `pages/sale/view/[id].tsx` | payment_mode | `getPaymentModeText(mode)` | ✅ Correct | No changes |
| `pages/salex/view/[id].tsx` | payment_mode | Similar function | ✅ Correct | No changes |
| `pages/purchases/view/[id].tsx` | payment_mode | Similar function | ✅ Correct | No changes |

### Helper Functions

#### Status Text Functions
| File | Function | Current Values | Issues | Action Needed |
|------|----------|----------------|--------|---------------|
| All view files | `getStatusBadge()` | `0: "Unpaid", 1: "Paid"` | ✅ Correct | No changes |
| All view files | `getPaymentModeText()` | `1: "Cash", 2: "Bank"` | ❌ Uses 2 | Change to `0: "Cash", 1: "Bank"` |

## Implementation Plan

### Phase 1: Schema Updates
1. Update Prisma schema comments for payment_mode
2. Update database field comments if needed

### Phase 2: API Updates
1. Update validation logic in purchase APIs to use [0,1] for payment_mode
2. Update default value mappings in invoice/sales APIs
3. Ensure all parseInt operations handle new values correctly

### Phase 3: UI Updates
1. Update dropdown options to use 0/1 for payment_mode
2. Update display functions to handle 0/1 values
3. Update any hardcoded validation arrays

### Phase 4: Database Migration
1. Assess if existing data needs migration from payment_mode values
2. Create migration script if values exist with current values

### Phase 5: Testing
1. Test all create/update operations
2. Test filtering and display functions
3. Test validation on all forms

## Files Requiring Changes

### Must Change (high priority)
- `prisma/schema.prisma` - Update comments
- `pages/api/purchases/index.ts` - Validation logic for payment_mode
- `pages/api/invoices/index.ts` - Value mapping
- `pages/sale/create.tsx` - Dropdown options and validation
- `pages/salex/create.tsx` - Dropdown options
- All view files - `getPaymentModeText()` functions

### Should Review (medium priority)
- All API files - Double-check value handling
- All form files - Ensure consistent defaults
- All display files - Ensure proper text rendering

### Low Priority
- Documentation updates
- Test files (if any)

## Validation Rules to Implement

```javascript
// Standard validation function
const validatePaymentFields = (payment_status, payment_mode) => {
  const validStatuses = [0, 1];
  const validModes = [0, 1];

  if (!validStatuses.includes(payment_status)) {
    throw new Error('payment_status must be 0 (Unpaid) or 1 (Paid)');
  }

  if (!validModes.includes(payment_mode)) {
    throw new Error('payment_mode must be 0 (Cash) or 1 (Bank)');
  }

  return true;
};
```

## Testing Checklist

- [ ] Create operations work with new values
- [ ] Update operations work with new values
- [ ] Filtering works correctly
- [ ] Display functions show correct text
- [ ] Validation prevents invalid values
- [ ] Existing data migrates correctly
- [ ] No breaking changes to existing functionality

## Rollback Plan

If issues arise:
1. Schema changes are backward compatible (comments only)
2. API changes can be rolled back by reverting validation
3. UI changes can be rolled back by reverting dropdown options
4. Database migration can be reversed if needed

---

**Total Files to Review/Modify**: ~25 files
**Critical Path Files**: 8-10 files
**Estimated Effort**: Medium (2-3 days for careful implementation)
