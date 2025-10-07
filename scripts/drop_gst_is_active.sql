-- Migration: Remove is_active column from gst_tax_rate table
-- This script simplifies GST rate management by removing soft delete functionality

ALTER TABLE gst_tax_rate DROP COLUMN is_active;

-- Note: Run this manually in your database or update your Prisma schema and migrate
-- The backend and frontend have been updated to not use is_active
