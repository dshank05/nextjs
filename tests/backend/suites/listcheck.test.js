// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { parsePurchaseListQuery, listPurchases } from '../../../lib/purchase-query';
import { billListParams } from '../../../hooks/useBills';
import { prisma } from '../support/dbstub.js';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const sqls = [];
globalThis.__raw = async (sql, ...params) => { sqls.push({ sql, params }); return sql.includes('COUNT(*) AS count') && !sql.includes('t.*') ? [{ count: 3n }] : [{ id: 1, invoice_no: 5, total: 100, total_paid: '40', item_count: 2n, total_taxable_value: 80, total_tax: 20, payment_status: 2, invoice_date: 1, fy: 4 }]; };
test('bill list params', async () => {
  // client -> server names agree (PU-22)
  const p = billListParams('purchase', { page: 2, limit: 50, notes: '', partyFilter: '7', billReference: 'AB', itemCount: '3', totalTax: '18', packingForwardingTotal: '10', statusFilter: '2', dateFrom: '2026-09-01', dateTo: '2026-09-30', total: '500', uidFilter: '12', paymentMode: '0', sortBy: 'vendor_name', sortOrder: 'desc' });
  const req = { query: Object.fromEntries(p.entries()) };
  const q = parsePurchaseListQuery(req);
  ok('all filters parsed', q.billReference === 'AB' && q.itemCount === 3 && q.totalTax === 18 && q.packingTotal === 10 && q.status === 2 && q.vendorId === 7 && q.invoiceNo === 12 && q.paymentMode === 0 && q.amountMin === 500 && q.amountMax === 500, q);
  ok('end date is end of day', q.endDate - q.startDate === 29 * 86400 + 86399, [q.startDate, q.endDate]);
  ok('sort by vendor name allowed', q.sortBy === 'vendor_name' && q.sortOrder === 'desc');
  ok('status all not sent', !billListParams("purchase", { page: 1, limit: 50, statusFilter: "all" }).has('status'));
  const r = await listPurchases(q);
  for (const { sql, params } of sqls) ok('placeholders match params', (sql.match(/\?/g) || []).length === params.length, [sql.match(/\?/g)?.length, params.length]);
  ok('sorted in SQL by vendor', sqls[1].sql.includes('ORDER BY t.vendor_name desc'), sqls[1].sql.slice(-80));
  ok('item count filtered before paging', sqls[1].sql.indexOf('t.item_count = ?') < sqls[1].sql.indexOf('LIMIT'));
  ok('row shape', r.purchases[0].item_count === 2 && r.purchases[0].remaining_amount === 60 && r.pagination.total === 3 && r.pagination.page === 2, r);
  const bad = parsePurchaseListQuery({ query: { sortBy: 'total; DROP', limit: '99999' } });
  ok('unknown sort falls back, limit capped', bad.sortBy === 'invoice_date' && bad.limit === 1000, bad);
  expect(FAILED).toEqual([]);
}, 170000);
