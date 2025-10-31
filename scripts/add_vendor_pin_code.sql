-- Add pin_code column to vendor_details table
ALTER TABLE `vendor_details`
ADD COLUMN `pin_code` VARCHAR(20) NULL AFTER `city`;
