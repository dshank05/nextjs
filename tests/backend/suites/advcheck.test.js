// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { createSale } from '../../../lib/sale-create';
import { updateSale } from '../../../lib/sale-edit';
import { deleteSale } from '../../../lib/sale-delete';
import { updatePurchase } from '../../../lib/purchase-edit';
import { transactionHandler } from '../../../lib/transaction-handler';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],
    customer_details: [{ id: 1, billing_name: 'C', billing_state_code: 9, total_paid: 300, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    customer_payments: [{ id: 50, customer_id: 1, payment_amount: 300, payment_type: 'DIRECT', payment_date: 1 }],
    customer_payment_allocations: [], product: [{ id: 1, product_name: 'P', stock: 100 }],
    invoice: [], invoiceitems: [], bill_tosales: [], shipto: [], transport_details: [], customer_ledger: [], customer_balance_logs: [],
    sale_return_items: [], sale_returns: [], invoicex: [], invoice_itemsx: [], salex_return_items: [], salex_returns: [], bill_tosalesx: [], shiptox: [], transport_detailsx: [], incexpx: [],
  });
};
const body = (extra = {}) => ({ select_customer: 1, date: '2026-10-02', payment_status: 1, payment_mode: 0, invoiceItems: [{ product_id: 1, qty: 1, rate: 500 }], ...extra });
const cust = () => store.customer_details[0];
test('customer advance allocation', async () => {
  // paid sale of 500 with a 300 advance: advance allocated from payment #50, 200 new
  reset();
  await createSale('sale', body());
  const id = store.invoice[0].id;
  ok('advance allocated from the existing payment, no new advance row', store.customer_payments.length === 2 && store.customer_payment_allocations.some(a => a.payment_id === 50 && a.allocated_amount === 300), store.customer_payments);
  ok('old advance now MIXED', store.customer_payments.find(p => p.id === 50).payment_type === 'MIXED');
  ok('counters after create', cust().total_paid === 500 && cust().total_allocated === 500, cust());
  // delete: only the 200 goes; the 300 advance stays paid and becomes unallocated
  await deleteSale('sale', id);
  ok('SA-28: delete removes only the money paid with the bill', cust().total_paid === 300 && cust().total_allocated === 0, cust());
  ok('advance row kept, back to DIRECT', store.customer_payments.length === 1 && store.customer_payments[0].payment_type === 'DIRECT', store.customer_payments);

  // unmark on edit keeps the customer's advance row
  reset();
  await createSale('sale', body());
  await updateSale('sale', store.invoice[0].id, { payment_status: 0 });
  ok('unmark keeps the advance payment row', store.customer_payments.some(p => p.id === 50 && p.payment_type === 'DIRECT') && !store.customer_payments.some(p => p.id !== 50), store.customer_payments);
  ok('unmark counters: advance intact', cust().total_paid === 300 && cust().total_allocated === 0, cust());

  // mark paid on edit uses the advance the same way
  reset();
  await createSale('sale', body({ payment_status: 0 }));
  await updateSale('sale', store.invoice[0].id, { payment_status: 1, payment_mode: 0 });
  ok('paid on edit: advance allocated from #50, new money BILL_SPECIFIC', store.customer_payment_allocations.some(a => a.payment_id === 50 && a.allocated_amount === 300)
    && store.customer_payments.filter(p => p.id !== 50).every(p => p.payment_type === 'BILL_SPECIFIC'), store.customer_payments);

  // counters claim more advance than the rows hold: carried as a MIXED row
  reset();
  cust().total_paid = 400; // 100 more than the rows
  await createSale('sale', body());
  const carried = store.customer_payments.find(p => /carried/.test(p.notes || ''));
  ok('row shortfall carried as MIXED, fully allocated', carried && carried.payment_amount === 100 && carried.payment_type === 'MIXED', store.customer_payments);
  expect(FAILED).toEqual([]);
}, 170000);
