/**
 * Phase 4 tax test (P4-12).
 *
 * The business is in Uttar Pradesh (business_details.gstin starts 09), so:
 *
 *   vendor in UP (state_code 9)     -> intra-state -> CGST + SGST, no IGST
 *   vendor in Punjab (state_code 3) -> inter-state -> IGST only
 *
 * It also sends deliberately WRONG tax figures in the payload. The server is
 * supposed to ignore them entirely and compute its own from qty, rate and GST%
 * - before P4-12 it stored whatever arrived.
 *
 *   node scripts/audit-p4-tax.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3000';
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
}

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text: text.slice(0, 250) };
}

const checks = [];
function expect(label, actual, wanted) {
  const ok = String(actual) === String(wanted);
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${actual}, expected ${wanted}`}`);
}

// qty 10 @ 100 = 1000 taxable, 18% GST = 180 tax.
// The payload lies: it claims 5 tax, split as 1/2/3.
const payload = (vendorId, notes) => ({
  vendor_id: vendorId,
  date: '2026-09-20',
  payment_status: 0,
  items: [{
    product_id: 602, qty: 10, rate: 100, total: 999999,
    gst_percentage: 18, cgst: 1, sgst: 2, igst: 3, tax: 5,
    part: 'TAX-TEST', car_model: '', model_id: null, company_id: null
  }],
  packing_forwarding_qty: 0, packing_forwarding_rate: 0, packing_forwarding_total: 0,
  total_cgst: 1, total_sgst: 2, total_igst: 3, total_tax: 5,
  notes
});

async function run(vendorId, label, wanted) {
  const r = await api('POST', '/api/purchases', payload(vendorId, label));
  if (r.status !== 201) throw new Error(`${label}: HTTP ${r.status} ${r.text}`);
  const p = await prisma.purchase.findUnique({
    where: { id: r.json.purchase.id },
    select: { id: true, total_cgst: true, total_sgst: true, total_igst: true, total_tax: true, items_total: true, total: true }
  });
  const item = await prisma.purchaseitems.findFirst({
    where: { invoice_no: (await prisma.purchase.findUnique({ where: { id: p.id }, select: { invoice_no: true } })).invoice_no },
    select: { cgst: true, sgst: true, igst: true, tax: true, subtotal: true }
  });
  console.log(`\n${label}`);
  console.log(`  stored header: cgst=${p.total_cgst} sgst=${p.total_sgst} igst=${p.total_igst} tax=${p.total_tax} items=${p.items_total} total=${p.total}`);
  console.log(`  stored line  : cgst=${item.cgst} sgst=${item.sgst} igst=${item.igst} tax=${item.tax} subtotal=${item.subtotal}`);
  expect(`${label}: total_tax is 180, not the 5 the payload claimed`, p.total_tax, 180);
  expect(`${label}: cgst ${wanted.cgst}`, p.total_cgst, wanted.cgst);
  expect(`${label}: sgst ${wanted.sgst}`, p.total_sgst, wanted.sgst);
  expect(`${label}: igst ${wanted.igst}`, p.total_igst, wanted.igst);
  expect(`${label}: items_total is 1000, not the 999999 line total claimed`, p.items_total, 1000);
  expect(`${label}: total = 1000 + 0 + 180`, p.total, 1180);
  return p.id;
}

(async () => {
  await login();
  console.log('\nPhase 4 tax test — server computes, payload is ignored\n' + '='.repeat(64));
  console.log('payload claims: total_tax 5, split 1/2/3, line total 999999');

  const a = await run(2, 'vendor 2, Uttar Pradesh (same state as business) -> CGST+SGST',
    { cgst: 90, sgst: 90, igst: 0 });
  const b = await run(3, 'vendor 3, Punjab (different state) -> IGST',
    { cgst: 0, sgst: 0, igst: 180 });

  for (const id of [a, b]) await api('DELETE', `/api/purchases/${id}`);
  console.log('\ntest purchases deleted');

  const failed = checks.filter(c => !c).length;
  console.log('\n' + '='.repeat(64));
  console.log(failed === 0 ? 'TAX TEST CLEAN\n' : `${failed} of ${checks.length} checks FAILED\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nTAX TEST ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
