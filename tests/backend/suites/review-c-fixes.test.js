// Review C fixes (F1, 2026-10-04): plain tests for behaviour the finding tests do not cover -
// the ledger rebuild on a payment-type change, refunds' notes and "save unchanged", the
// helper F2 can call after trimAllocations, and the list filters. A1-A16 + the reports after each.
import { store } from '../support/dbstub.js';
import { prisma } from '../support/dbstub.js';
import { call, reset, checkAll, checkReports, stats, ok, N, r2, sum } from '../support/flowlib.js';
import { seedStock, K, create, pay, D, H } from '../support/scenlib.js';
import { rebuildVendorPaymentLedger, rebuildCustomerPaymentLedger } from '../../../lib/payment-ledger';

const done = async (step, known = []) => { await checkAll(step, known); await checkReports(step); expect(stats.failures).toEqual([]); };
const rowsOf = (ledger, type, txId) => store[ledger].filter(l => l.transaction_type === type && l.transaction_id === txId);
const fresh = () => { reset(); seedStock(); stats.failures = []; };

test('vendor payment: Bill Specific over two bills -> Mixed on one bill -> back: the rows follow the type (per bill / one tagged payment)', async () => {
  fresh();
  const k = K.purchase;
  const a = (await create(k, { items: [[3, 10, 100, 0]] })).id, b = (await create(k, { items: [[3, 10, 100, 0]] })).id; // 1000 each
  const { id } = await pay(k, 1500, [[k, a, 1000], [k, b, 500]]);
  let rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ok('create: two rows, 1000 on a and 500 on b', JSON.stringify(rows.map(l => [l.reference_type, l.reference_id, l.credit])) === JSON.stringify([['purchase', a, 1000], ['purchase', b, 500]]), rows);
  const base = { vendor_id: '1', notes: '', payment_amount: 1500, payment_mode: 1, payment_date: D(3) };
  const m = await call(H.vpOne, 'PUT', { id: String(id) }, { ...base, payment_type: 'MIXED', allocations: [{ purchase_id: a, allocated_amount: 600 }] });
  rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ok('Mixed: 200, one row tagged payment for 1500', m.status === 200 && rows.length === 1 && rows[0].reference_type === 'payment' && rows[0].reference_id === id && rows[0].credit === 1500, { m: m.body, rows });
  await done('to Mixed', ['A2']);
  const back = await call(H.vpOne, 'PUT', { id: String(id) }, { ...base, payment_amount: 1200, payment_type: 'BILL_SPECIFIC', allocations: [{ purchase_id: b, allocated_amount: 1000 }, { purchase_id: a, allocated_amount: 200 }] });
  rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ok('back to Bill Specific 1200: rows per bill, b 1000 (paid), a 200 (part)', back.status === 200 && rows.length === 2 &&
    rows.find(l => l.reference_id === b)?.credit === 1000 && rows.find(l => l.reference_id === b)?.payment_status === 1 &&
    rows.find(l => l.reference_id === a)?.credit === 200 && rows.find(l => l.reference_id === a)?.payment_status === 2, rows);
  await done('back to Bill Specific', ['A2']);
  const d = await call(H.purchaseOne, 'DELETE', { id: String(a) });
  ok('deleting bill a takes only its share; the payment keeps b\'s row', d.status === 200 && rowsOf('vendor_ledger', 'PAYMENT', id).every(l => l.reference_id !== a), { d: d.body, rows: rowsOf('vendor_ledger', 'PAYMENT', id) });
  await done('bill a deleted', ['A2']);
});

test('refunds (both parties): mode, date and notes edits reach the ledger row; a note typed on the ledger screen survives an amount edit; save unchanged changes nothing', async () => {
  fresh();
  for (const [side, create_, one, table, ledger, type, ledgerNote] of [
    ['customer', H.crCreate, H.crOne, 'customer_refunds', 'customer_ledger', 'REFUND_PAID', require('../../../pages/api/customer-ledger/[id]').default],
    ['vendor', H.vrCreate, H.vrOne, 'vendor_refunds', 'vendor_ledger', 'REFUND_RECEIVED', require('../../../pages/api/vendor-ledger/[id]').default]]) {
    const who = side === 'customer' ? 'customer_id' : 'vendor_id';
    const body = { [who]: '1', notes: '', allocations: [], refund_amount: 100, refund_mode: 0, refund_date: D(4), refund_type: 'DIRECT' };
    const id = (await call(create_, 'POST', {}, body)).body.data.refund.id;
    const before = JSON.stringify(store[table].find(x => x.id === id));
    const same = await call(one, 'PUT', { id: String(id) }, body);
    ok(`${side}: save unchanged 200 and no change`, same.status === 200 && JSON.stringify(store[table].find(x => x.id === id)) === before, { same: same.body, before, after: store[table].find(x => x.id === id) });
    await call(one, 'PUT', { id: String(id) }, { ...body, refund_mode: 1, refund_date: D(5), notes: 'cheque 77' });
    let row = rowsOf(ledger, type, id)[0];
    const doc = store[table].find(x => x.id === id);
    ok(`${side}: mode, date and notes on the row`, row.payment_mode === 1 && row.transaction_date === doc.refund_date && row.payment_date === doc.refund_date && row.notes === 'cheque 77', row);
    await call(ledgerNote, 'PATCH', { id: String(row.id) }, { notes: 'matched with statement' });
    await call(one, 'PUT', { id: String(id) }, { ...body, refund_amount: 120, refund_mode: 1, refund_date: D(5), notes: 'cheque 77' });
    row = rowsOf(ledger, type, id)[0];
    ok(`${side}: amount 120 on the row; the ledger-screen note kept`, N(row.debit) === 120 && row.notes === 'matched with statement', row);
  }
  await done('refund edits', ['A2']);
});

test('customer: a payment made with a paid sale keeps its row on the sale while it stays that sale\'s own payment; a mode-only edit does not re-tag it', async () => {
  fresh();
  const k = K.sale;
  const a = (await create(k, { items: [[3, 5, 100, 0]], status: 1, mode: 0 })).id;
  const pid = store.customer_payments[0].id;
  const body = { customer_id: '1', notes: '', payment_amount: 500, payment_mode: 1, payment_date: D(2), payment_type: 'BILL_SPECIFIC', allocations: [{ invoice_id: a, allocated_amount: 500 }] };
  const e = await call(H.cpOne, 'PUT', { id: String(pid) }, body);
  const row = rowsOf('customer_ledger', 'PAYMENT_RECEIVED', pid)[0];
  ok('200; still tagged with the sale; mode bank', e.status === 200 && row.reference_type === 'sale' && row.reference_id === a && row.payment_mode === 1, { e: e.body, row });
  await done('own payment kept');
  const d = await call(H.saleOne, 'DELETE', { id: String(a) });
  ok('deleting the sale takes its own payment and row', d.status === 200 && !store.customer_payments.some(p => p.id === pid) && rowsOf('customer_ledger', 'PAYMENT_RECEIVED', pid).length === 0, { d: d.body });
  await done('sale deleted');
});

test('rebuildVendorPaymentLedger (for F2 / trimAllocations): a Bill Specific payment turned MIXED gets one row tagged payment for its whole amount; a second call changes nothing', async () => {
  fresh();
  const k = K.purchase;
  const a = (await create(k, { items: [[3, 10, 100, 0]] })).id;
  const { id } = await pay(k, 1000, [[k, a, 1000]]);
  // as trimAllocations leaves it after the bill is lowered to 800: payment MIXED, allocation 800
  store.vendor_payments.find(p => p.id === id).payment_type = 'MIXED';
  store.payment_allocations.find(x => x.payment_id === id).allocated_amount = 800;
  const changed = await rebuildVendorPaymentLedger(prisma, id);
  const rows = rowsOf('vendor_ledger', 'PAYMENT', id);
  ok('one row, tagged payment, 1000', changed === true && rows.length === 1 && rows[0].reference_type === 'payment' && rows[0].reference_id === id && rows[0].credit === 1000, rows);
  const total = r2(sum(store.vendor_ledger.filter(l => l.vendor_id === 1), l => N(l.debit) - N(l.credit)));
  ok('the vendor ledger still nets the bill minus the payment (1000 - 1000)', total === 0, store.vendor_ledger);
  ok('second call: nothing to do', (await rebuildVendorPaymentLedger(prisma, id)) === false);
  ok('customer twin: no payment, nothing done', (await rebuildCustomerPaymentLedger(prisma, 987654)) === false);
  expect(stats.failures).toEqual([]);
});

test('GET /api/customer-payments and /customer-refunds: customer by name, status by type; page total follows the filter', async () => {
  fresh();
  await pay(K.sale, 100, [], { type: 'DIRECT' });
  await pay(K.sale, 50, [], { type: 'DIRECT', partyId: 2 });
  const s = (await create(K.sale, { items: [[3, 1, 100, 0]] })).id;
  await pay(K.sale, 100, [[K.sale, s, 100]]);
  const byName = await call(H.cpCreate, 'GET', { customer: 'Asha' });
  ok('by name: only Asha\'s payment, total 1', byName.status === 200 && byName.body.payments.length === 1 && byName.body.payments[0].customer_id === 2 && byName.body.pagination.total === 1, byName.body);
  const byType = await call(H.cpCreate, 'GET', { customer: '1', status: 'BILL_SPECIFIC' });
  ok('customer 1, Bill Specific: one', byType.body.payments.length === 1 && byType.body.payments[0].payment_type === 'BILL_SPECIFIC', byType.body.payments);
  await call(H.crCreate, 'POST', {}, { customer_id: 2, refund_amount: 20, refund_mode: 0, refund_date: D(4), allocations: [] });
  const r = await call(H.crCreate, 'GET', { customer: 'Ravi' });
  ok('refunds by name: Ravi has none', r.body.refunds.length === 0 && r.body.pagination.total === 0, r.body);
  const r2b = await call(H.crCreate, 'GET', { customer: '2', status: 'DIRECT' });
  ok('refunds: customer 2 DIRECT one', r2b.body.refunds.length === 1, r2b.body);
  expect(stats.failures).toEqual([]);
});
