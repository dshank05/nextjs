// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import create from '../../../pages/api/purchases/index';
import one from '../../../pages/api/purchases/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
test('vendor advance allocation', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],
    vendor_details: [{ id: 1, vendor_name: 'V', state_code: 9, total_paid: 300, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    vendor_payments: [{ id: 50, vendor_id: 1, payment_amount: 300, payment_type: 'DIRECT', payment_date: 1 }],
    payment_allocations: [], product: [{ id: 1, product_name: 'P', stock: 0 }], purchase: [], purchaseitems: [], bill_to: [], vendor_ledger: [], vendor_balance_logs: [],
    purchase_return_items: [], purchase_returns: []
  });
  const r = await call(create, 'POST', {}, { vendor_id: 1, date: '2026-10-02', payment_status: 1, payment_mode: 0, state_code: 9, items: [{ product_id: 1, qty: 1, rate: 500 }] });
  ok('purchase created', r.status === 201, r.body);
  const v = store.vendor_details[0];
  ok('vendor advance allocated from #50, one new row', store.vendor_payments.length === 2 && store.payment_allocations.some(a => a.payment_id === 50 && a.allocated_amount === 300), store.vendor_payments);
  ok('vendor counters after create', v.total_paid === 500 && v.total_allocated === 500, v);
  const d = await call(one, 'DELETE', { id: String(store.purchase[0].id) });
  ok('purchase deleted', d.status === 200, d.body);
  ok('SA-28 vendor: advance stays paid', v.total_paid === 300 && v.total_allocated === 0 && store.vendor_payments.length === 1 && store.vendor_payments[0].payment_type === 'DIRECT', { v, p: store.vendor_payments });
  expect(FAILED).toEqual([]);
}, 170000);
