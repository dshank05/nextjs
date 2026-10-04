// Review E - reports and dashboard: data made through the real write routes (bills, payments,
// returns, refunds, dead stock), then every report called with the query string ITS SCREEN sends
// (fixtures/reports/captured.json, captured by the page harness), totals and rows checked against
// the documents and the ledger, plus date / paging / sort / filter edges.
// After every scenario: A1-A14 and the 16 report checks.
import { store, call, sum, r2, N, H, ex, create, pay, D, seedStock, K, lines, bill } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, RANGE } from '../support/flowlib.js';
const FX = require('../fixtures/reports/captured.json');
const SHOW = !!process.env.REVIEW_E_SHOW;
const sc = (id, title, fn, { known = [], open = null } = {}) =>
  ((open && !SHOW) ? test.failing : test)(`${id} ${title}${open ? `  [OPEN ${open}]` : ''}`, async () => {
    reset(); seedStock(); stats.failures = [];
    await fn();
    await checkAll(id, known);
    // The story runs from 30 Sep to 1 Nov: the 16 report checks take every document, so they
    // run over Sep-Nov here (flowlib's RANGE is October), then RANGE is put back.
    const keep = { ...RANGE };
    Object.assign(RANGE, { dateFrom: '2026-09-01', dateTo: '2026-11-30' });
    try { await checkReports(id); } finally { Object.assign(RANGE, keep); }
    expect(stats.failures).toEqual([]);
  });
const failing = SHOW ? test : test.failing;
const R = {
  sales: H.salesR, 'salex-report': H.salexR, purchase: H.purchaseR, gst: H.gstR, profit: H.profitR, 'cash-book': H.cashBookR, returns: H.returnsR,
  'customer-outstanding': H.custOut, 'vendor-outstanding': H.vendOut, 'credit-notes': H.creditR, 'debit-notes': H.debitR,
  'customer-ledger-accounting': H.custLedger, 'vendor-ledger-accounting': H.vendLedger, 'customer-balance-logs': H.custLogs, 'vendor-balance-logs': H.vendLogs,
  'opening-closing': H.stockR,
  'minimum-stock': require('../../../pages/api/reports/minimum-stock').default,
  'mechanic-sales': require('../../../pages/api/reports/mechanic-sales').default,
  'staff-sales': require('../../../pages/api/reports/staff-sales').default,
  commissions: require('../../../pages/api/reports/commissions').default,
  'transport-cost': require('../../../pages/api/reports/transport-cost').default,
  'packing-forwarding': require('../../../pages/api/reports/packing-forwarding').default,
  'bill-reference-sale': require('../../../pages/api/reports/bill-reference-sale').default,
  'bill-reference-purchase': require('../../../pages/api/reports/bill-reference-purchase').default,
  'notes-mentioned': require('../../../pages/api/reports/notes-mentioned').default
};
const dashboard = require('../../../pages/api/dashboard/index').default;
const qs = (s) => Object.fromEntries(new URLSearchParams(s || ''));
const Q = (screen, label = 'default') => (FX[screen].queries.find(([l]) => l === label) || FX[screen].queries[0])[1];
// The view a captured query was sent to, when the screen has more than one.
const VIEW = { 'credit notes view': 'credit-notes', 'debit notes view': 'debit-notes' };
/** Call a report with the query string its screen sends, optionally changing some parameters. */
const screenCall = (screen, label = 'default', patch = {}) => {
  const ep = VIEW[label] || FX[screen].endpoint.replace('/api/reports/', '');
  const h = ep === '/api/dashboard' ? dashboard : R[ep];
  return call(h, 'GET', { ...qs(Q(screen, label)), ...patch });
};
const IST = (y, m, d, hh = 0, mm = 0, ss = 0) => Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss) / 1000) - 19800;

// ---- the story: everything through the write routes
async function story() {
  store.mechanic.push({ id: 1, name: 'Ravi Mech', phone: '9876543210', city: 'Agra', status: 'Active' });
  store.staff.push({ id: 1, name: 'Neha', phone: '9000000001', status: 'Active' });
  const S = {};
  // September: before the screens' month
  S.pSep = (await create(K.purchase, { partyId: 1, date: '2026-09-30', items: [[1, 4, 400, 18]] })).id;
  S.sSep = (await create(K.sale, { partyId: 1, date: '2026-09-30', items: [[1, 1, 900, 18]] })).id;
  S.paySep = (await pay(K.sale, 500, [[K.sale, S.sSep, 500]], { mode: 0, date: '2026-09-30' })).id;
  // October
  S.p1 = (await create(K.purchase, { partyId: 1, date: D(1), items: [[1, 10, 500, 18]], extra: { bill_reference: 'BOSCH-77', notes: 'urgent restock', transport_cost: 150, staff_id: 1 } })).id;
  S.p2 = (await create(K.purchase, { partyId: 2, date: D(2), items: [[2, 5, 200, 18]], status: 1, mode: 0 })).id;
  S.s1 = (await create(K.sale, { partyId: 1, date: D(3), items: [[1, 2, 1000, 18]], extra: { mechanic_id: 1, staff_id: 1, commission: 50, notes: 'urgent delivery', bill_reference: 'REF-77', packing_forwarding_qty: 1, packing_forwarding_rate: 40 } })).id;
  S.s2 = (await create(K.sale, { partyId: 2, date: D(4), items: [[2, 1, 500, 18]], status: 1, mode: 1 })).id;
  S.x1 = (await create(K.salex, { partyId: 1, date: D(5), items: [[3, 3, 100, 0]], status: 1, mode: 0, extra: { mechanic_id: 1, transport_cost: 60 } })).id;
  S.zero = (await create(K.sale, { partyId: 2, date: D(6), items: [[3, 1, 0, 0]] })).id;          // rate 0 allowed
  S.pay1 = (await pay(K.sale, 1000, [[K.sale, S.s1, 1000]], { mode: 1, date: D(7) })).id;
  S.vpay1 = (await pay(K.purchase, 2000, [[K.purchase, S.p1, 2000]], { mode: 0, date: D(8) })).id;
  const sl = lines(K.sale, S.s1)[0];
  const sr = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: D(9), payment_status: 1, payment_mode: 0, items: [{ invoice_item_id: sl.id, invoice_type: 'invoice', return_qty: 1, return_reason_id: 1 }] });
  S.sr1 = store.sale_returns.at(-1)?.id;
  const pl = lines(K.purchase, S.p1)[0];
  const pr = await call(H.prCreate, 'POST', {}, { vendor_id: 1, return_date: D(10), payment_status: 0, payment_mode: 1, items: [{ purchase_item_id: pl.id, return_qty: 2, return_reason_id: 1 }] });
  S.pr1 = store.purchase_returns.at(-1)?.id;
  await call(H.deadCreate, 'POST', {}, { product_id: 3, quantity: 1, reason: 'Rusted' });
  // the last day of the month, and the first of the next
  S.s31 = (await create(K.sale, { partyId: 1, date: D(31), items: [[2, 1, 300, 18]] })).id;
  S.sNov = (await create(K.sale, { partyId: 1, date: '2026-11-01', items: [[2, 1, 700, 18]] })).id;
  S.results = { sr: sr.status, pr: pr.status };
  // What MySQL fills by itself and the in-memory store does not: NULL for an unset foreign key
  // (the reports filter `mechanic_id: { not: null }`), and created_at = now() on dead stock.
  for (const t of ['invoice', 'invoicex', 'purchase']) for (const b of store[t]) for (const k of ['staff_id', 'mechanic_id']) if (b[k] === undefined) b[k] = null;
  for (const d of store.deadstock) if (!d.created_at) d.created_at = new Date(IST(2026, 10, 11) * 1000);
  return S;
}
const inOct = (t) => t >= IST(2026, 10, 1) && t <= IST(2026, 10, 31, 23, 59, 59);
const octBills = (table) => store[table].filter(b => inOct(b.invoice_date));

describe('Review E - reports, with the query strings the screens send', () => {
  test('E-R0 the story writes through the routes without a refusal', async () => {
    reset(); seedStock();
    const S = await story();
    expect([S.p1, S.p2, S.s1, S.s2, S.x1, S.zero, S.pay1, S.vpay1, S.sr1, S.pr1, S.s31, S.sNov].every(Boolean)).toBe(true);
    expect(S.results).toEqual({ sr: 201, pr: 201 });
    expect(bill(K.sale, S.s1).mechanic_id).toBe(1);
  });

  sc('E-R1', 'Sale / Invoice C / Purchase reports: the month the screen asks for (last day in, next month out)', async () => {
    const S = await story();
    const s = (await screenCall('sale')).body.summary;
    const oct = octBills('invoice');
    ex('E-R1', 'sale: October bills only (31st in, 1 Nov and 30 Sep out)', s.totalSales === oct.length && oct.some(b => b.id === S.s31) && !oct.some(b => b.id === S.sNov) && s.totalSales === 4, { s, oct: oct.map(b => b.id) });
    ex('E-R1', 'sale: totals are the bills\' own', s.totalRevenue === r2(sum(oct, b => N(b.total))) && s.tax === r2(sum(oct, b => N(b.total_tax))) && s.igst === r2(sum(oct, b => N(b.total_igst))), s);
    ex('E-R1', 'sale: paid 1 (Asha), part-paid 1 (Ravi\'s, paid 1000), unpaid 2 (zero bill, 31st)', s.paidSales === 1 && s.partiallyPaidSales === 1 && s.unpaidSales === 2, s);
    const ret = store.sale_returns.filter(x => inOct(x.return_date));
    ex('E-R1', 'sale: returns in the month and net', s.returnsCount === 1 && s.returnsAmount === r2(sum(ret, x => N(x.refund_amount))) && s.netRevenue === r2(s.totalRevenue - s.returnsAmount), s);
    const body = (await screenCall('sale')).body;
    ex('E-R1', 'sale: day by day in India days (03, 04, 06, 31 Oct)', body.dailySales.map(d => d.date).join() === '03/10/2026,04/10/2026,06/10/2026,31/10/2026', body.dailySales);
    ex('E-R1', 'sale: zero bill counted, top customer Ravi', body.topCustomers[0].customer_name === 'Ravi', body.topCustomers);
    const both = (await screenCall('sale', 'both')).body.summary;
    const x = (await screenCall('salex')).body.summary;
    ex('E-R1', 'Sale + Invoice C = sale + Invoice C', both.totalSales === s.totalSales + x.totalSales && both.totalRevenue === r2(s.totalRevenue + x.totalRevenue) && x.totalSales === 1 && x.tax === 0, { both, s, x });
    ex('E-R1', '"Invoice C only" on the Sale screen = the Invoice C report', JSON.stringify((await screenCall('sale', 'salex only')).body.summary) === JSON.stringify(x));
    const p = (await screenCall('purchase')).body.summary;
    const po = octBills('purchase');
    ex('E-R1', 'purchase: 2 October bills, Sep out; IGST from the Delhi vendor', p.totalSales === 2 && p.totalRevenue === r2(sum(po, b => N(b.total))) && p.igst === r2(sum(po, b => N(b.total_igst))) && p.igst > 0, p);
    ex('E-R1', 'purchase: debit note in the month is its return', p.returnsCount === 1 && p.returnsAmount === r2(N(store.purchase_returns[0].refund_amount)), p);
    const nov = (await screenCall('sale', 'default', { dateFrom: '2026-11-01T00:00:00', dateTo: '2026-11-30T23:59:59' })).body.summary;
    ex('E-R1', 'November: only the 1 Nov bill', nov.totalSales === 1 && nov.totalRevenue === N(bill(K.sale, S.sNov).total), nov);
  });

  sc('E-R2', 'GST summary (screen month): output, credit notes, input, debit notes, net, Invoice C as non-GST', async () => {
    await story();
    const g = (await screenCall('gst')).body;
    const so = octBills('invoice'), po = octBills('purchase');
    const t = (rows, f) => r2(sum(rows, x => N(x[f])));
    ex('E-R2', 'output heads = October sale bills', g.output.count === so.length && g.output.cgst === t(so, 'total_cgst') && g.output.sgst === t(so, 'total_sgst') && g.output.igst === t(so, 'total_igst'), g.output);
    ex('E-R2', 'input heads = October purchases', g.input.count === po.length && g.input.cgst === t(po, 'total_cgst') && g.input.igst === t(po, 'total_igst'), g.input);
    ex('E-R2', 'credit note: the sale return tax, split as its line (intra: half / half)', g.creditNotes.count === 1 && g.creditNotes.tax === r2(N(store.sale_returns[0].total_tax)) && g.creditNotes.cgst === g.creditNotes.sgst && g.creditNotes.igst === 0, g.creditNotes);
    ex('E-R2', 'debit note: the purchase return tax', g.debitNotes.count === 1 && g.debitNotes.tax === r2(N(store.purchase_returns[0].total_tax)), g.debitNotes);
    ex('E-R2', 'net per head = output - credit - (input - debit)', ['cgst', 'sgst', 'igst'].every(h => g.net[h] === r2(g.output[h] - g.creditNotes[h] - (g.input[h] - g.debitNotes[h]))), g.net);
    ex('E-R2', 'Invoice C counted as non-GST supply', g.nonGst.count === 1 && g.nonGst.total === t(octBills('invoicex'), 'total'), g.nonGst);
    ex('E-R2', 'B2C only (no buyer GSTIN on the snapshots)', g.output.b2c.count === so.length && g.output.b2b.count === 0, { b2b: g.output.b2b, b2c: g.output.b2c });
  });

  sc('E-R3', 'Profit (screen: 1 April to month end): sales and returns before tax, cost at the purchase rate', async () => {
    const S = await story();
    const pf = (await screenCall('profit')).body;
    const saleLines = [...store.invoiceitems, ...store.invoice_itemsx].filter(l => {
      const h = store.invoice.find(b => b.id === l.invoice_no && store.invoiceitems.includes(l)) || store.invoicex.find(b => b.id === l.invoice_no && store.invoice_itemsx.includes(l));
      return h && h.invoice_date <= IST(2026, 10, 31, 23, 59, 59);
    });
    ex('E-R3', 'sales = line subtotals of bills to 31 Oct (Sept in, Nov out)', pf.total.sales === r2(sum(saleLines, l => N(l.subtotal))), { got: pf.total.sales, want: sum(saleLines, l => N(l.subtotal)) });
    ex('E-R3', 'returns = the return\'s value before tax', pf.total.returns === r2(N(store.sale_returns[0].total_amount)), pf.total);
    // Brake Pad cost: September sale at the September rate 400, October sales at the October rate 500
    const pad = pf.topProducts.find(p => p.product_id === 1);
    ex('E-R3', 'Brake Pad: 1 sold in Sept at cost 400, 2 sold in Oct at 500, 1 returned (500 back): cost 900', pad && pad.cost === 900 && pad.qty === 2, pad);
    ex('E-R3', 'months: September and October', pf.byMonth.map(m => m.month).join() === '2026-09,2026-10', pf.byMonth);
    ex('E-R3', 'story', !!S.s1);
  });

  sc('E-R4', 'Cash / Bank book (screen: all, cash, bank): brought forward, in / out, by mode', async () => {
    await story();
    const all = (await screenCall('cashbook')).body;
    const sep = store.customer_payments.filter(p => p.payment_date < IST(2026, 10, 1));
    ex('E-R4', 'brought forward = the September receipt (no opening cash entry)', all.opening === r2(sum(sep, p => N(p.payment_amount))) && all.opening === 500, all.opening);
    const inOctPay = (rows, f) => rows.filter(x => inOct(x[f]));
    const moneyIn = sum(inOctPay(store.customer_payments, 'payment_date'), p => N(p.payment_amount)) + sum(inOctPay(store.vendor_refunds, 'refund_date'), p => N(p.refund_amount));
    const moneyOut = sum(inOctPay(store.vendor_payments, 'payment_date'), p => N(p.payment_amount)) + sum(store.sale_returns.filter(x => x.payment_status === 1), x => N(x.refund_amount));
    ex('E-R4', 'October in = customer payments; out = vendor payments + the refunded sale return (pending debit note left out)', all.totals.in === r2(moneyIn) && all.totals.out === r2(moneyOut), { totals: all.totals, moneyIn, moneyOut });
    ex('E-R4', 'closing = brought forward + in - out', all.totals.closing === r2(all.opening + moneyIn - moneyOut), all.totals);
    ex('E-R4', 'the last row carries the closing balance', all.rows.at(-1).balance === all.totals.closing, all.rows.at(-1));
    const cash = (await screenCall('cashbook', 'cash')).body, bank = (await screenCall('cashbook', 'bank')).body;
    ex('E-R4', 'cash + bank = all (rows and nets)', cash.pagination.total + bank.pagination.total === all.pagination.total && r2(cash.totals.closing - cash.opening + bank.totals.closing - bank.opening) === r2(all.totals.closing - all.opening), { cash: cash.totals, bank: bank.totals });
    ex('E-R4', 'cash rows are cash only', cash.rows.every(r => r.mode === 'Cash') && bank.rows.every(r => r.mode === 'Bank'), cash.rows.map(r => r.mode));
    const p2 = (await screenCall('cashbook', 'default', { limit: '2', page: '2' })).body;
    ex('E-R4', 'page 2 opens on the running balance of page 1', p2.pageOpening === all.rows[1].balance && p2.rows[0].id === all.rows[2].id, { p2: p2.pageOpening, rows: all.rows.slice(0, 3) });
  });

  sc('E-R5', 'Return register (screen: all / Sale + Invoice C / Complete)', async () => {
    await story();
    const all = (await screenCall('returns')).body;
    ex('E-R5', 'both returns of the month', all.pagination.total === 2 && all.totals.refund === r2(N(store.sale_returns[0].refund_amount) + N(store.purchase_returns[0].refund_amount)), all.totals);
    ex('E-R5', 'settled = the refunded sale return; pending = the debit note', all.totals.settled === r2(N(store.sale_returns[0].refund_amount)) && all.totals.pending === r2(N(store.purchase_returns[0].refund_amount)), all.totals);
    const cust = (await screenCall('returns', 'customer')).body;
    ex('E-R5', 'Sale + Invoice C: the sale return only', cust.pagination.total === 1 && cust.returns[0].kind === 'sale' && cust.returns[0].party_name === 'Ravi', cust.returns);
    const done = (await screenCall('returns', 'complete')).body;
    ex('E-R5', 'Complete: the refunded one', done.pagination.total === 1 && done.returns[0].status === 1, done.returns);
    const sr = (await screenCall('returns', 'default', { search: 'SR-' })).body;
    ex('E-R5', 'searching a sale return number finds nothing (only the debit note number is searched; placeholder says "Name or debit note")', sr.pagination.total === 0, sr.returns);
  });

  sc('E-R6', 'Customer / Vendor Reports - outstanding (screen query): ledger sum, totals, search, filter, amount, page, dates', async () => {
    const S = await story();
    const c = (await screenCall('customerReports')).body;
    const led = (pid) => r2(sum(store.customer_ledger.filter(l => l.customer_id === pid), l => N(l.debit) - N(l.credit)));
    ex('E-R6', 'Ravi at his ledger sum (Nov bill included: no end date)', c.outstandingCustomers.find(x => x.customer_id === 1)?.balance === led(1), c.outstandingCustomers);
    ex('E-R6', 'by balance, largest first', c.outstandingCustomers[0].balance >= c.outstandingCustomers.at(-1).balance, c.outstandingCustomers.map(x => x.balance));
    ex('E-R6', 'totals owed / credit', c.totals.owed === r2([1, 2].map(led).filter(b => b > 0).reduce((a, b) => a + b, 0)), c.totals);
    const last = c.outstandingCustomers.find(x => x.customer_id === 1);
    ex('E-R6', 'last transaction: the 1 Nov bill, linked', last.reference_url === `/sale/view/${S.sNov}`, last);
    ex('E-R6', 'Asha paid her bill in full (the zero bill adds nothing): not listed', !c.outstandingCustomers.some(x => x.customer_id === 2) && led(2) === 0, c.outstandingCustomers);
    const f = (await screenCall('customerReports', 'default', { customerFilter: '2' })).body;
    ex('E-R6', 'customer filter on a settled customer: empty, Page 1 of 1', f.outstandingCustomers.length === 0 && f.pagination.totalPages === 1, f);
    const s = (await screenCall('customerReports', 'default', { search: 'rav' })).body;
    ex('E-R6', 'search by name (case-insensitive)', s.outstandingCustomers.length === 1 && s.outstandingCustomers[0].customer_id === 1, s.outstandingCustomers);
    const a = (await screenCall('customerReports', 'default', { amountMin: String(led(1) + 1) })).body;
    ex('E-R6', 'amount min above everyone: none, Page 1 of 1', a.outstandingCustomers.length === 0 && a.pagination.totalPages === 1, a.pagination);
    const oct = (await screenCall('customerReports', 'default', { dateFrom: '2026-10-01T00:00:00', dateTo: '2026-10-31T23:59:59' })).body;
    const ravOct = r2(sum(store.customer_ledger.filter(l => l.customer_id === 1 && l.transaction_date <= IST(2026, 10, 31, 23, 59, 59)), l => N(l.debit) - N(l.credit)));
    ex('E-R6', 'October: balance as of 31 Oct (the Nov bill left out)', oct.outstandingCustomers.find(x => x.customer_id === 1)?.balance === ravOct, oct.outstandingCustomers);
    const v = (await screenCall('vendorReports')).body;
    const vled = (pid) => r2(sum(store.vendor_ledger.filter(l => l.vendor_id === pid), l => N(l.debit) - N(l.credit)));
    ex('E-R6', 'vendor: Bosch at its ledger sum; Delhi Parts (paid in full) not listed', v.outstandingVendors.find(x => x.vendor_id === 1)?.balance === vled(1) && !v.outstandingVendors.some(x => x.vendor_id === 2) && vled(2) === 0, v.outstandingVendors);
  });

  sc('E-R7', 'Credit notes (Customer Reports view) and debit notes (Vendor Reports view, Debit Notes page)', async () => {
    await story();
    const cn = (await screenCall('customerReports', 'credit notes view')).body;
    ex('E-R7', 'the credit note: SR number, Ravi, refunded, one item; the screen\'s sortBy=balance falls back to date', cn.pagination.total === 1 && cn.creditNotes[0].customer_name === 'Ravi' && cn.creditNotes[0].payment_status === 1 && cn.creditNotes[0].item_count === 1 && cn.totals.refund === r2(N(store.sale_returns[0].refund_amount)), cn);
    const dn = (await screenCall('vendorReports', 'debit notes view')).body;
    ex('E-R7', 'the debit note: Bosch, pending', dn.pagination.total === 1 && dn.debitNotes[0].vendor_name === 'Bosch' && dn.debitNotes[0].payment_status === 0 && dn.totals.refund === r2(N(store.purchase_returns[0].refund_amount)), dn);
    const page = (await screenCall('debitNotes')).body;
    ex('E-R7', 'Debit Notes page: the same note', page.pagination.total === 1 && page.debitNotes[0].id === store.purchase_returns[0].id, page);
    const byName = (await screenCall('debitNotes', 'default', { search: 'Bosch' })).body;
    // E-17 fixed: debit notes search the vendor name too, as credit notes search the customer name.
    ex('E-R7', 'twin: searching the vendor name on debit notes finds the note', byName.pagination.total === 1 && byName.debitNotes[0].vendor_name === 'Bosch', byName.pagination);
    const byNo = (await screenCall('debitNotes', 'default', { search: String(store.purchase_returns[0].debit_note_no).slice(-3) })).body;
    ex('E-R7', 'and still the note number', byNo.pagination.total === 1, byNo.pagination);
    const none = (await screenCall('debitNotes', 'default', { search: 'Nobody' })).body;
    ex('E-R7', 'and nothing for another name', none.pagination.total === 0, none.pagination);
  });

  sc('E-R8', 'Ledger accounts (screen query after picking the party): opening from September, running balance, money rows only', async () => {
    const S = await story();
    const L = (await screenCall('customerLedger')).body;
    const rows = store.customer_ledger.filter(l => l.customer_id === 1);
    const before = r2(sum(rows.filter(l => l.transaction_date < IST(2026, 10, 1)), l => N(l.debit) - N(l.credit)));
    const octRows = rows.filter(l => inOct(l.transaction_date));
    ex('E-R8', 'opening = everything before 1 Oct (the Sept bill less its payment)', L.openingBalance === before && before > 0, { got: L.openingBalance, want: before });
    ex('E-R8', 'rows: October money movements, 1 Nov left out', L.entries.length === octRows.filter(l => N(l.debit) || N(l.credit)).length && !L.entries.some(e => e.referenceId === S.sNov && e.referenceType === 'sale'), L.entries.map(e => [e.voucherType, e.debit, e.credit]));
    ex('E-R8', 'closing = opening + October debits - credits', r2(L.entries.at(-1).balance) === r2(before + sum(octRows, l => N(l.debit) - N(l.credit))), L.entries.at(-1));
    const A = (await screenCall('customerLedger', 'after pick', { customer_id: '2' })).body;
    ex('E-R8', 'Asha: the zero bill is not listed (0 / 0)', !A.entries.some(e => e.debit === 0 && e.credit === 0), A.entries);
    const V = (await screenCall('vendorLedger')).body;
    const vrows = store.vendor_ledger.filter(l => l.vendor_id === 1);
    ex('E-R8', 'vendor ledger: opening = Sept purchase, closing = ledger to 31 Oct', V.openingBalance === r2(sum(vrows.filter(l => l.transaction_date < IST(2026, 10, 1)), l => N(l.debit) - N(l.credit))) && r2(V.entries.at(-1).balance) === r2(sum(vrows.filter(l => l.transaction_date <= IST(2026, 10, 31, 23, 59, 59)), l => N(l.debit) - N(l.credit))), { o: V.openingBalance, last: V.entries.at(-1) });
    const p2 = (await screenCall('customerLedger', 'after pick', { limit: '2', page: '2' })).body;
    ex('E-R8', 'page 2 opens where page 1 closed', r2(p2.openingBalance) === r2(L.entries[1].balance), { p2: p2.openingBalance, p1: L.entries.slice(0, 2) });
  });

  sc('E-R9', 'Balance logs (screen query after picking the party): change totals = the counters', async () => {
    await story();
    for (const [screen, master, who, logs] of [['customerLogs', 'customer_details', 'customer_id', 'customer_balance_logs'], ['vendorLogs', 'vendor_details', 'vendor_id', 'vendor_balance_logs']]) {
      const g = (await screenCall(screen, 'after pick')).body;   // the first: ?<party>_id=1&page=1
      const mine = store[logs].filter(l => l[who] === 1);
      ex('E-R9', `${screen}: every log row counted`, g.pagination.total === mine.length && mine.length > 0, g.pagination);
      const b = (await call(R[FX[screen].endpoint.replace('/api/reports/', '')], 'GET', qs(FX[screen].queries.find(([, q]) => q.includes('get_balance'))[1]))).body;
      const party = store[master].find(p => p.id === 1);
      for (const c of ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated']) ex('E-R9', `${screen}: ${c} logged = counter`, r2(g.totals[c]) === r2(N(party[c])) && b.balance[c] === N(party[c]), { c, t: g.totals[c], now: party[c] });
    }
  });

  sc('E-R10', 'Opening / Closing Stock (screen month): opening from September, October movements, closing = stock', async () => {
    await story();
    const st = (await screenCall('openingClosing')).body;
    const pad = st.products.find(p => p.product_id === 1);
    // 1000 opening, Sept: +4 bought -1 sold; Oct: +10 bought, -2 sold, +1 sale return, -2 purchase return
    ex('E-R10', 'Brake Pad: opening 1003, Oct +10 -2 +1 -2, closing 1010 (Nov bill not yet)', pad.opening_qty === 1003 && pad.purchased === 10 && pad.sold === 2 && pad.sale_returned === 1 && pad.purchase_returned === 2 && pad.closing_qty === 1010, pad);
    ex('E-R10', 'Clutch Plate: 1 Nov sale is after the month: closing 1003, stock now 1002, not flagged', (() => { const c = st.products.find(p => p.product_id === 2); return c.closing_qty === 1003 && c.stock_now === 1002 && c.mismatch === 0; })(), st.products.find(p => p.product_id === 2));
    ex('E-R10', 'Oil Filter: dead stock 1 and 3 on Invoice C', (() => { const o = st.products.find(p => p.product_id === 3); return o.dead_stock === 1 && o.sold === 4; })(), st.products.find(p => p.product_id === 3));
    ex('E-R10', 'nothing out of step', st.totals.mismatched_products === 0, st.totals);
    const desc = (await screenCall('openingClosing', 'default', { sortBy: 'closing_qty', sortOrder: 'desc' })).body;
    ex('E-R10', 'sort by closing desc', desc.products[0].closing_qty >= desc.products.at(-1).closing_qty, desc.products.map(p => p.closing_qty));
  });

  sc('E-R11', 'Mechanic / Staff / Commissions / Transport / Packing (screen queries: all dates)', async () => {
    const S = await story();
    const m = (await screenCall('mechanic')).body;
    ex('E-R11', 'mechanic: the sale and the Invoice C bill under Ravi Mech', m.pagination.total === 2 && m.summary.mechanic_summary[0].mechanic_name === 'Ravi Mech' && m.summary.total_sales === r2(N(bill(K.sale, S.s1).total) + N(bill(K.salex, S.x1).total)), m);
    const st = (await screenCall('staff')).body;
    ex('E-R11', 'staff: the sale and the purchase under Neha', st.pagination.total === 2 && st.data.every(r => r.staff_name === 'Neha'), st.data);
    const c = (await screenCall('commissions')).body;
    ex('E-R11', 'commissions: the 50 on the sale', c.pagination.total === 1 && c.summary.total_commission === 50, c);
    const t = (await screenCall('transport')).body;
    ex('E-R11', 'transport: freight on the Invoice C bill and the purchase', t.pagination.total === 2 && r2(t.summary.total_freight) === r2(N(bill(K.salex, S.x1).freight) + N(bill(K.purchase, S.p1).freight)) && t.summary.total_freight > 0, t);
    const p = (await screenCall('packing')).body;
    ex('E-R11', 'packing: the 40 on the sale', p.pagination.total === 1 && p.summary.total_pf === N(bill(K.sale, S.s1).packing_forwarding_total) && p.summary.total_pf === 40, p);
    const mo = (await screenCall('mechanic', 'default', { dateFrom: '2026-10-05', dateTo: '2026-10-05' })).body;
    ex('E-R11', 'a one-day range (the date picker\'s YYYY-MM-DD): the 5 Oct Invoice C bill', mo.pagination.total === 1 && mo.data[0].type === 'Salex', mo.data);
  });

  sc('E-R12', 'Bill reference (sale / purchase) and Notes Mentioned (screen queries)', async () => {
    const S = await story();
    const bs = (await screenCall('billRefSale', 'default', { billReference: 'REF-7' })).body;
    ex('E-R12', 'bill reference sale: REF-77, customer from the snapshot', bs.pagination.total === 1 && bs.sales[0].id === S.s1 && bs.sales[0].customer_name === 'Ravi', bs);
    const all = (await screenCall('billRefSale')).body;
    ex('E-R12', 'no reference typed: every sale and Invoice C bill, newest first', all.pagination.total === store.invoice.length + store.invoicex.length && all.sales[0].invoice_date >= all.sales.at(-1).invoice_date, all.pagination);
    const bp = (await screenCall('billRefPurchase', 'default', { billReference: 'bosch' })).body;
    ex('E-R12', 'bill reference purchase: BOSCH-77 (case-insensitive)', bp.pagination.total === 1 && bp.purchases[0].id === S.p1, bp);
    const n = (await screenCall('notes', 'search urgent')).body;
    ex('E-R12', 'notes "urgent": the sale and the purchase', n.pagination.total === 2 && n.transactions.map(t => t.type).sort().join() === 'purchase,sale', n.transactions);
  });

  sc('E-R13', 'Dashboard (screen query): totals, today, the picked day, low stock active only', async () => {
    const S = await story();
    const d = (await screenCall('dashboard')).body;  // today = 2026-10-04 (the capture day)
    ex('E-R13', 'products = active ones', d.totals.products === store.product.filter(p => p.is_active).length, d.totals);
    ex('E-R13', 'total sales = every GST sale bill, total purchases = every purchase', d.totals.sales === store.invoice.length && d.totals.purchases === store.purchase.length, d.totals);
    ex('E-R13', "today's sales (4 Oct) = Asha's bill", d.today.sales === N(bill(K.sale, S.s2).total), d.today);
    const y = (await screenCall('dashboard', 'sales yesterday')).body;
    ex('E-R13', 'the 3 Oct panel = the 3 Oct sale', y.salesDay.total === N(bill(K.sale, S.s1).total), y.salesDay);
    ex('E-R13', 'last sale = the 1 Nov bill', d.lastSale.invoiceNo === bill(K.sale, S.sNov).invoice_no, d.lastSale);
  });

  sc('E-R14', 'a customer\'s GSTIN (edited on the party) reaches the bill snapshot and makes the sale B2B in the GST summary', async () => {
    const custOne = require('../../../pages/api/customers/[id]').default;
    const c = store.customer_details.find(x => x.id === 1);
    Object.assign(c, { billing_address: 'Ring Road', shipping_address: 'Ring Road', contact_no: '9876500001', billing_state: 'Uttar Pradesh' });
    const g0 = (await call(custOne, 'GET', { id: '1' })).body;
    const u = await call(custOne, 'PUT', { id: '1' }, { ...g0, billing_gstin: '09ABCDE1234F1Z5', contact_no_2: null, contact_no_3: null });
    ex('E-R14', 'GSTIN saved on the customer', u.status === 200 && c.billing_gstin === '09ABCDE1234F1Z5', u.body);
    const { id } = await create(K.sale, { partyId: 1, date: D(12), items: [[1, 1, 1000, 18]] });
    await create(K.sale, { partyId: 2, date: D(12), items: [[1, 1, 1000, 18]] });
    ex('E-R14', 'the bill snapshot carries it', store.bill_tosales.find(b => b.invoice_no === id)?.billing_gstin === '09ABCDE1234F1Z5', store.bill_tosales);
    const g = (await screenCall('gst')).body;
    ex('E-R14', 'GST summary: 1 B2B (Ravi), 1 B2C (Asha)', g.output.b2b.count === 1 && g.output.b2c.count === 1 && g.output.b2b.tax === r2(N(bill(K.sale, id).total_tax)), { b2b: g.output.b2b, b2c: g.output.b2c });
  });

  // ---------------------------------------------------------------- findings (wrong today)
  sc('E-11', 'empty report lists answer totalPages 1 (Minimum Stock, Notes Mentioned show "Page 1 of totalPages")', async () => {
    const ms = (await screenCall('minimumStock')).body;
    const n = (await screenCall('notes', 'search urgent', { notesSearch: 'zzz' })).body;
    ex('E-11', 'minimum stock with nothing low: totalPages 1 (today 0)', ms.products.length === 0 && ms.pagination.totalPages === 1, ms.pagination);
    ex('E-11', 'notes with nothing found: totalPages 1 (today 0)', n.transactions.length === 0 && n.pagination.totalPages === 1, n.pagination);
  });

  sc('E-14', 'the ledger account\'s count matches the rows it lists (0 / 0 rows are not listed)', async () => {
    await create(K.sale, { partyId: 2, date: D(6), items: [[3, 1, 0, 0]] });
    await create(K.sale, { partyId: 2, date: D(7), items: [[1, 1, 100, 0]] });
    const L = (await screenCall('customerLedger', 'after pick', { customer_id: '2' })).body;
    ex('E-14', 'pagination.total = listed rows (today 2 for 1 row: the zero bill is counted, not shown)', L.pagination.total === L.entries.length, { total: L.pagination.total, rows: L.entries.length });
  });

  // E-12 fixed: the screens now fetch /api/products/<lookup>?dropdown=true. The page harness that
  // captured the old URLs is not in this repo, so the URLs are read from the page sources here.
  test('E-12 the stock reports\' filter lists load from routes that exist and answer the keys the screens read', async () => {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../../..');
    const src = ['pages/reports/minimumstock.tsx', 'pages/reports/openingclosing.tsx'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    const urls = [...src.matchAll(/fetch\('(\/api\/[^'?]+)(\?[^']*)?'\)/g)].map(m => [m[1], m[2] || '']);
    expect(urls.map(u => u[0]).sort()).toEqual(['/api/products/categories', '/api/products/categories', '/api/products/companies', '/api/products/models']);
    const KEY = { categories: 'categories', companies: 'companies', models: 'models' };
    for (const [u, q] of urls) {
      const name = u.split('/').pop();
      const h = require(path.join(root, 'pages', u, 'index')).default;
      const r = await call(h, 'GET', qs(q.slice(1)));
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body[KEY[name]])).toBe(true);
    }
  });

  sc('E-16', 'exports: fetchAllReportRows walks every page of the screen\'s query (ledger, debit notes)', async () => {
    await story();
    const { fetchAllReportRows } = require('../../../lib/export-all-report');
    const keep = global.fetch;
    const asked = [];
    global.fetch = async (url) => {
      const u = new URL(url, 'http://x');
      asked.push(u.searchParams.get('page'));
      const r = await call(R[u.pathname.replace('/api/reports/', '')], 'GET', Object.fromEntries(u.searchParams));
      return { ok: r.status === 200, json: async () => r.body };
    };
    try {
      const lq = qs(Q('customerLedger', 'after pick'));
      const whole = (await call(R['customer-ledger-accounting'], 'GET', { ...lq, limit: '1000' })).body.entries;
      const paged = await fetchAllReportRows('/api/reports/customer-ledger-accounting', lq, d => d.entries, 2);
      ex('E-16', 'ledger: two rows a page, every row, in order', whole.length > 2 && JSON.stringify(paged.map(e => e.id)) === JSON.stringify(whole.map(e => e.id)) && asked.length === Math.ceil(whole.length / 2), { whole: whole.length, paged: paged.length, asked });
      const dn = await fetchAllReportRows('/api/reports/debit-notes', qs(Q('debitNotes')), d => d.debitNotes, 1);
      ex('E-16', 'debit notes: all of them', dn.length === store.purchase_returns.filter(r => r.debit_note_no).length, dn.length);
      global.fetch = async () => ({ ok: false, json: async () => ({}) });
      let threw = false;
      try { await fetchAllReportRows('/api/reports/debit-notes', {}, d => d.debitNotes); } catch { threw = true; }
      ex('E-16', 'a failed page throws (ExportMenu then falls back to the rows on screen)', threw);
    } finally { global.fetch = keep; }
  });

  // ---------------------------------------------------------------- questions for the owner (current behaviour, passing)
  sc('Q-1', 'dashboard "Total Sales" / "Today\'s Sales" leave Invoice C bills out (current behaviour)', async () => {
    await create(K.salex, { partyId: 1, date: '2026-10-04', items: [[3, 1, 100, 0]], status: 1, mode: 0 });
    const d = (await screenCall('dashboard')).body;
    ex('Q-1', 'an Invoice C bill today: Total Sales 0, Today\'s Sales 0', d.totals.sales === 0 && d.today.sales === 0, d);
  });
  sc('Q-2', 'Customer Reports with a date range leave out a debtor with no activity in the range (current behaviour)', async () => {
    await create(K.sale, { partyId: 1, date: '2026-09-30', items: [[1, 1, 900, 0]] });
    const oct = (await screenCall('customerReports', 'default', { dateFrom: '2026-10-01T00:00:00', dateTo: '2026-10-31T23:59:59' })).body;
    ex('Q-2', 'Ravi owes 900 on 31 Oct but is not listed for October', oct.outstandingCustomers.length === 0 && oct.totals.owed === 0, oct);
  });
});
