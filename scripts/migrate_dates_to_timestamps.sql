-- Data Migration Script: Convert Date Strings to Unix Timestamps
-- This script migrates existing date string values to Unix timestamps
-- Run this AFTER changing schema.prisma and generating Prisma migration

-- =====================================================
-- IMPORTANT: BACKUP YOUR DATABASE BEFORE RUNNING THIS
-- =====================================================

-- Step 1: Convert Purchase invoice_date from date strings to Unix timestamps
-- Handle various date formats: 'YYYY-MM-DD', 'DD/MM/YYYY', etc.
UPDATE purchase
SET invoice_date = CASE
    -- If it's already a Unix timestamp (numeric string > 1000000000), convert to INT
    WHEN invoice_date REGEXP '^[0-9]+$' AND CAST(invoice_date AS UNSIGNED) > 1000000000
    THEN CAST(invoice_date AS UNSIGNED)
    -- If it's a date string like '2025-10-22' or '2025/10/22'
    WHEN invoice_date REGEXP '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$'
    THEN UNIX_TIMESTAMP(STR_TO_DATE(invoice_date, '%Y-%m-%d'))
    -- If it's DD/MM/YYYY format
    WHEN invoice_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
    THEN UNIX_TIMESTAMP(STR_TO_DATE(invoice_date, '%d/%m/%Y'))
    -- Fallback: try to parse as date and convert
    ELSE UNIX_TIMESTAMP(invoice_date)
END
WHERE invoice_date IS NOT NULL AND invoice_date != '';

-- Step 2: Convert Purchase Returns return_date from date strings to Unix timestamps
UPDATE purchase_returns
SET return_date = CASE
    -- If it's already a Unix timestamp (numeric string > 1000000000), convert to INT
    WHEN return_date REGEXP '^[0-9]+$' AND CAST(return_date AS UNSIGNED) > 1000000000
    THEN CAST(return_date AS UNSIGNED)
    -- If it's a date string like '2025-10-22' or '2025/10/22'
    WHEN return_date REGEXP '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$'
    THEN UNIX_TIMESTAMP(STR_TO_DATE(return_date, '%Y-%m-%d'))
    -- If it's DD/MM/YYYY format
    WHEN return_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
    THEN UNIX_TIMESTAMP(STR_TO_DATE(return_date, '%d/%m/%Y'))
    -- Fallback: try to parse as date and convert
    ELSE UNIX_TIMESTAMP(return_date)
END
WHERE return_date IS NOT NULL AND return_date != '';

-- Step 3: Verify the changes
-- Check a sample of purchase records
SELECT
    id,
    invoice_no,
    invoice_date,
    FROM_UNIXTIME(invoice_date, '%Y-%m-%d %H:%i:%s') as readable_date
FROM purchase
ORDER BY id DESC
LIMIT 5;

-- Check a sample of purchase return records
SELECT
    id,
    purchase_id,
    return_date,
    FROM_UNIXTIME(return_date, '%Y-%m-%d %H:%i:%s') as readable_date
FROM purchase_returns
ORDER BY id DESC
LIMIT 5;

-- =====================================================
-- RUN THIS IN PRISMA STUDIO TO VERIFY:
-- =====================================================
-- 1. SELECT * FROM purchase WHERE invoice_date IS NOT NULL LIMIT 10;
-- 2. SELECT * FROM purchase_returns WHERE return_date IS NOT NULL LIMIT 10;
-- 3. Confirm all values are now integers (Unix timestamps)

-- =====================================================
-- TO REVERT THE CHANGES (if needed):
-- =====================================================
-- UPDATE purchase SET invoice_date = DATE_FORMAT(FROM_UNIXTIME(invoice_date), '%Y-%m-%d')
--   WHERE invoice_date IS NOT NULL;
-- UPDATE purchase_returns SET return_date = DATE_FORMAT(FROM_UNIXTIME(return_date), '%Y-%m-%d')
--   WHERE return_date IS NOT NULL;
