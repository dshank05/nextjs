// Review C (money): findings and refusals for payments, refunds, party transactions and ledgers.
//
// `C-nn` tests are findings - wrong today - registered with test.failing: the run stays green
// while the finding is open and turns RED the day the behaviour is fixed (then make it a plain
// test). Each asserts the CORRECT behaviour. The `R-nn` tests are refusals and edge paths that hold
// today (coverage added by this review). Bodies come from the screens where a fixture exists
// (tests/backend/fixtures/transactions, captured by harness/review-c-capture.jsx).
import { store } from '../support/dbstub.js';
import { H, call, reset, checkAll, checkReports, stats, ok, N, r2, sum, RANGE } from '../support/flowlib.js';
import { seedStock, K, create, pay, D } from '../support/scenlib.js';
import custList from '../../../pages/api/customer-transactions/index';
import custLedgerNote from '../../../pages/api/customer-ledger/[id]';
import adjustments from '../../../pages/api/customer-adjustments/index';

const FX = (name) => JSON.parse(JSON.stringify(require('../fixtures/transactions/' + name + '.json')));
const INDEX = require('../fixtures/transactions/index.json');
const ROUTE = { sales: H.sales, salex: H.salex, purchases: H.purchases };
const bills = {};
async function seed() {
  reset(); seedStock(); stats.failures = [];
  for (const s of INDEX.seed) {
    const r = await call(ROUTE[s.route], 'POST', {}, JSON.parse(JSON.stringify(s.body)));
    bills[s.name] = r.body?.purchase?.id ?? r.body?.sale?.id;
  }
  for (const [n, amt] of [['A1', 600.1], ['A2', 600.2], ['A3', 600.3]]) await call(H.cpCreate, 'POST', {}, { customer_id: 2, payment_date: '2026-10-03', payment_mode: 1, payment_amount: amt, allocations: [{ invoice_id: bills[n], allocated_amount: amt }] });
  for (const [n, amt] of [['Q1', 600.1], ['Q2', 600.2], ['Q3', 600.3]]) await call(H.vpCreate, 'POST', {}, { vendor_id: 2, payment_date: '2026-10-03', payment_mode: 1, payment_amount: amt, allocations: [{ purchase_id: bills[n], allocated_amount: amt }] });
}
const KIND_OF = (name) => (/^X/.test(name) ? 'invoicex_id' : /^[PQ]/.test(name) ? 'purchase_id' : 'invoice_id');
function remap(fx, body) {
  const b = JSON.parse(JSON.stringify(body));
  for (const a of b.allocations || []) for (const f of ['invoice_id', 'invoicex_id', 'purchase_id']) {
    if (a[f] === undefined || a[f] === null) continue;
    a[f] = bills[Object.keys(fx.bills).find(n => KIND_OF(n) === f && fx.bills[n] === a[f])];
  }
  return b;
}
const HANDLER = { 'customer-payments': [H.cpCreate, H.cpOne], 'customer-refunds': [H.crCreate, H.crOne], 'vendor-payments': [H.vpCreate, H.vpOne], 'vendor-refunds': [H.vrCreate, H.vrOne] };
async function send(name, id, edit) {
  const fx = FX(name);
  const [, route, hasId] = fx.request.url.match(/^\/api\/([a-z-]+)(\/\d+)?/);
  let body = fx.request.body ? remap(fx, fx.request.body) : undefined;
  if (edit) body = edit(body);
  return call(HANDLER[route][hasId ? 1 : 0], fx.request.method, hasId ? { id: String(id) } : {}, body);
}
const ex = (what, cond, info) => ok(what, cond, info);
const done = async (step, known = []) => { await checkAll(step, known); await checkReports(step); expect(stats.failures).toEqual([]); };
const rowsOf = (ledger, type, txId) => store[ledger].filter(l => l.transaction_type === type && l.transaction_id === txId);
const tablesLen = () => JSON.stringify(Object.fromEntries(Object.entries(store).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])));
const deepCopy = (x) => JSON.parse(JSON.stringify(x));

// ===================================================================== findings (wrong today)

test('C-01 vendor Bill Specific payment over two bills: editing the amount (screen fixture 1300 -> 1200) must leave the ledger at 1200, not 1200 on every bill row', async () => {
  await seed();
  const id = (await send('vp-create-bill')).body.data.payment.id;
  const e = await send('vp-edit-changed', id);
  const rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ex('PUT 200', e.status === 200, e.body);
  ex('the payment\'s ledger rows credit 1200 in total (today 2 x 1200 = 2400)', r2(sum(rows, l => N(l.credit))) === 1200, rows.map(l => [l.reference_id, l.credit]));
  ex('one row per bill with that bill\'s share: P1 1000, P2 200 (owner rule)', JSON.stringify(rows.map(l => [l.reference_id, N(l.credit)])) === JSON.stringify([[bills.P1, 1000], [bills.P2, 200]]), rows);
  const o = await call(H.vendOut, 'GET', { page: '1', limit: '50' });
  ex('outstanding for Bosch: 1500 - 1200 = 300', N((o.body.outstandingVendors || []).find(v => v.vendor_id === 1)?.balance) === 300, o.body.outstandingVendors);
  await done('C-01', ['A2']);
});

for (const kind of ['sale', 'salex', 'purchase']) {
  test(`C-02 an on-account refund is counted as advance: a ${kind} created as Paid after "advance 1000, refunded 1000" must record new money for the whole bill`, async () => {
    reset(); seedStock(); stats.failures = [];
    const k = K[kind];
    await pay(k, 1000, [], { mode: 0, type: 'DIRECT' });                    // advance 1000
    const rf = await call(k.party === 'vendor' ? H.vrCreate : H.crCreate, 'POST', {}, { [k.who]: 1, refund_amount: 1000, refund_mode: 0, refund_date: D(4), allocations: [] }); // ...given back
    const p = store[k.master].find(x => x.id === 1);
    ex('after the refund the advance is 0 (account_balance = paid - allocated - refunded + refund allocated)', rf.status === 201 && N(p.total_paid) - N(p.total_allocated) - N(p.total_refunded) + N(p.total_refund_allocated) === 0, p);
    const { r, id } = await create(k, { items: [[3, 15, 100, 0]], status: 1, mode: 0, date: D(5) }); // 1500, paid in cash
    ex('bill created 201', r.status === 201, r.body);
    const newMoney = store[k.payTable].filter(x => store[k.allocTable].some(a => a.payment_id === x.id && a[k.payFk] === id) && !/Advance carried/.test(x.notes || ''));
    ex('the bill is paid by 1500 of new money (today: 1000 drawn from the refunded advance + a 500 "carried advance" row, no new payment)',
      r2(sum(store[k.allocTable].filter(a => a[k.payFk] === id && newMoney.some(x => x.id === a.payment_id)), a => N(a.allocated_amount))) === 1500, { pays: store[k.payTable], allocs: store[k.allocTable] });
    ex('no "carried advance" payment row was invented', !store[k.payTable].some(x => /Advance carried/.test(x.notes || '')), store[k.payTable]);
    const bal = r2(sum(store[k.ledger].filter(l => l[k.who] === 1), l => N(l.debit) - N(l.credit)));
    ex('the party ledger is square (a paid bill), not 1500 owed', bal === 0, store[k.ledger]);
    await done(`C-02 ${kind}`, ['A2']);
  });
}

test('C-03 vendor: moving a Bill Specific payment to another bill (screen edit) must move its ledger row; deleting the old bill must not take the payment\'s row', async () => {
  reset(); seedStock(); stats.failures = [];
  const k = K.purchase;
  const a = (await create(k, { items: [[3, 10, 100, 0]] })).id, b = (await create(k, { items: [[3, 10, 100, 0]] })).id;
  const { id } = await pay(k, 1000, [[k, a, 1000]], { mode: 1 });
  const e = await call(H.vpOne, 'PUT', { id: String(id) }, { vendor_id: '1', notes: '', payment_amount: 1000, payment_mode: 1, payment_date: 1790965800, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: b, allocated_amount: 1000, notes: 'Payment for Invoice 2' }] });
  const rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ex('PUT 200; bill a unpaid, bill b paid', e.status === 200 && store.purchase.find(x => x.id === a).payment_status === 0 && store.purchase.find(x => x.id === b).payment_status === 1);
  ex('the payment\'s ledger row now names bill b (today it still names bill a, "paid")', rows.length === 1 && rows[0].reference_id === b, rows);
  const d = await call(H.purchaseOne, 'DELETE', { id: String(a) });
  ex('deleting bill a (now unpaid) leaves the payment\'s ledger row in place (today it goes with bill a)', d.status === 200 && rowsOf('vendor_ledger', 'PAYMENT', id).length === 1, { d: d.body, rows: rowsOf('vendor_ledger', 'PAYMENT', id) });
  await done('C-03 vendor', ['A2']);
});

test('C-03 customer twin: a payment made with a paid sale, moved to another sale on the payments screen, loses its ledger row when the first sale is deleted', async () => {
  reset(); seedStock(); stats.failures = [];
  const k = K.sale;
  const a = (await create(k, { items: [[3, 5, 100, 0]], status: 1, mode: 0 })).id; // 500, paid on the bill: PAYMENT_RECEIVED tagged with the SALE
  const b = (await create(k, { items: [[3, 5, 100, 0]] })).id;
  const pid = store.customer_payments[0].id;
  const e = await call(H.cpOne, 'PUT', { id: String(pid) }, { customer_id: '1', notes: '', payment_amount: 500, payment_mode: 0, payment_date: 1790879400, payment_type: 'BILL_SPECIFIC', allocations: [{ invoice_id: b, allocated_amount: 500, notes: 'Payment for Invoice 2' }] });
  ex('PUT 200; sale a unpaid, sale b paid', e.status === 200 && store.invoice.find(x => x.id === a).payment_status === 0 && store.invoice.find(x => x.id === b).payment_status === 1, e.body);
  const d = await call(H.saleOne, 'DELETE', { id: String(a) });
  ex('sale a deleted; the payment (now on sale b) keeps its PAYMENT_RECEIVED row', d.status === 200 && rowsOf('customer_ledger', 'PAYMENT_RECEIVED', pid).length === 1, { d: d.body, l: store.customer_ledger });
  await done('C-03 customer');
});

for (const side of ['customer', 'vendor']) {
  test(`C-04 ${side}: a payment-mode edit (cash -> bank, screen fixtures) must reach the ledger rows the ledger report and ledger screen show`, async () => {
    await seed();
    const c = side === 'customer';
    // payment: bill specific (customer) / mixed (vendor: one row - C-01 aside), then the screen's edit with mode Bank
    // (vendor: the screen's unchanged save with only the mode switched to Bank - the amount edit is C-01)
    const pid = (await send(c ? 'cp-create-bill' : 'vp-create-bill')).body.data.payment.id;
    const pe = c ? await send('cp-edit-changed', pid) : await send('vp-edit-unchanged', pid, b => ({ ...b, payment_mode: 1 }));
    const rid = (await send(c ? 'cr-create' : 'vr-create')).body.data.refund.id;
    const re = await send(c ? 'cr-edit-changed' : 'vr-edit-changed', rid);
    const L = c ? 'customer_ledger' : 'vendor_ledger';
    const payRows = rowsOf(L, c ? 'PAYMENT_RECEIVED' : 'PAYMENT', pid), refRows = rowsOf(L, c ? 'REFUND_PAID' : 'REFUND_RECEIVED', rid);
    ex('both edits 200; payment and refund now bank (1)', (pe.status ?? pe.r?.status) === 200 && re.status === 200 && store[c ? 'customer_payments' : 'vendor_payments'].find(x => x.id === pid).payment_mode === 1 && store[c ? 'customer_refunds' : 'vendor_refunds'].find(x => x.id === rid).refund_mode === 1);
    ex('the payment\'s ledger rows say bank (today: still cash, 0)', payRows.length > 0 && payRows.every(l => l.payment_mode === 1), payRows.map(l => l.payment_mode));
    ex('the refund\'s ledger row says bank (today: still cash, 0)', refRows.length === 1 && refRows[0].payment_mode === 1, refRows.map(l => l.payment_mode));
    const rep = await call(c ? H.custLedger : H.vendLedger, 'GET', { [c ? 'customer_id' : 'vendor_id']: '1' });
    ex('ledger report rows carry paymentMode 1 (the vendor ledger screen prints it as Cash / Bank)', (rep.body.entries || []).filter(e => e.transaction_id === pid || e.transaction_id === rid).filter(e => /PAYMENT|REFUND/.test(e.transactionType)).every(e => e.paymentMode === 1), rep.body.entries);
    await done(`C-04 ${side}`, ['A2']);
  });
}

test('C-05 notes: a payment edit must carry the payment\'s notes to its ledger row and must not overwrite a note typed on the ledger screen with system text', async () => {
  await seed();
  const pid = (await send('cp-create-bill')).body.data.payment.id;
  const row = rowsOf('customer_ledger', 'PAYMENT_RECEIVED', pid)[0];
  ex('created with the payment notes', row.notes === 'cash receipt', row);
  await call(custLedgerNote, 'PATCH', { id: String(row.id) }, FX('customer-ledger-note').request.body); // "checked with bank statement"
  await send('cp-edit-changed', pid); // notes "edited", amount 1300 -> 1200
  const after = rowsOf('customer_ledger', 'PAYMENT_RECEIVED', pid)[0];
  ex('ledger notes are not replaced by "Payment #… updated to ₹1200.00 (Bill specific)"', !/updated to/.test(after.notes), after.notes);
  // a notes-only edit reaches the ledger too
  const vid = (await send('vp-create-direct')).body.data.payment.id;
  await call(H.vpOne, 'PUT', { id: String(vid) }, { ...remap(FX('vp-create-direct'), FX('vp-create-direct').request.body), notes: 'paid by cheque 1234' });
  ex('vendor: a notes-only edit shows on the ledger row (today the row keeps "Direct advance payment ₹250")', rowsOf('vendor_ledger', 'PAYMENT', vid)[0].notes === 'paid by cheque 1234', rowsOf('vendor_ledger', 'PAYMENT', vid));
  await done('C-05', ['A2']);
});

for (const side of ['customer', 'vendor']) {
  test(`C-06 ${side}: Auto Allocate float residue (screen fixture: 1.14e-13 on a fourth bill) must not leave a zero allocation on that bill`, async () => {
    await seed();
    const c = side === 'customer';
    const fx = FX(c ? 'cp-auto-paise' : 'vp-auto-paise');
    ex('the screen really sent 4 allocations, the last ~1e-13', fx.request.body.allocations.length === 4 && fx.request.body.allocations[3].allocated_amount < 1e-9 && fx.request.body.allocations[3].allocated_amount > 0, fx.request.body.allocations);
    const r = await send(c ? 'cp-auto-paise' : 'vp-auto-paise');
    const id = r.body?.data?.payment?.id;
    const allocs = store[c ? 'customer_payment_allocations' : 'payment_allocations'].filter(a => a.payment_id === id);
    const fourth = bills[c ? 'A4' : 'Q4'];
    ex('201; three allocations, none of 0', r.status === 201 && allocs.length === 3 && allocs.every(a => N(a.allocated_amount) > 0), allocs);
    ex('the fourth bill has no allocation and no payment history entry', !allocs.some(a => a[c ? 'invoice_id' : 'purchase_id'] === fourth), allocs);
    if (!c) ex('no PAYMENT ledger row of 0 on the fourth bill', !store.vendor_ledger.some(l => l.transaction_type === 'PAYMENT' && l.reference_id === fourth), store.vendor_ledger.filter(l => l.reference_id === fourth));
    await done(`C-06 ${side}`, ['A2']);
  });
}

for (const side of ['customer', 'vendor']) {
  test(`C-07 ${side}: the edit form lets the party be changed (screen fixture); the PUT must not answer 200 and silently keep the old party`, async () => {
    await seed();
    const c = side === 'customer';
    const id = (await send(c ? 'cp-create-direct' : 'vp-create-direct')).body.data.payment.id;
    const before = deepCopy(store[c ? 'customer_payments' : 'vendor_payments'].find(x => x.id === id));
    const fx = FX(c ? 'cp-edit-party' : 'vp-edit-party');
    ex('the screen sent the other party', String(fx.request.body[c ? 'customer_id' : 'vendor_id']) === '2', fx.request.body);
    const r = await send(c ? 'cp-edit-party' : 'vp-edit-party', id);
    const now = store[c ? 'customer_payments' : 'vendor_payments'].find(x => x.id === id);
    ex('either refused (4xx), or the payment really moved to party 2 - not "200, still party 1"', r.status >= 400 || now[c ? 'customer_id' : 'vendor_id'] === 2, { r: r.status, before, now });
    await done(`C-07 ${side}`, ['A2']);
  });
}

test('C-08 vendor refund create with a zero allocation to a completed return must be refused like the customer twin (today: 201, the return goes back to pending)', async () => {
  reset(); seedStock(); stats.failures = [];
  const k = K.purchase;
  const a = (await create(k, { items: [[3, 10, 100, 0]] })).id;
  const line = store.purchaseitems.find(l => l.purchase_id === a);
  await call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(4), payment_status: 1, payment_mode: 0, items: [{ purchase_item_id: line.id, return_qty: 2, return_reason_id: 1 }] });
  const ret = store.purchase_returns[0];
  ex('return completed (1)', ret.payment_status === 1, ret);
  const before = tablesLen();
  const r = await call(H.vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 50, refund_mode: 0, refund_date: D(5), allocations: [{ return_id: ret.id, allocated_amount: 0 }] });
  const twin = await call(H.crCreate, 'POST', {}, { customer_id: 1, refund_amount: 50, refund_mode: 0, refund_date: D(5), allocations: [{ sale_return_id: 1, allocated_amount: 0 }] });
  ex('customer twin refuses it (400)', twin.status === 400, twin.body);
  ex('vendor refuses it too and writes nothing; the return stays completed', r.status === 400 && tablesLen() === before && store.purchase_returns[0].payment_status === 1, { r: r.body, st: store.purchase_returns[0].payment_status, ra: store.refund_allocations });
  await done('C-08', ['A2']);
});

test('C-09 save unchanged must change nothing: a payment / refund with no notes comes back with notes "" -> null (both parties)', async () => {
  await seed();
  const changed = [];
  for (const [create_, table, one] of [['cp-create-direct', 'customer_payments', H.cpOne], ['vp-create-direct', 'vendor_payments', H.vpOne]]) {
    const r = await send(create_);
    const id = r.body.data.payment.id;
    const before = deepCopy(store[table].find(x => x.id === id));
    await call(one, 'PUT', { id: String(id) }, remap(FX(create_), FX(create_).request.body)); // the form sends the same body on Update
    const after = store[table].find(x => x.id === id);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push({ table, before: before.notes, after: after.notes });
  }
  ex('no field changed', changed.length === 0, changed);
  await done('C-09', ['A2']);
});

test('C-10 GET /api/customer-payments and /api/customer-refunds: the customer filter is computed and thrown away (no screen calls these lists)', async () => {
  await seed();
  await send('cp-create-direct');
  const r = await call(H.cpCreate, 'GET', { customer: '1', page: '1', limit: '50' });
  ex('only customer 1\'s payments (today customer 2\'s three come back too)', r.status === 200 && r.body.payments.length > 0 && r.body.payments.every(p => p.customer_id === 1), r.body.payments.map(p => p.customer_id));
  await send('cr-create');
  const r3 = await call(H.crCreate, 'GET', { customer: '2' });
  ex('refunds: customer 2 has none', r3.body.refunds.length === 0, r3.body.refunds.map(x => x.customer_id));
  expect(stats.failures).toEqual([]);
});

// ===================================================================== information and questions (hold today)

test('C-12 (info) /api/customer-adjustments POST cannot succeed: it reads .id from a ledger write that returns nothing (500; MySQL rolls the transaction back). No screen calls it', async () => {
  await seed();
  const r = await call(adjustments, 'POST', {}, { adjustment_type: 'REFUND_PAID', customer_id: 1, adjustment_amount: 10, payment_mode: 0 });
  expect(r.status).toBe(500);
  const r2b = await call(adjustments, 'POST', {}, { adjustment_type: 'SALE_ADJUSTMENT', customer_id: 1, reference_id: bills.S1, adjustment_amount: 10 });
  expect(r2b.status).toBe(500);
});

test('Q-01 (owner question) Mixed asked and fully allocated stays MIXED; Bill Specific asked and part allocated becomes MIXED; nothing allocated is DIRECT', async () => {
  await seed();
  const m = await send('cp-create-mixed', null, b => ({ ...b, payment_amount: 200 })); // 200 on Invoice C, all of it
  const b = await send('cp-create-bill', null, x => ({ ...x, payment_amount: 1400 })); // 1300 allocated of 1400
  const d = await send('cp-create-bill', null, x => ({ ...x, allocations: [], payment_amount: 50 })); // Bill Specific with no allocation
  const t = (r) => store.customer_payments.find(p => p.id === r.body.data.payment.id).payment_type;
  expect([t(m), t(b), t(d)]).toEqual(['MIXED', 'MIXED', 'DIRECT']);
});

// ===================================================================== refusals and edges that hold (coverage added)

test('R-01 payment edit refusals (both parties): over the bill (own share excluded), another party\'s bill, more than the payment, same bill twice, unknown bill, amount 0 - each 400 with its code and nothing written', async () => {
  await seed();
  const cid = (await send('cp-create-bill')).body.data.payment.id;   // S1 1000, S2 300
  const vid = (await send('vp-create-bill')).body.data.payment.id;   // P1 1000, P2 300
  const cases = [
    ['customer', H.cpOne, cid, { invoice_id: bills.S2 }, 'OVER_BILL', 501, 1501],         // S2 is 500: 501 too much even with its own 300 back
    ['customer', H.cpOne, cid, { invoice_id: bills.A4 }, 'FOREIGN_BILL', 10, 1310],        // Asha's bill
    ['customer', H.cpOne, cid, { invoice_id: bills.S2 }, 'OVER_ALLOCATED', 400, 1000],
    ['customer', H.cpOne, cid, { invoice_id: 999999 }, 'UNKNOWN_BILL', 10, 1310],
    ['vendor', H.vpOne, vid, { purchase_id: bills.P2 }, 'OVER_BILL', 501, 1501],
    ['vendor', H.vpOne, vid, { purchase_id: bills.Q4 }, 'FOREIGN_BILL', 10, 1310],
    ['vendor', H.vpOne, vid, { purchase_id: bills.P2 }, 'OVER_ALLOCATED', 400, 1000],
    ['vendor', H.vpOne, vid, { purchase_id: 999999 }, 'UNKNOWN_BILL', 10, 1310]
  ];
  for (const [side, h, id, bill, code, amt, total] of cases) {
    const fx = FX(side === 'customer' ? 'cp-edit-unchanged' : 'vp-edit-unchanged');
    const body = remap(fx, fx.request.body);
    body.allocations = [body.allocations[0], { ...body.allocations[1], invoice_id: undefined, purchase_id: undefined, ...bill, allocated_amount: amt }];
    body.payment_amount = total;
    const before = JSON.stringify(store);
    const r = await call(h, 'PUT', { id: String(id) }, body);
    ex(`${side} ${code}`, r.status === 400 && r.body?.error_code === code && JSON.stringify(store) === before, { r: r.body, code });
  }
  for (const [side, h, id, dup] of [['customer', H.cpOne, cid, { invoice_id: bills.S1 }], ['vendor', H.vpOne, vid, { purchase_id: bills.P1 }]]) {
    const fx = FX(side === 'customer' ? 'cp-edit-unchanged' : 'vp-edit-unchanged');
    const body = remap(fx, fx.request.body);
    body.allocations = [{ ...dup, allocated_amount: 100 }, { ...dup, allocated_amount: 100 }]; body.payment_amount = 200;
    const r = await call(h, 'PUT', { id: String(id) }, body);
    ex(`${side} DUPLICATE_BILL`, r.status === 400 && r.body?.error_code === 'DUPLICATE_BILL', r.body);
    const z = await call(h, 'PUT', { id: String(id) }, { ...remap(fx, fx.request.body), payment_amount: 0 });
    ex(`${side} amount 0 refused`, z.status === 400, z.body);
    const z2 = await call(side === 'customer' ? H.cpCreate : H.vpCreate, 'POST', {}, { ...remap(fx, fx.request.body), payment_amount: 0 });
    ex(`${side} create amount 0 refused`, z2.status === 400, z2.body);
  }
  await done('R-01', ['A2']);
});

test('R-02 refund edit refusals and missing records: adding a return to an on-account refund (REFUND_VIA_RETURN), amount 0, edit / delete of an id that does not exist (404)', async () => {
  await seed();
  // a pending sale return and a pending purchase return to point at
  const sl = store.invoiceitems.find(l => l.invoice_no === bills.S1);
  await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items: [{ invoice_item_id: sl.id, invoice_type: 'invoice', return_qty: 1, return_reason_id: 1 }] });
  const pl = store.purchaseitems.find(l => l.purchase_id === bills.P1);
  await call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items: [{ purchase_item_id: pl.id, return_qty: 1, return_reason_id: 1 }] });
  const sr = store.sale_returns[0], pr = store.purchase_returns[0];
  const crid = (await send('cr-create')).body.data.refund.id;
  const vrid = (await send('vr-create')).body.data.refund.id;
  const before = JSON.stringify(store);
  const a = await send('cr-edit-unchanged', crid, b => ({ ...b, refund_type: 'RETURN_SPECIFIC', allocations: [{ return_id: sr?.id, type: 'sale', sale_return_id: sr?.id, allocated_amount: 50 }] }));
  const b = await send('vr-edit-unchanged', vrid, x => ({ ...x, refund_type: 'RETURN_SPECIFIC', allocations: [{ return_id: pr?.id, allocated_amount: 50 }] }));
  ex('customer refund edit adding a return: REFUND_VIA_RETURN', a.status === 400 && a.body.error_code === 'REFUND_VIA_RETURN', { a: a.body, sr });
  ex('vendor refund edit adding a return: REFUND_VIA_RETURN', b.status === 400 && b.body.error_code === 'REFUND_VIA_RETURN', { b: b.body, pr });
  for (const [n, id] of [['cr-edit-unchanged', crid], ['vr-edit-unchanged', vrid]]) {
    const z = await send(n, id, x => ({ ...x, refund_amount: 0 }));
    ex(`${n} amount 0 refused`, z.status === 400, z.body);
  }
  ex('nothing written by the refusals', JSON.stringify(store) === before);
  for (const [h, body] of [[H.cpOne, FX('cp-edit-unchanged').request.body], [H.vpOne, FX('vp-edit-unchanged').request.body], [H.crOne, FX('cr-edit-unchanged').request.body], [H.vrOne, FX('vr-edit-unchanged').request.body]]) {
    const p = await call(h, 'PUT', { id: '987654' }, body);
    const d = await call(h, 'DELETE', { id: '987654' });
    ex('missing id: PUT and DELETE 404', p.status === 404 && d.status === 404, { p: p.body, d: d.body });
  }
  await done('R-02', ['A2']);
});

test('R-03 cash is kept as cash (mode 0) end to end on all four creates and edits; the cash book splits cash / bank by the document\'s mode', async () => {
  await seed();
  const ids = {};
  for (const n of ['cp-create-bill', 'cr-create', 'vp-create-bill', 'vr-create']) ids[n] = (await send(n)).body.data;
  const docs = [store.customer_payments.find(x => x.id === ids['cp-create-bill'].payment.id).payment_mode, store.customer_refunds.find(x => x.id === ids['cr-create'].refund.id).refund_mode,
    store.vendor_payments.find(x => x.id === ids['vp-create-bill'].payment.id).payment_mode, store.vendor_refunds.find(x => x.id === ids['vr-create'].refund.id).refund_mode];
  ex('all four stored with mode 0', docs.every(m => m === 0), docs);
  const cb = (await call(H.cashBookR, 'GET', { ...RANGE, mode: 'cash' })).body;
  ex('cash-only cash book: in 1300 + 100, out 1300 + 100', cb.totals?.in === 1400 && cb.totals?.out === 1400, cb.totals);
  await done('R-03', ['A2']);
});

test('R-04 a refund edit cannot raise the old allocation of a legacy return-specific refund, and reducing it recalculates the return (customer; the vendor form path is in the harness, test8)', async () => {
  await seed();
  // legacy data: a customer refund of 40 put against a pending sale return (before refunds went on account)
  const sl = store.invoiceitems.find(l => l.invoice_no === bills.S2);
  await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(4), payment_status: 0, payment_mode: 1, items: [{ invoice_item_id: sl.id, invoice_type: 'invoice', return_qty: 1, return_reason_id: 1 }] });
  const sr = store.sale_returns[0];
  const rf = (await send('cr-create', null, b => ({ ...b, refund_amount: 40 }))).body.data.refund.id;
  store.customer_refunds.find(x => x.id === rf).refund_type = 'RETURN_SPECIFIC';
  store.customer_refund_allocations.push({ id: 5000, refund_id: rf, sale_return_id: sr.id, salex_return_id: null, allocated_amount: 40, allocation_date: 0, notes: null });
  sr.payment_status = 2;
  const up = await call(H.crOne, 'PUT', { id: String(rf) }, { refund_amount: 40, refund_mode: 0, refund_date: D(5), refund_type: 'RETURN_SPECIFIC', notes: '', allocations: [{ return_id: sr.id, type: 'sale', sale_return_id: sr.id, allocated_amount: 60 }] });
  ex('raising it is refused (REFUND_VIA_RETURN)', up.status === 400 && up.body.error_code === 'REFUND_VIA_RETURN', up.body);
  const down = await call(H.crOne, 'PUT', { id: String(rf) }, { refund_amount: 40, refund_mode: 0, refund_date: D(5), refund_type: 'RETURN_SPECIFIC', notes: '', allocations: [{ return_id: sr.id, type: 'sale', sale_return_id: sr.id, allocated_amount: 30 }] });
  ex('reducing it: 200, allocation 30, return still part refunded (2), counter moved by -10', down.status === 200 && store.customer_refund_allocations.find(a => a.refund_id === rf)?.allocated_amount === 30 && store.sale_returns[0].payment_status === 2, { down: down.body, ra: store.customer_refund_allocations, sr: store.sale_returns[0] });
  expect(stats.failures).toEqual([]);
});

// ===================================================================== gaps in A1-A14 for this section's tables
// Each shows a wrong state that A1-A14 pass today (test.failing: they turn red the day an
// assertion catches it). Suggested assertion in the report (G-01 .. G-04).
const auditFails = async () => (await require('../support/flowlib.js').audit.run([], { quiet: true })).filter(r => r.failures.length && r.id !== 'A2');

// G-01 (fixed by A15). The edit no longer leaves the wrong state (C-03 fixed), so after the
// real edit the audit is clean, and each wrong state the old code left is put back by hand:
// a row naming the bill the payment no longer pays (C-03), the new total on every per-bill
// row (C-01), a ₹0 row on a bill (C-06), a customer row still tagged with a bill that is not
// the payment's own (C-03 customer).
test('G-01 A1-A14 should catch a Bill Specific vendor payment whose ledger row names a bill it no longer pays (C-03 before the bill is deleted)', async () => {
  reset(); seedStock(); stats.failures = [];
  const k = K.purchase;
  const a = (await create(k, { items: [[3, 10, 100, 0]] })).id, b = (await create(k, { items: [[3, 10, 100, 0]] })).id;
  const { id } = await pay(k, 1000, [[k, a, 1000]], { mode: 1 });
  await call(H.vpOne, 'PUT', { id: String(id) }, { vendor_id: '1', notes: '', payment_amount: 1000, payment_mode: 1, payment_date: 1790965800, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: b, allocated_amount: 1000 }] });
  expect(await auditFails()).toEqual([]);
  const row = rowsOf('vendor_ledger', 'PAYMENT', id)[0];
  row.reference_id = a;                                                         // C-03: still names bill a
  expect((await auditFails()).map(r => r.id)).toContain('A15');
  row.reference_id = b;
  expect(await auditFails()).toEqual([]);
});

test('G-01 A15 catches the other per-payment states A12 let through: new total on every bill row, a ₹0 row, a customer row tagged with a bill it does not belong to', async () => {
  await seed();
  const vid = (await send('vp-create-bill')).body.data.payment.id;            // P1 1000, P2 300
  const cid = (await send('cp-create-bill')).body.data.payment.id;
  expect(await auditFails()).toEqual([]);
  const vrows = rowsOf('vendor_ledger', 'PAYMENT', vid);
  const keep = vrows.map(r => r.credit);
  vrows[0].credit = 1300; vrows[1].credit = 0;                                  // party total unchanged (A12 passes), rows wrong
  expect((await auditFails()).map(r => r.id)).toEqual(['A15']);
  vrows.forEach((r, i) => { r.credit = keep[i]; });
  const q1 = store.vendor_payments.find(p => p.vendor_id === 2);                // Q1's own payment (600.10)
  const q1row = rowsOf('vendor_ledger', 'PAYMENT', q1.id)[0];
  store.vendor_ledger.push({ ...q1row, id: 99001, reference_id: bills.Q4, reference_no: 'x', credit: 0 }); // C-06: a ₹0 row on a bill it does not pay
  expect((await auditFails()).map(r => r.id)).toEqual(['A15']);
  store.vendor_ledger.pop();
  const crow = rowsOf('customer_ledger', 'PAYMENT_RECEIVED', cid)[0];
  Object.assign(crow, { reference_type: 'sale', reference_id: bills.S1 });       // two bills: not S1's own payment
  expect((await auditFails()).map(r => r.id)).toEqual(['A15']);
});

test('G-02 A1-A14 should catch a payment / refund whose ledger row carries another mode or date than the document (C-04)', async () => {
  await seed();
  const id = (await send('cp-create-bill')).body.data.payment.id;
  store.customer_payments.find(x => x.id === id).payment_mode = 1; // the document says bank, its ledger row cash
  expect((await auditFails()).length).toBeGreaterThan(0);
});

test('G-03 A1-A14 should catch total_allocated drifting from the payments\' allocations when the drift was logged (A14 only checks the log chain)', async () => {
  await seed();
  await send('cp-create-bill');
  const c = store.customer_details.find(x => x.id === 1);
  store.customer_balance_logs.push({ id: 9999, customer_id: 1, column_name: 'total_allocated', change_amount: 100, old_value: N(c.total_allocated), new_value: N(c.total_allocated) + 100, source_type: 'payment_received_edit', source_id: 0, created_at: new Date() });
  c.total_allocated = N(c.total_allocated) + 100; c.account_balance = N(c.account_balance) - 100;
  expect((await auditFails()).length).toBeGreaterThan(0);
});

test('G-04 A10 should check customer refund allocations like the other three: same customer, refund exists, return exists', async () => {
  await seed();
  const rid = (await send('cr-create')).body.data.refund.id;
  // a refund allocation on Asha's bill's return id that does not exist, and an orphan without its refund
  store.customer_refund_allocations.push({ id: 9001, refund_id: rid, sale_return_id: 424242, salex_return_id: null, allocated_amount: 0.001, allocation_date: 0, notes: null });
  store.customer_refund_allocations.push({ id: 9002, refund_id: 515151, sale_return_id: null, salex_return_id: null, allocated_amount: 0.001, allocation_date: 0, notes: null });
  expect((await auditFails()).length).toBeGreaterThan(0);
});
