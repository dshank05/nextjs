const { PrismaClient } = require('@prisma/client');

async function checkAllTables() {
  const prisma = new PrismaClient();

  try {
    // List of all tables from the schema (using mapped names where specified)
    const tables = [
      'adminu',
      'settings',
      'states',
      'product',
      'invoice',
      'invoice_items',
      'purchase',
      'purchase_items',
      'incexp',
      'bank_details',
      'bill_to',
      'bill_tosales',
      'bill_tosalesx',
      'business_details',
      'customer_details',
      'financial_year',
      'incexpx',
      'invoice_itemsx',
      'invoicex',
      'migration',
      'product_category',
      'product_subcategory',
      'car_models',
      'product_company',
      'shipto',
      'shiptox',
      'transport_details',
      'transport_detailsx',
      'user',
      'vendor_details',
      'warehouse_racks',
      'warehouse',
      'gst_tax_rate',
      'staff',
      'mechanic',
      'return_reasons',
      'return_transactions',
      'sale_returns',
      'sale_return_items',
      'purchase_returns',
      'purchase_return_items',
      'salex_returns',
      'salex_return_items'
    ];

    console.log('Checking all tables for record counts...\n');

    const emptyTables = [];

    for (const table of tables) {
      try {
        const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`);
        const recordCount = parseInt(count[0].count);
        console.log(`${table}: ${recordCount} records`);

        if (recordCount === 0) {
          emptyTables.push(table);
        }
      } catch (error) {
        console.log(`❌ ${table}: ERROR - ${error.message}`);
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total tables checked: ${tables.length}`);
    console.log(`Empty tables (need AUTO_INCREMENT reset): ${emptyTables.length}`);
    console.log(`Tables with data (will be skipped): ${tables.length - emptyTables.length}`);

    if (emptyTables.length > 0) {
      console.log('\nEmpty tables that need AUTO_INCREMENT reset:');
      emptyTables.forEach(table => console.log(`- ${table}`));
    }

    return emptyTables;

  } catch (error) {
    console.error('Error checking tables:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  checkAllTables()
    .then(emptyTables => {
      console.log('\nScript completed successfully.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { checkAllTables };
