// Moved from the test harness (2026-10-03): the assertions catch what they are for.
import { store } from '../support/dbstub.js';
import { installSqlMirror } from '../support/sqlmirror.js';
function seed(broken) {
  for (const k of Object.keys(store)) delete store[k];
Object.assign(store, {
  customer_details: [{ id: 1, billing_name: 'C', status: 'Active', account_balance: 0, total_paid: 100, total_allocated: 100, total_refunded: 0, total_refund_allocated: 0 }],
  customer_ledger: [
    { id: 1, customer_id: 1, transaction_date: 10, transaction_type: 'SALE', reference_type: 'sale', reference_id: 1, debit: 118, credit: 0, balance: 118 },
    { id: 2, customer_id: 1, transaction_date: 11, transaction_type: 'PAYMENT_RECEIVED', reference_type: 'payment', reference_id: 1, debit: 0, credit: 100, balance: broken ? 0 : 18 },
    { id: 3, customer_id: 1, transaction_date: 12, transaction_type: 'CREDIT_NOTE', reference_type: 'sale_return', reference_id: 1, debit: 0, credit: 59, balance: -41 }],
  invoice: [{ id: 1, invoice_no: 101, select_customer: 1, total: 118, payment_status: broken ? 1 : 2, return_status: broken ? 0 : 1 }],
  invoicex: [{ id: 1, invoice_no: 7, select_customer: 1, total: 50, payment_status: 0, return_status: 2 }],
  invoice_items: [{ id: 1, invoice_no: 1, qty: 2 }],
  invoice_itemsx: [{ id: 1, invoice_no: 1, qty: 1 }],
  sale_returns: [{ id: 1, invoice_id: 1, payment_status: 1, total_amount: 50, refund_amount: 59 }],
  sale_return_items: [{ id: 1, sale_return_id: 1, invoice_item_id: 1, return_qty: broken ? 3 : 1, unit_price: 50 }],
  salex_returns: [{ id: 1, invoicex_id: 1, payment_status: 0, total_amount: 0, refund_amount: 0 }], salex_return_items: [{ id: 9, salex_return_id: 1, invoice_itemx_id: 1, return_qty: 1, unit_price: 0 }],
  purchase: [{ id: 1, vendor_id: 1, invoice_no: 501, total: 100, return_status: 1 }, { id: 2, vendor_id: 2, invoice_no: 502, total: 100, return_status: broken ? 1 : 0 }],
  purchase_items: [{ id: 10, purchase_id: 1, qty: 5 }, { id: 11, purchase_id: 2, qty: 5 }],
  purchase_returns: [{ id: 1, vendor_id: 1, payment_status: 1, total_amount: 100, refund_amount: 118 }],
  purchase_return_items: [{ id: 1, purchase_return_id: 1, purchase_item_id: broken ? 11 : 10, return_qty: 1, unit_price: 100 }],
  vendor_ledger: [{ id: 1, vendor_id: 1, transaction_type: 'DEBIT_NOTE', reference_type: 'purchase_return', reference_id: 1, debit: 0, credit: broken ? 100 : 118 }],
  customer_payments: [{ id: 1, customer_id: 1, payment_amount: 100, payment_type: 'BILL_SPECIFIC' }],
  customer_payment_allocations: [{ id: 1, payment_id: 1, invoice_id: 1, invoicex_id: null, allocated_amount: broken ? 90 : 100 }],
  vendor_payments: [{ id: 1, vendor_id: 1, payment_amount: 50, payment_type: 'DIRECT' }],
  payment_allocations: [{ id: 1, payment_id: broken ? 1 : 99, purchase_id: broken ? 2 : 1, allocated_amount: broken ? 10 : 0 }],
  customer_refunds: [{ id: 1, customer_id: 1, refund_amount: 10, refund_type: 'DIRECT' }], customer_refund_allocations: [{ id: 1, refund_id: 99, allocated_amount: 0 }],
  vendor_refunds: [{ id: 1, vendor_id: 1, refund_amount: 5, refund_type: 'DIRECT' }], refund_allocations: [{ id: 1, refund_id: 99, return_id: 1, allocated_amount: 0 }]
});
if (!broken) store.vendor_payments.push({ id: 99, vendor_id: 1, payment_amount: 0, payment_type: 'X' });
if (!broken) store.vendor_refunds.push({ id: 99, vendor_id: 1, refund_amount: 0, refund_type: 'X' });
if (!broken) store.customer_refunds.push({ id: 99, customer_id: 1, refund_amount: 0, refund_type: 'X' });
store.vendor_details = [{ id: 1, vendor_name: 'V1', status: 'Active' }, { id: 2, vendor_name: 'V2', status: broken ? 'active' : 'Inactive' }];
store.product = [{ id: 1, product_name: 'P', stock: 0 }];
store.deadstock = [{ id: 1, product_id: 1, quantity: broken ? 1.5 : 2, reason: 'rust' }];
if (broken) { store.deadstock.push({ id: 2, product_id: 77, quantity: 1, reason: ' ' }); store.vendor_ledger.push({ id: 2, vendor_id: 42, transaction_type: 'PAYMENT', reference_type: 'payment', reference_id: 5, debit: 0, credit: 1 }); }
installSqlMirror(store, {}, {});
}
const audit = require('../../../scripts/audit-assert.js');
const IDS = ['A7', 'A8', 'A9', 'A10', 'A11'];
test('assertions A7-A11 pass on consistent data', async () => {
  seed(false);
  const r = await audit.run(IDS, { quiet: true });
  expect(r.map(x => [x.id, x.failures])).toEqual(IDS.map(id => [id, []]));
});
test('assertions A7-A11 each fail on data broken for them', async () => {
  seed(true);
  const r = await audit.run(IDS, { quiet: true });
  expect(r.filter(x => x.failures.length === 0).map(x => x.id)).toEqual([]);
});
