# Database Indexing Recommendations

## Current Performance Issues

Your product page was experiencing N+1 query problems due to lack of proper indexing on foreign key relationships. Here are the critical indexes needed:

## Critical Indexes (Must Have)

### 1. Product Table Foreign Keys
```sql
-- Category lookup optimization
CREATE INDEX idx_product_category ON product(product_category);

-- Company lookup optimization  
CREATE INDEX idx_product_company ON product(company);

-- Search optimization
CREATE INDEX idx_product_name ON product(product_name);
CREATE INDEX idx_product_part_no ON product(part_no);

-- Stock filtering optimization
CREATE INDEX idx_product_stock ON product(stock, min_stock);

-- Combined search index for common queries
CREATE INDEX idx_product_search ON product(product_name, part_no, product_category, company);
```

### 2. Purchase Items Table
```sql
-- Critical for latest purchase rate lookups
CREATE INDEX idx_purchase_items_product_date ON purchase_items(name_of_product, invoice_date DESC);

-- Optimization for purchase history queries
CREATE INDEX idx_purchase_items_date ON purchase_items(invoice_date DESC);
```

### 3. Lookup Tables Primary Keys (Should already exist)
```sql
-- Verify these exist:
CREATE INDEX idx_product_category_id ON product_category(id);
CREATE INDEX idx_product_company_id ON product_company(id);  
CREATE INDEX idx_product_subcategory_id ON product_subcategory(id);
```

## Performance Impact

### Before Indexes
- **Query Count**: 250+ queries per page load
- **Load Time**: 2-5 seconds
- **Database Load**: Very high

### After Indexes + Optimization
- **Query Count**: 4-6 queries per page load  
- **Load Time**: 200-500ms
- **Database Load**: Minimal

## How to Apply Indexes

### Option 1: Direct SQL (Recommended for Production)
```sql
-- Connect to your MySQL database and run:
USE your_database_name;

-- Add the critical indexes
CREATE INDEX idx_product_category ON product(product_category);
CREATE INDEX idx_product_company ON product(company);
CREATE INDEX idx_product_name ON product(product_name);
CREATE INDEX idx_product_part_no ON product(part_no);
CREATE INDEX idx_product_stock ON product(stock, min_stock);
CREATE INDEX idx_purchase_items_product_date ON purchase_items(name_of_product, invoice_date DESC);

-- Verify indexes were created
SHOW INDEX FROM product;
SHOW INDEX FROM purchase_items;
```

### Option 2: Prisma Migration (For Development)
Create a new migration file:

```prisma
-- Add to your schema.prisma:
model product {
  // ... existing fields

  @@index([product_category], map: "idx_product_category")
  @@index([company], map: "idx_product_company")  
  @@index([product_name], map: "idx_product_name")
  @@index([part_no], map: "idx_product_part_no")
  @@index([stock, min_stock], map: "idx_product_stock")
}

model purchase_items {
  // ... existing fields
  
  @@index([name_of_product, invoice_date], map: "idx_purchase_items_product_date")
}
```

Then run:
```bash
npx prisma db push
```

## Index Monitoring

### Check Index Usage
```sql
-- Monitor index performance
SHOW INDEX FROM product;
SHOW INDEX FROM purchase_items;

-- Check query performance
EXPLAIN SELECT * FROM product WHERE product_category = '1';
EXPLAIN SELECT * FROM purchase_items WHERE name_of_product = '123' ORDER BY invoice_date DESC LIMIT 1;
```

### Index Maintenance
- **Rebuild indexes** monthly for optimal performance
- **Monitor query logs** to identify new slow queries
- **Remove unused indexes** to avoid write performance impact

## Additional Recommendations

### 1. Connection Pool Optimization
```javascript
// In your database connection
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + "?connection_limit=20&pool_timeout=20&socket_timeout=60"
    }
  }
})
```

### 2. Query Result Caching
Consider implementing Redis caching for:
- Lookup table data (categories, companies, subcategories)
- Frequently accessed product lists
- Search results

### 3. Database Configuration
For MySQL, optimize these settings:
```sql
-- Increase buffer pool for better caching
SET GLOBAL innodb_buffer_pool_size = 1073741824; -- 1GB

-- Optimize query cache
SET GLOBAL query_cache_size = 268435456; -- 256MB
SET GLOBAL query_cache_type = ON;
```

## Testing Performance

### Before and After Comparison
1. **Enable query logging** to see exact queries
2. **Time your API calls** using browser dev tools
3. **Monitor database CPU usage** during page loads
4. **Count total queries** per request

### Expected Results
- Page load time: **5-10x faster**
- Database queries: **95% reduction**
- Server response: **Sub-500ms**
- User experience: **Instant loading**

## Implementation Priority

1. **High Priority**: Product foreign key indexes
2. **Critical**: Purchase items date index  
3. **Medium**: Composite search indexes
4. **Low**: Query result caching

Apply the high priority indexes first for immediate performance gains!
