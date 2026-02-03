-- ================================================================
-- Fix Legacy PAYMENT_ADJUSTMENT Reference ID
-- ================================================================
-- Issue: Entry 424 has wrong reference_id (87 = payment ID)
-- Should be: 168 (purchase ID) to merge with other payment entries
-- 
-- After fix: All payment entries for purchase 21 will merge into one
-- Expected result: Single payment entry showing ₹20,000 total
-- ================================================================

-- Step 1: Show BEFORE state (for verification)
SELECT 
    id,
    vendor_id,
    transaction_date,
    transaction_type,
    reference_type,
    reference_id,
    reference_no,
    debit,
    credit,
    notes
FROM vendor_ledger
WHERE 
    (id = 424 OR reference_id IN (87, 168))
    AND transaction_type IN ('PAYMENT', 'PAYMENT_ADJUSTMENT')
ORDER BY id;

-- Expected output:
-- id: 419, type: PAYMENT, reference_id: 168, credit: 10000
-- id: 424, type: PAYMENT_ADJUSTMENT, reference_id: 87, credit: 5000 ❌ WRONG
-- id: 425, type: PAYMENT_ADJUSTMENT, reference_id: 168, credit: 5000 ✅

-- Step 2: Fix the legacy entry
UPDATE vendor_ledger 
SET reference_id = 168 
WHERE id = 424 
  AND transaction_type = 'PAYMENT_ADJUSTMENT'
  AND reference_id = 87;

-- Step 3: Show AFTER state (verify the fix)
SELECT 
    id,
    vendor_id,
    transaction_date,
    transaction_type,
    reference_type,
    reference_id,
    reference_no,
    debit,
    credit,
    notes
FROM vendor_ledger
WHERE 
    reference_id = 168
    AND transaction_type IN ('PAYMENT', 'PAYMENT_ADJUSTMENT')
ORDER BY id;

-- Expected output after fix:
-- id: 419, type: PAYMENT, reference_id: 168, credit: 10000 ✅
-- id: 424, type: PAYMENT_ADJUSTMENT, reference_id: 168, credit: 5000 ✅ FIXED!
-- id: 425, type: PAYMENT_ADJUSTMENT, reference_id: 168, credit: 5000 ✅
-- Total will merge to: ₹20,000

-- Step 4: Verify merged total
SELECT 
    'Total for Purchase 168' as description,
    SUM(credit) - SUM(debit) as net_payment_amount
FROM vendor_ledger
WHERE 
    reference_id = 168
    AND transaction_type IN ('PAYMENT', 'PAYMENT_ADJUSTMENT');

-- Expected result: 20000.00

-- ================================================================
-- NOTES:
-- ================================================================
-- 1. After running this script, refresh the vendor ledger page
-- 2. You should see a single merged payment entry for ₹20,000
-- 3. Entry will show at correct chronological position (id: 419)
-- 4. Purchase 21 will appear BEFORE Payment 21 (correct order)
-- 5. All future payment edits will work correctly (fix already applied)
-- ================================================================
