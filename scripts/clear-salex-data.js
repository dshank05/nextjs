/**
 * Clear Salex Data Script
 * 
 * Safely clears all test data from salex-related tables.
 * Clears in correct order to avoid foreign key constraint violations.
 * Does NOT delete customers - they can be reused across tests.
 * 
 * Usage: node scripts/clear-salex-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function clearSalexData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('🧹 CLEARING SALEX DATA')
    console.log('='.repeat(80) + '\n')

    console.log('⚠️  This will delete ALL data from:')
    console.log('   - customer_payment_allocations (salex)')
    console.log('   - customer_payments (salex)')
    console.log('   - customer_refund_allocations (salex)')
    console.log('   - customer_refunds (salex)')
    console.log('   - customer_ledger (salex)')
    console.log('   - salex_return_items')
    console.log('   - salex_returns')
    console.log('   - invoice_itemsx')
    console.log('   - bill_tosalesx')
    console.log('   - shiptox')
    console.log('   - transport_detailsx')
    console.log('   - invoicex')
    console.log('\n✅ Customers will NOT be deleted (can be reused)\n')

    // Wait a moment for user to see the warning
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Get all salex IDs first
    const allSalex = await prisma.invoicex.findMany({
      select: { id: true }
    })
    const salexIds = allSalex.map(s => s.id)

    // Clear in correct order to avoid FK violations
    console.log('🗑️  Clearing customer_payment_allocations (salex only)...')
    const paymentAllocations = await prisma.customer_payment_allocations.deleteMany({
      where: { invoicex_id: { in: salexIds } }
    })
    console.log(`   ✅ Deleted ${paymentAllocations.count} payment allocations\n`)

    console.log('🗑️  Clearing customer_payments (salex only)...')
    // Get payment IDs that are only for salex
    const salexPayments = await prisma.customer_payment_allocations.findMany({
      where: { invoicex_id: { in: salexIds } },
      select: { payment_id: true },
      distinct: ['payment_id']
    })
    const salexPaymentIds = salexPayments.map(p => p.payment_id)
    const payments = await prisma.customer_payments.deleteMany({
      where: { id: { in: salexPaymentIds } }
    })
    console.log(`   ✅ Deleted ${payments.count} customer payments\n`)

    console.log('🗑️  Clearing customer_refund_allocations (salex only)...')
    const refundAllocations = await prisma.customer_refund_allocations.deleteMany({
      where: { salex_return_id: { not: null } }
    })
    console.log(`   ✅ Deleted ${refundAllocations.count} refund allocations\n`)

    console.log('🗑️  Clearing customer_refunds (salex only)...')
    // Get refund IDs that are only for salex
    const salexRefunds = await prisma.customer_refund_allocations.findMany({
      where: { salex_return_id: { not: null } },
      select: { refund_id: true },
      distinct: ['refund_id']
    })
    const salexRefundIds = salexRefunds.map(r => r.refund_id)
    const refunds = await prisma.customer_refunds.deleteMany({
      where: { id: { in: salexRefundIds } }
    })
    console.log(`   ✅ Deleted ${refunds.count} customer refunds\n`)

    console.log('🗑️  Clearing customer_ledger (salex only)...')
    const ledger = await prisma.customer_ledger.deleteMany({
      where: { reference_type: { in: ['salex', 'salex_return'] } }
    })
    console.log(`   ✅ Deleted ${ledger.count} ledger entries\n`)

    console.log('🗑️  Clearing salex_return_items...')
    const returnItems = await prisma.salex_return_items.deleteMany({})
    console.log(`   ✅ Deleted ${returnItems.count} return items\n`)

    console.log('🗑️  Clearing salex_returns...')
    const returns = await prisma.salex_returns.deleteMany({})
    console.log(`   ✅ Deleted ${returns.count} returns\n`)

    console.log('🗑️  Clearing invoice_itemsx...')
    const items = await prisma.invoice_itemsx.deleteMany({})
    console.log(`   ✅ Deleted ${items.count} invoice items\n`)

    console.log('🗑️  Clearing bill_tosalesx...')
    const billToSalesx = await prisma.bill_tosalesx.deleteMany({})
    console.log(`   ✅ Deleted ${billToSalesx.count} bill_tosalesx records\n`)

    console.log('🗑️  Clearing shiptox...')
    const shiptox = await prisma.shiptox.deleteMany({})
    console.log(`   ✅ Deleted ${shiptox.count} shiptox records\n`)

    console.log('🗑️  Clearing transport_detailsx...')
    const transportx = await prisma.transport_detailsx.deleteMany({})
    console.log(`   ✅ Deleted ${transportx.count} transport_detailsx records\n`)

    console.log('🗑️  Clearing invoicex...')
    const invoicex = await prisma.invoicex.deleteMany({})
    console.log(`   ✅ Deleted ${invoicex.count} invoicex\n`)

    console.log('🔄 Resetting customer balance fields (if needed)...')
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
    console.log('✅ ALL SALEX DATA CLEARED SUCCESSFULLY!')
    console.log('='.repeat(80))
    console.log('\n📊 Summary:')
    console.log(`   - Payment Allocations: ${paymentAllocations.count} deleted`)
    console.log(`   - Customer Payments: ${payments.count} deleted`)
    console.log(`   - Refund Allocations: ${refundAllocations.count} deleted`)
    console.log(`   - Customer Refunds: ${refunds.count} deleted`)
    console.log(`   - Customer Ledger: ${ledger.count} entries deleted`)
    console.log(`   - Salex Returns: ${returns.count} + ${returnItems.count} items deleted`)
    console.log(`   - Salex: ${invoicex.count} + ${items.count} items deleted`)
    console.log(`   - Bill To Salesx: ${billToSalesx.count} records deleted`)
    console.log(`   - Ship Tox: ${shiptox.count} records deleted`)
    console.log(`   - Transport Detailsx: ${transportx.count} records deleted`)
    console.log(`   - Total Deleted: ${paymentAllocations.count + payments.count + refundAllocations.count + refunds.count + ledger.count + returnItems.count + returns.count + items.count + billToSalesx.count + shiptox.count + transportx.count + invoicex.count} records\n`)

  } catch (error) {
    console.error('\n❌ Error clearing salex data:', error)
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
clearSalexData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
