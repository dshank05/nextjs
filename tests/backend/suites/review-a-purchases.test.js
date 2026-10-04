// Reviewer A - Purchases (docs/REVIEW_PLAN.md, docs/review/purchases.md).
// The bodies sent here are the purchase screens' own: captured by rendering the real screens in
// the jsdom page harness (harness/review-a-capture.jsx) and saved as fixtures/purchases/*.json.
// Each round trip: create -> read as the edit form reads it (GET detail through hooks/useBills
// normalizeBill and the form's own payload rules) -> save back unchanged -> edit one field ->
// delete, with A1-A14 (checkAll) and the 16 report checks (checkReports) after every step, plus
// hand-worked figures for every place the purchase must show up (connectedness).
// A behaviour that is wrong today is a test.failing named with its finding id (A-01...).
import fs from 'fs';
import path from 'path';
import { K, store, call, sum, r2, N, H, rows, bal, billNet, payRows, allocs, paidOn, lines, bill, payments, stock, counters, D, ex, snapshot, pay } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, RANGE } from '../support/flowlib.js';
import { normalizeBill, billListParams, EMPTY_BILL_FILTERS } from '../../../hooks/useBills';
import { getLocalDateString, convertDateToTimestamp } from '../../../lib/date-utils';
import { packingAmount, parseNum } from '../../../lib/line-math';
import dashboard from '../../../pages/api/dashboard/index';
import lastInvoice from '../../../pages/api/purchases/last-invoice';

const k = K.purchase;
const FIX = path.join(__dirname, '../fixtures/purchases');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

// ------------------------------------------------------------------ the shop, as the harness seeded it
const zero = { total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0, account_balance: 0 };
function seed() {
  reset();
  Object.assign(store.vendor_details[1], { vendor_name: 'Bosch', state: 'Uttar Pradesh', state_code: 9, contact_no: '1', email: 'b@x.in', tax_id: '09BOSCH1234F1Z5', address: 'Noida', city: 'Noida', pin_code: '201301' });
  Object.assign(store.vendor_details[2], { state: 'Delhi', state_code: 7 });
  store.staff = [{ id: 3, name: 'Ramesh', phone: '98' }];
  const extra = {
    1: { display_name: 'Brake Pad Alto', part_no: 'BP-1', latest_purchase_rate: 900, company_id: 7 },
    2: { display_name: 'Clutch Plate Swift', part_no: 'CP-2', latest_purchase_rate: 500, company_id: 7 },
    3: { display_name: 'Oil Filter', part_no: 'OF-3', latest_purchase_rate: 200, company_id: null }
  };
  // MySQL rows carry NULL, not a missing key: the in-memory store only matches `null` on a present null.
  for (const p of store.product) Object.assign(p, { stock: 1000, opening_stock: 1000, last_purchase_date: null }, extra[p.id]);
  stats.failures = [];
}
// Prisma returns a DateTime column as a Date; the in-memory store keeps the ISO string that was written.
const prismaDates = () => { for (const p of store.purchase) if (typeof p.bill_reference_date === 'string') p.bill_reference_date = new Date(p.bill_reference_date); };
const after = async (step, known = []) => { prismaDates(); await checkAll(step, known); await checkReports(step); };
const finish = () => expect(stats.failures).toEqual([]);

// ------------------------------------------------------------------ writing through the routes with the screens' bodies
const POST = async (body) => { const r = await call(k.create, 'POST', {}, body); prismaDates(); return { r, id: r.body?.purchase?.id }; };
const PUT = async (id, body) => { const r = await call(k.one, 'PUT', { id: String(id) }, body); prismaDates(); return r; };
const DEL = async (id) => call(k.one, 'DELETE', { id: String(id) });
const GET = async (id) => { prismaDates(); return call(k.one, 'GET', { id: String(id) }); };
/** A captured edit body re-pointed at this run's line ids (the capture's ids were the harness's). */
const relined = (body, id) => { const have = lines(k, id); return { ...body, items: body.items.map((it, i) => (it.line_id !== undefined ? { ...it, line_id: have[i].id } : it)) }; };

/**
 * What the edit form sends for a bill it loaded and the user did not touch: BillForm's populate
 * effect + buildPayload (edit mode: no vendor_id; payment_status only when the user picked one).
 * Mirrored here so a backend test can do the read -> save-back step; test "form mirror" proves it
 * equals the body the real screen sent.
 */
function formPayload(d) {
  const b = normalizeBill('purchase', d);
  const enableTax = b.items.some(l => l.gst_percentage > 0) || b.total_tax > 0;
  const pfRate = b.packing_rate || (b.packing_qty > 0 ? b.packing_total / b.packing_qty : 0);
  const packing = packingAmount(b.packing_qty ? String(b.packing_qty) : '', pfRate ? String(pfRate) : '', b.packing_total ? String(b.packing_total) : '');
  const freight = b.freight ? String(b.freight) : '';
  const p = b.party;
  return {
    date: b.invoice_date ? getLocalDateString(new Date(b.invoice_date * 1000)) : '',
    bill_reference: b.bill_reference,
    staff_id: b.staff_id ? parseInt(String(b.staff_id), 10) : null,
    transport_name: b.transport_name,
    vehicle_number: b.vehicle_number,
    transport_cost: parseNum(freight),
    descriptions: b.descriptions,
    notes: b.notes,
    packing_forwarding_qty: packing.qty,
    packing_forwarding_rate: packing.rate,
    payment_mode: b.payment_mode ?? 0,
    contact_number: p.contact, email_id: p.email, gst_number: p.gstin, address: p.address, address_2: p.address_2,
    city: p.city, state: p.state, state_code: p.state_code,
    bill_reference_date: b.bill_reference_date,
    vendor_name: p.name,
    pin_code: p.pin_code,
    items: b.items.map(l => ({ ...(l.line_id ? { line_id: l.line_id } : {}), product_id: l.product_id, model_id: l.model_id, company_id: l.company_id, part: l.part, qty: l.qty, rate: l.rate, gst_percentage: enableTax ? l.gst_percentage : 0, car_model: l.car_model }))
  };
}

// ------------------------------------------------------------------ what changed, table by table
const snap = () => JSON.parse(JSON.stringify(store));
function changes(before, now, skip = []) {
  const out = [];
  for (const t of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (skip.includes(t) || !Array.isArray(before[t] ?? []) || !Array.isArray(now[t] ?? [])) continue;
    const key = (r, i) => (r && r.id !== undefined ? r.id : `#${i}`);
    const A = new Map((before[t] || []).map((r, i) => [key(r, i), r])), B = new Map((now[t] || []).map((r, i) => [key(r, i), r]));
    for (const id of A.keys()) if (!B.has(id)) out.push(`${t}#${id} removed`);
    for (const id of B.keys()) if (!A.has(id)) out.push(`${t}#${id} added`);
    for (const [id, r] of B) {
      const o = A.get(id); if (!o) continue;
      for (const c of new Set([...Object.keys(o), ...Object.keys(r)])) if (JSON.stringify(o[c] ?? null) !== JSON.stringify(r[c] ?? null)) /* a column never set is NULL, as in MySQL (merge, 2026-10-04) */ out.push(`${t}#${id}.${c}: ${JSON.stringify(o[c])} -> ${JSON.stringify(r[c])}`);
    }
  }
  return out;
}
const cols = (list) => Array.from(new Set(list.map(s => s.replace(/#\d+/, '').replace(/:.*$/, '')))).sort();

// ------------------------------------------------------------------ every place a purchase shows up
const report = async (h, q = RANGE) => (await call(h, 'GET', q)).body;
async function places(id, vendorId = 1) {
  const pr = (await report(H.purchaseR)).summary || {};
  const gst = (await report(H.gstR)).input || {};
  const out = (await report(H.vendOut, { page: '1', limit: '500' }))?.outstandingVendors?.find(v => v.vendor_id === vendorId) || null;
  const led = (await report(H.vendLedger, { vendor_id: String(vendorId), page: '1', limit: '500' }))?.entries || [];
  const cb = (await report(H.cashBookR)).totals || {};
  const st = (await report(H.stockR)).products || [];
  const list = (await report(k.list, { page: '1', limit: '50', sortBy: 'invoice_date', sortOrder: 'desc' }))?.data || [];
  const det = id ? (await GET(id)).body : null;
  return { pr, gst, out, led, cb, st, row: list.find(x => x.id === id) || null, list, det };
}

// ==================================================================================== round trips
describe('A - purchase round trips from the screens\' own payloads', () => {
  test('form mirror: GET detail through normalizeBill gives the body the edit screen sent (captured)', async () => {
    seed();
    const { r, id } = await POST(fx('create-paid.json'));
    ex('mirror', 'created', r.status === 201, r.body);
    const d = (await GET(id)).body;
    // The captured edit changed only notes; with notes put back it is the untouched form.
    const captured = { ...relined(fx('edit-notes.json'), id), notes: 'first bill' };
    ex('mirror', 'the mirror builds the screen\'s body field for field', JSON.stringify(Object.keys(formPayload(d)).sort()) === JSON.stringify(Object.keys(captured).sort()), [Object.keys(formPayload(d)), Object.keys(captured)]);
    expect(formPayload(d)).toEqual(captured);
    // and the stored detail is what the harness read back (ids aside)
    const det = fx('detail-after-create.json');
    expect({ ...d, id: det.id, items: d.items.map((it, i) => ({ ...it, id: det.items[i].id, line_id: det.items[i].line_id })), payment_history: [], bill_to: null, staff: null })
      .toEqual({ ...det, payment_history: [], bill_to: null, staff: null });
    finish();
  });

  test('R1 paid purchase (Bosch, intra-state, tax, freight, P&F, staff, bank): create -> read -> unchanged -> notes -> qty -> delete', async () => {
    seed();
    const s0 = snap();
    const day = convertDateToTimestamp('2026-10-02');
    // ---- create
    const { r, id } = await POST(fx('create-paid.json'));
    ex('R1 create', '201 with id, number 1, total, vendor name', r.status === 201 && r.body.purchase.invoice_no === 1 && r.body.purchase.total === 13400 && r.body.purchase.vendor_name === 'Bosch', r.body);
    const b = bill(k, id);
    // field by field: screen field -> payload key -> column
    const want = {
      invoice_no: 1, fy: 4, vendor_id: 1, invoice_date: day, bill_reference: 'BR-77', staff_id: 3, transport: 'VRL', transport_name: 'VRL', vehicle_number: '3',
      freight: 500, packing_forwarding_qty: 1, packing_forwarding_rate: 100, packing_forwarding_total: 100, items_total: 11000, total_taxable_value: 11000,
      total_cgst: 900, total_sgst: 900, total_igst: 0, total_tax: 1800, total: 13400, notes: 'first bill', descriptions: 'monthly stock',
      payment_status: 1, payment_mode: 1, return_status: 0
    };
    for (const [c, v] of Object.entries(want)) ex('R1 create', `purchase.${c} = ${JSON.stringify(v)}`, b[c] === v, b[c]);
    ex('R1 create', 'purchase.bill_reference_date = 2026-10-01 (UTC midnight of the picked day)', b.bill_reference_date instanceof Date && b.bill_reference_date.toISOString().slice(0, 10) === '2026-10-01', b.bill_reference_date);
    const bt = store.bill_to.find(x => x.purchase_id === id);
    ex('R1 create', 'bill_to snapshot = the vendor block the form showed', bt && bt.vendor_name === 'Bosch' && bt.contact_no === '1' && bt.email === 'b@x.in' && bt.gstin === '09BOSCH1234F1Z5' && bt.address === 'Noida' && bt.address2 === '' && bt.city === 'Noida' && bt.state === 'Uttar Pradesh' && bt.state_code === 9 && bt.pin_code === '201301' && bt.invoice_no === 1 && bt.fy === 4, bt);
    const [l1, l2] = lines(k, id);
    ex('R1 create', 'line 1: Brake Pad 10 x 1000, 18% -> 1800 (900/900), model Alto, company 7, part BP-1', l1.name_of_product === 'Brake Pad' && l1.qty === 10 && l1.rate === 1000 && l1.subtotal === 10000 && l1.gst_percentage === 18 && l1.tax === 1800 && l1.cgst === 900 && l1.sgst === 900 && l1.igst === 0 && l1.model_id === 1 && l1.car_model === 'Alto' && l1.company_id === 7 && l1.part === 'BP-1' && l1.vendor_id === 1 && l1.fy === 4 && l1.invoice_date === day && l1.category_id === 1, l1);
    ex('R1 create', 'line 2: Oil Filter 5 x 200, 0%', l2.qty === 5 && l2.rate === 200 && l2.subtotal === 1000 && l2.tax === 0 && l2.company_id === null && l2.part === 'OF-3', l2);
    ex('R1 create', 'stock in: +10 / +5; latest purchase rate and date follow the bill', stock(1) === 1010 && stock(3) === 1005 && store.product[0].latest_purchase_rate === 1000 && store.product[0].last_purchase_date === day && store.product[2].latest_purchase_rate === 200, store.product);
    const p = payments(k);
    ex('R1 create', 'one BILL_SPECIFIC payment 13400, bank, on the bill date, FY 4, allocated in full', p.length === 1 && p[0].payment_amount === 13400 && p[0].payment_mode === 1 && p[0].payment_type === 'BILL_SPECIFIC' && p[0].payment_date === day && p[0].fy === 4 && paidOn(k, id) === 13400 && allocs(k, id).length === 1, { p, a: allocs(k, id) });
    ex('R1 create', 'ledger: PURCHASE debit 13400, PAYMENT credit 13400 (bank, tied to the payment), balance 0', billNet(k, id) === 13400 && payRows(k).length === 1 && payRows(k)[0].credit === 13400 && payRows(k)[0].payment_mode === 1 && payRows(k)[0].transaction_id === p[0].id && bal(k) === 0, rows(k));
    ex('R1 create', 'counters paid 13400 / allocated 13400; two balance-log rows', counters(k).paid === 13400 && counters(k).alloc === 13400 && store.vendor_balance_logs.length === 2, { c: counters(k), l: store.vendor_balance_logs });
    await after('R1 create');
    let w = await places(id);
    ex('R1 create', 'purchase report: 1 bill, 13400, tax 1800, paid 1, units 15', w.pr.totalSales === 1 && w.pr.totalRevenue === 13400 && w.pr.tax === 1800 && w.pr.paidSales === 1 && w.pr.totalItems === 15, w.pr);
    ex('R1 create', 'GST input: 1 bill, CGST 900 + SGST 900, total 13400', w.gst.count === 1 && w.gst.cgst === 900 && w.gst.sgst === 900 && !w.gst.igst && w.gst.total === 13400, w.gst);
    ex('R1 create', 'vendor outstanding: Bosch square, not listed', w.out === null, w.out);
    ex('R1 create', 'vendor ledger account: 2 rows, closing 0', w.led.length === 2 && w.led.at(-1).balance === 0, w.led);
    ex('R1 create', 'cash book: 13400 out by bank', w.cb.out === 13400 && w.cb.bankNet === -13400 && w.cb.cashNet === 0, w.cb);
    ex('R1 create', 'stock report: Brake Pad closes at 1010', w.st.find(x => x.product_id === 1)?.closing_qty === 1010, w.st.find(x => x.product_id === 1));
    ex('R1 create', 'list row: Bosch, 2 items, paid, bank, nothing left', w.row && w.row.vendor_name === 'Bosch' && w.row.item_count === 2 && w.row.payment_status === 1 && w.row.payment_mode === 1 && w.row.total_paid === 13400 && w.row.remaining_amount === 0 && w.row.bill_reference === 'BR-77', w.row);
    // (the list's bill_reference_date is not checked here: the SQLite mirror hands a DateTime back as
    // seconds where MySQL gives a Date - a harness limit, see docs/review/purchases.md)
    ex('R1 create', 'detail: paid 13400, nothing left, one payment shown as Bank', w.det.payment_summary.total_paid === 13400 && w.det.payment_summary.remaining_amount === 0 && w.det.payment_history.length === 1 && w.det.payment_history[0].payment_mode_text === 'Bank', w.det.payment_summary);
    const dash = (await call(dashboard, 'GET', { today: '2026-10-02', purchasesDate: '2026-10-02' })).body;
    ex('R1 create', 'dashboard: 1 purchase, 13400 that day, last purchase no 1', dash.totals.purchases === 1 && dash.today.purchases === 13400 && dash.purchasesDay.total === 13400 && dash.lastPurchase.invoiceNo === 1, dash);
    const next = (await call(lastInvoice, 'GET', {})).body;
    ex('R1 create', 'next number offered: 2 in FY 4', next.nextInvoiceNumber === 2 && next.fy === 4, next);

    // ---- read as the edit form reads it, save back unchanged: nothing may change
    const s1 = snap();
    const unchanged = formPayload((await GET(id)).body);
    let e = await PUT(id, unchanged);
    ex('R1 unchanged', '200', e.status === 200, e.body);
    ex('R1 unchanged', 'no table changed', changes(s1, snap()).length === 0, changes(s1, snap()));
    await after('R1 unchanged');

    // ---- edit one field (notes): only purchase.notes changes
    const s2 = snap();
    e = await PUT(id, relined(fx('edit-notes.json'), id));
    ex('R1 notes', '200', e.status === 200, e.body);
    ex('R1 notes', 'only purchase.notes changed', JSON.stringify(changes(s2, snap())) === JSON.stringify([`purchase#${id}.notes: "first bill" -> "first bill, checked"`]), changes(s2, snap()));
    await after('R1 notes');

    // ---- edit one line's qty (10 -> 12): the line, the totals, stock, ledger, status; money untouched
    const s3 = snap();
    e = await PUT(id, relined(fx('edit-qty.json'), id));
    ex('R1 qty', '200', e.status === 200, e.body);
    const ch = changes(s3, snap());
    const allowed = ['product.stock', 'purchase.items_total', 'purchase.total_taxable_value', 'purchase.total_cgst', 'purchase.total_sgst', 'purchase.total_tax', 'purchase.total', 'purchase.payment_status',
      'purchaseitems.qty', 'purchaseitems.subtotal', 'purchaseitems.tax', 'purchaseitems.cgst', 'purchaseitems.sgst', 'vendor_ledger.debit', 'vendor_ledger.notes', 'vendor_ledger.balance'];
    ex('R1 qty', 'only the line, the bill\'s totals and status, stock and the ledger moved', cols(ch).every(c => allowed.includes(c)), ch);
    const b2 = bill(k, id);
    ex('R1 qty', 'total 15760 (12000 + 2160 tax + 1000 + 100 + 500), part paid (owner: no automatic payment)', b2.total === 15760 && b2.total_tax === 2160 && b2.payment_status === 2, b2);
    ex('R1 qty', 'stock +2; payment, allocation and counters untouched; 2360 owed', stock(1) === 1012 && paidOn(k, id) === 13400 && counters(k).paid === 13400 && counters(k).alloc === 13400 && bal(k) === 2360, { s: stock(1), c: counters(k), l: rows(k) });
    await after('R1 qty');
    w = await places(id);
    ex('R1 qty', 'outstanding 2360; list row part paid with 2360 left; detail agrees', w.out?.balance === 2360 && w.row.payment_status === 2 && w.row.remaining_amount === 2360 && w.det.payment_summary.remaining_amount === 2360, { o: w.out, r: w.row });
    ex('R1 qty', 'purchase report: part paid 1, 13400 -> 15760; GST input 2160', w.pr.partiallyPaidSales === 1 && w.pr.totalRevenue === 15760 && w.gst.tax === 2160, { pr: w.pr, g: w.gst });

    // ---- delete: everything it wrote is gone or rolled back
    const d = await DEL(id);
    ex('R1 delete', '200', d.status === 200, d.body);
    const left = changes(s0, snap(), ['vendor_balance_logs']).filter(c => !/^product#\d+\.(latest_purchase_rate|last_purchase_date)/.test(c));
    ex('R1 delete', 'every table back to before the create (product latest rate aside: A-09)', left.length === 0, left);
    for (const c of ['total_paid', 'total_allocated']) ex('R1 delete', `balance logs net to 0 on ${c}`, Math.abs(sum(store.vendor_balance_logs.filter(l => l.column_name === c), l => N(l.change_amount))) < 0.005, store.vendor_balance_logs);
    await after('R1 delete');
    w = await places(null);
    ex('R1 delete', 'reports empty: no purchase, no GST input, no cash out, stock 1000', w.pr.totalSales === 0 && !N(w.gst.count) && !N(w.cb.out) && w.st.find(x => x.product_id === 1)?.closing_qty === 1000 && w.list.length === 0, { pr: w.pr, cb: w.cb });
    finish();
  });

  test('R2 unpaid purchase (Delhi Parts, tax off): create -> read -> unchanged -> Mark as Paid 4000 -> Unpaid -> Paid -> delete', async () => {
    seed();
    const s0 = snap();
    const { r, id } = await POST(fx('create-unpaid.json'));
    const day = convertDateToTimestamp('2026-10-04');
    ex('R2 create', '201; 8 x 1250 = 10000, no tax (tax off), unpaid; payment_mode stored 0 although nothing was paid', r.status === 201 && bill(k, id).total === 10000 && bill(k, id).total_tax === 0 && bill(k, id).payment_status === 0 && bill(k, id).payment_mode === 0, bill(k, id));
    ex('R2 create', 'empty optional fields stored as empty text', bill(k, id).notes === '' && bill(k, id).bill_reference === '' && bill(k, id).bill_reference_date === null && bill(k, id).transport === '' && bill(k, id).vehicle_number === '' && bill(k, id).descriptions === '', bill(k, id));
    ex('R2 create', 'no payment; ledger 10000 owed; counters 0', payments(k, 2).length === 0 && bal(k, 2) === 10000 && counters(k, 2).paid === 0, rows(k, 2));
    await after('R2 create');
    let w = await places(id, 2);
    ex('R2 create', 'outstanding 10000; list row unpaid, 10000 left', w.out?.balance === 10000 && w.row.payment_status === 0 && w.row.remaining_amount === 10000, { o: w.out, r: w.row });

    // ---- unchanged save: only the empty-text columns move ('' -> null, A-06)
    const s1 = snap();
    let e = await PUT(id, formPayload((await GET(id)).body));
    ex('R2 unchanged', '200', e.status === 200, e.body);
    const ch = changes(s1, snap());
    ex('R2 unchanged', 'nothing changed except the A-06 empty-text columns', ch.every(c => /^purchase#\d+\.(notes|bill_reference|descriptions|transport|transport_name|vehicle_number): "" -> null$/.test(c)), ch);
    await after('R2 unchanged');

    // ---- Mark as Paid on the view: a 4000 part payment (the modal's own body)
    const body = fx('mark-paid-part.json');
    const mp = await call(H.vpCreate, 'POST', {}, { ...body, allocations: body.allocations.map(a => ({ ...a, purchase_id: id })) });
    ex('R2 mark paid', '201; BILL_SPECIFIC 4000 bank dated 2026-10-04, allocated; bill part paid', mp.status === 201 && payments(k, 2).length === 1 && payments(k, 2)[0].payment_type === 'BILL_SPECIFIC' && payments(k, 2)[0].payment_mode === 1 && payments(k, 2)[0].payment_date === day && paidOn(k, id) === 4000 && bill(k, id).payment_status === 2, { r: mp.body, p: payments(k, 2) });
    ex('R2 mark paid', 'ledger: PAYMENT 4000 on the bill; 6000 owed; counters 4000 / 4000', bal(k, 2) === 6000 && payRows(k, 2).length === 1 && payRows(k, 2)[0].reference_type === 'purchase' && payRows(k, 2)[0].reference_id === id && counters(k, 2).paid === 4000 && counters(k, 2).alloc === 4000, rows(k, 2));
    await after('R2 mark paid');
    w = await places(id, 2);
    ex('R2 mark paid', 'cash book 4000 out by bank; outstanding 6000; detail 4000 paid 6000 left', w.cb.out === 4000 && w.cb.bankNet === -4000 && w.out?.balance === 6000 && w.det.payment_summary.total_paid === 4000 && w.det.payment_summary.remaining_amount === 6000 && w.det.payment_status === 2, { cb: w.cb, o: w.out, s: w.det.payment_summary });

    // ---- the edit form: Partially Paid -> Unpaid (the screen's body): complete rollback of the payment
    e = await PUT(id, relined(fx('edit-unmark.json'), id));
    ex('R2 unpaid', '200; unpaid; payment, allocation and its ledger row gone; counters 0; 10000 owed', e.status === 200 && bill(k, id).payment_status === 0 && payments(k, 2).length === 0 && allocs(k, id).length === 0 && payRows(k, 2).length === 0 && counters(k, 2).paid === 0 && counters(k, 2).alloc === 0 && bal(k, 2) === 10000, { r: e.body, p: payments(k, 2), l: rows(k, 2), c: counters(k, 2) });
    await after('R2 unpaid');

    // ---- the edit form: Unpaid -> Paid (Cash, the loaded mode): one BILL_SPECIFIC payment for the bill
    e = await PUT(id, relined(fx('edit-mark-paid.json'), id));
    const p = payments(k, 2);
    ex('R2 paid', '200; paid; BILL_SPECIFIC 10000 cash allocated; ledger square; counters 10000', e.status === 200 && bill(k, id).payment_status === 1 && p.length === 1 && p[0].payment_amount === 10000 && p[0].payment_mode === 0 && p[0].payment_type === 'BILL_SPECIFIC' && paidOn(k, id) === 10000 && bal(k, 2) === 0 && counters(k, 2).paid === 10000 && counters(k, 2).alloc === 10000, { r: e.body, p, l: rows(k, 2), c: counters(k, 2) });
    await after('R2 paid');
    w = await places(id, 2);
    ex('R2 paid', 'cash book 10000 out in cash; list row paid; vendor square', w.cb.out === 10000 && w.cb.cashNet === -10000 && w.row.payment_status === 1 && w.out === null, { cb: w.cb, r: w.row });

    // ---- delete
    const d = await DEL(id);
    ex('R2 delete', '200', d.status === 200, d.body);
    const left = changes(s0, snap(), ['vendor_balance_logs']).filter(c => !/^product#\d+\.(latest_purchase_rate|last_purchase_date)/.test(c));
    ex('R2 delete', 'every table back to before the create', left.length === 0, left);
    for (const c of ['total_paid', 'total_allocated']) ex('R2 delete', `balance logs net to 0 on ${c}`, Math.abs(sum(store.vendor_balance_logs.filter(l => l.column_name === c), l => N(l.change_amount))) < 0.005);
    await after('R2 delete');
    finish();
  });

  test('R3 "Other" vendor (manual name, Delhi -> IGST): create -> read -> unchanged -> delete', async () => {
    seed();
    const s0 = snap();
    const { r, id } = await POST(fx('create-other-unpaid.json'));
    const b = bill(k, id), bt = store.bill_to.find(x => x.purchase_id === id);
    ex('R3 create', '201; vendor 0; 4 x 500 + IGST 360 = 2360', r.status === 201 && b.vendor_id === 0 && b.total === 2360 && b.total_igst === 360 && !b.total_cgst && r.body.purchase.vendor_name === 'Other', { b, r: r.body });
    ex('R3 create', 'the bill keeps the typed supplier: Walk-in Supplier, 9999999999, Karol Bagh, Delhi (7)', bt.vendor_name === 'Walk-in Supplier' && bt.contact_no === '9999999999' && bt.address === 'Karol Bagh' && bt.state === 'Delhi' && bt.state_code === 7, bt);
    ex('R3 create', '"Other" is a real vendor row: PURCHASE posts to vendor 0, 2360 owed', billNet(k, id) === 2360 && bal(k, 0) === 2360, rows(k, 0));
    await after('R3 create');
    const w = await places(id, 0);
    ex('R3 create', 'list and detail show the bill\'s own supplier; outstanding lists vendor 0', w.row.vendor_name === 'Walk-in Supplier' && w.det.vendor.vendor_name === 'Walk-in Supplier' && w.out?.balance === 2360, { r: w.row, v: w.det.vendor, o: w.out });
    ex('R3 create', 'GST input: IGST 360', w.gst.igst === 360, w.gst);
    const s1 = snap();
    const e = await PUT(id, formPayload(w.det));
    const ch = changes(s1, snap());
    ex('R3 unchanged', '200; nothing changed except the A-06 empty-text columns', e.status === 200 && ch.every(c => /^purchase#\d+\.(notes|bill_reference|descriptions|transport|transport_name|vehicle_number): "" -> null$/.test(c)), { r: e.body, ch });
    await after('R3 unchanged');
    const d = await DEL(id);
    const left = changes(s0, snap(), ['vendor_balance_logs']).filter(c => !/^product#\d+\.(latest_purchase_rate|last_purchase_date)/.test(c));
    ex('R3 delete', '200; every table back', d.status === 200 && left.length === 0, { r: d.body, left });
    await after('R3 delete');
    finish();
  });
});

// ==================================================================================== list
describe('A - purchase list with the screen\'s own query strings', () => {
  test('L1 default query opens newest first; the filter query the screen sent selects the right rows', async () => {
    seed();
    const ids = [];
    for (const [date, vendor, status, ref] of [['2026-10-02', 1, 1, 'BR-1'], ['2026-10-05', 2, 1, 'BR-2'], ['2026-10-03', 2, 0, 'BR-3'], ['2026-10-05', 2, 1, 'XX-4']]) {
      const base = vendor === 1 ? fx('create-paid.json') : fx('create-unpaid.json');
      ids.push((await POST({ ...base, date, payment_status: status, payment_mode: 0, bill_reference: ref, items: base.items.slice(0, 1) })).id);
    }
    const q = fx('list-default-query.json');
    ex('L1', 'the hook builds exactly the captured default query', JSON.stringify(Object.fromEntries(billListParams('purchase', { ...EMPTY_BILL_FILTERS, page: 1, limit: 50 }).entries())) === JSON.stringify(q), q);
    const all = (await call(k.list, 'GET', q)).body.data.map(x => x.id);
    ex('L1', 'newest first: the two 5 Oct bills (later entry first), then 3 Oct, then 2 Oct', JSON.stringify(all) === JSON.stringify([ids[3], ids[1], ids[2], ids[0]]), all);
    const f = (await call(k.list, 'GET', fx('list-filter-query.json'))).body.data.map(x => x.id);
    ex('L1', 'vendor 2 + paid + reference "BR": only BR-2', JSON.stringify(f) === JSON.stringify([ids[1]]), f);
    await after('L1', ['A2']); // F-02: bills entered out of date order
    finish();
  });
});

// ==================================================================================== refusals the screen shows
describe('A - refusals (each leaves every table as it was)', () => {
  const refuse = async (name, fn, status, code, msg) => {
    const before = snap();
    const got = await fn();
    const r = got && got.r ? got.r : got;
    ex(name, `${status}${code ? ' ' + code : ''}`, r.status === status && (!code || r.body?.error_code === code) && (!msg || msg.test(r.body?.message || '')), r.body);
    ex(name, 'nothing written', changes(before, snap()).length === 0, changes(before, snap()));
    // what the screen shows: readJson takes `message` (hooks/readJson.ts)
    ex(name, 'answer carries a message the screen can show', typeof r.body?.message === 'string' && r.body.message.length > 0, r.body);
  };
  test('X1 create refusals', async () => {
    seed();
    const base = fx('create-paid.json');
    await refuse('X1 no vendor (screen blocks; API too)', () => POST({ ...base, vendor_id: null }), 400, 'VALIDATION', /vendor/i);
    await refuse('X1 Other without phone', () => POST({ ...fx('create-other-unpaid.json'), contact_number: '' }), 400, 'VALIDATION', /Phone/);
    await refuse('X1 no lines', () => POST({ ...base, items: [] }), 400, 'VALIDATION');
    await refuse('X1 qty 0', () => POST({ ...base, items: [{ ...base.items[0], qty: 0 }] }), 400, 'VALIDATION');
    await refuse('X1 negative rate', () => POST({ ...base, items: [{ ...base.items[0], rate: -1 }] }), 400, 'VALIDATION');
    await refuse('X1 GST 101%', () => POST({ ...base, items: [{ ...base.items[0], gst_percentage: 101 }] }), 400, 'VALIDATION');
    await refuse('X1 unknown product', () => POST({ ...base, items: [{ ...base.items[0], product_id: 99 }] }), 400, 'UNKNOWN_PRODUCT');
    await refuse('X1 unknown vendor', () => POST({ ...base, vendor_id: 99 }), 400, 'VALIDATION');
    await refuse('X1 paid without a mode', () => POST({ ...base, payment_mode: null }), 400, 'VALIDATION', /mode/i);
    await refuse('X1 partial asked for', () => POST({ ...base, payment_status: 2 }), 400, 'VALIDATION');
    await refuse('X1 mode 2', () => POST({ ...base, payment_mode: 2 }), 400, 'VALIDATION');
    await refuse('X1 negative freight', () => POST({ ...base, transport_cost: -5 }), 400, 'VALIDATION');
    await refuse('X1 unknown staff', () => POST({ ...base, staff_id: 77 }), 400, 'VALIDATION');
    store.business_details[0].gstin = 'BAD';
    await refuse('X1 business GSTIN unusable (state named)', () => POST(base), 400, 'SUPPLY_TYPE_UNRESOLVED');
    await after('X1');
    finish();
  });
  test('X2 edit and delete refusals', async () => {
    seed();
    const { id } = await POST(fx('create-paid.json'));
    const body = relined(fx('edit-qty.json'), id);
    await refuse('X2 vendor change', () => PUT(id, { ...body, vendor_id: 2 }), 400, 'VENDOR_CHANGE_NOT_ALLOWED');
    await refuse('X2 same line twice', () => PUT(id, { ...body, items: [body.items[0], body.items[0]] }), 400, 'DUPLICATE_LINE_ID');
    await refuse('X2 a line from another bill', () => PUT(id, { ...body, items: [{ ...body.items[0], line_id: 424242 }] }), 400, 'FOREIGN_LINE');
    store.product[0].stock = 5; // 1005 of the 1010 sold
    await refuse('X2 lowering a line whose units were sold', () => PUT(id, { ...body, items: [{ ...body.items[0], qty: 2 }, body.items[1]] }), 400, 'INSUFFICIENT_STOCK');
    await refuse('X2 delete when its units were sold', () => DEL(id), 400, 'INSUFFICIENT_STOCK');
    store.product[0].stock = 1010;
    await refuse('X2 unknown id', () => DEL(9999), 404, 'NOT_FOUND');
    const ret = await call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(5), payment_status: 0, payment_mode: 0, items: [{ purchase_item_id: lines(k, id)[0].id, return_qty: 10, return_reason_id: 1 }] });
    ex('X2', 'a return of the whole first line', ret.status === 201, ret.body);
    await refuse('X2 delete with a return', () => DEL(id), 400, 'HAS_RETURNS');
    await refuse('X2 line below what was returned', () => PUT(id, { ...body, items: [{ ...body.items[0], qty: 9 }, body.items[1]] }), 400, 'QTY_BELOW_RETURNED');
    await refuse('X2 removing a returned line', () => PUT(id, { ...body, items: [body.items[1]] }), 400, 'CANNOT_DELETE_RETURNED_ITEM');
    const ret2 = await call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(5), payment_status: 0, payment_mode: 0, items: [{ purchase_item_id: lines(k, id)[1].id, return_qty: 5, return_reason_id: 1 }] });
    ex('X2', 'the rest returned: fully returned', ret2.status === 201 && bill(k, id).return_status === 2, { r: ret2.body, b: bill(k, id) });
    await refuse('X2 editing a fully returned bill', () => PUT(id, body), 400, 'FULLY_RETURNED');
    await after('X2');
    finish();
  });
});
