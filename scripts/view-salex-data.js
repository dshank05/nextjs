/**
 * View Salex Data Script
 * 
 * Displays all salex data from the database in a formatted table view.
 * Useful for verifying ledger entries and transactions.
 * 
 * Usage: node scripts/view-salex-data.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function viewSalexData() {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('📊 SALEX DATA VIEWER')
    console.log('='.repeat(80) + '\n')

    // 1. SALEX
    const salex = await prisma.invoicex.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🛒 SALEX: ' + salex.length + ' records')
    if (salex.length > 0) {
      console.table(salex.map(s => ({
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
      console.log('  (No salex found)\n')
    }

    // 2. SALEX ITEMS
    const items = await prisma.invoice_itemsx.findMany({
      orderBy: [{ invoice_no: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 SALEX ITEMS: ' + items.length + ' records')
    if (items.length > 0) {
      console.table(items.map(i => ({
        id: i.id,
        invoice_no: i.invoice_no,
        product: i.name_of_product,
        qty: i.qty,
        rate: i.rate,
        subtotal: i.subtotal,
        discount: i.discount
      })))
    } else {
      console.log('  (No salex items found)\n')
    }

    // 3. BILL_TO_SALESX
    const billToSalesx = await prisma.bill_tosalesx.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('📄 BILL_TO_SALESX: ' + billToSalesx.length + ' records')
    if (billToSalesx.length > 0) {
      console.table(billToSalesx.map(b => ({
        id: b.id,
        invoice_no: b.invoice_no,
        customer_name: b.billing_name,
        contact_no: b.contact_no,
        gstin: b.billing_gstin
      })))
    } else {
      console.log('  (No bill_tosalesx records found)\n')
    }

    // 4. SHIP_TOX
    const shiptox = await prisma.shiptox.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🚚 SHIP_TOX: ' + shiptox.length + ' records')
    if (shiptox.length > 0) {
      console.table(shiptox.map(s => ({
        id: s.id,
        invoice_no: s.invoice_no,
        shipping_name: s.shipping_name,
        shipping_address: s.shipping_address ? s.shipping_address.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No shiptox records found)\n')
    }

    // 5. TRANSPORT_DETAILSX
    const transportx = await prisma.transport_detailsx.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🚛 TRANSPORT_DETAILSX: ' + transportx.length + ' records')
    if (transportx.length > 0) {
      console.table(transportx.map(t => ({
        id: t.id,
        invoice_id: t.invoice_id,
        trans_mode: t.trans_mode,
        vehicle_no: t.vehicle_no
      })))
    } else {
      console.log('  (No transport_detailsx records found)\n')
    }

    // 6. SALEX RETURNS
    const returns = await prisma.salex_returns.findMany({
      orderBy: { id: 'asc' }
    })
    console.log('🔄 SALEX RETURNS: ' + returns.length + ' records')
    if (returns.length > 0) {
      console.table(returns.map(r => ({
        id: r.id,
        credit_note: `SXR-${String(r.id).padStart(3, '0')}`,
        invoicex_id: r.invoicex_id,
        total_amount: r.total_amount,
        payment_status: r.payment_status,
        payment_mode: r.payment_mode
      })))
    } else {
      console.log('  (No returns found)\n')
    }

    // 7. SALEX RETURN ITEMS
    const returnItems = await prisma.salex_return_items.findMany({
      orderBy: [{ salex_return_id: 'asc' }, { id: 'asc' }]
    })
    console.log('📦 RETURN ITEMS: ' + returnItems.length + ' records')
    if (returnItems.length > 0) {
      console.table(returnItems.map(ri => ({
        id: ri.id,
        return_id: ri.salex_return_id,
        invoice_itemx_id: ri.invoice_itemx_id,
        return_qty: ri.return_qty,
        unit_price: ri.unit_price
      })))
    } else {
      console.log('  (No return items found)\n')
    }

    // 8. CUSTOMER PAYMENTS (SALEX)
    const salexIds = salex.map(s => s.id)
    const paymentAllocations = await prisma.customer_payment_allocations.findMany({
      where: { invoicex_id: { in: salexIds } },
      select: { payment_id: true },
      distinct: ['payment_id']
    })
    const paymentIds = paymentAllocations.map(pa => pa.payment_id)
    
    const payments = await prisma.customer_payments.findMany({
      where: { id: { in: paymentIds } },
      orderBy: { id: 'asc' }
    })
    console.log('💵 CUSTOMER PAYMENTS (SALEX): ' + payments.length + ' records')
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

    // 9. PAYMENT ALLOCATIONS (SALEX)
    const salexPaymentAllocations = await prisma.customer_payment_allocations.findMany({
      where: { invoicex_id: { not: null } },
      orderBy: [{ payment_id: 'asc' }, { id: 'asc' }]
    })
    console.log('🔗 PAYMENT ALLOCATIONS (SALEX): ' + salexPaymentAllocations.length + ' records')
    if (salexPaymentAllocations.length > 0) {
      console.table(salexPaymentAllocations.map(pa => ({
        id: pa.id,
        payment_id: pa.payment_id,
        invoicex_id: pa.invoicex_id,
        allocated_amount: pa.allocated_amount,
        notes: pa.notes ? pa.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No payment allocations found)\n')
    }

    // 10. CUSTOMER REFUNDS (SALEX)
    const refundAllocations = await prisma.customer_refund_allocations.findMany({
      where: { salex_return_id: { not: null } },
      select: { refund_id: true },
      distinct: ['refund_id']
    })
    const refundIds = refundAllocations.map(ra => ra.refund_id)
    
    const refunds = await prisma.customer_refunds.findMany({
      where: { id: { in: refundIds } },
      orderBy: { id: 'asc' }
    })
    console.log('💰 CUSTOMER REFUNDS (SALEX): ' + refunds.length + ' records')
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

    // 11. REFUND ALLOCATIONS (SALEX)
    const salexRefundAllocations = await prisma.customer_refund_allocations.findMany({
      where: { salex_return_id: { not: null } },
      orderBy: [{ refund_id: 'asc' }, { id: 'asc' }]
    })
    console.log('🔗 REFUND ALLOCATIONS (SALEX): ' + salexRefundAllocations.length + ' records')
    if (salexRefundAllocations.length > 0) {
      console.table(salexRefundAllocations.map(ra => ({
        id: ra.id,
        refund_id: ra.refund_id,
        return_id: ra.salex_return_id,
        allocated_amount: ra.allocated_amount,
        notes: ra.notes ? ra.notes.substring(0, 30) : ''
      })))
    } else {
      console.log('  (No refund allocations found)\n')
    }

    // 12. CUSTOMER DETAILS - BALANCE FIELDS ⭐ CRITICAL FOR DEBUGGING
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

    // 13. CUSTOMER LEDGER (SALEX) ⭐ MOST IMPORTANT
    const ledger = await prisma.customer_ledger.findMany({
      where: { reference_type: { in: ['salex', 'salex_return'] } },
      orderBy: [
        { customer_id: 'asc' },
        { transaction_date: 'asc' },
        { id: 'asc' }
      ]
    })
    console.log('💰 CUSTOMER LEDGER (SALEX): ' + ledger.length + ' records ⭐ MOST IMPORTANT')
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
    console.error('\n❌ Error viewing salex data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
viewSalexData().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
