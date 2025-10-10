USE u348217822_test_v3;

-- Add status column to gst_tax_rate table if it doesn't exist
ALTER TABLE gst_tax_rate
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active' AFTER applicable_for;

-- Update any existing records that have NULL status to 'Active'
UPDATE gst_tax_rate
SET status = 'Active'
WHERE status IS NULL OR status = '';
