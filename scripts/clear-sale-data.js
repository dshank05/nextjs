/**
 * Clear Sale Data Script
 * 
 * Safely clears all test data from sale-related tables.
 * Clears in correct order to avoid foreign key constraint violations.
 * Does NOT delete customers - they can be reused across tests.
 * 
 * Usage: node scripts/clear-sale-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function clearSaleData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('🧹 CLEARING SALE DATA')
    console.log('='.repeat(80) + '\n')

    console.log('⚠️  This will delete ALL data from:')
    console.log('   - customer_payment_allocations')
    console.log('   - customer_payments')
    console.log('   - customer_refund_allocations')
    console.log('   - customer_refunds')
    console.log('   - customer_ledger')
    console.log('   - sale_return_items')
    console.log('   - sale_returns')
    console.log('   - invoiceitems')
    console.log('   - bill_tosales')
    console.log('   - shipto')
    console.log('   - invoice')
    console.log('\n✅ Customers will NOT be deleted (can be reused)\n')

    // Wait a moment for user to see the warning
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Clear in correct order to avoid FK violations
    console.log('🗑️  Clearing customer_payment_allocations...')
    const paymentAllocations = await prisma.customer_payment_allocations.deleteMany({})
    console.log(`   ✅ Deleted ${paymentAllocations.count} payment allocations\n`)

    console.log('🗑️  Clearing customer_payments...')
    const payments = await prisma.customer_payments.deleteMany({})
    console.log(`   ✅ Deleted ${payments.count} customer payments\n`)

    console.log('🗑️  Clearing customer_refund_allocations...')
    const refundAllocations = await prisma.customer_refund_allocations.deleteMany({})
    console.log(`   ✅ Deleted ${refundAllocations.count} refund allocations\n`)

    console.log('🗑️  Clearing customer_refunds...')
    const refunds = await prisma.customer_refunds.deleteMany({})
    console.log(`   ✅ Deleted ${refunds.count} customer refunds\n`)

    console.log('🗑️  Clearing customer_ledger...')
    const ledger = await prisma.customer_ledger.deleteMany({})
    console.log(`   ✅ Deleted ${ledger.count} ledger entries\n`)

    console.log('🗑️  Clearing sale_return_items...')
    const returnItems = await prisma.sale_return_items.deleteMany({})
    console.log(`   ✅ Deleted ${returnItems.count} return items\n`)

    console.log('🗑️  Clearing sale_returns...')
    const returns = await prisma.sale_returns.deleteMany({})
    console.log(`   ✅ Deleted ${returns.count} returns\n`)

    console.log('🗑️  Clearing invoiceitems...')
    const items = await prisma.invoiceitems.deleteMany({})
    console.log(`   ✅ Deleted ${items.count} invoice items\n`)

    console.log('🗑️  Clearing bill_tosales...')
    const billToSales = await prisma.bill_tosales.deleteMany({})
    console.log(`   ✅ Deleted ${billToSales.count} bill_tosales records\n`)

    console.log('🗑️  Clearing shipto...')
    const shipto = await prisma.shipto.deleteMany({})
    console.log(`   ✅ Deleted ${shipto.count} shipto records\n`)

    console.log('🗑️  Clearing invoice...')
    const invoices = await prisma.invoice.deleteMany({})
    console.log(`   ✅ Deleted ${invoices.count} invoices\n`)

    console.log('🔄 Resetting customer balance fields...')
    const customerUpdate = await prisma.customer_details.updateMany({
      data: {
        total_paid: 0,
        total_allocated: 0,
        total_refunded: 0,
        total_refund_allocated: 0
      }
    })
    console.log(`   ✅ Reset balance fields for ${customerUpdate.count} customers\n`)

    console.log('='.repeat(80))
    console.log('✅ ALL SALE DATA CLEARED SUCCESSFULLY!')
    console.log('='.repeat(80))
    console.log('\n📊 Summary:')
    console.log(`   - Payment Allocations: ${paymentAllocations.count} deleted`)
    console.log(`   - Customer Payments: ${payments.count} deleted`)
    console.log(`   - Refund Allocations: ${refundAllocations.count} deleted`)
    console.log(`   - Customer Refunds: ${refunds.count} deleted`)
    console.log(`   - Customer Ledger: ${ledger.count} entries deleted`)
    console.log(`   - Sale Returns: ${returns.count} + ${returnItems.count} items deleted`)
    console.log(`   - Sales: ${invoices.count} + ${items.count} items deleted`)
    console.log(`   - Bill To Sales: ${billToSales.count} records deleted`)
    console.log(`   - Ship To: ${shipto.count} records deleted`)
    console.log(`   - Total Deleted: ${paymentAllocations.count + payments.count + refundAllocations.count + refunds.count + ledger.count + returnItems.count + returns.count + items.count + billToSales.count + shipto.count + invoices.count} records\n`)

  } catch (error) {
    console.error('\n❌ Error clearing sale data:', error)
    console.error('\nThis might be due to:')
    console.error('  - Foreign key constraints')
    console.error('  - Database connection issues')
    console.error('  - Insufficient permissions\n')
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
clearSaleData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
