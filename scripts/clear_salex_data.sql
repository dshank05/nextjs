-- =====================================================
-- Clear All Salex and Return Data
-- =====================================================
-- Date: 2025-03-07
-- Purpose: Delete all test data from salex and return tables
-- WARNING: This will permanently delete all data!
-- =====================================================

-- Show counts before deletion
-- =====================================================
SELECT 'Before deletion:' as Status;
SELECT 'salex_return_items' as Table_Name, COUNT(*) as Row_Count FROM salex_return_items
UNION ALL
SELECT 'salex_returns', COUNT(*) FROM salex_returns
UNION ALL
SELECT 'invoice_itemsx', COUNT(*) FROM invoice_itemsx
UNION ALL
SELECT 'invoicex', COUNT(*) FROM invoicex
UNION ALL
SELECT 'bill_tosalesx', COUNT(*) FROM bill_tosalesx
UNION ALL
SELECT 'shiptox', COUNT(*) FROM shiptox
UNION ALL
SELECT 'transport_detailsx', COUNT(*) FROM transport_detailsx;

-- Step 1: Delete salex return items first (child table)
-- =====================================================
DELETE FROM salex_return_items;

-- Step 2: Delete salex returns (parent table)
-- =====================================================
DELETE FROM salex_returns;

-- Step 3: Delete invoicex items (child table)
-- =====================================================
DELETE FROM invoice_itemsx;

-- Step 4: Delete invoicex (parent table)
-- =====================================================
DELETE FROM invoicex;

-- Step 5: Delete bill_tosalesx records
-- =====================================================
DELETE FROM bill_tosalesx;

-- Step 6: Delete shiptox records
-- =====================================================
DELETE FROM shiptox;

-- Step 7: Delete transport_detailsx records
-- =====================================================
DELETE FROM transport_detailsx;

-- Show counts after deletion
-- =====================================================
SELECT 'After deletion:' as Status;
SELECT 'salex_return_items' as Table_Name, COUNT(*) as Row_Count FROM salex_return_items
UNION ALL
SELECT 'salex_returns', COUNT(*) FROM salex_returns
UNION ALL
SELECT 'invoice_itemsx', COUNT(*) FROM invoice_itemsx
UNION ALL
SELECT 'invoicex', COUNT(*) FROM invoicex
UNION ALL
SELECT 'bill_tosalesx', COUNT(*) FROM bill_tosalesx
UNION ALL
SELECT 'shiptox', COUNT(*) FROM shiptox
UNION ALL
SELECT 'transport_detailsx', COUNT(*) FROM transport_detailsx;

SELECT 'All salex and return data deleted successfully!' as Result;
