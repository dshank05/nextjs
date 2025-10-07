-- Migration: Remove capacity column from warehouse table
-- This script simplifies warehouse management by removing unused capacity field

ALTER TABLE warehouse DROP COLUMN capacity;

-- Note: Run this manually in your database or update your Prisma schema and migrate
-- The backend and frontend have been updated to not use capacity
