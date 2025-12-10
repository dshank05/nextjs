/**
 * BATCH 1: Purchase Creation Tests (10 Scenarios)
 * 
 * These tests verify purchase creation functionality by:
 * 1. Making API calls to /api/purchases
 * 2. Verifying database state using Prisma
 * 3. Checking all related tables (purchase, purchaseitems, bill_to, product, vendor_ledger)
 * 
 * Prerequisites:
 * - Database with test data (vendor, products)
 * - .env configured with DATABASE_URL
 * 
 * Run: npm test tests/batch-1-purchase-creation.test.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Test configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_VENDOR_ID = process.env.TEST_VENDOR_ID || 1; // Update with actual vendor ID
const TEST_PRODUCT_ID = process.env.TEST_PRODUCT_ID || 1; // Update with actual product ID

// Helper function to make API calls
async function apiPost(endpoint, data) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  const result = await response.json();
  return { status: response.status, data: result };
}

// Helper function to get initial balances
async function getVendorBalance(vendorId) {
  const latestEntry = await prisma.vendor_ledger.findFirst({
    where: { vendor_id: vendorId },
    orderBy: { id: 'desc' },
  });
  return latestEntry?.balance || 0;
}

// Helper function to get product stock
async function getProductStock(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { stock: true },
  });
  return product?.stock || 0;
}

// Cleanup function
async function cleanupTestData(invoiceNo) {
  if (!invoiceNo) return;
  
  try {
    // Delete in reverse dependency order
    await prisma.vendor_ledger.deleteMany({
      where: { reference_no: invoiceNo.toString() },
    });
    await prisma.purchaseitems.deleteMany({
      where: { invoice_no: invoiceNo },
    });
    await prisma.bill_to.deleteMany({
      where: { invoice_no: invoiceNo },
    });
    await prisma.purchase.deleteMany({
      where: { invoice_no: invoiceNo },
    });
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

describe('BATCH 1: Purchase Creation (10 Scenarios)', () => {
  let createdInvoices = [];

  // Cleanup after all tests
  afterAll(async () => {
    for (const invoiceNo of createdInvoices) {
      await cleanupTestData(invoiceNo);
    }
    await prisma.$disconnect();
  });

  /**
   * Test 1.1: Create Unpaid Purchase (No Tax)
   */
  test('1.1: Create Unpaid Purchase (No Tax)', async () => {
    const initialBalance = await getVendorBalance(TEST_VENDOR_ID);
    const initialStock = await getProductStock(TEST_PRODUCT_ID);

    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        part: 'TEST-PART',
        car_model: '',
        model_id: null,
        company_id: null,
      }],
      total_tax: 0,
      payment_status: 0, // Unpaid
      payment_mode: null,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    // Verify API response
    expect(status).toBe(201);
    expect(data.purchase).toBeDefined();
    expect(data.purchase.invoice_no).toBeDefined();

    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify purchase table
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase).not.toBeNull();
    expect(purchase.payment_status).toBe(0);
    expect(purchase.total).toBe(10000);
    expect(purchase.payment_mode).toBeNull();

    // ✅ Verify purchaseitems table
    const items = await prisma.purchaseitems.findMany({
      where: { invoice_no: invoiceNo },
    });
    expect(items.length).toBe(1);
    expect(items[0].qty).toBe(10);
    expect(items[0].rate).toBe(1000);
    expect(items[0].subtotal).toBe(10000);

    // ✅ Verify bill_to table
    const billTo = await prisma.bill_to.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(billTo).not.toBeNull();

    // ✅ Verify product stock increased
    const newStock = await getProductStock(TEST_PRODUCT_ID);
    expect(newStock).toBe(initialStock + 10);

    // ✅ Verify vendor_ledger entry
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
        transaction_type: 'PURCHASE',
      },
    });
    expect(ledgerEntry).not.toBeNull();
    expect(ledgerEntry.debit).toBe(10000);
    expect(ledgerEntry.credit).toBe(0);
    expect(ledgerEntry.balance).toBe(initialBalance + 10000);

    console.log('✅ Test 1.1 PASSED: Unpaid Purchase (No Tax)');
  });

  /**
   * Test 1.2: Create Unpaid Purchase (With Tax - 18%)
   */
  test('1.2: Create Unpaid Purchase (With Tax - 18%)', async () => {
    const initialBalance = await getVendorBalance(TEST_VENDOR_ID);

    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 18,
        tax: 1800,
        cgst: 900,  // Assuming intra-state
        sgst: 900,
        igst: 0,
        total: 11800,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      total_cgst: 900,
      total_sgst: 900,
      total_igst: 0,
      payment_status: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify purchase with tax
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.total).toBe(11800);
    expect(purchase.total_tax).toBe(1800);
    expect(purchase.total_cgst).toBe(900);
    expect(purchase.total_sgst).toBe(900);
    expect(purchase.total_igst).toBe(0);

    // ✅ Verify purchaseitems tax
    const items = await prisma.purchaseitems.findMany({
      where: { invoice_no: invoiceNo },
    });
    expect(items[0].tax).toBe(1800);
    expect(items[0].cgst).toBe(900);
    expect(items[0].sgst).toBe(900);

    // ✅ Verify ledger with tax amount
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
    });
    expect(ledgerEntry.debit).toBe(11800);
    expect(ledgerEntry.balance).toBe(initialBalance + 11800);

    console.log('✅ Test 1.2 PASSED: Unpaid Purchase (With Tax - 18%)');
  });

  /**
   * Test 1.3: Create Paid Purchase - Cash (No Tax)
   */
  test('1.3: Create Paid Purchase - Cash (No Tax)', async () => {
    const initialBalance = await getVendorBalance(TEST_VENDOR_ID);

    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      payment_status: 1, // Paid
      payment_mode: 0,   // Cash
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify purchase is marked as paid
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.payment_status).toBe(1);
    expect(purchase.payment_mode).toBe(0); // Cash

    // ✅ Verify 2 ledger entries (PURCHASE + PAYMENT)
    const ledgerEntries = await prisma.vendor_ledger.findMany({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
      orderBy: { id: 'asc' },
    });
    
    expect(ledgerEntries.length).toBe(2);
    
    // Entry 1: PURCHASE
    expect(ledgerEntries[0].transaction_type).toBe('PURCHASE');
    expect(ledgerEntries[0].debit).toBe(10000);
    expect(ledgerEntries[0].credit).toBe(0);
    
    // Entry 2: PAYMENT
    expect(ledgerEntries[1].transaction_type).toBe('PAYMENT');
    expect(ledgerEntries[1].debit).toBe(0);
    expect(ledgerEntries[1].credit).toBe(10000);
    expect(ledgerEntries[1].payment_mode).toBe(0); // Cash
    
    // ✅ Final balance should be unchanged (paid immediately)
    expect(ledgerEntries[1].balance).toBe(initialBalance);

    console.log('✅ Test 1.3 PASSED: Paid Purchase - Cash (No Tax)');
  });

  /**
   * Test 1.4: Create Paid Purchase - Cash (With Tax - 18%)
   */
  test('1.4: Create Paid Purchase - Cash (With Tax - 18%)', async () => {
    const initialBalance = await getVendorBalance(TEST_VENDOR_ID);

    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 18,
        tax: 1800,
        cgst: 900,
        sgst: 900,
        igst: 0,
        total: 11800,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      total_cgst: 900,
      total_sgst: 900,
      total_igst: 0,
      payment_status: 1,
      payment_mode: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify paid with correct total including tax
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.payment_status).toBe(1);
    expect(purchase.payment_mode).toBe(0);
    expect(purchase.total).toBe(11800);

    // ✅ Verify ledger entries for paid purchase with tax
    const ledgerEntries = await prisma.vendor_ledger.findMany({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
      orderBy: { id: 'asc' },
    });
    
    expect(ledgerEntries.length).toBe(2);
    expect(ledgerEntries[0].debit).toBe(11800); // PURCHASE
    expect(ledgerEntries[1].credit).toBe(11800); // PAYMENT
    expect(ledgerEntries[1].balance).toBe(initialBalance); // Net zero

    console.log('✅ Test 1.4 PASSED: Paid Purchase - Cash (With Tax - 18%)');
  });

  /**
   * Test 1.5: Create Paid Purchase - Bank (No Tax)
   */
  test('1.5: Create Paid Purchase - Bank (No Tax)', async () => {
    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      payment_status: 1,
      payment_mode: 1, // Bank
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify payment mode = 1 (Bank)
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.payment_mode).toBe(1);

    // ✅ Verify ledger entry has payment_mode = 1
    const paymentEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
        transaction_type: 'PAYMENT',
      },
    });
    expect(paymentEntry.payment_mode).toBe(1);

    console.log('✅ Test 1.5 PASSED: Paid Purchase - Bank (No Tax)');
  });

  /**
   * Test 1.6: Create Paid Purchase - Bank (With Tax - 18%)
   */
  test('1.6: Create Paid Purchase - Bank (With Tax - 18%)', async () => {
    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 18,
        tax: 1800,
        cgst: 900,
        sgst: 900,
        igst: 0,
        total: 11800,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      total_cgst: 900,
      total_sgst: 900,
      total_igst: 0,
      payment_status: 1,
      payment_mode: 1, // Bank
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify all tax and payment data correct
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.payment_status).toBe(1);
    expect(purchase.payment_mode).toBe(1);
    expect(purchase.total).toBe(11800);

    const ledgerEntries = await prisma.vendor_ledger.findMany({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
    });
    
    const paymentEntry = ledgerEntries.find(e => e.transaction_type === 'PAYMENT');
    expect(paymentEntry.credit).toBe(11800);
    expect(paymentEntry.payment_mode).toBe(1);

    console.log('✅ Test 1.6 PASSED: Paid Purchase - Bank (With Tax - 18%)');
  });

  /**
   * Test 1.7: Create Purchase with Multiple Items
   */
  test('1.7: Create Purchase with Multiple Items', async () => {
    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          product_id: TEST_PRODUCT_ID,
          product_name: 'Product 1',
          qty: 5,
          rate: 1000,
          gst_percentage: 18,
          tax: 900,
          cgst: 450,
          sgst: 450,
          igst: 0,
          total: 5900,
          category_id: 1,
          company_id: 1,
          part: 'PART-1',
        },
        {
          product_id: TEST_PRODUCT_ID + 1,
          product_name: 'Product 2',
          qty: 10,
          rate: 500,
          gst_percentage: 12,
          tax: 600,
          cgst: 300,
          sgst: 300,
          igst: 0,
          total: 5600,
          category_id: 1,
          company_id: 1,
          part: 'PART-2',
        },
        {
          product_id: TEST_PRODUCT_ID + 2,
          product_name: 'Product 3',
          qty: 2,
          rate: 2000,
          gst_percentage: 0,
          tax: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: 4000,
          category_id: 1,
          company_id: 1,
          part: 'PART-3',
        },
      ],
      payment_status: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify purchase total
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.total).toBe(15500); // 5900 + 5600 + 4000

    // ✅ Verify 3 items created
    const items = await prisma.purchaseitems.findMany({
      where: { invoice_no: invoiceNo },
    });
    expect(items.length).toBe(3);

    // ✅ Verify ledger entry
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
    });
    expect(ledgerEntry.debit).toBe(15500);

    console.log('✅ Test 1.7 PASSED: Purchase with Multiple Items');
  });

  /**
   * Test 1.8: Create Purchase with Packing & Forwarding
   */
  test('1.8: Create Purchase with Packing & Forwarding', async () => {
    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      packing_forwarding_qty: 1,
      packing_forwarding_rate: 500,
      packing_forwarding_total: 500,
      payment_status: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify P&F included in total
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.total).toBe(10500); // 10000 + 500
    expect(purchase.packing_forwarding_qty).toBe(1);
    expect(purchase.packing_forwarding_rate).toBe(500);
    expect(purchase.packing_forwarding_total).toBe(500);

    // ✅ Verify ledger includes P&F
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
    });
    expect(ledgerEntry.debit).toBe(10500);

    console.log('✅ Test 1.8 PASSED: Purchase with Packing & Forwarding');
  });

  /**
   * Test 1.9: Create Purchase with Transport Cost
   */
  test('1.9: Create Purchase with Transport Cost', async () => {
    const purchaseData = {
      vendor_id: TEST_VENDOR_ID,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      transport_name: 'Test Transport',
      vehicle_number: 'UP 12 AB 1234',
      transport_cost: 1000,
      payment_status: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify transport cost added to total
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.total).toBe(11000); // 10000 + 1000
    expect(purchase.transport_name).toBe('Test Transport');
    expect(purchase.vehicle_number).toBe('UP 12 AB 1234');
    expect(purchase.freight).toBe(1000);

    // ✅ Verify ledger includes transport
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: TEST_VENDOR_ID,
        reference_no: invoiceNo.toString(),
      },
    });
    expect(ledgerEntry.debit).toBe(11000);

    console.log('✅ Test 1.9 PASSED: Purchase with Transport Cost');
  });

  /**
   * Test 1.10: Create Purchase with "Other" Vendor
   */
  test('1.10: Create Purchase with "Other" Vendor', async () => {
    const purchaseData = {
      vendor_id: 0, // "Other" vendor
      vendor_name: 'One-Time Vendor',
      contact_number: '9999999999',
      state: 'Uttar Pradesh',
      state_code: 9,
      date: new Date().toISOString().split('T')[0],
      items: [{
        product_id: TEST_PRODUCT_ID,
        product_name: 'Test Product',
        qty: 10,
        rate: 1000,
        gst_percentage: 0,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 10000,
        category_id: 1,
        company_id: 1,
        part: 'TEST-PART',
      }],
      payment_status: 0,
    };

    const { status, data } = await apiPost('/api/purchases', purchaseData);

    expect(status).toBe(201);
    const invoiceNo = data.purchase.invoice_no;
    createdInvoices.push(invoiceNo);

    // ✅ Verify "Other" vendor saved as vendor_id = 0
    const purchase = await prisma.purchase.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(purchase.vendor_id).toBe(0);

    // ✅ Verify manual details in bill_to table
    const billTo = await prisma.bill_to.findFirst({
      where: { invoice_no: invoiceNo },
    });
    expect(billTo.vendor_name).toBe('One-Time Vendor');
    expect(billTo.contact_no).toBe('9999999999');
    expect(billTo.state).toBe('Uttar Pradesh');

    // ✅ Verify ledger entry created with vendor_id = 0
    const ledgerEntry = await prisma.vendor_ledger.findFirst({
      where: { 
        vendor_id: 0,
        reference_no: invoiceNo.toString(),
      },
    });
    expect(ledgerEntry).not.toBeNull();

    console.log('✅ Test 1.10 PASSED: Purchase with "Other" Vendor');
  });
});

/**
 * INSTRUCTIONS TO RUN TESTS:
 * 
 * 1. Install dependencies:
 *    npm install --save-dev jest @types/jest
 * 
 * 2. Update package.json:
 *    "scripts": {
 *      "test": "jest"
 *    }
 * 
 * 3. Create .env.test with:
 *    DATABASE_URL="your_test_database_url"
 *    TEST_BASE_URL="http://localhost:3000"
 *    TEST_VENDOR_ID=1
 *    TEST_PRODUCT_ID=1
 * 
 * 4. Run tests:
 *    npm test tests/batch-1-purchase-creation.test.js
 * 
 * 5. View results and verify all tests pass
 */
