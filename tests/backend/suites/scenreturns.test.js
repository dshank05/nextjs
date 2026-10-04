// SALES_COMPREHENSIVE_TEST_SCENARIOS batches 4-6 (return create, return edit, refunds) for sale,
// Invoice C and purchase; PAYMENT_ALLOCATION_TEST_SCENARIOS P17-P28 and COMPLETE_TEST_SCENARIOS
// C15-C22 map onto these (see SCENARIO_TESTS_PLAN). A refunded return is a direct adjustment (owner).
import { K, KINDS, store, call, sum, r2, N, H, rows, bal, lines, bill, stock, counters, create, D, sc, ex, snapshot, deep, out } from '../support/scenlib.js';

const R = {
  sale: { rets: 'sale_returns', items: 'sale_return_items', retFk: 'sale_return_id', lineFk: 'invoice_item_id', billFk: 'invoice_id', invType: 'invoice', note: 'CREDIT_NOTE', ref: 'sale_return', stockSign: 1, create: H.srCreate, one: H.srOne, party: 'customer' },
  salex: { rets: 'salex_returns', items: 'salex_return_items', retFk: 'salex_return_id', lineFk: 'invoice_itemx_id', billFk: 'invoicex_id', invType: 'invoicex', note: 'CREDIT_NOTE', ref: 'salex_return', stockSign: 1, create: H.srCreate, one: H.srOne, party: 'customer' },
  purchase: { rets: 'purchase_returns', items: 'purchase_return_items', retFk: 'purchase_return_id', lineFk: 'purchase_item_id', billFk: null, invType: null, note: 'DEBIT_NOTE', ref: 'purchase_return', stockSign: -1, create: H.prCreate, one: H.prOne, party: 'vendor' }
};
const tag = (k, n) => `${k.name === 'sale' ? 'S' : k.name === 'salex' ? 'X' : 'P'}${n}`;
const retLine = (k, line, qty, extra = {}) => k.name === 'purchase' ? { purchase_item_id: line.id, return_qty: qty, return_reason_id: 1, ...extra } : { invoice_item_id: line.id, invoice_type: R[k.name].invType, return_qty: qty, return_reason_id: 1, ...extra };
async function ret(k, lineQtys, { status = 0, mode = 1, date = D(4), extra = {} } = {}) {
  const r = R[k.name];
  const body = { [k.who]: 1, return_date: date, payment_status: status, payment_mode: mode, items: lineQtys.map(([l, q, e]) => retLine(k, l, q, e)), ...extra };
  const res = await call(r.create, 'POST', {}, body);
  const made = store[r.rets].at(-1);
  return { res, id: made?.id };
}
const retEdit = (k, id, lineQtys, extra = {}) => call(R[k.name].one, 'PUT', { id: String(id), ...(k.name !== 'purchase' ? { type: R[k.name].invType } : {}) }, { items: lineQtys.map(([l, q, e]) => retLine(k, l, q, e)), ...extra });
const retDelete = (k, id) => call(R[k.name].one, 'DELETE', { id: String(id), ...(k.name !== 'purchase' ? { type: R[k.name].invType } : {}) });
const theRet = (k, id) => store[R[k.name].rets].find(x => x.id === id);
const retItems = (k, id) => store[R[k.name].items].filter(x => x[R[k.name].retFk] === id);
const noteRows = (k, id) => store[k.ledger].filter(l => l.reference_type === R[k.name].ref && l.reference_id === id);
const refundCreate = (k) => k.party === 'vendor' ? H.vrCreate : H.crCreate;
const refundOne = (k) => k.party === 'vendor' ? H.vrOne : H.crOne;
const refundTable = (k) => k.party === 'vendor' ? 'vendor_refunds' : 'customer_refunds';
const stockAfter = (k, sold, back) => 1000 + k.stockSign * sold + R[k.name].stockSign * back;

describe('Scenarios - batches 4-6: returns and refunds (sale, Invoice C, purchase)', () => {
  for (const k of KINDS) {
    const T = k.taxed ? 18 : 0;
    const base = async (o = {}) => { const { id } = await create(k, { items: [[1, 10, 1000, o.tax ?? 0], ...(o.second ? [[3, 5, 200, 0]] : [])] }); return { id, l: lines(k, id) }; };
    // ---------------- Batch 4: return create
    sc(tag(k, '4.1'), 'pending return, no tax (doc: C15 / P17)', async () => {
      const id_ = tag(k, '4.1');
      const { id, l } = await base();
      const { res, id: rid } = await ret(k, [[l[0], 2]]);
      const rr = theRet(k, rid);
      ex(id_, '201; return 2000, pending', res.status === 201 && N(rr?.total_amount) === 2000 && N(rr.refund_amount) === 2000 && rr.payment_status === 0, { res: res.body, rr });
      ex(id_, 'bill partly returned (1)', bill(k, id).return_status === 1, bill(k, id));
      ex(id_, `stock: ${k.stockSign < 0 ? 'bought 10, 2 sent back' : 'sold 10, 2 back'}`, stock(1) === stockAfter(k, 10, 2), stock(1));
      ex(id_, `pending return posts nothing (agreed; doc expected a ${R[k.name].note})`, noteRows(k, rid).length === 0 && bal(k) === 10000, rows(k));
      ex(id_, 'counters untouched', counters(k).refunded === 0 && counters(k).refAlloc === 0, counters(k));
    });
    sc(tag(k, '4.2'), 'pending return, 18% (C16 / P18)', async () => {
      const id_ = tag(k, '4.2');
      const { l } = await base({ tax: 18 });
      const { id: rid } = await ret(k, [[l[0], 5]]);
      const rr = theRet(k, rid);
      ex(id_, k.taxed ? 'return 5000 + 900 tax = 5900' : 'Invoice C: 5000, no tax', k.taxed ? (N(rr.total_amount) === 5000 && N(rr.total_tax) === 900 && N(rr.refund_amount) === 5900) : (N(rr.refund_amount) === 5000 && !N(rr.total_tax)), rr);
      ex(id_, 'line tax kept', !k.taxed || N(retItems(k, rid)[0]?.tax_amount) === 900, retItems(k, rid));
    });
    for (const [n, mode, tax] of [['4.3', 0, 0], ['4.3t', 0, 18], ['4.4', 1, 0], ['4.4t', 1, 18]]) {
      sc(tag(k, n), `refunded return, ${mode ? 'bank' : 'cash'}, ${tax}% (C17-C20)`, async () => {
        const id_ = tag(k, n);
        const { l } = await base({ tax });
        const { res, id: rid } = await ret(k, [[l[0], 5]], { status: 1, mode });
        const want = tax && k.taxed ? 5900 : 5000, total = tax && k.taxed ? 11800 : 10000;
        const rr = theRet(k, rid);
        ex(id_, `201; refunded ${want}, mode ${mode}`, res.status === 201 && rr?.payment_status === 1 && N(rr.refund_amount) === want && rr.payment_mode === mode, { res: res.body, rr });
        const nr = noteRows(k, rid), note = nr.filter(x => x.transaction_type === R[k.name].note);
        ex(id_, `${R[k.name].note} for ${want}`, note.length === 1 && N(note[0].credit) === want, nr);
        if (k.party === 'customer') ex(id_, `with its REFUND row ${want}: balance stays ${total} (created refunded)`, nr.some(x => x.transaction_type === 'REFUND' && N(x.debit) === want) && bal(k) === total, rows(k));
        else ex(id_, `direct adjustment: we owe ${total - want}`, bal(k) === total - want, rows(k));
        ex(id_, `counters: refunded ${want}, refund allocated ${want}`, counters(k).refunded === want && counters(k).refAlloc === want, counters(k));
      });
    }
    sc(tag(k, '4.5'), 'part return of a two-item bill', async () => {
      const id_ = tag(k, '4.5');
      const { id, l } = await base({ second: true });
      await ret(k, [[l[1], 5]]);
      ex(id_, 'bill partly returned (1)', bill(k, id).return_status === 1, bill(k, id));
    });
    sc(tag(k, '4.6'), 'full return of every item', async () => {
      const id_ = tag(k, '4.6');
      const { id, l } = await base({ second: true });
      await ret(k, [[l[0], 10], [l[1], 5]]);
      ex(id_, 'bill fully returned (2); stock back where it started', bill(k, id).return_status === 2 && stock(1) === 1000 && stock(3) === 1000, { b: bill(k, id), s: [stock(1), stock(3)] });
    });
    sc(tag(k, '4.7'), 'over-return refused', async () => {
      const id_ = tag(k, '4.7');
      const { l } = await base();
      const before = snapshot();
      const { res } = await ret(k, [[l[0], 11]]);
      ex(id_, 'refused (OVER_RETURN), nothing written', res.status === 400 && res.body?.error_code === 'OVER_RETURN' && snapshot() === before, res.body);
    });
    sc(tag(k, '4.8'), 'several returns from one bill', async () => {
      const id_ = tag(k, '4.8');
      const { id, l } = await base();
      const a = await ret(k, [[l[0], 3]]), b = await ret(k, [[l[0], 4]]);
      const c = await ret(k, [[l[0], 4]]);
      ex(id_, '3 then 4 accepted; 4 more refused (3 left)', a.res.status === 201 && b.res.status === 201 && c.res.status === 400 && c.res.body?.error_code === 'OVER_RETURN', [a.res.status, b.res.status, c.res.body]);
      ex(id_, 'bill partly returned; stock moved by 7', bill(k, id).return_status === 1 && stock(1) === stockAfter(k, 10, 7), [bill(k, id).return_status, stock(1)]);
    });
    sc(tag(k, '4.9'), 'note numbers', async () => {
      const id_ = tag(k, '4.9');
      const { l } = await base();
      const a = await ret(k, [[l[0], 1]]), b = await ret(k, [[l[0], 1]]);
      const no = (x) => x.res.body?.data?.return?.debit_note_no ?? x.res.body?.data?.returns?.[0]?.return_no;
      ex(id_, k.name === 'purchase' ? 'DN-4-001 then DN-4-002' : 'numbered by return (SR- / SXR-), distinct', k.name === 'purchase' ? (no(a) === 'DN-4-001' && no(b) === 'DN-4-002') : (no(a) && no(b) && no(a) !== no(b) && /^SX?R-/.test(no(a))), [no(a), no(b)]);
    });
    sc(tag(k, '4.10'), 'return reason kept on the line', async () => {
      const id_ = tag(k, '4.10');
      store.return_reasons.push({ id: 2, reason: 'Wrong part', status: 'Active' });
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 1, { return_reason_id: 2 }]]);
      ex(id_, 'reason 2 on the return line', retItems(k, rid)[0]?.return_reason_id === 2, retItems(k, rid));
    });

    // ---------------- Batch 5: return edit
    sc(tag(k, '5.1'), 'edit a pending return (P21 / C21)', async () => {
      const id_ = tag(k, '5.1');
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 5]]);
      const r = await retEdit(k, rid, [[l[0], 7]]);
      ex(id_, 'saved: 7000, stock follows, still nothing in the ledger', r.status === 200 && N(theRet(k, rid).refund_amount) === 7000 && stock(1) === stockAfter(k, 10, 7) && noteRows(k, rid).length === 0, { r: r.body, rr: theRet(k, rid) });
    });
    sc(tag(k, '5.2'), k.name === 'purchase' ? 'edit a refunded purchase return - allowed (owner, 29 Jan 2026)' : 'edit a refunded return is blocked (P22 / C22)', async () => {
      const id_ = tag(k, '5.2');
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 5]], { status: 1 });
      const before = snapshot() + JSON.stringify(store[k.ledger].map(x => [x.debit, x.credit])) + stock(1);
      const r = await retEdit(k, rid, [[l[0], 3]]);
      if (k.name === 'purchase') {
        // The block was added on 7 Dec 2025 and removed on 29 Jan 2026 (00ff93b); the return
        // screens say so ("purchase returns can be edited"). The note and counters follow.
        ex(id_, 'saved: 3000, debit note 3000, counters 3000, stock follows', r.status === 200 && N(theRet(k, rid).refund_amount) === 3000
          && noteRows(k, rid).filter(x => x.transaction_type === 'DEBIT_NOTE').reduce((a, x) => a + N(x.credit) - N(x.debit), 0) === 3000
          && counters(k).refunded === 3000 && counters(k).refAlloc === 3000 && stock(1) === stockAfter(k, 10, 3), { r: r.body, n: noteRows(k, rid), c: counters(k) });
      } else ex(id_, 'refused, nothing changed', r.status === 400 && snapshot() + JSON.stringify(store[k.ledger].map(x => [x.debit, x.credit])) + stock(1) === before, { r: r.body, rr: theRet(k, rid), notes: noteRows(k, rid) });
    });
    sc(tag(k, '5.3'), 'edit: add a line to a pending return', async () => {
      const id_ = tag(k, '5.3');
      const { l } = await base({ second: true });
      const { id: rid } = await ret(k, [[l[0], 2]]);
      const r = await retEdit(k, rid, [[l[0], 2], [l[1], 1]]);
      ex(id_, 'two lines, 2200', r.status === 200 && retItems(k, rid).length === 2 && N(theRet(k, rid).refund_amount) === 2200 && stock(3) === stockAfter(k, 5, 1), { r: r.body, i: retItems(k, rid) });
    });
    sc(tag(k, '5.4'), 'edit: remove a line from a pending return', async () => {
      const id_ = tag(k, '5.4');
      const { l } = await base({ second: true });
      const { id: rid } = await ret(k, [[l[0], 2], [l[1], 1]]);
      const r = await retEdit(k, rid, [[l[0], 2]]);
      ex(id_, 'one line, 2000, removed line\'s stock back', r.status === 200 && retItems(k, rid).length === 1 && N(theRet(k, rid).refund_amount) === 2000 && stock(3) === stockAfter(k, 5, 0), { r: r.body, i: retItems(k, rid), s: stock(3) });
    });
    sc(tag(k, '5.5'), 'a refund cannot go to a return (complete the return instead)', async () => {
      const id_ = tag(k, '5.5');
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 5]]);
      const before = snapshot();
      const a = k.party === 'vendor' ? { return_id: rid } : { [R[k.name].retFk]: rid };
      const r = await call(refundCreate(k), 'POST', {}, { [k.who]: 1, refund_amount: 5000, refund_mode: 0, refund_date: D(5), allocations: [{ ...a, allocated_amount: 5000 }] });
      ex(id_, 'refused (REFUND_VIA_RETURN), nothing written', r.status === 400 && r.body?.error_code === 'REFUND_VIA_RETURN' && snapshot() === before, r.body);
    });
    sc(tag(k, '5.6'), 'edit the reason on a pending return', async () => {
      const id_ = tag(k, '5.6');
      store.return_reasons.push({ id: 2, reason: 'Wrong part', status: 'Active' });
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 2]]);
      const r = await retEdit(k, rid, [[l[0], 2, { return_reason_id: 2 }]]);
      ex(id_, 'reason 2 saved', r.status === 200 && retItems(k, rid)[0]?.return_reason_id === 2, retItems(k, rid));
    });
    sc(tag(k, '5.7'), 'edit beyond what is left refused', async () => {
      const id_ = tag(k, '5.7');
      const { l } = await base();
      const { id: a } = await ret(k, [[l[0], 6]]);
      const { id: b } = await ret(k, [[l[0], 2]]);
      const before = snapshot() + stock(1);
      const r = await retEdit(k, b, [[l[0], 5]]);
      ex(id_, 'refused (OVER_RETURN), nothing changed', r.status === 400 && r.body?.error_code === 'OVER_RETURN' && snapshot() + stock(1) === before, r.body);
    });
    sc(tag(k, '5.8'), 'delete a pending return', async () => {
      const id_ = tag(k, '5.8');
      const { id, l } = await base();
      const { id: rid } = await ret(k, [[l[0], 2]]);
      const r = await retDelete(k, rid);
      ex(id_, 'deleted; stock and bill status back', r.status === 200 && !theRet(k, rid) && retItems(k, rid).length === 0 && stock(1) === stockAfter(k, 10, 0) && bill(k, id).return_status === 0, { r: r.body, s: stock(1), b: bill(k, id) });
    });
    sc(tag(k, '5.9'), 'delete a refunded return', async () => {
      const id_ = tag(k, '5.9');
      const { id, l } = await base();
      const { id: rid } = await ret(k, [[l[0], 2]], { status: 1 });
      const r = await retDelete(k, rid);
      ex(id_, 'deleted; its note rows gone; balance back to 10000; counters back to 0', r.status === 200 && noteRows(k, rid).length === 0 && bal(k) === 10000 && counters(k).refunded === 0 && counters(k).refAlloc === 0, { r: r.body, l: rows(k), c: counters(k) });
      ex(id_, 'stock and bill status back', stock(1) === stockAfter(k, 10, 0) && bill(k, id).return_status === 0, [stock(1), bill(k, id).return_status]);
    });
    sc(tag(k, '5.10'), 'pending -> refunded by an edit (direct adjustment)', async () => {
      const id_ = tag(k, '5.10');
      const { l } = await base();
      const { id: rid } = await ret(k, [[l[0], 2]]);
      const r = await retEdit(k, rid, [[l[0], 2]], { payment_status: 1, payment_mode: 0, ...(k.name !== 'purchase' ? { invoice_type: R[k.name].invType } : {}) });
      ex(id_, `refunded; ${R[k.name].note} 2000; balance 8000 (the note only, owner: direct adjustment)`, r.status === 200 && theRet(k, rid).payment_status === 1 && noteRows(k, rid).filter(x => x.transaction_type === R[k.name].note).length === 1 && bal(k) === 8000, { r: r.body, n: noteRows(k, rid), l: rows(k) });
    });

    // ---------------- Batch 6: refunds (on account; a return is refunded by completing it)
    sc(tag(k, '6.6'), 'on-account refunds in cash and bank, with notes (6.6, 6.11)', async () => {
      const id_ = tag(k, '6.6');
      await base();
      for (const [amt, mode] of [[300, 0], [200, 1]]) {
        const r = await call(refundCreate(k), 'POST', {}, { [k.who]: 1, refund_amount: amt, refund_mode: mode, refund_date: D(5), notes: `refund ${amt}`, allocations: [] });
        ex(id_, `${amt} by ${mode ? 'bank' : 'cash'}: 201, stored on account (DIRECT)`, r.status === 201, r.body);
      }
      const f = store[refundTable(k)];
      ex(id_, 'two refunds, modes 0 / 1, notes kept, DIRECT', f.length === 2 && JSON.stringify(f.map(x => x.refund_mode)) === '[0,1]' && f.every(x => x.refund_type === 'DIRECT') && f[0].notes === 'refund 300', f);
      const rr = rows(k).filter(x => String(x.transaction_type).startsWith('REFUND'));
      ex(id_, 'ledger: two refund rows debiting 500, modes kept', rr.length === 2 && sum(rr, x => N(x.debit)) === 500 && JSON.stringify(rr.map(x => x.payment_mode)) === '[0,1]', rr);
      ex(id_, 'counters: refunded 500', counters(k).refunded === 500, counters(k));
    });
    sc(tag(k, '6.9'), 'a refund of nothing refused', async () => {
      const id_ = tag(k, '6.9');
      await base();
      const before = snapshot();
      const r = await call(refundCreate(k), 'POST', {}, { [k.who]: 1, refund_amount: 0, refund_mode: 0, refund_date: D(5), allocations: [] });
      ex(id_, '400, nothing written', r.status === 400 && snapshot() === before, r.body);
    });
    sc(tag(k, '6.14'), 'edit then delete an on-account refund', async () => {
      const id_ = tag(k, '6.14');
      await base();
      await call(refundCreate(k), 'POST', {}, { [k.who]: 1, refund_amount: 300, refund_mode: 0, refund_date: D(5), allocations: [] });
      const fid = store[refundTable(k)][0].id;
      const e = await call(refundOne(k), 'PUT', { id: String(fid) }, { refund_amount: 250, refund_mode: 0, refund_date: D(5), refund_type: 'DIRECT', allocations: [] });
      ex(id_, 'edit 300 -> 250: refund, ledger and counters follow', e.status === 200 && N(store[refundTable(k)][0].refund_amount) === 250 && bal(k) === 10250 && counters(k).refunded === 250, { e: e.body, l: rows(k), c: counters(k) });
      const d = await call(refundOne(k), 'DELETE', { id: String(fid) });
      ex(id_, 'delete: refund and its row gone, balance 10000, counters 0', d.status === 200 && store[refundTable(k)].length === 0 && bal(k) === 10000 && counters(k).refunded === 0, { d: d.body, l: rows(k), c: counters(k) });
    });
    sc(tag(k, '6.12'), 'returns waiting for a refund (6.12 / P28)', async () => {
      const id_ = tag(k, '6.12');
      const { l } = await base();
      await ret(k, [[l[0], 1]]); await ret(k, [[l[0], 2]], { status: 1 }); await ret(k, [[l[0], 3]]);
      const kinds = k.name === 'sale' ? 'sale' : k.name === 'salex' ? 'salex' : 'purchase';
      const reg = (await call(H.returnsR, 'GET', { dateFrom: D(1), dateTo: '2026-10-31', page: '1', limit: '50', status: '0', kinds })).body;
      ex(id_, 'register, pending only: 2 returns, 4000 to refund', reg?.pagination?.total === 2 && N(reg?.totals?.refund) === 4000, reg?.totals ?? reg);
    });
  }
});
