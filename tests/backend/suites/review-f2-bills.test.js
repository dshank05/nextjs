// Fixer F2 (bills: purchase, sale, Invoice C) - plain tests for behaviour the review findings'
// own tests do not cover: the twins (customer side of a vendor finding and the other way round)
// and the edges of each fix. Each runs A1-A14 and the 16 report checks after it (sc()).
import { K, KINDS, store, call, N, r2, sum, rows, bal, payRows, allocs, paidOn, lines, bill, payments, counters, create, edit, pay, sc, ex, D } from '../support/scenlib.js';
import { H, RANGE } from '../support/flowlib.js';

const del = (k, id) => call(k.one, 'DELETE', { id: String(id) });

describe('F2 - a lowered paid bill keeps its payment row (H2 = A-01, all three kinds)', () => {
  for (const k of KINDS) {
    sc(`F2-A01-${k.name}-delete`, `${k.label}: paid on create, lowered, deleted - the payment and its ledger credit stay`, async () => {
      const { id } = await create(k, { status: 1, mode: 0 });
      await edit(k, id, { items: [[1, 8, 1000, 0]] });
      ex(k.name, 'payment now MIXED, one ledger row tagged to the payment for 10000', payments(k)[0].payment_type === 'MIXED'
        && payRows(k).length === 1 && payRows(k)[0].reference_type === 'payment' && N(payRows(k)[0].credit) === 10000, { p: payments(k), l: payRows(k) });
      ex(k.name, 'ledger: 8000 owed less 10000 paid', bal(k) === -2000, rows(k));
      const r = await del(k, id);
      ex(k.name, 'deleted; 10000 stays as advance', r.status === 200 && payments(k).length === 1 && N(payments(k)[0].payment_amount) === 10000, payments(k));
      ex(k.name, 'ledger -10000', bal(k) === -10000, rows(k));
      ex(k.name, 'counters: paid 10000, allocated 0', counters(k).paid === 10000 && counters(k).alloc === 0, counters(k));
    });
    sc(`F2-A01-${k.name}-unmark`, `${k.label}: paid on create, lowered, unmarked - the payment stays as advance with its row`, async () => {
      const { id } = await create(k, { status: 1, mode: 0 });
      await edit(k, id, { items: [[1, 8, 1000, 0]] });
      const r = await edit(k, id, { status: 0 });
      ex(k.name, 'unpaid, payment kept (DIRECT)', r.status === 200 && bill(k, id).payment_status === 0 && payments(k).length === 1 && payments(k)[0].payment_type === 'DIRECT', { r: r.body, p: payments(k) });
      ex(k.name, 'ledger -2000', bal(k) === -2000, rows(k));
      ex(k.name, 'counters: paid 10000, allocated 0', counters(k).paid === 10000 && counters(k).alloc === 0, counters(k));
    });
    sc(`F2-A01-${k.name}-shared`, `${k.label}: one payment for two bills, one lowered then deleted - the other bill and the advance stay`, async () => {
      const a = (await create(k)).id, b = (await create(k)).id;
      await pay(k, 20000, [[k, a, 10000], [k, b, 10000]], { mode: 1 });
      await edit(k, a, { items: [[1, 8, 1000, 0]] });
      ex(k.name, 'one payment row for the 20000', payRows(k).length === 1 && N(payRows(k)[0].credit) === 20000, payRows(k));
      await del(k, a);
      ex(k.name, '20000 kept: 10000 on B, 10000 advance; ledger -10000', N(payments(k)[0]?.payment_amount) === 20000 && paidOn(k, b) === 10000 && bal(k) === -10000, { p: payments(k), l: rows(k) });
      await edit(k, b, { status: 0 });
      ex(k.name, 'B unmarked too: the whole 20000 is advance; B owed 10000: ledger -10000', bal(k) === -10000 && payments(k).length === 1 && counters(k).alloc === 0, { l: rows(k), c: counters(k) });
      const pr = await call(k.payOne, 'DELETE', { id: String(payments(k)[0].id) });
      ex(k.name, 'the payment itself deleted: its row goes, B owed 10000', pr.status === 200 && payRows(k).length === 0 && bal(k) === 10000 && counters(k).paid === 0, { r: pr.body, l: rows(k) });
    });
  }
});

describe('F2 - payment mode picked on a paid bill (M1 = A-05 / B-03): edges, all three kinds', () => {
  for (const k of KINDS) {
    sc(`F2-M1-${k.name}-shared`, `${k.label}: a payment shared with another bill keeps its own mode`, async () => {
      const a = (await create(k)).id, b = (await create(k)).id;
      await pay(k, 20000, [[k, a, 10000], [k, b, 10000]], { mode: 1 });
      const r = await edit(k, a, { mode: 0 });
      ex(k.name, 'saved; the bill says Cash', r.status === 200 && bill(k, a).payment_mode === 0, r.body);
      ex(k.name, 'the shared bank payment and its rows stay Bank', payments(k)[0].payment_mode === 1 && payRows(k).every(l => l.payment_mode === 1), { p: payments(k), l: payRows(k) });
    });
    sc(`F2-M1-${k.name}-untouched`, `${k.label}: an edit that leaves the mode as stored does not move a Mark-as-Paid payment's mode`, async () => {
      const { id } = await create(k, { mode: 0 });                    // unpaid, stored Cash (the form's default)
      await pay(k, 10000, [[k, id, 10000]], { mode: 1 });              // paid from the view in Bank
      const r = await edit(k, id, { mode: 0, extra: { notes: 'x' } });
      ex(k.name, 'saved; the payment stays Bank', r.status === 200 && payments(k)[0].payment_mode === 1 && payRows(k).every(l => l.payment_mode === 1), { p: payments(k), l: payRows(k) });
    });
    sc(`F2-M1-${k.name}-own-from-view`, `${k.label}: the bill's own Mark-as-Paid payment follows a mode change on the form`, async () => {
      const { id } = await create(k, { mode: 1 });                    // unpaid, stored Bank
      await pay(k, 4000, [[k, id, 4000]], { mode: 1 });               // part paid in Bank
      const r = await edit(k, id, { mode: 0 });
      ex(k.name, 'part paid; payment and rows now Cash', r.status === 200 && bill(k, id).payment_status === 2 && payments(k)[0].payment_mode === 0 && payRows(k).every(l => l.payment_mode === 0), { p: payments(k), l: payRows(k) });
    });
  }
});

describe('F2 - "Other" vendor (0) posts like any vendor (M2 = A-02, A-11)', () => {
  sc('F2-M2-other-part-paid', '"Other" purchase part paid from the view, then the rest, then deleted: counters follow and come back to 0', async () => {
    const k = K.purchase;
    const { id } = await create(k, { partyId: 0, extra: { vendor_name: 'Walk-in Supplier', contact_number: '99', state_code: 9 } });
    const p = await pay(k, 4000, [[k, id, 4000]], { partyId: 0, mode: 0 });
    ex('M2', 'part payment 201, bill part paid', p.r.status === 201 && bill(k, id).payment_status === 2, p.r.body);
    ex('M2', 'vendor 0 counters 4000 / 4000', counters(k, 0).paid === 4000 && counters(k, 0).alloc === 4000, counters(k, 0));
    const e = await pay(k, 6000, [[k, id, 6000]], { partyId: 0, mode: 1 });
    ex('M2', 'rest paid 201', e.r.status === 201, e.r.body);
    ex('M2', 'paid; counters 10000 / 10000', bill(k, id).payment_status === 1 && counters(k, 0).paid === 10000 && counters(k, 0).alloc === 10000, counters(k, 0));
    await del(k, id);
    ex('M2', 'deleted; counters 0 / 0, ledger square', counters(k, 0).paid === 0 && counters(k, 0).alloc === 0 && bal(k, 0) === 0, { c: counters(k, 0), l: rows(k, 0) });
  });
});

describe('F2 - a paid bill at rate 0 priced later (M3 = A-03), all three kinds', () => {
  for (const k of KINDS) {
    sc(`F2-M3-${k.name}`, `${k.label}: created Paid at 0, priced by an edit - Unpaid, no money invented; then marked Paid makes one payment`, async () => {
      const { id } = await create(k, { status: 1, mode: 0, items: [[1, 10, 0, 0]] });
      ex(k.name, 'paid at 0', bill(k, id).payment_status === 1 && N(bill(k, id).total) === 0, bill(k, id));
      const r = await edit(k, id, { items: [[1, 10, 1000, 0]] });
      ex(k.name, 'saved at 10000, Unpaid, nothing allocated', r.status === 200 && N(bill(k, id).total) === 10000 && bill(k, id).payment_status === 0 && paidOn(k, id) === 0, { r: r.body, b: bill(k, id) });
      ex(k.name, 'counters 0 / 0, ledger 10000 owed', counters(k).paid === 0 && counters(k).alloc === 0 && bal(k) === 10000, { c: counters(k), l: rows(k) });
      await edit(k, id, { status: 1, mode: 1 });
      ex(k.name, 'paid: one 10000 payment, square', bill(k, id).payment_status === 1 && payments(k).length === 1 && N(payments(k)[0].payment_amount) === 10000 && bal(k) === 0 && counters(k).paid === 10000, { p: payments(k), l: rows(k) });
    });
  }
  sc('F2-M3-walkin', 'walk-in sale created Paid at 0, priced by an edit: stays Paid (a walk-in has no payment rows by rule)', async () => {
    const k = K.sale;
    const { id } = await create(k, { status: 1, mode: 0, items: [[1, 10, 0, 0]], partyId: 0, extra: { customer_name: 'Walk-in', contact_number: '9' } });
    const r = await edit(k, id, { items: [[1, 10, 1000, 0]] });
    ex('walk-in', 'saved, still Paid', r.status === 200 && bill(k, id).payment_status === 1 && N(bill(k, id).total) === 10000, { r: r.body, b: bill(k, id) });
  });
});

describe('F2 - ship-to on a sale edit (B-06): a copy of the billing details follows them', () => {
  for (const k of [K.sale, K.salex]) {
    sc(`F2-B06-${k.name}-copy`, `${k.label}: ship-to copied from billing at create follows a billing-name change; a transport edit keeps the supply date`, async () => {
      const { id } = await create(k, { extra: { customer_name: 'Ravi Motors', transportDetails: { trans_mode: 'Road', vehicle_no: 'A1', supply_date: '2026-10-02' } } });
      await edit(k, id, { extra: { customer_name: 'Ravi Motors Pvt', transport_name: 'Rail', vehicle_number: 'B2' } });
      const d = (await call(k.one, 'GET', { id: String(id) })).body;
      ex(k.name, 'ship-to name follows billing', d.shippingDetails?.user_name === 'Ravi Motors Pvt', d.shippingDetails);
      ex(k.name, 'transport changed, supply date kept', d.transportDetails.trans_mode === 'Rail' && d.transportDetails.vehicle_no === 'B2' && d.transportDetails.supply_date === '2026-10-02', d.transportDetails);
    });
  }
});

describe('F2 - list "Export all" pages through (B-12)', () => {
  test('[B-12] fetchAllBills asks for every page of 1,000 the API reports and returns them all', async () => {
    const { fetchAllBills, EMPTY_BILL_FILTERS } = require('../../../hooks/useBills');
    const asked = [];
    const realFetch = global.fetch;
    global.fetch = async (url) => {
      const q = new URLSearchParams(String(url).split('?')[1]);
      const page = Number(q.get('page')), limit = Number(q.get('limit'));
      asked.push([page, limit]);
      const n = page < 3 ? 1000 : 500;
      const data = Array.from({ length: n }, (_, i) => ({ id: (page - 1) * 1000 + i + 1, invoice_no: i + 1, total: 1 }));
      return { ok: true, json: async () => ({ data, pagination: { page, limit, total: 2500, totalPages: 3, hasMore: page < 3 } }) };
    };
    try {
      const rows = await fetchAllBills('sale', EMPTY_BILL_FILTERS);
      expect(asked).toEqual([[1, 1000], [2, 1000], [3, 1000]]);
      expect(rows.length).toBe(2500);
      expect(new Set(rows.map(r => r.id)).size).toBe(2500);
    } finally { global.fetch = realFetch; }
  });
});

describe('F2 - deleting a purchase restores the product\'s latest purchase rate and date (A-09)', () => {
  sc('F2-A09-previous', 'two purchases (3rd at 1000, 5th at 1500), the 5th deleted: rate 1000 and the 3rd\'s date; the 3rd deleted after a newer one: untouched', async () => {
    const k = K.purchase;
    for (const p of store.product) Object.assign(p, { last_purchase_date: null, latest_purchase_rate: null });
    const a = (await create(k, { date: D(3), items: [[1, 1, 1000, 0]] })).id;
    const b = (await create(k, { date: D(5), items: [[1, 1, 1500, 0]] })).id;
    const p1 = () => store.product.find(p => p.id === 1);
    ex('A-09', 'newest: 1500 on the 5th', p1().latest_purchase_rate === 1500 && p1().last_purchase_date === bill(k, b).invoice_date, p1());
    await del(k, b);
    ex('A-09', 'back to 1000 on the 3rd', p1().latest_purchase_rate === 1000 && p1().last_purchase_date === bill(k, a).invoice_date, p1());
    const c = (await create(k, { date: D(7), items: [[1, 1, 1200, 0]] })).id;
    await del(k, a);
    ex('A-09', 'an older bill deleted: the newest (1200 on the 7th) stays', p1().latest_purchase_rate === 1200 && p1().last_purchase_date === bill(k, c).invoice_date, p1());
  });
});

describe('F2 - purchase view export (A-12)', () => {
  test('[A-12] returns print this bill\'s share, item count and status in words', () => {
    const { preparePurchaseDataForExport, purchaseViewExportLayout } = require('../../../lib/export-layouts/purchase-view-layout');
    const out = preparePurchaseDataForExport({ items: [{ subtotal: 1000, tax: 180 }], returns: [{ return_no: 'PR-001', this_bill_total: 590, this_bill_items_count: 1, total_amount: 1180, payment_status: 1, payment_mode: 0 }] });
    expect(out.items[0].total).toBe(1180);
    const table = purchaseViewExportLayout.sections.find(s => s.dataKey === 'returns');
    const row = Object.fromEntries(table.columns.map(c => [c.label, out.returns[0][c.key]]));
    expect(row).toMatchObject({ 'Total Amount': 590, 'Items Count': 1, 'Payment Status': 'Refunded', 'Payment Mode': 'Cash' });
  });
});
