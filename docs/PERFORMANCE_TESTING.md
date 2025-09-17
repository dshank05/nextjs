# Performance Testing Guide

## Testing Your Optimizations

After implementing the database optimizations, use this guide to verify the performance improvements.

## Before vs After Comparison

### Original Performance Issues
- **250+ database queries** per page load
- **2-5 seconds** load time
- **High CPU usage** on database server
- **Poor user experience** with slow loading

### Expected After Optimization  
- **4-6 database queries** per page load
- **200-500ms** load time
- **Minimal database load**
- **Instant page loading**

## Testing Steps

### 1. Enable Query Logging (Development)
Add this to your `.env.local` to see all SQL queries:
```bash
DATABASE_URL="mysql://user:password@host:port/database?connection_limit=10"
# Add Prisma query logging
PRISMA_LOG_QUERIES=true
```

Or modify your `lib/db.ts`:
```typescript
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
})
```

### 2. Browser Testing

#### Network Tab Analysis
1. Open **Chrome DevTools** (F12)
2. Go to **Network** tab
3. Navigate to `/products` page
4. Check the **API call timing**:
   - Look for `/api/products/optimized` request
   - Response time should be **< 500ms**
   - No multiple rapid-fire requests

#### Performance Tab Analysis
1. Open **Performance** tab in Chrome DevTools
2. Click **Record** button
3. Navigate to products page
4. Stop recording after page loads
5. Look for:
   - **Total load time**
   - **Network request duration**
   - **JavaScript execution time**

### 3. Database Query Analysis

#### Count Queries (Development)
Add this middleware to count queries:
```typescript
// lib/queryCounter.ts
let queryCount = 0

export const resetQueryCount = () => queryCount = 0
export const getQueryCount = () => queryCount
export const incrementQuery = () => queryCount++

// Add to your API routes:
console.log(`Total queries executed: ${getQueryCount()}`)
```

#### Check Query Logs
Look in your server console for Prisma queries:
- **Before**: You should see 200+ individual SELECT statements
- **After**: You should see only 4-6 batch queries

### 4. Load Testing

#### Simple Load Test
```bash
# Test with curl (10 rapid requests)
for i in {1..10}; do
  curl -w "@curl-format.txt" -o /dev/null -s "http://localhost:3000/api/products/optimized?page=1&limit=50"
done
```

Create `curl-format.txt`:
```
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
```

#### Expected Results
- **Average response time**: < 500ms
- **Consistent performance**: No degradation over multiple requests
- **Memory usage**: Stable (no memory leaks)

### 5. Database Performance Testing

#### Check Index Usage
```sql
-- Run these queries to verify indexes are being used
EXPLAIN SELECT * FROM product WHERE product_category = '1';
EXPLAIN SELECT * FROM purchase_items WHERE name_of_product = '123' ORDER BY invoice_date DESC LIMIT 1;

-- Should show "Using index" in Extra column
```

#### Query Performance
```sql
-- Test individual query performance
SELECT SQL_NO_CACHE * FROM product WHERE product_category = '1';
-- Should execute in < 1ms with proper indexes

SELECT SQL_NO_CACHE * FROM purchase_items WHERE name_of_product = '123' ORDER BY invoice_date DESC LIMIT 1;
-- Should execute in < 1ms with proper indexes
```

## Performance Benchmarks

### API Response Times
| Endpoint | Before | After | Improvement |
|----------|--------|-------|-------------|
| `/api/products/optimized` | 2-5s | 200-500ms | **10x faster** |
| With filters | 3-8s | 300-600ms | **15x faster** |
| Low stock filter | 5-10s | 400-700ms | **20x faster** |

### Database Queries
| Operation | Before | After | Reduction |
|-----------|--------|-------|-----------|
| Page load | 250+ queries | 4-6 queries | **95% reduction** |
| Category lookup | 50 individual | 1 batch | **98% reduction** |
| Purchase rates | 50 individual | 1 optimized | **98% reduction** |

### User Experience
| Metric | Before | After |
|--------|--------|-------|
| First contentful paint | 3-5s | 200-400ms |
| Time to interactive | 5-8s | 500-800ms |
| Largest contentful paint | 4-6s | 300-500ms |

## Troubleshooting

### If Performance Isn't Improved

1. **Check Database Indexes**
   ```sql
   SHOW INDEX FROM product;
   SHOW INDEX FROM purchase_items;
   ```

2. **Verify API Endpoint**
   - Ensure frontend calls `/api/products/optimized`
   - Not the old `/api/products/enhanced`

3. **Check Query Logs**
   - Enable Prisma query logging
   - Look for individual SELECT statements (bad)
   - Should see batch queries with WHERE IN (good)

4. **Cache Issues**
   - Clear browser cache
   - Restart development server
   - Check if old code is cached

### Common Issues

1. **Still Seeing Many Queries**
   - Frontend may still call old endpoint
   - Check Network tab in browser

2. **Slow Performance Despite Optimization**
   - Database indexes may not be applied
   - Check with `SHOW INDEX FROM table_name`

3. **Memory Issues**
   - Clear lookup cache periodically
   - Monitor server memory usage

## Success Criteria

✅ **API response time < 500ms**
✅ **Query count < 10 per request**  
✅ **No N+1 query patterns**
✅ **Smooth user experience**
✅ **Database CPU usage minimal**

## Monitoring in Production

### Set up alerts for:
- API response times > 1 second
- Database connection pool exhaustion
- High database CPU usage
- Memory leaks in Node.js process

### Regular monitoring:
- Weekly performance reviews
- Monthly database index optimization
- Query performance analysis

Your page should now load **5-10x faster** with **95% fewer database queries**!
