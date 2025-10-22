-- =========================================
-- COMPLETE TRANSACTION DATA CLEANUP SCRIPT
-- =========================================
-- This script deletes ALL transaction-related data
-- to resolve mixed date format issues
-- =========================================

USE u348217822_test_v3;

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- =========================================
-- STEP 1: Delete return items first
-- =========================================
DELETE FROM purchase_return_items;
DELETE FROM sale_return_items;
DELETE FROM salex_return_items;

-- =========================================
-- STEP 2: Delete return transactions
-- =========================================
DELETE FROM purchase_returns;
DELETE FROM sale_returns;
DELETE FROM salex_returns;

-- =========================================
-- STEP 3: Delete transaction supplementary data
-- =========================================
DELETE FROM shipto;
DELETE FROM shiptox;
DELETE FROM bill_to;
DELETE FROM bill_tosales;
DELETE FROM bill_tosalesx;
DELETE FROM transport_details;
DELETE FROM transport_detailsx;
DELETE FROM incexp;
DELETE FROM incexpx;

-- =========================================
-- STEP 4: Delete transaction items
-- =========================================
DELETE FROM purchase_items;
DELETE FROM invoice_items;
DELETE FROM invoice_itemsx;

-- =========================================
-- STEP 5: Delete main transactions
-- =========================================
DELETE FROM purchase;
DELETE FROM invoice;
DELETE FROM invoicex;

-- =========================================
-- STEP 6: Delete products (referenced by transaction items)
-- =========================================
DELETE FROM product;

-- =========================================
-- Re-enable foreign key checks
-- =========================================
SET FOREIGN_KEY_CHECKS = 1;

-- =========================================
-- VERIFICATION QUERIES
-- =========================================
SELECT
  (SELECT COUNT(*) FROM product) as products_count,
  (SELECT COUNT(*) FROM purchase) as purchase_count,
  (SELECT COUNT(*) FROM invoice) as invoice_count,
  (SELECT COUNT(*) FROM invoicex) as invoicex_count,
  (SELECT COUNT(*) FROM purchase_items) as purchase_items_count,
  (SELECT COUNT(*) FROM invoice_items) as invoice_items_count,
  (SELECT COUNT(*) FROM invoice_itemsx) as invoice_itemsx_count,
  (SELECT COUNT(*) FROM purchase_returns) as purchase_returns_count,
  (SELECT COUNT(*) FROM sale_returns) as sale_returns_count,
  (SELECT COUNT(*) FROM salex_returns) as salex_returns_count;

-- =========================================
-- END OF CLEANUP SCRIPT
-- =========================================
