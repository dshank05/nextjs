// Review B - Sales and Invoice C: CRUD round trips from the payloads the REAL screens send.
//
// The fixtures in tests/backend/fixtures/sales/ were captured by harness/review-b-capture.jsx,
// which renders /sale/* and /salex/* (BillForm, BillView + BillPaymentModal, BillList) in jsdom
// over the real API handlers and records every request body. Here they are replayed against the
// real routes over the in-memory store:
//
//   create -> read as the edit form reads it (GET detail -> normalizeBill -> BillForm's payload)
//          -> save back unchanged (no table may change) -> edit one field (only it and what
//          follows from it change) -> delete (everything rolled back)
//
// After every step: audit-assert A1-A14 (checkAll), the 16 report checks (checkReports), and the
// connectedness checks below (list, detail, dashboard, commission / mechanic / staff / freight /
// P&F / bill-reference reports). The edit fixtures carry the harness's line ids; they are mapped
// to this bill's rows by position, which is what the form does (it sends back what it loaded).
import fs from 'fs';
import path from 'path';
import { store, call, sum, r2, N, K, seedStock } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, ok, H, RANGE } from '../support/flowlib.js';
import { normalizeBill, billListParams, EMPTY_BILL_FILTERS } from '../../../hooks/useBills';
import { packingAmount, parseNum } from '../../../lib/line-math';
import { convertDateToTimestamp, getLocalDateString } from '../../../lib/date-utils';
import dashboard from '../../../pages/api/dashboard/index';
import commissionsR from '../../../pages/api/reports/commissions';
import mechanicR from '../../../pages/api/reports/mechanic-sales';
import staffR from '../../../pages/api/reports/staff-sales';
import freightR from '../../../pages/api/reports/transport-cost';
import pfR from '../../../pages/api/reports/packing-forwarding';
import billRefR from '../../../pages/api/reports/bill-reference-sale';

const FIX = path.join(__dirname, '../fixtures/sales');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const SEED = fx('seed.json');

// ------------------------------------------------------------------ store
function seed() {
  reset(); seedStock(); stats.failures = [];
  for (const c of SEED.customer_details) Object.assign(store.customer_details.find(x => x.id === c.id), c);
  store.staff = SEED.staff.map(s => ({ ...s }));
  store.mechanic = SEED.mechanic.map(m => ({ ...m }));
  for (const p of SEED.product) Object.assign(store.product.find(x => x.id === p.id), p);
}
const snap = () => structuredClone(store);
const IGNORED = new Set(['updated_at', 'created_at']);
/** Every row added, removed or changed between two snapshots, as `table#id.field: old -> new`. */
function diff(a, b) {
  const out = [];
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const A = Array.isArray(a[t]) ? a[t] : [], B = Array.isArray(b[t]) ? b[t] : [];
    const byId = (rows) => new Map(rows.map((r, i) => [r.id ?? `#${i}`, r]));
    const ma = byId(A), mb = byId(B);
    for (const id of ma.keys()) if (!mb.has(id)) out.push(`${t}#${id} removed`);
    for (const id of mb.keys()) if (!ma.has(id)) out.push(`${t}#${id} added`);
    for (const [id, r] of mb) {
      const o = ma.get(id); if (!o) continue;
      for (const f of new Set([...Object.keys(o), ...Object.keys(r)])) {
        if (IGNORED.has(f)) continue;
        if (JSON.stringify(o[f] ?? null) !== JSON.stringify(r[f] ?? null)) out.push(`${t}#${id}.${f}: ${JSON.stringify(o[f])} -> ${JSON.stringify(r[f])}`);
      }
    }
  }
  return out;
}
/** `table.field` (or `table+` / `table-`) for each change, deduplicated and sorted. */
const shape = (d) => Array.from(new Set(d.map(x => x.replace(/#[^ .]+ added$/, '+').replace(/#[^ .]+ removed$/, '-').replace(/#[^.]+\./, '.').replace(/:.*$/, '')))).sort();
const expectShape = (step, d, want) => ok(`${step}: changed exactly ${want.join(', ') || 'nothing'}`, JSON.stringify(shape(d)) === JSON.stringify([...want].sort()), d.slice(0, 40));

// ------------------------------------------------------------------ the routes, as the screens call them
const T = (kind) => K[kind];
const api = (kind) => ({ col: kind === 'sale' ? H.sales : H.salex, one: kind === 'sale' ? H.saleOne : H.salexOne });
const header = (kind) => kind === 'sale' ? 'invoice' : 'invoicex';
const lineTable = (kind) => kind === 'sale' ? 'invoiceitems' : 'invoice_itemsx';
const billTo = (kind) => kind === 'sale' ? 'bill_tosales' : 'bill_tosalesx';
const shipTo = (kind) => kind === 'sale' ? 'shipto' : 'shiptox';
const transport = (kind) => kind === 'sale' ? 'transport_details' : 'transport_detailsx';
const allocFk = (kind) => kind === 'sale' ? 'invoice_id' : 'invoicex_id';
const doc = (kind, id) => store[header(kind)].find(b => b.id === id);
const docLines = (kind, id) => store[lineTable(kind)].filter(l => l.invoice_no === id).sort((a, b) => a.id - b.id);

async function createFrom(kind, file) {
  const f = fx(file);
  const r = await call(api(kind).col, 'POST', {}, structuredClone(f.body));
  return { r, id: r.body?.sale?.id, body: f.body };
}
/** An edit fixture for this bill: its URL id and line ids are the harness's; map them to ours by position. */
function editBody(kind, file, id) {
  const body = structuredClone(fx(file).body);
  const rows = docLines(kind, id);
  (body.invoiceItems || []).forEach((it, i) => { if (it.line_id !== undefined) it.line_id = rows[i]?.id; });
  return body;
}
const put = (kind, id, body) => call(api(kind).one, 'PUT', { id: String(id) }, body);
const del = (kind, id) => call(api(kind).one, 'DELETE', { id: String(id) });
const getDetail = (kind, id) => call(api(kind).one, 'GET', { id: String(id) });

// ------------------------------------------------------------------ the edit form, reading what GET returns
/**
 * What BillForm sends back for a loaded bill when nothing is touched: its populate effect
 * (components/bills/BillForm.tsx:114-165) and buildPayload (206-258) for a sale / Invoice C in
 * edit mode with the status untouched. It mirrors the component; the test below checks it
 * against the body the real form sent in the harness, so the two cannot drift silently.
 */
function formPayload(kind, b) {
  const taxFree = kind === 'salex';
  const toDateInput = (ts) => (ts ? getLocalDateString(new Date(ts * 1000)) : '');
  const enableTax = !taxFree && (b.items.some(i => i.gst_percentage > 0) || b.total_tax > 0);
  const enableDiscount = b.items.some(i => i.discount > 0) || b.discount > 0;
  const pfRate = b.packing_rate || (b.packing_qty > 0 ? b.packing_total / b.packing_qty : 0);
  const packing = packingAmount(b.packing_qty ? String(b.packing_qty) : '', pfRate ? String(pfRate) : '', b.packing_total ? String(b.packing_total) : '');
  return {
    date: toDateInput(b.invoice_date), bill_reference: b.bill_reference,
    staff_id: b.staff_id ? parseInt(String(b.staff_id), 10) : null,
    transport_name: b.transport_name, vehicle_number: b.vehicle_number,
    transport_cost: parseNum(b.freight ? String(b.freight) : ''),
    descriptions: b.descriptions, notes: b.notes,
    packing_forwarding_qty: packing.qty, packing_forwarding_rate: packing.rate,
    payment_mode: b.payment_mode ?? 0,
    contact_number: b.party.contact, email_id: b.party.email, gst_number: b.party.gstin, address: b.party.address,
    address_2: b.party.address_2, city: b.party.city, state: b.party.state, state_code: b.party.state_code,
    customer_name: b.party.name,
    mechanic_id: b.mechanic_id ? parseInt(String(b.mechanic_id), 10) : null,
    commission: parseNum(b.commission ? String(b.commission) : ''),
    invoiceItems: b.items.map(i => ({
      ...(i.line_id ? { line_id: i.line_id } : {}), product_id: i.product_id, model_id: i.model_id, company_id: i.company_id, part: i.part,
      qty: i.qty, rate: i.rate, gst_percentage: enableTax && !taxFree ? i.gst_percentage : 0, discount: enableDiscount ? i.discount : 0
    }))
  };
}
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));

// ------------------------------------------------------------------ connectedness: every other place a bill shows
async function connected(step) {
  const e = (what, cond, info) => ok(`${step}: ${what}`, cond, info);
  for (const kind of ['sale', 'salex']) {
    const bills = store[header(kind)];
    // List (BillList via useBillList): one row per bill, the snapshot's name, the allocations paid.
    const list = await call(api(kind).col, 'GET', { page: '1', limit: '50' });
    const rows = list.body?.data || [];
    e(`${kind} list has every bill`, rows.length === bills.length, rows.map(r => r.id));
    for (const b of bills) {
      const row = rows.find(r => r.id === b.id);
      const snapName = store[billTo(kind)].find(s => s.invoice_no === b.id)?.billing_name;
      const paid = r2(sum(store.customer_payment_allocations.filter(a => a[allocFk(kind)] === b.id), a => N(a.allocated_amount)));
      e(`${kind} ${b.id} list row: total, items, name, status, paid`, row && row.total === b.total && row.item_count === docLines(kind, b.id).length
        && row.customer_name === (snapName || 'Other') && row.payment_status === (b.payment_status ?? 0) && r2(row.total_paid) === paid, { row, b: { total: b.total, st: b.payment_status }, snapName, paid });
      // View (BillView via useBill): the same money.
      const d = (await getDetail(kind, b.id)).body;
      e(`${kind} ${b.id} detail: total and paid`, d && d.total === b.total && r2(d.payment_summary.total_paid) === paid, d && d.payment_summary);
    }
  }
  // Dashboard: GST sales only (Invoice C is not on it - see B-08).
  const day = '2026-10-02';
  const from = convertDateToTimestamp(day);
  const dash = (await call(dashboard, 'GET', { today: day, salesDate: day })).body || {};
  e('dashboard: total sales = sale bills', dash.totals?.sales === store.invoice.length, dash.totals);
  e('dashboard: day total = sale bills that day', r2(dash.salesDay?.total) === r2(sum(store.invoice.filter(b => b.invoice_date >= from && b.invoice_date <= from + 86399), b => N(b.total))), dash.salesDay);
  // Reports that read the bill's own fields, both kinds.
  const both = [...store.invoice.map(b => ['sale', b]), ...store.invoicex.map(b => ['salex', b])];
  const rq = { ...RANGE, page: '1', limit: '500' };
  const com = (await call(commissionsR, 'GET', rq)).body || {};
  e('commissions report: every bill with commission', com.pagination?.total === both.filter(([, b]) => N(b.commission) > 0).length && r2(com.summary?.total_commission) === r2(sum(both, ([, b]) => N(b.commission))), com.summary);
  const mech = (await call(mechanicR, 'GET', rq)).body || {};
  e('mechanic sales report: every bill with a mechanic', mech.pagination?.total === both.filter(([, b]) => b.mechanic_id != null).length, { got: mech.pagination, want: both.map(([k, b]) => [k, b.id, b.mechanic_id]) });
  const st = (await call(staffR, 'GET', rq)).body || {};
  e('staff sales report: every bill with a staff member', st.pagination?.total === both.filter(([, b]) => b.staff_id != null).length + store.purchase.filter(p => p.staff_id != null).length, st.pagination);
  const fr = (await call(freightR, 'GET', rq)).body || {};
  e('transport cost report: every bill with freight', fr.pagination?.total === both.filter(([, b]) => N(b.freight) > 0).length + store.purchase.filter(p => N(p.freight) > 0).length
    && r2(fr.summary?.total_freight) === r2(sum(both, ([, b]) => N(b.freight)) + sum(store.purchase, p => N(p.freight))), fr.summary);
  const pf = (await call(pfR, 'GET', rq)).body || {};
  e('packing & forwarding report: every bill with P&F', pf.pagination?.total === both.filter(([, b]) => N(b.packing_forwarding_total) > 0).length + store.purchase.filter(p => N(p.packing_forwarding_total) > 0).length, pf.summary);
  const br = (await call(billRefR, 'GET', { billReference: 'BR', page: '1', limit: '50' })).body || {};
  e('bill reference report: every bill with "BR", with its kind', br.pagination?.total === both.filter(([, b]) => String(b.bill_reference || '').includes('BR')).length
    && (br.sales || []).every(s => both.some(([k, b]) => k === s.type && b.id === s.id)), br.sales);
}
async function after(step) {
  await checkAll(step);
  await checkReports(step);
  await connected(step);
}
const stockOf = (pid) => store.product.find(p => p.id === pid).stock;

// ================================================================== the round trips
const KINDS = ['sale', 'salex'];
describe('Review B - sale and Invoice C round trips from the screens\' own payloads', () => {
  for (const kind of KINDS) {
    const taxed = kind === 'sale';
    const total = taxed ? 3212 : 2870; // items 1900 + 750, P&F 100, freight 120, GST 18% of 1900 = 342 (sale)

    test(`RB-${kind}-1 create (every field) -> read as the edit form -> save unchanged -> edit notes -> delete`, async () => {
      seed();
      const before = snap();
      // ---- create
      const { r, id, body } = await createFrom(kind, `${kind}-create.json`);
      ok('create 201', r.status === 201, r.body);
      const h = doc(kind, id);
      const day2 = convertDateToTimestamp('2026-10-02');
      ok('header: number, fy, date, customer', h.invoice_no === 1 && h.fy === 4 && h.invoice_date === day2 && h.select_customer === 1, h);
      ok('header: money from the server', h.items_total === 2650 && h.discount === 100 && h.freight === 120 && h.packing_forwarding_qty === 2 && h.packing_forwarding_rate === 50
        && h.packing_forwarding_total === 100 && h.total_tax === (taxed ? 342 : 0) && h.total_cgst === (taxed ? 171 : 0) && h.total_sgst === (taxed ? 171 : 0) && !N(h.total_igst) && h.total === total, h);
      ok('header: staff, mechanic, commission, reference, notes, descriptions', h.staff_id === 3 && h.mechanic_id === 5 && h.commission === 50 && h.bill_reference === 'BR-7'
        && h.notes === 'Deliver by noon' && h.descriptions === 'Fitted at shop', h);
      ok('header: unpaid; the form\'s default mode 0 (Cash) is stored on an unpaid bill (B-04)', h.payment_status === 0 && h.payment_mode === 0, h);
      const ls = docLines(kind, id);
      ok('lines: product name / hsn / part / model from the product and the form', ls.length === 2 && ls[0].name_of_product === 'Brake Pad' && ls[0].part === 'BP-1' && ls[0].model_id === 1
        && ls[0].hsn === '8708' && ls[0].category_id === 1 && ls[1].name_of_product === 'Oil Filter', ls);
      ok('lines: qty, rate, discount, tax as the server computes', ls[0].qty === 2 && ls[0].rate === 1000 && ls[0].discount === 100 && ls[0].subtotal === 1900
        && ls[0].gst_percentage === (taxed ? 18 : 0) && ls[0].tax === (taxed ? 342 : 0) && ls[1].subtotal === 750 && ls.every(l => l.fy === 4 && l.invoice_date === day2), ls);
      const s = store[billTo(kind)].find(x => x.invoice_no === id);
      ok('billing snapshot: what the form showed', s && s.billing_name === 'Ravi' && s.contact_no === '9876543210' && s.email === 'ravi@shop.in' && s.billing_address === '12 MG Road'
        && s.billing_address2 === 'Near Temple' && s.billing_city === 'Mathura' && s.billing_state === 'Uttar Pradesh' && s.billing_state_code === 9 && s.billing_gstin === '09AAAPR1234C1Z5', s);
      const sh = store[shipTo(kind)].find(x => x.invoice_no === id);
      ok('ship-to: a copy of the billing snapshot (the form has no shipping block)', sh && sh.shipping_name === 'Ravi' && sh.shipping_address === '12 MG Road' && sh.shipping_state_code === 9, sh);
      const tr = store[transport(kind)].find(x => x.invoice_id === id);
      ok('transport row: name and vehicle', tr && tr.trans_mode === 'Sharma Roadways' && tr.vehicle_no === 'UP85 AB 1234', tr);
      const led = store.customer_ledger;
      ok(`ledger: one SALE row, ref ${kind}, debit ${total}, on the bill date`, led.length === 1 && led[0].transaction_type === 'SALE' && led[0].reference_type === kind
        && led[0].reference_id === id && led[0].debit === total && led[0].balance === total && led[0].transaction_date === day2 && led[0].reference_no === '1', led);
      ok('stock: 2 Brake Pad and 3 Oil Filter out', stockOf(1) === 998 && stockOf(3) === 997, store.product);
      ok('no payment, allocation, counter or balance log', !store.customer_payments.length && !store.customer_payment_allocations.length && !store.customer_balance_logs.length
        && N(store.customer_details[0].total_paid) === 0, store.customer_details[0]);
      ok('create response: id, number, total', r.body.sale.invoice_no === 1 && r.body.sale.total === total && r.body.sale.customer_name === 'Ravi', r.body);
      ok('response field the form reads (data.sale.id / data.data.id)', r.body.data.id === id);
      await after(`${kind} create`);

      // ---- read as the edit form reads it
      const d = await getDetail(kind, id);
      ok('GET 200', d.status === 200, d.body);
      const b = normalizeBill(kind, d.body);
      ok('normalizeBill: party from the snapshot', b.party.id === 1 && b.party.name === 'Ravi' && b.party.contact === '9876543210' && b.party.email === 'ravi@shop.in'
        && b.party.address_2 === 'Near Temple' && b.party.state_code === 9 && b.party.gstin === '09AAAPR1234C1Z5', b.party);
      ok('normalizeBill: staff, mechanic, commission, transport, freight, P&F', b.staff_id === 3 && b.staff_name === 'Suresh' && b.mechanic_id === 5 && b.mechanic_name === 'Mohan'
        && b.commission === 50 && b.transport_name === 'Sharma Roadways' && b.vehicle_number === 'UP85 AB 1234' && b.freight === 120 && b.packing_qty === 2 && b.packing_rate === 50 && b.packing_total === 100, b);
      ok('normalizeBill: lines carry their row id', b.items.length === 2 && b.items.every((it, i) => it.line_id === ls[i].id) && b.items[0].discount === 100, b.items);
      ok('normalizeBill: totals and status', b.total === total && b.items_total === 2650 && b.payment_status === 0 && b.payment_mode === 0 && b.invoice_no === 1, b);
      const formBody = formPayload(kind, b);
      const unchanged = editBody(kind, `${kind}-edit-notes.json`, id);
      unchanged.notes = 'Deliver by noon'; // the captured edit, with its one change taken back
      ok('the form\'s payload rebuilt from GET equals what the real form sent (bar the edited field)', canon(formBody) === canon(unchanged), { formBody, unchanged });
      ok('the form sends no totals and no customer on edit', unchanged.total === undefined && unchanged.total_tax === undefined && unchanged.select_customer === undefined && unchanged.payment_status === undefined);

      // ---- save back unchanged: nothing may change
      let s0 = snap();
      let res = await put(kind, id, unchanged);
      ok('unchanged save 200', res.status === 200, res.body);
      let ch = diff(s0, snap());
      expectShape(`${kind} unchanged save`, ch, []);
      ok('header updated_at moved (the only write)', doc(kind, id).updated_at !== s0[header(kind)][0].updated_at);
      await after(`${kind} unchanged save`);

      // ---- edit one field: notes
      s0 = snap();
      res = await put(kind, id, editBody(kind, `${kind}-edit-notes.json`, id));
      ok('notes edit 200 + response', res.status === 200 && res.body.sale.id === id && res.body.sale.total === total, res.body);
      ch = diff(s0, snap());
      expectShape(`${kind} notes edit`, ch, [`${header(kind)}.notes`]);
      ok('notes saved', doc(kind, id).notes === 'Deliver by 5 pm');
      await after(`${kind} notes edit`);

      // ---- delete: everything rolled back
      res = await del(kind, id);
      ok('delete 200', res.status === 200 && res.body.success === true && res.body.sale_id === id, res.body);
      expectShape(`${kind} delete`, diff(before, snap()), []);
      await after(`${kind} delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-2 edit a line's qty from the form (2 -> 3): line, totals, stock, ledger follow; delete rolls back`, async () => {
      seed();
      const before = snap();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      await after(`${kind} create`);
      const s0 = snap();
      const res = await put(kind, id, editBody(kind, `${kind}-edit-qty.json`, id));
      ok('qty edit 200', res.status === 200, res.body);
      const want = taxed ? 4392 : 3870; // items 2900 + 750, P&F 100, freight 120, GST 18% of 2900 = 522
      const l0 = docLines(kind, id)[0];
      ok('line: qty 3, taxable 2900, tax as the server computes', l0.qty === 3 && l0.subtotal === 2900 && l0.tax === (taxed ? 522 : 0) && l0.discount === 100, l0);
      ok(`header total ${want}`, doc(kind, id).total === want && doc(kind, id).items_total === 3650, doc(kind, id));
      ok('stock: one more Brake Pad out', stockOf(1) === 997 && stockOf(3) === 997);
      ok('ledger SALE debit follows, balance follows', store.customer_ledger[0].debit === want && store.customer_ledger[0].balance === want, store.customer_ledger);
      const lineFields = taxed ? ['subtotal', 'tax', 'cgst', 'sgst', 'qty', 'discountrate'] : ['subtotal', 'qty', 'discountrate'];
      const headFields = taxed ? ['items_total', 'total_cgst', 'total_sgst', 'total_tax', 'total', 'total_taxable_value'] : ['items_total', 'total', 'total_taxable_value'];
      expectShape(`${kind} qty edit`, diff(s0, snap()), [...lineFields.map(f => `${lineTable(kind)}.${f}`), ...headFields.map(f => `${header(kind)}.${f}`), 'product.stock', 'customer_ledger.debit', 'customer_ledger.balance', 'customer_ledger.notes']);
      await after(`${kind} qty edit`);
      await del(kind, id);
      expectShape(`${kind} delete after qty edit`, diff(before, snap()), []);
      await after(`${kind} delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-3 mark paid on the edit form (Unpaid -> Paid, Bank): payment, allocation, ledger, counters, cash book; delete rolls back`, async () => {
      seed();
      const before = snap();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      const s0 = snap();
      const body = editBody(kind, `${kind}-edit-paid.json`, id);
      ok('the form sent status 1 and mode 1', body.payment_status === 1 && body.payment_mode === 1, body);
      const res = await put(kind, id, body);
      ok('paid edit 200', res.status === 200, res.body);
      const p = store.customer_payments;
      ok(`one BILL_SPECIFIC payment ${total}, Bank, dated the bill`, p.length === 1 && N(p[0].payment_amount) === total && p[0].payment_mode === 1 && p[0].payment_type === 'BILL_SPECIFIC'
        && p[0].payment_date === doc(kind, id).invoice_date, p);
      const a = store.customer_payment_allocations;
      ok(`allocated to the ${kind} by ${allocFk(kind)}`, a.length === 1 && a[0][allocFk(kind)] === id && N(a[0].allocated_amount) === total && !a[0][allocFk(kind === 'sale' ? 'salex' : 'sale')], a);
      const pr = store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED');
      ok(`PAYMENT_RECEIVED ref ${kind}, credit ${total}, tagged with the payment`, pr && pr.reference_type === kind && pr.reference_id === id && pr.credit === total && pr.transaction_id === p[0].id && pr.payment_mode === 1, pr);
      const c = store.customer_details[0];
      ok('counters: paid and allocated = total', N(c.total_paid) === total && N(c.total_allocated) === total, c);
      ok('bill paid, Bank', doc(kind, id).payment_status === 1 && doc(kind, id).payment_mode === 1);
      expectShape(`${kind} paid edit`, diff(s0, snap()), [`${header(kind)}.payment_status`, `${header(kind)}.payment_mode`, 'customer_payments+', 'customer_payment_allocations+', 'customer_ledger+',
        'customer_details.total_paid', 'customer_details.total_allocated', 'customer_balance_logs+']);
      await after(`${kind} paid edit`);
      await del(kind, id);
      const d = diff(before, snap());
      expectShape(`${kind} delete after paid edit (logs are the audit trail)`, d, ['customer_balance_logs+']);
      for (const col of ['total_paid', 'total_allocated']) ok(`balance logs net 0 on ${col}`, r2(sum(store.customer_balance_logs.filter(l => l.column_name === col), l => N(l.change_amount))) === 0, store.customer_balance_logs);
      await after(`${kind} delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-4 Mark as Paid on the view (part payment 500 from the modal): bill part paid; delete takes the payment with it`, async () => {
      seed();
      const before = snap();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      const f = fx(`${kind}-markpaid.json`);
      const body = structuredClone(f.body);
      ok(`the modal names the bill by ${allocFk(kind)}`, body.allocations.length === 1 && body.allocations[0][allocFk(kind)] !== undefined && body.payment_type === 'BILL_SPECIFIC' && body.customer_id === 1, body);
      body.allocations[0][allocFk(kind)] = id;
      const s0 = snap();
      const res = await call(H.cpCreate, 'POST', {}, body);
      ok('payment 201', res.status === 201, res.body);
      ok('bill part paid', doc(kind, id).payment_status === 2, doc(kind, id));
      const pr = store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED');
      ok('one PAYMENT_RECEIVED row ref payment, credit 500', pr && pr.reference_type === 'payment' && pr.credit === 500, store.customer_ledger);
      expectShape(`${kind} mark as paid`, diff(s0, snap()), [`${header(kind)}.payment_status`, 'customer_payments+', 'customer_payment_allocations+', 'customer_ledger+',
        'customer_details.total_paid', 'customer_details.total_allocated', 'customer_balance_logs+']);
      const dt = normalizeBill(kind, (await getDetail(kind, id)).body);
      ok('view: paid 500, outstanding the rest, history of one', dt.payment_summary.total_paid === 500 && dt.payment_summary.remaining_amount === total - 500 && dt.payment_history.length === 1, dt.payment_summary);
      await after(`${kind} mark as paid`);
      // the edit form on a part-paid bill does not send the status, so a notes edit keeps it part paid
      const notes = editBody(kind, `${kind}-edit-notes.json`, id);
      ok('edit form leaves the derived status out', notes.payment_status === undefined);
      await put(kind, id, notes);
      ok('still part paid after an edit', doc(kind, id).payment_status === 2);
      await after(`${kind} notes edit on a part-paid bill`);
      await del(kind, id);
      expectShape(`${kind} delete of a part-paid bill (owner: complete rollback)`, diff(before, snap()), ['customer_balance_logs+']);
      await after(`${kind} delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-5 clear staff, mechanic, commission, freight, vehicle and transport on the edit form`, async () => {
      seed();
      const { id } = await createFrom(kind, `${kind}-create.json`);
      const s0 = snap();
      const res = await put(kind, id, editBody(kind, `${kind}-edit-clear-extras.json`, id));
      ok('edit 200', res.status === 200, res.body);
      const h = doc(kind, id);
      ok('staff and mechanic disconnected, commission 0', h.staff_id === null && h.mechanic_id === null && h.commission === 0, h);
      ok(`freight 0: total down by 120 to ${total - 120}`, h.freight === 0 && h.total === total - 120, h);
      const tr = store[transport(kind)].find(x => x.invoice_id === id);
      ok('transport row emptied', tr.trans_mode === null && tr.vehicle_no === null, tr);
      ok('ledger SALE follows', store.customer_ledger[0].debit === total - 120);
      expectShape(`${kind} clear extras`, diff(s0, snap()), [`${header(kind)}.staff_id`, `${header(kind)}.mechanic_id`, `${header(kind)}.commission`, `${header(kind)}.freight`, `${header(kind)}.total`,
        `${transport(kind)}.trans_mode`, `${transport(kind)}.vehicle_no`, 'customer_ledger.debit', 'customer_ledger.balance', 'customer_ledger.notes']);
      const b = normalizeBill(kind, (await getDetail(kind, id)).body);
      ok('the view reads them back empty', b.staff_name === '' && b.mechanic_name === '' && b.commission === 0 && b.freight === 0 && b.transport_name === '' && b.vehicle_number === '', b);
      await after(`${kind} clear extras`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-6 created paid (cash): advance-free payment, saved back unchanged, deleted`, async () => {
      seed();
      const before = snap();
      const { r, id } = await createFrom(kind, `${kind}-create-paid.json`);
      const t = taxed ? 2360 : 2000;
      ok('201, paid, cash', r.status === 201 && doc(kind, id).payment_status === 1 && doc(kind, id).payment_mode === 0 && doc(kind, id).total === t, doc(kind, id));
      const p = store.customer_payments;
      ok('one bill-specific payment, ledger credit, counters', p.length === 1 && N(p[0].payment_amount) === t && p[0].payment_mode === 0
        && store.customer_ledger.filter(l => l.transaction_type === 'PAYMENT_RECEIVED' && l.reference_type === kind && l.credit === t).length === 1
        && N(store.customer_details[0].total_paid) === t, { p, l: store.customer_ledger });
      await after(`${kind} create paid`);
      // unchanged save of a paid bill: the mode fixture with the mode put back
      const body = editBody(kind, `${kind}-edit-paid-mode.json`, id);
      body.payment_mode = 0;
      const s0 = snap();
      const res = await put(kind, id, body);
      ok('unchanged save 200', res.status === 200, res.body);
      expectShape(`${kind} unchanged save of a paid bill`, diff(s0, snap()), []);
      await after(`${kind} unchanged save of a paid bill`);
      await del(kind, id);
      expectShape(`${kind} delete of a bill paid on create`, diff(before, snap()), ['customer_balance_logs+']);
      await after(`${kind} delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-7 walk-in ("Other"), paid: no account, nothing posted; name edited; deleted`, async () => {
      seed();
      const before = snap();
      const { r, id } = await createFrom(kind, `${kind}-create-other.json`);
      const t = taxed ? 1680 : 1500;
      ok('201, customer 0, paid', r.status === 201 && doc(kind, id).select_customer === 0 && doc(kind, id).payment_status === 1 && doc(kind, id).total === t, doc(kind, id));
      const s = store[billTo(kind)].find(x => x.invoice_no === id);
      ok('snapshot holds the walk-in', s.billing_name === 'Walk-in Kumar' && s.contact_no === '9999999999' && s.billing_address === 'Bus Stand' && s.billing_city === 'Mathura' && s.billing_state_code === 9, s);
      ok('no ledger, payment, allocation, counter (owner)', !store.customer_ledger.length && !store.customer_payments.length && !store.customer_payment_allocations.length && !store.customer_balance_logs.length);
      ok('stock out', stockOf(4) === 999);
      ok('create response names the walk-in', r.body.sale.customer_name === 'Walk-in Kumar', r.body);
      await after(`${kind} create walk-in`);
      const b = normalizeBill(kind, (await getDetail(kind, id)).body);
      ok('edit form reads the walk-in as party 0 with its own details', b.party.id === 0 && b.party.name === 'Walk-in Kumar' && b.party.contact === '9999999999' && b.party.state === 'Uttar Pradesh', b.party);
      const s0 = snap();
      const res = await put(kind, id, editBody(kind, `${kind}-edit-other-name.json`, id));
      ok('name edit 200', res.status === 200, res.body);
      ok('snapshot name changed', store[billTo(kind)].find(x => x.invoice_no === id).billing_name === 'Walk-in Kumar Singh');
      expectShape(`${kind} walk-in name edit`, diff(s0, snap()), [`${billTo(kind)}.billing_name`, `${shipTo(kind)}.shipping_name`]);
      await after(`${kind} walk-in name edit`);
      await del(kind, id);
      expectShape(`${kind} walk-in delete`, diff(before, snap()), []);
      await after(`${kind} walk-in delete`);
      expect(stats.failures).toEqual([]);
    });

    test(`RB-${kind}-8 list as the screen asks (customer + status filter) and delete from the list`, async () => {
      seed();
      const a = await createFrom(kind, `${kind}-create.json`);
      await createFrom(kind, `${kind}-create-paid.json`);
      await createFrom(kind, `${kind}-create-other.json`);
      const q = fx(`${kind}-list-query.json`).query;
      ok('the list sends customer and status under the names the API reads', q.customer === '1' && q.status === '0' && q.sortBy === 'invoice_date' && q.sortOrder === 'desc', q);
      const l = await call(api(kind).col, 'GET', q);
      ok('one unpaid bill of Ravi', l.status === 200 && (l.body.data || []).length === 1 && l.body.data[0].id === a.id && l.body.pagination.total === 1, l.body);
      const other = await call(api(kind).col, 'GET', { page: '1', limit: '50', customer: '0' });
      ok('"Other" filter finds the walk-in under its own name', (other.body.data || []).length === 1 && other.body.data[0].customer_name === 'Walk-in Kumar', other.body.data);
      const byNo = await call(api(kind).col, 'GET', { page: '1', limit: '50', uid: '2' });
      ok('invoice number filter', (byNo.body.data || []).length === 1 && byNo.body.data[0].invoice_no === 2, byNo.body.data);
      const dates = await call(api(kind).col, 'GET', { page: '1', limit: '50', startDate: '2026-10-02', endDate: '2026-10-02' });
      ok('date range is whole India days', (dates.body.data || []).length === 1 && dates.body.data[0].id === a.id, dates.body.data);
      const sorted = await call(api(kind).col, 'GET', { page: '1', limit: '50', sortBy: 'customer_name', sortOrder: 'asc' });
      ok('sort by customer name', JSON.stringify((sorted.body.data || []).map(r => r.customer_name)) === JSON.stringify(['Ravi', 'Ravi', 'Walk-in Kumar']), sorted.body.data);
      // Every other filter, with the parameters built by the list's own hook (billListParams).
      const F = (patch) => Object.fromEntries(billListParams(kind, { ...EMPTY_BILL_FILTERS, page: 1, limit: 50, ...patch }).entries());
      const ids = async (patch) => ((await call(api(kind).col, 'GET', F(patch))).body.data || []).map(r => r.id).sort((a, b) => a - b);
      const [idA, idG, idH] = [a.id, doc(kind, a.id + 1) ? a.id + 1 : null, doc(kind, a.id + 2) ? a.id + 2 : null];
      ok('three bills, ids in order', idG && idH, [idA, idG, idH]);
      ok('bill reference', JSON.stringify(await ids({ billReference: 'br-7' })) === JSON.stringify([idA]));
      ok('item count (exact)', JSON.stringify(await ids({ itemCount: '2' })) === JSON.stringify([idA]));
      ok('total (exact)', JSON.stringify(await ids({ total: String(doc(kind, idG).total) })) === JSON.stringify([idG]));
      if (taxed) ok('tax amount', JSON.stringify(await ids({ totalTax: '342' })) === JSON.stringify([idA]));
      ok('P&F total', JSON.stringify(await ids({ packingForwardingTotal: '100' })) === JSON.stringify([idA]));
      if (!taxed) ok('notes (Invoice C list only)', JSON.stringify(await ids({ notes: 'noon' })) === JSON.stringify([idA]));
      ok('status Paid', JSON.stringify(await ids({ statusFilter: '1' })) === JSON.stringify([idG, idH]));
      ok('mode Bank finds none (all were saved with the form default, Cash)', JSON.stringify(await ids({ paymentMode: '1' })) === JSON.stringify([]));
      const byTotal = ((await call(api(kind).col, 'GET', F({ sortBy: 'total', sortOrder: 'desc' }))).body.data || []).map(r => r.total);
      ok('sort by total, newest-first default otherwise', JSON.stringify(byTotal) === JSON.stringify([...byTotal].sort((x, y) => y - x)), byTotal);
      const p2 = (await call(api(kind).col, 'GET', { ...F({}), limit: '1', page: '2' })).body;
      ok('paging: page 2 of 3 by date, newest first', p2.pagination.total === 3 && p2.pagination.totalPages === 3 && (p2.data || []).length === 1, p2.pagination);
      const f = fx(`${kind}-delete.json`);
      ok('delete is a bare DELETE on the bill', f.method === 'DELETE' && f.body === undefined && /\/api\/(sales|salex)\/\d+$/.test(f.url), f);
      const d = await del(kind, a.id);
      ok('deleted', d.status === 200 && !doc(kind, a.id));
      await after(`${kind} list delete`);
      expect(stats.failures).toEqual([]);
    });
  }

  test('RB-both sale and Invoice C share ids: every write stays with its own kind', async () => {
    seed();
    const s = await createFrom('sale', 'sale-create.json');
    const x = await createFrom('salex', 'salex-create.json');
    ok('same id in both tables', s.id === x.id, [s.id, x.id]);
    const id = s.id;
    await after('both created');
    // Invoice C paid on its edit form
    let res = await put('salex', id, editBody('salex', 'salex-edit-paid.json', id));
    ok('salex paid', res.status === 200 && doc('salex', id).payment_status === 1 && doc('sale', id).payment_status === 0);
    ok('allocation on invoicex only', store.customer_payment_allocations.length === 1 && store.customer_payment_allocations[0].invoicex_id === id && !store.customer_payment_allocations[0].invoice_id);
    await after('salex paid');
    // the sale's qty edited: only the sale's rows move
    const xl = JSON.stringify(docLines('salex', id));
    res = await put('sale', id, editBody('sale', 'sale-edit-qty.json', id));
    ok('sale qty edit leaves the Invoice C lines and its ledger row alone', res.status === 200 && JSON.stringify(docLines('salex', id)) === xl
      && store.customer_ledger.find(l => l.reference_type === 'salex' && l.transaction_type === 'SALE').debit === 2870
      && store.customer_ledger.find(l => l.reference_type === 'sale' && l.transaction_type === 'SALE').debit === 4392, store.customer_ledger);
    await after('sale qty edit');
    // Mark as Paid on the sale (modal), then delete the Invoice C: the sale's payment stays
    const mp = structuredClone(fx('sale-markpaid.json').body); mp.allocations[0].invoice_id = id;
    await call(H.cpCreate, 'POST', {}, mp);
    ok('sale part paid', doc('sale', id).payment_status === 2);
    res = await del('salex', id);
    ok('salex deleted, sale and its payment intact', res.status === 200 && !doc('salex', id) && doc('sale', id) && store.customer_payment_allocations.length === 1 && store.customer_payment_allocations[0].invoice_id === id
      && store.customer_ledger.every(l => l.reference_type !== 'salex'), { a: store.customer_payment_allocations, l: store.customer_ledger });
    await after('salex deleted');
    res = await del('sale', id);
    ok('sale deleted: nothing left', res.status === 200 && !store.invoice.length && !store.customer_payments.length && !store.customer_ledger.length, store.customer_ledger);
    await after('sale deleted');
    expect(stats.failures).toEqual([]);
  });
});
