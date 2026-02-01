-- Performance Indexes for Purchase Returns API
-- Run this to speed up purchase return GET operations by 2-5x

-- Index for fetching return items by return_id
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id 
ON purchase_return_items(purchase_return_id);

-- Index for fetching purchase items by invoice_no (used heavily in return edit)
CREATE INDEX IF NOT EXISTS idx_purchaseitems_invoice_no 
ON purchaseitems(invoice_no);

-- Index for fetching purchase by invoice_no
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_no 
ON purchase(invoice_no);

-- Index for return items groupBy operations (already returned quantities)
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item_id 
ON purchase_return_items(purchase_item_id);

-- Verify indexes were created
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND (
    indexname LIKE 'idx_purchase_return%' 
    OR indexname LIKE 'idx_purchaseitems_invoice%'
    OR indexname LIKE 'idx_purchase_invoice%'
)
ORDER BY tablename, indexname;
