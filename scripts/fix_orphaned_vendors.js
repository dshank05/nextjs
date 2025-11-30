const { PrismaClient } = require('@prisma/client');

async function fixOrphanedVendors() {
  const prisma = new PrismaClient();

  try {
    console.log('Fixing orphaned vendor references in purchase table...\n');
    
    // Find orphaned records
    const orphaned = await prisma.$queryRaw`
      SELECT p.id, p.invoice_no, p.vendor_id
      FROM purchase p
      LEFT JOIN vendor_details v ON p.vendor_id = v.id
      WHERE p.vendor_id IS NOT NULL AND v.id IS NULL
    `;

    if (orphaned.length === 0) {
      console.log('✅ No orphaned vendor references found - nothing to fix!\n');
      return;
    }

    console.log(`Found ${orphaned.length} orphaned records. Fixing...\n`);

    // Fix by setting vendor_id to NULL
    const result = await prisma.$executeRaw`
      UPDATE purchase p
      LEFT JOIN vendor_details v ON p.vendor_id = v.id
      SET p.vendor_id = NULL
      WHERE p.vendor_id IS NOT NULL AND v.id IS NULL
    `;

    console.log(`✅ Fixed ${result} purchase records`);
    console.log('   Set vendor_id to NULL for purchases with invalid vendor references\n');

    // Verify fix
    const remainingOrphaned = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM purchase p
      LEFT JOIN vendor_details v ON p.vendor_id = v.id
      WHERE p.vendor_id IS NOT NULL AND v.id IS NULL
    `;

    if (remainingOrphaned[0].count === 0) {
      console.log('✨ All orphaned references fixed successfully!');
      console.log('   You can now run: npx prisma db push\n');
    } else {
      console.log(`⚠️  Still have ${remainingOrphaned[0].count} orphaned references`);
    }

  } catch (error) {
    console.error('❌ Error fixing orphaned vendors:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixOrphanedVendors();
