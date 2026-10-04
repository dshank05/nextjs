// Reviewer D (returns and stock), docs/review/returns.md section 2: the outcomes the existing suites
// did not reach - every refusal of the three return kinds through the routes (and that a refusal
// writes nothing), the kind travelling with an id, the list filters exactly as the screens send them
// (fixtures/returns/list-queries.json), the bill pickers, the reasons, multi-bill returns, a refunded
// purchase return's date edit, and the dead stock refusals.
import fs from 'fs';
import path from 'path';
import { store } from '../support/dbstub.js';
import { reset, call, H, checkAll, checkReports, stats, ok, N, sum } from '../support/flowlib.js';
import { seedStock, K, create, lines, D } from '../support/scenlib.js';
import saleList from '../../../pages/api/sale-returns/index';
import purList from '../../../pages/api/purchase-returns/index';
import customerItems from '../../../pages/api/sale-returns/customer-items';
import vendorItems from '../../../pages/api/purchase-returns/vendor-items';
import reasons from '../../../pages/api/return-reasons/index';

const FX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/returns', f), 'utf8'));
const ts = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };
const start = () => { reset(); seedStock(); stats.failures = []; };
const state = () => JSON.stringify(Object.fromEntries(Object.entries(store).filter(([, v]) => Array.isArray(v)).map(([t, v]) => [t, v.map(r => { const { updated_at, ...x } = r; return x; })])));
const sIt = (l, q, type = 'invoice', extra = {}) => ({ invoice_item_id: l.id, invoice_type: type, return_qty: q, return_reason_id: 5, ...extra });
const pIt = (l, q, extra = {}) => ({ purchase_item_id: l.id, return_qty: q, return_reason_id: 1, ...extra });
const srPost = (items, extra = {}) => call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items, ...extra });
const prPost = (items, extra = {}) => call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items, ...extra });
const listUrl = (u) => Object.fromEntries(new URL(u, 'http://x').searchParams.entries());
const done = async (label) => { await checkAll(label); await checkReports(label); expect(stats.failures).toEqual([]); };

/** A refused request: its status and code, and not one row or column written. */
async function refused(label, fn, status, code) {
  const before = state();
  const r = await fn();
  ok(`${label}: ${status} ${code}`, r.status === status && (!code || r.body?.error_code === code), r.body);
  ok(`${label}: nothing written`, state() === before, label);
}

test('refusals - sale and Invoice C returns, through the routes; none writes anything', async () => {
  start();
  const s1 = await create(K.sale, { items: [[1, 10, 1000, 18], [3, 5, 200, 0]], extra: {} });
  const s2 = await create(K.sale, { items: [[1, 4, 1000, 18]], partyId: 2, date: D(3) });
  const x1 = await create(K.salex, { items: [[1, 10, 1000, 0]] });
  const ls = lines(K.sale, s1.id), lo = lines(K.sale, s2.id), lx = lines(K.salex, x1.id);
  await refused('price above the sale', () => srPost([sIt(ls[0], 1, 'invoice', { unit_price: 1000.5 })]), 400, 'PRICE_ABOVE_SALE');
  await refused('Invoice C price above', () => srPost([sIt(lx[0], 1, 'invoicex', { unit_price: 1001 })]), 400, 'PRICE_ABOVE_SALE');
  await refused('another customer\'s sale bill', () => srPost([sIt(lo[0], 1)]), 400, 'FOREIGN_BILL');
  await refused('another customer\'s Invoice C bill', () => srPost([sIt(lx[0], 1, 'invoicex')], { customer_id: 2 }), 400, 'FOREIGN_BILL');
  await refused('the same line twice', () => srPost([sIt(ls[0], 1), sIt(ls[0], 1)]), 400, 'DUPLICATE_LINE');
  await refused('no kind on a line', () => srPost([{ invoice_item_id: ls[0].id, return_qty: 1 }]), 400, 'KIND_REQUIRED');
  await refused('a line that does not exist', () => srPost([sIt({ id: 99999 }, 1)]), 400, 'UNKNOWN_LINE');
  await refused('quantity 0', () => srPost([sIt(ls[0], 0)]), 400, 'VALIDATION');
  await refused('no lines', () => srPost([]), 400, 'VALIDATION');
  await refused('payment status 2', () => srPost([sIt(ls[0], 1)], { payment_status: 2 }), 400, 'VALIDATION');
  await refused('no customer', () => srPost([sIt(ls[0], 1)], { customer_id: '' }), 400, 'VALIDATION');
  await refused('negative price', () => srPost([sIt(ls[0], 1, 'invoice', { unit_price: -1 })]), 400, 'VALIDATION');

  // one sale and one Invoice C return with the SAME id
  const a = await srPost([sIt(ls[0], 2)]);
  const b = await srPost([sIt(lx[0], 2, 'invoicex')]);
  const sid = a.body.data.returns[0].id, xid = b.body.data.returns[0].id;
  ok('ids collide (the case ?type= exists for)', sid === xid, [sid, xid]);
  await refused('GET without ?type=', () => call(H.srOne, 'GET', { id: String(sid) }), 409, 'AMBIGUOUS_RETURN');
  await refused('PUT without a kind', () => call(H.srOne, 'PUT', { id: String(sid) }, { items: [sIt(ls[0], 1)] }), 409, 'AMBIGUOUS_RETURN');
  await refused('DELETE without ?type=', () => call(H.srOne, 'DELETE', { id: String(sid) }), 409, 'AMBIGUOUS_RETURN');
  const g1 = await call(H.srOne, 'GET', { id: String(sid), type: 'invoice' }), g2 = await call(H.srOne, 'GET', { id: String(sid), type: 'invoicex' });
  ok('with ?type= each opens its own', g1.body.data.return.invoice_type === 'invoice' && g2.body.data.return.invoice_type === 'invoicex' && N(g1.body.data.return.total_amount) === 2000 && N(g2.body.data.return.total_amount) === 2000 && g1.body.data.return.return_no === `SR-${sid}` && g2.body.data.return.return_no === `SXR-${sid}`, [g1.body.data.return, g2.body.data.return]);
  await refused('a return that does not exist', () => call(H.srOne, 'GET', { id: '424242', type: 'invoice' }), 404, 'NOT_FOUND');
  await refused('edit: a line of another bill', () => call(H.srOne, 'PUT', { id: String(sid), type: 'invoice' }, { invoice_type: 'invoice', items: [sIt(lo[0], 1)] }), 400, 'FOREIGN_LINE');
  await refused('edit: an Invoice C line on a sale return', () => call(H.srOne, 'PUT', { id: String(sid), type: 'invoice' }, { invoice_type: 'invoice', items: [sIt(ls[0], 1, 'invoicex')] }), 400, 'KIND_MISMATCH');
  await refused('edit: no lines', () => call(H.srOne, 'PUT', { id: String(sid), type: 'invoice' }, { invoice_type: 'invoice', items: [] }), 400, 'VALIDATION');
  await refused('edit: price above', () => call(H.srOne, 'PUT', { id: String(sid), type: 'invoice' }, { invoice_type: 'invoice', items: [sIt(ls[0], 2, 'invoice', { unit_price: 2000 })] }), 400, 'PRICE_ABOVE_SALE');
  await refused('edit: payment status 2', () => call(H.srOne, 'PUT', { id: String(sid), type: 'invoice' }, { invoice_type: 'invoice', payment_status: 2, items: [sIt(ls[0], 2)] }), 400, 'VALIDATION');
  // Invoice C created refunded cannot be edited either
  const c = await srPost([sIt(lx[0], 1, 'invoicex')], { payment_status: 1 });
  const cid = c.body.data.returns[0].id;
  await refused('Invoice C refunded: edit blocked', () => call(H.srOne, 'PUT', { id: String(cid), type: 'invoicex' }, { invoice_type: 'invoicex', items: [sIt(lx[0], 1, 'invoicex')] }), 400, 'REFUNDED_RETURN_EDIT_BLOCKED');
  await done('sale refusals');
});

test('refusals - purchase returns, through the routes; none writes anything', async () => {
  start();
  const p1 = await create(K.purchase, { items: [[1, 10, 1000, 18], [3, 5, 200, 0]] });
  const p2 = await create(K.purchase, { items: [[1, 4, 1000, 18]], partyId: 2, date: D(3) });
  const l = lines(K.purchase, p1.id), lo = lines(K.purchase, p2.id);
  await refused('price above the purchase rate', () => prPost([pIt(l[0], 1, { unit_price: 1000.01 })]), 400, 'PRICE_ABOVE_PURCHASE');
  await refused('another vendor\'s bill', () => prPost([pIt(lo[0], 1)]), 400, 'FOREIGN_BILL');
  await refused('the same line twice', () => prPost([pIt(l[0], 1), pIt(l[0], 1)]), 400, 'DUPLICATE_LINE');
  await refused('a line that does not exist', () => prPost([pIt({ id: 99999 }, 1)]), 400, 'UNKNOWN_LINE');
  await refused('over-return', () => prPost([pIt(l[0], 11)]), 400, 'OVER_RETURN');
  await refused('quantity 0', () => prPost([pIt(l[0], 0)]), 400, 'VALIDATION');
  await refused('negative quantity', () => prPost([pIt(l[0], -1)]), 400, 'VALIDATION');
  await refused('no lines', () => prPost([]), 400, 'VALIDATION');
  await refused('payment status 2', () => prPost([pIt(l[0], 1)], { payment_status: 2 }), 400, 'VALIDATION');
  await refused('negative P&F', () => prPost([pIt(l[0], 1)], { packing_forwarding_amount: -5 }), 400, 'VALIDATION');
  // more than in stock (some sold since): sell the Brake Pads down to 1
  await create(K.sale, { items: [[1, store.product[0].stock - 1, 1, 0]], date: D(3) });
  await refused('more than in stock', () => prPost([pIt(l[0], 2)]), 400, 'INSUFFICIENT_STOCK');
  const r = await prPost([pIt(l[0], 1)]);
  const rid = r.body.data.return.id;
  ok('1 in stock: returned', r.status === 201 && store.product[0].stock === 0, store.product[0]);
  await refused('edit: more than in stock (1 given back, 2 asked)', () => call(H.prOne, 'PUT', { id: String(rid) }, { items: [pIt(l[0], 2)], packing_forwarding_amount: 0 }), 400, 'INSUFFICIENT_STOCK');
  const e = await call(H.prOne, 'PUT', { id: String(rid) }, { items: [pIt(l[0], 1)], packing_forwarding_amount: 0 });
  ok('edit: keeping the same quantity with 0 in stock is fine', e.status === 200, e.body);
  await refused('edit: another vendor\'s line', () => call(H.prOne, 'PUT', { id: String(rid) }, { items: [pIt(lo[0], 1)] }), 400, 'FOREIGN_BILL');
  await refused('edit: no items', () => call(H.prOne, 'PUT', { id: String(rid) }, {}), 400, 'VALIDATION');
  await refused('edit: negative P&F', () => call(H.prOne, 'PUT', { id: String(rid) }, { items: [pIt(l[0], 1)], packing_forwarding_amount: -1 }), 400, 'VALIDATION');
  await refused('a return that does not exist', () => call(H.prOne, 'DELETE', { id: '424242' }), 404, 'NOT_FOUND');
  await refused('a refund cannot be allocated to it', () => call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 100, refund_mode: 0, refund_date: D(5), allocations: [{ return_id: rid, allocated_amount: 100 }] }), 400, 'REFUND_VIA_RETURN');
  await done('purchase refusals');
});

test('the list filters exactly as the screens send them (captured URLs) find the right returns', async () => {
  const L = FX('list-queries.json');
  start();
  const s = await create(K.sale, { items: [[1, 10, 1000, 18], [3, 5, 200, 0]] });
  const x = await create(K.salex, { items: [[1, 10, 1000, 0]] });
  const p = await create(K.purchase, { items: [[1, 10, 1000, 18]] });
  const ls = lines(K.sale, s.id), lx = lines(K.salex, x.id), lp = lines(K.purchase, p.id);
  const a = (await srPost([sIt(ls[0], 1)])).body.data.returns[0].id;                     // SR-1000: 1 line, pending, bank
  await srPost([sIt(ls[1], 1)], { payment_status: 1, payment_mode: 0, payment_date: D(6) }); // SR-1001: refunded, cash
  await srPost([sIt(lx[0], 2, 'invoicex')]);                                               // SXR-1000
  await prPost([pIt(lp[0], 1)], { packing_forwarding_amount: 50 });                        // PR-1000, P&F 50
  await prPost([pIt(lp[0], 1)], { payment_status: 1 });                                    // PR-1001 refunded
  const get = async (h, u) => (await call(h, 'GET', listUrl(u))).body;
  const ids = (b) => b.returns.map(r => `${r.invoice_type || 'p'}-${r.id}`).sort().join();
  const C = L.customer, V = L.vendor;
  ok('customer initial: all three', ids(await get(saleList, C.initial)) === 'invoice-1000,invoice-1001,invoicex-1000', ids(await get(saleList, C.initial)));
  ok('Return No "SR-1": SR-001 only - none here (ids are 1000+); "SR-1000" finds the sale one only', ids(await get(saleList, C.returnNo)) === '' && ids(await get(saleList, C.returnNo.replace('SR-1', 'SR-1000'))) === 'invoice-1000', [C.returnNo]);
  ok('Invoice No "1": both bills numbered 1 (sale #1 and Invoice C #1)', ids(await get(saleList, C.invoiceNo)) === 'invoice-1000,invoice-1001,invoicex-1000', ids(await get(saleList, C.invoiceNo)));
  ok('Customer "ravi": all three', ids(await get(saleList, C.party)) === 'invoice-1000,invoice-1001,invoicex-1000', '');
  ok('Items Qty 1: all three have one line', (await get(saleList, C.itemCount)).returns.length === 3, '');
  ok('Payment Mode Cash: the refunded one', ids(await get(saleList, C.paymentMode)) === 'invoice-1001', ids(await get(saleList, C.paymentMode)));
  ok('Status Pending refund: SR-1000 and SXR-1000', ids(await get(saleList, C.status)) === 'invoice-1000,invoicex-1000', ids(await get(saleList, C.status)));
  const srt = await get(saleList, C.sort);
  ok('sorted by Items Qty asc (ties: newest first, sale before Invoice C)', srt.returns.length === 3 && srt.returns.every(r => r.item_count === 1), srt.returns.map(r => r.return_no));
  ok('vendor initial: both', ids(await get(purList, V.initial)) === 'p-1000,p-1001', '');
  ok('vendor dropdown: vendor=1 both', ids(await get(purList, V.party)) === 'p-1000,p-1001', V.party);
  ok('P/F 50: PR-1000', ids(await get(purList, V.pf)) === 'p-1000', ids(await get(purList, V.pf)));
  ok('Status Refunded: PR-1001', ids(await get(purList, V.status)) === 'p-1001', ids(await get(purList, V.status)));
  const row = (await get(saleList, C.initial)).returns.find(r => r.id === a && r.invoice_type === 'invoice');
  ok('a row carries what the list and the delete need (kind, number, bill, customer, items, total, date, mode, status)', row.invoice_type === 'invoice' && row.return_no === 'SR-1000' && row.invoice_no === '1' && row.customer_name === 'Ravi' && row.item_count === 1 && N(row.total_amount) === 1000 && row.formattedDate && row.payment_mode === 1 && row.payment_status === 0, row);
  await done('lists');
});

test('the bill pickers and the reasons', async () => {
  const L = FX('list-queries.json');
  start();
  store.return_reasons = FX('sale.json').seed.reasons.map(r => ({ ...r }));
  const s = await create(K.sale, { items: [[1, 10, 1000, 18], [3, 5, 200, 0]], extra: {} });
  // a discounted line: 4 x 250 less 100 -> 225 each
  const s2 = await create(K.sale, { items: [[2, 4, 250, 18]], date: D(3) });
  store.invoiceitems.find(l => l.invoice_no === s2.id).discount = 100;
  const x = await create(K.salex, { items: [[1, 10, 1000, 0]] });
  const old = await create(K.sale, { items: [[1, 1, 1000, 0]], date: '2026-06-01' });
  const ls = lines(K.sale, s.id);
  await srPost([sIt(ls[1], 5)]);                       // line 2 of the first bill fully returned
  await srPost([sIt(lines(K.sale, old.id)[0], 1)]);    // the old bill fully returned
  const ci = (q) => call(customerItems, 'GET', { ...listUrl(L.customerItems[0]), ...q });
  let r = await ci({});
  const bills = r.body.data.bills;
  ok('customer picker (as the screen asks: 3 months): sale bills and the Invoice C bill, the old one out of range', r.status === 200 && bills.length === 3 && !bills.some(b => b.invoice_id === old.id && b.invoice_type === 'invoice'), bills.map(b => b.id));
  const b1 = bills.find(b => b.id === `invoice-${s.id}`);
  ok('a partly returned bill: 1/2 lines available, the returned line shows 0 left', b1.available_items === 1 && b1.total_items === 2 && b1.items.find(i => i.invoice_item_id === ls[1].id).available_qty === 0, b1);
  const d = bills.find(b => b.id === `invoice-${s2.id}`).items[0];
  ok('a discounted line is offered at its net price (225) with its own GST', d.unit_price === 225 && d.tax_rate === 18, d);
  const xb = bills.find(b => b.invoice_type === 'invoicex');
  ok('Invoice C: no tax, kind on every line', xb.has_tax === false && xb.items.every(i => i.invoice_type === 'invoicex' && i.tax_rate === 0 && i.id.startsWith('invoicex-')), xb);
  r = await ci({ from_date: '', to_date: '' });
  ok('without a range: the fully returned old bill is still hidden', !r.body.data.bills.some(b => b.invoice_id === old.id && b.invoice_type === 'invoice'), r.body.data.bills.map(b => b.id));
  // vendor picker
  const p = await create(K.purchase, { items: [[1, 3, 1000, 18]] });
  const p2 = await create(K.purchase, { items: [[3, 2, 200, 0]], date: D(3) });
  await prPost([pIt(lines(K.purchase, p2.id)[0], 2)]);
  r = await call(vendorItems, 'GET', { vendor_id: '1', page: '1', limit: '50', from_date: '2026-07-04', to_date: '2026-10-04' });
  const vb = r.body.data.bills;
  ok('vendor picker: the fully returned bill hidden, current stock on each line', vb.length === 1 && vb[0].id === String(p.id) && vb[0].items[0].current_stock === store.product[0].stock && vb[0].has_tax === true, vb);
  r = await call(vendorItems, 'GET', { page: '1' });
  ok('vendor picker without a vendor: 400', r.status === 400, r.body);
  r = await call(customerItems, 'GET', { page: '1' });
  ok('customer picker without a customer: 400', r.status === 400, r.body);
  // reasons, as the forms ask
  const rs = await call(reasons, 'GET', listUrl(L.reasons[0]));
  ok('reasons ?type=sale: the 7 sale reasons only (Invoice C uses them too; the 7 "salex" rows are never shown)', rs.body.data.length === 7 && rs.body.data.every(x => x.type === 'sale'), rs.body.data);
  const rp = await call(reasons, 'GET', { type: 'purchase' });
  ok('reasons ?type=purchase: 4, and id 1 is one of them', rp.body.data.length === 4 && rp.body.data.some(x => x.id === 1), rp.body.data);
  // (an old bill outside October is part of this test, so the October report checks do not apply)
  await checkAll('pickers'); expect(stats.failures).toEqual([]);
});

test('one request, several bills: a sale return per bill and kind; a purchase return spans its bills (asymmetry, D-15)', async () => {
  start();
  const s1 = await create(K.sale, { items: [[1, 2, 1000, 0]] });
  const s2 = await create(K.sale, { items: [[3, 2, 200, 0]], date: D(3) });
  const x1 = await create(K.salex, { items: [[1, 2, 1000, 0]] });
  const r = await srPost([sIt(lines(K.sale, s1.id)[0], 2), sIt(lines(K.sale, s2.id)[0], 1), sIt(lines(K.salex, x1.id)[0], 1, 'invoicex')], { payment_status: 1, payment_mode: 0 });
  const made = r.body.data.returns;
  ok('three returns: two sale (one per bill), one Invoice C; each with its own CREDIT_NOTE + REFUND', r.status === 201 && made.length === 3 && made.filter(m => m.kind === 'sale').length === 2 && store.customer_ledger.filter(l => /_return$/.test(l.reference_type)).length === 6, made);
  ok('bill statuses: s1 full, s2 partial, Invoice C partial', store.invoice.find(b => b.id === s1.id).return_status === 2 && store.invoice.find(b => b.id === s2.id).return_status === 1 && store.invoicex[0].return_status === 1, [store.invoice, store.invoicex].map(t => t.map(b => b.return_status)));
  const p1 = await create(K.purchase, { items: [[1, 2, 1000, 0]] });
  const p2 = await create(K.purchase, { items: [[3, 4, 200, 0]], date: D(3) });
  const pr = await prPost([pIt(lines(K.purchase, p1.id)[0], 2), pIt(lines(K.purchase, p2.id)[0], 1)]);
  const pid = pr.body.data.return.id;
  ok('one purchase return over both bills, headed by the first', pr.status === 201 && store.purchase_returns.length === 1 && store.purchase_returns[0].purchase_id === p1.id, store.purchase_returns);
  const row = (await call(purList, 'GET', {})).body.returns[0];
  ok('the list shows both bill numbers', row.invoice_no === `${store.purchase.find(b => b.id === p1.id).invoice_no}, ${store.purchase.find(b => b.id === p2.id).invoice_no}`, row.invoice_no);
  const reg = (await call(H.returnsR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '50', kinds: 'purchase' })).body.returns[0];
  ok('the returns register shows only the header bill (D-15)', reg.bill_id === p1.id, reg);
  const g = await call(H.prOne, 'GET', { id: String(pid) });
  ok('the view lists both bills', g.body.data.bills.length === 2, g.body.data.bills.map(b => b.invoice_no));
  ok('statuses: p1 full, p2 partial', store.purchase.find(b => b.id === p1.id).return_status === 2 && store.purchase.find(b => b.id === p2.id).return_status === 1, store.purchase.map(b => b.return_status));
  await call(H.prOne, 'DELETE', { id: String(pid) });
  ok('delete recomputes both bills', store.purchase.every(b => b.return_status === 0), store.purchase.map(b => b.return_status));
  await done('multi-bill');
});

test('a refunded purchase return\'s date edit moves its DEBIT_NOTE; the register and the cash book follow', async () => {
  start();
  const p = await create(K.purchase, { items: [[1, 10, 1000, 0]] });
  const l = lines(K.purchase, p.id)[0];
  const rid = (await prPost([pIt(l, 2)], { payment_status: 1, payment_date: D(6) })).body.data.return.id;
  const e = await call(H.prOne, 'PUT', { id: String(rid) }, { return_date: D(9), payment_status: 1, payment_mode: 0, payment_date: D(11), packing_forwarding_amount: 0, items: [pIt(l, 2)] });
  const note = store.vendor_ledger.find(x => x.reference_type === 'purchase_return' && x.reference_id === rid);
  ok('saved: note on the new return date, counters unchanged, mode and payment date as sent', e.status === 200 && note.transaction_date === ts(D(9)) && store.vendor_details[1].total_refunded === 2000 && store.purchase_returns[0].payment_mode === 0 && store.purchase_returns[0].payment_date === ts(D(11)), { note, r: store.purchase_returns[0] });
  const cb = (await call(H.cashBookR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '50' })).body.rows.find(x => x.kind === 'purchase_return');
  ok('cash book: in on the payment date, cash', cb.date === ts(D(11)) && cb.mode === 'Cash' && cb.money_in === 2000, cb);
  await done('date edit');
});

test('dead stock refusals and list', async () => {
  start();
  await refused('no reason', () => call(H.deadCreate, 'POST', {}, { product_id: 1, quantity: 1, reason: '  ' }), 400, 'VALIDATION');
  await refused('no product', () => call(H.deadCreate, 'POST', {}, { quantity: 1, reason: 'x' }), 400, 'VALIDATION');
  await refused('quantity 0', () => call(H.deadCreate, 'POST', {}, { product_id: 1, quantity: 0, reason: 'x' }), 400, 'VALIDATION');
  await refused('a product that does not exist', () => call(H.deadCreate, 'POST', {}, { product_id: 999, quantity: 1, reason: 'x' }), 400, 'VALIDATION');
  const r = await call(H.deadCreate, 'POST', {}, { product_id: 2, quantity: 4, reason: 'rusted clutch' });
  const id = r.body.data.id;
  await refused('edit to a fraction', () => call(H.deadOne, 'PUT', { id: String(id) }, { quantity: 4.5, reason: 'x' }), 400, 'VALIDATION');
  await refused('edit without a reason', () => call(H.deadOne, 'PUT', { id: String(id) }, { quantity: 5, reason: '' }), 400, 'VALIDATION');
  await refused('edit an entry that does not exist', () => call(H.deadOne, 'PUT', { id: '999' }, { quantity: 5, reason: 'x' }), 404, 'NOT_FOUND');
  await refused('delete an entry that does not exist', () => call(H.deadOne, 'DELETE', { id: '999' }), 404, 'NOT_FOUND');
  const l = await call(H.deadCreate, 'GET', { search: 'Clutch', page: '1', limit: '10' });
  ok('search by product name', l.body.deadstock.length === 1 && l.body.deadstock[0].product_name === 'Clutch Plate' && l.body.deadstock[0].quantity === 4, l.body);
  for (const d of store.deadstock) d.created_at = d.created_at || new Date(Date.UTC(2026, 9, 3, 6)); // MySQL DEFAULT now()
  const st = (await call(H.stockR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '50' })).body.products.find(x => x.product_id === 2);
  ok('stock report: dead stock 4, closing 996', st.dead_stock === 4 && st.closing_qty === 996, st);
  await done('dead stock');
});
