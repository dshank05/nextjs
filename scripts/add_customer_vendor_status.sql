-- Migration script to add status field to customer_details and vendor_details
-- and set all existing records to "Active"

-- Add status column to customer_details if it doesn't exist
ALTER TABLE customer_details
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active' NOT NULL;

-- Add phone columns to customer_details if they don't exist
ALTER TABLE customer_details
ADD COLUMN IF NOT EXISTS contact_no_2 VARCHAR(20),
ADD COLUMN IF NOT EXISTS contact_no_3 VARCHAR(20);

-- Set all existing customer records to "Active"
UPDATE customer_details
SET status = 'Active'
WHERE status IS NULL OR status = '';

-- Add status column to vendor_details if it doesn't exist
ALTER TABLE vendor_details
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active' NOT NULL;

-- Add phone columns to vendor_details if they don't exist
ALTER TABLE vendor_details
ADD COLUMN IF NOT EXISTS contact_no_2 VARCHAR(20),
ADD COLUMN IF NOT EXISTS contact_no_3 VARCHAR(20);

-- Set all existing vendor records to "Active"
UPDATE vendor_details
SET status = 'Active'
WHERE status IS NULL OR status = '';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_status ON customer_details(status);
CREATE INDEX IF NOT EXISTS idx_vendor_status ON vendor_details(status);
