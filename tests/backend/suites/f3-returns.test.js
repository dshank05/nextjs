// F3 (returns and dead stock): plain tests for what the D-findings' own tests do not cover - the twins and the
// other paths of the same fixes. Each runs checkAll + checkReports after (sc).
import fs from 'fs';
import path from 'path';
import { store } from '../support/dbstub.js';
import { call, H, ok, N } from '../support/flowlib.js';
import { K, create, lines, D, sc, stock } from '../support/scenlib.js';
import customerItems from '../../../pages/api/sale-returns/customer-items';

const REASONS = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/returns/sale.json'), 'utf8')).seed.reasons;
const counters = () => { const v = store.vendor_details.find(x => x.id === 1); return [N(v.total_refunded), N(v.total_refund_allocated)]; };
const pIt = (l, q, extra = {}) => ({ purchase_item_id: l.id, return_qty: q, return_reason_id: 1, ...extra });
const prCreate = (items, extra = {}) => call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items, ...extra });
const prPut = (id, items, extra = {}) => call(H.prOne, 'PUT', { id: String(id) }, { return_date: D(4), payment_mode: 1, packing_forwarding_amount: 0, items, ...extra });
const sIt = (l, q, type = 'invoice', extra = {}) => ({ invoice_item_id: l.id, invoice_type: type, return_qty: q, ...extra });

// ---------------------------------------------------------------- D-01..D-03: the vendor's refund counters
sc('F3-D03a', 'a return drawn from an on-account refund, lowered and raised again, draws on the same refund (counters 3000 / 2000 again), and its delete leaves only the on-account refund', async () => {
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 3000, refund_mode: 0, refund_date: D(3), allocations: [] });
  const rid = (await prCreate([pIt(l, 2)])).body.data.return.id;
  await prPut(rid, [pIt(l, 2)], { payment_status: 1, payment_date: D(6) });
  await prPut(rid, [pIt(l, 1)], { payment_status: 1 });
  ok('lowered: 3000 / 1000', JSON.stringify(counters()) === '[3000,1000]', counters());
  await prPut(rid, [pIt(l, 2)], { payment_status: 1 });
  ok('raised back: drawn from the on-account refund again, 3000 / 2000', JSON.stringify(counters()) === '[3000,2000]', counters());
  await prPut(rid, [pIt(l, 4)], { payment_status: 1 });
  ok('raised past the on-account refund: 1000 of new refund money, 4000 / 4000', JSON.stringify(counters()) === '[4000,4000]', counters());
  const r = await call(H.prOne, 'DELETE', { id: String(rid) });
  ok('deleted: only the on-account refund is left, 3000 / 0', r.status === 200 && JSON.stringify(counters()) === '[3000,0]', counters());
});

sc('F3-D03b', 'a return created refunded (its own refund money), lowered after a later on-account refund: its own money comes off, the on-account refund stays free', async () => {
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  const rid = (await prCreate([pIt(l, 5)], { payment_status: 1, payment_date: D(4) })).body.data.return.id;
  await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 3000, refund_mode: 0, refund_date: D(5), allocations: [] });
  ok('5000 + 3000 on account: 8000 / 5000', JSON.stringify(counters()) === '[8000,5000]', counters());
  await prPut(rid, [pIt(l, 4)], { payment_status: 1 });
  ok('lowered by 1000: 7000 / 4000', JSON.stringify(counters()) === '[7000,4000]', counters());
  await prPut(rid, [pIt(l, 4)], { payment_status: 0 });
  ok('marked pending: 3000 / 0, no payment date', JSON.stringify(counters()) === '[3000,0]' && store.purchase_returns[0].payment_date == null, { c: counters(), r: store.purchase_returns[0] });
  ok('every counter move of the return is logged under its debit note', store.vendor_balance_logs.filter(x => x.source_type && String(x.source_type).startsWith('return')).every(x => x.reference_no === store.purchase_returns[0].debit_note_no), store.vendor_balance_logs);
});

// ---------------------------------------------------------------- D-07: the Invoice C twin
sc('F3-D07x', 'Invoice C: lowering or deleting a return whose units were sold again is refused (INSUFFICIENT_STOCK), nothing moves; a lowering that fits passes', async () => {
  const { id } = await create(K.salex, { items: [[2, 10, 500, 0]] });
  const l = lines(K.salex, id)[0];
  const rid = (await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), items: [sIt(l, 4, 'invoicex', { return_reason_id: 1 })] })).body.data.returns[0].id;
  await create(K.sale, { items: [[2, 992, 10, 0]], date: D(5) });
  ok('stock 2', stock(2) === 2, stock(2));
  const e = await call(H.srOne, 'PUT', { id: String(rid), type: 'invoicex' }, { invoice_type: 'invoicex', items: [sIt(l, 1, 'invoicex')] });
  ok('4 -> 1 refused (3 would go out, 2 left)', e.status === 400 && e.body?.error_code === 'INSUFFICIENT_STOCK' && stock(2) === 2 && store.salex_return_items[0].return_qty === 4, { e: e.body, s: stock(2) });
  const d = await call(H.srOne, 'DELETE', { id: String(rid), type: 'invoicex' });
  ok('delete refused', d.status === 400 && d.body?.error_code === 'INSUFFICIENT_STOCK' && store.salex_returns.length === 1 && stock(2) === 2, { d: d.body, s: stock(2) });
  const e2 = await call(H.srOne, 'PUT', { id: String(rid), type: 'invoicex' }, { invoice_type: 'invoicex', items: [sIt(l, 2, 'invoicex')] });
  ok('4 -> 2 fits: stock 0', e2.status === 200 && stock(2) === 0, { e: e2.body, s: stock(2) });
});

// ---------------------------------------------------------------- D-04: reasons
sc('F3-D04', 'return reasons: none sent = the first of the kind by name; a reason of another kind is refused; Invoice C takes the sale reasons', async () => {
  store.return_reasons = REASONS.map(r => ({ ...r }));
  const s = await create(K.sale, { items: [[1, 10, 1000, 0]] });
  const x = await create(K.salex, { items: [[2, 10, 500, 0]] });
  const p = await create(K.purchase, { items: [[3, 10, 200, 0]] });
  const ls = lines(K.sale, s.id)[0], lx = lines(K.salex, x.id)[0], lp = lines(K.purchase, p.id)[0];
  let r = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), items: [sIt(ls, 1)] });
  ok('sale, no reason: "Changed Mind" (9), the sale list\'s first', r.status === 201 && store.sale_return_items[0].return_reason_id === 9, { r: r.body, i: store.sale_return_items });
  r = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), items: [sIt(lx, 1, 'invoicex', { return_reason_id: 1 })] });
  ok('Invoice C, a purchase reason: refused INVALID_REASON, nothing written', r.status === 400 && r.body?.error_code === 'INVALID_REASON' && store.salex_returns.length === 0, r.body);
  r = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), items: [sIt(lx, 1, 'invoicex', { return_reason_id: 7 })] });
  ok('Invoice C, a sale reason: kept', r.status === 201 && store.salex_return_items[0].return_reason_id === 7, r.body);
  r = await prCreate([pIt(lp, 1, { return_reason_id: 5 })]);
  ok('purchase, a sale reason: refused INVALID_REASON', r.status === 400 && r.body?.error_code === 'INVALID_REASON' && store.purchase_returns.length === 0, r.body);
  r = await prCreate([pIt(lp, 1, { return_reason_id: undefined })]);
  ok('purchase, no reason: "Incorrect Quantity" (1), the purchase list\'s first', r.status === 201 && store.purchase_return_items[0].return_reason_id === 1, r.body);
  const rid = store.sale_returns[0].id;
  r = await call(H.srOne, 'PUT', { id: String(rid), type: 'invoice' }, { invoice_type: 'invoice', items: [sIt(ls, 1, 'invoice', { return_reason_id: 3 })] });
  ok('sale edit to a purchase reason: refused, the reason stays 9', r.status === 400 && r.body?.error_code === 'INVALID_REASON' && store.sale_return_items[0].return_reason_id === 9, r.body);
});

// ---------------------------------------------------------------- D-08: the Invoice C twin
sc('F3-D08x', 'Invoice C return created refunded: the credit note on the return date, the REFUND on the payment date', async () => {
  const { id } = await create(K.salex, { items: [[2, 10, 500, 0]] });
  const l = lines(K.salex, id)[0];
  const r = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), payment_status: 1, payment_mode: 0, payment_date: D(6), items: [sIt(l, 2, 'invoicex', { return_reason_id: 1 })] });
  const rid = r.body.data.returns[0].id;
  const row = (t) => store.customer_ledger.find(x => x.reference_type === 'salex_return' && x.reference_id === rid && x.transaction_type === t);
  const day = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };
  ok('CREDIT_NOTE on 4 Oct, REFUND on 6 Oct', row('CREDIT_NOTE').transaction_date === day(D(4)) && row('REFUND').transaction_date === day(D(6)) && row('REFUND').payment_date === day(D(6)), [row('CREDIT_NOTE'), row('REFUND')]);
});

// ---------------------------------------------------------------- D-13: the customer picker twin
sc('F3-D13c', 'customer bill picker: item_search narrows the bills on the server, both kinds', async () => {
  await create(K.sale, { items: [[1, 10, 1000, 0]] });
  await create(K.salex, { items: [[3, 5, 200, 0]], date: D(3) });
  const v = await call(customerItems, 'GET', { customer_id: '1', page: '1', limit: '50', item_search: 'oil' });
  const bills = v.body?.data?.bills || [];
  ok('only the Invoice C bill with the Oil Filter', bills.length === 1 && bills[0].invoice_type === 'invoicex' && v.body.data.pagination.total === 1, bills.map(b => [b.invoice_type, b.items.map(i => i.product_name)]));
});
