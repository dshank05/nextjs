// SALES_COMPREHENSIVE_TEST_SCENARIOS batches 7-9 (integration, edge cases, data integrity), for
// sale and purchase (Invoice C where the twin applies). See docs/SCENARIO_TESTS_PLAN.md.
import { K, store, call, sum, r2, N, H, rows, bal, billNet, payRows, allocs, paidOn, lines, bill, payments, stock, counters, create, edit, pay, D, sc, ex, snapshot, deep } from '../support/scenlib.js';
const audit = require('../../../scripts/audit-assert.js');

const R = { sale: { create: H.srCreate, one: H.srOne, rets: 'sale_returns', invType: 'invoice' }, salex: { create: H.srCreate, one: H.srOne, rets: 'salex_returns', invType: 'invoicex' }, purchase: { create: H.prCreate, one: H.prOne, rets: 'purchase_returns', invType: null } };
const retLine = (k, l, q) => k.name === 'purchase' ? { purchase_item_id: l.id, return_qty: q, return_reason_id: 1 } : { invoice_item_id: l.id, invoice_type: R[k.name].invType, return_qty: q, return_reason_id: 1 };
const ret = async (k, l, q, status = 0, date = D(4)) => { const r = await call(R[k.name].create, 'POST', {}, { [k.who]: 1, return_date: date, payment_status: status, payment_mode: 0, items: [retLine(k, l, q)] }); return { r, id: store[R[k.name].rets].at(-1)?.id }; };
const retEdit = (k, id, l, q, extra = {}) => call(R[k.name].one, 'PUT', { id: String(id), ...(R[k.name].invType ? { type: R[k.name].invType } : {}) }, { items: [retLine(k, l, q)], ...(R[k.name].invType ? { invoice_type: R[k.name].invType } : {}), ...extra });
const tag = (k, n) => `${k.name === 'sale' ? 'S' : k.name === 'salex' ? 'X' : 'P'}${n}`;
// What a fully refunded 2000 return leaves: the customer side posts CREDIT_NOTE + REFUND (nets 0);
// the vendor side posts the DEBIT_NOTE only (direct adjustment, owner).
const afterRefundedReturn = (k, before) => k.party === 'customer' ? before : before - 2000;
const fails = async (id) => (await audit.run([id], { quiet: true }))[0].failures;

describe('Scenarios - batch 7: integration', () => {
  for (const k of [K.sale, K.salex, K.purchase]) {
    sc(tag(k, '7.1'), 'full cycle: bill -> payment -> return refunded', async () => {
      const id_ = tag(k, '7.1');
      const { id } = await create(k); await pay(k, 10000, [[k, id, 10000]]);
      const { r } = await ret(k, lines(k, id)[0], 2, 1);
      ex(id_, 'bill paid and partly returned', r.status === 201 && bill(k, id).payment_status === 1 && bill(k, id).return_status === 1, bill(k, id));
      ex(id_, `ledger ${afterRefundedReturn(k, 0)} after paying in full and a refunded 2000 return`, bal(k) === afterRefundedReturn(k, 0), rows(k));
    });
    sc(tag(k, '7.2'), 'partial cycle: part payment, pending return, then refunded by edit', async () => {
      const id_ = tag(k, '7.2');
      const { id } = await create(k); await pay(k, 6000, [[k, id, 6000]]);
      const { id: rid } = await ret(k, lines(k, id)[0], 2, 0);
      ex(id_, 'pending: 4000 owed', bal(k) === 4000, rows(k));
      const e = await retEdit(k, rid, lines(k, id)[0], 2, { payment_status: 1, payment_mode: 0 });
      ex(id_, 'refunded by edit (note only): 2000 owed', e.status === 200 && bal(k) === 2000, { e: e.body, l: rows(k) });
    });
    sc(tag(k, '7.3'), 'three bills, one payment, returns from two', async () => {
      const id_ = tag(k, '7.3');
      const ids = []; for (let i = 0; i < 3; i++) ids.push((await create(k)).id);
      await pay(k, 30000, ids.map(id => [k, id, 10000]));
      await ret(k, lines(k, ids[0])[0], 1, 0); await ret(k, lines(k, ids[1])[0], 2, 1);
      ex(id_, 'all three paid; two partly returned', ids.every(id => bill(k, id).payment_status === 1) && bill(k, ids[0]).return_status === 1 && bill(k, ids[1]).return_status === 1 && bill(k, ids[2]).return_status === 0);
      ex(id_, `ledger ${afterRefundedReturn(k, 0)}`, bal(k) === afterRefundedReturn(k, 0), rows(k));
    });
    sc(tag(k, '7.4'), 'bill -> edit amount -> payment -> edit again', async () => {
      const id_ = tag(k, '7.4');
      const { id } = await create(k);
      await edit(k, id, { items: [[1, 12, 1000, 0]] });
      await pay(k, 12000, [[k, id, 12000]]);
      const r = await edit(k, id, { items: [[1, 14, 1000, 0]], status: 1, mode: 0 });
      ex(id_, '14000, part paid, 2000 owed', r.status === 200 && bill(k, id).total === 14000 && bill(k, id).payment_status === 2 && bal(k) === 2000, { r: r.body, b: bill(k, id), l: rows(k) });
    });
    sc(tag(k, '7.6'), 'payment deleted, then paid again', async () => {
      const id_ = tag(k, '7.6');
      const { id } = await create(k);
      const { id: pid } = await pay(k, 10000, [[k, id, 10000]]);
      await call(k.payOne, 'DELETE', { id: String(pid) });
      await pay(k, 10000, [[k, id, 10000]]);
      ex(id_, 'paid, one payment, balance 0, counters 10000', bill(k, id).payment_status === 1 && payments(k).length === 1 && bal(k) === 0 && counters(k).paid === 10000, { p: payments(k), c: counters(k) });
    });
    sc(tag(k, '7.7'), 'return refunded before the bill is paid in full', async () => {
      const id_ = tag(k, '7.7');
      const { id } = await create(k); await pay(k, 5000, [[k, id, 5000]]);
      await ret(k, lines(k, id)[0], 2, 1);
      ex(id_, `ledger ${afterRefundedReturn(k, 5000)}; bill still part paid`, bal(k) === afterRefundedReturn(k, 5000) && bill(k, id).payment_status === 2, { l: rows(k), b: bill(k, id) });
    });
    sc(tag(k, '7.8'), 'two financial years: numbers restart, each bill keeps its year', async () => {
      const id_ = tag(k, '7.8');
      const a = (await create(k)).id;
      store.financial_year.push({ id: 5, start_date: Math.floor(Date.UTC(2027, 3, 1) / 1000) - 19800, end_date: Math.floor(Date.UTC(2028, 2, 31) / 1000) - 19800, is_current: false });
      store.settings[0].currentfy = 5;
      const b = (await create(k, { date: D(6) })).id;
      ex(id_, 'FY 4 bill no 1, FY 5 bill no 1', bill(k, a).fy === 4 && bill(k, a).invoice_no === 1 && bill(k, b).fy === 5 && bill(k, b).invoice_no === 1, [bill(k, a), bill(k, b)]);
      ex(id_, 'each ledger row keeps its bill\'s year', billNet(k, a) === 10000 && billNet(k, b) === 10000 && store[k.ledger].find(l => l.reference_id === b)?.fy === 5, store[k.ledger]);
    });
    if (k.name !== 'salex') sc(tag(k, '7.9'), '50 transactions on one party: ledger report pages and closing', async () => {
      const id_ = tag(k, '7.9');
      for (let i = 0; i < 25; i++) { const { id } = await create(k, { items: [[1, 1, 100 + i, 0]] }); await pay(k, 50, [[k, id, 50]]); }
      const ledgerH = k.party === 'vendor' ? H.vendLedger : H.custLedger;
      const p3 = (await call(ledgerH, 'GET', { [k.who]: '1', page: '3', limit: '20' })).body;
      const want = r2(sum(store[k.bills], b => b.total) - 1250);
      ex(id_, `50 rows; page 3 has 10; its last balance ${want}`, p3?.pagination?.total === 50 && p3.entries.length === 10 && p3.entries.at(-1).balance === want && bal(k) === want, p3?.pagination);
    }, { known: k.party === 'vendor' ? ['A2'] : [] }); // F-02 (open): purchases dated before the payments entered between them
    sc(tag(k, '7.10'), 'edit a bill that has a return', async () => {
      const id_ = tag(k, '7.10');
      const { id } = await create(k);
      await ret(k, lines(k, id)[0], 3, 0);
      const before = snapshot() + stock(1) + bill(k, id).total;
      const lower = await edit(k, id, { items: [[1, 2, 1000, 0]] });
      ex(id_, 'lowering the line below what was returned is refused, nothing changed', lower.status === 400 && snapshot() + stock(1) + bill(k, id).total === before, lower.body);
      const raise = await edit(k, id, { items: [[1, 12, 1000, 0]] });
      ex(id_, 'raising it is fine; the return is untouched', raise.status === 200 && bill(k, id).total === 12000 && N(store[R[k.name].rets][0].refund_amount) === 3000, { r: raise.body, b: bill(k, id) });
    });
    sc(tag(k, '7.12'), 'balance summary: outstanding, ledger and balance logs agree', async () => {
      const id_ = tag(k, '7.12');
      const a = (await create(k)).id, b = (await create(k, { status: 1, mode: 0 })).id;
      await pay(k, 3000, [[k, a, 3000]]);
      const outH = k.party === 'vendor' ? H.vendOut : H.custOut, key = k.party === 'vendor' ? 'outstandingVendors' : 'outstandingCustomers';
      const o = (await call(outH, 'GET', { page: '1', limit: '50' })).body;
      ex(id_, 'outstanding 7000 = the ledger', o[key].find(x => x[k.who] === 1)?.balance === 7000 && bal(k) === 7000, o[key]);
    });
  }
  test.skip('S7.11 concurrent transactions - needs a real database (two connections)', () => {});
});

describe('Scenarios - batch 8: edge cases', () => {
  for (const k of [K.sale, K.purchase]) {
    sc(tag(k, '8.1'), 'zero and negative quantities, negative rates refused (8.1, 8.2)', async () => {
      const id_ = tag(k, '8.1');
      const before = snapshot();
      for (const [q, rate] of [[0, 1000], [-1, 1000], [10, -5]]) {
        const { r } = await create(k, { items: [[1, q, rate, 0]] });
        ex(id_, `qty ${q} x rate ${rate} refused`, r.status === 400, r.body);
      }
      ex(id_, 'nothing written', snapshot() === before);
    });
    sc(tag(k, '8.1b'), 'a bill at rate 0 (total 0) - the doc says refuse', async () => {
      const { r } = await create(k, { items: [[1, 10, 0, 0]] });
      ex(tag(k, '8.1b'), 'refused', r.status === 400, r.body);
    }, { open: 'F-S4 a zero-total bill is accepted' });
    sc(tag(k, '8.3'), 'a large bill adds up exactly', async () => {
      const id_ = tag(k, '8.3');
      const { id } = await create(k, { items: [[1, 999, 99999.99, 18]] });
      const taxable = 99899990.01;
      ex(id_, 'taxable 99,899,990.01; 18% tax; rupee total', N(bill(k, id).total_taxable_value) === taxable && bill(k, id).total === Math.round(taxable * 1.18) && billNet(k, id) === bill(k, id).total, bill(k, id));
    });
    sc(tag(k, '8.4'), 'paise and rounding (F-34)', async () => {
      const id_ = tag(k, '8.4');
      const { id } = await create(k, { items: [[1, 3, 33.33, 18]] });
      const b = bill(k, id), l = lines(k, id)[0];
      ex(id_, 'line 99.99, tax 18 (9 + 9), total 118', l.subtotal === 99.99 && b.total_tax === 18 && b.total_cgst === 9 && b.total === 118, { b, l });
    });
    sc(tag(k, '8.5'), 'notes with quotes, unicode and 2000 characters kept as typed', async () => {
      const id_ = tag(k, '8.5');
      const note = `O'Brien "₹" — ü ✓ ` + 'x'.repeat(2000);
      const { id } = await create(k, { extra: { notes: note } });
      ex(id_, 'saved verbatim', bill(k, id).notes === note, bill(k, id).notes?.slice(0, 40));
    });
    sc(tag(k, '8.7'), 'a product that does not exist is refused', async () => {
      const id_ = tag(k, '8.7');
      const before = snapshot();
      const { r } = await create(k, { items: [[99, 1, 100, 0]] });
      ex(id_, '400 (UNKNOWN_PRODUCT), nothing written', r.status === 400 && r.body?.error_code === 'UNKNOWN_PRODUCT' && snapshot() === before, r.body);
    });
    sc(tag(k, '8.8'), `a ${k.party} that does not exist is refused`, async () => {
      const id_ = tag(k, '8.8');
      const before = snapshot();
      const { r } = await create(k, { partyId: 99 });
      ex(id_, '400/404, nothing written', (r.status === 400 || r.status === 404) && snapshot() === before, r.body);
    });
    sc(tag(k, '8.9'), 'dates: the last minute of a month is in it, the first of the next is not', async () => {
      const id_ = tag(k, '8.9');
      const end = Math.floor(Date.UTC(2026, 9, 31, 23, 59) / 1000) - 19800, next = Math.floor(Date.UTC(2026, 10, 1, 0, 0) / 1000) - 19800;
      await create(k, { date: end }); await create(k, { date: next });
      const rep = (await call(k.name === 'purchase' ? H.purchaseR : H.salesR, 'GET', { dateFrom: '2026-10-01', dateTo: '2026-10-31' })).body.summary;
      ex(id_, 'October report: 1 bill, 10000', rep.totalSales === 1 && rep.totalRevenue === 10000, rep);
      // The report checks after each scenario cover October; the November bill goes again.
      await call(k.one, 'DELETE', { id: String(store[k.bills].find(b => b.invoice_date === next).id) });
    });
  }
  test.skip('S8.10 two users editing one bill at once - needs a real database', () => {});
  test.skip('S8.6 very long product names - names come from the product master (products phase)', () => {});
});

describe('Scenarios - batch 9: data integrity (each assertion catches its break)', () => {
  const k = K.sale, v = K.purchase;
  const undoable = (row, key, val) => { const old = row[key]; row[key] = val; return () => { row[key] = old; }; };
  sc('S9.1', 'payment status matches allocations (A3, A8)', async () => {
    const { id } = await create(k); const { id: pid } = await create(v);
    await pay(k, 4000, [[k, id, 4000]]); await pay(v, 4000, [[v, pid, 4000]]);
    for (const [kind, bid, a] of [[k, id, 'A8'], [v, pid, 'A3']]) {
      const undo = undoable(bill(kind, bid), 'payment_status', 1);
      ex('S9.1', `${a} catches a part-paid bill marked paid`, (await fails(a)).length > 0);
      undo();
    }
  });
  sc('S9.2', 'return status matches its lines (A9)', async () => {
    const { id } = await create(k); await ret(k, lines(k, id)[0], 2, 0);
    const undo = undoable(bill(k, id), 'return_status', 2);
    ex('S9.2', 'A9 catches a partly returned bill marked fully returned', (await fails('A9')).length > 0);
    undo();
  });
  sc('S9.3', 'ledger balances (A2, A7, A12)', async () => {
    const { id } = await create(k); const { id: pid } = await create(v);
    const c = rows(k)[0], vr = rows(v)[0];
    let undo = undoable(c, 'balance', 999); ex('S9.3', 'A7 catches a wrong stored customer balance', (await fails('A7')).length > 0); undo();
    undo = undoable(vr, 'balance', 999); ex('S9.3', 'A2 catches a wrong stored vendor balance', (await fails('A2')).length > 0); undo();
    undo = undoable(c, 'debit', 9000); ex('S9.3', 'A12 catches a bill posted short', (await fails('A12')).length > 0); undo();
  });
  sc('S9.4', 'no orphaned payment allocations (A6, A10)', async () => {
    const { id } = await create(k); const { id: pid } = await create(v);
    store.customer_payment_allocations.push({ id: 9001, payment_id: 4242, invoice_id: id, allocated_amount: 1 });
    ex('S9.4', 'A10 catches a sale allocation without its payment', (await fails('A10')).length > 0);
    store.customer_payment_allocations.pop();
    store.payment_allocations.push({ id: 9002, payment_id: 4242, purchase_id: 7777, allocated_amount: 1 });
    ex('S9.4', 'A6 catches a purchase allocation to a purchase that is gone', (await fails('A6')).length > 0);
    store.payment_allocations.pop();
  });
  sc('S9.5', 'no orphaned refund rows (A13)', async () => {
    await create(k);
    store.customer_ledger.push({ id: 9003, customer_id: 1, transaction_type: 'REFUND_PAID', reference_type: 'refund', reference_id: 4242, transaction_id: 4242, debit: 0, credit: 0, balance: 10000 });
    ex('S9.5', 'A13 catches a refund row whose refund is gone', (await fails('A13')).length > 0);
    store.customer_ledger.pop();
  });
  sc('S9.6', 'stock matches its history (A1)', async () => {
    await create(k);
    const p = store.product[0], undo = undoable(p, 'stock', p.stock + 1);
    ex('S9.6', 'A1 catches a stock figure that does not follow the bills', (await fails('A1')).length > 0);
    undo();
  });
  sc('S9.7', 'financial year consistency (A5, A6)', async () => {
    const { id } = await create(v); await create(v);
    const b2 = store.purchase[1], undo = undoable(b2, 'invoice_no', store.purchase[0].invoice_no);
    ex('S9.7', 'A5 catches two purchases with one number in a year', (await fails('A5')).length > 0);
    undo();
    const line = store.purchaseitems[0], undo2 = undoable(line, 'fy', 9);
    ex('S9.7', 'A6 catches a line whose year drifted from its bill', (await fails('A6')).length > 0);
    undo2();
  });
  sc('S9.8', 'the full report: every assertion examines something and passes', async () => {
    const { id } = await create(k, { status: 1, mode: 0 }); const { id: pid } = await create(v); await pay(v, 1000, [[v, pid, 1000]]);
    await ret(k, lines(k, id)[0], 1, 1); await ret(v, lines(v, pid)[0], 1, 0);
    await call(H.deadCreate, 'POST', {}, { product_id: 3, quantity: 1, reason: 'Rusted' });
    const all = await audit.run([], { quiet: true });
    ex('S9.8', 'A1-A14 all pass', all.every(a => a.failures.length === 0), all.filter(a => a.failures.length).map(a => [a.id, a.failures[0]]));
    ex('S9.8', 'none is empty (A14 needs balance logs: present)', all.filter(a => a.checked === 0).length === 0, all.filter(a => a.checked === 0).map(a => a.id));
  });
});
