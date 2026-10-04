// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import ledger from '../../../pages/api/reports/customer-ledger-accounting';
import logs from '../../../pages/api/reports/customer-balance-logs';
import vlogs from '../../../pages/api/reports/vendor-balance-logs';
import billref from '../../../pages/api/reports/bill-reference-sale';
import note from '../../../pages/api/customer-ledger/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, query, method = 'GET', body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
const sqls = []; globalThis.__raw = async (sql, ...params) => { sqls.push({ sql, params }); return sql.includes('COUNT(*) AS n') ? [{ n: 3n }] : [{ id: 4n, invoice_no: 9, bill_reference: 'ab', total: 10, invoice_date: 100, payment_status: 1, type: 'salex', customer_name: 'Snap' }]; };
test('customer ledger report', async () => {
  store.customer_ledger = [1, 2, 3, 4, 5].map(d => ({ id: d, customer_id: 1, transaction_date: d * 86400, created_at: d, debit: 100, credit: 0, balance: 0 }));
  let r = await call(ledger, { customer_id: '1', page: '2', limit: '2' });
  ok('SA-18: page 2 opening = 200', r.body.openingBalance === 200 && r.body.entries[0].balance === 300, r.body);
  r = await call(ledger, { customer_id: '1', dateFrom: '1970-01-03', dateTo: '1970-01-04' });
  ok('SA-18: dated view opens with earlier days', r.body.openingBalance > 0, r.body);
  ok('needs a customer', (await call(ledger, {})).status === 400);

  store.customer_details = [{ id: 1, billing_name: 'C', total_paid: 5, total_allocated: 3, total_refunded: 0, total_refund_allocated: 0 }];
  store.customer_balance_logs = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, customer_id: 1, column_name: 'total_paid', change_amount: 1, old_value: 0, new_value: 1, created_at: new Date(1000 + i), customer: { id: 1, billing_name: 'C' } }));
  r = await call(logs, { customer_id: '1', get_balance: 'true' });
  ok('SA-29: counters as numbers', r.body.balance.total_paid === 5, r.body);
  ok('SA-29: unknown customer 404', (await call(logs, { customer_id: '99', get_balance: 'true' })).status === 404);
  r = await call(logs, { customer_id: '1' });
  ok('SA-29: logs paged at 50', r.body.data.length === 50 && r.body.pagination.total === 60, r.body.pagination);
  ok('vendor route answers too', (await call(vlogs, {})).status === 200);

  r = await call(billref, { billReference: 'ab', dateTo: '2026-10-02' });
  ok('SA-19: bill ref 200', r.status === 200 && r.body.sales[0].customer_name === 'Snap' && r.body.pagination.total === 3, r.body);
  for (const { sql, params } of sqls) ok('placeholders = params', (sql.match(/\?/g) || []).length === params.length, [(sql.match(/\?/g) || []).length, params.length]);
  ok('no insensitive mode', !sqls.some(s => /insensitive/.test(s.sql)));

  r = await call(note, { id: '2' }, 'PATCH', { notes: ' hi ' });
  ok('SA-36: customer note route exists', r.status === 200 && store.customer_ledger.find(l => l.id === 2).notes === 'hi', r);
  expect(FAILED).toEqual([]);
}, 170000);
