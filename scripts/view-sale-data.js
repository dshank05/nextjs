/**
 * View Sale Data Script
 * 
 * Displays all sale data from the database in a formatted table view.
 * Useful for verifying ledger entries and transactions.
 * 
 * Usage: node scripts/view-sale-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function viewSaleData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('📊 SALE DATA VIEWER')
    console.log('='.repeat(80) + '\n')

    // 1. SALES
    const sales = await prisma.invoice.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🛒 SALES: ' + sales.length + ' records')
    if (sales.length > 0) {
      console.table(sales.map(s => ({
        id: s.id,
        invoice_no: s.invoice_no,
        customer_id: s.select_customer,
        total: s.total,
        payment_status: s.payment_status,
        payment_mode: s.payment_mode,
        return_status: s.return_status,
        fy: s.fy
      })))
    } else {
      console.log('  (No sales found)\n')
    }

    // 2. SALE ITEMS
    const items = await prisma.invoiceitems.findMany({
      orderBy: [{ invoice_no: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 SALE ITEMS: ' + items.length + ' records')
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
      console.log('  (No sale items found)\n')
    }

    // 3. BILL_TO_SALES
    const billToSales = await prisma.bill_tosales.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('📄 BILL_TO_SALES: ' + billToSales.length + ' records')
    if (billToSales.length > 0) {
      console.table(billToSales.map(b => ({
        id: b.id,
        invoice_no: b.invoice_no,
        customer_name: b.billing_name,
        contact_no: b.contact_no,
        gstin: b.billing_gstin
      })))
    } else {
      console.log('  (No bill_tosales records found)\n')
    }

    // 4. SALE RETURNS
    const returns = await prisma.sale_returns.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🔄 SALE RETURNS: ' + returns.length + ' records')
    if (returns.length > 0) {
      console.table(returns.map(r => ({
        id: r.id,
        credit_note: `SR-${String(r.id).padStart(3, '0')}`,
        invoice_id: r.invoice_id,
        total_amount: r.total_amount,
        total_tax: r.total_tax,
        payment_status: r.payment_status,
        payment_mode: r.payment_mode
      })))
    } else {
      console.log('  (No returns found)\n')
    }

    // 5. SALE RETURN ITEMS
    const returnItems = await prisma.sale_return_items.findMany({
      orderBy: [{ sale_return_id: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 RETURN ITEMS: ' + returnItems.length + ' records')
    if (returnItems.length > 0) {
      console.table(returnItems.map(ri => ({
        id: ri.id,
        return_id: ri.sale_return_id,
        invoice_item_id: ri.invoice_item_id,
        return_qty: ri.return_qty,
        unit_price: ri.unit_price,
        tax_amount: ri.tax_amount
      })))
    } else {
      console.log('  (No return items found)\n')
    }

    // 6. CUSTOMER PAYMENTS
    const payments = await prisma.customer_payments.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('💵 CUSTOMER PAYMENTS: ' + payments.length + ' records')
    if (payments.length > 0) {
      console.table(payments.map(p => ({
        id: p.id,
        customer_id: p.customer_id,
        payment_date: new Date(p.payment_date * 1000).toLocaleDateString(),
        amount: p.payment_amount,
        mode: p.payment_mode === 0 ? 'Cash' : 'Bank',
        type: p.payment_type,
        notes: p.notes ? p.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No customer payments found)\n')
    }

    // 7. PAYMENT ALLOCATIONS
    const paymentAllocations = await prisma.customer_payment_allocations.findMany({
      where: { invoice_id: { not: null } },
      orderBy: [{ payment_id: 'asc' }, { id: 'asc' }]
    })
    console.log('🔗 PAYMENT ALLOCATIONS: ' + paymentAllocations.length + ' records')
    if (paymentAllocations.length > 0) {
      console.table(paymentAllocations.map(pa => ({
        id: pa.id,
        payment_id: pa.payment_id,
        invoice_id: pa.invoice_id,
        allocated_amount: pa.allocated_amount,
        notes: pa.notes ? pa.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No payment allocations found)\n')
    }

    // 8. CUSTOMER REFUNDS
    const refunds = await prisma.customer_refunds.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('💰 CUSTOMER REFUNDS: ' + refunds.length + ' records')
    if (refunds.length > 0) {
      console.table(refunds.map(r => ({
        id: r.id,
        customer_id: r.customer_id,
        refund_date: new Date(r.refund_date * 1000).toLocaleDateString(),
        amount: r.refund_amount,
        mode: r.refund_mode === 0 ? 'Cash' : 'Bank',
        type: r.refund_type,
        notes: r.notes ? r.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No customer refunds found)\n')
    }

    // 9. REFUND ALLOCATIONS
    const refundAllocations = await prisma.customer_refund_allocations.findMany({
      where: { sale_return_id: { not: null } },
      orderBy: [{ refund_id: 'asc' }, { id: 'asc' }]
    })
    console.log('🔗 REFUND ALLOCATIONS: ' + refundAllocations.length + ' records')
    if (refundAllocations.length > 0) {
      console.table(refundAllocations.map(ra => ({
        id: ra.id,
        refund_id: ra.refund_id,
        return_id: ra.sale_return_id,
        allocated_amount: ra.allocated_amount,
        notes: ra.notes ? ra.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No refund allocations found)\n')
    }

    // 10. CUSTOMER DETAILS - BALANCE FIELDS ⭐ CRITICAL FOR DEBUGGING
    const customers = await prisma.customer_details.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        billing_name: true,
        total_paid: true,
        total_allocated: true,
        total_refunded: true,
        total_refund_allocated: true
      }
    })
    console.log('👥 CUSTOMER BALANCE FIELDS: ' + customers.length + ' customers ⭐ CRITICAL FOR DEBUGGING')
    if (customers.length > 0) {
      console.table(customers.map(c => ({
        id: c.id,
        name: c.billing_name ? c.billing_name.substring(0, 20) : '',
        total_paid: c.total_paid,
        total_allocated: c.total_allocated,
        payment_adv: Number(c.total_paid) - Number(c.total_allocated),
        total_refunded: c.total_refunded,
        total_refund_alloc: c.total_refund_allocated,
        refund_adv: Number(c.total_refunded) - Number(c.total_refund_allocated),
        calc_advance: (Number(c.total_paid) - Number(c.total_allocated)) + 
                       (Number(c.total_refunded) - Number(c.total_refund_allocated))
      })))
    } else {
      console.log('  (No customers found)\n')
    }

    // 11. CUSTOMER LEDGER ⭐ MOST IMPORTANT
    const ledger = await prisma.customer_ledger.findMany({
      where: { reference_type: { in: ['sale', 'sale_return'] } },
      orderBy: [
        { customer_id: 'asc' },
        { transaction_date: 'asc' },
        { id: 'asc' }
      ]
    })
    console.log('💰 CUSTOMER LEDGER (SALE): ' + ledger.length + ' records ⭐ MOST IMPORTANT')
    if (ledger.length > 0) {
      console.table(ledger.map(l => ({
        id: l.id,
        customer_id: l.customer_id,
        type: l.transaction_type,
        debit: l.debit,
        credit: l.credit,
        balance: l.balance,
        ref_type: l.reference_type,
        ref_no: l.reference_no,
        notes: l.notes ? l.notes.substring(0, 60) + (l.notes.length > 60 ? '...' : '') : ''
      })))

      // Calculate final balance per customer
      console.log('\n📊 BALANCE SUMMARY PER CUSTOMER:')
      const balanceByCustomer = ledger.reduce((acc, entry) => {
        if (!acc[entry.customer_id]) {
          acc[entry.customer_id] = 0
        }
        acc[entry.customer_id] = entry.balance
        return acc
      }, {})
      
      console.table(Object.entries(balanceByCustomer).map(([customer_id, balance]) => ({
        customer_id: parseInt(customer_id),
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
    console.error('\n❌ Error viewing sale data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
viewSaleData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
