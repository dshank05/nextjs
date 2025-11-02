-- Add critical database indexes for performance optimization
-- Based on DATABASE_INDEXES.md documentation

USE your_database_name;

-- Product table indexes
CREATE INDEX IF NOT EXISTS idx_product_category ON product(product_category_id);
CREATE INDEX IF NOT EXISTS idx_product_company ON product(company_id);
CREATE INDEX IF NOT EXISTS idx_product_name ON product(product_name);
CREATE INDEX IF NOT EXISTS idx_product_part_no ON product(part_no);
CREATE INDEX IF NOT EXISTS idx_product_stock ON product(stock, min_stock);
CREATE INDEX IF NOT EXISTS idx_product_active ON product(is_active);
CREATE INDEX IF NOT EXISTS idx_product_category_active_name ON product(product_category_id, is_active, product_name);

-- Purchase items table indexes (critical for rate lookups)
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_date ON purchase_items(product_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_date ON purchase_items(invoice_date DESC);

-- Lookup table indexes (should already exist but verify)
CREATE INDEX IF NOT EXISTS idx_product_category_id ON product_category(id);
CREATE INDEX IF NOT EXISTS idx_product_company_id ON product_company(id);
CREATE INDEX IF NOT EXISTS idx_product_subcategory_id ON product_subcategory(id);

-- Verify indexes were created
SHOW INDEX FROM product;
SHOW INDEX FROM purchase_items;
