// Moved from the test harness (2026-10-03); see tests/backend/README.md.
// BILLS_PLAN B1: purchase create / edit / delete on lib/purchase-*.ts, through the real routes.
import { store } from '../support/dbstub.js';
import create from '../../../pages/api/purchases/index';
import one from '../../../pages/api/purchases/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
test('purchase create / edit / delete', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],
    vendor_details: [{ id: 0, vendor_name: 'Other', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
      { id: 1, vendor_name: 'Bosch', state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    vendor_payments: [], payment_allocations: [], staff: [],
    product: [{ id: 1, product_name: 'Brake Pad', stock: 0 }, { id: 2, product_name: 'Clutch', stock: 0 }],
    purchase: [], purchaseitems: [], bill_to: [], vendor_ledger: [], vendor_balance_logs: [], purchase_return_items: [], purchase_returns: []
  });
  const base = { vendor_id: 1, date: '2026-10-02', payment_status: 0, payment_mode: 0, state_code: 9 };

  // create: freight in the total, number from the counter, P&F rounded
  let r = await call(create, 'POST', {}, { ...base, transport_cost: 50, packing_forwarding_qty: 3, packing_forwarding_rate: 100 / 3,
    items: [{ product_id: 1, qty: 10, rate: 100, gst_percentage: 18 }] });
  const p1 = store.purchase[0];
  ok('create 201 with the old response shape', r.status === 201 && r.body.purchase?.id === p1?.id && r.body.purchase.invoice_no === 1 && r.body.message === 'Purchase created successfully', r.body);
  ok('freight in the total: 1000 + 180 tax + 100 P&F + 50 freight = 1330', p1.total === 1330 && p1.freight === 50, p1);
  ok('P&F total rounded to paise', p1.packing_forwarding_total === 100, p1.packing_forwarding_total);
  ok('stock in', store.product[0].stock === 10, store.product[0]);
  ok('ledger entry for the full total', store.vendor_ledger.some(l => l.reference_id === p1.id && l.transaction_type === 'PURCHASE' && l.debit === 1330), store.vendor_ledger);

  r = await call(create, 'POST', {}, { ...base, items: [{ product_id: 1, qty: 1, rate: 5 }] });
  ok('second purchase takes the next number', r.status === 201 && store.purchase[1].invoice_no === 2, r.body);
  r = await call(create, 'POST', {}, { ...base, invoice_number: 2, items: [{ product_id: 1, qty: 1, rate: 5 }] });
  ok('a named number already used is refused', r.status === 400 && r.body.error_code === 'DUPLICATE_INVOICE_NO', r.body);
  r = await call(create, 'POST', {}, { ...base, items: [{ product_id: 99, qty: 1, rate: 5 }] });
  ok('missing product: 400 that names it (was a 500)', r.status === 400 && /99/.test(r.body.message) && store.purchase.length === 2, r.body);
  r = await call(create, 'POST', {}, { ...base, vendor_id: 0, vendor_name: 'Walk-in', items: [{ product_id: 2, qty: 1, rate: 5 }] });
  ok('"Other" needs a phone', r.status === 400 && /Phone/.test(r.body.message), r.body);
  r = await call(create, 'POST', {}, { ...base, vendor_id: 0, vendor_name: 'Walk-in', contact_number: '9876543210', items: [{ product_id: 2, qty: 4, rate: 5 }] });
  ok('"Other" purchase posts to vendor 0 as before', r.status === 201 && store.vendor_ledger.some(l => l.vendor_id === 0 && l.reference_id === r.body.purchase.id), r.body);

  // edit: freight change moves the total; lowering below what is in stock is refused
  r = await call(one, 'PUT', { id: String(p1.id) }, { transport_cost: 0 });
  ok('edit: freight 0 -> total 1280', r.status === 200 && store.purchase[0].total === 1280, { r: r.body, p: store.purchase[0] });
  store.product[0].stock = 3; // 8 of the 11 sold
  const line = store.purchaseitems.find(l => l.purchase_id === p1.id);
  r = await call(one, 'PUT', { id: String(p1.id) }, { items: [{ line_id: line.id, product_id: 1, qty: 5, rate: 100, gst_percentage: 18 }] });
  ok('edit: taking 5 out with 3 in stock is refused', r.status === 400 && r.body.error_code === 'INSUFFICIENT_STOCK' && store.product[0].stock === 3 && line.qty === 10, { r: r.body, stock: store.product[0].stock, qty: line.qty });
  r = await call(one, 'PUT', { id: String(p1.id) }, { items: [{ line_id: line.id, product_id: 1, qty: 8, rate: 100, gst_percentage: 18 }] });
  ok('edit: taking 2 out with 3 in stock is fine', r.status === 200 && store.product[0].stock === 1 && line.qty === 8, { r: r.body, stock: store.product[0].stock });
  r = await call(one, 'PUT', { id: String(p1.id) }, { items: [{ line_id: line.id, product_id: 1, qty: 12, rate: 100, gst_percentage: 18 }] });
  ok('edit: raising a line is never limited by stock', r.status === 200 && store.product[0].stock === 5, { r: r.body, stock: store.product[0].stock });

  // delete: refused while its units are not all there
  r = await call(one, 'DELETE', { id: String(p1.id) });
  ok('delete: 12 bought, 5 in stock -> refused, nothing moved', r.status === 400 && r.body.error_code === 'INSUFFICIENT_STOCK' && store.purchase.some(p => p.id === p1.id) && store.product[0].stock === 5, r.body);
  const p2 = store.purchase[1];
  store.product[0].stock = 6;
  r = await call(one, 'DELETE', { id: String(p2.id) });
  ok('delete: 1 bought, 6 in stock -> deleted, stock 5', r.status === 200 && !store.purchase.some(p => p.id === p2.id) && store.product[0].stock === 5, r.body);
  r = await call(one, 'DELETE', { id: '9999' });
  ok('delete: unknown id 404', r.status === 404, r);
  expect(FAILED).toEqual([]);
}, 170000);
