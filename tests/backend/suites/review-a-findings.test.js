// Reviewer A - Purchases: findings (docs/review/purchases.md). Each test states what the user
// expects and runs with test.failing while the behaviour is wrong today: the suite stays green,
// and a test turns RED the day its finding is fixed - then make it a plain test.
// Bodies are the screens' own (fixtures/purchases, captured by harness/review-a-capture.jsx).
// Set REVIEW_A_SHOW=1 to run them as plain tests and read why each fails.
import fs from 'fs';
import path from 'path';
import { K, store, call, sum, N, H, rows, bal, billNet, payRows, allocs, paidOn, lines, bill, payments, stock, counters, D, ex, pay } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, RANGE } from '../support/flowlib.js';
import { normalizeBill } from '../../../hooks/useBills';
import { preparePurchaseDataForExport } from '../../../lib/export-layouts/purchase-view-layout';

const k = K.purchase;
const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/purchases', name), 'utf8'));
function seed() {
  reset();
  Object.assign(store.vendor_details[1], { state: 'Uttar Pradesh', state_code: 9, contact_no: '1', email: 'b@x.in', tax_id: '09BOSCH1234F1Z5', address: 'Noida', city: 'Noida', pin_code: '201301' });
  Object.assign(store.vendor_details[2], { state: 'Delhi', state_code: 7 });
  store.staff = [{ id: 3, name: 'Ramesh', phone: '98' }];
  for (const p of store.product) Object.assign(p, { stock: 1000, opening_stock: 1000, last_purchase_date: null, latest_purchase_rate: null });
  stats.failures = [];
}
const prismaDates = () => { for (const p of store.purchase) if (typeof p.bill_reference_date === 'string') p.bill_reference_date = new Date(p.bill_reference_date); };
const POST = async (body) => { const r = await call(k.create, 'POST', {}, body); prismaDates(); return { r, id: r.body?.purchase?.id }; };
const PUT = async (id, body) => { const r = await call(k.one, 'PUT', { id: String(id) }, body); prismaDates(); return r; };
const relined = (body, id) => { const have = lines(k, id); return { ...body, items: body.items.map((it, i) => (it.line_id !== undefined ? { ...it, line_id: have[i].id } : it)) }; };
/** The create-paid screen body, one Brake Pad line at `qty` x 1000, no tax, no freight / P&F: 1000 per unit. */
const simple = (qty = 10, extra = {}) => ({ ...fx('create-paid.json'), transport_cost: 0, packing_forwarding_qty: 0, packing_forwarding_rate: 0, items: [{ ...fx('create-paid.json').items[0], qty, gst_percentage: 0 }], ...extra });
/** The edit screen's body for such a bill: its one line at `qty` (rate 1000, as the user typed it). */
const editQty = (id, qty, extra = {}) => { const b = fx('edit-notes.json'); return { ...b, transport_cost: 0, packing_forwarding_qty: 0, packing_forwarding_rate: 0, items: [{ ...b.items[0], line_id: lines(k, id)[0].id, qty, gst_percentage: 0 }], ...extra }; };

const F = process.env.REVIEW_A_SHOW ? test : test.failing;
const finding = (id, title, fn, { known = [] } = {}) => F(`${id} ${title}`, async () => {
  seed();
  await fn();
  prismaDates();
  await checkAll(id, known);
  await checkReports(id);
  expect(stats.failures).toEqual([]);
});

describe('A - findings (test.failing while open)', () => {
  // ---------------------------------------------------------------- A-01
  finding('A-01a', 'paid on create, lowered, deleted: the payment stays as advance, so its ledger credit must stay too', async () => {
    const { id } = await POST(simple(10));
    await PUT(id, editQty(id, 8));                                        // 10000 -> 8000: 2000 becomes advance (owner)
    const r = await call(k.one, 'DELETE', { id: String(id) });
    ex('A-01a', 'deleted; the 10000 payment stays (DIRECT, advance)', r.status === 200 && payments(k).length === 1 && payments(k)[0].payment_amount === 10000, payments(k));
    ex('A-01a', 'the ledger still credits the 10000 that was paid: vendor balance -10000', bal(k) === -10000, rows(k));
  });
  finding('A-01b', 'paid on create, lowered, then marked Unpaid by the edit form: same - the ledger loses the payment', async () => {
    const { id } = await POST(simple(10));
    await PUT(id, editQty(id, 8));
    const r = await PUT(id, { ...editQty(id, 8), payment_status: 0 });
    ex('A-01b', 'unpaid; the payment stays as advance (it is MIXED, not this bill\'s own)', r.status === 200 && bill(k, id).payment_status === 0 && payments(k).length === 1, { r: r.body, p: payments(k) });
    ex('A-01b', 'ledger: 8000 owed less 10000 paid = -2000', bal(k) === -2000, rows(k));
  });
  finding('A-01c', 'one Mark-as-Paid payment for two bills, one lowered then deleted: the other bill\'s payment row survives, the advance too', async () => {
    const a = (await POST(simple(10, { payment_status: 0 }))).id, b = (await POST(simple(10, { payment_status: 0 }))).id;
    await pay(k, 20000, [[k, a, 10000], [k, b, 10000]], { mode: 1 });
    await PUT(a, editQty(a, 8));
    await call(k.one, 'DELETE', { id: String(a) });
    ex('A-01c', 'payment 20000 kept: 10000 on B, 10000 advance; ledger -10000 + 10000 owed... = 0 owed on B, 10000 advance: balance -10000', payments(k)[0]?.payment_amount === 20000 && paidOn(k, b) === 10000 && bal(k) === -10000, { p: payments(k), l: rows(k) });
  });

  // ---------------------------------------------------------------- A-02
  finding('A-02a', '"Other" paid on create: vendor 0 is a real vendor row, so its counters move like any vendor\'s', async () => {
    const body = { ...fx('create-other-unpaid.json'), payment_status: 1, payment_mode: 0 };
    const { r } = await POST(body);
    ex('A-02a', 'created paid with its payment', r.status === 201 && payments(k, 0).length === 1, r.body);
    ex('A-02a', 'vendor 0: total_paid and total_allocated 2360 (an "Other" bill marked paid by an edit does move them)', counters(k, 0).paid === 2360 && counters(k, 0).alloc === 2360, counters(k, 0));
  });
  finding('A-02b', '"Other" paid on create, then deleted: counters must not go below zero', async () => {
    const { id } = await POST({ ...fx('create-other-unpaid.json'), payment_status: 1, payment_mode: 0 });
    await call(k.one, 'DELETE', { id: String(id) });
    ex('A-02b', 'vendor 0 counters back to 0 (today -2360 / -2360)', counters(k, 0).paid === 0 && counters(k, 0).alloc === 0, counters(k, 0));
  });

  // ---------------------------------------------------------------- A-03
  finding('A-03', 'a paid bill at rate 0, then priced by an edit: it cannot stay "Paid" with nothing paid, and no payment may be invented', async () => {
    const { id } = await POST({ ...simple(10), items: [{ ...simple(10).items[0], rate: 0 }] });
    ex('A-03', 'rate-0 bill created paid at 0 (allowed)', bill(k, id).total === 0 && bill(k, id).payment_status === 1, bill(k, id));
    const e = await PUT(id, editQty(id, 10));                             // the form sends no status: the user only typed a rate
    ex('A-03', 'saved, total 10000', e.status === 200 && bill(k, id).total === 10000, e.body);
    ex('A-03', 'unpaid (nothing allocated) - not "Paid"', bill(k, id).payment_status === 0 && paidOn(k, id) === 0, { b: bill(k, id), a: allocs(k, id) });
    ex('A-03', 'total_paid stays 0 (today +10000 with no payment row)', counters(k).paid === 0, counters(k));
  });

  // ---------------------------------------------------------------- A-04
  finding('A-04a', 'an advance the vendor refunded back is not an advance any more: a paid purchase must be paid with new money', async () => {
    await pay(k, 1000, [], { date: D(1) });                               // advance 1000
    const rr = await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_date: D(1), refund_mode: 0, refund_amount: 1000, allocations: [] });
    ex('A-04a', 'vendor refunded the 1000: square', rr.status === 201 && bal(k) === 0, rows(k));
    const { r } = await POST(simple(2));                                  // 2000, paid on create
    ex('A-04a', 'one new payment of 2000 (today: none - "paid" from an advance of 2000 that does not exist)', r.status === 201 && payments(k).filter(p => p.payment_type === 'BILL_SPECIFIC').reduce((s, p) => s + p.payment_amount, 0) === 2000, payments(k));
    ex('A-04a', 'ledger square after paying the bill', bal(k) === 0, rows(k));
  });
  finding('A-04b', 'a refund received (500) is not spent again on every later paid purchase', async () => {
    await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_date: D(1), refund_mode: 0, refund_amount: 500, allocations: [] });
    await POST(simple(10)); await POST(simple(10));
    const carried = payments(k).filter(p => /carried/.test(p.notes || ''));
    ex('A-04b', 'no "carried advance" payment rows invented (today one per purchase, 500 each)', carried.length === 0, carried);
    ex('A-04b', 'the two bills are paid with 20000 of new money; ledger: 500 refund owed back', sum(payRows(k), l => l.credit) === 20000 && bal(k) === 500, rows(k));
  });
  finding('A-04c', 'the same through the edit form (Unpaid -> Paid) with only a refund on the account', async () => {
    await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_date: D(1), refund_mode: 0, refund_amount: 500, allocations: [] });
    const { id } = await POST(simple(10, { payment_status: 0 }));
    await PUT(id, { ...editQty(id, 10), payment_status: 1 });
    ex('A-04c', 'one 10000 payment; ledger 500 (the refund) owed back', sum(payments(k), p => p.payment_amount) === 10000 && bal(k) === 500, { p: payments(k), l: rows(k) });
  });

  // ---------------------------------------------------------------- A-05
  finding('A-05', 'a paid bill whose payment mode is changed on the edit form: its payment (and the cash book) follow', async () => {
    const { id } = await POST(simple(10, { payment_mode: 0 }));           // paid in cash
    const e = await PUT(id, editQty(id, 10, { payment_mode: 1 }));         // the user switches the form to Bank
    ex('A-05', 'bill says Bank', e.status === 200 && bill(k, id).payment_mode === 1, bill(k, id));
    ex('A-05', 'its own payment and ledger row say Bank too (today Cash)', payments(k)[0].payment_mode === 1 && payRows(k)[0].payment_mode === 1, { p: payments(k), l: payRows(k) });
    const cb = (await call(H.cashBookR, 'GET', RANGE)).body.totals;
    ex('A-05', 'cash book: 10000 out by bank', cb.bankNet === -10000 && cb.cashNet === 0, cb);
  });

  // ---------------------------------------------------------------- A-06
  finding('A-06', 'save back unchanged (the form\'s own body) changes nothing: empty text stays empty text', async () => {
    const { id } = await POST(fx('create-unpaid.json'));
    const before = JSON.stringify(bill(k, id));
    const d = (await call(k.one, 'GET', { id: String(id) })).body;
    const b = normalizeBill('purchase', d);
    const body = { ...relined(fx('edit-unmark.json'), id) }; delete body.payment_status; // the untouched form: what edit-unmark sent, status not picked
    ex('A-06', 'the body is what the form loaded (notes / reference / transport empty)', body.notes === b.notes && body.bill_reference === b.bill_reference && body.transport_name === b.transport_name);
    await PUT(id, body);
    ex('A-06', 'purchase row identical (today notes, bill_reference, descriptions, transport, transport_name, vehicle_number go "" -> null)', JSON.stringify(bill(k, id)) === before, [before, JSON.stringify(bill(k, id))]);
  });

  // ---------------------------------------------------------------- A-08
  finding('A-08', 'lines saved by create carry the product\'s HSN, as lines added by an edit do', async () => {
    const { id } = await POST(fx('create-paid.json'));
    ex('A-08', 'both lines: HSN 8708 / 8421 (today empty -> "N/A" on the view and the export)', lines(k, id)[0].hsn === '8708' && lines(k, id)[1].hsn === '8421', lines(k, id));
  });

  // ---------------------------------------------------------------- A-09
  finding('A-09', 'deleting a purchase rolls the product\'s latest purchase rate and date back', async () => {
    const { id } = await POST(simple(1, { payment_status: 0, date: D(5), items: [{ ...simple(1).items[0], rate: 1500 }] }));
    await call(k.one, 'DELETE', { id: String(id) });
    ex('A-09', 'after the delete: no purchase left, so no latest rate / date from it', !store.product[0].latest_purchase_rate && !store.product[0].last_purchase_date, store.product[0]);
    await POST(simple(1, { payment_status: 0, date: D(3) }));
    ex('A-09', 'the next (earlier-dated) purchase at 1000 sets the rate the form offers next time', store.product[0].latest_purchase_rate === 1000, store.product[0]);
  });

  // ---------------------------------------------------------------- A-10
  finding('A-10', 'marking an old bill Paid on the edit form records the payment on the day it is marked, as Mark as Paid does - not backdated to the bill date', async () => {
    const { id } = await POST(simple(10, { payment_status: 0, date: D(1) }));
    await PUT(id, { ...editQty(id, 10, { date: D(1) }), payment_status: 1 });
    const today = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime() / 1000);
    ex('A-10', 'payment dated today (today: 1 Oct, the bill date)', payments(k)[0]?.payment_date >= today, { p: payments(k)[0]?.payment_date, today });
  }, { known: ['A2'] });

  // ---------------------------------------------------------------- A-11
  finding('A-11', '"Other" (vendor 0, a real vendor row) can be paid on the payments API like any vendor', async () => {
    const { id } = await POST(fx('create-other-unpaid.json'));
    const body = fx('mark-paid-part.json');
    const r = await call(H.vpCreate, 'POST', {}, { ...body, vendor_id: 0, payment_amount: 1000, allocations: [{ purchase_id: id, allocated_amount: 1000, notes: null }] });
    ex('A-11', '201 (today 400 "Missing required fields": vendor_id 0 is read as missing)', r.status === 201, r.body);
  });

  // ---------------------------------------------------------------- A-12
  F('A-12 the purchase export\'s line Total is the line total the screen shows (taxable + tax)', async () => {
    seed();
    const { id } = await POST(fx('create-paid.json'));
    const d = (await call(k.one, 'GET', { id: String(id) })).body;
    const shown = normalizeBill('purchase', d).items.map(i => i.total);
    const exported = preparePurchaseDataForExport(d).items.map(i => i.total);
    expect(exported).toEqual(shown);                                       // today [10000, 1000] vs [11800, 1000]
  });

  // ---------------------------------------------------------------- A-13
  finding('A-13', 'an edit moves the bill\'s updated_at', async () => {
    const { id } = await POST(fx('create-paid.json'));
    store.purchase.find(p => p.id === id).updated_at = '2026-01-01';
    await PUT(id, relined(fx('edit-notes.json'), id));
    ex('A-13', 'updated_at is today after the edit (today: never written by an edit)', bill(k, id).updated_at !== '2026-01-01', bill(k, id).updated_at);
  });
});
