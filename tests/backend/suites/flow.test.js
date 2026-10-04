// Whole-backend flow (LEDGER_ASSERT_PLAN section 4): one business story through the real API
// routes. After every step: audit-assert A1-A14 over the store, and the reports against the ledger.
import { store } from '../support/dbstub.js';
import { stats, ok, out, quiet, call, audit, sum, r2, N, RANGE, checkAll, checkReports, H } from '../support/flowlib.js';
const { purchases, purchaseOne, sales, saleOne, salex, salexOne, cpCreate, cpOne, vpCreate, vpOne, crCreate, crOne, vrCreate, vrOne, srCreate, srOne, prCreate, prOne, deadCreate, deadOne, custOut, vendOut, custLedger, vendLedger, custLogs, vendLogs, cashBookR, salesR, purchaseR, salexR, gstR, creditR, debitR, returnsR, profitR, stockR } = H;
const ledgerDump = () => {
  const v = store.vendor_ledger.map(l => `V${l.vendor_id} ${l.transaction_type} ${l.reference_type}/${l.reference_id} t${l.transaction_id ?? '-'} D${l.debit} C${l.credit} B${l.balance}`);
  const c = store.customer_ledger.map(l => `C${l.customer_id} ${l.transaction_type} ${l.reference_type}/${l.reference_id} t${l.transaction_id ?? '-'} D${l.debit} C${l.credit} B${l.balance}`);
  return [...v, ...c].join('\n   ');
};
const EXPLORE = process.env.EXPLORE === '1';
async function step(name, fn) {
  const before = store.vendor_ledger.length + store.customer_ledger.length;
  globalThis.__errs = [];
  const r = await fn();
  // MySQL fills created_at (DEFAULT now()); the in-memory store does not.
  for (const t of ['deadstock', 'vendor_balance_logs', 'customer_balance_logs']) for (const row of store[t]) if (!row.created_at) row.created_at = new Date(Date.UTC(2026, 9, TODAY.d, 6));
  if (EXPLORE) out(`\n## ${name}: ${r?.status} ${JSON.stringify(r?.body)?.slice(0, 300)}\n   ${ledgerDump()}`);
  if (globalThis.__errs.length) out(`   errors logged: ${globalThis.__errs.join(' | ')}`);
  await checkAll(name);
  await checkReports(name);
  return r;
}
const TODAY = { d: 1 };
const day = (d) => { TODAY.d = d; return `2026-10-${String(d).padStart(2, '0')}`; };

test('business story: 45 steps over 8 days, assertions and 16 reports after each, hand totals, tamper checks', async () => {
  stats.failures = [];
  let r;
  // ---------------- Day 1: purchases
  r = await step('P1 Bosch, unpaid, P&F and freight', () => call(purchases, 'POST', {}, { vendor_id: 1, date: day(1), payment_status: 0, payment_mode: 0, state_code: 9,
    transport_cost: 50, packing_forwarding_qty: 3, packing_forwarding_rate: 100 / 3, items: [{ product_id: 1, qty: 10, rate: 100, gst_percentage: 18 }] }));
  const P1 = r.body?.purchase?.id;
  r = await step('P2 Delhi Parts (IGST), paid cash', () => call(purchases, 'POST', {}, { vendor_id: 2, date: day(1), payment_status: 1, payment_mode: 0, state_code: 7,
    items: [{ product_id: 2, qty: 5, rate: 200, gst_percentage: 18 }] }));
  const P2 = r.body?.purchase?.id;
  r = await step('P3 Other vendor, unpaid, no tax', () => call(purchases, 'POST', {}, { vendor_id: 0, vendor_name: 'Roadside Spares', contact_number: '9876543210', date: day(1), payment_status: 0, payment_mode: 0, state_code: 9,
    items: [{ product_id: 3, qty: 20, rate: 50, gst_percentage: 0 }] }));
  const P3 = r.body?.purchase?.id;

  // ---------------- Day 2: sales
  r = await step('S1 Ravi, unpaid', () => call(sales, 'POST', {}, { select_customer: 1, date: day(2), payment_status: 0, payment_mode: 0,
    invoiceItems: [{ product_id: 1, qty: 2, rate: 300, gst_percentage: 18 }] }));
  const S1 = r.body?.id ?? r.body?.sale?.id ?? r.body?.data?.id;
  r = await step('S2 Asha (IGST), paid bank', () => call(sales, 'POST', {}, { select_customer: 2, date: day(2), payment_status: 1, payment_mode: 1,
    invoiceItems: [{ product_id: 2, qty: 1, rate: 500, gst_percentage: 18 }] }));
  const S2 = r.body?.id ?? r.body?.sale?.id ?? r.body?.data?.id;
  r = await step('S3 walk-in, paid cash', () => call(sales, 'POST', {}, { select_customer: 0, customer_name: 'Walk-in', contact_number: '9000000000', state_code: 9, date: day(2), payment_status: 1, payment_mode: 0,
    invoiceItems: [{ product_id: 3, qty: 3, rate: 80, gst_percentage: 0 }] }));
  r = await step('X1 Invoice C Ravi, unpaid', () => call(salex, 'POST', {}, { select_customer: 1, date: day(2), payment_status: 0, payment_mode: 0,
    invoiceItems: [{ product_id: 3, qty: 2, rate: 70 }] }));
  const X1 = r.body?.id ?? r.body?.sale?.id ?? r.body?.data?.id;
  out(`ids P ${P1} ${P2} ${P3} S ${S1} ${S2} X ${X1}`);

  // ---------------- Day 3: payments
  r = await step('Ravi pays 500 on S1', () => call(cpCreate, 'POST', {}, { customer_id: 1, payment_date: day(3), payment_mode: 0, payment_amount: 500, allocations: [{ invoice_id: S1, allocated_amount: 500 }] }));
  const CP1 = r.body?.data?.payment?.id;
  r = await step('Ravi pays 400: S1 208, X1 140, 52 advance', () => call(cpCreate, 'POST', {}, { customer_id: 1, payment_date: day(3), payment_mode: 1, payment_amount: 400, allocations: [{ invoice_id: S1, allocated_amount: 208 }, { invoicex_id: X1, allocated_amount: 140 }] }));
  const CP2 = store.customer_payments.at(-1)?.id;
  r = await step('Bosch paid 1000: 800 on P1, 200 advance', () => call(vpCreate, 'POST', {}, { vendor_id: 1, payment_date: day(3), payment_mode: 1, payment_amount: 1000, allocations: [{ purchase_id: P1, allocated_amount: 800 }] }));
  r = await step('Bosch paid 300 on account', () => call(vpCreate, 'POST', {}, { vendor_id: 1, payment_date: day(3), payment_mode: 0, payment_amount: 300, payment_type: 'DIRECT', allocations: [] }));
  const VP2 = store.vendor_payments.at(-1)?.id;

  // ---------------- Day 4: purchase from advance, returns
  r = await step('P4 Bosch paid: 500 from advance + 90 new', () => call(purchases, 'POST', {}, { vendor_id: 1, date: day(4), payment_status: 1, payment_mode: 0, state_code: 9,
    items: [{ product_id: 1, qty: 5, rate: 100, gst_percentage: 18 }] }));
  const P4 = r.body?.purchase?.id;
  const s1Line = store.invoiceitems.find(l => l.invoice_no === S1), x1Line = store.invoice_itemsx.find(l => l.invoice_no === X1);
  r = await step('S1 return 1 pad, refunded cash', () => call(srCreate, 'POST', {}, { customer_id: 1, return_date: day(4), payment_status: 1, payment_mode: 0, items: [{ invoice_item_id: s1Line?.id, invoice_type: 'invoice', return_qty: 1, return_reason_id: 1 }] }));
  const SR1 = store.sale_returns.at(-1)?.id;
  r = await step('X1 return 1 filter, pending', () => call(srCreate, 'POST', {}, { customer_id: 1, return_date: day(4), payment_status: 0, payment_mode: 0, items: [{ invoice_item_id: x1Line?.id, invoice_type: 'invoicex', return_qty: 1, return_reason_id: 1 }] }));
  const XR1 = store.salex_returns.at(-1)?.id;
  const p1Line = store.purchaseitems.find(l => l.purchase_id === P1), p2Line = store.purchaseitems.find(l => l.purchase_id === P2);
  r = await step('P1 return 2 pads, refunded', () => call(prCreate, 'POST', {}, { vendor_id: 1, return_date: day(4), payment_status: 1, payment_mode: 1, items: [{ purchase_item_id: p1Line?.id, return_qty: 2, return_reason_id: 1 }] }));
  const PR1 = store.purchase_returns.at(-1)?.id;
  r = await step('P2 return 1 clutch, pending', () => call(prCreate, 'POST', {}, { vendor_id: 2, return_date: day(4), payment_status: 0, payment_mode: 1, items: [{ purchase_item_id: p2Line?.id, return_qty: 1, return_reason_id: 1 }] }));
  const PR2 = store.purchase_returns.at(-1)?.id;

  // ---------------- Day 5: refunds, dead stock
  r = await step('Ravi refunded his 52 advance', () => call(crCreate, 'POST', {}, { customer_id: 1, refund_amount: 52, refund_mode: 0, refund_date: day(5), allocations: [] }));
  r = await step('Bosch refunds 100 on account', () => call(vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 100, refund_mode: 0, refund_date: day(5), allocations: [] }));
  const VR1 = store.vendor_refunds.at(-1)?.id;
  r = await step('Dead stock: 1 oil filter', () => call(deadCreate, 'POST', {}, { product_id: 3, quantity: 1, reason: 'Rusted' }));
  const D1 = store.deadstock.at(-1)?.id;

  // ---------------- Day 6: edits
  r = await step('Edit P1: freight 50 -> 0', () => call(purchaseOne, 'PUT', { id: String(P1) }, { transport_cost: 0 }));
  r = await step('Edit S2 (paid): 1 clutch -> 2', () => call(saleOne, 'PUT', { id: String(S2) }, { invoiceItems: [{ ...(store.invoiceitems.find(l => l.invoice_no === S2) || {}), line_id: store.invoiceitems.find(l => l.invoice_no === S2)?.id, product_id: 2, qty: 2, rate: 500, gst_percentage: 18 }] }));
  r = await step('Edit Ravi payment 500 -> 450', () => call(cpOne, 'PUT', { id: String(CP1) }, { payment_amount: 450, payment_date: day(3), payment_mode: 0, payment_type: 'BILL_SPECIFIC', allocations: [{ invoice_id: S1, allocated_amount: 450 }] }));
  r = await step('Edit Bosch on-account payment 300 -> 250', () => call(vpOne, 'PUT', { id: String(VP2) }, { payment_amount: 250, payment_date: day(3), payment_mode: 0, payment_type: 'DIRECT', allocations: [] }));
  r = await step('Edit X1 return: refunded', () => call(srOne, 'PUT', { id: String(XR1), type: 'invoicex' }, { payment_status: 1, payment_mode: 0, items: [{ invoice_item_id: x1Line?.id, invoice_type: 'invoicex', return_qty: 1, return_reason_id: 1 }] }));
  r = await step('Edit P2 return: refunded', () => call(prOne, 'PUT', { id: String(PR2) }, { payment_status: 1, payment_mode: 0, items: [{ purchase_item_id: p2Line?.id, return_qty: 1, return_reason_id: 1 }] }));

  // ---------------- Day 7: deletes
  r = await step('Delete Bosch refund', () => call(vrOne, 'DELETE', { id: String(VR1) }));
  r = await step('Delete Ravi payment 400', () => call(cpOne, 'DELETE', { id: String(CP2) }));
  r = await step('Delete S2 (paid sale)', () => call(saleOne, 'DELETE', { id: String(S2) }));
  r = await step('Delete P3 (refused: units sold)', () => call(purchaseOne, 'DELETE', { id: String(P3) }));
  r = await step('Delete P4 (paid from advance)', () => call(purchaseOne, 'DELETE', { id: String(P4) }));
  r = await step('Delete dead stock', () => call(deadOne, 'DELETE', { id: String(D1) }));
  r = await step('Delete S1 return (refunded)', () => call(srOne, 'DELETE', { id: String(SR1), type: 'invoice' }));
  r = await step('Delete P1 return (refunded)', () => call(prOne, 'DELETE', { id: String(PR1) }));


  // ---------------- Day 8: more edits - refunds, paid <-> unpaid, a bill after part payment, a mixed payment deleted
  r = await step('Bosch refunds 60 on account', () => call(vrCreate, 'POST', {}, { vendor_id: 1, refund_amount: 60, refund_mode: 1, refund_date: day(8), allocations: [] }));
  const VR2 = store.vendor_refunds.at(-1)?.id;
  r = await step('Edit Bosch refund 60 -> 45', () => call(vrOne, 'PUT', { id: String(VR2) }, { refund_amount: 45, refund_mode: 1, refund_date: day(8), refund_type: 'DIRECT', allocations: [] }));
  ok('vendor refund edit saved', r.status === 200 && store.vendor_refunds.find(x => x.id === VR2)?.refund_amount === 45, r.body);
  r = await step('Ravi refunded 20 on account', () => call(crCreate, 'POST', {}, { customer_id: 1, refund_amount: 20, refund_mode: 1, refund_date: day(8), allocations: [] }));
  const CR2 = store.customer_refunds.at(-1)?.id;
  r = await step('Edit Ravi refund 20 -> 15', () => call(crOne, 'PUT', { id: String(CR2) }, { refund_amount: 15, refund_mode: 1, refund_date: day(8), refund_type: 'DIRECT', allocations: [] }));
  ok('customer refund edit saved', r.status === 200 && store.customer_refunds.find(x => x.id === CR2)?.refund_amount === 15, r.body);
  r = await step('S4 Asha, paid cash', () => call(sales, 'POST', {}, { select_customer: 2, date: day(8), payment_status: 1, payment_mode: 0, invoiceItems: [{ product_id: 1, qty: 1, rate: 300, gst_percentage: 18 }] }));
  const S4 = r.body?.sale?.id;
  r = await step('Edit S4: paid -> unpaid', () => call(saleOne, 'PUT', { id: String(S4) }, { payment_status: 0 }));
  ok('S4 unpaid', store.invoice.find(x => x.id === S4)?.payment_status === 0, store.invoice.find(x => x.id === S4));
  r = await step('Edit S4: unpaid -> paid', () => call(saleOne, 'PUT', { id: String(S4) }, { payment_status: 1, payment_mode: 1 }));
  if (process.env.DUMP2) out(JSON.stringify({ logs: store.customer_balance_logs.filter(l => l.customer_id === 2).map(l => [l.column_name, l.change_amount, l.old_value, l.new_value, l.source_type]), c: store.customer_details[1], pays: store.customer_payments.filter(p => p.customer_id === 2), al: store.customer_payment_allocations }));
  ok('S4 paid again', store.invoice.find(x => x.id === S4)?.payment_status === 1, store.invoice.find(x => x.id === S4));
  r = await step('P5 Delhi Parts, paid bank', () => call(purchases, 'POST', {}, { vendor_id: 2, date: day(8), payment_status: 1, payment_mode: 1, state_code: 7, items: [{ product_id: 2, qty: 2, rate: 200, gst_percentage: 18 }] }));
  const P5 = r.body?.purchase?.id;
  r = await step('Edit P5: paid -> unpaid', () => call(purchaseOne, 'PUT', { id: String(P5) }, { payment_status: 0 }));
  ok('P5 unpaid', store.purchase.find(x => x.id === P5)?.payment_status === 0, store.purchase.find(x => x.id === P5));
  r = await step('Edit P5: unpaid -> paid', () => call(purchaseOne, 'PUT', { id: String(P5) }, { payment_status: 1, payment_mode: 0 }));
  ok('P5 paid again', store.purchase.find(x => x.id === P5)?.payment_status === 1, store.purchase.find(x => x.id === P5));
  const s1l = store.invoiceitems.find(l => l.invoice_no === S1);
  r = await step('Edit S1 (part paid): 2 pads -> 3', () => call(saleOne, 'PUT', { id: String(S1) }, { invoiceItems: [{ line_id: s1l?.id, product_id: 1, qty: 3, rate: 300, gst_percentage: 18 }] }));
  ok('S1 total 1062, still part paid', store.invoice.find(x => x.id === S1)?.total === 1062 && store.invoice.find(x => x.id === S1)?.payment_status === 2, store.invoice.find(x => x.id === S1));
  const vpMixed = store.vendor_payments.find(x => x.payment_type === 'MIXED');
  r = await step('Delete Bosch mixed payment 1000', () => call(vpOne, 'DELETE', { id: String(vpMixed?.id) }));
  ok('P1 back to unpaid', store.purchase.find(x => x.id === P1)?.payment_status === 0, store.purchase.find(x => x.id === P1));

  // ---------------- The story's end, worked out by hand
  const owes = (ledger, who, id) => r2(sum(ledger.filter(l => l[who] === id), l => N(l.debit) - N(l.credit)));
  ok('hand: Ravi owes 749 (S1 1062 + X1 140 - paid 450 - credit note 70 + refunds 52 + 15)', owes(store.customer_ledger, 'customer_id', 1) === 749, owes(store.customer_ledger, 'customer_id', 1));
  ok('hand: Asha is square (S4 354 paid, unpaid, paid again)', owes(store.customer_ledger, 'customer_id', 2) === 0, store.customer_ledger.filter(l => l.customer_id === 2));
  ok('hand: we owe Bosch 1075 (P1 1280 - paid 250 + refund received 45)', owes(store.vendor_ledger, 'vendor_id', 1) === 1075, owes(store.vendor_ledger, 'vendor_id', 1));
  ok('hand: Delhi Parts -236 (bills 1180 + 472 paid in full, debit note 236)', owes(store.vendor_ledger, 'vendor_id', 2) === -236, owes(store.vendor_ledger, 'vendor_id', 2));
  ok('hand: Other vendor 1000 (P3, its delete refused)', owes(store.vendor_ledger, 'vendor_id', 0) === 1000, owes(store.vendor_ledger, 'vendor_id', 0));
  const co = (await call(custOut, 'GET', { page: '1', limit: '50' })).body, vo = (await call(vendOut, 'GET', { page: '1', limit: '50' })).body;
  ok('hand: outstanding reports - customers owe 749, vendors owed 2075, credit 236', co.totals.owed === 749 && co.totals.credit === 0 && vo.totals.owed === 2075 && vo.totals.credit === 236, { c: co.totals, v: vo.totals });
  const stockOf = (id) => store.product.find(p => p.id === id).stock;
  ok('hand: stock Brake Pad 6, Clutch Plate 6, Oil Filter 16', stockOf(1) === 6 && stockOf(2) === 6 && stockOf(3) === 16, store.product.map(p => p.stock));
  const cb = (await call(cashBookR, 'GET', RANGE)).body.totals;
  ok('hand: cash book in 1085 (450 + 354 received, 45 + 236 back from vendors)', cb.in === 1085, cb);
  ok('hand: cash book out 2039 (1180 + 250 + 472 paid, 52 + 15 + 70 back to Ravi)', cb.out === 2039, cb);
  const sr = (await call(salesR, 'GET', RANGE)).body.summary, pr = (await call(purchaseR, 'GET', RANGE)).body.summary;
  ok('hand: sales 3 bills 1656 (1 part paid, 2 paid); purchases 4 bills 3932 (2 paid, 2 unpaid)', sr.totalSales === 3 && sr.totalRevenue === 1656 && sr.partiallyPaidSales === 1 && sr.paidSales === 2
    && pr.totalSales === 4 && pr.totalRevenue === 3932 && pr.paidSales === 2 && pr.unpaidSales === 2, { sr, pr });

  // ---------------- Tamper with one thing at a time: the assertion meant to catch it must fail
  const expectCatch = async (label, id, pattern, mutate) => {
    const undo = mutate();
    const res = await quiet(() => audit.run([id], { quiet: true }));
    undo();
    const f = res[0]?.failures || [];
    ok(`tamper: ${label} -> ${id} fails`, f.some(x => pattern.test(x)), f);
  };
  const setField = (row, k, v) => { const old = row[k]; row[k] = v; return () => { row[k] = old; }; };
  const pushRow = (table, row) => { store[table].push(row); return () => { store[table].splice(store[table].indexOf(row), 1); }; };
  const pull = (table, row) => { const i = store[table].indexOf(row); store[table].splice(i, 1); return () => { store[table].splice(i, 0, row); }; };
  const p1Row = store.vendor_ledger.find(l => l.reference_type === 'purchase' && l.reference_id === P1 && l.transaction_type === 'PURCHASE');
  await expectCatch('a bill posted 10 short', 'A12', /ledger rows net/, () => setField(p1Row, 'debit', p1Row.debit - 10));
  const cpRow = store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED' && l.transaction_id === CP1);
  await expectCatch('a payment missing from the ledger', 'A12', /payments/, () => pull('customer_ledger', cpRow));
  const walkIn = store.invoice.find(b => b.select_customer === 0);
  await expectCatch('a walk-in sale posted', 'A12', /walk-in/, () => pushRow('customer_ledger', { id: 90001, customer_id: 1, transaction_type: 'SALE', reference_type: 'sale', reference_id: walkIn.id, debit: 240, credit: 0, balance: 0 }));
  await expectCatch('a refund row on a return that differs from its refund', 'A12', /REFUND rows net/, () => pushRow('customer_ledger', { id: 90002, customer_id: 1, transaction_type: 'REFUND', reference_type: 'salex_return', reference_id: XR1, transaction_id: XR1, debit: 50, credit: 0, balance: 0 }));
  await expectCatch('a row for a purchase that is gone', 'A13', /does not exist/, () => pushRow('vendor_ledger', { id: 90003, vendor_id: 1, transaction_type: 'PURCHASE', reference_type: 'purchase', reference_id: 99999, debit: 0, credit: 0, balance: 0 }));
  const vpRow = store.vendor_ledger.find(l => l.transaction_type === 'PAYMENT' && l.transaction_id);
  await expectCatch('a payment row without its payment id', 'A13', /no payment id/, () => setField(vpRow, 'transaction_id', null));
  await expectCatch('a payment row on the wrong vendor', 'A13', /belongs to party/, () => setField(vpRow, 'vendor_id', vpRow.vendor_id === 1 ? 2 : 1));
  await expectCatch('a hand-written ledger row', 'A13', /not one the app writes/, () => pushRow('customer_ledger', { id: 90004, customer_id: 1, transaction_type: 'RECEIPT_ADJUSTMENT', reference_type: 'payment', debit: 0, credit: 5, balance: 0 }));
  await expectCatch('a counter moved without a log row', 'A14', /log ends at/, () => setField(store.customer_details[0], 'total_paid', store.customer_details[0].total_paid + 5));
  const logRow = store.vendor_balance_logs.find(l => l.vendor_id === 1);
  await expectCatch('a log row that does not add up', 'A14', /is not/, () => setField(logRow, 'new_value', N(logRow.new_value) + 3));
  const pRow = store.purchase.find(x => x.id === P1);
  await expectCatch('a purchase total that is neither with nor without freight', 'A4', /freight/, () => setField(pRow, 'total', pRow.total + 7));
  const final = await quiet(() => audit.run([], { quiet: true }));
  ok('after the tampering: all fourteen clean again, none empty', final.every(x => !x.failures.length && x.checked > 0), final.filter(x => x.failures.length || !x.checked).map(x => ({ id: x.id, f: x.failures.slice(0, 2), c: x.checked })));

  if (process.env.PROBE === '1') {
    const q = { dateFrom: day(1), dateTo: '2026-10-31', startDate: day(1), endDate: '2026-10-31', page: '1', limit: '50' };
    for (const [name, h, extra] of [['custOut', custOut, {}], ['vendOut', vendOut, {}], ['custLedger', custLedger, { customer_id: '1' }], ['vendLedger', vendLedger, { vendor_id: '1' }],
      ['custLogs', custLogs, { customer_id: '1' }], ['vendLogs', vendLogs, { vendor_id: '1' }], ['cashBook', cashBookR, {}], ['sales', salesR, {}], ['purchase', purchaseR, {}], ['salex', salexR, {}],
      ['gst', gstR, {}], ['credit', creditR, {}], ['debit', debitR, {}], ['returns', returnsR, {}], ['profit', profitR, {}], ['stock', stockR, {}]]) {
      const r = await call(h, 'GET', { ...q, ...extra });
      out(`\n#### ${name} ${r.status}\n${JSON.stringify(r.body).slice(0, 2500)}`);
    }
  }
  expect(stats.failures).toEqual([]);
}, 170000);
