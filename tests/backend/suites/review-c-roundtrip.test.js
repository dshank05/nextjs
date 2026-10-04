// Review C (money): CRUD round trips for payments and refunds of both parties, replaying the
// requests the real screens send. The bodies are fixtures captured by rendering the screens in
// jsdom (harness/review-c-capture.jsx -> tests/backend/fixtures/transactions/*.json).
//
// Each round trip: create -> read as the edit form reads it -> save it unchanged (nothing may
// change) -> edit amount / allocations / date / mode / notes (only those and what follows from
// them may change) -> delete (everything rolled back). After every step: A1-A14 (checkAll) and
// the 16 report checks (checkReports), plus the places each write must show up: bill statuses,
// ledger row, outstanding, party view, balance logs, cash book, the transactions list, the bill's
// payment history.
//
// What is wrong today is not asserted here; it is in review-c-findings.test.js as test.failing
// (C-01 ...), so these stay green and the findings turn red the day they are fixed.
import { store } from '../support/dbstub.js';
import { H, call, reset, checkAll, checkReports, stats, ok, out, N, r2, sum, RANGE } from '../support/flowlib.js';
import { seedStock } from '../support/scenlib.js';
import custList from '../../../pages/api/customer-transactions/index';
import vendList from '../../../pages/api/vendor-transactions/index';
import custOne from '../../../pages/api/customers/[id]';
import vendOne from '../../../pages/api/vendors/[id]';
const { normalizeDetail } = require('../../../hooks/usePartyTransactions');

const FXDIR = '../fixtures/transactions/';
const FX = (name) => JSON.parse(JSON.stringify(require(FXDIR + name + '.json')));
const INDEX = require(FXDIR + 'index.json');
const ROUTE = { sales: H.sales, salex: H.salex, purchases: H.purchases };

// ---------------------------------------------------------------- seed: the harness's bills, same order
const bills = {};
async function seed() {
  reset(); seedStock(); stats.failures = [];
  for (const s of INDEX.seed) {
    const r = await call(ROUTE[s.route], 'POST', {}, JSON.parse(JSON.stringify(s.body)));
    bills[s.name] = r.body?.purchase?.id ?? r.body?.sale?.id;
  }
  // part payments that leave paise on party 2's bills (as the harness did)
  for (const [n, amt] of [['A1', 600.1], ['A2', 600.2], ['A3', 600.3]]) await call(H.cpCreate, 'POST', {}, { customer_id: 2, payment_date: '2026-10-03', payment_mode: 1, payment_amount: amt, allocations: [{ invoice_id: bills[n], allocated_amount: amt }] });
  for (const [n, amt] of [['Q1', 600.1], ['Q2', 600.2], ['Q3', 600.3]]) await call(H.vpCreate, 'POST', {}, { vendor_id: 2, payment_date: '2026-10-03', payment_mode: 1, payment_amount: amt, allocations: [{ purchase_id: bills[n], allocated_amount: amt }] });
}
// Captured bill ids -> this run's ids (sale, Invoice C and purchase ids overlap, so by field).
const KIND_OF = (name) => (/^X/.test(name) ? 'invoicex_id' : /^[PQ]/.test(name) ? 'purchase_id' : 'invoice_id');
function remap(fx, body) {
  const b = JSON.parse(JSON.stringify(body));
  for (const a of b.allocations || []) for (const f of ['invoice_id', 'invoicex_id', 'purchase_id']) {
    if (a[f] === undefined || a[f] === null) continue;
    const name = Object.keys(fx.bills).find(n => KIND_OF(n) === f && fx.bills[n] === a[f]);
    if (!name) throw new Error(`fixture ${fx.name}: no bill named for ${f}=${a[f]}`);
    a[f] = bills[name];
  }
  return b;
}
const HANDLER = { 'customer-payments': [H.cpCreate, H.cpOne], 'customer-refunds': [H.crCreate, H.crOne], 'vendor-payments': [H.vpCreate, H.vpOne], 'vendor-refunds': [H.vrCreate, H.vrOne] };
/** Send a captured request (its method, route and body) - to `id` when the url names one. */
async function send(name, id, bodyEdit) {
  const fx = FX(name);
  const [, route, hasId] = fx.request.url.match(/^\/api\/([a-z-]+)(\/\d+)?/);
  const h = HANDLER[route][hasId ? 1 : 0];
  let body = fx.request.body ? remap(fx, fx.request.body) : undefined;
  if (bodyEdit) body = bodyEdit(body);
  return { fx, body, r: await call(h, fx.request.method, hasId ? { id: String(id) } : {}, body) };
}

// ---------------------------------------------------------------- reading
const T = {
  customer: { pay: 'customer_payments', alloc: 'customer_payment_allocations', ref: 'customer_refunds', refAlloc: 'customer_refund_allocations', ledger: 'customer_ledger', master: 'customer_details', logs: 'customer_balance_logs', who: 'customer_id', payRow: 'PAYMENT_RECEIVED', refRow: 'REFUND_PAID', list: custList, one: custOne, partyOut: H.custOut, outKey: 'outstandingCustomers' },
  vendor: { pay: 'vendor_payments', alloc: 'payment_allocations', ref: 'vendor_refunds', refAlloc: 'refund_allocations', ledger: 'vendor_ledger', master: 'vendor_details', logs: 'vendor_balance_logs', who: 'vendor_id', payRow: 'PAYMENT', refRow: 'REFUND_RECEIVED', list: vendList, one: vendOne, partyOut: H.vendOut, outKey: 'outstandingVendors' }
};
const strip = (rows, drop = ['id', 'created_at', 'updated_at']) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
/** Everything a payment or refund may touch, for one party (allocation row ids left out: an edit replaces the rows). */
function snap(party) {
  const t = T[party];
  const pick = (name) => JSON.parse(JSON.stringify(store[name] || []));
  return {
    payments: pick(t.pay), allocations: strip(pick(t.alloc)), refunds: pick(t.ref), refundAllocations: strip(pick(t.refAlloc)),
    ledger: pick(t.ledger), party: pick(t.master), logs: pick(t.logs).length,
    bills: party === 'customer' ? [...pick('invoice').map(b => ['S', b.id, b.payment_status]), ...pick('invoicex').map(b => ['X', b.id, b.payment_status])] : pick('purchase').map(b => ['P', b.id, b.payment_status])
  };
}
function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    return keys.flatMap(k => diff(a[k], b[k], `${path}.${k}`));
  }
  return [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
}
const counters = (party, id = 1) => { const p = store[T[party].master].find(x => x.id === id); return { paid: N(p.total_paid), alloc: N(p.total_allocated), refunded: N(p.total_refunded), refAlloc: N(p.total_refund_allocated) }; };
const ledgerBal = (party, id = 1) => r2(sum(store[T[party].ledger].filter(l => l[T[party].who] === id), l => N(l.debit) - N(l.credit)));
const rowsOf = (party, txType, txId) => store[T[party].ledger].filter(l => l.transaction_type === txType && l.transaction_id === txId);
async function outstandingOf(party, id = 1) {
  const o = await call(T[party].partyOut, 'GET', { page: '1', limit: '500' });
  return N((o.body?.[T[party].outKey] || []).find(x => x[T[party].who] === id)?.balance);
}
async function partyView(party, id = 1) { return N((await call(T[party].one, 'GET', { id: String(id) })).body?.[party]?.outstanding ?? (await call(T[party].one, 'GET', { id: String(id) })).body?.outstanding); }
async function listRows(party, id = 1) { return (await call(T[party].list, 'GET', { [T[party].who]: String(id), page: '1', limit: '200', dateFrom: '2026-10-01', dateTo: '2026-10-31' })).body; }
async function cashRow(kind, id) { return ((await call(H.cashBookR, 'GET', RANGE)).body?.rows || []).find(r => r.kind === kind && r.id === id); }
async function ledgerReportRow(party, txType, txId) {
  const L = await call(party === 'customer' ? H.custLedger : H.vendLedger, 'GET', { [T[party].who]: '1', page: '1', limit: '500' });
  return (L.body?.entries || []).filter(e => e.transactionType === txType && e.transaction_id === txId);
}
const ex = (step, what, cond, info) => ok(`${step} ${what}`, cond, info);
async function after(step, known = []) { await checkAll(step, known); await checkReports(step); }
const DAY5 = 1791138600, DAY6 = 1791225000, DAY7 = 1791311400; // 2026-10-05 / 06 / 07, IST midnight, as the form sends them

// ================================================================= customer payment, bill specific
test('RT-CP customer payment (Bill Specific, Auto Allocate over two bills, cash): create, read, save unchanged, edit, delete', async () => {
  await seed();
  const p = 'customer';
  const before = snap(p); const out0 = await outstandingOf(p); const view0 = await partyView(p);
  ex('create', 'starting point: Ravi owes 1800 (S1 1000 + S2 500 + Invoice C 300)', ledgerBal(p) === 1800 && out0 === 1800, { bal: ledgerBal(p), out0 });

  // ---- create
  const { r } = await send('cp-create-bill');
  const id = r.body?.data?.payment?.id;
  const pay = store.customer_payments.find(x => x.id === id);
  ex('create', '201, payment 1300 cash Bill Specific, notes and date kept, fy 4', r.status === 201 && N(pay?.payment_amount) === 1300 && pay.payment_mode === 0 && pay.payment_type === 'BILL_SPECIFIC' && pay.notes === 'cash receipt' && pay.payment_date === DAY5 && pay.fy === 4, { r: r.body, pay });
  const al = store.customer_payment_allocations.filter(a => a.payment_id === id);
  ex('create', 'allocations S1 1000, S2 300 (sale ids, not Invoice C), dated with the payment', al.length === 2 && al.find(a => a.invoice_id === bills.S1)?.allocated_amount === 1000 && al.find(a => a.invoice_id === bills.S2)?.allocated_amount === 300 && al.every(a => !a.invoicex_id && a.allocation_date === DAY5), al);
  ex('create', 'bill statuses: S1 paid, S2 part paid, Invoice C untouched', store.invoice.find(b => b.id === bills.S1).payment_status === 1 && store.invoice.find(b => b.id === bills.S2).payment_status === 2 && store.invoicex.find(b => b.id === bills.X1).payment_status === 0);
  const lr = rowsOf(p, 'PAYMENT_RECEIVED', id);
  ex('create', 'ledger: one PAYMENT_RECEIVED row tagged with the payment, credit 1300, cash, dated, notes', lr.length === 1 && lr[0].reference_type === 'payment' && lr[0].reference_id === id && N(lr[0].credit) === 1300 && N(lr[0].debit) === 0 && lr[0].payment_mode === 0 && lr[0].transaction_date === DAY5 && lr[0].notes === 'cash receipt', lr);
  ex('create', 'counters paid 1300 / allocated 1300, two balance-log rows', JSON.stringify(counters(p)) === JSON.stringify({ paid: 1300, alloc: 1300, refunded: 0, refAlloc: 0 }) && store.customer_balance_logs.filter(l => l.source_id === id && l.source_type === 'payment_received_create').length === 2, { c: counters(p), logs: store.customer_balance_logs });
  ex('create', 'outstanding and party view: 500', (await outstandingOf(p)) === 500 && (await partyView(p)) === 500 && ledgerBal(p) === 500, { out: await outstandingOf(p), view: await partyView(p) });
  const cb = await cashRow('customer_payment', id);
  ex('create', 'cash book: 1300 in, Cash, 5 Oct', cb && cb.money_in === 1300 && cb.mode === 'Cash' && cb.date === DAY5, cb);
  let L = await listRows(p);
  const row = (L.data || []).find(x => x.id === id && x.transaction_type === 'INCOME');
  ex('create', 'transactions list: INCOME 1300, cash, Bill Specific, INV-1 / INV-2', row && row.amount === 1300 && row.payment_mode === 0 && row.payment_type === 'BILL_SPECIFIC' && JSON.stringify(row.invoice_numbers) === '["INV-1","INV-2"]', row);
  const hist = (await call(H.saleOne, 'GET', { id: String(bills.S2) })).body;
  const h2 = JSON.stringify(hist).includes('"payment_mode_text":"Cash"') && JSON.stringify(hist).includes('"allocated_amount":300');
  ex('create', 'S2 payment history shows the 300 in cash', h2, JSON.stringify(hist).slice(0, 400));
  await after('RT-CP create');

  // ---- read as the edit form reads it
  const g = await call(H.cpOne, 'GET', { id: String(id) });
  const d = normalizeDetail('customer', true, g.body.data);
  const fd = FX('cp-edit-unchanged').form_detail;
  ex('read', 'the edit form reads amount, date, mode, type, notes and both allocations as captured from the screen', d.amount === 1300 && d.date === DAY5 && d.mode === 0 && d.type === 'BILL_SPECIFIC' && d.notes === 'cash receipt'
    && JSON.stringify(d.allocations.map(a => [a.kind, a.allocated, a.total])) === JSON.stringify(fd.allocations.map(a => [a.kind, a.allocated, a.total])) && d.partyRef.id === 1, { d, fd });

  // ---- save unchanged
  const s1 = snap(p);
  const u = await send('cp-edit-unchanged', id);
  const s2 = snap(p);
  ex('unchanged', 'PUT 200 and nothing changed (payment, allocations, bills, ledger, counters, logs)', u.r.status === 200 && diff(s1, s2).length === 0, diff(s1, s2));
  await after('RT-CP unchanged');

  // ---- edit: amount 1300 -> 1200, S2 300 -> 200, date 5 -> 6 Oct, cash -> bank, notes
  const e = await send('cp-edit-changed', id);
  const s3 = snap(p);
  const pay2 = store.customer_payments.find(x => x.id === id);
  ex('edit', 'PUT 200; payment 1200, bank, 6 Oct, notes, still Bill Specific', e.r.status === 200 && N(pay2.payment_amount) === 1200 && pay2.payment_mode === 1 && pay2.payment_date === DAY6 && pay2.notes === 'edited' && pay2.payment_type === 'BILL_SPECIFIC', pay2);
  ex('edit', 'allocations S1 1000, S2 200 (dated 6 Oct); S2 still part paid', JSON.stringify(s3.allocations.filter(a => a.payment_id === id).map(a => [a.invoice_id, a.allocated_amount, a.allocation_date])) === JSON.stringify([[bills.S1, 1000, DAY6], [bills.S2, 200, DAY6]]) && store.invoice.find(b => b.id === bills.S2).payment_status === 2, s3.allocations);
  const lr2 = rowsOf(p, 'PAYMENT_RECEIVED', id);
  ex('edit', 'ledger row updated in place: credit 1200, dated 6 Oct (one row, same id)', lr2.length === 1 && lr2[0].id === lr[0].id && N(lr2[0].credit) === 1200 && lr2[0].transaction_date === DAY6, lr2);
  ex('edit', 'counters 1200 / 1200; two payment_received_edit log rows of -100', counters(p).paid === 1200 && counters(p).alloc === 1200 && store.customer_balance_logs.filter(l => l.source_type === 'payment_received_edit' && l.source_id === id && N(l.change_amount) === -100).length === 2, { c: counters(p), logs: store.customer_balance_logs.filter(l => l.source_id === id) });
  ex('edit', 'outstanding and party view 600', (await outstandingOf(p)) === 600 && (await partyView(p)) === 600);
  const cb2 = await cashRow('customer_payment', id);
  ex('edit', 'cash book: 1200 in, Bank, 6 Oct', cb2 && cb2.money_in === 1200 && cb2.mode === 'Bank' && cb2.date === DAY6, cb2);
  L = await listRows(p);
  const row2 = (L.data || []).find(x => x.id === id && x.transaction_type === 'INCOME');
  ex('edit', 'transactions list: 1200, bank', row2 && row2.amount === 1200 && row2.payment_mode === 1 && row2.date === DAY6, row2);
  const unchangedElsewhere = diff({ ...s1, payments: s1.payments.filter(x => x.id !== id), allocations: s1.allocations.filter(a => a.payment_id !== id), ledger: s1.ledger.filter(l => l.transaction_id !== id), party: 0, logs: 0, bills: 0 },
    { ...s3, payments: s3.payments.filter(x => x.id !== id), allocations: s3.allocations.filter(a => a.payment_id !== id), ledger: s3.ledger.filter(l => l.transaction_id !== id).map(l => ({ ...l, balance: s1.ledger.find(o => o.id === l.id)?.balance })), party: 0, logs: 0, bills: 0 });
  ex('edit', 'nothing else moved (other payments, other ledger rows apart from running balance, refunds)', unchangedElsewhere.length === 0, unchangedElsewhere);
  await after('RT-CP edit');

  // ---- delete (the request the list sends: DELETE, no body)
  const del = await send('cp-delete', id);
  const s4 = snap(p);
  ex('delete', 'DELETE 200; payment, allocations, ledger row gone; bills, counters, outstanding back', del.r.status === 200 && !store.customer_payments.some(x => x.id === id) && !s4.allocations.some(a => a.payment_id === id) && rowsOf(p, 'PAYMENT_RECEIVED', id).length === 0
    && JSON.stringify(s4.bills) === JSON.stringify(before.bills) && JSON.stringify(counters(p)) === JSON.stringify({ paid: 0, alloc: 0, refunded: 0, refAlloc: 0 }) && (await outstandingOf(p)) === 1800 && (await partyView(p)) === view0, { d: del.r.body, c: counters(p), bills: s4.bills });
  const back = diff({ ...before, logs: 0 }, { ...s4, logs: 0 });
  ex('delete', 'every table as before the create (balance logs keep their history)', back.length === 0, back);
  ex('delete', 'cash book and list no longer show it', !(await cashRow('customer_payment', id)) && !((await listRows(p)).data || []).some(x => x.id === id && x.transaction_type === 'INCOME'));
  await after('RT-CP delete');
  expect(stats.failures).toEqual([]);
});

// ================================================================= customer payment, mixed and on account
test('RT-CP2 customer payment Mixed (Invoice C) and On Account: create, save unchanged, delete', async () => {
  await seed();
  const p = 'customer';
  const before = snap(p);
  const m = await send('cp-create-mixed');
  const mid = m.r.body?.data?.payment?.id;
  const mp = store.customer_payments.find(x => x.id === mid);
  ex('mixed', '201, MIXED 500, 200 on the Invoice C bill (invoicex_id), Invoice C part paid', m.r.status === 201 && mp.payment_type === 'MIXED' && N(mp.payment_amount) === 500 && store.customer_payment_allocations.some(a => a.payment_id === mid && a.invoicex_id === bills.X1 && !a.invoice_id && a.allocated_amount === 200) && store.invoicex.find(b => b.id === bills.X1).payment_status === 2, { m: m.r.body, mp });
  ex('mixed', 'ledger: one row credit 500; counters paid 500 allocated 200', rowsOf(p, 'PAYMENT_RECEIVED', mid).length === 1 && N(rowsOf(p, 'PAYMENT_RECEIVED', mid)[0].credit) === 500 && counters(p).paid === 500 && counters(p).alloc === 200, counters(p));
  await after('RT-CP2 mixed');
  const dct = await send('cp-create-direct');
  const did = dct.r.body?.data?.payment?.id;
  ex('direct', '201, DIRECT 250, nothing allocated, counters paid 750 allocated 200; outstanding 1050', dct.r.status === 201 && store.customer_payments.find(x => x.id === did).payment_type === 'DIRECT' && !store.customer_payment_allocations.some(a => a.payment_id === did) && counters(p).paid === 750 && counters(p).alloc === 200 && (await outstandingOf(p)) === 1050, counters(p));
  await after('RT-CP2 direct');
  // Save unchanged, with the body the form sends for these (same shape as its POST - see cp-edit-unchanged)
  const s1 = snap(p);
  const mixedPut = await call(H.cpOne, 'PUT', { id: String(mid) }, remap(FX('cp-create-mixed'), FX('cp-create-mixed').request.body));
  const s2 = snap(p);
  const d1 = diff(s1, s2).filter(x => !/^\.logs/.test(x));
  // notes '' -> null is C-09 (findings); everything else must stay
  ex('unchanged', 'Mixed: PUT 200, nothing changed but notes "" -> null (C-09)', mixedPut.status === 200 && d1.every(x => /notes: "" -> null/.test(x)), d1);
  await after('RT-CP2 unchanged');
  for (const id of [mid, did]) await call(H.cpOne, 'DELETE', { id: String(id) });
  const back = diff({ ...before, logs: 0 }, { ...snap(p), logs: 0 });
  ex('delete', 'both deleted: every table as before', back.length === 0, back);
  await after('RT-CP2 delete');
  expect(stats.failures).toEqual([]);
});

// ================================================================= customer refund (on account)
test('RT-CR customer refund on account (cash): create, read, save unchanged, edit, delete', async () => {
  await seed();
  const p = 'customer';
  const before = snap(p);
  const { r } = await send('cr-create');
  const id = r.body?.data?.refund?.id;
  const f = store.customer_refunds.find(x => x.id === id);
  ex('create', '201, DIRECT 100 cash, notes, 5 Oct', r.status === 201 && f.refund_type === 'DIRECT' && N(f.refund_amount) === 100 && f.refund_mode === 0 && f.notes === 'refund cash' && f.refund_date === DAY5, f);
  const lr = rowsOf(p, 'REFUND_PAID', id);
  ex('create', 'ledger: one REFUND_PAID row tagged refund, debit 100, cash; counters refunded 100; outstanding 1900', lr.length === 1 && lr[0].reference_type === 'refund' && N(lr[0].debit) === 100 && lr[0].payment_mode === 0 && counters(p).refunded === 100 && counters(p).refAlloc === 0 && (await outstandingOf(p)) === 1900, { lr, c: counters(p) });
  const cb = await cashRow('customer_refund', id);
  ex('create', 'cash book: 100 out, Cash', cb && cb.money_out === 100 && cb.mode === 'Cash', cb);
  const row = ((await listRows(p)).data || []).find(x => x.id === id && x.transaction_type === 'EXPENSE');
  ex('create', 'transactions list: EXPENSE 100 cash DIRECT', row && row.amount === 100 && row.payment_mode === 0 && row.payment_type === 'DIRECT', row);
  await after('RT-CR create');
  const g = await call(H.crOne, 'GET', { id: String(id) });
  const d = normalizeDetail('customer', false, g.body.data);
  ex('read', 'edit form reads 100, cash, 5 Oct, DIRECT, notes, no allocations', d.amount === 100 && d.mode === 0 && d.date === DAY5 && d.type === 'DIRECT' && d.notes === 'refund cash' && d.allocations.length === 0, d);
  const s1 = snap(p);
  const u = await send('cr-edit-unchanged', id);
  ex('unchanged', 'PUT 200 and nothing changed', u.r.status === 200 && diff(s1, snap(p)).length === 0, diff(s1, snap(p)));
  await after('RT-CR unchanged');
  const e = await send('cr-edit-changed', id);
  const f2 = store.customer_refunds.find(x => x.id === id);
  const lr2 = rowsOf(p, 'REFUND_PAID', id);
  ex('edit', 'PUT 200; refund 80, bank, 7 Oct; ledger debit 80 dated 7 Oct in place; counters refunded 80 (one refund_issued_edit log -20); outstanding 1880', e.r.status === 200 && N(f2.refund_amount) === 80 && f2.refund_mode === 1 && f2.refund_date === DAY7
    && lr2.length === 1 && lr2[0].id === lr[0].id && N(lr2[0].debit) === 80 && lr2[0].transaction_date === DAY7 && counters(p).refunded === 80
    && store.customer_balance_logs.filter(l => l.source_type === 'refund_issued_edit' && N(l.change_amount) === -20).length === 1 && (await outstandingOf(p)) === 1880, { f2, lr2, c: counters(p) });
  const cb2 = await cashRow('customer_refund', id);
  ex('edit', 'cash book: 80 out, Bank, 7 Oct', cb2 && cb2.money_out === 80 && cb2.mode === 'Bank' && cb2.date === DAY7, cb2);
  await after('RT-CR edit');
  const del = await send('cr-delete', id);
  const back = diff({ ...before, logs: 0 }, { ...snap(p), logs: 0 });
  ex('delete', 'DELETE 200; every table as before', del.r.status === 200 && back.length === 0, back);
  await after('RT-CR delete');
  expect(stats.failures).toEqual([]);
});

// ================================================================= vendor payment, bill specific (two bills)
test('RT-VP vendor payment (Bill Specific over two bills, cash): create, read, save unchanged, delete', async () => {
  await seed();
  const p = 'vendor';
  const before = snap(p);
  ex('create', 'starting point: we owe Bosch 1500', ledgerBal(p) === 1500);
  const { r } = await send('vp-create-bill');
  const id = r.body?.data?.payment?.id;
  const pay = store.vendor_payments.find(x => x.id === id);
  ex('create', '201, 1300 cash Bill Specific, notes, 5 Oct, fy 4', r.status === 201 && N(pay.payment_amount) === 1300 && pay.payment_mode === 0 && pay.payment_type === 'BILL_SPECIFIC' && pay.notes === 'cash receipt' && pay.payment_date === DAY5 && pay.fy === 4, { r: r.body, pay });
  ex('create', 'bills: P1 paid, P2 part paid', store.purchase.find(b => b.id === bills.P1).payment_status === 1 && store.purchase.find(b => b.id === bills.P2).payment_status === 2);
  const lr = rowsOf(p, 'PAYMENT', id);
  ex('create', 'ledger: one PAYMENT row per bill (owner rule), credits 1000 + 300, cash, 5 Oct, tagged with the payment', lr.length === 2 && JSON.stringify(lr.map(l => [l.reference_type, l.reference_id, N(l.credit), l.payment_mode, l.transaction_date])) === JSON.stringify([['purchase', bills.P1, 1000, 0, DAY5], ['purchase', bills.P2, 300, 0, DAY5]]), lr);
  ex('create', 'counters 1300 / 1300; outstanding and party view 200', counters(p).paid === 1300 && counters(p).alloc === 1300 && (await outstandingOf(p)) === 200 && (await partyView(p)) === 200, counters(p));
  const cb = await cashRow('vendor_payment', id);
  ex('create', 'cash book: 1300 out, Cash', cb && cb.money_out === 1300 && cb.mode === 'Cash', cb);
  const row = ((await listRows(p)).data || []).find(x => x.id === id && x.transaction_type === 'EXPENSE');
  ex('create', 'transactions list: EXPENSE 1300 cash', row && row.amount === 1300 && row.payment_mode === 0 && JSON.stringify(row.invoice_numbers) === '["INV-1","INV-2"]', row);
  const rep = await ledgerReportRow(p, 'PAYMENT', id);
  ex('create', 'vendor ledger report: two rows for the payment, 1000 + 300', rep.length === 2 && sum(rep, x => x.credit) === 1300, rep);
  await after('RT-VP create', ['A2']);
  const g = await call(H.vpOne, 'GET', { id: String(id) });
  const d = normalizeDetail('vendor', true, g.body.data);
  const fd = FX('vp-edit-unchanged').form_detail;
  ex('read', 'edit form reads what the screen read', d.amount === 1300 && d.mode === 0 && d.date === DAY5 && d.type === 'BILL_SPECIFIC' && d.notes === 'cash receipt' && JSON.stringify(d.allocations.map(a => [a.kind, a.allocated])) === JSON.stringify(fd.allocations.map(a => [a.kind, a.allocated])), { d, fd });
  const s1 = snap(p);
  const u = await send('vp-edit-unchanged', id);
  ex('unchanged', 'PUT 200 and nothing changed', u.r.status === 200 && diff(s1, snap(p)).length === 0, diff(s1, snap(p)));
  await after('RT-VP unchanged', ['A2']);
  // (the captured edit of this payment - amount 1300 -> 1200 - is C-01: review-c-findings)
  const del = await send('vp-delete', id);
  const back = diff({ ...before, logs: 0 }, { ...snap(p), logs: 0 });
  ex('delete', 'DELETE 200; both ledger rows, allocations, statuses, counters rolled back', del.r.status === 200 && back.length === 0 && rowsOf(p, 'PAYMENT', id).length === 0, back);
  await after('RT-VP delete', ['A2']);
  expect(stats.failures).toEqual([]);
});

// ================================================================= vendor payment, mixed: amount edit (one ledger row)
test('RT-VP2 vendor payment Mixed and On Account: create, save unchanged, edit amount / date / mode, delete', async () => {
  await seed();
  const p = 'vendor';
  const before = snap(p);
  const m = await send('vp-create-mixed');
  const id = m.r.body?.data?.payment?.id;
  const lr = rowsOf(p, 'PAYMENT', id);
  ex('mixed', '201, MIXED 500 with 200 on P2; ONE ledger row tagged payment, credit 500 (owner rule)', m.r.status === 201 && store.vendor_payments.find(x => x.id === id).payment_type === 'MIXED' && lr.length === 1 && lr[0].reference_type === 'payment' && N(lr[0].credit) === 500, lr);
  ex('mixed', 'P2 part paid; counters 500 / 200', store.purchase.find(b => b.id === bills.P2).payment_status === 2 && counters(p).paid === 500 && counters(p).alloc === 200);
  await after('RT-VP2 mixed', ['A2']);
  const dct = await send('vp-create-direct');
  const did = dct.r.body?.data?.payment?.id;
  ex('direct', '201, DIRECT 250, one row tagged payment', dct.r.status === 201 && rowsOf(p, 'PAYMENT', did).length === 1 && rowsOf(p, 'PAYMENT', did)[0].reference_type === 'payment');
  await after('RT-VP2 direct', ['A2']);
  // edit the mixed payment as the form would send it: amount 500 -> 600, date 6 Oct, bank (allocation unchanged)
  const body = { ...remap(FX('vp-create-mixed'), FX('vp-create-mixed').request.body), payment_amount: 600, payment_date: DAY6 };
  const e = await call(H.vpOne, 'PUT', { id: String(id) }, body);
  const lr2 = rowsOf(p, 'PAYMENT', id);
  ex('edit', 'PUT 200; payment 600; ledger row credit 600 dated 6 Oct in place; counters paid 850 allocated 200', e.status === 200 && N(store.vendor_payments.find(x => x.id === id).payment_amount) === 600 && lr2.length === 1 && lr2[0].id === lr[0].id && N(lr2[0].credit) === 600 && lr2[0].transaction_date === DAY6 && counters(p).paid === 850 && counters(p).alloc === 200, { lr2, c: counters(p) });
  ex('edit', 'outstanding 650 (1500 - 600 - 250)', (await outstandingOf(p)) === 650);
  await after('RT-VP2 edit', ['A2']); // F-02: the date moved, stored balance runs in entry order
  for (const x of [id, did]) await call(H.vpOne, 'DELETE', { id: String(x) });
  const back = diff({ ...before, logs: 0 }, { ...snap(p), logs: 0 });
  ex('delete', 'both deleted: every table as before', back.length === 0, back);
  await after('RT-VP2 delete', ['A2']);
  expect(stats.failures).toEqual([]);
});

// ================================================================= vendor refund (on account)
test('RT-VR vendor refund on account (cash): create, read, save unchanged, edit, delete', async () => {
  await seed();
  const p = 'vendor';
  const before = snap(p);
  const { r } = await send('vr-create');
  const id = r.body?.data?.refund?.id;
  const f = store.vendor_refunds.find(x => x.id === id);
  ex('create', '201, DIRECT 100 cash, notes, 5 Oct', r.status === 201 && f.refund_type === 'DIRECT' && N(f.refund_amount) === 100 && f.refund_mode === 0 && f.notes === 'refund cash' && f.refund_date === DAY5, f);
  const lr = rowsOf(p, 'REFUND_RECEIVED', id);
  ex('create', 'ledger: one REFUND_RECEIVED row tagged payment, debit 100, cash; counters refunded 100; we owe 1600', lr.length === 1 && lr[0].reference_type === 'payment' && N(lr[0].debit) === 100 && lr[0].payment_mode === 0 && counters(p).refunded === 100 && (await outstandingOf(p)) === 1600, { lr, c: counters(p) });
  const cb = await cashRow('vendor_refund', id);
  ex('create', 'cash book: 100 in, Cash', cb && cb.money_in === 100 && cb.mode === 'Cash', cb);
  await after('RT-VR create', ['A2']);
  const g = await call(H.vrOne, 'GET', { id: String(id) });
  const d = normalizeDetail('vendor', false, g.body.data);
  ex('read', 'edit form reads 100, cash, 5 Oct, DIRECT, notes', d.amount === 100 && d.mode === 0 && d.date === DAY5 && d.type === 'DIRECT' && d.notes === 'refund cash', d);
  const s1 = snap(p);
  const u = await send('vr-edit-unchanged', id);
  ex('unchanged', 'PUT 200 and nothing changed', u.r.status === 200 && diff(s1, snap(p)).length === 0, diff(s1, snap(p)));
  await after('RT-VR unchanged', ['A2']);
  const e = await send('vr-edit-changed', id);
  const f2 = store.vendor_refunds.find(x => x.id === id);
  const lr2 = rowsOf(p, 'REFUND_RECEIVED', id);
  ex('edit', 'PUT 200; refund 80 bank 7 Oct; ledger debit 80 dated 7 Oct in place; refunded 80; we owe 1580', e.r.status === 200 && N(f2.refund_amount) === 80 && f2.refund_mode === 1 && f2.refund_date === DAY7 && lr2.length === 1 && lr2[0].id === lr[0].id && N(lr2[0].debit) === 80 && lr2[0].transaction_date === DAY7 && counters(p).refunded === 80 && (await outstandingOf(p)) === 1580, { f2, lr2, c: counters(p) });
  const cb2 = await cashRow('vendor_refund', id);
  ex('edit', 'cash book: 80 in, Bank', cb2 && cb2.money_in === 80 && cb2.mode === 'Bank', cb2);
  await after('RT-VR edit', ['A2']);
  const del = await send('vr-delete', id);
  const back = diff({ ...before, logs: 0 }, { ...snap(p), logs: 0 });
  ex('delete', 'DELETE 200; every table as before', del.r.status === 200 && back.length === 0, back);
  await after('RT-VR delete', ['A2']);
  expect(stats.failures).toEqual([]);
});

// ================================================================= list filters and paging (the list screen's own queries)
test('RT-LIST transactions list: the captured query, mode filter, type / direction filters, paging and totals', async () => {
  await seed();
  for (const n of ['cp-create-bill', 'cp-create-mixed', 'cr-create', 'vp-create-bill', 'vr-create']) await send(n);
  for (const [party, qn, h] of [['customer', 'customer-list-query', custList], ['vendor', 'vendor-list-query', vendList]]) {
    const fx = FX(qn);
    const all = await call(h, 'GET', { ...fx.request.url && Object.fromEntries(new URL('http://x' + fx.request.url).searchParams) });
    const cash = await call(h, 'GET', { ...Object.fromEntries(new URL('http://x' + FX(`${party}-list-query-cash`).request.url).searchParams) });
    const exp = party === 'customer' ? { n: 3, income: 1800, expense: 100 } : { n: 2, income: 100, expense: 1300 };
    ex(party, `captured query: ${exp.n} rows, income ${exp.income}, expense ${exp.expense}`, all.status === 200 && all.body.pagination.total === exp.n && all.body.totals.income === exp.income && all.body.totals.expense === exp.expense, all.body.totals);
    ex(party, 'mode filter Cash (payment_mode=0): only cash rows, refunds included', cash.status === 200 && cash.body.data.length > 0 && cash.body.data.every(x => x.payment_mode === 0), cash.body.data);
    const page2 = await call(h, 'GET', { [party + '_id']: '1', page: '2', limit: '1', sortBy: 'amount', sortOrder: 'desc' });
    ex(party, 'paging: page 2 of limit 1 is the second largest; totals cover every page', page2.body.data.length === 1 && page2.body.pagination.totalPages === exp.n && page2.body.totals.count === exp.n, page2.body);
    const typed = await call(h, 'GET', { [party + '_id']: '1', payment_type: 'DIRECT' });
    ex(party, 'payment type DIRECT: the refund (and no bill-specific payment)', typed.body.data.every(x => x.payment_type === 'DIRECT') && typed.body.data.some(x => x.transaction_type === (party === 'customer' ? 'EXPENSE' : 'INCOME')), typed.body.data);
    const dir = await call(h, 'GET', { [party + '_id']: '1', type: party === 'customer' ? 'income' : 'expense' });
    ex(party, 'direction filter: payments only', dir.body.data.length > 0 && dir.body.data.every(x => x.transaction_type === (party === 'customer' ? 'INCOME' : 'EXPENSE')), dir.body.data);
    const none = await call(h, 'GET', { [party + '_id']: '1', dateFrom: '2026-10-06', dateTo: '2026-10-31' });
    ex(party, 'date range after the payments: empty', none.body.data.length === 0 && none.body.totals.count === 0, none.body);
  }
  await after('RT-LIST', ['A2']);
  expect(stats.failures).toEqual([]);
});

// ================================================================= ledger note edit (PATCH from the ledger screen)
test('RT-NOTE ledger note edit from the ledger screen: only the note changes', async () => {
  await seed();
  const { r } = await send('cp-create-direct');
  const pid = r.body.data.payment.id;
  for (const [party, fxn, h, rowFind] of [['customer', 'customer-ledger-note', require('../../../pages/api/customer-ledger/[id]').default, () => rowsOf('customer', 'PAYMENT_RECEIVED', pid)[0]],
    ['vendor', 'vendor-ledger-note', require('../../../pages/api/vendor-ledger/[id]').default, null]]) {
    let row = rowFind ? rowFind() : null;
    if (!row) { const v = await send('vp-create-direct'); row = rowsOf('vendor', 'PAYMENT', v.r.body.data.payment.id)[0]; }
    const s1 = JSON.parse(JSON.stringify(store[T[party].ledger]));
    const fx = FX(fxn);
    const res = await call(h, 'PATCH', { id: String(row.id) }, fx.request.body);
    const s2 = store[T[party].ledger];
    const d = diff(s1, s2);
    ex(party, 'PATCH 200; the row\'s notes changed and nothing else', res.status === 200 && d.length === 1 && /notes/.test(d[0]) && s2.find(l => l.id === row.id).notes === 'checked with bank statement', { res: res.body, d });
    const L = await call(party === 'customer' ? H.custLedger : H.vendLedger, 'GET', { [T[party].who]: '1' });
    ex(party, 'ledger report shows the new note', (L.body.entries || []).some(e => e.id === row.id && e.remarks === 'checked with bank statement'), L.body.entries);
    const bad = await call(h, 'PATCH', { id: String(row.id) }, {});
    ex(party, 'a PATCH without notes is refused (400)', bad.status === 400, bad);
  }
  await after('RT-NOTE', ['A2']);
  expect(stats.failures).toEqual([]);
});
