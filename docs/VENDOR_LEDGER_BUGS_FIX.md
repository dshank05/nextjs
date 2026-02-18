# 🐛 Vendor Ledger Bugs - Complete Analysis & Fix

**Date:** February 17, 2026  
**Reported By:** User in India (IST timezone)  
**Severity:** 🔴 CRITICAL (Bug #2) | 🟡 MEDIUM (Bug #1)

---

## Summary

Two critical bugs discovered in vendor ledger system:
1. **Bug #1:** formattedDate showing 1 day older (timezone display issue)
2. **Bug #2:** Missing ledger entry + date corruption (day/month swap causing May 2027 date)

---

## Bug #1: formattedDate 1 Day Older (Timezone Display Issue)

### Location
`pages/api/reports/vendor-ledger-accounting.ts` - Line 84

### Current Code
```typescript
formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN'),
```

### Problem
- User in India (IST, UTC+5:30) enters date: **18/2/2026**
- Timestamp stored: `1771304400` (Feb 17, 2026 5:00 AM UTC)
- Server (EST, UTC-5) creates Date object in **server's timezone** → Feb 17, 2026 12:00 AM EST
- `.toLocaleDateString('en-IN')` only changes the **FORMAT** (dd/mm/yyyy) but NOT the timezone
- Result: Shows **17/2/2026** ❌ instead of **18/2/2026** ✅

### Why It Happens
- The timestamp `1771304400` represents: **2026-02-17T05:00:00.000Z (UTC)**
- When converted in EST timezone: Feb 17, 12:00 AM EST
- When converted in IST timezone: Feb 17, 10:30 AM IST
- The `.toLocaleDateString('en-IN')` only affects format, not timezone conversion

### Fix
```typescript
formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN', { 
  timeZone: 'Asia/Kolkata' 
}),
```

### Severity
🟡 **MEDIUM** - Display issue only, no data corruption

---

## Bug #2: 🔥 CRITICAL - Date Corruption in Edit Mode

### Location
`pages/entry/vendor-transaction.tsx` - Lines 323-326

### The Smoking Gun Code
```typescript
// Line 323-326 - WRONG!
const dateTimestamp = isExpense ? transaction.payment_date : transaction.refund_date
const dateObj = new Date(dateTimestamp * 1000)
const formattedDate = dateObj.toLocaleDateString('en-IN')
const [month, day, year] = formattedDate.split('/').map(n => n.padStart(2, '0'))  // ❌ WRONG ORDER
setDate(`${year}-${month}-${day}`)
```

### What's Happening - Step by Step
1. **Input:** `dateTimestamp = 1771304400` (Feb 17, 2026)
2. **Format:** `formattedDate = dateObj.toLocaleDateString('en-IN')` → `"17/2/2026"` (dd/mm/yyyy format)
3. **Split:** `formattedDate.split('/')` → `["17", "2", "2026"]`
4. **WRONG DESTRUCTURING:** `[month, day, year]` = `["17", "2", "2026"]`
   - month = "17" ❌ (should be "2")
   - day = "2" ❌ (should be "17")  
   - year = "2026" ✅
5. **Construct Date:** `${year}-${month}-${day}` = `"2026-17-02"` ❌❌❌
6. **JavaScript Interprets:** `Date("2026-17-02")` = **May 2, 2027** (month overflow)

### Math Behind the Overflow
- `2026-17-02` means: Start at Jan 2026, add 16 months (17th month = 0-indexed 16), add 2 days
- January 2026 + 16 months = May 2027
- Result: **May 2, 2027** with timestamp `1809230400`

### Why May 2027 Appeared in Database
The user entered **Feb 18, 2026** initially, but when they EDITED the transaction:
1. System loaded the correct date: Feb 17/18, 2026
2. The destructuring bug swapped day "17" or "18" with month "2"
3. Day "17" became month "17" → overflow to May 2027
4. When saved, it stored this corrupted date `1809230400`
5. This date falls OUTSIDE the default date filter (Feb 2026) → Entry disappeared from ledger

### Why Entry Was Missing
- Entry 753: `transaction_date = 1771304400` (Feb 17, 2026) ✅ Shows in ledger
- Entry 754: `transaction_date = 1809230400` (May 2, 2027) ❌ Filtered out by default date range
- Frontend (vendor-ledger.tsx) sets default filter to **current month** (Feb 1-28, 2026)
- Entry 754 with May 2027 date is outside this range → Not visible

### Fix
```typescript
// Line 326 - CORRECT ORDER
const [day, month, year] = formattedDate.split('/').map(n => n.padStart(2, '0'))  // ✅ CORRECT
setDate(`${year}-${month}-${day}`)
```

### Severity
🔴 **CRITICAL** - Causes data corruption on every edit

---

## Raw Data Analysis

### Entry 753 (Visible)
```json
{
  "id": 753,
  "transaction_date": 1771304400,
  "transaction_type": "PURCHASE",
  "debit": 5000,
  "created_at": "2026-02-18T01:56:43.216Z"
}
```
- Date: Feb 17, 2026 (within Feb 2026 range) ✅
- Shows in API response ✅

### Entry 754 (Missing from Response)
```json
{
  "id": 754,
  "transaction_date": 1809230400,
  "transaction_type": "PAYMENT",
  "credit": 10000,
  "created_at": "2026-02-18T01:56:47.241Z",
  "updated_at": "2026-02-18T01:57:40.180Z"  // Recently edited!
}
```
- Date: May 2, 2027 (OUTSIDE Feb 2026 range) ❌
- Filtered out by date query ❌
- The `updated_at` shows it was edited just before the bug was reported
- This edit likely triggered the Bug #2 date corruption

---

## THE FIXES

### Fix #1: Timezone Display (vendor-ledger-accounting.ts)
```typescript
// Line 84 - Add timeZone parameter
formattedDate: new Date(entry.transaction_date * 1000).toLocaleDateString('en-IN', { 
  timeZone: 'Asia/Kolkata' 
}),
```

### Fix #2: Day/Month Swap (vendor-transaction.tsx)
```typescript
// Line 326 - Correct destructuring order
const [day, month, year] = formattedDate.split('/').map(n => n.padStart(2, '0'))
setDate(`${year}-${month}-${day}`)
```

---

## Impact Assessment

### Bug #2 Impact: 🔴 CRITICAL
- **Data Corruption:** Every transaction edit changes the date incorrectly
- **Silent Failure:** No error shown, but date becomes wrong
- **Cascade Effect:** Wrong dates cause filtering issues (entries disappear)
- **Affected:** ALL transaction edits since this code was deployed
- **User Impact:** Ledger entries go "missing" due to date being pushed to future years

### Bug #1 Impact: 🟡 MEDIUM  
- **Display Issue:** Shows wrong date to users in different timezones
- **No Corruption:** Data is stored correctly, just displayed incorrectly
- **Timezone Dependent:** Only affects users when server timezone ≠ user timezone

---

## Action Required

### Immediate Actions
1. ✅ **IMMEDIATE:** Fix Bug #2 to stop data corruption
2. ✅ **HIGH PRIORITY:** Fix Bug #1 for correct display
3. ⚠️ **Data Audit:** Check all vendor_ledger entries for corrupted dates (dates in future years)
4. 📢 **User Communication:** Inform users to review recently edited transactions

### Data Cleanup Query
```sql
-- Find entries with dates in future (likely corrupted)
SELECT * FROM vendor_ledger 
WHERE transaction_date > UNIX_TIMESTAMP('2027-01-01')
ORDER BY transaction_date DESC;

-- Check for month overflow patterns (month > 12 after conversion)
SELECT 
  id,
  transaction_date,
  FROM_UNIXTIME(transaction_date) as date_display,
  updated_at
FROM vendor_ledger 
WHERE updated_at > '2026-02-01'  -- Recently edited
  AND transaction_date > UNIX_TIMESTAMP('2026-12-31')
ORDER BY updated_at DESC;
```

---

## Testing Checklist

### After Fix Deployment
- [ ] Edit a transaction with date **Feb 18, 2026**
- [ ] Verify it saves as **Feb 18, 2026** (not May 2027)
- [ ] Verify ledger displays correct date for IST users
- [ ] Test with date **31/12/2026** (edge case)
- [ ] Test with date **01/01/2026** (edge case)
- [ ] Clear date filters and verify all entries appear
- [ ] Test from different timezones (EST, IST, UTC)
- [ ] Verify Entry 754 appears after removing date filter

### Regression Testing
- [ ] Create new transaction → Verify correct date
- [ ] Edit transaction → Verify date stays correct
- [ ] View in ledger → Verify date displays correctly
- [ ] Export ledger → Verify dates in export are correct

---

## Root Cause Summary

**Bug #1:** Missing `timeZone` parameter in date formatting  
**Bug #2:** Incorrect destructuring order - swapping day and month from dd/mm/yyyy format

Both bugs stem from **timezone and date format handling** inconsistencies between:
- Indian date format (dd/mm/yyyy)
- ISO format for HTML inputs (yyyy-mm-dd)
- Server timezone (EST) vs User timezone (IST)

## Prevention

- ✅ Use `getLocalDateString()` utility for consistent local date handling
- ✅ Always specify `timeZone` when formatting dates for display
- ✅ Document date format expectations (dd/mm/yyyy vs mm/dd/yyyy)
- ✅ Add unit tests for date conversions across timezones
- ✅ Add validation to catch impossible dates (month > 12, day > 31)
