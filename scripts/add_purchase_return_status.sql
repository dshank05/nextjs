-- Add return_status column to purchase table
-- Default value 0 (no returns) for existing records
ALTER TABLE purchase ADD COLUMN return_status INT NULL DEFAULT 0;
