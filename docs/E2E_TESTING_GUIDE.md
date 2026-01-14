# End-to-End Testing Guide - Playwright Implementation

**Document Version:** 2.0  
**Created:** January 11, 2026  
**Testing Framework:** Playwright  
**Approach:** Real Browser + Real API + Real Database  
**Total Tests:** 100 E2E Tests

---

## 🎯 TESTING PHILOSOPHY

**What We Test:**
- ✅ **Real UI Interactions** - Click buttons, fill forms, navigate pages
- ✅ **Real API Calls** - Actual HTTP requests to Next.js API routes
- ✅ **Real Database** - Verify data integrity after each operation
- ✅ **Complete Flows** - End-to-end user journeys

**What Makes This Different:**
- ❌ **No Mocking** - We test the actual system
- ❌ **No Isolated Tests** - We test complete workflows
- ✅ **Real Browser** - See tests run in Chromium
- ✅ **Database Verification** - Check every table after each action

---

## 📋 TEST STRUCTURE

### **Every Test Follows This Pattern:**

```typescript
test('Test Name', async ({ page }) => {
  // 1. SETUP - Navigate to page
  await page.goto('/purchases/create');
  
  // 2. ACTION - Interact with UI (makes REAL API call)
  await page.selectOption('[name="vendor"]', 'Test Vendor');
  await page.fill('[name="qty"]', '10');
  await page.click('button:has-text("Create")');
  
  // 3. UI VERIFICATION - Check UI updated correctly
  await expect(page.locator('.success')).toBeVisible();
  
  // 4. DATABASE VERIFICATION - Check all affected tables
  const purchase = await prisma.purchase.findFirst({...});
  expect(purchase).toBeTruthy();
  expect(purchase.total).toBe(10000);
  
  const items = await prisma.purchaseitems.findMany({...});
  expect(items.length).toBe(1);
  
  const product = await prisma.product.findUnique({...});
  expect(product.stock).toBe(10); // Stock increased
  
  const ledger = await prisma.vendor_ledger.findFirst({...});
  expect(ledger.debit).toBe(10000); // Ledger updated
});
```

---

## 🚀 QUICK START

### **1. Install Playwright**

```bash
npm install --save-dev @playwright/test @playwright/test-runner
npx playwright install chromium
```

### **2. Create Configuration**

```bash
# Create playwright.config.ts in project root
```

### **3. Run Tests**

```bash
# Run all tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/purchase/01-create-unpaid.spec.ts

# Run with UI (see browser)
npx playwright test --ui

# Debug mode (step through)
npx playwright test --debug

# Run specific test by name
npx playwright test -g "should create unpaid purchase"
```

### **4. View Test Results**

```bash
# Open HTML report
npx playwright show-report

# View screenshots/videos of failures
# Located in: test-results/
```

---

## 📁 PROJECT STRUCTURE

```
d:/nextjs/
├── playwright.config.ts          # Playwright configuration
├── tests/
│   └── e2e/                      # All E2E tests
│       ├── fixtures/
│       │   ├── auth.ts           # Authentication helpers
│       │   ├── test-data.ts      # Test vendors, products
│       │   └── db-helpers.ts     # Database utilities
│       │
│       ├── purchase/
│       │   ├── 01-create-unpaid.spec.ts
│       │   ├── 02-create-paid-cash.spec.ts
│       │   ├── 03-create-paid-bank.spec.ts
│       │   ├── 04-create-with-tax.spec.ts
│       │   ├── 05-create-multiple-items.spec.ts
│       │   ├── 06-create-with-packing.spec.ts
│       │   ├── 07-create-with-transport.spec.ts
│       │   ├── 08-create-other-vendor.spec.ts
│       │   ├── 09-edit-unpaid.spec.ts
│       │   ├── 10-edit-paid.spec.ts
│       │   ├── 11-mark-as-paid.spec.ts
│       │   └── 12-unmark-as-paid.spec.ts
│       │
│       ├── payment/
│       │   ├── 01-full-payment-single.spec.ts
│       │   ├── 02-partial-payment.spec.ts
│       │   ├── 03-multiple-partial-payments.spec.ts
│       │   ├── 04-one-payment-multiple-bills.spec.ts
│       │   ├── 05-mixed-allocations.spec.ts
│       │   ├── 06-payment-modes.spec.ts
│       │   ├── 07-payment-validation.spec.ts
│       │   ├── 08-payment-history.spec.ts
│       │   ├── 09-overpayment-validation.spec.ts
│       │   ├── 10-allocation-sum-validation.spec.ts
│       │   ├── 11-payment-with-notes.spec.ts
│       │   ├── 12-outstanding-bills-list.spec.ts
│       │   ├── 13-fifo-suggestion.spec.ts
│       │   ├── 14-reverse-payment.spec.ts
│       │   └── 15-cross-vendor-validation.spec.ts
│       │
│       ├── return/
│       │   ├── 01-create-unpaid-return.spec.ts
│       │   ├── 02-create-with-refund-cash.spec.ts
│       │   ├── 03-create-with-refund-bank.spec.ts
│       │   ├── 04-partial-return.spec.ts
│       │   ├── 05-full-return.spec.ts
│       │   ├── 06-return-validation.spec.ts
│       │   ├── 07-multiple-returns.spec.ts
│       │   ├── 08-debit-note-generation.spec.ts
│       │   ├── 09-return-reasons.spec.ts
│       │   └── 10-edit-return.spec.ts
│       │
│       ├── refund/
│       │   ├── 01-full-refund-single.spec.ts
│       │   ├── 02-partial-refund.spec.ts
│       │   ├── 03-multiple-partial-refunds.spec.ts
│       │   ├── 04-one-refund-multiple-returns.spec.ts
│       │   ├── 05-mixed-refund-allocations.spec.ts
│       │   ├── 06-refund-modes.spec.ts
│       │   ├── 07-refund-validation.spec.ts
│       │   ├── 08-refund-history.spec.ts
│       │   ├── 09-over-refund-validation.spec.ts
│       │   ├── 10-allocation-sum-validation.spec.ts
│       │   ├── 11-refund-with-notes.spec.ts
│       │   ├── 12-outstanding-returns-list.spec.ts
│       │   ├── 13-cross-vendor-validation.spec.ts
│       │   ├── 14-reverse-refund.spec.ts
│       │   └── 15-fifo-suggestion.spec.ts
│       │
│       ├── integration/
│       │   ├── 01-full-cycle.spec.ts
│       │   ├── 02-partial-cycle.spec.ts
│       │   ├── 03-bulk-operations.spec.ts
│       │   ├── 04-edit-after-payment.spec.ts
│       │   ├── 05-edit-after-refund.spec.ts
│       │   ├── 06-payment-reversal-repayment.spec.ts
│       │   ├── 07-return-before-full-payment.spec.ts
│       │   ├── 08-cross-financial-year.spec.ts
│       │   ├── 09-high-volume-transactions.spec.ts
│       │   ├── 10-purchase-with-returns.spec.ts
│       │   ├── 11-concurrent-operations.spec.ts
│       │   └── 12-vendor-balance-summary.spec.ts
│       │
│       ├── edge-cases/
│       │   ├── 01-zero-amount-validation.spec.ts
│       │   ├── 02-negative-amount-validation.spec.ts
│       │   ├── 03-large-amounts.spec.ts
│       │   ├── 04-decimal-precision.spec.ts
│       │   ├── 05-special-characters.spec.ts
│       │   ├── 06-long-text-fields.spec.ts
│       │   ├── 07-deleted-product.spec.ts
│       │   ├── 08-deleted-vendor.spec.ts
│       │   ├── 09-date-edge-cases.spec.ts
│       │   └── 10-concurrent-edits.spec.ts
│       │
│       └── data-integrity/
│           ├── 01-payment-status-verification.spec.ts
│           ├── 02-refund-status-verification.spec.ts
│           ├── 03-ledger-balance-verification.spec.ts
│           ├── 04-orphaned-payment-allocations.spec.ts
│           ├── 05-orphaned-refund-allocations.spec.ts
│           ├── 06-stock-levels-verification.spec.ts
│           ├── 07-financial-year-consistency.spec.ts
│           └── 08-comprehensive-integrity-check.spec.ts
│
└── test-results/                 # Generated by Playwright
    ├── screenshots/              # Failure screenshots
    ├── videos/                   # Test recordings
    └── traces/                   # Debug traces
```

---

## 🔧 CONFIGURATION

### **playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

export default defineConfig({
  testDir: './tests/e2e',
  
  // Test execution settings
  fullyParallel: false,  // Run sequentially for DB consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,  // Single worker to avoid DB conflicts
  
  // Timeouts
  timeout: 60000,  // 60 seconds per test
  expect: {
    timeout: 10000  // 10 seconds for assertions
  },
  
  // Reporter
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],
  
  // Global settings
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Browser context options
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    
    // Slow down actions for debugging (optional)
    // launchOptions: {
    //   slowMo: 100
    // }
  },

  // Test projects (browsers)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test on other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Start dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
```

### **.env.test**

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/test_db"

# Test Server
TEST_BASE_URL="http://localhost:3000"

# Test Credentials
TEST_USERNAME="testuser"
TEST_PASSWORD="testpass"

# Test Data IDs (will be created by setup)
TEST_VENDOR_ID=
TEST_PRODUCT_ID=
TEST_CATEGORY_ID=
```

---

## 📝 WRITING TESTS

### **Test Template**

```typescript
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.describe('Feature Name', () => {
  let testDataId: number;

  // Setup before all tests in this file
  test.beforeAll(async () => {
    // Create test data
    const data = await prisma.tableName.create({
      data: { /* test data */ }
    });
    testDataId = data.id;
  });

  // Cleanup after all tests
  test.afterAll(async () => {
    // Delete test data in reverse dependency order
    await prisma.childTable.deleteMany({ where: { parent_id: testDataId } });
    await prisma.tableName.delete({ where: { id: testDataId } });
    await prisma.$disconnect();
  });

  test('should do something', async ({ page }) => {
    // 1. NAVIGATE
    await page.goto('/path/to/page');
    
    // 2. INTERACT (makes REAL API call)
    await page.fill('[name="field"]', 'value');
    await page.click('button:has-text("Submit")');
    
    // 3. VERIFY UI
    await expect(page.locator('.success')).toBeVisible();
    
    // 4. VERIFY DATABASE
    const record = await prisma.tableName.findFirst({
      where: { /* criteria */ }
    });
    expect(record).toBeTruthy();
    expect(record.field).toBe('expected value');
  });
});
```

---

## 🎯 DATABASE VERIFICATION PATTERNS

### **Pattern 1: Verify Single Record**

```typescript
// After creating a purchase
const purchase = await prisma.purchase.findFirst({
  where: { invoice_no: createdInvoiceNo }
});

expect(purchase).toBeTruthy();
expect(purchase.vendor_id).toBe(testVendorId);
expect(purchase.total).toBe(10000);
expect(purchase.payment_status).toBe(0);
```

### **Pattern 2: Verify Related Records**

```typescript
// Verify purchase and its items
const purchase = await prisma.purchase.findFirst({
  where: { invoice_no: invoiceNo },
  include: {
    items: true,
    vendor: true
  }
});

expect(purchase.items.length).toBe(2);
expect(purchase.items[0].qty).toBe(10);
expect(purchase.vendor.vendor_name).toBe('Test Vendor');
```

### **Pattern 3: Verify Calculations**

```typescript
// Verify payment allocations sum correctly
const allocations = await prisma.payment_allocations.findMany({
  where: { payment_id: paymentId }
});

const totalAllocated = allocations.reduce(
  (sum, alloc) => sum + Number(alloc.allocated_amount), 
  0
);

expect(totalAllocated).toBe(paymentAmount);
```

### **Pattern 4: Verify Ledger Balance**

```typescript
// Verify vendor ledger balance calculation
const ledgerEntries = await prisma.vendor_ledger.findMany({
  where: { vendor_id: vendorId },
  orderBy: { id: 'asc' }
});

let runningBalance = 0;
for (const entry of ledgerEntries) {
  runningBalance += entry.debit - entry.credit;
  expect(entry.balance).toBe(runningBalance);
}
```

### **Pattern 5: Verify Status Updates**

```typescript
// Verify purchase status changed after payment
const purchaseBefore = await prisma.purchase.findUnique({
  where: { id: purchaseId }
});
expect(purchaseBefore.payment_status).toBe(0); // Unpaid

// Make payment...

const purchaseAfter = await prisma.purchase.findUnique({
  where: { id: purchaseId }
});
expect(purchaseAfter.payment_status).toBe(1); // Paid
```

### **Pattern 6: Verify Stock Changes**

```typescript
// Get initial stock
const productBefore = await prisma.product.findUnique({
  where: { id: productId }
});
const initialStock = productBefore.stock;

// Create purchase with qty=10...

// Verify stock increased
const productAfter = await prisma.product.findUnique({
  where: { id: productId }
});
expect(productAfter.stock).toBe(initialStock + 10);
```

---

## 🔍 COMMON SELECTORS

### **Data Test IDs (Recommended)**

```typescript
// In your React components, add data-testid attributes:
<button data-testid="create-purchase-btn">Create</button>
<div data-testid="total-amount">₹10,000</div>

// In tests:
await page.click('[data-testid="create-purchase-btn"]');
await expect(page.locator('[data-testid="total-amount"]')).toHaveText('₹10,000');
```

### **Form Fields**

```typescript
// By name attribute
await page.fill('[name="vendor_id"]', '1');
await page.selectOption('[name="payment_mode"]', '0');

// By label
await page.fill('text=Quantity', '10');
await page.fill('label:has-text("Rate")', '1000');
```

### **Buttons**

```typescript
// By text
await page.click('button:has-text("Create Purchase")');
await page.click('button:has-text("Submit")');

// By type
await page.click('button[type="submit"]');
```

### **Tables**

```typescript
// Find row by text
await page.click('tr:has-text("Invoice #12345")');

// Get cell value
const amount = await page.locator('tr:has-text("INV-001") td:nth-child(3)').textContent();
```

---

## 🐛 DEBUGGING TESTS

### **1. Run with UI Mode**

```bash
npx playwright test --ui
```
- See tests run in real-time
- Pause and inspect at any point
- Step through actions

### **2. Debug Mode**

```bash
npx playwright test --debug
```
- Opens Playwright Inspector
- Step through each action
- Inspect page state

### **3. Add Breakpoints**

```typescript
test('my test', async ({ page }) => {
  await page.goto('/purchases/create');
  
  // Pause here
  await page.pause();
  
  // Continue with test...
});
```

### **4. Take Screenshots**

```typescript
// Take screenshot at any point
await page.screenshot({ path: 'debug-screenshot.png' });

// Screenshot specific element
await page.locator('[data-testid="total"]').screenshot({ 
  path: 'total-element.png' 
});
```

### **5. Console Logs**

```typescript
// Log page console messages
page.on('console', msg => console.log('PAGE LOG:', msg.text()));

// Log network requests
page.on('request', request => 
  console.log('REQUEST:', request.method(), request.url())
);

// Log responses
page.on('response', response => 
  console.log('RESPONSE:', response.status(), response.url())
);
```

---

## 📊 RUNNING TESTS

### **Run All Tests**

```bash
npx playwright test
```

### **Run Specific Directory**

```bash
npx playwright test tests/e2e/purchase/
npx playwright test tests/e2e/payment/
```

### **Run Specific File**

```bash
npx playwright test tests/e2e/purchase/01-create-unpaid.spec.ts
```

### **Run by Test Name**

```bash
npx playwright test -g "should create unpaid purchase"
npx playwright test -g "full payment"
```

### **Run in Headed Mode (See Browser)**

```bash
npx playwright test --headed
```

### **Run with Specific Browser**

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### **Generate Report**

```bash
npx playwright show-report
```

---

## ✅ BEST PRACTICES

### **1. Use Data Test IDs**
```typescript
// ✅ Good - Stable selector
await page.click('[data-testid="submit-btn"]');

// ❌ Bad - Fragile selector
await page.click('.btn.btn-primary.mt-4');
```

### **2. Wait for Elements**
```typescript
// ✅ Good - Explicit wait
await page.waitForSelector('[data-testid="success-message"]');
await expect(page.locator('[data-testid="success-message"]')).toBeVisible();

// ❌ Bad - No wait
expect(page.locator('[data-testid="success-message"]')).toBeVisible();
```

### **3. Verify Database After Every Action**
```typescript
// ✅ Good - Complete verification
await page.click('button:has-text("Create")');
await expect(page.locator('.success')).toBeVisible();

const purchase = await prisma.purchase.findFirst({...});
expect(purchase).toBeTruthy();

// ❌ Bad - Only UI verification
await page.click('button:has-text("Create")');
await expect(page.locator('.success')).toBeVisible();
```

### **4. Clean Up Test Data**
```typescript
// ✅ Good - Cleanup in afterAll
test.afterAll(async () => {
  await prisma.purchaseitems.deleteMany({ where: { invoice_no } });
  await prisma.purchase.delete({ where: { invoice_no } });
  await prisma.$disconnect();
});

// ❌ Bad - No cleanup
test.afterAll(async () => {
  // Nothing - leaves test data in DB
});
```

### **5. Use Descriptive Test Names**
```typescript
// ✅ Good
test('should create unpaid purchase with 18% tax and verify ledger entry', async ({ page }) => {

// ❌ Bad
test('test 1', async ({ page }) => {
```

---

## 🚀 CI/CD INTEGRATION

### **GitHub Actions Example**

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306
        options: --health-cmd="mysqladmin ping" --health-interval=10s --health-timeout=5s --health-retries=3
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Install Playwright
        run: npx playwright install --with-deps chromium
        
      - name: Run migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: mysql://root:root@localhost:3306/test_db
          
      - name: Run E2E tests
        run: npx playwright test
        env:
          DATABASE_URL: mysql://root:root@localhost:3306/test_db
          TEST_BASE_URL: http://localhost:3000
          
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

---

## 📈 TEST COVERAGE GOALS

| Category | Tests | Status |
|----------|-------|--------|
| Purchase Creation | 10 | ⏳ Pending |
| Purchase Edit | 12 | ⏳ Pending |
| Payment Allocation | 15 | ⏳ Pending |
| Return Creation | 10 | ⏳ Pending |
| Return Edit | 8 | ⏳ Pending |
| Refund Allocation | 15 | ⏳ Pending |
| Integration | 12 | ⏳ Pending |
| Edge Cases | 10 | ⏳ Pending |
| Data Integrity | 8 | ⏳ Pending |
| **TOTAL** | **100** | **0%** |

---

## 📞 SUPPORT

**If tests fail:**
1. Check the HTML report: `npx playwright show-report`
2. View screenshots in `test-results/`
3. Run in debug mode: `npx playwright test --debug`
4. Check database state manually
5. Review API logs in dev server console

**Common Issues:**
- **Timeout errors**: Increase timeout in config
- **Element not found**: Check selector, add explicit wait
- **Database errors**: Verify test data cleanup
- **Port conflicts**: Ensure port 3000 is available

---

**END OF DOCUMENT**
