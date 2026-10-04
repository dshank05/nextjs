// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import cpCreate from '../../../pages/api/customer-payments/index';
import cpOne from '../../../pages/api/customer-payments/[id]';
import vpCreate from '../../../pages/api/vendor-payments/index';
import vpOne from '../../../pages/api/vendor-payments/[id]';
import crCreate from '../../../pages/api/customer-refunds/index';
import crOne from '../../../pages/api/customer-refunds/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
test('payments: allocation rules', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }],
    customer_details: [{ id: 1, billing_name: 'C1', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }, { id: 2, billing_name: 'C2', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    vendor_details: [{ id: 1, vendor_name: 'V1', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    // sale #5 and Invoice C #5: same id
    invoice: [{ id: 5, invoice_no: 11, total: 100, select_customer: 1, payment_status: 0 }, { id: 6, invoice_no: 12, total: 50, select_customer: 2, payment_status: 0 }],
    invoicex: [{ id: 5, invoice_no: 3, total: 80, select_customer: 1, payment_status: 0 }],
    purchase: [{ id: 7, invoice_no: 21, total: 200, vendor_id: 1, payment_status: 0 }],
    customer_payments: [], customer_payment_allocations: [], customer_ledger: [], customer_balance_logs: [],
    vendor_payments: [], payment_allocations: [], vendor_ledger: [], vendor_balance_logs: [],
    customer_refunds: [], customer_refund_allocations: [], sale_returns: [{ id: 9, invoice_id: 5, refund_amount: 30 }], salex_returns: [{ id: 9, invoicex_id: 5, refund_amount: 20 }]
  });
  const cp = (body) => call(cpCreate, 'POST', {}, { customer_id: 1, payment_date: '2026-10-03', payment_mode: 0, ...body });
  let r = await cp({ payment_amount: 80, allocations: [{ invoicex_id: 5, allocated_amount: 80 }] });
  const p1 = store.customer_payments[0];
  ok('Invoice C payment lands on the Invoice C bill', r.status === 201 && store.customer_payment_allocations[0].invoicex_id === 5 && !store.customer_payment_allocations[0].invoice_id && store.invoicex[0].payment_status === 1 && store.invoice[0].payment_status === 0, { r, a: store.customer_payment_allocations });
  ok('type derived BILL_SPECIFIC; cash kept (0, not 1)', p1.payment_type === 'BILL_SPECIFIC' && p1.payment_mode === 0, p1);
  r = await cp({ payment_amount: 10, allocations: [{ invoicex_id: 5, allocated_amount: 10 }] });
  ok('paying a settled bill again is refused', r.status === 400 && r.body.error_code === 'OVER_BILL', r);
  r = await cp({ payment_amount: 10, allocations: [{ invoice_id: 6, allocated_amount: 10 }] });
  ok('another customer\'s bill is refused', r.status === 400 && r.body.error_code === 'FOREIGN_BILL', r);
  r = await cp({ payment_amount: 10, allocations: [{ invoice_id: 5, allocated_amount: 20 }] });
  ok('allocating more than the payment is refused', r.status === 400 && r.body.error_code === 'OVER_ALLOCATED', r);
  r = await cp({ payment_amount: 50, payment_type: 'BILL_SPECIFIC', allocations: [{ invoice_id: 5, allocated_amount: 30 }] });
  const p2 = store.customer_payments[1];
  ok('part allocated -> MIXED whatever the form said', r.status === 201 && p2.payment_type === 'MIXED' && store.invoice[0].payment_status === 2, p2);
  const c = store.customer_details[0];
  ok('counters: paid 130, allocated 110', c.total_paid === 130 && c.total_allocated === 110, c);

  // edit payment 1: move it from the Invoice C bill to sale #5 (same id)
  r = await call(cpOne, 'PUT', { id: String(p1.id) }, { payment_amount: 80, payment_date: '2026-10-03', payment_mode: 0, payment_type: 'BILL_SPECIFIC', allocations: [{ invoice_id: 5, allocated_amount: 70 }, { invoicex_id: 5, allocated_amount: 10 }] });
  ok('edit accepted', r.status === 200, r);
  ok('edit keeps kinds; both bills recalculated', store.invoice[0].payment_status === 1 && store.invoicex[0].payment_status === 2
    && store.customer_payment_allocations.some(a => a.payment_id === p1.id && a.invoicex_id === 5 && a.allocated_amount === 10), { inv: store.invoice[0], x: store.invoicex[0], a: store.customer_payment_allocations });
  r = await call(cpOne, 'PUT', { id: String(p1.id) }, { payment_amount: 80, payment_date: '2026-10-03', payment_mode: 0, allocations: [{ invoice_id: 5, allocated_amount: 75 }] });
  ok('edit beyond what is left (other payment has 30) refused', r.status === 400 && r.body.error_code === 'OVER_BILL', r);

  // vendor
  const vp = (body) => call(vpCreate, 'POST', {}, { vendor_id: 1, payment_date: '2026-10-03', payment_mode: 1, ...body });
  r = await vp({ payment_amount: 150, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: 7, allocated_amount: 150 }] });
  ok('vendor payment created', r.status === 201, r);
  r = await vp({ payment_amount: 100, allocations: [{ purchase_id: 7, allocated_amount: 100 }] });
  ok('vendor over-bill refused (was unchecked)', r.status === 400 && r.body.error_code === 'OVER_BILL', r);
  r = await vp({ payment_amount: 100, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: 7, allocated_amount: 50 }] });
  const v = store.vendor_details[0];
  ok('vendor part allocation stored MIXED; counters 250 / 200', r.status === 201 && store.vendor_payments[1].payment_type === 'MIXED' && v.total_paid === 250 && v.total_allocated === 200, { v, p: store.vendor_payments });
  r = await call(vpOne, 'PUT', { id: String(store.vendor_payments[0].id) }, { payment_amount: 150, payment_date: '2026-10-03', payment_mode: 1, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: 7, allocated_amount: 160 }] });
  ok('vendor edit over the bill refused', r.status === 400 && r.body.error_code === 'OVER_ALLOCATED', r);

  // refunds are on account now (see txcheck.js); one to delete below
  r = await call(crCreate, 'POST', {}, { customer_id: 1, refund_amount: 20, refund_mode: 0, refund_date: '2026-10-03', allocations: [] });
  ok('on-account refund created, cash kept', r.status === 201 && store.customer_refunds[0].refund_mode === 0, r);
  const rf = store.customer_refunds[0];
  store.customer_ledger.push({ id: 5000, customer_id: 1, transaction_type: 'REFUND', reference_type: 'sale_return', reference_id: 9, transaction_id: rf.id, debit: 30, credit: 0, balance: 0 });
  r = await call(crOne, 'DELETE', { id: String(rf.id) });
  ok('refund delete removes its own REFUND_PAID row, not a return\'s REFUND row with the same id', r.status === 200
    && store.customer_ledger.some(l => l.id === 5000) && !store.customer_ledger.some(l => l.transaction_type === 'REFUND_PAID' && l.transaction_id === rf.id), { r, l: store.customer_ledger.filter(l => /REFUND/.test(l.transaction_type)) });
  expect(FAILED).toEqual([]);
}, 170000);
