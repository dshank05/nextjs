-- Fix transaction_id for existing PAYMENT_ADJUSTMENT and REFUND_ADJUSTMENT entries
-- This allows them to merge correctly with their parent PAYMENT/REFUND entries in the UI

-- Update PAYMENT_ADJUSTMENT entries
-- Extract payment_id from reference_no (e.g., 'PAY-150' -> 150)
UPDATE vendor_ledger
SET transaction_id = CAST(SUBSTRING(reference_no, 5) AS UNSIGNED)
WHERE transaction_type = 'PAYMENT_ADJUSTMENT'
  AND reference_no LIKE 'PAY-%'
  AND transaction_id IS NULL;

-- Update REFUND_ADJUSTMENT entries  
-- Extract refund_id from reference_no (e.g., 'REF-150' -> 150)
UPDATE vendor_ledger
SET transaction_id = CAST(SUBSTRING(reference_no, 5) AS UNSIGNED)
WHERE transaction_type = 'REFUND_ADJUSTMENT'
  AND reference_no LIKE 'REF-%'
  AND transaction_id IS NULL;

-- Verify the updates
SELECT 
  id,
  vendor_id,
  transaction_type,
  transaction_id,
  reference_type,
  reference_id,
  reference_no,
  credit,
  notes
FROM vendor_ledger
WHERE transaction_type IN ('PAYMENT', 'PAYMENT_ADJUSTMENT', 'REFUND_RECEIVED', 'REFUND_ADJUSTMENT')
  AND vendor_id = 6  -- Arnav Motors for testing
ORDER BY id;
