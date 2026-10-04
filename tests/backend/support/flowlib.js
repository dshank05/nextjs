// Shared by flowcheck.js and scenariocheck.js: the real API handlers, seed data, the A1-A14 run
// and the report checks (each report recomputed from the documents and the ledger).
import { store } from './dbstub.js';
import { installSqlMirror } from './sqlmirror.js';
import purchases from '../../../pages/api/purchases/index';
import purchaseOne from '../../../pages/api/purchases/[id]';
import sales from '../../../pages/api/sales/index';
import saleOne from '../../../pages/api/sales/[id]';
import salex from '../../../pages/api/salex/index';
import salexOne from '../../../pages/api/salex/[id]';
import cpCreate from '../../../pages/api/customer-payments/index';
import cpOne from '../../../pages/api/customer-payments/[id]';
import vpCreate from '../../../pages/api/vendor-payments/index';
import vpOne from '../../../pages/api/vendor-payments/[id]';
import crCreate from '../../../pages/api/customer-refunds/index';
import crOne from '../../../pages/api/customer-refunds/[id]';
import vrCreate from '../../../pages/api/vendor-refunds/index';
import vrOne from '../../../pages/api/vendor-refunds/[id]';
import srCreate from '../../../pages/api/sale-returns/customer-return';
import srOne from '../../../pages/api/sale-returns/[id]';
import prCreate from '../../../pages/api/purchase-returns/vendor-return';
import prOne from '../../../pages/api/purchase-returns/[id]';
import deadCreate from '../../../pages/api/deadstock/index';
import deadOne from '../../../pages/api/deadstock/[id]';
import custOut from '../../../pages/api/reports/customer-outstanding';
import vendOut from '../../../pages/api/reports/vendor-outstanding';
import custLedger from '../../../pages/api/reports/customer-ledger-accounting';
import vendLedger from '../../../pages/api/reports/vendor-ledger-accounting';
import custLogs from '../../../pages/api/reports/customer-balance-logs';
import vendLogs from '../../../pages/api/reports/vendor-balance-logs';
import cashBookR from '../../../pages/api/reports/cash-book';
import salesR from '../../../pages/api/reports/sales';
import purchaseR from '../../../pages/api/reports/purchase';
import salexR from '../../../pages/api/reports/salex-report';
import gstR from '../../../pages/api/reports/gst';
import creditR from '../../../pages/api/reports/credit-notes';
import debitR from '../../../pages/api/reports/debit-notes';
import returnsR from '../../../pages/api/reports/returns';
import profitR from '../../../pages/api/reports/profit';
import stockR from '../../../pages/api/reports/opening-closing';
export const audit = require('../../../scripts/audit-assert.js');

export const out = (s) => process.stdout.write(s + '\n');
export const stats = { fail: 0, pass: 0, failures: [] };
// A failed check is collected for the running jest test, which expects none.
export const ok = (n, c, i) => { if (!c) { stats.fail++; stats.failures.push(`${n}  ${JSON.stringify(i)?.slice(0, 700)}`); } else stats.pass++; };
export const quiet = async (fn) => { const l = console.log, w = console.warn, e = console.error, inf = console.info; console.log = console.warn = console.info = () => {}; console.error = (...a) => { globalThis.__errs = [...(globalThis.__errs || []), a.map(String).join(' ').slice(0, 300)]; };
  try { return await fn(); } finally { console.log = l; console.warn = w; console.error = e; console.info = inf; } };
export const call = (h, method, query = {}, body) => quiet(async () => { let status = 200, payload; const res = { status(s) { status = s; return res; }, json(b) { payload = b; return res; }, setHeader() { return res; }, send(b) { payload = b; return res; }, end() { return res; } };
  await h({ method, query, body, headers: {} }, res); return { status, body: payload }; });


const zero = { total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0, account_balance: 0 };
export function reset() {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5', business_name: 'Baijnath Sons' }],
    financial_year: [{ id: 4, start_date: Math.floor(Date.UTC(2026, 3, 1) / 1000) - 19800, end_date: Math.floor(Date.UTC(2027, 2, 31) / 1000) - 19800, is_current: true }],
    vendor_details: [{ id: 0, vendor_name: 'Other', status: 'Active', ...zero }, { id: 1, vendor_name: 'Bosch', state_code: 9, status: 'Active', contact_no: '1', ...zero }, { id: 2, vendor_name: 'Delhi Parts', state_code: 7, status: 'Active', contact_no: '2', ...zero }],
    customer_details: [{ id: 1, billing_name: 'Ravi', billing_state: 'UP', billing_state_code: 9, contact_no: '91', status: 'Active', ...zero }, { id: 2, billing_name: 'Asha', billing_state: 'DL', billing_state_code: 7, contact_no: '92', status: 'Active', ...zero }],
    product: [
      { id: 1, product_name: 'Brake Pad', stock: 0, opening_stock: 0, is_active: true, hsn: '8708', gst_percentage: 18, product_category_id: 1, minimum_stock: 0 },
      { id: 2, product_name: 'Clutch Plate', stock: 0, opening_stock: 0, is_active: true, hsn: '8708', gst_percentage: 18, product_category_id: 1, minimum_stock: 0 },
      { id: 3, product_name: 'Oil Filter', stock: 0, opening_stock: 0, is_active: true, hsn: '8421', gst_percentage: 0, product_category_id: 1, minimum_stock: 0 }],
    product_category: [{ id: 1, category_name: 'Brakes' }],
    return_reasons: [{ id: 1, reason: 'Damaged', status: 'Active' }],
    staff: [], mechanic: [], note_counters: [],
    purchase: [], purchaseitems: [], bill_to: [], invoice: [], invoicex: [], invoiceitems: [], invoice_itemsx: [], bill_tosales: [], bill_tosalesx: [], shipto: [], shiptox: [],
    transport_details: [], transport_detailsx: [], vendor_ledger: [], customer_ledger: [], vendor_payments: [], payment_allocations: [], customer_payments: [], customer_payment_allocations: [],
    vendor_refunds: [], refund_allocations: [], customer_refunds: [], customer_refund_allocations: [], purchase_returns: [], purchase_return_items: [], sale_returns: [], sale_return_items: [],
    salex_returns: [], salex_return_items: [], deadstock: [], vendor_balance_logs: [], customer_balance_logs: [], incexp: [], incexpx: []
  });
}
reset();
installSqlMirror(store, {}, {});

// ---- after every step
export const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
export const r2 = (n) => Math.round(n * 100) / 100;
export async function checkAll(step, known = []) {
  const res = await quiet(() => audit.run([], { quiet: true }));
  for (const r of res.filter(r => r.failures.length && known.includes(r.id))) out(`KNOWN ${step}: ${r.id} - ${r.failures[0]}`);
  const bad = res.filter(r => r.failures.length && !known.includes(r.id));
  ok(`${step}: A1-A14 clean`, bad.length === 0, bad.map(b => ({ id: b.id, f: b.failures.slice(0, 4) })));
}


// ---- reports against the documents and the ledger, worked out here independently
export const N = (v) => Number(v || 0);
const near2 = (a, b) => Math.abs(N(a) - N(b)) < 0.011;
export const RANGE = { dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '500' };
export async function checkReports(stepName) {
  // MySQL fills created_at (DEFAULT now()); the in-memory store does not.
  for (const t of ['deadstock', 'vendor_balance_logs', 'customer_balance_logs']) for (const row of store[t] || []) if (!row.created_at) row.created_at = new Date(Date.UTC(2026, 9, 2, 6));
  const miss = {};
  const eq = (rep, what, got, want) => { if (!near2(got, want)) (miss[rep] = miss[rep] || []).push(`${what}: got ${got}, want ${want}`); };
  const has = (rep, what, cond) => { if (!cond) (miss[rep] = miss[rep] || []).push(what); };

  // Outstanding and ledger accounts, both parties
  for (const [side, master, ledger, who, outH, ledH, logsH, logs, key] of [
    ['customer', store.customer_details, store.customer_ledger, 'customer_id', custOut, custLedger, custLogs, store.customer_balance_logs, 'outstandingCustomers'],
    ['vendor', store.vendor_details, store.vendor_ledger, 'vendor_id', vendOut, vendLedger, vendLogs, store.vendor_balance_logs, 'outstandingVendors']]) {
    const o = await call(outH, 'GET', { page: '1', limit: '500' });
    const listed = new Map((o.body?.[key] || []).map(x => [x[who], x]));
    let owed = 0, credit = 0;
    for (const party of master) {
      const rows = ledger.filter(l => l[who] === party.id);
      const bal = r2(sum(rows, l => N(l.debit) - N(l.credit)));
      if (bal > 0) owed += bal; else credit -= bal;
      const rep = `${side} outstanding`;
      if (Math.abs(bal) > 0.005) { has(rep, `${side} ${party.id} owes ${bal} but is not listed`, listed.has(party.id)); if (listed.has(party.id)) eq(rep, `${side} ${party.id} balance`, listed.get(party.id).balance, bal); }
      else has(rep, `${side} ${party.id} is square but listed with ${listed.get(party.id)?.balance}`, !listed.has(party.id) || near2(listed.get(party.id).balance, 0));
      if (rows.length) {
        const L = await call(ledH, 'GET', { [who]: String(party.id), page: '1', limit: '500' });
        const e = L.body?.entries || [];
        const lr = `${side} ledger account`;
        // The ledger account lists money movements; a row of 0 / 0 (a zero bill) is not one.
        eq(lr, `${side} ${party.id} rows`, e.length, rows.filter(l => N(l.debit) || N(l.credit)).length);
        eq(lr, `${side} ${party.id} closing`, e.at(-1)?.balance, bal);
        eq(lr, `${side} ${party.id} debits`, sum(e, x => N(x.debit)), sum(rows, l => N(l.debit)));
        eq(lr, `${side} ${party.id} credits`, sum(e, x => N(x.credit)), sum(rows, l => N(l.credit)));
      }
      const mine = logs.filter(l => l[who] === party.id);
      if (mine.length) {
        const g = await call(logsH, 'GET', { [who]: String(party.id), page: '1', limit: '500' });
        const lr = `${side} balance logs`;
        eq(lr, `${side} ${party.id} rows`, g.body?.pagination?.total, mine.length);
        for (const c of ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated']) eq(lr, `${side} ${party.id} ${c} changes`, g.body?.totals?.[c], sum(mine.filter(l => l.column_name === c), l => N(l.change_amount)));
        const bal2 = await call(logsH, 'GET', { [who]: String(party.id), get_balance: 'true' });
        for (const c of ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated']) eq(lr, `${side} ${party.id} ${c} now`, bal2.body?.balance?.[c], party[c]);
      }
    }
    eq(`${side} outstanding`, 'total owed', o.body?.totals?.owed, owed);
    eq(`${side} outstanding`, 'total credit', o.body?.totals?.credit, credit);
  }

  // Bill reports
  const KINDS = [['sales report', salesR, store.invoice, store.invoiceitems, 'invoice_no', store.sale_returns],
    ['Invoice C report', salexR, store.invoicex, store.invoice_itemsx, 'invoice_no', store.salex_returns],
    ['purchase report', purchaseR, store.purchase, store.purchaseitems, 'purchase_id', store.purchase_returns]];
  for (const [rep, h, bills, lines, fk, rets] of KINDS) {
    const b = (await call(h, 'GET', RANGE)).body?.summary || {};
    eq(rep, 'bills', b.totalSales, bills.length);
    eq(rep, 'total', b.totalRevenue, sum(bills, x => N(x.total)));
    eq(rep, 'tax', b.tax, sum(bills, x => N(x.total_tax)));
    for (const c of ['cgst', 'sgst', 'igst']) eq(rep, c, b[c], sum(bills, x => N(x['total_' + c])));
    eq(rep, 'paid bills', b.paidSales, bills.filter(x => x.payment_status === 1).length);
    eq(rep, 'unpaid bills', b.unpaidSales, bills.filter(x => !x.payment_status).length);
    eq(rep, 'part-paid bills', b.partiallyPaidSales, bills.filter(x => x.payment_status === 2).length);
    eq(rep, 'units', b.totalItems, sum(lines.filter(l => bills.some(x => x.id === l[fk])), l => N(l.qty)));
    eq(rep, 'returns', b.returnsCount, rets.length);
    eq(rep, 'returns amount', b.returnsAmount, sum(rets, x => N(x.refund_amount)));
    eq(rep, 'net', b.netRevenue, sum(bills, x => N(x.total)) - sum(rets, x => N(x.refund_amount)));
  }

  // GST
  const g = (await call(gstR, 'GET', RANGE)).body || {};
  const gst = (rep, got, rows, f = (x) => x) => {
    eq('GST report', `${rep} count`, got?.count, rows.length);
    eq('GST report', `${rep} tax`, got?.tax, sum(rows, x => N(f(x).total_tax)));
    for (const c of ['cgst', 'sgst', 'igst']) eq('GST report', `${rep} ${c}`, got?.[c], sum(rows, x => N(f(x)['total_' + c])));
  };
  gst('output', g.output, store.invoice); eq('GST report', 'output total', g.output?.total, sum(store.invoice, x => N(x.total)));
  gst('input', g.input, store.purchase); eq('GST report', 'input total', g.input?.total, sum(store.purchase, x => N(x.total)));
  eq('GST report', 'Invoice C (no GST) count', g.nonGst?.count, store.invoicex.length);
  eq('GST report', 'Invoice C (no GST) total', g.nonGst?.total, sum(store.invoicex, x => N(x.total)));
  eq('GST report', 'credit notes count', g.creditNotes?.count, store.sale_returns.length);
  eq('GST report', 'credit notes tax', g.creditNotes?.tax, sum(store.sale_returns, x => N(x.total_tax)));
  eq('GST report', 'debit notes count', g.debitNotes?.count, store.purchase_returns.length);
  eq('GST report', 'debit notes tax', g.debitNotes?.tax, sum(store.purchase_returns, x => N(x.total_tax)));

  // Note registers and the returns register
  const cn = (await call(creditR, 'GET', RANGE)).body || {};
  const custRets = [...store.sale_returns, ...store.salex_returns];
  eq('credit notes report', 'notes', cn.pagination?.total, custRets.length);
  eq('credit notes report', 'refund', cn.totals?.refund, sum(custRets, x => N(x.refund_amount)));
  const dn = (await call(debitR, 'GET', RANGE)).body || {};
  eq('debit notes report', 'notes', dn.pagination?.total, store.purchase_returns.length);
  eq('debit notes report', 'refund', dn.totals?.refund, sum(store.purchase_returns, x => N(x.refund_amount)));
  eq('debit notes report', 'tax', dn.totals?.tax, sum(store.purchase_returns, x => N(x.total_tax)));
  const allRets = [...custRets, ...store.purchase_returns];
  const rr = (await call(returnsR, 'GET', RANGE)).body || {};
  eq('returns register', 'returns', rr.pagination?.total, allRets.length);
  eq('returns register', 'refund', rr.totals?.refund, sum(allRets, x => N(x.refund_amount)));
  eq('returns register', 'settled', rr.totals?.settled, sum(allRets.filter(x => x.payment_status === 1), x => N(x.refund_amount)));
  eq('returns register', 'pending', rr.totals?.pending, sum(allRets.filter(x => x.payment_status !== 1), x => N(x.refund_amount)));

  // Cash book: money that moved
  const cb = (await call(cashBookR, 'GET', RANGE)).body || {};
  const moneyIn = sum(store.customer_payments, x => N(x.payment_amount)) + sum(store.vendor_refunds, x => N(x.refund_amount)) + sum(store.purchase_returns.filter(x => x.payment_status === 1), x => N(x.refund_amount));
  const moneyOut = sum(store.vendor_payments, x => N(x.payment_amount)) + sum(store.customer_refunds, x => N(x.refund_amount)) + sum(custRets.filter(x => x.payment_status === 1), x => N(x.refund_amount));
  eq('cash book', 'in', cb.totals?.in, moneyIn);
  eq('cash book', 'out', cb.totals?.out, moneyOut);
  eq('cash book', 'closing', cb.totals?.closing, moneyIn - moneyOut);
  eq('cash book', 'rows', cb.pagination?.total, store.customer_payments.length + store.vendor_refunds.length + store.vendor_payments.length + store.customer_refunds.length + allRets.filter(x => x.payment_status === 1).length);
  const byMode = (m) => sum(store.customer_payments.filter(x => x.payment_mode === m), x => N(x.payment_amount)) + sum(store.vendor_refunds.filter(x => x.refund_mode === m), x => N(x.refund_amount)) + sum(store.purchase_returns.filter(x => x.payment_status === 1 && x.payment_mode === m), x => N(x.refund_amount))
    - sum(store.vendor_payments.filter(x => x.payment_mode === m), x => N(x.payment_amount)) - sum(store.customer_refunds.filter(x => x.refund_mode === m), x => N(x.refund_amount)) - sum(custRets.filter(x => x.payment_status === 1 && x.payment_mode === m), x => N(x.refund_amount));
  eq('cash book', 'cash net', cb.totals?.cashNet, byMode(0));
  eq('cash book', 'bank net', cb.totals?.bankNet, byMode(1));

  // Profit: sales and returns before tax
  const pf = (await call(profitR, 'GET', RANGE)).body?.total || {};
  const saleLines = [...store.invoiceitems, ...store.invoice_itemsx];
  eq('profit report', 'sales before tax', pf.sales, sum(saleLines, l => N(l.subtotal)));
  eq('profit report', 'returns before tax', pf.returns, sum(custRets, x => N(x.total_amount)));
  eq('profit report', 'net', pf.net_sales, sum(saleLines, l => N(l.subtotal)) - sum(custRets, x => N(x.total_amount)));

  // Stock: each product's closing quantity is its stock
  const st = (await call(stockR, 'GET', RANGE)).body || {};
  eq('stock report', 'products out of step', st.totals?.mismatched_products, 0);
  for (const pr of store.product) {
    const row = (st.products || []).find(x => x.product_id === pr.id);
    eq('stock report', `${pr.product_name} closing`, row?.closing_qty, pr.stock);
    eq('stock report', `${pr.product_name} dead stock`, row?.dead_stock, sum(store.deadstock.filter(d => d.product_id === pr.id), d => N(d.quantity)));
  }

  for (const [rep, list] of Object.entries(miss)) ok(`${stepName}: ${rep}`, false, list.slice(0, 6));
  const allReps = ['customer outstanding', 'vendor outstanding', 'customer ledger account', 'vendor ledger account', 'customer balance logs', 'vendor balance logs', 'sales report', 'Invoice C report', 'purchase report', 'GST report', 'credit notes report', 'debit notes report', 'returns register', 'cash book', 'profit report', 'stock report'];
  ok(`${stepName}: ${allReps.length - Object.keys(miss).length} of ${allReps.length} reports agree with the ledger and the documents`, Object.keys(miss).length === 0, Object.keys(miss));
}


export const H = { purchases, purchaseOne, sales, saleOne, salex, salexOne, cpCreate, cpOne, vpCreate, vpOne, crCreate, crOne, vrCreate, vrOne, srCreate, srOne, prCreate, prOne, deadCreate, deadOne, custOut, vendOut, custLedger, vendLedger, custLogs, vendLogs, cashBookR, salesR, purchaseR, salexR, gstR, creditR, debitR, returnsR, profitR, stockR };
