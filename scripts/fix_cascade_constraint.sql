-- =====================================================
-- Fix CASCADE Constraint on purchase table
-- =====================================================
-- Date: 2024-11-30
-- Purpose: Remove UPDATE CASCADE from vendor foreign key
-- =====================================================

-- Step 1: Find the actual constraint name
-- =====================================================
SELECT 
    CONSTRAINT_NAME,
    TABLE_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'u348217822_test_v3'
    AND TABLE_NAME = 'purchase'
    AND COLUMN_NAME = 'vendor_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL;

-- Step 2: Drop the constraint
-- =====================================================
-- Replace 'purchase_vendor_id_fkey' with the actual constraint name from above if different
-- Common names: purchase_vendor_id_fkey, purchase_ibfk_1, purchase_vendor_fkey, fk_purchase_vendor

-- Try common names (comment out the ones that don't work):
-- ALTER TABLE purchase DROP FOREIGN KEY purchase_vendor_id_fkey;
-- ALTER TABLE purchase DROP FOREIGN KEY purchase_vendor_fkey;
-- ALTER TABLE purchase DROP FOREIGN KEY purchase_ibfk_1;
-- ALTER TABLE purchase DROP FOREIGN KEY fk_purchase_vendor;

-- Step 3: Add constraint without UPDATE CASCADE
-- =====================================================
-- Uncomment after successfully dropping the old constraint:
-- ALTER TABLE purchase 
-- ADD CONSTRAINT purchase_vendor_fkey 
-- FOREIGN KEY (vendor_id) 
-- REFERENCES vendor_details(id) 
-- ON DELETE SET NULL 
-- ON UPDATE NO ACTION;

SELECT 'Instructions: Run Step 1 first, then use the constraint name to drop it in Step 2, then run Step 3' as Instructions;
