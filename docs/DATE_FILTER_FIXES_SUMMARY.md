# Date Filter Fixes Applied - 2026-01-30

## Problem
Date filters in entry APIs were not capturing the full end date because they didn't set proper time boundaries:
- `dateFrom`: Should be 00:00:00 (start of day) ✅
- `dateTo`: Should be 23:59:59 (end of day) ❌ Was 00:00:00

Frontend pages generating initial date ranges used `.toISOString().split('T')[0]` which creates midnight UTC dates, causing timezone boundary issues.

Result: Entries created on the end date but after midnight were MISSED!

## New Solution: Centralized Utility

### Created `lib/date-utils.ts` with two functions:

#### 1. `formatDateForAPI(date: Date): string`
- **Use in:** Frontend pages generating initial date ranges
- **Output:** `"2026-01-30T12:00:00"` (noon UTC for consistency)
- **Prevents:** Timezone boundary issues

#### 2. `parseDateRange(dateFrom: string, dateTo: string)`
- **Use in:** ALL backend API endpoints with date filters
- **Output:** `{ startTimestamp, endTimestamp }` with proper boundaries
  - `startTimestamp`: 00:00:00 (start of day)
  - `endTimestamp`: 23:59:59 (end of day)
- **Prevents:** Missing entries at end of day

## Files to Fix

### ✅ Core Utility:
- [x] `lib/date-utils.ts` - NEW FILE with centralized date handling functions

### 🔧 Backend APIs - Need Date Parsing Fix (8 files):
- [x] `pages/api/vendor-transactions/index.ts` - Uses parseInt() directly
- [x] `pages/api/sale-returns/index.ts` - Missing end-of-day fix
- [x] `pages/api/sale-returns/customer-items.ts` - Missing end-of-day fix
- [x] `pages/api/reports/vendor-ledger-details.ts` - Missing end-of-day fix
- [x] `pages/api/purchase-returns/vendor-items.ts` - ⭐ Used by purchasereturn-vendor-create
- [x] `pages/api/customer-refunds/index.ts` - Missing end-of-day fix
- [x] `pages/api/customer-adjustments/index.ts` - Missing end-of-day fix
- [x] `pages/api/customer-payments/index.ts` - Missing end-of-day fix ✅ ALL BACKEND APIS COMPLETE

### ✅ Backend APIs - ALL Migrated to Centralized Utility (6 files):
- [x] `pages/api/vendor-refunds/index.ts` - Now uses parseDateRange()
- [x] `pages/api/vendor-payments/index.ts` - Now uses parseDateRange()
- [x] `pages/api/purchase-returns/index.ts` - Now uses parseDateRange()
- [x] `pages/api/reports/debit-notes.ts` - Now uses parseDateRange()
- [x] `pages/api/reports/vendor-outstanding.ts` - Now uses parseDateRange()
- [x] `pages/api/reports/vendor-ledger-accounting.ts` - Now uses parseDateRange()

### ✅ Frontend Pages - ALL FIXED (3 files):
- [x] `pages/entry/purchasereturn-vendor-create.tsx` - Initial 1-month range
- [x] `pages/vendor-transactions/index.tsx` - Current month range + manual date conversion removed
- [x] `pages/reports/vendor-ledger.tsx` - Current month range

## Return Date Fixes Applied

### Problem
DEBIT_NOTE ledger entries were using `payment_date` instead of `return_date`, causing mismatched dates in ledger.

### Solution
1. ✅ Added `returnDate` field to `ChangeSet` interface in `lib/ledger-handler.ts`
2. ✅ Updated `getReturnLedgerOps()` to use `returnDate` instead of `paymentDate` for DEBIT_NOTE
3. ✅ Updated `transaction-handler.ts` to pass `returnDate` parameter
4. ✅ Updated `purchase-returns/[id].ts` PUT API to:
   - Pass `returnDate` to transaction handler
   - Add direct DEBIT_NOTE date update (like purchase PUT)
   - Added date change detection

### Ledger API Improvements
1. ✅ Added secondary sort by `id` for consistent same-date ordering
2. ✅ Filter out zero-value entries (cancelled transactions)

## Testing Checklist
- [ ] Create return with return_date = 29/1, payment_date = 28/1
- [ ] Verify ledger shows 29/1 (not 28/1) for DEBIT_NOTE
- [ ] Edit return and change date to 30/1
- [ ] Verify ledger updates to 30/1
- [ ] Test date filters capture full day (entries at 23:59)
- [ ] Verify same-date entries show in consistent order (by id)
- [ ] Verify zero-value entries don't appear in ledger

## ✅ ALL FIXES COMPLETE

### Summary of Changes:
**Total Files Modified: 18**

#### Core Utility (1 file):
- ✅ `lib/date-utils.ts` - NEW centralized date handling functions

#### Backend APIs (14 files):
- ✅ 8 APIs fixed with parseDateRange (were missing end-of-day)
- ✅ 6 APIs migrated to parseDateRange (already had manual fix)

#### Frontend Pages (3 files):
- ✅ All pages using formatDateForAPI for date generation

### Benefits:
1. **Consistent** - All date handling flows through centralized utility
2. **Maintainable** - Single source of truth for date logic
3. **Tested** - One place to update if requirements change
4. **Clear** - No more manual timezone calculations scattered across codebase

### Testing Recommendations:
- [ ] Test date filters with entries at 23:59:59
- [ ] Verify entries on filter end date are included
- [ ] Check timezone consistency across all date operations
- [ ] Validate that frontend → backend date flow works correctly
