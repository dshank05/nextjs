-- =====================================================
-- Add Payment Tracking to Return Tables
-- Drop Unused return_transactions Table
-- =====================================================
-- Date: 2024-11-30
-- Purpose: Add payment status tracking to all return tables
--          and remove unused return_transactions table
-- =====================================================

-- Step 1: Add payment tracking fields to purchase_returns
-- =====================================================
ALTER TABLE purchase_returns 
ADD COLUMN payment_status INT DEFAULT 0 COMMENT '0=Unpaid/Pending Refund, 1=Paid/Refunded',
ADD COLUMN payment_mode INT DEFAULT 1 COMMENT '0=Cash, 1=Bank',
ADD COLUMN payment_date INT NULL COMMENT 'Unix timestamp when refund received',
ADD COLUMN refund_amount FLOAT NULL COMMENT 'Total refund amount (calculated from items)';

-- Set refund_amount equal to total_amount for existing records
UPDATE purchase_returns 
SET refund_amount = total_amount 
WHERE refund_amount IS NULL;

-- Step 2: Add payment tracking fields to sale_returns
-- =====================================================
ALTER TABLE sale_returns 
ADD COLUMN payment_status INT DEFAULT 0 COMMENT '0=Unpaid/Not Refunded, 1=Paid/Refunded to Customer',
ADD COLUMN payment_mode INT DEFAULT 1 COMMENT '0=Cash, 1=Bank',
ADD COLUMN payment_date INT NULL COMMENT 'Unix timestamp when customer refunded',
ADD COLUMN refund_amount FLOAT NULL COMMENT 'Total refund amount (calculated from items)';

-- Set refund_amount equal to total_amount for existing records
UPDATE sale_returns 
SET refund_amount = total_amount 
WHERE refund_amount IS NULL;

-- Step 3: Add payment tracking fields to salex_returns
-- =====================================================
ALTER TABLE salex_returns 
ADD COLUMN payment_status INT DEFAULT 0 COMMENT '0=Unpaid/Not Refunded, 1=Paid/Refunded to Customer',
ADD COLUMN payment_mode INT DEFAULT 1 COMMENT '0=Cash, 1=Bank',
ADD COLUMN payment_date INT NULL COMMENT 'Unix timestamp when customer refunded',
ADD COLUMN refund_amount FLOAT NULL COMMENT 'Total refund amount (calculated from items)';

-- Set refund_amount equal to total_amount for existing records
UPDATE salex_returns 
SET refund_amount = total_amount 
WHERE refund_amount IS NULL;

-- Step 4: Add indexes for better query performance
-- =====================================================
CREATE INDEX idx_purchase_returns_payment_status ON purchase_returns(payment_status);
CREATE INDEX idx_sale_returns_payment_status ON sale_returns(payment_status);
CREATE INDEX idx_salex_returns_payment_status ON salex_returns(payment_status);

-- Step 5: Drop unused return_transactions table
-- =====================================================
-- IMPORTANT: Verify this table is not referenced in any code before dropping!
-- Check for any references in your codebase first
DROP TABLE IF EXISTS return_transactions;

-- =====================================================
-- Verification Queries (Run these after migration)
-- =====================================================

-- Check purchase_returns structure
-- DESCRIBE purchase_returns;

-- Check sale_returns structure
-- DESCRIBE sale_returns;

-- Check salex_returns structure
-- DESCRIBE salex_returns;

-- Count records with NULL refund_amount (should be 0)
-- SELECT 
--   (SELECT COUNT(*) FROM purchase_returns WHERE refund_amount IS NULL) as purchase_nulls,
--   (SELECT COUNT(*) FROM sale_returns WHERE refund_amount IS NULL) as sale_nulls,
--   (SELECT COUNT(*) FROM salex_returns WHERE refund_amount IS NULL) as salex_nulls;

-- Sample data check
-- SELECT id, total_amount, refund_amount, payment_status, payment_mode 
-- FROM purchase_returns 
-- LIMIT 5;

-- =====================================================
-- Rollback Script (Keep this safe, just in case)
-- =====================================================
-- To rollback this migration, run:
--
-- ALTER TABLE purchase_returns 
-- DROP COLUMN payment_status,
-- DROP COLUMN payment_mode,
-- DROP COLUMN payment_date,
-- DROP COLUMN refund_amount;
--
-- ALTER TABLE sale_returns 
-- DROP COLUMN payment_status,
-- DROP COLUMN payment_mode,
-- DROP COLUMN payment_date,
-- DROP COLUMN refund_amount;
--
-- ALTER TABLE salex_returns 
-- DROP COLUMN payment_status,
-- DROP COLUMN payment_mode,
-- DROP COLUMN payment_date,
-- DROP COLUMN refund_amount;
--
-- Recreate return_transactions table if needed
-- (Refer to original schema)
-- =====================================================
