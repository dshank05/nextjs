-- Migration: Add address consistency fields to customer_details table
-- This aligns customer_details with vendor_details address structure

USE u348217822_test_v3;

-- Add new address fields to customer_details table
-- Making them match the vendor_details structure
ALTER TABLE `customer_details`
ADD COLUMN `billing_address_2` VARCHAR(255) DEFAULT NULL AFTER `billing_address`,
ADD COLUMN `shipping_address_2` VARCHAR(255) DEFAULT NULL AFTER `shipping_address`;

-- Optional: If you want to add comments for documentation
ALTER TABLE `customer_details`
ADD COMMENT 'Customer details with consistent address structure following vendor_details pattern';

-- Verification query (optional - run after migration)
-- SELECT
--     id,
--     billing_name,
--     billing_address,
--     billing_address_2,
--     shipping_address,
--     shipping_address_2
-- FROM customer_details
-- LIMIT 5;
