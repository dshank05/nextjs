# Date Filter Fixes Applied - 2026-01-29

## Problem
Date filters in entry APIs were not capturing the full end date because they didn't set proper time boundaries:
- `dateFrom`: Should be 00:00:00 (start of day) ✅
- `dateTo`: Should be 23:59:59 (end of day) ❌ Was 00:00:00

Result: Entries created on the end date but after midnight were MISSED!

## Solution Pattern
```typescript
// Start of day for dateFrom (00:00:00)
const startDate = new Date(dateFrom as string)
startDate.setHours(0, 0, 0, 0)
const startTimestamp = Math.floor(startDate.getTime() / 1000)

// End of day for dateTo (23:59:59)
const endDate = new Date(dateTo as string)
endDate.setHours(23, 59, 59, 999)  // ✅ 86399 seconds (23:59:59)
const endTimestamp = Math.floor(endDate.getTime() / 1000)
```

## Files Fixed

### ✅ Already Fixed (Had +86399 or setHours):
1. `pages/api/reports/debit-notes.ts`
2. `pages/api/reports/vendor-outstanding.ts`
3. `pages/api/reports/vendor-ledger-accounting.ts`

### 🔧 Need Fixing:
4. `pages/api/vendor-transactions/index.ts`
5. `pages/api/vendor-refunds/index.ts`
6. `pages/api/vendor-payments/index.ts`
7. `pages/api/sale-returns/index.ts`
8. `pages/api/purchase-returns/index.ts`
9. `pages/api/customer-refunds/index.ts`
10. `pages/api/customer-payments/index.ts`
11. `pages/api/customer-adjustments/index.ts`
12. `pages/api/reports/vendor-ledger-details.ts`

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

## Next Steps
Apply date filter fix pattern to remaining 9 entry API files.
