// Reviewer D (returns and stock), docs/review/returns.md: CRUD round trips for sale, Invoice C and
// purchase returns and for dead stock, replaying the EXACT requests the real screens sent
// (fixtures/returns/*.json, captured by harness/review-d-capture.jsx). For each kind:
//   create -> read it as the edit form reads it (GET + hooks/useReturns normalizeDetail + the form's
//   payload) and check that is the captured request -> save unchanged -> NOTHING changes -> edit one
//   field -> only it and its consequences change -> delete -> everything rolled back.
// After every step: A1-A14 (checkAll), the 16 report checks (checkReports) and the connectedness
// checks below (stock, bill return status, ledger notes, lists, view, register, cash book).
import fs from 'fs';
import path from 'path';
import { store } from '../support/dbstub.js';
import { reset, call, H, checkAll, checkReports, stats, ok, N, sum, r2, RANGE } from '../support/flowlib.js';
import { seedStock } from '../support/scenlib.js';
import { normalizeDetail } from '../../../hooks/useReturns';
import saleList from '../../../pages/api/sale-returns/index';
import purList from '../../../pages/api/purchase-returns/index';

const FX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/returns', f), 'utf8'));
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(kk => [kk, v[kk]])) : v));
const ts = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 1000); };

// ---------------------------------------------------------------- the routes a captured request names
const ROUTES = [
  [/^\/api\/sale-returns\/customer-return$/, H.srCreate], [/^\/api\/sale-returns\/(\d+)$/, H.srOne],
  [/^\/api\/purchase-returns\/vendor-return$/, H.prCreate], [/^\/api\/purchase-returns\/(\d+)$/, H.prOne],
  [/^\/api\/deadstock$/, H.deadCreate], [/^\/api\/deadstock\/(\d+)$/, H.deadOne]
];
export async function send(step) {
  const u = new URL(step.url, 'http://x');
  const hit = ROUTES.find(([re]) => re.test(u.pathname));
  if (!hit) throw new Error(`no route for ${step.url}`);
  const m = u.pathname.match(hit[0]);
  const query = { ...Object.fromEntries(u.searchParams.entries()), ...(m[1] ? { id: m[1] } : {}) };
  return call(hit[1], step.method, query, clone(step.body ?? undefined));
}
const stepOf = (fx, name) => { const s = fx.steps.find(x => x.name === name); if (!s) throw new Error(`fixture step ${name} missing`); return s; };

// ---------------------------------------------------------------- the store the screens ran against
async function seed(fx) {
  reset(); seedStock(); stats.failures = [];
  store.return_reasons = fx.seed.reasons.map(r => ({ ...r }));
  const h = { sales: H.sales, salex: H.salex, purchases: H.purchases };
  for (const [k, b] of fx.seed.bills) {
    const r = await call(h[k], 'POST', {}, clone(b));
    ok(`seed: ${k} bill`, r.status === 201 || r.status === 200, r.body);
  }
  ok('seed: line ids as on the screen', canon([store.invoiceitems.map(l => l.id), store.invoice_itemsx.map(l => l.id), store.purchaseitems.map(l => l.id)]) === canon([fx.seed.ids.saleLines, fx.seed.ids.xLines, fx.seed.ids.pLines]), fx.seed.ids);
}

// ---------------------------------------------------------------- what changed between two states
const ITEM_KEY = { sale_return_items: r => `${r.sale_return_id}:${r.invoice_item_id}`, salex_return_items: r => `${r.salex_return_id}:${r.invoice_itemx_id}`, purchase_return_items: r => `${r.purchase_return_id}:${r.purchase_item_id}` };
const snap = () => clone(store);
/** "table.column" for each changed column, "+table" / "-table" for rows added / removed. Return lines are
 *  re-written on every save (new ids): they are matched by (return, bill line), their id ignored. */
export function diff(a, b) {
  const out = new Set();
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const A = a[t] || [], B = b[t] || [];
    if (!Array.isArray(A) || !Array.isArray(B)) continue;
    const key = ITEM_KEY[t] || ((r) => r.id);
    const am = new Map(A.map(r => [key(r), r])), bm = new Map(B.map(r => [key(r), r]));
    for (const k of bm.keys()) if (!am.has(k)) out.add(`+${t}`);
    for (const k of am.keys()) if (!bm.has(k)) out.add(`-${t}`);
    for (const [k, r] of bm) {
      const o = am.get(k); if (!o) continue;
      for (const c of new Set([...Object.keys(o), ...Object.keys(r)])) {
        if (c === 'updated_at' || c === 'created_at' || (ITEM_KEY[t] && c === 'id')) continue;
        if (canon(o[c]) !== canon(r[c])) out.add(`${t}.${c}`);
      }
    }
  }
  return [...out].sort();
}
const same = (got, want) => canon(got) === canon([...want].sort());

// ---------------------------------------------------------------- the edit form, as ReturnForm builds its PUT
/** ReturnForm.tsx confirm() for an edit, from what it loads (useReturnDetail -> normalizeDetail). */
export function formEditPayload(party, d) {
  const status = d.paymentStatus === 1 ? 1 : 0;
  const lines = d.bills.flatMap(b => b.lines.filter(l => l.returnQty > 0));
  const common = { return_date: d.date || undefined, return_notes: d.notes || '', payment_status: status, payment_mode: d.paymentMode ?? 1, payment_date: status === 1 && d.paymentDate ? d.paymentDate : undefined };
  return clone(party === 'customer'
    ? { ...common, invoice_type: d.type, items: lines.map(l => ({ invoice_item_id: l.lineId, invoice_type: l.type, return_qty: l.returnQty, return_reason_id: l.reasonId, unit_price: l.unitPrice, notes: l.notes })) }
    : { ...common, packing_forwarding_amount: Number(d.pf) || 0, items: lines.map(l => ({ purchase_item_id: l.lineId, return_qty: l.returnQty, return_reason_id: l.reasonId, unit_price: l.unitPrice, tax_rate: l.taxRate, notes: l.notes })) });
}
async function readAsForm(party, id, type) {
  const r = party === 'customer' ? await call(H.srOne, 'GET', { id: String(id), type }) : await call(H.prOne, 'GET', { id: String(id) });
  ok(`GET ${party} return ${id}`, r.status === 200, r.body);
  return normalizeDetail(party, r.body?.data || {});
}

// ---------------------------------------------------------------- connectedness, after every step
const KIND = {
  sale: { rets: 'sale_returns', items: 'sale_return_items', fk: 'sale_return_id', lineFk: 'invoice_item_id', lines: 'invoiceitems', bills: 'invoice', billFk: 'invoice_id', ledger: 'customer_ledger', ref: 'sale_return', note: 'CREDIT_NOTE', sign: 1, kind: 'sale', type: 'invoice' },
  salex: { rets: 'salex_returns', items: 'salex_return_items', fk: 'salex_return_id', lineFk: 'invoice_itemx_id', lines: 'invoice_itemsx', bills: 'invoicex', billFk: 'invoicex_id', ledger: 'customer_ledger', ref: 'salex_return', note: 'CREDIT_NOTE', sign: 1, kind: 'salex', type: 'invoicex' },
  purchase: { rets: 'purchase_returns', items: 'purchase_return_items', fk: 'purchase_return_id', lineFk: 'purchase_item_id', lines: 'purchaseitems', bills: 'purchase', billFk: null, ledger: 'vendor_ledger', ref: 'purchase_return', note: 'DEBIT_NOTE', sign: -1, kind: 'purchase' }
};
const lineOf = (K, id) => store[K.lines].find(l => l.id === id);
const billOfLine = (K, l) => (K.kind === 'purchase' ? l.purchase_id : l.invoice_no);
export async function connected(label) {
  const bad = [];
  // stock: opening + bills + returns + dead stock, per product
  for (const p of store.product) {
    let want = N(p.opening_stock);
    want -= sum(store.invoiceitems.filter(l => l.product_id === p.id), l => N(l.qty)) + sum(store.invoice_itemsx.filter(l => l.product_id === p.id), l => N(l.qty));
    want += sum(store.purchaseitems.filter(l => l.product_id === p.id), l => N(l.qty));
    for (const K of Object.values(KIND)) want += K.sign * sum(store[K.items].filter(i => lineOf(K, i[K.lineFk])?.product_id === p.id), i => N(i.return_qty));
    want -= sum(store.deadstock.filter(d => d.product_id === p.id), d => N(d.quantity));
    if (N(p.stock) !== want) bad.push(`stock ${p.product_name}: ${p.stock}, documents say ${want}`);
  }
  for (const K of Object.values(KIND)) {
    // each bill's return status from its own lines
    for (const b of store[K.bills]) {
      const ls = store[K.lines].filter(l => billOfLine(K, l) === b.id);
      const back = (l) => sum(store[K.items].filter(i => i[K.lineFk] === l.id), i => N(i.return_qty));
      const any = ls.some(l => back(l) > 0), full = ls.length > 0 && ls.every(l => back(l) >= N(l.qty));
      const want = !any ? 0 : full ? 2 : 1;
      if (N(b.return_status) !== want) bad.push(`${K.bills} ${b.id} return_status ${b.return_status}, lines say ${want}`);
    }
    for (const r of store[K.rets]) {
      // the note: a refunded return carries one, worth its refund; a pending one nothing
      const notes = store[K.ledger].filter(l => l.reference_type === K.ref && l.reference_id === r.id && l.transaction_type === K.note);
      if (r.payment_status === 1 && !(notes.length === 1 && Math.abs(N(notes[0].credit) - N(r.refund_amount)) < 0.01)) bad.push(`${K.ref} ${r.id} refunded: ${K.note} rows ${JSON.stringify(notes.map(n => n.credit))}, refund ${r.refund_amount}`);
      if (r.payment_status !== 1 && store[K.ledger].some(l => l.reference_type === K.ref && l.reference_id === r.id)) bad.push(`${K.ref} ${r.id} pending but has ledger rows`);
      // totals from its own lines
      const its = store[K.items].filter(i => i[K.fk] === r.id);
      if (Math.abs(N(r.total_amount) - r2(sum(its, i => N(i.return_qty) * N(i.unit_price)))) > 0.01) bad.push(`${K.ref} ${r.id} total ${r.total_amount} vs lines`);
      if (!its.length) bad.push(`${K.ref} ${r.id} has no lines`);
      // the view (GET) and the list row agree with the tables
      const g = K.kind === 'purchase' ? await call(H.prOne, 'GET', { id: String(r.id) }) : await call(H.srOne, 'GET', { id: String(r.id), type: K.type });
      const gr = g.body?.data?.return;
      if (g.status !== 200 || N(gr?.refund_amount) !== N(r.refund_amount) || N(gr?.payment_status) !== N(r.payment_status)) bad.push(`view ${K.ref} ${r.id}: ${g.status} ${JSON.stringify(gr)}`);
      const viewQty = sum((g.body?.data?.bills || []).flatMap(b => b.items), i => N(i.return_qty));
      if (viewQty !== sum(its, i => N(i.return_qty))) bad.push(`view ${K.ref} ${r.id}: quantity ${viewQty}`);
    }
  }
  // lists: one row per return, same refund and status
  const cl = (await call(saleList, 'GET', { limit: '1000' })).body?.returns || [];
  const vl = (await call(purList, 'GET', { limit: '1000' })).body?.returns || [];
  for (const K of Object.values(KIND)) for (const r of store[K.rets]) {
    const row = (K.kind === 'purchase' ? vl : cl).filter(x => x.id === r.id && (K.kind === 'purchase' || x.invoice_type === K.type));
    if (row.length !== 1 || N(row[0].refund_amount) !== N(r.refund_amount) || N(row[0].payment_status) !== N(r.payment_status) || row[0].item_count !== store[K.items].filter(i => i[K.fk] === r.id).length) bad.push(`list row ${K.ref} ${r.id}: ${JSON.stringify(row)}`);
  }
  if (cl.length !== store.sale_returns.length + store.salex_returns.length || vl.length !== store.purchase_returns.length) bad.push(`list sizes ${cl.length}/${vl.length}`);
  // the returns register and the cash book: refunded returns are money, dated by the payment date
  const reg = (await call(H.returnsR, 'GET', { ...RANGE })).body?.returns || [];
  const cb = (await call(H.cashBookR, 'GET', { ...RANGE })).body?.rows || [];
  for (const K of Object.values(KIND)) for (const r of store[K.rets]) {
    const rr = reg.find(x => x.kind === K.kind && x.id === r.id);
    if (!rr || N(rr.refund) !== N(r.refund_amount) || N(rr.status) !== N(r.payment_status) || rr.date !== r.return_date) bad.push(`register ${K.ref} ${r.id}: ${JSON.stringify(rr)}`);
    const c = cb.filter(x => x.kind === `${K.kind}_return` && x.id === r.id);
    if (r.payment_status === 1 ? !(c.length === 1 && c[0].date === (r.payment_date || r.return_date) && N(c[0].money_in) + N(c[0].money_out) === N(r.refund_amount)) : c.length) bad.push(`cash book ${K.ref} ${r.id}: ${JSON.stringify(c)}`);
  }
  ok(`${label}: connected (stock, bill status, notes, view, lists, register, cash book)`, bad.length === 0, bad);
}
async function after(label) { await checkAll(label); await checkReports(label); await connected(label); }

const counters = (t, id = 1) => { const p = store[t].find(x => x.id === id); return [N(p.total_paid), N(p.total_allocated), N(p.total_refunded), N(p.total_refund_allocated)]; };
const stock = (id) => store.product.find(p => p.id === id).stock;
const rowsOf = (t, ref, id) => store[t].filter(l => l.reference_type === ref && l.reference_id === id);
const expectClean = () => expect(stats.failures).toEqual([]);

// ================================================================ sale and Invoice C
for (const kind of ['sale', 'salex']) {
  const K = KIND[kind];
  const label = kind === 'sale' ? 'sale' : 'Invoice C';
  test(`${label} return CRUD from the screen's own requests: create pending / refunded, read as the form, save unchanged, edit qty${kind === 'sale' ? ', reason, notes' : ''}, mark refunded, delete both`, async () => {
    const fx = FX(`${kind}.json`);
    await seed(fx);
    const S0 = snap();
    const taxed = kind === 'sale';

    // ---- create pending (2 x Brake Pad at 1000, 18% on the sale bill)
    let s = snap();
    const cp = stepOf(fx, 'create-pending');
    let r = await send(cp);
    const id1 = r.body?.data?.returns?.[0]?.id;
    ok('create pending: 201, one return', r.status === 201 && r.body.data.returns.length === 1 && id1 === 1000, r.body);
    let ret = store[K.rets].find(x => x.id === id1);
    ok('create pending: priced by the server', N(ret.total_amount) === 2000 && N(ret.refund_amount) === (taxed ? 2360 : 2000) && (taxed ? N(ret.total_tax) === 360 : true) && ret.payment_status === 0 && ret.payment_date == null && ret.notes === cp.body.return_notes, ret);
    ok('create pending: only the return, its line, stock and the bill status changed', same(diff(s, snap()), [`+${K.rets}`, `+${K.items}`, 'product.stock', `${K.bills}.return_status`]), diff(s, snap()));
    ok('create pending: stock back in (2), bill partly returned', stock(1) === 990 + 2 && store[K.bills][0].return_status === 1, [stock(1), store[K.bills][0]]);
    await after('create pending');

    // ---- create refunded (1 x Oil Filter at 200, paid back on 2026-10-06)
    s = snap();
    const cr = stepOf(fx, 'create-refunded');
    r = await send(cr);
    const id2 = r.body?.data?.returns?.[0]?.id;
    ret = store[K.rets].find(x => x.id === id2);
    ok('create refunded: 201, refund 200, payment date as sent', r.status === 201 && N(ret.refund_amount) === 200 && ret.payment_status === 1 && ret.payment_mode === cr.body.payment_mode && ret.payment_date === ts(cr.body.payment_date), ret);
    const nr = rowsOf('customer_ledger', K.ref, id2);
    ok('create refunded: CREDIT_NOTE 200 + REFUND 200 (direct adjustment, net 0)', nr.length === 2 && nr.some(x => x.transaction_type === 'CREDIT_NOTE' && N(x.credit) === 200) && nr.some(x => x.transaction_type === 'REFUND' && N(x.debit) === 200), nr);
    ok('create refunded: counters 200 / 200, logged under the note number', canon(counters('customer_details')) === canon([0, 0, 200, 200]) && store.customer_balance_logs.filter(l => l.reference_no === `${kind === 'sale' ? 'SR' : 'SXR'}-${id2}`).length === 2, [counters('customer_details'), store.customer_balance_logs]);
    ok('create refunded: what changed', same(diff(s, snap()), [`+${K.rets}`, `+${K.items}`, 'product.stock', '+customer_ledger', 'customer_details.total_refunded', 'customer_details.total_refund_allocated', '+customer_balance_logs']), diff(s, snap()));
    await after('create refunded');

    // ---- read as the edit form reads it; the captured PUT is exactly that
    const det = await readAsForm('customer', id1, K.type);
    const unchanged = stepOf(fx, 'edit-unchanged');
    ok('the edit form loads what the screen sent back unchanged', canon(formEditPayload('customer', det)) === canon(unchanged.body), { form: formEditPayload('customer', det), screen: unchanged.body });
    ok('the edit form carries the kind (URL ?type= and body)', unchanged.url.endsWith(`?type=${K.type}`) && unchanged.body.invoice_type === K.type && unchanged.body.items.every(i => i.invoice_type === K.type), unchanged);

    // ---- save unchanged: nothing may change
    s = snap();
    r = await send(unchanged);
    ok('save unchanged: 200 and NOTHING changed', r.status === 200 && diff(s, snap()).length === 0, { st: r.status, body: r.body, diff: diff(s, snap()) });
    await after('save unchanged');

    // ---- edit one field: quantity 2 -> 3 (Invoice C: -> 4)
    s = snap();
    r = await send(stepOf(fx, 'edit-qty'));
    ret = store[K.rets].find(x => x.id === id1);
    const q = kind === 'sale' ? 3 : 4;
    ok(`edit qty: ${q} units, repriced, stock follows`, r.status === 200 && N(ret.total_amount) === q * 1000 && N(ret.refund_amount) === (taxed ? q * 1180 : q * 1000) && stock(1) === 990 + q, { ret, st: stock(1) });
    ok('edit qty: only the quantity and its consequences changed', same(diff(s, snap()), [`${K.items}.return_qty`, ...(taxed ? [`${K.items}.tax_amount`, `${K.rets}.total_tax`] : []), `${K.rets}.total_amount`, `${K.rets}.refund_amount`, 'product.stock']), diff(s, snap()));
    await after('edit qty');

    if (kind === 'sale') {
      s = snap();
      r = await send(stepOf(fx, 'edit-reason'));
      ok('edit reason: only the line reason changed (7)', r.status === 200 && same(diff(s, snap()), [`${K.items}.return_reason_id`]) && store[K.items].find(i => i[K.fk] === id1).return_reason_id === 7, diff(s, snap()));
      await after('edit reason');
      s = snap();
      r = await send(stepOf(fx, 'edit-notes'));
      ok('edit notes: only the return notes changed', r.status === 200 && same(diff(s, snap()), [`${K.rets}.notes`]) && store[K.rets].find(x => x.id === id1).notes === 'three pads cracked', diff(s, snap()));
      await after('edit notes');
    }

    // ---- mark refunded by an edit: the CREDIT_NOTE only (owner: direct adjustment)
    s = snap();
    const tr = stepOf(fx, 'edit-to-refunded');
    r = await send(tr);
    ret = store[K.rets].find(x => x.id === id1);
    const refund = N(ret.refund_amount);
    const nr1 = rowsOf('customer_ledger', K.ref, id1);
    ok('to refunded: status 1, payment date as sent, a CREDIT_NOTE only', r.status === 200 && ret.payment_status === 1 && ret.payment_date === ts(tr.body.payment_date) && nr1.length === 1 && nr1[0].transaction_type === 'CREDIT_NOTE' && N(nr1[0].credit) === refund, { ret, nr1 });
    ok('to refunded: counters + refund', canon(counters('customer_details')) === canon([0, 0, 200 + refund, 200 + refund]), counters('customer_details'));
    ok('to refunded: what changed', same(diff(s, snap()), [`${K.rets}.payment_status`, `${K.rets}.payment_date`, '+customer_ledger', 'customer_details.total_refunded', 'customer_details.total_refund_allocated', '+customer_balance_logs']), diff(s, snap()));
    await after('to refunded');
    // and now it cannot be edited (owner)
    s = snap();
    r = await send({ ...tr, body: { ...tr.body, items: tr.body.items.map(i => ({ ...i, return_qty: 1 })) } });
    ok('refunded: edit refused (REFUNDED_RETURN_EDIT_BLOCKED), nothing changed', r.status === 400 && r.body?.error_code === 'REFUNDED_RETURN_EDIT_BLOCKED' && diff(s, snap()).length === 0, r.body);

    // ---- delete the one created refunded: its notes, counters, stock and the bill status go back
    s = snap();
    r = await send(stepOf(fx, 'delete-refunded'));
    ok('delete refunded: gone with its CREDIT_NOTE + REFUND; counters - 200; stock out again', r.status === 200 && !store[K.rets].some(x => x.id === id2) && rowsOf('customer_ledger', K.ref, id2).length === 0 && canon(counters('customer_details')) === canon([0, 0, refund, refund]) && stock(3) === 995, { st: r.status, c: counters('customer_details'), s3: stock(3) });
    await after('delete refunded');

    // ---- delete the last one: back to where we started
    r = await send(stepOf(fx, 'delete'));
    ok('delete: 200', r.status === 200, r.body);
    const left = diff(S0, snap());
    ok('delete: everything rolled back (only the balance-log audit rows remain, netting to 0)', same(left, ['+customer_balance_logs']) || left.length === 0, left);
    const net = (c) => r2(sum(store.customer_balance_logs.filter(l => l.column_name === c), l => N(l.change_amount)));
    ok('delete: balance logs net to 0, counters 0, bill not returned, stock as after the bill', net('total_refunded') === 0 && net('total_refund_allocated') === 0 && canon(counters('customer_details')) === canon([0, 0, 0, 0]) && store[K.bills][0].return_status === 0 && stock(1) === 990 && stock(3) === 995, { c: counters('customer_details'), b: store[K.bills][0].return_status });
    await after('delete');
    expectClean();
  });
}

// ================================================================ purchase: a pending return
test('purchase return CRUD (pending) from the screen\'s own requests: create with P&F, read as the form, save unchanged, edit qty / P&F / reason, delete', async () => {
  const fx = FX('purchase.json');
  await seed(fx);
  const S0 = snap();
  let s = snap();
  let r = await send(stepOf(fx, 'create-pending'));
  const id = r.body?.data?.return?.id;
  let ret = store.purchase_returns.find(x => x.id === id);
  ok('create: 201; 2 x 1000 + 18% + P&F 50 = 2410; DN-4-001; nothing in the ledger', r.status === 201 && N(ret.total_amount) === 2000 && N(ret.total_tax) === 360 && N(ret.refund_amount) === 2410 && N(ret.packing_forwarding_amount) === 50 && ret.debit_note_no === 'DN-4-001' && rowsOf('vendor_ledger', 'purchase_return', id).length === 0, ret);
  ok('create: what changed (the note counter too)', same(diff(s, snap()), ['+purchase_returns', '+purchase_return_items', 'product.stock', 'purchase.return_status', '+note_counters']), diff(s, snap()));
  ok('create: stock out 2 (990 after the three bills), bill partly returned', stock(1) === 988 && store.purchase[0].return_status === 1, [stock(1), store.purchase[0].return_status]);
  await after('purchase create pending');

  const det = await readAsForm('vendor', id);
  const unchanged = stepOf(fx, 'edit-unchanged');
  ok('the edit form loads what the screen sent back unchanged', canon(formEditPayload('vendor', det)) === canon(unchanged.body), { form: formEditPayload('vendor', det), screen: unchanged.body });
  s = snap();
  r = await send(unchanged);
  ok('save unchanged: 200 and NOTHING changed', r.status === 200 && diff(s, snap()).length === 0, { st: r.status, d: diff(s, snap()) });
  await after('purchase save unchanged');

  s = snap();
  r = await send(stepOf(fx, 'edit-qty'));
  ret = store.purchase_returns.find(x => x.id === id);
  ok('edit qty 3: 3000 + 540 + 50 = 3590, stock 987', r.status === 200 && N(ret.refund_amount) === 3590 && stock(1) === 987, ret);
  ok('edit qty: only the quantity and its consequences', same(diff(s, snap()), ['purchase_return_items.return_qty', 'purchase_return_items.tax_amount', 'purchase_return_items.cgst', 'purchase_return_items.sgst', 'purchase_returns.total_amount', 'purchase_returns.total_tax', 'purchase_returns.refund_amount', 'product.stock']), diff(s, snap()));
  await after('purchase edit qty');

  s = snap();
  r = await send(stepOf(fx, 'edit-pf'));
  ok('edit P&F 50 -> 80: refund 3620, nothing else', r.status === 200 && N(store.purchase_returns[0].refund_amount) === 3620 && same(diff(s, snap()), ['purchase_returns.packing_forwarding_amount', 'purchase_returns.refund_amount']), diff(s, snap()));
  await after('purchase edit P&F');

  s = snap();
  r = await send(stepOf(fx, 'edit-reason'));
  ok('edit reason: only the line reason (3)', r.status === 200 && same(diff(s, snap()), ['purchase_return_items.return_reason_id']) && store.purchase_return_items[0].return_reason_id === 3, diff(s, snap()));
  await after('purchase edit reason');

  r = await send(stepOf(fx, 'delete'));
  ok('delete: 200', r.status === 200, r.body);
  ok('delete: everything rolled back (the debit note number stays used)', same(diff(S0, snap()), ['+note_counters']), diff(S0, snap()));
  await after('purchase delete');
  expectClean();
});

// ================================================================ purchase: a refunded return
// Owner (29 Jan 2026): a refunded purchase return can be edited; its note and counters follow.
// The screens' own requests: create refunded, save unchanged, qty 5 -> 3, mark pending, mark refunded
// again, delete. The note follows at every step; the counters do not survive the delete (D-01).
async function refundedFlow({ stopBeforeDelete = false } = {}) {
  const fx = FX('purchase.json');
  await seed(fx);
  await send(stepOf(fx, 'create-pending'));            // P1 first, so the ids are the screen's
  const S0 = snap();
  let s = snap();
  let r = await send(stepOf(fx, 'create-refunded'));
  const id = r.body?.data?.return?.id;
  let ret = store.purchase_returns.find(x => x.id === id);
  const note = () => rowsOf('vendor_ledger', 'purchase_return', id);
  ok('create refunded: 1000, DEBIT_NOTE 1000, counters 1000 / 1000, paid on 2026-10-06', r.status === 201 && N(ret.refund_amount) === 1000 && note().length === 1 && N(note()[0].credit) === 1000 && canon(counters('vendor_details')) === canon([0, 0, 1000, 1000]) && ret.payment_date === ts('2026-10-06'), { ret, n: note(), c: counters('vendor_details') });
  ok('create refunded: the bill keeps partial (line 2 full, line 1 partly)', store.purchase[0].return_status === 1, store.purchase[0]);
  await after('purchase create refunded');

  const det = await readAsForm('vendor', id);
  const unchanged = stepOf(fx, 'edit-refunded-unchanged');
  ok('the edit form loads the refunded return as the screen sent it back', canon(formEditPayload('vendor', det)) === canon(unchanged.body), { form: formEditPayload('vendor', det), screen: unchanged.body });
  s = snap();
  r = await send(unchanged);
  ok('save unchanged: NOTHING changed', r.status === 200 && diff(s, snap()).length === 0, diff(s, snap()));

  s = snap();
  r = await send(stepOf(fx, 'edit-refunded-qty'));
  ok('qty 5 -> 3: refund 600, DEBIT_NOTE 600, counters 600 / 600, stock follows', r.status === 200 && N(store.purchase_returns.find(x => x.id === id).refund_amount) === 600 && N(note()[0].credit) === 600 && canon(counters('vendor_details')) === canon([0, 0, 600, 600]) && stock(3) === 992, { n: note(), c: counters('vendor_details'), s: stock(3) });
  await after('purchase refunded qty');

  r = await send(stepOf(fx, 'edit-refunded-to-pending'));
  ok('to pending: the DEBIT_NOTE goes, counters 0 / 0', r.status === 200 && note().length === 0 && canon(counters('vendor_details')) === canon([0, 0, 0, 0]), { n: note(), c: counters('vendor_details') });
  await after('purchase to pending');

  r = await send(stepOf(fx, 'edit-pending-to-refunded'));
  ret = store.purchase_returns.find(x => x.id === id);
  ok('refunded again: DEBIT_NOTE 600, counters 600 / 600, paid on 2026-10-08', r.status === 200 && note().length === 1 && N(note()[0].credit) === 600 && canon(counters('vendor_details')) === canon([0, 0, 600, 600]) && ret.payment_date === ts('2026-10-08'), { n: note(), c: counters('vendor_details'), ret });
  await after('purchase refunded again');
  if (stopBeforeDelete) return;

  r = await send(stepOf(fx, 'delete-refunded'));
  ok('delete: counters back to 0 / 0', r.status === 200 && canon(counters('vendor_details')) === canon([0, 0, 0, 0]), counters('vendor_details'));
  const left = diff(S0, snap()).filter(x => x !== '+vendor_balance_logs' && x !== 'vendor_ledger.balance');
  ok('delete: everything rolled back', left.length === 0, left);
  await after('purchase delete refunded');
}
test('purchase return CRUD (refunded): create, read as the form, unchanged, qty, pending, refunded again - note and counters follow', async () => {
  await refundedFlow({ stopBeforeDelete: true });
  expectClean();
});
(process.env.REVIEW_D_SHOW ? test : test.failing)('D-01/D-02 purchase return CRUD (refunded): ...then delete - counters back to 0 (today -1000: the edits were logged without the note number, so the delete reverses 1600)', async () => {
  await refundedFlow();
  expectClean();
});

// ================================================================ dead stock
test('dead stock CRUD from the screen\'s own requests: add 3, edit to 5, delete - stock out and back, stock report follows', async () => {
  const fx = FX('deadstock.json');
  reset(); seedStock(); stats.failures = [];
  const S0 = snap();
  let s = snap();
  let r = await send(stepOf(fx, 'create'));
  ok('add: 201, stock 1000 -> 997, only the entry and the stock changed', r.status === 201 && stock(1) === 997 && same(diff(s, snap()), ['+deadstock', 'product.stock']), { r: r.body, d: diff(s, snap()) });
  await after('dead stock add');
  const one = await call(H.deadOne, 'GET', { id: String(store.deadstock[0].id) });
  ok('read back: what the form loads (product, quantity, reason)', one.status === 200 && one.body.product_id === 1 && one.body.quantity === 3 && one.body.reason === 'water damage' && one.body.available_stock === 997, one.body);
  s = snap();
  r = await send({ method: 'PUT', url: stepOf(fx, 'edit-qty').url, body: { product_id: 1, quantity: 3, reason: 'water damage' } });
  ok('save unchanged (the server path; the form refuses "No changes detected"): nothing changed', r.status === 200 && diff(s, snap()).length === 0, diff(s, snap()));
  s = snap();
  r = await send(stepOf(fx, 'edit-qty'));
  ok('edit 3 -> 5: stock 995, only quantity and stock', r.status === 200 && stock(1) === 995 && same(diff(s, snap()), ['deadstock.quantity', 'product.stock']), diff(s, snap()));
  await after('dead stock edit');
  r = await send(stepOf(fx, 'delete'));
  ok('delete: stock back to 1000, nothing left', r.status === 200 && stock(1) === 1000 && diff(S0, snap()).length === 0, diff(S0, snap()));
  await after('dead stock delete');
  expectClean();
});
