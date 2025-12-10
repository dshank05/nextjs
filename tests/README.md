# Automated Testing Guide - Vendor Payment & Return System

This directory contains automated tests for the Vendor Payment & Return System, organized by batches matching the test scenarios in `docs/COMPREHENSIVE_TEST_SCENARIOS.md`.

## 📋 Test Structure

- **Batch 1**: Purchase Creation (10 scenarios) - `batch-1-purchase-creation.test.js`
- **Batch 2-9**: Coming soon...

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install --save-dev jest @prisma/client node-fetch
```

### 2. Configure Environment

Create `.env.test` file in project root:

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/test_db"

# Test Server
TEST_BASE_URL="http://localhost:3000"

# Test Data IDs (update with your actual test data)
TEST_VENDOR_ID=1
TEST_PRODUCT_ID=1
```

### 3. Set Up Test Database

```bash
# Create test database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS test_db;"

# Run migrations
npx prisma migrate deploy --schema=./prisma/schema.prisma

# Seed test data (vendor and products)
node scripts/seed-test-data.js
```

### 4. Start Development Server

```bash
# Terminal 1: Start the server
npm run dev
```

### 5. Run Tests

```bash
# Terminal 2: Run all tests
npm test

# Run specific batch
npm test tests/batch-1-purchase-creation.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

## 📊 Test Coverage

| Batch | Category | Tests | Status |
|-------|----------|-------|--------|
| 1 | Purchase Creation | 10 | ✅ Ready |
| 2 | Purchase Edit | 12 | ⏳ Pending |
| 3 | Payment Allocation | 15 | ⏳ Pending |
| 4 | Return Creation | 10 | ⏳ Pending |
| 5 | Return Edit | 8 | ⏳ Pending |
| 6 | Refund Allocation | 15 | ⏳ Pending |
| 7 | Complex Integration | 12 | ⏳ Pending |
| 8 | Edge Cases | 10 | ⏳ Pending |
| 9 | Data Integrity | 8 | ⏳ Pending |

## 🔧 Test Configuration

### Jest Configuration

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": [
      "**/tests/**/*.test.js"
    ],
    "collectCoverageFrom": [
      "pages/api/**/*.ts",
      "lib/**/*.ts"
    ],
    "coveragePathIgnorePatterns": [
      "/node_modules/",
      "/prisma/"
    ],
    "testTimeout": 30000
  }
}
```

### Test Data Setup

Before running tests, ensure you have:

1. **At least 1 vendor** in `vendor_details` table
2. **At least 3 products** in `product` table with stock
3. **Financial year** configured in `settings` table

Run this SQL to verify:

```sql
-- Check vendors
SELECT id, vendor_name FROM vendor_details WHERE status = 'Active' LIMIT 5;

-- Check products
SELECT id, product_name, stock FROM product WHERE is_active = true LIMIT 5;

-- Check financial year
SELECT * FROM settings;
```

## 📝 Writing New Tests

### Test Template

```javascript
test('X.X: Test Name', async () => {
  // 1. Get initial state
  const initialBalance = await getVendorBalance(TEST_VENDOR_ID);
  
  // 2. Prepare test data
  const requestData = {
    vendor_id: TEST_VENDOR_ID,
    // ... other fields
  };
  
  // 3. Make API call
  const { status, data } = await apiPost('/api/endpoint', requestData);
  
  // 4. Verify API response
  expect(status).toBe(201);
  expect(data).toBeDefined();
  
  // 5. Verify database state
  const record = await prisma.tableName.findFirst({
    where: { /* criteria */ }
  });
  expect(record).not.toBeNull();
  
  // 6. Cleanup
  createdInvoices.push(data.invoice_no);
  
  console.log('✅ Test X.X PASSED: Test Name');
});
```

### Helper Functions

Available helper functions:

- `apiPost(endpoint, data)` - Make POST request to API
- `getVendorBalance(vendorId)` - Get current vendor balance
- `getProductStock(productId)` - Get current product stock
- `cleanupTestData(invoiceNo)` - Clean up after test

## 🐛 Debugging Tests

### Enable Verbose Logging

```bash
# Show all console logs
npm test -- --verbose

# Show SQL queries
DEBUG=prisma:query npm test
```

### Check Database State During Test

Add breakpoints or use the helper scripts:

```javascript
// In your test
await new Promise(resolve => setTimeout(resolve, 5000)); // Pause for 5 seconds

// Then run in another terminal:
node scripts/view-test-data.js
```

### Common Issues

**Issue: "Cannot connect to database"**
- Solution: Verify DATABASE_URL in .env.test
- Check if MySQL/PostgreSQL is running

**Issue: "Vendor with ID X not found"**
- Solution: Update TEST_VENDOR_ID in .env.test with valid ID
- Run: `SELECT id FROM vendor_details WHERE status = 'Active';`

**Issue: "Product with ID X not found"**
- Solution: Update TEST_PRODUCT_ID in .env.test with valid ID
- Run: `SELECT id FROM product WHERE is_active = true;`

**Issue: "Test timeout"**
- Solution: Increase timeout in jest.config
- Check if development server is running on TEST_BASE_URL

## 📈 Test Results

### Example Output

```
PASS  tests/batch-1-purchase-creation.test.js
  BATCH 1: Purchase Creation (10 Scenarios)
    ✓ 1.1: Create Unpaid Purchase (No Tax) (1205ms)
    ✓ 1.2: Create Unpaid Purchase (With Tax - 18%) (987ms)
    ✓ 1.3: Create Paid Purchase - Cash (No Tax) (1103ms)
    ✓ 1.4: Create Paid Purchase - Cash (With Tax - 18%) (1054ms)
    ✓ 1.5: Create Paid Purchase - Bank (No Tax) (1098ms)
    ✓ 1.6: Create Paid Purchase - Bank (With Tax - 18%) (1076ms)
    ✓ 1.7: Create Purchase with Multiple Items (1234ms)
    ✓ 1.8: Create Purchase with Packing & Forwarding (1087ms)
    ✓ 1.9: Create Purchase with Transport Cost (1112ms)
    ✓ 1.10: Create Purchase with "Other" Vendor (1045ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Time:        11.089s
```

## 🔒 Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up test data in `afterAll()`
3. **Assertions**: Verify both API response AND database state
4. **Naming**: Use descriptive test names matching documentation
5. **Data**: Use test-specific data, not production data
6. **Timing**: Add appropriate timeouts for async operations

## 📚 Related Documentation

- [Comprehensive Test Scenarios](../docs/COMPREHENSIVE_TEST_SCENARIOS.md) - Full test plan
- [Payment Allocation System](../docs/PAYMENT_ALLOCATION_SYSTEM.md) - System design
- [Database Schema](../prisma/schema.prisma) - Database structure
- [Purchase API](../pages/api/purchases/index.ts) - API implementation

## 🤝 Contributing

When adding new tests:

1. Follow the existing test structure
2. Update this README with new test batches
3. Ensure all tests pass before committing
4. Update test coverage table

## 📞 Support

If tests fail or you need help:

1. Check the error message carefully
2. Verify database state with `node scripts/view-test-data.js`
3. Review API logs in development server console
4. Check that all prerequisites are met

---

**Last Updated**: December 9, 2025  
**Test Framework**: Jest  
**Total Tests**: 100 (10 completed, 90 pending)
