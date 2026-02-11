dat# Date Handling Standardization Implementation Plan

## [Overview]
Standardize all date handling across the application to use consistent midnight local time timestamps, eliminating UTC conversion bugs and ensuring ledger entries merge correctly.

The current application has THREE inconsistent date conversion patterns causing bugs:
1. **Pattern A (Buggy)**: `Math.floor(new Date(date).getTime() / 1000)` - Interprets YYYY-MM-DD as UTC midnight, causing timezone shifts
2. **Pattern B (Inconsistent)**: `Math.floor(new Date(date + 'T12:00:00').getTime() / 1000)` - Adds noon time, but still has UTC interpretation issues
3. **Pattern C (Current time)**: `Math.floor(Date.now() / 1000)` - For audit timestamps, correct

**The Root Problem**: When JavaScript's `new Date("2026-02-07")` receives a date-only string, it interprets it as UTC midnight, not local midnight. In PST (UTC-8), this becomes February 6 at 4:00 PM, creating different timestamps for the same logical date.

**The Solution**: Parse date strings manually to create local Date objects at midnight (00:00:00), then convert to Unix timestamps. All date conversions will flow through a single utility function in date-utils.ts.

## [Types]
No new types required. All date fields remain as `Int` (Unix timestamps in seconds) in the database schema.

**Affected date field types in schema**:
- `invoice_date: Int` - Invoice, Invoiceitems, Purchase, Purchaseitems
- `return_date: Int` - sale_returns, purchase_returns, salex_returns  
- `payment_date: Int` - vendor_payments, customer_payments, purchase_returns, sale_returns
- `refund_date: Int` - vendor_refunds, customer_refunds
- `transaction_date: Int` - vendor_ledger, customer_ledger
- `allocation_date: Int` - payment_allocations, refund_allocations

## [Files]
Centralize all date conversion through date-utils.ts and update all consuming files.

**Core Utility (1 file to modify)**:
- `lib/date-utils.ts` - Add `convertDateToTimestamp()` function

**Backend APIs (31 files to update)**:
- `pages/api/vendor-refunds/index.ts` - Change line with refund_date timestamp conversion
- `pages/api/vendor-refunds/[id].ts` - Change line with refund_date timestamp conversion  
- `pages/api/vendor-payments/index.ts` - Change line with payment_date timestamp conversion
- `pages/api/vendor-payments/[id].ts` - Change line with payment_date timestamp conversion
- `pages/api/purchases/index.ts` - Change line 174: `date + 'T12:00:00'` → use convertDateToTimestamp
- `pages/api/purchases/[id].ts` - Change line with `date + 'T12:00:00'` → use convertDateToTimestamp
- `pages/api/purchase-returns/index.ts` - Change return_date conversion
- `pages/api/purchase-returns/[id].ts` - Change line 140 and 156 with `return_date + 'T12:00:00'`
- `pages/api/purchase-returns/vendor-return.ts` - Change line with `return_date + 'T12:00:00'`
- `pages/api/sale-returns/index.ts` - Change return_date conversion
- `pages/api/sale-returns/[id].ts` - Change lines 183 and 198 with `return_date + 'T12:00:00'` and `return_date` direct
- `pages/api/sales/index.ts` - Change invoice_date conversion (currently uses `.getTime()` directly)
- `pages/api/sales/[id].ts` - Change invoice_date conversion
- `pages/api/salex/index.ts` - Change invoice_date conversions (2 places)
- `pages/api/salex/[id].ts` - Change invoice_date conversion
- `pages/api/invoices/[id].ts` - Change invoice_date conversion
- `pages/api/invoices/index.ts` - Change invoice_date conversion
- `pages/api/customer-payments/index.ts` - Change payment_date conversion
- `pages/api/customer-payments/[id].ts` - Change payment_date conversion
- `pages/api/customer-refunds/index.ts` - Change refund_date conversion
- `pages/api/customer-adjustments/index.ts` - Change adjustment_date conversion
- `pages/api/customer-adjustments/[id].ts` - Change adjustment_date conversion

**Note**: APIs using `parseDateRange()` for filtering are already correct and don't need changes.

**Frontend Pages (2 files to update)**:
- `pages/entry/vendor-transaction.tsx` - Line 710: Remove manual conversion, use convertDateToTimestamp
- `pages/entry/customer-transaction.tsx` - Similar manual conversion needs update

**Frontend Pages Already Using Correct Patterns** (no changes needed):
- `pages/entry/purchasereturn-vendor-create.tsx` - Uses `Math.floor(new Date(date).getTime() / 1000)` only for payment_date (user-selected), acceptable
- `pages/entry/salereturn-create.tsx` - Same pattern as above

## [Functions]
Add one new centralized date conversion function to date-utils.ts.

**New Function**:
```typescript
// lib/date-utils.ts
export function convertDateToTimestamp(dateString: string): number
```
- **Purpose**: Convert YYYY-MM-DD date string to Unix timestamp at midnight local time
- **Input**: Date string in "YYYY-MM-DD" format (e.g., "2026-02-07")
- **Output**: Unix timestamp (seconds) at 00:00:00 local time
- **Location**: `lib/date-utils.ts` (add after getLocalDateString function)
- **Implementation**: Parse date components manually, create Date object with local timezone at midnight

**Modified Functions** (none - all changes are call sites updating to use the new function)

## [Classes]
No classes to add, modify, or remove. This refactor only affects utility functions and their usage sites.

## [Dependencies]
No new dependencies required. All changes use existing JavaScript Date API and current date-utils.ts patterns.

## [Testing]
Validate date handling consistency across all transaction types and ledger operations.

**Test Scenarios**:
1. **Vendor Transaction Creation & Edit**:
   - Create refund on date "2026-02-07" via POST
   - Edit same refund via PUT (same date)
   - Verify both ledger entries have identical transaction_date timestamp
   - Verify entries merge into single row in ledger display

2. **Purchase & Return Dates**:
   - Create purchase with invoice_date "2026-02-07"
   - Create return with return_date "2026-02-07"  
   - Verify both show same date in ledger
   - Verify date filters include both entries

3. **Timezone Consistency (India Deployment)**:
   - Set system timezone to Asia/Kolkata (IST)
   - Create transaction on "2026-02-07"
   - Verify stored timestamp represents Feb 7 00:00:00 IST (not UTC)
   - Verify display shows correct date

4. **Date Range Filtering**:
   - Filter transactions from "2026-02-01" to "2026-02-28"
   - Create transaction at "2026-02-28" 11:59 PM
   - Verify transaction appears in filter results
   - Verify parseDateRange() captures entries at day boundaries

**Test Files**:
- Create `tests/date-handling.test.js` for unit testing convertDateToTimestamp()
- Add integration tests for POST/PUT consistency
- Manual testing checklist in DATE_FILTER_FIXES_SUMMARY.md

## [Implementation Order]
Follow this sequence to minimize disruption and ensure consistent behavior.

**Step 1: Add Utility Function** ✅ COMPLETE
- ✅ Added `convertDateToTimestamp()` to `lib/date-utils.ts`
- ✅ Added JSDoc comments with usage examples
- ✅ Included IST/India timezone note in documentation

**Step 2: Update Frontend Entry Pages** ✅ COMPLETE (highest priority - fixes immediate bug)
- ✅ Updated `pages/entry/vendor-transaction.tsx` line 710
- ✅ Updated `pages/entry/customer-transaction.tsx` 
- ✅ Imported and used convertDateToTimestamp()
- Next: Test POST and PUT operations produce same timestamps

**Step 3: Update Backend Transaction APIs** 🔄 IN PROGRESS (critical for consistency)
- ✅ Updated purchases/index.ts - Now uses convertDateToTimestamp()
- [ ] Update purchases/[id].ts
- [ ] Update purchase-returns APIs (index.ts, [id].ts, vendor-return.ts)
- [ ] Update vendor-refunds APIs (index.ts not needed - already uses timestamp from frontend)
- [ ] Update vendor-payments APIs (index.ts not needed - already uses timestamp from frontend)
- Next: Continue with remaining 28 backend API files

**Step 4: Update Backend Sales APIs**
- Update sales APIs (index.ts and [id].ts)
- Update salex APIs (index.ts and [id].ts)
- Update sale-returns APIs
- Test sales workflow end-to-end

**Step 5: Update Customer Transaction APIs**
- Update customer-payments APIs
- Update customer-refunds APIs  
- Update customer-adjustments APIs
- Test customer ledger consistency

**Step 6: Update Invoice APIs**
- Update invoices APIs (both regular and manual entry)
- Test invoice date handling

**Step 7: Verification & Documentation**
- Run full test suite
- Verify ledger entry merging works correctly
- Update DATE_FILTER_FIXES_SUMMARY.md with completion status
- Add convertDateToTimestamp() usage notes to DEVELOPMENT_GUIDE.md

**Step 8: Clean Up Legacy Code**
- Search for remaining `new Date(date + 'T12:00:00')` patterns
- Search for remaining direct `new Date(dateString).getTime()` patterns  
- Replace any found instances with convertDateToTimestamp()
- Remove or update obsolete comments about noon time

---

## Critical Success Factors

1. **Single Source of Truth**: All date string → timestamp conversions MUST use convertDateToTimestamp()
2. **Local Time Only**: Never use UTC time for business dates (invoice dates, transaction dates)
3. **Midnight Standard**: All business dates stored at 00:00:00 local time (no noon, no arbitrary times)
4. **Import Consistency**: Every file doing date conversion must import from date-utils.ts
5. **Test Coverage**: POST and PUT operations must produce identical timestamps for same date input

## Benefits After Implementation

✅ **Ledger Merge Fix**: REFUND_ADJUSTMENT entries will merge with REFUND_RECEIVED (same timestamp)  
✅ **Timezone Safety**: India deployment will use IST correctly, no UTC conversion bugs  
✅ **Maintainability**: Single function to update if date handling logic changes  
✅ **Consistency**: All transactions use same conversion logic  
✅ **Clarity**: Code reviewers can easily verify correct date handling (import check)  
✅ **Performance**: No change - same Date API, just consistent usage
