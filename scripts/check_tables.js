const { PrismaClient } = require('@prisma/client');

async function checkTables() {
  const prisma = new PrismaClient();

  try {
    // Check if return tables exist by trying to query them
    const tables = [
      'sale_returns',
      'purchase_returns',
      'salex_returns',
      'return_reasons',
      'sale_return_items',
      'purchase_return_items',
      'salex_return_items'
    ];

    console.log('Checking return tables existence...\n');

    for (const table of tables) {
      try {
        // Try to get a count from each table
        const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`✅ ${table}: EXISTS (${count[0].count} records)`);
      } catch (error) {
        console.log(`❌ ${table}: DOES NOT EXIST`);
      }
    }

  } catch (error) {
    console.error('Error checking tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables();
