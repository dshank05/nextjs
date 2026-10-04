// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import custList from '../../../pages/api/customer-transactions/index';
import vendList from '../../../pages/api/vendor-transactions/index';
import cpCreate from '../../../pages/api/customer-payments/index';
import cpOne from '../../../pages/api/customer-payments/[id]';
import crCreate from '../../../pages/api/customer-refunds/index';
import crOne from '../../../pages/api/customer-refunds/[id]';
import vrCreate from '../../../pages/api/vendor-refunds/index';
import vpCreate from '../../../pages/api/vendor-payments/index';
import vpOne from '../../../pages/api/vendor-payments/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
// relation includes for the list: attach customer/vendor and allocations
const T = (globalThis.__STORE);
test('party transactions', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }],
    customer_details: [{ id: 1, billing_name: 'C1', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    vendor_details: [{ id: 1, vendor_name: 'V1', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    invoice: [{ id: 5, invoice_no: 11, total: 100, select_customer: 1, payment_status: 0 }],
    invoicex: [{ id: 5, invoice_no: 3, total: 80, select_customer: 1, payment_status: 0 }],
    purchase: [{ id: 7, invoice_no: 21, total: 200, vendor_id: 1, payment_status: 0 }],
    customer_payments: [], customer_payment_allocations: [], customer_ledger: [], customer_balance_logs: [],
    vendor_payments: [], payment_allocations: [], vendor_ledger: [], vendor_balance_logs: [],
    customer_refunds: [], customer_refund_allocations: [], vendor_refunds: [], refund_allocations: [],
    sale_returns: [{ id: 9, invoice_id: 5, refund_amount: 30, payment_status: 0 }], salex_returns: [], purchase_returns: [{ id: 4, vendor_id: 1, refund_amount: 50, payment_status: 0 }]
  });
  const cp = (body) => call(cpCreate, 'POST', {}, { customer_id: 1, payment_date: '2026-10-03', ...body });
  await cp({ payment_amount: 100, payment_mode: 0, allocations: [{ invoice_id: 5, allocated_amount: 100 }] });
  await cp({ payment_amount: 80, payment_mode: 1, allocations: [{ invoicex_id: 5, allocated_amount: 80 }] });
  let r = await call(crCreate, 'POST', {}, { customer_id: 1, refund_amount: 30, refund_mode: 0, refund_date: '2026-10-03', allocations: [{ sale_return_id: 9, allocated_amount: 30 }] });
  ok('customer refund to a return refused (complete the return instead)', r.status === 400 && r.body.error_code === 'REFUND_VIA_RETURN', r);
  r = await call(crCreate, 'POST', {}, { customer_id: 1, refund_amount: 25, refund_mode: 0, refund_date: '2026-10-03', refund_type: 'RETURN_SPECIFIC', allocations: [] });
  ok('on-account customer refund stored DIRECT', r.status === 201 && store.customer_refunds[0].refund_type === 'DIRECT', { r, f: store.customer_refunds });

  // list: relations are not joined by memtx - give rows their relation objects
  const attach = () => {
    for (const p of store.customer_payments) { p.customer = store.customer_details[0]; p.allocations = store.customer_payment_allocations.filter(a => a.payment_id === p.id).map(a => ({ ...a, invoice: a.invoice_id ? store.invoice.find(i => i.id === a.invoice_id) : null, invoicex: a.invoicex_id ? store.invoicex.find(i => i.id === a.invoicex_id) : null })); }
    for (const f of store.customer_refunds) { f.customer = store.customer_details[0]; f.allocations = []; }
    for (const p of store.vendor_payments) { p.vendor = store.vendor_details[0]; p.allocations = store.payment_allocations.filter(a => a.payment_id === p.id).map(a => ({ ...a, purchase: store.purchase.find(x => x.id === a.purchase_id) })); }
    for (const f of store.vendor_refunds) { f.vendor = store.vendor_details[0]; f.allocations = []; }
  };
  attach();
  r = await call(custList, 'GET', { customer_id: '1', type: 'all', payment_mode: '0', page: '1', limit: '50' });
  ok('mode filter with All types works (was a 500: refunds have refund_mode)', r.status === 200 && r.body.data.length === 2 && r.body.data.every(t => t.payment_mode === 0), r.body);
  r = await call(custList, 'GET', { customer_id: '1', type: 'all', page: '1', limit: '1' });
  ok('totals cover every page: income 180, expense 25, net 155', r.status === 200 && r.body.totals.income === 180 && r.body.totals.expense === 25 && r.body.totals.net === 155 && r.body.data.length === 1 && r.body.pagination.total === 3, r.body);
  ok('Invoice C allocation labelled C-n', (await call(custList, 'GET', { customer_id: '1', type: 'income' })).body.data.some(t => t.invoice_numbers.includes('C-3')));
  r = await call(custList, 'GET', { customer_id: '1', dateFrom: '2026-10-04' });
  ok('a date range with only a start works', r.status === 200 && r.body.data.length === 0, r.body);

  // delete the Invoice C payment
  const p2 = store.customer_payments.find(p => p.payment_amount === 80);
  r = await call(cpOne, 'DELETE', { id: String(p2.id) });
  const c = store.customer_details[0];
  ok('payment delete: Invoice C bill back to unpaid, sale untouched, counters reversed', r.status === 200 && store.invoicex[0].payment_status === 0 && store.invoice[0].payment_status === 1 && c.total_paid === 100 && c.total_allocated === 100, { r: r.body, c, x: store.invoicex[0], i: store.invoice[0] });

  // vendor
  r = await call(vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 50, refund_mode: 0, refund_date: '2026-10-03', allocations: [{ return_id: 4, allocated_amount: 50 }] });
  ok('vendor refund to a return refused', r.status === 400 && r.body.error_code === 'REFUND_VIA_RETURN', r);
  r = await call(vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 40, refund_mode: 0, refund_date: '2026-10-03', refund_type: 'RETURN_SPECIFIC', allocations: [] });
  const v = store.vendor_details[0];
  ok('on-account vendor refund: DIRECT, ledger row written, counter raised (RETURN_SPECIFIC with nothing allocated wrote no ledger row)', r.status === 201 && store.vendor_refunds[0].refund_type === 'DIRECT' && store.vendor_refunds[0].refund_mode === 0 && store.vendor_ledger.some(l => l.transaction_type === 'REFUND_RECEIVED' && l.debit === 40) && v.total_refunded === 40, { r: r.body, f: store.vendor_refunds, l: store.vendor_ledger, v });
  await call(vpCreate, 'POST', {}, { vendor_id: 1, payment_amount: 200, payment_mode: 1, payment_date: '2026-10-03', payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: 7, allocated_amount: 200 }] });
  attach();
  r = await call(vendList, 'GET', { vendor_id: '1', type: 'all', payment_mode: '0' });
  ok('vendor list mode filter with All types', r.status === 200 && r.body.data.length === 1 && r.body.data[0].transaction_type === 'INCOME', r.body);
  r = await call(vendList, 'GET', { vendor_id: '1' });
  ok('vendor totals: expense 200, income 40', r.body.totals.expense === 200 && r.body.totals.income === 40 && r.body.totals.net === -160, r.body.totals);
  r = await call(vpOne, 'DELETE', { id: String(store.vendor_payments[0].id) });
  ok('vendor payment delete: bill unpaid, counters reversed', r.status === 200 && store.purchase[0].payment_status === 0 && v.total_paid === 0 && v.total_allocated === 0, { r: r.body, v, p: store.purchase[0] });
  expect(FAILED).toEqual([]);
}, 170000);
