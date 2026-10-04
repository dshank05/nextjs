// Review B - Sales and Invoice C: findings (docs/review/sales.md section 3).
//
// A finding whose behaviour is wrong today is a `test.failing` named with its id: the suite stays
// green while the finding is open and turns RED the day the behaviour changes - then make it a
// plain test. A question for the owner (behaviour that may be intended) is a plain test that
// pins today's behaviour, named "[QUESTION B-nn]".
//
// Payloads are the screens' own (tests/backend/fixtures/sales, captured by
// harness/review-b-capture.jsx) wherever a screen can send the request.
import fs from 'fs';
import path from 'path';
import { store, call, sum, r2, N, K, seedStock } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, ok, H, RANGE } from '../support/flowlib.js';
import { convertDateToTimestamp } from '../../../lib/date-utils';
import dashboard from '../../../pages/api/dashboard/index';
import commissionsR from '../../../pages/api/reports/commissions';
import freightR from '../../../pages/api/reports/transport-cost';

const FIX = path.join(__dirname, '../fixtures/sales');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const SEED = fx('seed.json');
function seed() {
  reset(); seedStock(); stats.failures = [];
  for (const c of SEED.customer_details) Object.assign(store.customer_details.find(x => x.id === c.id), c);
  store.staff = SEED.staff.map(s => ({ ...s }));
  store.mechanic = SEED.mechanic.map(m => ({ ...m }));
  for (const p of SEED.product) Object.assign(store.product.find(x => x.id === p.id), p);
}
const api = (kind) => ({ col: kind === 'sale' ? H.sales : H.salex, one: kind === 'sale' ? H.saleOne : H.salexOne });
const header = (kind) => kind === 'sale' ? 'invoice' : 'invoicex';
const lineTable = (kind) => kind === 'sale' ? 'invoiceitems' : 'invoice_itemsx';
const doc = (kind, id) => store[header(kind)].find(b => b.id === id);
const docLines = (kind, id) => store[lineTable(kind)].filter(l => l.invoice_no === id).sort((a, b) => a.id - b.id);
async function createFrom(kind, file, patch = {}) {
  const r = await call(api(kind).col, 'POST', {}, { ...structuredClone(fx(file).body), ...patch });
  return { r, id: r.body?.sale?.id };
}
function editBody(kind, file, id) {
  const body = structuredClone(fx(file).body);
  const rows = docLines(kind, id);
  (body.invoiceItems || []).forEach((it, i) => { if (it.line_id !== undefined) it.line_id = rows[i]?.id; });
  return body;
}
const put = (kind, id, body) => call(api(kind).one, 'PUT', { id: String(id) }, body);
const ledgerBalance = (cid = 1) => r2(sum(store.customer_ledger.filter(l => l.customer_id === cid), l => N(l.debit) - N(l.credit)));
const done = async (step) => { await checkAll(step); await checkReports(step); expect(stats.failures).toEqual([]); };

describe('Review B - findings', () => {
  for (const kind of ['sale', 'salex']) {
    const taxed = kind === 'sale';

    // ------------------------------------------------------------------ B-01
    // An on-account refund REDUCES a customer's advance (money paid back out), but the advance is
    // computed as (paid - allocated) + (refunded - refund_allocated): lib/sale-create.ts:255-258,
    // lib/customer-transaction-handler.ts:643-645, lib/customer-ledger-handler.ts:111-113. The
    // payment rows still show the refunded money as "free", so allocateFromAdvance takes it, and the
    // rest becomes a "carried advance" row. The cash the customer hands over is never recorded.
    test.failing(`B-01 ${kind}: paid on create after the customer's advance was refunded - the new money is recorded`, async () => {
      seed();
      await call(H.cpCreate, 'POST', {}, { customer_id: 1, payment_date: '2026-10-01', payment_mode: 0, payment_amount: 500, payment_type: 'DIRECT', allocations: [] });
      await call(H.crCreate, 'POST', {}, { customer_id: 1, refund_date: '2026-10-01', refund_mode: 0, refund_amount: 500, allocations: [] });
      ok('advance is 0 by the ledger before the bill', ledgerBalance() === 0, store.customer_ledger);
      const { r, id } = await createFrom(kind, `${kind}-create-paid.json`);
      const t = doc(kind, id).total;
      ok('201', r.status === 201, r.body);
      const fresh = store.customer_payments.filter(p => p.payment_type === 'BILL_SPECIFIC');
      ok(`the ₹${t} handed over is one new payment`, fresh.length === 1 && N(fresh[0].payment_amount) === t, store.customer_payments);
      ok('a paid bill leaves the customer square', ledgerBalance() === 0, store.customer_ledger);
      await done(`B-01 ${kind}`);
    });
    test.failing(`B-01 ${kind}: marked paid on the edit form after an advance was refunded - the new money is recorded`, async () => {
      seed();
      await call(H.cpCreate, 'POST', {}, { customer_id: 1, payment_date: '2026-10-01', payment_mode: 0, payment_amount: 500, payment_type: 'DIRECT', allocations: [] });
      await call(H.crCreate, 'POST', {}, { customer_id: 1, refund_date: '2026-10-01', refund_mode: 0, refund_amount: 500, allocations: [] });
      const { id } = await createFrom(kind, `${kind}-create.json`);
      const res = await put(kind, id, editBody(kind, `${kind}-edit-paid.json`, id));
      const t = doc(kind, id).total;
      ok('200, paid', res.status === 200 && doc(kind, id).payment_status === 1, res.body);
      ok('a paid bill leaves the customer square', ledgerBalance() === 0, store.customer_ledger);
      ok(`₹${t} of new money`, N(store.customer_payments.filter(p => p.payment_type === 'BILL_SPECIFIC').reduce((a, p) => a + N(p.payment_amount), 0)) === t, store.customer_payments);
      await done(`B-01 ${kind} edit`);
    });

    // ------------------------------------------------------------------ B-02
    // Clearing P&F on the edit form sends packing_forwarding_qty 0 and rate 0 and no total
    // (BillForm.tsx:216-217); the edit then takes the STORED total (lib/sale-edit.ts:116-118) and
    // packingAmount (lib/line-math.ts:133-138) turns "no qty + a total" into 1 x that total.
    // The purchase twin uses the sent fields as one set (lib/purchase-edit.ts:187-190).
    test.failing(`B-02 ${kind}: P&F cleared on the edit form is removed from the bill`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      const before = doc(kind, id).total;
      const body = editBody(kind, `${kind}-edit-pf-removed.json`, id);
      ok('the form sent qty 0, rate 0', body.packing_forwarding_qty === 0 && body.packing_forwarding_rate === 0 && body.packing_forwarding_total === undefined, body);
      const res = await put(kind, id, body);
      ok('200', res.status === 200, res.body);
      ok('P&F 0', doc(kind, id).packing_forwarding_total === 0 && doc(kind, id).packing_forwarding_qty === 0, doc(kind, id));
      ok(`total down by the ₹100 P&F to ${before - 100}`, doc(kind, id).total === before - 100, doc(kind, id));
      await done(`B-02 ${kind}`);
    });

    // ------------------------------------------------------------------ B-03
    // Changing only the payment mode of a paid bill: the header takes it (lib/sale-edit.ts:151-153,
    // 168) but a 1 -> 1 edit with no amount change has no operation (customer-ledger-handler
    // '1->1', balance handler '1->1'), so the payment, its ledger row and the cash book keep the old
    // mode. Same on purchase (twin).
    test.failing(`B-03 ${kind}: payment mode changed on a paid bill reaches the payment, the ledger and the cash book`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create-paid.json`);
      const t = doc(kind, id).total;
      const body = editBody(kind, `${kind}-edit-paid-mode.json`, id);
      ok('the form sent mode 1 and no status', body.payment_mode === 1 && body.payment_status === undefined, body);
      const res = await put(kind, id, body);
      ok('200, bill says Bank', res.status === 200 && doc(kind, id).payment_mode === 1, res.body);
      ok('the payment says Bank', store.customer_payments.length === 1 && store.customer_payments[0].payment_mode === 1, store.customer_payments);
      ok('its ledger row says Bank', store.customer_ledger.filter(l => l.transaction_type === 'PAYMENT_RECEIVED').every(l => l.payment_mode === 1), store.customer_ledger);
      const cb = (await call(H.cashBookR, 'GET', RANGE)).body;
      ok(`cash book: ₹${t} in the bank, nothing in cash`, r2(cb.totals.bankNet) === t && r2(cb.totals.cashNet) === 0, cb.totals);
      await done(`B-03 ${kind}`);
    });

    // ------------------------------------------------------------------ B-04
    // The form always sends its default payment mode (0, Cash) - BillForm.tsx:88, 218 - and an edit
    // falls back to 0 (lib/sale-edit.ts:151-153), so an unpaid bill is stored as a Cash bill: the
    // list shows "Cash", its Cash filter includes unpaid bills, and the sales report counts it in
    // cash sales (lib/bill-report.ts:66-67). lib/sale-read.ts:76 says an unset mode should stay unset.
    test.failing(`B-04 ${kind}: an unpaid bill from the form is not a Cash sale`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      ok('the form sent status 0 with mode 0', fx(`${kind}-create.json`).body.payment_status === 0 && fx(`${kind}-create.json`).body.payment_mode === 0);
      const rep = (await call(H.salesR, 'GET', { ...RANGE, reportType: kind })).body.summary;
      ok('sales report: no cash sales', rep.cashSales === 0, rep);
      const cash = (await call(api(kind).col, 'GET', { page: '1', limit: '50', paymentMode: '0' })).body.data || [];
      ok('list filter "Cash" does not find the unpaid bill', !cash.some(r => r.id === id), cash.map(r => [r.id, r.payment_status, r.payment_mode]));
      ok('stored with no mode', doc(kind, id).payment_mode === null, doc(kind, id));
      await done(`B-04 ${kind}`);
    });

    // ------------------------------------------------------------------ B-05
    // A walk-in bill marked Paid has no payment (owner rule), so lib/sale-read.ts:210-216 and
    // lib/sale-query.ts:145-173 read it as wholly outstanding: the view shows
    // "Paid / Outstanding ₹0 / ₹1,680" (harness review-b-capture, walk-in view) and the list
    // carries remaining_amount = total.
    test.failing(`B-05 ${kind}: a walk-in bill marked Paid reads as paid, not outstanding`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create-other.json`);
      const d = (await call(api(kind).one, 'GET', { id: String(id) })).body;
      ok('detail: nothing outstanding', d.outstanding_amount === 0 && d.payment_summary.remaining_amount === 0 && d.payment_summary.is_fully_paid === true, d.payment_summary);
      const row = ((await call(api(kind).col, 'GET', { page: '1', limit: '50' })).body.data || []).find(r => r.id === id);
      ok('list: nothing outstanding', row && row.remaining_amount === 0, row);
      await done(`B-05 ${kind}`);
    });

    // ------------------------------------------------------------------ B-06
    // The form has no shipping block and no supply date; an edit rebuilds the ship-to from the
    // billing snapshot whenever any billing field is sent (lib/sale-edit.ts:295-298, the form
    // always sends them) and writes supply_date null (transportFrom, lib/sale-create.ts:233-240).
    // A bill saved with its own ship-to / supply date (the older form; the API still takes and
    // returns them) loses both on any edit, e.g. a notes change.
    test.failing(`B-06 ${kind}: a notes edit keeps the bill's own ship-to and supply date`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create.json`, {
        useShippingAddress: true,
        shippingDetails: { user_name: 'Site Office', address: 'Plot 9, Transport Nagar', city: 'Agra', state: 'Uttar Pradesh', state_code: 9 },
        transportDetails: { trans_mode: 'Sharma Roadways', vehicle_no: 'UP85 AB 1234', supply_date: '2026-10-02' }
      });
      const ship = (await call(api(kind).one, 'GET', { id: String(id) })).body.shippingDetails;
      ok('created with its own ship-to', ship.user_name === 'Site Office' && ship.city === 'Agra', ship);
      const res = await put(kind, id, editBody(kind, `${kind}-edit-notes.json`, id));
      ok('200', res.status === 200, res.body);
      const after = (await call(api(kind).one, 'GET', { id: String(id) })).body;
      ok('ship-to kept', after.shippingDetails.user_name === 'Site Office' && after.shippingDetails.address === 'Plot 9, Transport Nagar' && after.shippingDetails.city === 'Agra', after.shippingDetails);
      ok('supply date kept', after.transportDetails.supply_date === '2026-10-02', after.transportDetails);
      await done(`B-06 ${kind}`);
    });
  }

  // ------------------------------------------------------------------ B-07
  // Deleting an Invoice C logs its balance change as source_type 'sale_delete', reference 'INV-n'
  // (lib/customer-transaction-handler.ts:1515-1527) although 'salex_delete' exists
  // (lib/customer-balance-log-service.ts:5) and the create logged 'salex_create'. Sale and Invoice C
  // ids overlap, so the log points at the wrong bill.
  // The same kind loss in the customer's ledger account: an amount edit rewrites the SALE row's
  // particulars to "Sale <n> updated to ₹..." for both kinds (lib/customer-ledger-handler.ts, every
  // 'Update sale amount' op), so an edited Invoice C 1 reads as Sale 1 (lib/ledger-report.ts:71
  // shows the notes as particulars).
  test.failing('B-07 salex: an Invoice C keeps its kind in balance logs and ledger particulars', async () => {
    seed();
    const { id } = await createFrom('salex', 'salex-create-paid.json');
    await call(H.salexOne, 'DELETE', { id: String(id) });
    const logs = store.customer_balance_logs.filter(l => l.change_amount < 0);
    ok('the delete\'s log rows say salex_delete', logs.length > 0 && logs.every(l => l.source_type === 'salex_delete'), logs.map(l => [l.source_type, l.source_id, l.reference_no]));
    const { id: id2 } = await createFrom('salex', 'salex-create.json');
    await put('salex', id2, editBody('salex', 'salex-edit-qty.json', id2));
    const row = store.customer_ledger.find(l => l.reference_type === 'salex' && l.transaction_type === 'SALE');
    ok('the edited Invoice C\'s ledger particulars still say Invoice C', /Invoice C/.test(row.notes || ''), row.notes);
    await done('B-07');
  });

  // ------------------------------------------------------------------ B-09
  // updated_at: create stores the India date 'YYYY-MM-DD' (lib/sale-create.ts:110), an edit stores
  // a UTC 'YYYY-MM-DD HH:MM:SS' (lib/sale-edit.ts:181) - one column, two formats, and before 05:30
  // IST the edit's stamp is the previous day. Purchase edit does not touch it.
  test.failing('B-09 sale: an edit stamps updated_at in the create\'s format and India time', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T20:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'nextTick', 'queueMicrotask'] }); // 01:30 IST, 3 Oct
    try {
      seed();
      const { id } = await createFrom('sale', 'sale-create.json');
      const created = doc('sale', id).updated_at;
      ok('create: India date', created === '2026-10-03', created);
      await put('sale', id, editBody('sale', 'sale-edit-notes.json', id));
      const edited = doc('sale', id).updated_at;
      ok('edit: same format, same India day', edited === '2026-10-03', edited);
    } finally { jest.useRealTimers(); }
    expect(stats.failures).toEqual([]);
  });

  // ------------------------------------------------------------------ B-10
  // Commission, mechanic, staff, freight and P&F reports name the customer from the master
  // (pages/api/reports/commissions.ts:67-78, transport-cost.ts:59-71, and the mechanic / staff /
  // P&F twins), so a walk-in is "Unknown" and a bill shows the customer's current name, not the
  // one printed on it; the sale list and the bill-reference report use the bill's snapshot.
  test.failing('B-10 sale: a walk-in with commission and freight is named in the commission and freight reports', async () => {
    seed();
    await createFrom('sale', 'sale-create-other.json', { commission: 20, transport_cost: 50 });
    const com = (await call(commissionsR, 'GET', { ...RANGE })).body.data || [];
    const fr = (await call(freightR, 'GET', { ...RANGE })).body.data || [];
    ok('commission report names the walk-in', com.length === 1 && com[0].customer_name === 'Walk-in Kumar', com);
    ok('freight report names the walk-in', fr.length === 1 && fr[0].party_name === 'Walk-in Kumar', fr);
    await done('B-10');
  });

  // ------------------------------------------------------------------ B-13 (returns / GST report - sections D and E)
  // Found here because the screens' own bill has a discounted 18% line (2 x 1000 - 100 = 1900,
  // GST 342 = CGST 171 + SGST 171). A return of one unit is 950 + 171 tax; the credit note rounds
  // each head to the rupee (lib/sale-return.ts:181: 85.5 -> 86 twice = 172) while the GST report
  // sums the unrounded line tax (lib/gst-report.ts:50-54: 171). Two such returns: the notes refund
  // 344 of GST against 342 charged, and the report's credit-note tax (342) disagrees with the notes.
  test.failing('B-13 sale: credit notes for a discounted line agree with the GST report and refund no more GST than was charged', async () => {
    seed();
    const { id } = await createFrom('sale', 'sale-create.json');
    const line = docLines('sale', id)[0];
    for (let i = 0; i < 2; i++) {
      const r = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: '2026-10-04', payment_status: 0, payment_mode: 1,
        items: [{ invoice_item_id: line.id, invoice_type: 'invoice', return_qty: 1, return_reason_id: 1 }] });
      ok('return 201', r.status === 201, r.body);
    }
    const notesTax = r2(sum(store.sale_returns, x => N(x.total_tax)));
    ok('GST refunded on the notes = GST charged on the line (342)', notesTax === 342, store.sale_returns.map(x => [x.id, x.total_amount, x.total_tax, x.refund_amount]));
    await done('B-13');
  });

  // ------------------------------------------------------------------ B-08 (question)
  test('[QUESTION B-08] the dashboard counts GST sales only - an Invoice C is not in Total / Today / day total / last sale', async () => {
    seed();
    await createFrom('salex', 'salex-create.json');
    const d = (await call(dashboard, 'GET', { today: '2026-10-02', salesDate: '2026-10-02' })).body;
    ok('Invoice C not counted (today)', d.totals.sales === 0 && d.today.sales === 0 && d.salesDay.total === 0 && d.lastSale === null, d);
    await done('B-08');
  });

  // ------------------------------------------------------------------ B-11 (question)
  test('[QUESTION B-11] moving the date of a bill paid on create leaves the payment taken with it on the old day', async () => {
    seed();
    const { id } = await createFrom('sale', 'sale-create-paid.json');
    const body = editBody('sale', 'sale-edit-paid-mode.json', id);
    body.payment_mode = 0; body.date = '2026-10-05';
    await put('sale', id, body);
    const day3 = convertDateToTimestamp('2026-10-03'), day5 = convertDateToTimestamp('2026-10-05');
    ok('bill and its SALE row on the 5th', doc('sale', id).invoice_date === day5 && store.customer_ledger.find(l => l.transaction_type === 'SALE').transaction_date === day5);
    ok('payment, allocation and PAYMENT_RECEIVED row still on the 3rd (cash book shows the money on the 3rd)', store.customer_payments[0].payment_date === day3
      && store.customer_payment_allocations[0].allocation_date === day3 && store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED').transaction_date === day3, { p: store.customer_payments, l: store.customer_ledger });
    await done('B-11');
  });

  // ------------------------------------------------------------------ B-12
  // "Export all" on the list asks for one page of 1,000 (components/bills/BillList.tsx:114) and the
  // API caps limit at 1,000 (lib/sale-query.ts:60), so an export of more bills is cut short with no
  // warning. Pinned here as today's cap.
  test('[B-12] the list API caps a page at 1,000 rows (Export all asks for one page)', async () => {
    seed();
    const r = await call(H.sales, 'GET', { page: '1', limit: '5000' });
    ok('limit capped to 1000', r.body.pagination.limit === 1000, r.body.pagination);
    expect(stats.failures).toEqual([]);
  });
});
