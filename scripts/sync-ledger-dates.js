const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function syncLedgerDates() {
  try {
    console.log('\n=== Syncing Ledger Dates with Payments/Refunds ===\n');

    // 1. Sync Payment dates
    console.log('Step 1: Syncing payment dates...');
    const payments = await prisma.vendor_payments.findMany({
      select: { id: true, payment_date: true, vendor_id: true }
    });

    let paymentsSynced = 0;
    for (const payment of payments) {
      // Update all ledger entries with this transaction_id
      const result = await prisma.vendor_ledger.updateMany({
        where: {
          transaction_id: payment.id,
          transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] },
          transaction_date: { not: payment.payment_date } // Only update if different
        },
        data: {
          transaction_date: payment.payment_date,
          payment_date: payment.payment_date
        }
      });

      if (result.count > 0) {
        paymentsSynced += result.count;
        console.log(`  ✓ Payment #${payment.id}: Updated ${result.count} ledger entries to ${new Date(payment.payment_date * 1000).toLocaleDateString()}`);
      }
    }

    console.log(`\nTotal payment ledger entries synced: ${paymentsSynced}`);

    // 2. Sync Refund dates
    console.log('\nStep 2: Syncing refund dates...');
    const refunds = await prisma.vendor_refunds.findMany({
      select: { id: true, refund_date: true, vendor_id: true }
    });

    let refundsSynced = 0;
    for (const refund of refunds) {
      // Update all ledger entries with this transaction_id
      const result = await prisma.vendor_ledger.updateMany({
        where: {
          transaction_id: refund.id,
          transaction_type: { in: ['REFUND_RECEIVED', 'REFUND_ADJUSTMENT'] },
          transaction_date: { not: refund.refund_date } // Only update if different
        },
        data: {
          transaction_date: refund.refund_date,
          payment_date: refund.refund_date
        }
      });

      if (result.count > 0) {
        refundsSynced += result.count;
        console.log(`  ✓ Refund #${refund.id}: Updated ${result.count} ledger entries to ${new Date(refund.refund_date * 1000).toLocaleDateString()}`);
      }
    }

    console.log(`\nTotal refund ledger entries synced: ${refundsSynced}`);

    // 3. Verification: Check Swastik Motors (vendor_id=12)
    console.log('\n=== Verification: Swastik Motors (vendor_id=12) ===\n');
    
    const swastikPayments = await prisma.vendor_payments.findMany({
      where: { vendor_id: 12 },
      select: { id: true, payment_date: true }
    });

    for (const payment of swastikPayments) {
      const ledgerEntries = await prisma.vendor_ledger.findMany({
        where: {
          transaction_id: payment.id,
          transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
        },
        select: { id: true, transaction_type: true, transaction_date: true }
      });

      console.log(`Payment #${payment.id} (${new Date(payment.payment_date * 1000).toLocaleDateString()}):`);
      ledgerEntries.forEach(entry => {
        const dateMatch = entry.transaction_date === payment.payment_date ? '✓' : '❌';
        console.log(`  ${dateMatch} Ledger ${entry.id} (${entry.transaction_type}): ${new Date(entry.transaction_date * 1000).toLocaleDateString()}`);
      });
    }

    console.log('\n✅ Sync complete! Restart server and refresh ledger pages.');

  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncLedgerDates().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
