// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import ledger from '../../../pages/api/reports/vendor-ledger-accounting';
import outstanding from '../../../pages/api/reports/vendor-outstanding';
import billref from '../../../pages/api/reports/bill-reference-purchase';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, query) => { let status = 200, body; const res = { status(s) { status = s; return res; }, json(b) { body = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method: 'GET', query, headers: {} }, res); return { status, body }; };
const sqls = []; globalThis.__raw = async (sql, ...params) => { sqls.push({ sql, params }); return sql.includes('COUNT(*) AS count') ? [{ count: 1n }] : [{ party_id: 1, balance: 50, last_date: 100, name: 'V' }]; };
test('ledger and balance-log reports', async () => {
  // ledger: 5 rows, day 1..5, debit 100 each; page 2 of size 2 starts at 200
  store.vendor_ledger = [1, 2, 3, 4, 5].map(d => ({ id: d, vendor_id: 1, transaction_date: d * 86400, created_at: d, debit: 100, credit: 0, balance: 0 }));
  let r = await call(ledger, { vendor_id: '1', page: '2', limit: '2' });
  ok('page 2 opening = 200', r.body.openingBalance === 200 && r.body.entries[0].balance === 300 && r.body.entries[1].balance === 400, r.body);
  r = await call(ledger, { vendor_id: '1', page: '1', limit: '50', dateFrom: '1970-01-03', dateTo: '1970-01-04' });
  ok('dated view opens with earlier days', r.body.openingBalance > 0 && r.body.entries.length >= 1, r.body);
  ok('ledger needs vendor', (await call(ledger, {})).status === 400);
  // outstanding: SQL shape
  r = await call(outstanding, { page: '1', limit: '10', search: 'Ac', vendorFilter: '1', amountMin: '1', dateFrom: '2026-09-01', dateTo: '2026-09-30', sortBy: 'x; drop', sortOrder: 'asc' });
  ok('outstanding 200 (session stub)', r.status === 200 || r.status === 401, r);
  for (const { sql, params } of sqls) ok('outstanding placeholders = params', (sql.match(/\?/g) || []).length === params.length, [(sql.match(/\?/g) || []).length, params.length]);
  // F-47 (Phase 7): one row per vendor from the ledger SUM, not the latest row's stored balance
  ok('one row per vendor (ledger sum)', sqls[1].sql.includes('SUM(l.debit) - SUM(l.credit)') && sqls[1].sql.includes('GROUP BY l.vendor_id'), sqls[1].sql.slice(0, 200));
  ok('junk sort falls back to balance', /ORDER BY g\.balance ASC/.test(sqls[1].sql), sqls[1].sql.slice(-90));
  ok('row shape kept', r.body.outstandingVendors[0].vendor_id === 1 && r.body.outstandingVendors[0].balance === 50 && r.body.pagination.total === 1, r.body);
  // bill reference: no 'mode' (MySQL), end day inclusive
  store.purchase = [{ id: 1, invoice_no: 1, fy: 4, vendor_id: 0, bill_reference: 'ab-1', total: 10, invoice_date: 100 }];
  store.bill_to = [{ purchase_id: 1, invoice_no: 1, fy: 4, vendor_name: 'Walk-in' }];
  const b = await call(billref, { billReference: 'ab' });
  ok('bill ref: "Other" vendor named from bill_to', b.body.purchases?.[0]?.vendor_name === 'Walk-in', b.body);
  expect(FAILED).toEqual([]);
}, 170000);
