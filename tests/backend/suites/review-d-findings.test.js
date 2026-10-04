// Reviewer D (returns and stock): the findings of docs/review/returns.md that are wrong today, each
// as test.failing named with its id - the suite stays green while the behaviour is as found and
// turns red the day it is fixed (then make it a plain test). Run with REVIEW_D_SHOW=1 to run them
// as plain tests and see what each one finds.
import fs from 'fs';
import path from 'path';

// D-05 needs Prisma's relation filter (`where: { purchase_return: { purchase_id: ... } }`), which
// support/memtx.js ignores (it matches every row - the right answer, so the bug would not show).
// This file's db answers that one filter the way Prisma does; nothing else changes.
jest.mock('../support/dbstub.js', () => {
  const real = jest.requireActual('../support/dbstub.js');
  const items = (t) => new Proxy(t, { get(o, k) {
    if (k !== 'groupBy' && k !== 'findMany') return o[k];
    return async (args = {}) => {
      const rel = args.where && args.where.purchase_return;
      if (!rel) return o[k](args);
      const { purchase_return, ...rest } = args.where;
      const ids = (real.store.purchase_returns || []).filter(r => Object.entries(rel).every(([c, v]) => (v && typeof v === 'object' && 'in' in v) ? v.in.includes(r[c]) : r[c] === v)).map(r => r.id);
      return o[k]({ ...args, where: { ...rest, purchase_return_id: { in: ids } } });
    };
  } });
  const prisma = new Proxy({}, { get: (_, name) => (name === 'purchase_return_items' ? items(real.prisma[name]) : real.prisma[name]) });
  return { ...real, prisma, default: prisma };
});

import { store } from '../support/dbstub.js';
import { reset, call, H, checkAll, stats, ok, N, sum } from '../support/flowlib.js';
import { seedStock, K, create, lines, D } from '../support/scenlib.js';
import vendorItems from '../../../pages/api/purchase-returns/vendor-items';
import customerItems from '../../../pages/api/sale-returns/customer-items';

const failing = process.env.REVIEW_D_SHOW ? test : test.failing;
const FX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/returns', f), 'utf8'));
const ts = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };
const counters = (t, id = 1) => { const p = store[t].find(x => x.id === id); return [N(p.total_refunded), N(p.total_refund_allocated)]; };
const stock = (id) => store.product.find(p => p.id === id).stock;
const start = () => { reset(); seedStock(); stats.failures = []; };
const clean = async (label) => { await checkAll(label); expect(stats.failures).toEqual([]); };
const pIt = (l, q, extra = {}) => ({ purchase_item_id: l.id, return_qty: q, return_reason_id: 1, ...extra });
const prCreate = (items, extra = {}) => call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items, ...extra });
const prPut = (id, items, extra = {}) => call(H.prOne, 'PUT', { id: String(id) }, { return_date: D(4), payment_mode: 1, packing_forwarding_amount: 0, items, ...extra });
const sIt = (l, q, type = 'invoice') => ({ invoice_item_id: l.id, invoice_type: type, return_qty: q, return_reason_id: 5 });

// ---------------------------------------------------------------- D-01..D-03: refunded purchase return edits and the vendor's refund counters
test('D-01 a refunded purchase return edited 5 -> 3 and then deleted leaves the refund counters at 0 (today -2000 / -2000: the edit is logged without the note number)', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  const rid = (await prCreate([pIt(l, 5)], { payment_status: 1 })).body.data.return.id;
  await prPut(rid, [pIt(l, 3)], { payment_status: 1 });
  ok('after the edit: 3000 / 3000', JSON.stringify(counters('vendor_details')) === '[3000,3000]', counters('vendor_details'));
  ok('the edit\'s balance-log rows carry the debit note number', store.vendor_balance_logs.every(x => x.reference_no === 'DN-4-001'), store.vendor_balance_logs.map(x => [x.change_amount, x.reference_no]));
  await call(H.prOne, 'DELETE', { id: String(rid) });
  ok('after the delete: 0 / 0', JSON.stringify(counters('vendor_details')) === '[0,0]', counters('vendor_details'));
  await clean('D-01');
});

test('D-02 a refunded purchase return marked pending, refunded again and deleted leaves the counters at 0 (today -5000: the delete reverses the completion twice)', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  const rid = (await prCreate([pIt(l, 5)], { payment_status: 1 })).body.data.return.id;
  await prPut(rid, [pIt(l, 5)], { payment_status: 0 });
  await prPut(rid, [pIt(l, 5)], { payment_status: 1, payment_date: D(6) });
  ok('refunded again: 5000 / 5000', JSON.stringify(counters('vendor_details')) === '[5000,5000]', counters('vendor_details'));
  await call(H.prOne, 'DELETE', { id: String(rid) });
  ok('after the delete: 0 / 0', JSON.stringify(counters('vendor_details')) === '[0,0]', counters('vendor_details'));
  await clean('D-02');
});

test('D-03 a purchase return refunded from an on-account vendor refund, then marked pending (or lowered), gives back only the allocation (today total_refunded drops below the refund on record, A12)', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 3000, refund_mode: 0, refund_date: D(3), allocations: [] });
  const rid = (await prCreate([pIt(l, 2)])).body.data.return.id;
  await prPut(rid, [pIt(l, 2)], { payment_status: 1, payment_date: D(6) });
  ok('refunded by an edit, drawing on the 3000 on account: 3000 / 2000 (owner rule)', JSON.stringify(counters('vendor_details')) === '[3000,2000]', counters('vendor_details'));
  await prPut(rid, [pIt(l, 1)], { payment_status: 1 });
  ok('lowered to 1000 while refunded: 3000 / 1000 (the vendor refund is still 3000)', JSON.stringify(counters('vendor_details')) === '[3000,1000]', counters('vendor_details'));
  await prPut(rid, [pIt(l, 1)], { payment_status: 0 });
  ok('marked pending: 3000 / 0', JSON.stringify(counters('vendor_details')) === '[3000,0]', counters('vendor_details'));
  await clean('D-03');
});

// ---------------------------------------------------------------- D-04: the reason a sale return line is stored with
test('D-04 the sale return the screen sent with the reason box on its placeholder is stored with a SALE reason, or refused (today: reason 1, the purchase reason "Incorrect Quantity")', async () => {
  const fx = FX('sale.json');
  start();
  store.return_reasons = fx.seed.reasons.map(r => ({ ...r }));
  for (const [k, b] of fx.seed.bills) await call({ sales: H.sales, salex: H.salex, purchases: H.purchases }[k], 'POST', {}, JSON.parse(JSON.stringify(b)));
  const step = fx.steps.find(s => s.name === 'create-pending');
  // The request as the screen sent it before the fix (sale.json now holds the fixed screen's: its first sale reason).
  const body = JSON.parse(JSON.stringify(step.body)); body.items.forEach(i => { i.return_reason_id = 1; });
  const r = await call(H.srCreate, 'POST', {}, body);
  const item = store.sale_return_items[0];
  const reason = item && store.return_reasons.find(x => x.id === item.return_reason_id);
  ok('stored with a sale reason (or refused 400)', r.status === 400 || (reason && reason.type === 'sale'), { status: r.status, reason });
  // (A reason id that does not exist is refused by MySQL's foreign key - P2003 - with the bills' message
  // "A selected customer, staff member, mechanic or product does not exist"; memtx has no keys.)
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-05 / D-06 / D-13: the vendor bill picker
test('D-05 vendor bill picker: a line already returned on a return headed by ANOTHER bill shows what is really left (today the whole line)', async () => {
  start();
  const a = await create(K.purchase, { items: [[1, 2, 1000, 0]] });
  const b = await create(K.purchase, { items: [[3, 10, 200, 0]], date: D(3) });
  const la = lines(K.purchase, a.id)[0], lb = lines(K.purchase, b.id)[0];
  const r = await prCreate([pIt(la, 2), pIt(lb, 4)]);       // one return over both bills; its header names bill A
  ok('the return is headed by bill A', r.status === 201 && store.purchase_returns[0].purchase_id === a.id && store.purchase.find(p => p.id === a.id).return_status === 2, store.purchase_returns[0]);
  const v = await call(vendorItems, 'GET', { vendor_id: '1', page: '1', limit: '50' });
  const line = (v.body?.data?.bills || []).flatMap(x => x.items).find(i => i.purchase_item_id === lb.id);
  ok('bill B line: 4 already returned, 6 available', line && line.already_returned === 4 && line.available_qty === 6, line);
  const over = await prCreate([pIt(lb, line?.available_qty || 10)]);
  ok('so the screen does not offer more than the server takes', over.status === 201, over.body);
  expect(stats.failures).toEqual([]);
});

test('D-06 vendor bill picker: "x/y items available" counts the lines with something left (today every line)', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0], [3, 5, 200, 0]] });
  const l = lines(K.purchase, id);
  await prCreate([pIt(l[1], 5)]);
  const v = await call(vendorItems, 'GET', { vendor_id: '1', page: '1', limit: '50' });
  const bill = v.body?.data?.bills?.[0];
  ok('1 of 2 lines available', bill && bill.total_items === 2 && bill.available_items === 1, bill && { available_items: bill.available_items, total_items: bill.total_items });
  expect(stats.failures).toEqual([]);
});

test('D-13 vendor bill picker: the item search the screen sends (item_search) narrows the bills on the server (today ignored; only the loaded page is filtered on screen)', async () => {
  start();
  await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  await create(K.purchase, { items: [[3, 5, 200, 0]], date: D(3) });
  const v = await call(vendorItems, 'GET', { vendor_id: '1', page: '1', limit: '50', item_search: 'Oil' });
  const names = (v.body?.data?.bills || []).map(b => b.items.map(i => i.product_name).join('+'));
  ok('only the bill with an Oil Filter', names.length === 1 && names[0].includes('Oil'), names);
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-07: stock below zero
test('D-07 deleting a sale return (or lowering it) whose units were sold again is refused like a sale or a purchase delete (today stock goes to -5)', async () => {
  start();
  const { id } = await create(K.sale, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.sale, id)[0];
  const rid = (await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), payment_status: 0, items: [sIt(l, 5)] })).body.data.returns[0].id;
  // the 995 left are sold
  await create(K.sale, { items: [[1, 995, 10, 0]], date: D(5) });
  ok('stock 0', stock(1) === 0, stock(1));
  const e = await call(H.srOne, 'PUT', { id: String(rid), type: 'invoice' }, { invoice_type: 'invoice', items: [sIt(l, 1)] });
  ok('lowering the return 5 -> 1 refused (INSUFFICIENT_STOCK), stock 0', e.status === 400 && e.body?.error_code === 'INSUFFICIENT_STOCK' && stock(1) === 0, { e: e.body, s: stock(1) });
  const d = await call(H.srOne, 'DELETE', { id: String(rid), type: 'invoice' });
  ok('deleting it refused (INSUFFICIENT_STOCK), stock 0', d.status === 400 && d.body?.error_code === 'INSUFFICIENT_STOCK' && stock(1) === 0, { d: d.body, s: stock(1) });
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-08: the REFUND row's date
test('D-08 a sale return created refunded posts its REFUND on the payment date sent, like the cash book (today on the return date)', async () => {
  const fx = FX('sale.json');
  start();
  store.return_reasons = fx.seed.reasons.map(r => ({ ...r }));
  for (const [k, b] of fx.seed.bills) await call({ sales: H.sales, salex: H.salex, purchases: H.purchases }[k], 'POST', {}, JSON.parse(JSON.stringify(b)));
  await call(H.srCreate, 'POST', {}, JSON.parse(JSON.stringify(fx.steps.find(s => s.name === 'create-pending').body)));
  const step = fx.steps.find(s => s.name === 'create-refunded');
  const r = await call(H.srCreate, 'POST', {}, JSON.parse(JSON.stringify(step.body)));
  const rid = r.body.data.returns[0].id;
  const refundRow = store.customer_ledger.find(x => x.reference_type === 'sale_return' && x.reference_id === rid && x.transaction_type === 'REFUND');
  const cb = (await call(H.cashBookR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '500' })).body.rows.find(x => x.kind === 'sale_return' && x.id === rid);
  ok('cash book: on the payment date 2026-10-06', cb && cb.date === ts('2026-10-06'), cb);
  ok('ledger REFUND row: on the payment date too', refundRow && refundRow.transaction_date === ts('2026-10-06') && refundRow.payment_date === ts('2026-10-06'), refundRow);
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-09 / D-10: what the bill pickers show
test('D-09 the edit form\'s bill (GET a return) carries the bill\'s total and reference, as on the create screen (today the return\'s own total; the sale reference is the bill number)', async () => {
  start();
  const s = await create(K.sale, { items: [[1, 10, 1000, 18]], extra: { bill_reference: 'REF-S' } });
  const p = await create(K.purchase, { items: [[1, 10, 1000, 18]], extra: { bill_reference: 'REF-P' } });
  const sr = (await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), items: [sIt(lines(K.sale, s.id)[0], 2)] })).body.data.returns[0].id;
  const pr = (await prCreate([pIt(lines(K.purchase, p.id)[0], 2)])).body.data.return.id;
  const sb = (await call(H.srOne, 'GET', { id: String(sr), type: 'invoice' })).body.data.bills[0];
  const pb = (await call(H.prOne, 'GET', { id: String(pr) })).body.data.bills[0];
  const sBill = store.invoice.find(x => x.id === s.id), pBill = store.purchase.find(x => x.id === p.id);
  ok('sale: the bill total and reference', N(sb.total_amount) === N(sBill.total) && sb.bill_reference === (sBill.bill_reference || ''), { shown: [sb.total_amount, sb.bill_reference], bill: [sBill.total, sBill.bill_reference] });
  ok('purchase: the bill total', N(pb.total_amount) === N(pBill.total), { shown: pb.total_amount, bill: pBill.total });
  expect(stats.failures).toEqual([]);
});

test('D-10 the customer bill search finds an Invoice C bill by the number the picker shows ("C-1"; today nothing)', async () => {
  start();
  const x = await create(K.salex, { items: [[1, 10, 1000, 0]] });
  const no = store.invoicex.find(b => b.id === x.id).invoice_no;
  const r = await call(customerItems, 'GET', { customer_id: '1', page: '1', limit: '50', search: `C-${no}` });
  const bills = r.body?.data?.bills || [];
  ok('one bill: the Invoice C one', bills.length === 1 && bills[0].invoice_type === 'invoicex', bills.map(b => [b.invoice_type, b.invoice_no]));
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-12: a refunded purchase return marked pending
test('D-12 marking a refunded purchase return pending clears its payment date (today the old date stays on a pending return)', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  const rid = (await prCreate([pIt(l, 2)], { payment_status: 1, payment_date: D(6) })).body.data.return.id;
  await prPut(rid, [pIt(l, 2)], { payment_status: 0 });
  const r = store.purchase_returns.find(x => x.id === rid);
  ok('pending, no payment date', r.payment_status === 0 && r.payment_date == null, r);
  expect(stats.failures).toEqual([]);
});

// ---------------------------------------------------------------- D-17: the returns register's words
test('D-17 the returns register says "Pending refund" / "Refunded" like every return screen (owner decision 4; today "Pending" / "Complete")', async () => {
  start();
  const { id } = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, id)[0];
  await prCreate([pIt(l, 1)]); await prCreate([pIt(l, 1)], { payment_status: 1 });
  const rows = (await call(H.returnsR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '50' })).body.returns;
  ok('status words', rows.map(r => r.status_text).sort().join() === 'Pending refund,Refunded', rows.map(r => r.status_text));
  expect(stats.failures).toEqual([]);
});
