const { PrismaClient } = require('@prisma/client');

async function checkOrphanedVendors() {
  const prisma = new PrismaClient();

  try {
    console.log('Checking for orphaned vendor references in purchase table...\n');
    
    // Find purchases with vendor_id that don't exist in vendor_details
    const orphaned = await prisma.$queryRaw`
      SELECT p.id, p.invoice_no, p.vendor_id, p.invoice_date
      FROM purchase p
      LEFT JOIN vendor_details v ON p.vendor_id = v.id
      WHERE p.vendor_id IS NOT NULL AND v.id IS NULL
    `;

    if (orphaned.length === 0) {
      console.log('✅ No orphaned vendor references found!');
      console.log('   All purchases with vendor_id have valid references.');
      console.log('   ✨ Database is clean - prisma db push should work now!\n');
    } else {
      console.log(`❌ Found ${orphaned.length} orphaned purchase records:\n`);
      orphaned.forEach(record => {
        console.log(`   - Purchase ID: ${record.id}`);
        console.log(`     Invoice No: ${record.invoice_no}`);
        console.log(`     Invalid vendor_id: ${record.vendor_id}`);
        console.log(`     Date: ${new Date(record.invoice_date * 1000).toLocaleDateString()}`);
        console.log('');
      });
      
      console.log('⚠️  These records prevent prisma db push from adding foreign key constraints.');
      console.log('\n📝 To fix, you can either:');
      console.log('   1. Set vendor_id to NULL for these records');
      console.log('   2. Delete these records if they are test data');
      console.log('   3. Create the missing vendor records\n');
    }

    // Also check total purchases
    const totalPurchases = await prisma.purchase.count();
    const purchasesWithVendor = await prisma.purchase.count({
      where: { vendor_id: { not: null } }
    });
    
    console.log('📊 Purchase Statistics:');
    console.log(`   Total purchases: ${totalPurchases}`);
    console.log(`   Purchases with vendor: ${purchasesWithVendor}`);
    console.log(`   Purchases without vendor: ${totalPurchases - purchasesWithVendor}`);
    console.log(`   Orphaned vendor references: ${orphaned.length}\n`);

  } catch (error) {
    console.error('Error checking orphaned vendors:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkOrphanedVendors();
