-- Fix vendor AB123 balance after deletion
UPDATE vendor_details 
SET 
  total_allocated = 0,
  account_balance = 10000
WHERE id = 23;
