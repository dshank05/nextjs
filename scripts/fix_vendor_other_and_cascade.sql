-- =====================================================
-- Fix "Other" Vendor Issue
-- =====================================================
-- Date: 2024-11-30
-- Purpose: Create vendor record with id=0 for "Other" option
-- =====================================================

-- Create "Other" vendor record with id=0
-- =====================================================
INSERT INTO vendor_details (id, vendor_name, status, address, city, state) 
VALUES (0, 'Other', 'Active', 'Manual Entry', 'Manual Entry', 'Uttar Pradesh')
ON DUPLICATE KEY UPDATE 
  vendor_name = 'Other',
  status = 'Active';

-- Verify the vendor was created
-- =====================================================
SELECT 'Vendor with id=0 created successfully!' as Status;
SELECT id, vendor_name, status, address, city, state FROM vendor_details WHERE id = 0;
