-- Migration: Add Account Balance Tracking to Vendor and Customer Tables
-- Created: January 11, 2026
-- Purpose: Enable direct payments and credit management for vendors and customers

-- ============================================================================
-- VENDOR BALANCE FIELDS
-- ============================================================================

-- Add balance tracking fields to vendor_details
ALTER TABLE vendor_details
ADD COLUMN account_balance DECIMAL(10, 2) DEFAULT 0 COMMENT 'Current account balance (positive = we owe vendor, negative = vendor owes us)',
ADD COLUMN total_paid DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payments made to vendor',
ADD COLUMN total_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payment allocations to purchase bills',
ADD COLUMN total_refunded DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refunds received from vendor',
ADD COLUMN total_refund_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refund allocations to return bills',
ADD COLUMN balance_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last balance update timestamp';

-- Add index for balance queries
CREATE INDEX idx_vendor_balance ON vendor_details(account_balance);

-- ============================================================================
-- CUSTOMER BALANCE FIELDS
-- ============================================================================

-- Add balance tracking fields to customer_details
ALTER TABLE customer_details
ADD COLUMN account_balance DECIMAL(10, 2) DEFAULT 0 COMMENT 'Current account balance (positive = customer owes us, negative = we owe customer)',
ADD COLUMN total_paid DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payments received from customer',
ADD COLUMN total_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total payment allocations to sale invoices',
ADD COLUMN total_refunded DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refunds given to customer',
ADD COLUMN total_refund_allocated DECIMAL(10, 2) DEFAULT 0 COMMENT 'Total refund allocations to return bills',
ADD COLUMN balance_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last balance update timestamp';

-- Add index for balance queries
CREATE INDEX idx_customer_balance ON customer_details(account_balance);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify vendor_details columns
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    COLUMN_DEFAULT, 
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'vendor_details'
AND COLUMN_NAME IN ('account_balance', 'total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated', 'balance_updated_at');

-- Verify customer_details columns
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    COLUMN_DEFAULT, 
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'customer_details'
AND COLUMN_NAME IN ('account_balance', 'total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated', 'balance_updated_at');

-- ============================================================================
-- NOTES
-- ============================================================================

-- Balance Formula:
-- account_balance = total_paid - total_allocated - total_refunded + total_refund_allocated

-- For Vendors:
-- - Positive balance = We owe vendor (credit)
-- - Negative balance = Vendor owes us (debit)

-- For Customers:
-- - Positive balance = Customer owes us (debit)
-- - Negative balance = We owe customer (credit)

-- All existing vendor/customer records will have balance fields initialized to 0
-- Run initialization script after migration to calculate balances for existing data
