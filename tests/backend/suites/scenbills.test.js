// SALES_COMPREHENSIVE_TEST_SCENARIOS batches 1-3 (create, edit, payments), each for sale,
// Invoice C and purchase; the purchase docs' create / edit / payment tests map onto these
// (P1-P16, C1-C14 - see SCENARIO_TESTS_PLAN). Numbers are the docs' own.
import { K, KINDS, store, call, sum, r2, N, rows, bal, billRows, billNet, payRows, allocs, paidOn, lines, bill, payments, stock, counters, create, edit, pay, D, sc, ex, snapshot, deep, out } from '../support/scenlib.js';

const tag = (k, n) => `${k.name === 'sale' ? 'S' : k.name === 'salex' ? 'X' : 'P'}${n}`;
const stockMove = (k, q) => 1000 + k.stockSign * q;

describe('Scenarios - batches 1-3: create, edit, payments (sale, Invoice C, purchase)', () => {
  for (const k of KINDS) {
    const T = k.taxed ? 18 : 0;
    const taxedTotal = k.taxed ? 11800 : 10000;
    // ---------------- Batch 1: create
    sc(tag(k, '1.1'), 'create unpaid, no tax', async () => {
      const { r, id } = await create(k);
      const b = bill(k, id), id_ = tag(k, '1.1');
      ex(id_, '201', r.status === 201, r.body);
      ex(id_, 'bill unpaid, total 10000', b?.payment_status === 0 && b.total === 10000, b);
      ex(id_, 'one line 10 x 1000 = 10000', lines(k, id).length === 1 && lines(k, id)[0].qty === 10 && lines(k, id)[0].rate === 1000 && lines(k, id)[0].subtotal === 10000, lines(k, id));
      ex(id_, 'billing snapshot row', store[k.snap].length === 1, store[k.snap]);
      ex(id_, `stock ${k.stockSign < 0 ? '-' : '+'}10`, stock(1) === stockMove(k, 10), stock(1));
      ex(id_, `ledger: one ${k.billType} row, debit 10000, balance 10000`, billRows(k, id).length === 1 && billRows(k, id)[0].debit === 10000 && billRows(k, id)[0].credit === 0 && bal(k) === 10000, rows(k));
      ex(id_, 'no payment, no allocation', payments(k).length === 0 && allocs(k, id).length === 0);
    });
    sc(tag(k, '1.2'), 'create unpaid, 18% (intra-state) and inter-state', async () => {
      const id_ = tag(k, '1.2');
      const { id } = await create(k, { items: [[1, 10, 1000, 18]] });
      const b = bill(k, id);
      if (k.taxed) {
        ex(id_, 'total 11800, tax 1800 = CGST 900 + SGST 900', b.total === 11800 && b.total_tax === 1800 && b.total_cgst === 900 && b.total_sgst === 900 && !N(b.total_igst), b);
        ex(id_, 'line tax 1800 (900 / 900)', N(lines(k, id)[0].tax) === 1800 && N(lines(k, id)[0].cgst) === 900, lines(k, id)[0]);
        const { id: id2 } = await create(k, { items: [[1, 10, 1000, 18]], partyId: 2 });
        const b2 = bill(k, id2);
        ex(id_, 'inter-state party: IGST 1800', b2.total === 11800 && b2.total_igst === 1800 && !N(b2.total_cgst), b2);
        ex(id_, 'ledger debit 11800', billNet(k, id) === 11800 && bal(k) === 11800, rows(k));
      } else {
        ex(id_, 'Invoice C carries no GST: total 10000, tax 0', b.total === 10000 && !N(b.total_tax), b);
      }
    });
    for (const [n, mode, gst] of [['1.3', 0, 0], ['1.4', 0, 18], ['1.5', 1, 0], ['1.6', 1, 18]]) {
      sc(tag(k, n), `create paid, ${mode ? 'bank' : 'cash'}, ${gst}%`, async () => {
        const id_ = tag(k, n), total = gst && k.taxed ? 11800 : 10000;
        const { r, id } = await create(k, { items: [[1, 10, 1000, gst]], status: 1, mode });
        const b = bill(k, id);
        ex(id_, `bill paid, mode ${mode}, total ${total}`, r.status === 201 && b.payment_status === 1 && b.payment_mode === mode && b.total === total, b);
        const p = payments(k);
        ex(id_, `one payment ${total}, mode ${mode}, bill specific, allocated in full`, p.length === 1 && N(p[0].payment_amount) === total && p[0].payment_mode === mode && p[0].payment_type === 'BILL_SPECIFIC' && paidOn(k, id) === total, { p, a: allocs(k, id) });
        const pr = payRows(k);
        ex(id_, `ledger: bill debit ${total}, payment credit ${total} (mode ${mode}), balance 0`, billNet(k, id) === total && pr.length === 1 && pr[0].credit === total && pr[0].payment_mode === mode && bal(k) === 0, rows(k));
        ex(id_, `counters: paid ${total}, allocated ${total}`, counters(k).paid === total && counters(k).alloc === total, counters(k));
      });
    }
    sc(tag(k, '1.7'), 'create with three items', async () => {
      const id_ = tag(k, '1.7');
      const { id } = await create(k, { items: [[1, 5, 1000, 18], [4, 10, 500, 12], [3, 2, 2000, 0]] });
      const want = k.taxed ? 15500 : 14000;
      ex(id_, `total ${want} (5900 + 5600 + 4000${k.taxed ? '' : ', no GST on Invoice C'})`, bill(k, id).total === want, bill(k, id));
      ex(id_, 'three lines', lines(k, id).length === 3);
      ex(id_, 'each product moved by its qty', stock(1) === stockMove(k, 5) && stock(4) === stockMove(k, 10) && stock(3) === stockMove(k, 2), [stock(1), stock(4), stock(3)]);
      ex(id_, `ledger debit ${want}`, billNet(k, id) === want);
    });
    sc(tag(k, '1.8'), 'create with freight 500', async () => {
      const id_ = tag(k, '1.8');
      const { id } = await create(k, { freight: 500 });
      ex(id_, 'total 10500, freight 500', bill(k, id).total === 10500 && bill(k, id).freight === 500, bill(k, id));
      ex(id_, 'ledger debit 10500', billNet(k, id) === 10500);
    });
    if (k.transport) sc(tag(k, '1.9'), 'create with transport details', async () => {
      const id_ = tag(k, '1.9');
      const { id } = await create(k, { extra: { transportDetails: { trans_mode: 'Test Transport', vehicle_no: 'UP 12 AB 1234' } } });
      const t = store[k.transport].find(x => x.invoice_id === id);
      ex(id_, 'transport row: Test Transport / UP 12 AB 1234', t?.trans_mode === 'Test Transport' && t?.vehicle_no === 'UP 12 AB 1234', store[k.transport]);
      ex(id_, 'total 10000, ledger debit 10000', bill(k, id).total === 10000 && billNet(k, id) === 10000);
    });
    sc(tag(k, '1.10'), 'create for "Other"', async () => {
      const id_ = tag(k, '1.10');
      const extra = k.name === 'purchase' ? { vendor_name: 'Walk-in Supplier', contact_number: '9999999999' } : { customer_name: 'Walk-in Customer', contact_number: '9999999999', state: 'Uttar Pradesh', state_code: 9 };
      const { r, id } = await create(k, { partyId: 0, extra });
      ex(id_, '201', r.status === 201, r.body);
      ex(id_, `${k.partyField} = 0`, bill(k, id)?.[k.partyField] === 0, bill(k, id));
      const s = store[k.snap][0];
      if (k.name === 'purchase') {
        ex(id_, 'snapshot keeps the supplier name and phone', s?.vendor_name === 'Walk-in Supplier' && s?.contact_no === '9999999999', s);
        ex(id_, '"Other" vendor is a real vendor row: PURCHASE posts to vendor 0 (agreed)', billNet(k, id) === 10000 && bal(k, 0) === 10000, rows(k, 0));
      } else {
        ex(id_, 'snapshot: Walk-in Customer / 9999999999 / Uttar Pradesh', s?.billing_name === 'Walk-in Customer' && s?.contact_no === '9999999999' && s?.billing_state === 'Uttar Pradesh', s);
        ex(id_, 'walk-in posts nothing to the ledger (agreed; the doc expected a row)', store[k.ledger].length === 0, store[k.ledger]);
      }
    });

    // ---------------- Batch 2: edit
    sc(tag(k, '2.1'), 'edit unpaid, no change', async () => {
      const id_ = tag(k, '2.1');
      const { id } = await create(k);
      const before = JSON.stringify([bill(k, id).total, store[k.ledger], stock(1)]);
      const r = await edit(k, id, { items: [[1, 10, 1000, 0]], status: 0 });
      ex(id_, 'saved; total, ledger rows and stock unchanged', r.status === 200 && JSON.stringify([bill(k, id).total, store[k.ledger], stock(1)]) === before, { r: r.body, l: store[k.ledger] });
    });
    for (const [n, q, word] of [['2.2', 15, 'increase'], ['2.3', 7, 'decrease']]) {
      sc(tag(k, n), `edit unpaid, amount ${word} (qty 10 -> ${q})`, async () => {
        const id_ = tag(k, n);
        const { id } = await create(k);
        const r = await edit(k, id, { items: [[1, q, 1000, 0]] });
        ex(id_, `total ${q * 1000}, line qty ${q}`, r.status === 200 && bill(k, id).total === q * 1000 && lines(k, id)[0].qty === q, { r: r.body, b: bill(k, id) });
        ex(id_, `stock moved by ${q} in all`, stock(1) === stockMove(k, q), stock(1));
        ex(id_, `ledger: bill nets ${q * 1000}, balance ${q * 1000} (row updated in place; doc expected an adjustment row)`, billNet(k, id) === q * 1000 && bal(k) === q * 1000, rows(k));
      });
    }
    sc(tag(k, '2.4'), 'edit unpaid -> paid (cash)', async () => {
      const id_ = tag(k, '2.4');
      const { id } = await create(k);
      const r = await edit(k, id, { status: 1, mode: 0 });
      ex(id_, 'bill paid, mode 0', r.status === 200 && bill(k, id).payment_status === 1 && bill(k, id).payment_mode === 0, bill(k, id));
      ex(id_, 'payment 10000 allocated to it', paidOn(k, id) === 10000 && payments(k).length === 1, store[k.payTable]);
      ex(id_, 'ledger: payment credit 10000, balance 0', sum(payRows(k), l => l.credit - l.debit) === 10000 && bal(k) === 0, rows(k));
    });
    sc(tag(k, '2.5'), 'edit unpaid -> paid (bank) with qty 10 -> 12', async () => {
      const id_ = tag(k, '2.5');
      const { id } = await create(k);
      const r = await edit(k, id, { items: [[1, 12, 1000, 0]], status: 1, mode: 1 });
      ex(id_, 'total 12000, paid, mode 1', r.status === 200 && bill(k, id).total === 12000 && bill(k, id).payment_status === 1 && bill(k, id).payment_mode === 1, bill(k, id));
      ex(id_, 'paid 12000, ledger balance 0', paidOn(k, id) === 12000 && billNet(k, id) === 12000 && bal(k) === 0, { a: allocs(k, id), l: rows(k) });
    });
    sc(tag(k, '2.6'), 'edit paid, no change', async () => {
      const id_ = tag(k, '2.6');
      const { id } = await create(k, { status: 1, mode: 0 });
      const before = snapshot() + JSON.stringify(store[k.ledger].map(l => [l.debit, l.credit]));
      const r = await edit(k, id, { items: [[1, 10, 1000, 0]], status: 1, mode: 0 });
      ex(id_, 'saved; no new rows anywhere, ledger amounts unchanged', r.status === 200 && snapshot() + JSON.stringify(store[k.ledger].map(l => [l.debit, l.credit])) === before, r.body);
    });
    sc(tag(k, '2.7'), 'edit paid, qty 10 -> 12 (case 5: paid -> partial)', async () => {
      const id_ = tag(k, '2.7');
      const { id } = await create(k, { status: 1, mode: 0 });
      const r = await edit(k, id, { items: [[1, 12, 1000, 0]], status: 1, mode: 0 });
      // Doc: an automatic 2000 payment keeps it paid. Today: no money is invented - the bill
      // becomes part paid with 2000 to collect (sale-edit / purchase-edit finalStatus).
      ex(id_, 'total 12000, part paid (2); doc expected an automatic top-up', r.status === 200 && bill(k, id).total === 12000 && bill(k, id).payment_status === 2, bill(k, id));
      ex(id_, 'paid 10000 on it, 2000 owed in the ledger', paidOn(k, id) === 10000 && bal(k) === 2000, { a: allocs(k, id), l: rows(k) });
      ex(id_, 'counters unchanged: paid 10000, allocated 10000', counters(k).paid === 10000 && counters(k).alloc === 10000, counters(k));
    });
    sc(tag(k, '2.8'), 'edit paid, qty 10 -> 8, stays paid', async () => {
      const id_ = tag(k, '2.8');
      const { id } = await create(k, { status: 1, mode: 0 });
      const r = await edit(k, id, { items: [[1, 8, 1000, 0]], status: 1, mode: 0 });
      ex(id_, 'total 8000, still paid', r.status === 200 && bill(k, id).total === 8000 && bill(k, id).payment_status === 1, bill(k, id));
      ex(id_, 'allocation no more than the bill (8000)', paidOn(k, id) <= 8000, allocs(k, id));
      ex(id_, 'payment, counters and ledger tell one story', (N(payments(k)[0]?.payment_amount) === 8000 && counters(k).paid === 8000 && bal(k) === 0)
        || (N(payments(k)[0]?.payment_amount) === 10000 && counters(k).paid === 10000 && counters(k).alloc === 8000 && bal(k) === -2000),
        { pay: payments(k).map(p => p.payment_amount), c: counters(k), bal: bal(k) });
    }, { open: 'F-S1 paid bill lowered: allocation above the bill', known: [] });
    // ---- The partial cases (COMPLETE_SYSTEM_OPERATIONS_ANALYSIS cases 6-9): 10000 bill, 4000 paid
    const partBill = async () => { const { id } = await create(k); await pay(k, 4000, [[k, id, 4000]], { mode: 0 }); return id; };
    sc(tag(k, '2.13'), 'case 6: partial -> paid by an edit', async () => {
      const id_ = tag(k, '2.13');
      const id = await partBill();
      const r = await edit(k, id, { status: 1, mode: 1 });
      // Doc: a payment for the remaining 6000 is made. Today the edit keeps the bill part paid
      // (sale-edit / purchase-edit finalStatus: Paid only when what is allocated covers it);
      // the rest is paid on the payments screen.
      ex(id_, 'saved; still part paid, 4000 on it, 6000 owed (doc expected an automatic 6000 payment)', r.status === 200 && bill(k, id).payment_status === 2 && paidOn(k, id) === 4000 && bal(k) === 6000, { r: r.body, b: bill(k, id), a: allocs(k, id), l: rows(k) });
      ex(id_, 'counters unchanged: paid 4000, allocated 4000', counters(k).paid === 4000 && counters(k).alloc === 4000, counters(k));
    });
    sc(tag(k, '2.14'), 'case 7: partial -> unpaid', async () => {
      const id_ = tag(k, '2.14');
      const id = await partBill();
      const r = await edit(k, id, { status: 0 });
      ex(id_, 'unpaid; nothing allocated to it', r.status === 200 && bill(k, id).payment_status === 0 && paidOn(k, id) === 0, { r: r.body, b: bill(k, id), a: allocs(k, id) });
      ex(id_, 'the 4000 received stays on the account as advance: ledger 6000, counters paid 4000 / allocated 0',
        bal(k) === 6000 && counters(k).paid === 4000 && counters(k).alloc === 0, { l: rows(k), c: counters(k), p: payments(k) });
    }, { open: 'F-S2 unmarking a bill paid on the payments screen' });
    for (const [n, q, left, status] of [['2.15', 12, 8000, 2], ['2.16', 8, 4000, 2]]) {
      sc(tag(k, n), `case ${n === '2.15' ? 8 : 9}: partial, qty 10 -> ${q}`, async () => {
        const id_ = tag(k, n);
        const id = await partBill();
        const r = await edit(k, id, { items: [[1, q, 1000, 0]] });
        ex(id_, `total ${q * 1000}, still part paid, 4000 on it, ${left} owed`, r.status === 200 && bill(k, id).total === q * 1000 && bill(k, id).payment_status === status && paidOn(k, id) === 4000 && bal(k) === left, { r: r.body, b: bill(k, id), l: rows(k) });
        ex(id_, 'counters: paid 4000, allocated 4000', counters(k).paid === 4000 && counters(k).alloc === 4000, counters(k));
      });
    }
    sc(tag(k, '2.18'), 'paid by one payment with another bill; this one unmarked', async () => {
      const id_ = tag(k, '2.18');
      const a = (await create(k)).id, b = (await create(k)).id;
      await pay(k, 20000, [[k, a, 10000], [k, b, 10000]], { mode: 1 });
      const r = await edit(k, a, { status: 0 });
      ex(id_, 'bill A unpaid, bill B still paid', r.status === 200 && bill(k, a).payment_status === 0 && bill(k, b).payment_status === 1, { r: r.body, a: bill(k, a), b: bill(k, b) });
    }, { open: 'F-S2 unmarking a bill paid on the payments screen' });
    sc(tag(k, '2.19'), 'paid on the payments screen, then unmarked', async () => {
      const id_ = tag(k, '2.19');
      const { id } = await create(k);
      await pay(k, 10000, [[k, id, 10000]], { mode: 1 });
      const r = await edit(k, id, { status: 0 });
      ex(id_, 'unpaid, balance 10000', r.status === 200 && bill(k, id).payment_status === 0 && bal(k) === 10000, { r: r.body, b: bill(k, id), l: rows(k) });
    }, k.party === 'customer' ? { open: 'F-S2 unmarking a bill paid on the payments screen' } : {});
    sc(tag(k, '2.17'), 'case 9b: partial, total lowered below what was paid (10000 -> 3000, 4000 paid)', async () => {
      const id_ = tag(k, '2.17');
      const id = await partBill();
      const r = await edit(k, id, { items: [[1, 3, 1000, 0]] });
      ex(id_, 'saved, total 3000, paid', r.status === 200 && bill(k, id).total === 3000 && bill(k, id).payment_status === 1, { r: r.body, b: bill(k, id) });
      ex(id_, 'allocation trimmed to 3000; the 1000 over stays as advance (L-31): ledger -1000, counters paid 4000 / allocated 3000',
        paidOn(k, id) === 3000 && bal(k) === -1000 && counters(k).paid === 4000 && counters(k).alloc === 3000, { a: allocs(k, id), l: rows(k), c: counters(k) });
    }, { open: 'F-S1 bill lowered below what was paid' });
    for (const [n, q] of [['2.9', 10], ['2.10', 15]]) {
      sc(tag(k, n), `edit paid -> unpaid${q !== 10 ? `, qty 10 -> ${q}` : ''}`, async () => {
        const id_ = tag(k, n);
        const { id } = await create(k, { status: 1, mode: 0 });
        const r = await edit(k, id, { items: [[1, q, 1000, 0]], status: 0 });
        ex(id_, `total ${q * 1000}, unpaid`, r.status === 200 && bill(k, id).total === q * 1000 && bill(k, id).payment_status === 0, bill(k, id));
        ex(id_, 'nothing paid on it, payment gone', paidOn(k, id) === 0 && payments(k).length === 0, { a: allocs(k, id), p: store[k.payTable] });
        ex(id_, `ledger balance ${q * 1000}`, bal(k) === q * 1000, rows(k));
        ex(id_, 'counters back to 0', counters(k).paid === 0 && counters(k).alloc === 0, counters(k));
      });
    }
    sc(tag(k, '2.11'), 'edit: add an item', async () => {
      const id_ = tag(k, '2.11');
      const { id } = await create(k);
      const r = await edit(k, id, { items: [[1, 10, 1000, 0], [3, 5, 200, 0]] });
      ex(id_, 'two lines, total 11000, both stocks moved', r.status === 200 && lines(k, id).length === 2 && bill(k, id).total === 11000 && stock(1) === stockMove(k, 10) && stock(3) === stockMove(k, 5), { b: bill(k, id), s: [stock(1), stock(3)] });
      ex(id_, 'ledger: bill nets 11000', billNet(k, id) === 11000);
    });
    sc(tag(k, '2.12'), 'edit: remove an item', async () => {
      const id_ = tag(k, '2.12');
      const { id } = await create(k, { items: [[1, 10, 1000, 0], [3, 5, 200, 0]] });
      const r = await edit(k, id, { items: [[1, 10, 1000, 0]] });
      ex(id_, 'one line, total 10000, removed item\'s stock restored', r.status === 200 && lines(k, id).length === 1 && bill(k, id).total === 10000 && stock(3) === 1000, { r: r.body, b: bill(k, id), s: stock(3) });
      ex(id_, 'ledger: bill nets 10000', billNet(k, id) === 10000);
    });

    // ---------------- Batch 3: payments (a 50000 bill = 50 x 1000)
    const big = (o = {}) => create(k, { items: [[1, 50, 1000, 0]], ...o });
    sc(tag(k, '3.1'), 'payment in full, bank', async () => {
      const id_ = tag(k, '3.1');
      const { id } = await big();
      const { r } = await pay(k, 50000, [[k, id, 50000]], { mode: 1 });
      const p = payments(k)[0];
      ex(id_, 'payment 50000, bank, bill specific (doc: INVOICE_SPECIFIC)', r.status === 201 && N(p?.payment_amount) === 50000 && p.payment_mode === 1 && p.payment_type === 'BILL_SPECIFIC', { r: r.body, p });
      ex(id_, 'one allocation 50000 to the bill; bill paid', allocs(k, id).length === 1 && paidOn(k, id) === 50000 && bill(k, id).payment_status === 1, allocs(k, id));
      ex(id_, 'ledger: payment credit 50000, balance 0', sum(payRows(k), l => l.credit) === 50000 && bal(k) === 0, rows(k));
    });
    sc(tag(k, '3.2'), 'part payment, cash', async () => {
      const id_ = tag(k, '3.2');
      const { id } = await big();
      await pay(k, 30000, [[k, id, 30000]], { mode: 0 });
      ex(id_, 'payment 30000 cash; bill part paid (2); balance 20000', N(payments(k)[0]?.payment_amount) === 30000 && payments(k)[0].payment_mode === 0 && bill(k, id).payment_status === 2 && bal(k) === 20000, { b: bill(k, id), l: rows(k) });
    });
    sc(tag(k, '3.3'), 'three part payments to paid', async () => {
      const id_ = tag(k, '3.3');
      const { id } = await big();
      const seen = [];
      for (const a of [20000, 15000, 15000]) { await pay(k, a, [[k, id, a]]); seen.push(bill(k, id).payment_status); }
      ex(id_, 'status 2, 2, 1', JSON.stringify(seen) === '[2,2,1]', seen);
      ex(id_, '3 payments, 3 allocations summing 50000', payments(k).length === 3 && allocs(k, id).length === 3 && paidOn(k, id) === 50000);
      ex(id_, 'ledger: 3 payment rows crediting 50000, balance 0', payRows(k).length === 3 && sum(payRows(k), l => l.credit) === 50000 && bal(k) === 0, rows(k));
    });
    for (const [n, totals, al, want] of [['3.4', [40, 40, 20], [40000, 40000, 20000], [1, 1, 1]], ['3.5', [40, 40, 40], [40000, 40000, 20000], [1, 1, 2]]]) {
      sc(tag(k, n), `one payment over three bills (${want.join('/')})`, async () => {
        const id_ = tag(k, n);
        const ids = [];
        for (const q of totals) ids.push((await create(k, { items: [[1, q, 1000, 0]] })).id);
        const { r } = await pay(k, 100000, ids.map((id, i) => [k, id, al[i]]));
        ex(id_, 'one payment 100000, three allocations', r.status === 201 && payments(k).length === 1 && store[k.allocTable].length === 3, r.body);
        ex(id_, `statuses ${want.join(', ')}`, JSON.stringify(ids.map(id => bill(k, id).payment_status)) === JSON.stringify(want), ids.map(id => bill(k, id)));
        ex(id_, `ledger credits 100000, balance ${sum(totals, q => q * 1000) - 100000} (${k.party === 'vendor' ? 'one row per bill' : 'one row for the payment; doc expected one per bill'})`,
          sum(payRows(k), l => l.credit) === 100000 && bal(k) === sum(totals, q => q * 1000) - 100000 && payRows(k).length === (k.party === 'vendor' ? 3 : 1), payRows(k));
        if (n === '3.5') ex(id_, 'bill 3: 20000 still to pay (list API)', deep((await call(k.list, 'GET', { [k.listParam]: '1', limit: '1000', sortOrder: 'asc' })).body, 'data')?.find(b => b.id === ids[2])?.remaining_amount === 20000);
      });
    }
    sc(tag(k, '3.6'), 'payments in different modes', async () => {
      const id_ = tag(k, '3.6');
      const { id } = await big();
      await pay(k, 30000, [[k, id, 30000]], { mode: 0 });
      await pay(k, 20000, [[k, id, 20000]], { mode: 1 });
      ex(id_, 'payments keep cash (0) and bank (1)', JSON.stringify(payments(k).map(p => p.payment_mode)) === '[0,1]', payments(k));
      ex(id_, 'ledger rows keep their modes', JSON.stringify(payRows(k).map(l => l.payment_mode)) === '[0,1]', payRows(k));
    });
    sc(tag(k, '3.7'), 'status from a 0.01 payment', async () => {
      const id_ = tag(k, '3.7');
      const { id } = await big();
      await pay(k, 0.01, [[k, id, 0.01]]);
      ex(id_, '0.01 of 50000 -> part paid (2), not paid', bill(k, id).payment_status === 2, bill(k, id));
    });
    sc(tag(k, '3.8'), 'payment history on the bill', async () => {
      const id_ = tag(k, '3.8');
      const { id } = await big();
      for (const a of [20000, 15000, 15000]) await pay(k, a, [[k, id, a]], { mode: a === 20000 ? 0 : 1 });
      const d = (await call(k.one, 'GET', { id: String(id) })).body;
      const h = deep(d, 'payment_history');
      ex(id_, 'detail: 3 payments, paid 50000, nothing left', Array.isArray(h) && h.length === 3 && N(deep(d, 'total_paid')) === 50000 && N(deep(d, 'remaining_amount')) === 0, { h, paid: deep(d, 'total_paid'), left: deep(d, 'remaining_amount') });
    });
    sc(tag(k, '3.9'), 'payment against another party\'s bill refused', async () => {
      const id_ = tag(k, '3.9');
      const { id } = await big();
      const before = snapshot();
      const { r } = await pay(k, 1000, [[k, id, 1000]], { partyId: 2 });
      ex(id_, 'refused (FOREIGN_BILL), nothing written', r.status === 400 && r.body?.error_code === 'FOREIGN_BILL' && snapshot() === before, r.body);
    });
    sc(tag(k, '3.10'), 'over-payment of a bill refused', async () => {
      const id_ = tag(k, '3.10');
      const { id } = await big();
      const before = snapshot();
      const { r } = await pay(k, 60000, [[k, id, 60000]]);
      ex(id_, 'refused (OVER_BILL), nothing written', r.status === 400 && r.body?.error_code === 'OVER_BILL' && snapshot() === before, r.body);
    });
    sc(tag(k, '3.11'), 'allocations above the payment refused', async () => {
      const id_ = tag(k, '3.11');
      const a = (await create(k, { items: [[1, 50, 1000, 0]] })).id, b = (await create(k, { items: [[1, 60, 1000, 0]] })).id;
      const before = snapshot();
      const { r } = await pay(k, 100000, [[k, a, 50000], [k, b, 60000]]);
      ex(id_, 'refused (OVER_ALLOCATED), nothing written', r.status === 400 && r.body?.error_code === 'OVER_ALLOCATED' && snapshot() === before, r.body);
    });
    sc(tag(k, '3.12'), 'payment notes kept', async () => {
      const id_ = tag(k, '3.12');
      const { id } = await big();
      await pay(k, 10000, [[k, id, 10000]], { notes: 'Partial payment via bank transfer' });
      ex(id_, 'notes on the payment', payments(k)[0]?.notes === 'Partial payment via bank transfer', payments(k)[0]);
    });
    sc(tag(k, '3.13'), 'outstanding bills list', async () => {
      const id_ = tag(k, '3.13');
      const paid = (await create(k, { items: [[1, 10, 1000, 0]], status: 1, mode: 0 })).id;
      const part = (await create(k, { items: [[1, 20, 1000, 0]] })).id;
      const open = (await create(k, { items: [[1, 30, 1000, 0]] })).id;
      await pay(k, 5000, [[k, part, 5000]]);
      const list = deep((await call(k.list, 'GET', { [k.listParam]: '1', limit: '1000', sortOrder: 'asc' })).body, 'data') || [];
      const outstanding = list.filter(b => N(b.remaining_amount) > 0);
      ex(id_, 'open bills: the part paid (15000 left) and the unpaid (30000); the paid one left out',
        outstanding.length === 2 && outstanding.find(b => b.id === part)?.remaining_amount === 15000 && outstanding.find(b => b.id === open)?.remaining_amount === 30000 && !outstanding.some(b => b.id === paid), list.map(b => [b.id, b.remaining_amount]));
    });
    sc(tag(k, '3.14'), 'open bills come oldest first (what Auto Allocate walks)', async () => {
      const id_ = tag(k, '3.14');
      const late = (await create(k, { date: D(9) })).id, early = (await create(k, { date: D(2) })).id, mid = (await create(k, { date: D(5) })).id;
      const list = deep((await call(k.list, 'GET', { [k.listParam]: '1', limit: '1000', sortOrder: 'asc' })).body, 'data') || [];
      ex(id_, 'oldest, middle, newest', JSON.stringify(list.map(b => b.id)) === JSON.stringify([early, mid, late]), list.map(b => [b.id, b.invoice_date]));
       }, { known: k.party === 'vendor' ? ['A2'] : [] }); // F-02 (open): the vendor ledger's stored balance runs in entry order
    sc(tag(k, '3.15'), 'delete a payment', async () => {
      const id_ = tag(k, '3.15');
      const { id } = await big();
      const { id: pid } = await pay(k, 50000, [[k, id, 50000]]);
      const r = await call(k.payOne, 'DELETE', { id: String(pid) });
      ex(id_, 'deleted; bill unpaid again; balance 50000', r.status === 200 && bill(k, id).payment_status === 0 && bal(k) === 50000, { r: r.body, b: bill(k, id), l: rows(k) });
      ex(id_, 'payment, allocation and ledger row removed (doc expected reversal records)', payments(k).length === 0 && allocs(k, id).length === 0 && payRows(k).length === 0);
      ex(id_, 'counters back to 0', counters(k).paid === 0 && counters(k).alloc === 0, counters(k));
    });
  }
});
