/**
 * View Test Data Script
 * 
 * Displays all test data from the database in a formatted table view.
 * Useful for verifying ledger entries after running tests.
 * 
 * Usage: node scripts/view-test-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function viewTestData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('📊 TEST DATA VIEWER')
    console.log('='.repeat(80) + '\n')

    // 1. PURCHASES
    const purchases = await prisma.purchase.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🛒 PURCHASES: ' + purchases.length + ' records')
    if (purchases.length > 0) {
      console.table(purchases.map(p => ({
        id: p.id,
        invoice_no: p.invoice_no,
        vendor_id: p.vendor_id,
        total: p.total,
        payment_status: p.payment_status,
        payment_mode: p.payment_mode,
        fy: p.fy
      })))
    } else {
      console.log('  (No purchases found)\n')
    }

    // 2. PURCHASE ITEMS
    const items = await prisma.purchaseitems.findMany({
      orderBy: [{ invoice_no: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 PURCHASE ITEMS: ' + items.length + ' records')
    if (items.length > 0) {
      console.table(items.map(i => ({
        id: i.id,
        invoice_no: i.invoice_no,
        product: i.name_of_product,
        qty: i.qty,
        rate: i.rate,
        subtotal: i.subtotal,
        tax: i.tax
      })))
    } else {
      console.log('  (No purchase items found)\n')
    }

    // 3. BILL_TO
    const billTo = await prisma.bill_to.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('📄 BILL_TO: ' + billTo.length + ' records')
    if (billTo.length > 0) {
      console.table(billTo.map(b => ({
        id: b.id,
        invoice_no: b.invoice_no,
        vendor_name: b.vendor_name,
        contact_no: b.contact_no,
        gstin: b.gstin
      })))
    } else {
      console.log('  (No bill_to records found)\n')
    }

    // 4. PURCHASE RETURNS
    const returns = await prisma.purchase_returns.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🔄 PURCHASE RETURNS: ' + returns.length + ' records')
    if (returns.length > 0) {
      console.table(returns.map(r => ({
        id: r.id,
        debit_note_no: r.debit_note_no,
        vendor_id: r.vendor_id,
        total_amount: r.total_amount,
        total_tax: r.total_tax,
        payment_status: r.payment_status,
        payment_mode: r.payment_mode
      })))
    } else {
      console.log('  (No returns found)\n')
    }

    // 5. PURCHASE RETURN ITEMS
    const returnItems = await prisma.purchase_return_items.findMany({
      orderBy: [{ purchase_return_id: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 RETURN ITEMS: ' + returnItems.length + ' records')
    if (returnItems.length > 0) {
      console.table(returnItems.map(ri => ({
        id: ri.id,
        return_id: ri.purchase_return_id,
        purchase_item_id: ri.purchase_item_id,
        return_qty: ri.return_qty,
        unit_price: ri.unit_price,
        tax_amount: ri.tax_amount
      })))
    } else {
      console.log('  (No return items found)\n')
    }

    // 6. VENDOR LEDGER ⭐ MOST IMPORTANT
    const ledger = await prisma.vendor_ledger.findMany({
      orderBy: [
        { vendor_id: 'asc' },
        { transaction_date: 'asc' },
        { id: 'asc' }
      ]
    })
    console.log('💰 VENDOR LEDGER: ' + ledger.length + ' records ⭐ MOST IMPORTANT')
    if (ledger.length > 0) {
      console.table(ledger.map(l => ({
        id: l.id,
        vendor_id: l.vendor_id,
        type: l.transaction_type,
        debit: l.debit,
        credit: l.credit,
        balance: l.balance,
        ref_type: l.reference_type,
        ref_no: l.reference_no,
        notes: l.notes ? l.notes.substring(0, 60) + (l.notes.length > 60 ? '...' : '') : ''
      })))

      // Calculate final balance per vendor
      console.log('\n📊 BALANCE SUMMARY PER VENDOR:')
      const balanceByVendor = ledger.reduce((acc, entry) => {
        if (!acc[entry.vendor_id]) {
          acc[entry.vendor_id] = 0
        }
        acc[entry.vendor_id] = entry.balance
        return acc
      }, {})
      
      console.table(Object.entries(balanceByVendor).map(([vendor_id, balance]) => ({
        vendor_id: parseInt(vendor_id),
        final_balance: balance,
        status: balance === 0 ? '✅ Settled' : balance > 0 ? '⚠️ Outstanding' : '💰 Credit'
      })))
    } else {
      console.log('  (No ledger entries found)\n')
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ Data viewing complete!')
    console.log('='.repeat(80) + '\n')

  } catch (error) {
    console.error('\n❌ Error viewing test data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
viewTestData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
