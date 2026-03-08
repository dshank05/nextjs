-- =====================================================
-- Clear All Sale and Return Data
-- =====================================================
-- Date: 2025-03-07
-- Purpose: Delete all test data from sale and return tables
-- WARNING: This will permanently delete all data!
-- =====================================================

-- Show counts before deletion
-- =====================================================
SELECT 'Before deletion:' as Status;
SELECT 'sale_return_items' as Table_Name, COUNT(*) as Row_Count FROM sale_return_items
UNION ALL
SELECT 'sale_returns', COUNT(*) FROM sale_returns
UNION ALL
SELECT 'invoiceitems', COUNT(*) FROM invoiceitems
UNION ALL
SELECT 'invoice', COUNT(*) FROM invoice
UNION ALL
SELECT 'bill_tosales', COUNT(*) FROM bill_tosales
UNION ALL
SELECT 'shipto', COUNT(*) FROM shipto;

-- Step 1: Delete sale return items first (child table)
-- =====================================================
DELETE FROM sale_return_items;

-- Step 2: Delete sale returns (parent table)
-- =====================================================
DELETE FROM sale_returns;

-- Step 3: Delete invoice items (child table)
-- =====================================================
DELETE FROM invoiceitems;

-- Step 4: Delete invoices (parent table)
-- =====================================================
DELETE FROM invoice;

-- Step 5: Delete bill_tosales records
-- =====================================================
DELETE FROM bill_tosales;

-- Step 6: Delete shipto records
-- =====================================================
DELETE FROM shipto;

-- Show counts after deletion
-- =====================================================
SELECT 'After deletion:' as Status;
SELECT 'sale_return_items' as Table_Name, COUNT(*) as Row_Count FROM sale_return_items
UNION ALL
SELECT 'sale_returns', COUNT(*) FROM sale_returns
UNION ALL
SELECT 'invoiceitems', COUNT(*) FROM invoiceitems
UNION ALL
SELECT 'invoice', COUNT(*) FROM invoice
UNION ALL
SELECT 'bill_tosales', COUNT(*) FROM bill_tosales
UNION ALL
SELECT 'shipto', COUNT(*) FROM shipto;

SELECT 'All sale and return data deleted successfully!' as Result;
