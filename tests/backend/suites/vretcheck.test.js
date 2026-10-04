// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import create from '../../../pages/api/purchase-returns/vendor-return';
import one from '../../../pages/api/purchase-returns/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
test('purchase returns', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], note_counters: [],
    vendor_details: [{ id: 1, vendor_name: 'V1', state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }, { id: 2, vendor_name: 'V2', state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    purchase: [{ id: 1, vendor_id: 1, invoice_no: 7, return_status: 0 }, { id: 2, vendor_id: 2, invoice_no: 8, return_status: 0 }],
    purchaseitems: [
      { id: 10, purchase_id: 1, product_id: 1, qty: 3, rate: 100, gst_percentage: 18, igst: 0, name_of_product: 'P1' },
      { id: 11, purchase_id: 2, product_id: 1, qty: 3, rate: 100, gst_percentage: 18, igst: 0, name_of_product: 'P1' }],
    product: [{ id: 1, product_name: 'P1', stock: 10 }],
    purchase_returns: [], purchase_return_items: [], vendor_ledger: [], vendor_balance_logs: [], refund_allocations: [], vendor_refunds: []
  });
  const post = (items, extra = {}) => call(create, 'POST', {}, { vendor_id: 1, return_date: '2026-10-03', payment_status: 0, payment_mode: 1, items, ...extra });
  let r = await post([{ purchase_item_id: 10, return_qty: 4, return_reason_id: 1, unit_price: 100, tax_rate: 18 }]);
  ok('over-return refused', r.status === 400 && r.body.error_code === 'OVER_RETURN', r);
  r = await post([{ purchase_item_id: 11, return_qty: 1, return_reason_id: 1 }]);
  ok('another vendor\'s line refused', r.status === 400 && r.body.error_code === 'FOREIGN_BILL', r);
  r = await post([{ purchase_item_id: 10, return_qty: 1, return_reason_id: 1, unit_price: 120 }]);
  ok('price above the purchase rate refused', r.status === 400 && r.body.error_code === 'PRICE_ABOVE_PURCHASE', r);
  ok('nothing written', store.purchase_returns.length === 0 && store.product[0].stock === 10);

  r = await post([{ purchase_item_id: 10, return_qty: 1, return_reason_id: 1, unit_price: 100, tax_rate: 0 }], { packing_forwarding_amount: 10.4 });
  const a = store.purchase_returns[0], ai = store.purchase_return_items[0];
  ok('created', r.status === 201, r);
  ok('server tax (form sent 0%): 18 split 9/9; refund 100+18+10.4 -> 128', ai.tax_amount === 18 && ai.cgst === 9 && ai.sgst === 9 && a.total_tax === 18 && a.refund_amount === 128 && r.body.data.return.refund_amount === 128, { a, ai });
  ok('stock out 1, bill partial', store.product[0].stock === 9 && store.purchase[0].return_status === 1);

  r = await post([{ purchase_item_id: 10, return_qty: 2, return_reason_id: 1 }], { payment_status: 1 });
  const b = store.purchase_returns[1];
  const v = store.vendor_details[0];
  ok('complete: refund 236, counters and DEBIT_NOTE match', b.refund_amount === 236 && v.total_refunded === 236 && v.total_refund_allocated === 236 && store.vendor_ledger.some(l => l.transaction_type === 'DEBIT_NOTE' && l.credit === 236), { b, v, l: store.vendor_ledger });
  ok('bill fully returned', store.purchase[0].return_status === 2);

  r = await call(one, 'PUT', { id: String(a.id) }, { items: [{ purchase_item_id: 10, return_qty: 2, return_reason_id: 1 }] });
  ok('edit beyond what is left refused', r.status === 400 && r.body.error_code === 'OVER_RETURN', r);
  r = await call(one, 'PUT', { id: String(a.id) }, { items: [{ purchase_item_id: 10, return_qty: 1, return_reason_id: 1, unit_price: 90, tax_rate: 5 }], packing_forwarding_amount: 10.4 });
  const a2 = store.purchase_returns[0], ai2 = store.purchase_return_items.find(i => i.purchase_return_id === a.id);
  ok('edit repriced by the server, split kept CGST/SGST (was IGST on every edit)', r.status === 200 && ai2.unit_price === 90 && ai2.tax_amount === 16.2 && ai2.cgst === 8.1 && ai2.igst === 0 && a2.total_tax === 16 && a2.refund_amount === 116, { r: r.body, a2, ai2 });

  r = await call(one, 'DELETE', { id: String(b.id) });
  ok('delete complete return', r.status === 200, r);
  ok('delete reverses the counters exactly', v.total_refunded === 0 && v.total_refund_allocated === 0, v);
  ok('delete recomputes the bill status (full -> partial)', store.purchase[0].return_status === 1, store.purchase[0]);
  ok('delete puts stock back', store.product[0].stock === 9, store.product);
  expect(FAILED).toEqual([]);
}, 170000);
