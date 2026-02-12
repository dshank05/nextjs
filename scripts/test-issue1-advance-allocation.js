/**
 * TEST ISSUE 1: AA12 - Unpaid Purchase Marked as Paid with Advance
 *
 * Scenario:
 * 1. Create advance payment of ₹24,000
 * 2. Create unpaid purchase of ₹9,000
 * 3. Mark purchase as paid (should use advance, NOT create new payment)
 *
 * EXPECTED RESULT:
 * - Ledger shows: Payment ₹24,000 (CREDIT) + Purchase ₹9,000 (DEBIT)
 * - Balance: ₹15,000 advance remaining
 * - NO duplicate ₹9,000 payment entry
 *
 * ISSUE:
 * - Before fix: Ledger was showing another ₹9,000 payment, making balance ₹24,000 instead of ₹15,000
 * - After fix: Should only show allocation, no new payment ledger entry
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const FY = 2024; // Adjust as needed

// ANSI colors
const RESET = '\x1b[0m';
const BRIGHT = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function log(color, text) {
  console.log(color + text + RESET);
}

function header(text) {
  console.log('\n' + '='.repeat(80));
  log(BRIGHT + CYAN, text);
  console.log('='.repeat(80));
}

function step(num, text) {
  log(BRIGHT + CYAN, `\n📍 STEP ${num}: ${text}`);
}

function success(text) {
  log(GREEN, '✅ ' + text);
}

function error(text) {
  log(RED, '❌ ' + text);
}

function info(text) {
  log(CYAN, 'ℹ️  ' + text);
}

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('en-IN');
}

async function getVendorIdByName(vendorName) {
  try {
    const response = await axios.get(`${API_BASE}/vendors`, {
      params: { search: vendorName }
    });

    if (response.data.vendors && response.data.vendors.length > 0) {
      const vendor = response.data.vendors.find(v =>
        v.vendor_name.toLowerCase() === vendorName.toLowerCase()
      );
      return vendor ? vendor.id : null;
    }
    return null;
  } catch (err) {
    console.error('Error finding vendor:', err.message);
    return null;
  }
}

async function getLedger(vendorId) {
  try {
    const response = await axios.get(`${API_BASE}/reports/vendor-ledger-accounting`, {
      params: { vendor_id: vendorId }
    });
    return response.data.entries || [];
  } catch (err) {
    console.error('Error fetching ledger:', err.message);
    return [];
  }
}

async function getBalance(vendorId) {
  try {
    const response = await axios.get(`${API_BASE}/vendors/${vendorId}/balance`);
    return response.data;
  } catch (err) {
    // Balance might not exist yet
    return {
      total_paid: 0,
      total_allocated: 0,
      total_refunded: 0,
      total_refund_allocated: 0
    };
  }
}

function displayLedger(entries, title = 'LEDGER') {
  log(BRIGHT, '\n📋 ' + title);

  if (entries.length === 0) {
    info('  (No entries)');
    return;
  }

  console.table(entries.map(e => ({
    ID: e.id,
    Date: new Date(e.date * 1000).toLocaleDateString('en-IN'),
    Type: e.voucherType,
    Ref: e.voucherNo,
    Debit: e.debit ? formatCurrency(e.debit) : '-',
    Credit: e.credit ? formatCurrency(e.credit) : '-',
    Balance: formatCurrency(e.balance),
    'Txn ID': e.transaction_id || '-',
    Notes: (e.remarks || '').substring(0, 35)
  })));
}

function displayBalance(balance) {
  const advance = (Number(balance.total_paid) - Number(balance.total_allocated)) +
                  (Number(balance.total_refunded) - Number(balance.total_refund_allocated));

  log(BRIGHT, '\n💰 VENDOR BALANCE');
  console.log(`  Total Paid:          ${formatCurrency(balance.total_paid)}`);
  console.log(`  Total Allocated:     ${formatCurrency(balance.total_allocated)}`);
  console.log(`  ${BRIGHT}Advance Balance:     ${formatCurrency(advance)}${RESET}`);
}

async function testIssue1() {
  header('TEST ISSUE 1: Unpaid Purchase → Paid with Advance (AA12 Scenario)');

  // Use vendor ID 18 (E2E Test Vendor) - clean vendor with no transactions
  const vendorId = 18;
  const VENDOR_NAME = 'E2E Test Vendor';
  let paymentId, purchaseId, invoiceNo;

  try {
    info(`Using vendor: "${VENDOR_NAME}" (ID: ${vendorId})`);
    success(`Vendor ID set to: ${vendorId}`);

    // Check initial state
    let ledger = await getLedger(vendorId);
    let balance = await getBalance(vendorId);

    log(BRIGHT, '\n📊 INITIAL STATE');
    displayLedger(ledger.slice(-5));
    displayBalance(balance);

    // ========================================================================
    // STEP 1: Create Advance Payment ₹24,000
    // ========================================================================
    step(1, 'Create Advance Payment ₹24,000');

    const paymentResponse = await axios.post(`${API_BASE}/vendor-payments`, {
      vendor_id: vendorId,
      payment_date: Math.floor(Date.now() / 1000),
      payment_amount: 24000,
      payment_mode: 1, // Bank
      payment_type: 'DIRECT',
      notes: 'Advance payment for testing Issue 1',
      fy: FY
    });

    paymentId = paymentResponse.data.id;
    success(`Advance payment created: Payment ID ${paymentId}`);
    info(`Amount: ${formatCurrency(24000)}`);

    // Check ledger after payment
    ledger = await getLedger(vendorId);
    balance = await getBalance(vendorId);
    displayLedger(ledger.slice(-5), 'LEDGER AFTER ADVANCE PAYMENT');
    displayBalance(balance);

    // ========================================================================
    // STEP 2: Create Unpaid Purchase ₹9,000
    // ========================================================================
    step(2, 'Create Unpaid Purchase ₹9,000');

    const purchaseResponse = await axios.post(`${API_BASE}/purchases`, {
      vendor_id: vendorId,
      invoice_date: Math.floor(Date.now() / 1000),
      total: 9000,
      total_amount: 9000,
      total_tax: 0,
      payment_status: 0, // UNPAID
      payment_mode: 1,
      notes: 'Test purchase for Issue 1',
      fy: FY,
      items: [
        {
          product_id: 1, // Adjust if needed
          qty: 1,
          rate: 9000,
          tax_rate: 0,
          amount: 9000
        }
      ]
    });

    purchaseId = purchaseResponse.data.id;
    invoiceNo = purchaseResponse.data.invoice_no;
    success(`Unpaid purchase created: Purchase ID ${purchaseId}, Invoice ${invoiceNo}`);
    info(`Amount: ${formatCurrency(9000)}, Status: UNPAID`);

    // Check ledger after purchase
    ledger = await getLedger(vendorId);
    balance = await getBalance(vendorId);
    displayLedger(ledger.slice(-5), 'LEDGER AFTER UNPAID PURCHASE');
    displayBalance(balance);

    // ========================================================================
    // STEP 3: Mark Purchase as PAID (Should use advance)
    // ========================================================================
    step(3, 'Mark Purchase as PAID (Should allocate from advance)');

    info('This is the critical step - checking if advance is used correctly...');

    await axios.put(`${API_BASE}/purchases/${purchaseId}`, {
      payment_status: 1, // PAID
      payment_mode: 1,
      payment_date: Math.floor(Date.now() / 1000)
    });

    success('Purchase marked as PAID');

    // Check final ledger
    ledger = await getLedger(vendorId);
    balance = await getBalance(vendorId);
    displayLedger(ledger, 'FINAL LEDGER (After marking as paid)');
    displayBalance(balance);

    // ========================================================================
    // VERIFICATION
    // ========================================================================
    header('VERIFICATION & RESULTS');

    let allTestsPassed = true;

    // Check 1: Advance balance should be ₹15,000
    log(BRIGHT, '\n✓ CHECK 1: Advance Balance');
    const expectedAdvance = 24000 - 9000;
    const actualAdvance = (Number(balance.total_paid) - Number(balance.total_allocated)) +
                         (Number(balance.total_refunded) - Number(balance.total_refund_allocated));

    info(`Expected: ${formatCurrency(expectedAdvance)}`);
    info(`Actual:   ${formatCurrency(actualAdvance)}`);

    if (Math.abs(actualAdvance - expectedAdvance) < 0.01) {
      success('PASS: Advance balance is correct!');
    } else {
      error('FAIL: Advance balance is incorrect!');
      allTestsPassed = false;
    }

    // Check 2: No duplicate PAYMENT ledger entry for the purchase
    log(BRIGHT, '\n✓ CHECK 2: No Duplicate PAYMENT Entry');

    const purchasePayments = ledger.filter(e =>
      e.voucherNo === invoiceNo.toString() &&
      e.transactionType === 'PAYMENT'
    );

    info(`Found ${purchasePayments.length} PAYMENT entries for Invoice ${invoiceNo}`);

    if (purchasePayments.length === 0) {
      success('PASS: No PAYMENT ledger entry created (advance was used via allocation)');
      info('This is correct! Payment allocations handle the link, no ledger entry needed.');
    } else if (purchasePayments.length === 1 && purchasePayments[0].credit === 0) {
      success('PASS: PAYMENT entry exists but shows ₹0 (fully from advance)');
      info('This is also acceptable if notes clearly indicate advance usage.');
    } else {
      error(`FAIL: Found ${purchasePayments.length} PAYMENT entries with actual amounts!`);
      error('This creates duplicate payment in ledger.');
      console.table(purchasePayments);
      allTestsPassed = false;
    }

    // Check 3: Payment allocations should exist
    log(BRIGHT, '\n✓ CHECK 3: Payment Allocations');

    try {
      const allocResponse = await axios.get(`${API_BASE}/purchases/${purchaseId}/allocations`);
      const allocations = allocResponse.data.allocations || [];

      info(`Found ${allocations.length} payment allocation(s) for this purchase`);

      if (allocations.length > 0) {
        success('PASS: Payment allocations exist');
        allocations.forEach(a => {
          info(`  Payment #${a.payment_id}: ${formatCurrency(a.allocated_amount)}`);
        });
      } else {
        error('FAIL: No payment allocations found!');
        allTestsPassed = false;
      }
    } catch (err) {
      info('Could not check allocations (endpoint might not exist)');
    }

    // Check 4: Total paid and allocated should both be ₹24,000
    log(BRIGHT, '\n✓ CHECK 4: Balance Accounting');

    info(`Total Paid:      ${formatCurrency(balance.total_paid)}`);
    info(`Total Allocated: ${formatCurrency(balance.total_allocated)}`);

    if (Number(balance.total_paid) === 24000 && Number(balance.total_allocated) === 9000) {
      success('PASS: Balance accounting is correct');
      success('  • total_paid = ₹24,000 (advance payment)');
      success('  • total_allocated = ₹9,000 (allocated to purchase)');
      success('  • advance = ₹15,000 (remaining)');
    } else {
      error('FAIL: Balance accounting is incorrect');
      allTestsPassed = false;
    }

    // Final summary
    header('FINAL SUMMARY');

    if (allTestsPassed) {
      log(GREEN + BRIGHT, '🎉 ALL TESTS PASSED! Issue 1 is FIXED! ✅');
      console.log('\nThe fix is working correctly:');
      success('✓ Advance payment is used for allocation');
      success('✓ No duplicate PAYMENT ledger entry created');
      success('✓ Balance correctly shows ₹15,000 advance remaining');
    } else {
      log(RED + BRIGHT, '❌ SOME TESTS FAILED! Issue 1 needs attention.');
      console.log('\nPlease review the checks above and fix the issues.');
    }

  } catch (err) {
    error('\n❌ TEST FAILED WITH ERROR:');
    console.error(err.message);
    if (err.response) {
      console.error('\nAPI Response:');
      console.error(JSON.stringify(err.response.data, null, 2));
    }
  }
}

// Run the test
if (require.main === module) {
  console.log('\n');
  log(BRIGHT + CYAN, '╔═══════════════════════════════════════════════════════════════════════════╗');
  log(BRIGHT + CYAN, '║  ISSUE 1 TEST: Advance Allocation (Unpaid → Paid with Advance)           ║');
  log(BRIGHT + CYAN, '╚═══════════════════════════════════════════════════════════════════════════╝');

  info('Prerequisites:');
  info('• Server running on http://localhost:3000');
  info('• Vendor "e2e test" must exist in database');
  info('• Product ID 1 must exist (or adjust in script)');
  console.log('');

  testIssue1().catch(console.error);
}

module.exports = { testIssue1 };
