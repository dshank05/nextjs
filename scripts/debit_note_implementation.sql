-- ============================================
-- DEBIT NOTE IMPLEMENTATION - DATABASE SCHEMA
-- ============================================
-- Purpose: Add debit note numbering, P&F/freight tracking, and vendor ledger
-- Date: 2025-12-05
-- Environment: Test Database

-- ============================================
-- PART 1: CREATE NEW TABLES
-- ============================================

-- Note Counters Table (for DN/CN numbering)
CREATE TABLE IF NOT EXISTS note_counters (
  id INT PRIMARY KEY AUTO_INCREMENT,
  note_type VARCHAR(20) NOT NULL,    -- 'DEBIT' or 'CREDIT'
  fy INT NOT NULL,                   -- Financial year
  last_number INT DEFAULT 0,
  UNIQUE KEY unique_note_type_fy (note_type, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vendor Ledger Table (for accounting)
CREATE TABLE IF NOT EXISTS vendor_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  vendor_id INT NOT NULL,             -- Vendor ID (0 for "other" vendors)
  transaction_date INT NOT NULL,      -- Unix timestamp
  transaction_type VARCHAR(50) NOT NULL, -- 'PURCHASE', 'DEBIT_NOTE', 'PAYMENT'
  reference_type VARCHAR(50),         -- 'purchase', 'purchase_return', 'payment'
  reference_id INT,                   -- Reference to source table ID
  reference_no VARCHAR(100),          -- Invoice no or debit note no
  payment_mode INT,                   -- Payment mode (0=Cash, 1=Bank)
  payment_status INT,                 -- Payment status
  payment_date INT,                   -- Payment date (Unix timestamp)
  debit FLOAT DEFAULT 0,              -- Debit amount (you owe vendor)
  credit FLOAT DEFAULT 0,             -- Credit amount (vendor owes you)
  balance FLOAT NOT NULL,             -- Running balance
  notes TEXT,                         -- Additional notes
  fy INT NOT NULL,                    -- Financial year
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_ledger_vendor_date (vendor_id, transaction_date),
  INDEX idx_vendor_ledger_type (transaction_type),
  INDEX idx_vendor_ledger_fy (fy),
  INDEX idx_vendor_ledger_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- PART 2: EXTEND PURCHASE_RETURNS TABLE
-- ============================================

-- Add debit note numbering fields
ALTER TABLE purchase_returns 
  ADD COLUMN IF NOT EXISTS debit_note_no VARCHAR(50) AFTER id,
  ADD COLUMN IF NOT EXISTS note_type VARCHAR(20) DEFAULT 'DEBIT' AFTER debit_note_no;

-- Add P&F and freight feature flags
ALTER TABLE purchase_returns 
  ADD COLUMN IF NOT EXISTS include_packing_forwarding TINYINT DEFAULT 0 AFTER note_type,
  ADD COLUMN IF NOT EXISTS include_freight TINYINT DEFAULT 0 AFTER include_packing_forwarding,
  ADD COLUMN IF NOT EXISTS pf_calculation_method TINYINT DEFAULT 3 AFTER include_freight,
  ADD COLUMN IF NOT EXISTS freight_calculation_method TINYINT DEFAULT 3 AFTER pf_calculation_method;

-- Add P&F and freight amount fields
ALTER TABLE purchase_returns 
  ADD COLUMN IF NOT EXISTS packing_forwarding_amount DECIMAL(10,2) DEFAULT 0 AFTER freight_calculation_method,
  ADD COLUMN IF NOT EXISTS freight_amount DECIMAL(10,2) DEFAULT 0 AFTER packing_forwarding_amount;

-- Add index for debit note lookups
ALTER TABLE purchase_returns 
  ADD INDEX IF NOT EXISTS idx_purchase_returns_debit_note (debit_note_no);

-- ============================================
-- NOTE: NO VIRTUAL VENDOR NEEDED
-- ============================================
-- vendor_id = 0 is used directly for "other/cash" vendors
-- No need to insert virtual vendor with id = -1

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify note_counters table
SELECT 'note_counters table created' AS status;
SHOW COLUMNS FROM note_counters;

-- Verify vendor_ledger table
SELECT 'vendor_ledger table created' AS status;
SHOW COLUMNS FROM vendor_ledger;

-- Verify purchase_returns table updates
SELECT 'purchase_returns table extended' AS status;
SHOW COLUMNS FROM purchase_returns;

-- ============================================
-- NOTES
-- ============================================
-- 1. vendor_id = 0 represents "other/cash" vendors (no virtual vendor needed)
-- 2. pf_calculation_method: 3=proportional, 4=full
-- 3. freight_calculation_method: 3=proportional, 4=full
-- 4. Ledger tracks double-entry accounting: debit (you owe) / credit (they owe)
-- 5. Debit note format: DN-{FY}-{NUMBER} (e.g., DN-2025-001)
