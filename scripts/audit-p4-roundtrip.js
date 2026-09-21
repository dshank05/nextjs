/**
 * Phase 4 round-trip: create -> edit -> delete, checking stock at each step.
 *
 * The edit deliberately does three things in one submit - changes a quantity,
 * removes a line and adds a line - because that combination is where the edit
 * arithmetic goes wrong if deltas are computed per-operation rather than
 * per-product.
 *
 * The delete is the strongest single check in the phase: stock and the vendor
 * balance must return EXACTLY to their starting values.
 *
 * The products used carry real opening stock, so every expectation is a DELTA
 * from wherever the test found them, never an absolute.
 *
 *   node scripts/audit-p4-roundtrip.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3000';
const PRODUCTS = [600, 601, 602];
const VENDOR = 2;
let cookie = '';

async function login() {
  const r1 = await fetch(`${BASE}/api/auth/csrf`);
  cookie = (r1.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; ');
  const { csrfToken } = await r1.json();

  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, username: 'admin', password: 'admin123', json: 'true' }),
    redirect: 'manual'
  });
  const extra = (r2.headers.get('set-cookie') || '')
    .split(',').map(c => c.split(';')[0]).filter(c => c.includes('session-token'));
  if (extra.length) cookie += '; ' + extra.join('; ');

  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json();
  if (!s.user) throw new Error('login failed');
}

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text: text.slice(0, 300) };
}

async function stockMap() {
  const rows = await prisma.product.findMany({
    where: { id: { in: PRODUCTS } },
    select: { id: true, stock: true },
    orderBy: { id: 'asc' }
  });
  const m = {};
  rows.forEach(r => { m[r.id] = r.stock || 0; });
  return m;
}
const show = (m) => PRODUCTS.map(id => `${id}:${m[id]}`).join('  ');
const plus = (base, deltas) => {
  const m = Object.assign({}, base);
  Object.keys(deltas).forEach(id => { m[id] = (m[id] || 0) + deltas[id]; });
  return m;
};

const line = (product_id, qty, rate) => ({
  product_id, qty, rate, total: qty * rate,
  gst_percentage: 0, cgst: 0, sgst: 0, igst: 0, tax: 0,
  part: `P-${product_id}`, car_model: '', model_id: null, company_id: null
});

const envelope = (items, notes) => ({
  vendor_id: VENDOR, date: '2026-09-20', payment_status: 0, items,
  packing_forwarding_qty: 0, packing_forwarding_rate: 0, packing_forwarding_total: 0,
  total_cgst: 0, total_sgst: 0, total_igst: 0, total_tax: 0, notes
});

const checks = [];
function expect(label, actual, wanted) {
  const ok = actual === wanted;
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got      ${actual}\n        expected ${wanted}`);
}

(async () => {
  await login();
  console.log('\nPhase 4 round-trip — create, edit, delete\n' + '='.repeat(62));

  const before = await stockMap();
  console.log(`\nstart   ${show(before)}   (real opening stock; all checks are deltas)`);

  const created = await api('POST', '/api/purchases',
    envelope([line(602, 5, 100), line(601, 2, 50)], 'P4 round-trip: create'));
  if (created.status !== 201) throw new Error(`create failed: HTTP ${created.status} ${created.text}`);
  const purchaseId = created.json.purchase.id;
  console.log(`\ncreate  purchase ${purchaseId}, invoice ${created.json.purchase.invoice_no}: 602 x5, 601 x2`);
  expect('602 +5, 601 +2, 600 unchanged',
    show(await stockMap()), show(plus(before, { 602: 5, 601: 2 })));

  const edited = await api('PUT', `/api/purchases/${purchaseId}`,
    envelope([line(602, 3, 100), line(600, 4, 25)], 'P4 round-trip: edit'));
  if (edited.status !== 200) throw new Error(`edit failed: HTTP ${edited.status} ${edited.text}`);
  console.log('\nedit    602 qty 5->3, line 601 removed, line 600 x4 added');
  expect('602 +3, 601 back to start, 600 +4',
    show(await stockMap()), show(plus(before, { 602: 3, 600: 4 })));

  const deleted = await api('DELETE', `/api/purchases/${purchaseId}`);
  if (deleted.status !== 200) throw new Error(`delete failed: HTTP ${deleted.status} ${deleted.text}`);
  console.log('\ndelete  purchase removed');
  expect('all stock back to start', show(await stockMap()), show(before));
  expect('no purchase_items left behind', String(await prisma.purchaseitems.count()), '0');
  expect('no vendor_ledger rows left behind', String(await prisma.vendor_ledger.count()), '0');
  expect('no bill_to rows left behind', String(await prisma.bill_to.count()), '0');
  expect('no purchase rows left behind', String(await prisma.purchase.count()), '0');

  const failed = checks.filter(c => !c).length;
  console.log('\n' + '='.repeat(62));
  console.log(failed === 0 ? 'ROUND-TRIP CLEAN\n' : `${failed} of ${checks.length} checks FAILED\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nROUND-TRIP ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
