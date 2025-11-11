const { PrismaClient } = require('@prisma/client');

async function resetAutoIncrement(emptyTables) {
  const prisma = new PrismaClient();

  try {
    console.log('Resetting AUTO_INCREMENT to 1 for empty tables...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const table of emptyTables) {
      try {
        // Reset AUTO_INCREMENT to 1
        await prisma.$queryRawUnsafe(`ALTER TABLE ${table} AUTO_INCREMENT = 1`);
        console.log(`✅ ${table}: AUTO_INCREMENT reset to 1`);
        successCount++;
      } catch (error) {
        console.log(`❌ ${table}: ERROR - ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total tables processed: ${emptyTables.length}`);
    console.log(`Successfully reset: ${successCount}`);
    console.log(`Errors: ${errorCount}`);

    if (errorCount === 0) {
      console.log('\n🎉 All empty tables have been reset successfully!');
    } else {
      console.log('\n⚠️  Some tables had errors. Check the output above.');
    }

  } catch (error) {
    console.error('Error during reset process:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// List of empty tables from the check script
const emptyTables = [
  'adminu',
  'product',
  'invoice',
  'invoice_items',
  'purchase',
  'purchase_items',
  'incexp',
  'bill_to',
  'bill_tosales',
  'bill_tosalesx',
  'customer_details',
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
  'vendor_details',
  'gst_tax_rate',
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

// Run if called directly
if (require.main === module) {
  resetAutoIncrement(emptyTables)
    .then(() => {
      console.log('\nScript completed successfully.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { resetAutoIncrement };
