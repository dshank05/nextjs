/**
 * P4-15 / purchase second pass - live verification.
 *
 * Drives the real API on the dev server and checks the database directly, for
 * the fixes in docs/PURCHASE_PASS2_AUDIT.md (Steps 1-2, Blocks A-D). Everything
 * it creates is deleted again; stock is checked back at its starting value.
 *
 *   1. npm run dev            (in one terminal, against the TEST database)
 *   2. node scripts/audit-p4-15.js
 *
 * Exit code 0 = all checks passed.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = process.env.BASE || 'http://localhost:3000';
const PRODUCT = Number(process.env.PRODUCT || 602);
const VENDOR = Number(process.env.VENDOR || 2);
const TAG = `P415-${Date.now().toString(36)}`;
let cookie = '';

async function login() {
  const r1 = await fetch(`${BASE}/api/auth/csrf`);
  cookie = (r1.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; ');
  const { csrfToken } = await r1.json();
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, username: process.env.APP_USER || 'admin', password: process.env.APP_PASS || 'admin123', json: 'true' }),
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
  return { status: r.status, json, text: text.slice(0, 300) };
}

const checks = [];
function expect(label, actual, wanted) {
  const ok = typeof wanted === 'function' ? !!wanted(actual) : String(actual) === String(wanted);
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   (got ${JSON.stringify(actual)}${typeof wanted === 'function' ? '' : `, expected ${wanted}`})`}`);
  return ok;
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const stockOf = async (id) => (await prisma.product.findUnique({ where: { id }, select: { stock: true } })).stock;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const line = (o) => ({ product_id: PRODUCT, model_id: null, company_id: null, car_model: '', part: TAG, ...o });

(async () => {
  await login();
  const who = await api('GET', '/api/purchases?limit=1');
  if (who.status !== 200) throw new Error(`not logged in / server not up: HTTP ${who.status} ${who.text}`);
  const created = [];
  const stock0 = await stockOf(PRODUCT);
  console.log(`product ${PRODUCT} stock at start: ${stock0}; tag ${TAG}\n`);

  try {
    // ---------------- create: two lines of the same product, whole-unit qty ----------------
    console.log('Create');
    const c = await api('POST', '/api/purchases', {
      vendor_id: VENDOR, date: today(), payment_status: 0, payment_mode: 0,
      bill_reference: TAG, notes: 'keep-notes', descriptions: 'keep-desc', transport_name: 'keep-transport', transport_cost: 30,
      packing_forwarding_qty: 0, packing_forwarding_rate: 0,
      items: [line({ qty: 2, rate: 100, gst_percentage: 18 }), line({ qty: 1, rate: 90, gst_percentage: 0 })]
    });
    if (!expect('POST /api/purchases -> 201', c.status, 201)) { console.log('    ' + c.text); throw new Error('create failed'); }
    const pid = c.json.purchase.id; created.push(pid);
    const p = await prisma.purchase.findUnique({ where: { id: pid } });
    expect('items_total = 2x100 + 1x90', p.items_total, 290);
    expect('total_tax = 18% of 200', near(p.total_tax, 36), true);
    expect('stock +3', await stockOf(PRODUCT), stock0 + 3);
    const rejected = await api('POST', '/api/purchases', { vendor_id: VENDOR, date: today(), payment_status: 0, items: [line({ qty: '12abc', rate: 1 })] });
    expect('qty "12abc" refused (PU-34)', rejected.status, 400);

    // ---------------- read ----------------
    console.log('\nGET');
    const g = await api('GET', `/api/purchases/${pid}`);
    expect('GET 200', g.status, 200);
    const items = g.json?.items || [];
    expect('two lines, each with line_id', items.length === 2 && items.every(i => i.line_id), true);
    const [l1, l2] = items;

    // ---------------- edit by line id (PU-14..17) ----------------
    console.log('\nEdit');
    const e = await api('PUT', `/api/purchases/${pid}`, {
      vendor_id: VENDOR, date: '2026-01-15',
      items: [
        { line_id: l1.line_id, product_id: PRODUCT, qty: 2, rate: 100, gst_percentage: 18 },
        { line_id: l2.line_id, product_id: PRODUCT, qty: 4, rate: 90, gst_percentage: 12, part: `${TAG}-B`, car_model: 'EDITED' }
      ]
    });
    expect('PUT 200 with two lines of one product (was refused, L-24)', e.status, 200) || console.log('    ' + e.text);
    const rows = await prisma.purchaseitems.findMany({ where: { invoice_no: p.invoice_no, fy: p.fy }, orderBy: { id: 'asc' } });
    const r2 = rows.find(r => r.id === l2.line_id);
    expect('second line qty 4', r2?.qty, 4);
    expect('GST-only change saved on the line (PU-14)', r2?.gst_percentage, 12);
    expect('line tax = 12% of 360', near(r2?.tax, 43.2), true);
    expect('part / car model saved (PU-15)', `${r2?.part}|${r2?.car_model}`, `${TAG}-B|EDITED`);
    const p2 = await prisma.purchase.findUnique({ where: { id: pid } });
    expect('every line carries the new bill date (PU-16)', rows.every(r => r.invoice_date === p2.invoice_date), true);
    expect('header tax = sum of line tax', near(p2.total_tax, rows.reduce((s, r) => s + (r.tax || 0), 0)), true);
    expect('stock +3 more (qty 1 -> 4)', await stockOf(PRODUCT), stock0 + 6);
    expect('untouched fields kept: notes / descriptions / transport / freight (PU-19)',
      `${p2.notes}|${p2.descriptions}|${p2.transport_name}|${p2.freight}`, 'keep-notes|keep-desc|keep-transport|30');

    const partial = await api('PUT', `/api/purchases/${pid}`, { payment_status: 2, notes: 'resent-2' });
    expect('a resent Partial (2) is accepted, not a 400 (PU-35)', partial.status, 200);
    expect('...and the status is left alone', (await prisma.purchase.findUnique({ where: { id: pid } })).payment_status, 0);
    const foreign = await api('PUT', `/api/purchases/${pid}`, { items: [{ line_id: 999999999, product_id: PRODUCT, qty: 1, rate: 1 }] });
    expect('a line from another bill is refused', foreign.status, 400);

    // ---------------- list (PU-22..25) ----------------
    console.log('\nList');
    const list = await api('GET', `/api/purchases?billReference=${TAG}&itemCount=2&startDate=2026-01-15&endDate=2026-01-15&sortBy=vendor_name&sortOrder=desc`);
    expect('list 200', list.status, 200);
    expect('bill reference + item count + one-day range find it', (list.json?.data || []).map(r => r.id).join(), String(pid));
    const none = await api('GET', `/api/purchases?billReference=${TAG}&itemCount=3`);
    expect('item count 3 finds nothing', (none.json?.data || []).length, 0);
    const legacy = await api('GET', `/api/purchases?vendor=${VENDOR}&limit=1000&sortOrder=asc`);
    expect('vendor-payment screen call still answers with `purchases`', Array.isArray(legacy.json?.purchases), true);

    // ---------------- reports (PU-26..29) ----------------
    console.log('\nReports');
    const page1 = await api('GET', `/api/reports/vendor-ledger-accounting?vendor_id=${VENDOR}&page=1&limit=1`);
    const page2 = await api('GET', `/api/reports/vendor-ledger-accounting?vendor_id=${VENDOR}&page=2&limit=1`);
    expect('ledger pages 200', `${page1.status}|${page2.status}`, '200|200');
    if ((page1.json?.pagination?.total || 0) >= 2) {
      const raw = await prisma.vendor_ledger.findMany({ where: { vendor_id: VENDOR }, orderBy: [{ transaction_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }], take: 1 });
      expect('page 2 opening = net of page 1 (PU-26)', near(page2.json.openingBalance, Number(raw[0].debit) - Number(raw[0].credit)), true);
    }
    const out = await api('GET', '/api/reports/vendor-outstanding?limit=500');
    expect('outstanding 200', out.status, 200);
    const ids = (out.json?.outstandingVendors || []).map(v => v.vendor_id);
    expect('one row per vendor (PU-27)', ids.length === new Set(ids).size, true);
    const br = await api('GET', `/api/reports/bill-reference-purchase?billReference=${TAG.toLowerCase()}`);
    expect('bill-reference search works on MySQL (PU-28)', br.status, 200);
    expect('...case-insensitively, and finds the bill', (br.json?.purchases || []).some(r => r.id === pid), true);
    const logs = await api('GET', `/api/reports/vendor-balance-logs?vendor_id=${VENDOR}&dateFrom=${today()}&dateTo=${today()}`);
    expect('balance logs with a one-day range 200 (PU-29)', logs.status, 200);

    // ---------------- "Other" vendor, bill's own state (PU-18) ----------------
    console.log('\n"Other" vendor');
    const o = await api('POST', '/api/purchases', {
      vendor_id: 0, vendor_name: `${TAG} supplier`, contact_number: '9000000009', state: 'Maharashtra', state_code: 27,
      date: today(), payment_status: 0, items: [line({ qty: 1, rate: 100, gst_percentage: 18 })]
    });
    if (expect('POST with vendor 0 -> 201', o.status, 201)) {
      created.push(o.json.purchase.id);
      const op = await prisma.purchase.findUnique({ where: { id: o.json.purchase.id } });
      const biz = await prisma.business_details.findFirst({ select: { gstin: true } });
      const bizState = parseInt(String(biz?.gstin || '').slice(0, 2), 10);
      expect(`tax split from the bill's state 27 vs business ${bizState} (PU-18)`,
        bizState === 27 ? near(op.total_cgst, 9) : near(op.total_igst, 18), true);
    } else console.log('    ' + o.text);

    // ---------------- delete (PU-01..03) ----------------
    console.log('\nDelete');
    const sameNumberOtherYears = await prisma.purchaseitems.count({ where: { invoice_no: p.invoice_no, NOT: { fy: p.fy } } });
    for (const id of created.splice(0)) {
      const d = await api('DELETE', `/api/purchases/${id}`);
      expect(`DELETE ${id} -> 200`, d.status, 200) || console.log('    ' + d.text);
    }
    expect('stock back where it started', await stockOf(PRODUCT), stock0);
    expect('lines of the same invoice number in other years untouched (PU-01)',
      await prisma.purchaseitems.count({ where: { invoice_no: p.invoice_no, NOT: { fy: p.fy } } }), sameNumberOtherYears);
    expect('no lines left for the deleted bill', await prisma.purchaseitems.count({ where: { invoice_no: p.invoice_no, fy: p.fy } }), 0);
  } finally {
    // Never leave test bills behind, whatever failed.
    for (const id of created) await api('DELETE', `/api/purchases/${id}`);
  }

  const failed = checks.filter(c => !c).length;
  console.log('\n' + '='.repeat(66));
  console.log(failed === 0 ? `ALL ${checks.length} CHECKS PASSED\n` : `${failed} of ${checks.length} checks FAILED\n`);
  console.log('Then run: node scripts/audit-assert.js   (ledger / stock / allocation reconciliation)');
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
