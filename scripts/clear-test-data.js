/**
 * Clear Test Data Script
 * 
 * Safely clears all test data from purchase-related tables.
 * Clears in correct order to avoid foreign key constraint violations.
 * Does NOT delete vendors - they can be reused across tests.
 * 
 * Usage: node scripts/clear-test-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function clearTestData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('🧹 CLEARING TEST DATA')
    console.log('='.repeat(80) + '\n')

    console.log('⚠️  This will delete ALL data from:')
    console.log('   - payment_allocations')
    console.log('   - vendor_payments')
    console.log('   - refund_allocations')
    console.log('   - vendor_refunds')
    console.log('   - vendor_ledger')
    console.log('   - purchase_return_items')
    console.log('   - purchase_returns')
    console.log('   - purchase_items')
    console.log('   - bill_to')
    console.log('   - purchase')
    console.log('\n✅ Vendors will NOT be deleted (can be reused)\n')

    // Wait a moment for user to see the warning
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Clear in correct order to avoid FK violations
    console.log('🗑️  Clearing payment_allocations...')
    const paymentAllocations = await prisma.payment_allocations.deleteMany({})
    console.log(`   ✅ Deleted ${paymentAllocations.count} payment allocations\n`)

    console.log('🗑️  Clearing vendor_payments...')
    const payments = await prisma.vendor_payments.deleteMany({})
    console.log(`   ✅ Deleted ${payments.count} vendor payments\n`)

    console.log('🗑️  Clearing refund_allocations...')
    const refundAllocations = await prisma.refund_allocations.deleteMany({})
    console.log(`   ✅ Deleted ${refundAllocations.count} refund allocations\n`)

    console.log('🗑️  Clearing vendor_refunds...')
    const refunds = await prisma.vendor_refunds.deleteMany({})
    console.log(`   ✅ Deleted ${refunds.count} vendor refunds\n`)

    console.log('🗑️  Clearing vendor_ledger...')
    const ledger = await prisma.vendor_ledger.deleteMany({})
    console.log(`   ✅ Deleted ${ledger.count} ledger entries\n`)

    console.log('🗑️  Clearing purchase_return_items...')
    const returnItems = await prisma.purchase_return_items.deleteMany({})
    console.log(`   ✅ Deleted ${returnItems.count} return items\n`)

    console.log('🗑️  Clearing purchase_returns...')
    const returns = await prisma.purchase_returns.deleteMany({})
    console.log(`   ✅ Deleted ${returns.count} returns\n`)

    console.log('🗑️  Clearing purchase_items...')
    const items = await prisma.purchaseitems.deleteMany({})
    console.log(`   ✅ Deleted ${items.count} purchase items\n`)

    console.log('🗑️  Clearing bill_to...')
    const billTo = await prisma.bill_to.deleteMany({})
    console.log(`   ✅ Deleted ${billTo.count} bill_to records\n`)

    console.log('🗑️  Clearing purchase...')
    const purchases = await prisma.purchase.deleteMany({})
    console.log(`   ✅ Deleted ${purchases.count} purchases\n`)

    console.log('🔄 Resetting vendor balance fields...')
    const vendorUpdate = await prisma.vendor_details.updateMany({
      data: {
        total_paid: 0,
        total_allocated: 0,
        total_refunded: 0,
        total_refund_allocated: 0,
        account_balance: 0
      }
    })
    console.log(`   ✅ Reset balance fields for ${vendorUpdate.count} vendors\n`)

    console.log('='.repeat(80))
    console.log('✅ ALL TEST DATA CLEARED SUCCESSFULLY!')
    console.log('='.repeat(80))
    console.log('\n📊 Summary:')
    console.log(`   - Payment Allocations: ${paymentAllocations.count} deleted`)
    console.log(`   - Vendor Payments: ${payments.count} deleted`)
    console.log(`   - Refund Allocations: ${refundAllocations.count} deleted`)
    console.log(`   - Vendor Refunds: ${refunds.count} deleted`)
    console.log(`   - Vendor Ledger: ${ledger.count} entries deleted`)
    console.log(`   - Purchase Returns: ${returns.count} + ${returnItems.count} items deleted`)
    console.log(`   - Purchases: ${purchases.count} + ${items.count} items deleted`)
    console.log(`   - Bill To: ${billTo.count} records deleted`)
    console.log(`   - Total Deleted: ${paymentAllocations.count + payments.count + refundAllocations.count + refunds.count + ledger.count + returnItems.count + returns.count + items.count + billTo.count + purchases.count} records\n`)

  } catch (error) {
    console.error('\n❌ Error clearing test data:', error)
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
clearTestData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
