const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixTransactionIds() {
  try {
    console.log('\n=== Fixing transaction_id for PAYMENT_ADJUSTMENT and REFUND_ADJUSTMENT entries ===\n');

    // Get all PAYMENT_ADJUSTMENT entries without transaction_id
    const paymentAdjustments = await prisma.vendor_ledger.findMany({
      where: {
        transaction_type: 'PAYMENT_ADJUSTMENT',
        transaction_id: null,
        reference_no: { startsWith: 'PAY-' }
      },
      select: { id: true, reference_no: true, vendor_id: true }
    });

    console.log(`Found ${paymentAdjustments.length} PAYMENT_ADJUSTMENT entries to fix`);

    // Update PAYMENT_ADJUSTMENT entries
    for (const entry of paymentAdjustments) {
      // Extract payment_id from reference_no (e.g., 'PAY-150' -> 150)
      const paymentId = parseInt(entry.reference_no.substring(4));
      
      await prisma.vendor_ledger.update({
        where: { id: entry.id },
        data: { transaction_id: paymentId }
      });
      
      console.log(`  ✓ Updated entry ${entry.id}: transaction_id set to ${paymentId}`);
    }

    // Get all REFUND_ADJUSTMENT entries without transaction_id
    const refundAdjustments = await prisma.vendor_ledger.findMany({
      where: {
        transaction_type: 'REFUND_ADJUSTMENT',
        transaction_id: null,
        reference_no: { startsWith: 'REF-' }
      },
      select: { id: true, reference_no: true, vendor_id: true }
    });

    console.log(`\nFound ${refundAdjustments.length} REFUND_ADJUSTMENT entries to fix`);

    // Update REFUND_ADJUSTMENT entries
    for (const entry of refundAdjustments) {
      // Extract refund_id from reference_no (e.g., 'REF-150' -> 150)
      const refundId = parseInt(entry.reference_no.substring(4));
      
      await prisma.vendor_ledger.update({
        where: { id: entry.id },
        data: { transaction_id: refundId }
      });
      
      console.log(`  ✓ Updated entry ${entry.id}: transaction_id set to ${refundId}`);
    }

    // Verify: Check Arnav Motors (vendor_id=6) entries
    console.log('\n=== Verification: Arnav Motors (vendor_id=6) Ledger ===\n');
    const arnavEntries = await prisma.vendor_ledger.findMany({
      where: {
        vendor_id: 6,
        transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
      },
      select: {
        id: true,
        transaction_type: true,
        transaction_id: true,
        reference_no: true,
        credit: true,
        transaction_date: true
      },
      orderBy: { id: 'asc' }
    });

    console.table(arnavEntries.map(e => ({
      id: e.id,
      type: e.transaction_type,
      transaction_id: e.transaction_id,
      ref_no: e.reference_no,
      credit: e.credit,
      date: new Date(e.transaction_date * 1000).toLocaleDateString()
    })));

    console.log('\n✅ Fix complete! Refresh the UI to see separate payment entries.');

  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixTransactionIds().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
