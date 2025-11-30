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

    console.log('Checking return tables structure and data...\n');
    console.log('='.repeat(80));

    for (const table of tables) {
      try {
        // Try to get a count from each table
        const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`\n✅ ${table.toUpperCase()}: EXISTS (${count[0].count} records)`);
        
        // Get column information
        const columns = await prisma.$queryRawUnsafe(
          `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT 
           FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = '${table}'
           ORDER BY ORDINAL_POSITION`
        );
        
        console.log('\n   Columns:');
        columns.forEach(col => {
          const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
          const defaultVal = col.COLUMN_DEFAULT ? `DEFAULT ${col.COLUMN_DEFAULT}` : '';
          const comment = col.COLUMN_COMMENT ? `-- ${col.COLUMN_COMMENT}` : '';
          console.log(`   - ${col.COLUMN_NAME.padEnd(25)} ${col.DATA_TYPE.padEnd(15)} ${nullable.padEnd(10)} ${defaultVal} ${comment}`);
        });
        
        console.log('\n' + '-'.repeat(80));
      } catch (error) {
        console.log(`\n❌ ${table.toUpperCase()}: DOES NOT EXIST OR ERROR`);
        console.log(`   Error: ${error.message}`);
        console.log('\n' + '-'.repeat(80));
      }
    }

    console.log('\n✨ Table check complete!\n');

  } catch (error) {
    console.error('Error checking tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables();
