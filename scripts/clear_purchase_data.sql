-- =====================================================
-- Clear All Purchase and Return Data
-- =====================================================
-- Date: 2024-11-30
-- Purpose: Delete all test data from purchase and return tables
-- WARNING: This will permanently delete all data!
-- =====================================================

-- Show counts before deletion
-- =====================================================
SELECT 'Before deletion:' as Status;
SELECT 'purchase_return_items' as Table_Name, COUNT(*) as Row_Count FROM purchase_return_items
UNION ALL
SELECT 'purchase_returns', COUNT(*) FROM purchase_returns
UNION ALL
SELECT 'purchase_items', COUNT(*) FROM purchase_items
UNION ALL
SELECT 'purchase', COUNT(*) FROM purchase
UNION ALL
SELECT 'bill_to', COUNT(*) FROM bill_to;

-- Step 1: Delete purchase return items first (child table)
-- =====================================================
DELETE FROM purchase_return_items;

-- Step 2: Delete purchase returns (parent table)
-- =====================================================
DELETE FROM purchase_returns;

-- Step 3: Delete purchase items (child table)
-- =====================================================
DELETE FROM purchase_items;

-- Step 4: Delete purchases (parent table)
-- =====================================================
DELETE FROM purchase;

-- Step 5: Delete bill_to records
-- =====================================================
DELETE FROM bill_to;

-- Show counts after deletion
-- =====================================================
SELECT 'After deletion:' as Status;
SELECT 'purchase_return_items' as Table_Name, COUNT(*) as Row_Count FROM purchase_return_items
UNION ALL
SELECT 'purchase_returns', COUNT(*) FROM purchase_returns
UNION ALL
SELECT 'purchase_items', COUNT(*) FROM purchase_items
UNION ALL
SELECT 'purchase', COUNT(*) FROM purchase
UNION ALL
SELECT 'bill_to', COUNT(*) FROM bill_to;

SELECT 'All purchase and return data deleted successfully!' as Result;
