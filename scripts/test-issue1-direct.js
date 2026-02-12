/**
 * TEST ISSUE 1: Direct Database Test (No API needed)
 * Tests advance allocation by directly calling the transaction handler
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import your actual services
const { transactionHandler } = require('../lib/transaction-handler');
const { ledgerService } = require('../lib/ledger-service');
const { balanceHandler } = require('../lib/balance-handler');

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

async function testIssue1() {
  header('TEST ISSUE 1: Unpaid Purchase → Paid with Advance');

  const VENDOR_ID = 18; // E2E Test Vendor
  const FY = 3;
  const now = Math.floor(Date.now() / 1000);

  let paymentId, purchaseId, invoiceNo;

  try {
    info(`Using Vendor ID: ${VENDOR_ID} (E2E Test Vendor)`);

    // Get initial state
    const initialLedger = await prisma.vendor_ledger.findMany({
      where: { vendor_id: VENDOR_ID },
      orderBy: { id: 'desc' },
      take: 5
    });

    const initialBalance = await prisma.vendor_details.findUnique({
      where: { id: VENDOR_ID },
      select: {
        total_paid: true,
        total_allocated: true,
        total_refunded: true,
        total_refund_allocated: true
      }
    });

    log(BRIGHT, '\n📊 INITIAL STATE');
    console.log('Ledger entries:', initialLedger.length);
    if (initialBalance) {
      console.log('Total Paid:', formatCurrency(initialBalance.total_paid || 0));
      console.log('Total Allocated:', formatCurrency(initialBalance.total_allocated || 0));
    }

    // ========================================================================
    // STEP 1: Create Advance Payment ₹24,000
    // ========================================================================
    step(1, 'Create Advance Payment ₹24,000');

    await prisma.$transaction(async (tx) => {
      // Create payment
      const payment = await tx.vendor_payments.create({
        data: {
          vendor_id: VENDOR_ID,
          payment_date: now,
          payment_amount: 24000,
          payment_mode: 1,
          payment_type: 'DIRECT',
          notes: 'Advance payment for testing',
          fy: FY
        }
      });
      paymentId = payment.id;

      // Create ledger entry
      await ledgerService.createEntry({
        vendor_id: VENDOR_ID,
        transaction_date: now,
        transaction_type: 'PAYMENT',
        reference_type: 'payment',
        reference_id: paymentId,
        reference_no: paymentId.toString(),
        payment_mode: 1,
        payment_status: 1,
        payment_date: now,
        debit: 0,
        credit: 24000,
        notes: `Direct advance payment ₹24000`,
        fy: FY,
        transaction_id: paymentId
      }, tx);

      // Update balance
      await balanceHandler.incrementBalanceInTransaction(tx, VENDOR_ID, {
        total_paid: 24000
      });
    });

    success(`Advance payment created: Payment ID ${paymentId}`);

    // Check ledger
    let ledger = await prisma.vendor_ledger.findMany({
      where: { vendor_id: VENDOR_ID },
      orderBy: { id: 'desc' },
      take: 5
    });
    console.log('\nLedger after payment:');
    console.table(ledger.map(e => ({
      ID: e.id,
      Type: e.transaction_type,
      Debit: e.debit,
      Credit: e.credit,
      Balance: e.balance
    })));

    // ========================================================================
    // STEP 2: Create Unpaid Purchase ₹9,000
    // ========================================================================
    step(2, 'Create Unpaid Purchase ₹9,000');

    await prisma.$transaction(async (tx) => {
      // Get next invoice number
      const lastPurchase = await tx.purchase.findFirst({
        orderBy: { invoice_no: 'desc' },
        select: { invoice_no: true }
      });
      invoiceNo = (lastPurchase?.invoice_no || 0) + 1;

      // Create purchase
      const purchase = await tx.purchase.create({
        data: {
          vendor_id: VENDOR_ID,
          invoice_no: invoiceNo,
          invoice_date: now,
          total: 9000,
          total_amount: 9000,
          total_tax: 0,
          payment_status: 0, // UNPAID
          payment_mode: 1,
          notes: 'Test purchase',
          fy: FY
        }
      });
      purchaseId = purchase.id;

      // Create purchase item
      await tx.purchaseitems.create({
        data: {
          invoice_no: invoiceNo,
          product_id: 1,
          name_of_product: 'Test Product',
          qty: 1,
          rate: 9000,
          subtotal: 9000,
          tax: 0,
          total: 9000
        }
      });

      // Create ledger entry
      await ledgerService.createPurchaseEntry({
        id: purchaseId,
        vendor_id: VENDOR_ID,
        invoice_no: invoiceNo,
        invoice_date: now,
        total: 9000,
        fy: FY
      }, tx);
    });

    success(`Unpaid purchase created: Purchase ID ${purchaseId}, Invoice ${invoiceNo}`);

    ledger = await prisma.vendor_ledger.findMany({
      where: { vendor_id: VENDOR_ID },
      orderBy: { id: 'desc' },
      take: 5
    });
    console.log('\nLedger after purchase:');
    console.table(ledger.map(e => ({
      ID: e.id,
      Type: e.transaction_type,
      Debit: e.debit,
      Credit: e.credit,
      Balance: e.balance,
      Notes: (e.notes || '').substring(0, 40)
    })));

    // ========================================================================
    // STEP 3: Mark Purchase as PAID (Critical Test!)
    // ========================================================================
    step(3, 'Mark Purchase as PAID (Should use advance)');

    info('This is the critical step - testing your fix...');

    // Get current balance
    const currentBalance = await prisma.vendor_details.findUnique({
      where: { id: VENDOR_ID },
      select: {
        total_paid: true,
        total_allocated: true,
        total_refunded: true,
        total_refund_allocated: true
      }
    });

    await prisma.$transaction(async (tx) => {
      // Use transaction handler to handle the status change
      const result = await transactionHandler.handlePurchaseEdit({
        oldStatus: 0,
        newStatus: 1,
        oldTotal: 9000,
        newTotal: 9000,
        vendorId: VENDOR_ID,
        purchaseId: purchaseId,
        invoiceNo: invoiceNo.toString(),
        paymentMode: 1,
        paymentDate: now,
        fy: FY,
        totalAllocated: 0,
        isTypeA: false,
        currentBalance: currentBalance
      });

      // Execute the transaction
      await transactionHandler.executeInTransaction(tx, result);

      // Update purchase status
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { payment_status: 1 }
      });
    });

    success('Purchase marked as PAID');

    // ========================================================================
    // VERIFICATION
    // ========================================================================
    header('VERIFICATION & RESULTS');

    // Get final ledger
    ledger = await prisma.vendor_ledger.findMany({
      where: { vendor_id: VENDOR_ID },
      orderBy: { id: 'asc' }
    });

    log(BRIGHT, '\n📋 FINAL LEDGER (All Entries)');
    console.table(ledger.map(e => ({
      ID: e.id,
      Type: e.transaction_type,
      Debit: e.debit ? formatCurrency(e.debit) : '-',
      Credit: e.credit ? formatCurrency(e.credit) : '-',
      Balance: formatCurrency(e.balance),
      'Txn ID': e.transaction_id || '-',
      'Ref': `${e.reference_type || ''}:${e.reference_no || ''}`,
      Notes: (e.notes || '').substring(0, 30)
    })));

    // Get final balance
    const finalBalance = await prisma.vendor_details.findUnique({
      where: { id: VENDOR_ID }
    });

    log(BRIGHT, '\n💰 FINAL BALANCE');
    console.log('Total Paid:', formatCurrency(finalBalance.total_paid));
    console.log('Total Allocated:', formatCurrency(finalBalance.total_allocated));
    const advanceBalance = (Number(finalBalance.total_paid) - Number(finalBalance.total_allocated)) +
                          (Number(finalBalance.total_refunded || 0) - Number(finalBalance.total_refund_allocated || 0));
    console.log(`${BRIGHT}Advance Balance: ${formatCurrency(advanceBalance)}${RESET}`);

    // Get payment allocations
    const allocations = await prisma.payment_allocations.findMany({
      where: {
        purchase_id: purchaseId
      }
    });

    log(BRIGHT, '\n🔗 PAYMENT ALLOCATIONS');
    console.table(allocations.map(a => ({
      ID: a.id,
      'Payment ID': a.payment_id,
      'Purchase ID': a.purchase_id,
      Amount: formatCurrency(a.allocated_amount),
      Notes: (a.notes || '').substring(0, 40)
    })));

    // Run checks
    let allPassed = true;

    log(BRIGHT, '\n✓ CHECK 1: Advance Balance');
    const expectedAdvance = 24000 - 9000;
    info(`Expected: ${formatCurrency(expectedAdvance)}`);
    info(`Actual:   ${formatCurrency(advanceBalance)}`);
    if (Math.abs(advanceBalance - expectedAdvance) < 0.01) {
      success('PASS: Advance balance is correct!');
    } else {
      error('FAIL: Advance balance is incorrect!');
      allPassed = false;
    }

    log(BRIGHT, '\n✓ CHECK 2: No Duplicate PAYMENT Entry');
    const purchasePayments = ledger.filter(e =>
      e.reference_no === invoiceNo.toString() &&
      e.transaction_type === 'PAYMENT'
    );
    info(`Found ${purchasePayments.length} PAYMENT entries for Invoice ${invoiceNo}`);

    if (purchasePayments.length === 0) {
      success('PASS: No PAYMENT ledger entry created (advance used via allocation)');
    } else if (purchasePayments.length === 1 && purchasePayments[0].credit === 0) {
      success('PASS: PAYMENT entry shows ₹0 (fully from advance)');
    } else {
      error(`FAIL: Found ${purchasePayments.length} PAYMENT entries with actual amounts!`);
      console.table(purchasePayments);
      allPassed = false;
    }

    log(BRIGHT, '\n✓ CHECK 3: Payment Allocations Exist');
    info(`Found ${allocations.length} allocation(s)`);
    if (allocations.length > 0) {
      success('PASS: Payment allocations created');
    } else {
      error('FAIL: No allocations found!');
      allPassed = false;
    }

    log(BRIGHT, '\n✓ CHECK 4: Balance Accounting');
    if (Number(finalBalance.total_paid) === 24000 && Number(finalBalance.total_allocated) === 9000) {
      success('PASS: Balance accounting correct');
      success('  • total_paid = ₹24,000');
      success('  • total_allocated = ₹9,000');
      success('  • advance = ₹15,000');
    } else {
      error('FAIL: Balance accounting incorrect');
      error(`  • total_paid = ${formatCurrency(finalBalance.total_paid)} (expected ₹24,000)`);
      error(`  • total_allocated = ${formatCurrency(finalBalance.total_allocated)} (expected ₹9,000)`);
      allPassed = false;
    }

    // Final result
    header('FINAL RESULT');
    if (allPassed) {
      log(GREEN + BRIGHT, '🎉 ALL TESTS PASSED! Issue 1 is FIXED! ✅');
    } else {
      log(RED + BRIGHT, '❌ SOME TESTS FAILED! Issue 1 needs attention.');
    }

  } catch (err) {
    error('\n❌ TEST FAILED WITH ERROR:');
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testIssue1().catch(console.error);
