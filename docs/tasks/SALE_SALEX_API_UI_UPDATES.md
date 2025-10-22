# SALE & SALEX API/UI UPDATE TASKS

## Overview

This document outlines the tasks required to apply the same comprehensive improvements made to the Purchase system to the Sale and Salex systems. The Purchase system received extensive updates including API payload standardization, inline editing enhancements, tax recalculation fixes, and UI improvements.

## Context

The Purchase system was recently updated with:
- ✅ API payload standardization (POST/PUT consistency)
- ✅ Inline editing with car model filtering and product name updating
- ✅ Tax recalculation bug fixes
- ✅ Enhanced GET API responses
- ✅ UI updates for view pages and create/edit modes

Now we need to apply these same improvements to both **Sale** and **Salex** systems.

## SALE System Tasks

### API Layer Updates

#### 1. Update `pages/api/sales/index.ts`
- [ ] Standardize POST and PUT payloads within Sale system (they can differ from Purchase/Salex but should be consistent within Sale)
- [ ] Update PUT payload to include all necessary fields and ensure they're properly saved (no data loss)
- [ ] Add comprehensive error handling and data validation
- [ ] Fix any TypeScript errors related to property access
- [ ] Ensure stock updates use customer_id context, but item operations use product_id
- [ ] Review for hardcoded API key-value pairs and document if any exist for later cleanup
- [ ] Use IDs (customer_id, product_id) for all database operations, not names

#### 2. Update `pages/api/sales/[id].ts`
- [ ] Standardize GET response structure to be consistent with own POST/PUT format
- [ ] Fix any TypeScript errors and property access issues
- [ ] Update PUT logic to ensure all sent fields are properly saved
- [ ] Add comprehensive error handling and validation
- [ ] Ensure stock updates use customer_id context, but item operations use product_id
- [ ] Review for hardcoded values and document issues for later cleanup
- [ ] Use IDs for all database operations, not names

### UI Layer Updates

#### 3. Update `pages/sale/create.tsx`
- [ ] Implement inline row editing similar to Purchase
- [ ] Add car model filtering for product compatibility
- [ ] Add product name updating logic in inline edit
- [ ] Update product name display to show live changes during editing
- [ ] Fix any template row issues (ensure car model selection works)
- [ ] Add proper error handling for inline edit operations

#### 4. Update `pages/sale/view/[id].tsx`
- [ ] Update UI to match enhanced Purchase view format
- [ ] Ensure all fields are properly displayed (customer details, items, etc.)
- [ ] Update API data consumption if GET response changed
- [ ] Test edit mode navigation and data population

#### 5. Update `pages/sale/view.tsx` (if exists)
- [ ] Review and update list view if needed
- [ ] Ensure filtering and display matches updated data structures

## SALEX System Tasks

### API Layer Updates

#### 6. Update `pages/api/salex/index.ts`
- [ ] Standardize POST and PUT payloads within Salex system (can differ from Sale/Purchase)
- [ ] Update PUT payload to include all necessary fields and ensure they're properly saved
- [ ] Add comprehensive error handling and data validation
- [ ] Fix any TypeScript errors related to property access
- [ ] Ensure stock updates use customer_id context, but item operations use product_id
- [ ] Review for hardcoded API key-value pairs and document issues for cleanup
- [ ] Use IDs (customer_id, product_id) for all database operations, not names

#### 7. Update `pages/api/salex/[id].ts`
- [ ] Standardize GET response structure to be consistent with own POST/PUT format
- [ ] Fix any TypeScript errors and property access issues
- [ ] Update PUT logic to ensure all sent fields are properly saved
- [ ] Add comprehensive error handling and validation
- [ ] Ensure stock updates use customer_id context, but item operations use product_id
- [ ] Review for hardcoded values and document issues for later cleanup
- [ ] Use IDs for all database operations, not names

### UI Layer Updates

#### 8. Update `pages/salex/create.tsx`
- [ ] Implement inline row editing with car model filtering
- [ ] Add product name updating functionality in inline edit
- [ ] Update live product name display during editing
- [ ] Fix template row car model selection issues
- [ ] Add proper error handling and validation

#### 9. Update `pages/salex/view/[id].tsx`
- [ ] Update UI to match enhanced view formats
- [ ] Ensure proper display of all updated fields
- [ ] Update data consumption if API responses changed
- [ ] Test edit mode functionality

#### 10. Update `pages/salex/view.tsx` (if exists)
- [ ] Review list view for any required updates
- [ ] Ensure data display is consistent with updates

## Common/Supporting Tasks

#### 11. Tax Recalculation Logic
- [ ] Review and update tax calculation logic in both systems
- [ ] Ensure intra-state vs inter-state logic works correctly
- [ ] Fix any existing tax recalculation bugs
- [ ] Test tax calculations with different scenarios

#### 12. Session Storage & State Management
- [ ] Ensure SessionStorageService works correctly for edit modes
- [ ] Update data population logic in edit modes
- [ ] Test data persistence across page navigations

#### 13. Component Updates
- [ ] Review `ProductSelectionPanel` usage if any changes needed
- [ ] Ensure `SearchableMultiSelect` works consistently
- [ ] Update any shared components if API data structures changed

#### 14. Data Validation & Error Handling
- [ ] Add comprehensive form validation across all updated components
- [ ] Update error messages and user feedback
- [ ] Test edge cases and error scenarios

#### 15. Testing & Validation
- [ ] Test all CRUD operations (Create, Read, Update, Delete)
- [ ] Validate stock management logic works correctly
- [ ] Test inline editing functionality thoroughly
- [ ] Ensure data consistency across all operations
- [ ] Test with various customer/product combinations

## Priority Order

### Phase 1: API Foundation (Critical)
1. Update `pages/api/sales/index.ts`
2. Update `pages/api/sales/[id].ts`
3. Update `pages/api/salex/index.ts`
4. Update `pages/api/salex/[id].ts`

### Phase 2: UI Core (High Priority)
5. Update `pages/sale/create.tsx`
6. Update `pages/salex/create.tsx`

### Phase 3: View Pages (Medium Priority)
7. Update sale view pages
8. Update salex view pages

### Phase 4: Polish & Testing (Low Priority)
9. Tax recalculation fixes
10. Component updates and testing
11. Documentation updates

### Phase 5: Critical Bug Fixes

#### Sale System Critical Issues
- [x] Fix missing customer info in sale index (GET API not joining bill_tosales table properly)
- [x] Fix payment status mapping (payment_status field not mapped to status in TransactionTable)
- [x] Remove mode field from API response, use payment_mode only
- [x] Fix invoice-level discount calculation from item discounts in POST API
- [x] Fix sale create edit mode date formatting error

## Notes

- **Reference Purchase Implementation**: Use the updated Purchase system as the reference for all changes
- **Consistent Patterns**: Ensure Sale and Salex follow the same patterns as Purchase for maintainability
- **Data Integrity**: Pay special attention to stock management and financial calculations
- **User Experience**: Maintain consistent UI/UX patterns across all three systems
- **Testing**: Each API change should be tested with corresponding UI updates
- **ID-Based Operations**: Always use IDs (customer_id, product_id, vendor_id) for database operations, not names - this ensures data integrity and prevents issues with duplicates/changes
- **Payload Consistency**: POST and PUT payloads should be consistent within each system but can differ between systems (Sale vs Purchase vs Salex)
- **Hardcoded Values**: Document any hardcoded API key-value pairs found during review for future cleanup

## Dependencies

- Purchase system updates must be completed and tested
- Database schema should support all required fields
- Shared components should work with updated data structures
- Test data should be available for validation

## Risk Assessment

- **High Risk**: API payload changes could break existing functionality
- **Medium Risk**: UI changes might affect user workflows
- **Low Risk**: View page updates are mostly cosmetic

## Success Criteria

- All forms submit successfully with updated payloads
- Inline editing works consistently across all systems
- Stock calculations are accurate and consistent
- Data displays correctly in all view modes
- Edit modes populate data correctly from existing records
- No TypeScript compilation errors
- No runtime errors in production scenarios
- **Data Integrity**: All sent values in API calls are properly saved (no silent data loss)
- **ID-Based Operations**: All database operations use IDs, not names
- **Error Handling**: Comprehensive error handling with appropriate user feedback
