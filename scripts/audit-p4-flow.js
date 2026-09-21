/**
 * Phase 4 flow verification (P4-24 and P4-25).
 *
 * Creates a PAID purchase, then checks:
 *   - every table a purchase should write, and that nothing else moved
 *   - every report that should reflect it does
 *   - that a customer-side report does NOT move (a purchase touching one means
 *     the ledger reference_type is wrong - the shape of lead L-8)
 *   - that deleting it reverses all of the above exactly
 *
 * Also exercises the "Other" vendor (vendor_id 0), lead L-10.
 *
 *   node scripts/audit-p4-flow.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3000';
const PRODUCT = 602;
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
}

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text: text.slice(0, 200) };
}

const checks = [];
function expect(label, actual, wanted) {
  const ok = String(actual) === String(wanted);
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   (got ${actual}, expected ${wanted})`}`);
}

async function counts() {
  return {
    purchase: await prisma.purchase.count(),
    items: await prisma.purchaseitems.count(),
    bill_to: await prisma.bill_to.count(),
    ledger: await prisma.vendor_ledger.count(),
    payments: await prisma.vendor_payments.count(),
    allocations: await prisma.payment_allocations.count(),
    balance_logs: await prisma.vendor_balance_logs.count(),
    customer_ledger: await prisma.customer_ledger.count(),
    invoices: await prisma.invoice.count()
  };
}

// Each report is read with the parameters it actually requires and the key it
// actually returns. Guessing at a generic response shape made every one of them
// read zero, which looked like four broken reports and was four wrong
// assertions - the reports were fine.
const REPORTS = [
  ['bill-reference-purchase', '/api/reports/bill-reference-purchase', 'purchases'],
  ['vendor-ledger-accounting', `/api/reports/vendor-ledger-accounting?vendor_id=${VENDOR}`, 'entries'],
  ['vendor-outstanding', '/api/reports/vendor-outstanding', 'outstandingVendors'],
  ['vendor-balance-logs', '/api/reports/vendor-balance-logs', 'data']
];

async function reportSizes() {
  const out = {};
  for (const [name, path, key] of REPORTS) {
    const r = await api('GET', path);
    const arr = r.json ? r.json[key] : null;
    out[name] = { status: r.status, n: Array.isArray(arr) ? arr.length : -1 };
  }
  return out;
}

(async () => {
  await login();
  console.log('\nPhase 4 flow verification — tables and reports\n' + '='.repeat(66));

  const before = await counts();
  const stockBefore = (await prisma.product.findUnique({ where: { id: PRODUCT }, select: { stock: true } })).stock || 0;
  const vendorBefore = await prisma.vendor_details.findUnique({
    where: { id: VENDOR }, select: { total_paid: true, total_allocated: true }
  });
  const reportsBefore = await reportSizes();
  console.log('\nreports before:', Object.entries(reportsBefore).map(([k, v]) => `${k}=${v.n}(${v.status})`).join('  '));

  // ---- CREATE a PAID purchase: 4 x 250 = 1000 taxable, 18% = 180 tax ----
  const created = await api('POST', '/api/purchases', {
    vendor_id: VENDOR, date: '2026-09-20', payment_status: 1, payment_mode: 1,
    items: [{
      product_id: PRODUCT, qty: 4, rate: 250, total: 1000,
      gst_percentage: 18, cgst: 0, sgst: 0, igst: 0, tax: 0,
      part: 'FLOW-TEST', car_model: '', model_id: null, company_id: null
    }],
    packing_forwarding_qty: 0, packing_forwarding_rate: 0, packing_forwarding_total: 0,
    total_cgst: 0, total_sgst: 0, total_igst: 0, total_tax: 0,
    bill_reference: 'FLOW-REF-1', notes: 'P4 flow test',
    transport_name: 'Test Transport', vehicle_number: 'UP80AB1234',
    notes_mentioned: 'flow', transport_cost: 0
  });
  if (created.status !== 201) throw new Error(`create failed: HTTP ${created.status} ${created.text}`);
  const pid = created.json.purchase.id;
  console.log(`\ncreated paid purchase ${pid}, total ${created.json.purchase.total}`);

  const after = await counts();
  console.log('\nTables written by a paid purchase:');
  expect('purchase +1', after.purchase - before.purchase, 1);
  expect('purchase_items +1', after.items - before.items, 1);
  expect('bill_to +1', after.bill_to - before.bill_to, 1);
  expect('vendor_ledger +2 (PURCHASE and PAYMENT)', after.ledger - before.ledger, 2);
  expect('vendor_payments +1', after.payments - before.payments, 1);
  expect('payment_allocations +1', after.allocations - before.allocations, 1);
  expect('vendor_balance_logs increased', after.balance_logs > before.balance_logs, true);

  console.log('\nTables that must NOT move:');
  expect('customer_ledger unchanged', after.customer_ledger - before.customer_ledger, 0);
  expect('invoice (sales) unchanged', after.invoices - before.invoices, 0);

  console.log('\nProduct and vendor:');
  const stockAfter = (await prisma.product.findUnique({ where: { id: PRODUCT }, select: { stock: true } })).stock || 0;
  expect('product stock +4 (purchase raises stock)', stockAfter - stockBefore, 4);
  const vendorAfter = await prisma.vendor_details.findUnique({
    where: { id: VENDOR }, select: { total_paid: true, total_allocated: true }
  });
  expect('vendor total_allocated rose', Number(vendorAfter.total_allocated) > Number(vendorBefore.total_allocated), true);

  console.log('\nReports reflect it:');
  const reportsAfter = await reportSizes();
  expect('bill-reference-purchase grew',
    reportsAfter['bill-reference-purchase'].n > reportsBefore['bill-reference-purchase'].n, true);
  expect('vendor-ledger-accounting grew',
    reportsAfter['vendor-ledger-accounting'].n > reportsBefore['vendor-ledger-accounting'].n, true);
  // KNOWN ISSUE L-25, reported not asserted, because it is a REPORT defect
  // and belongs to Phase 7 rather than to Purchase.
  //
  // vendor-outstanding queries individual vendor_ledger ROWS for balance > 0,
  // not each vendor's latest balance. A fully paid purchase leaves its PURCHASE
  // row at the full amount with a later PAYMENT row bringing the vendor to zero,
  // so the paid purchase still reads as outstanding. F-02 compounds it: that
  // stored balance column is insertion-ordered and unreliable once anything is
  // backdated.
  console.log(`  NOTE  vendor-outstanding went ${reportsBefore['vendor-outstanding'].n} -> ${reportsAfter['vendor-outstanding'].n} for a PAID purchase (L-25, Phase 7)`);
  expect('vendor-balance-logs grew',
    reportsAfter['vendor-balance-logs'].n > reportsBefore['vendor-balance-logs'].n, true);

  // ---- DELETE and confirm everything reverses ----
  const del = await api('DELETE', `/api/purchases/${pid}`);
  if (del.status !== 200) throw new Error(`delete failed: HTTP ${del.status} ${del.text}`);
  console.log('\nAfter delete, everything reverses:');
  const post = await counts();
  for (const k of Object.keys(before)) {
    if (k === 'balance_logs') {
      // vendor_balance_logs is an APPEND-ONLY audit trail. Deleting a purchase
      // writes a `purchase_delete` row recording the reversal rather than
      // erasing the history of the balance having moved - confirmed by reading
      // one back: source_type 'purchase_delete', change_amount -1180. Expecting
      // it to return to its starting count was the assertion being wrong.
      expect('balance_logs grew again (append-only audit trail)', post[k] > after[k], true);
    } else {
      expect(`${k} back to ${before[k]}`, post[k], before[k]);
    }
  }
  const stockEnd = (await prisma.product.findUnique({ where: { id: PRODUCT }, select: { stock: true } })).stock || 0;
  expect('product stock back to start', stockEnd, stockBefore);
  const vendorEnd = await prisma.vendor_details.findUnique({
    where: { id: VENDOR }, select: { total_paid: true, total_allocated: true }
  });
  expect('vendor total_allocated back to start',
    Number(vendorEnd.total_allocated), Number(vendorBefore.total_allocated));
  // The check that was missing. Only total_allocated was asserted, so a delete
  // that reversed the allocation but left total_paid standing looked clean -
  // it was L-26, a phantom advance the vendor never paid.
  expect('vendor total_paid back to start',
    Number(vendorEnd.total_paid), Number(vendorBefore.total_paid));

  const reportsEnd = await reportSizes();
  console.log('\nReports forget it:');
  expect('bill-reference-purchase back to start',
    reportsEnd['bill-reference-purchase'].n, reportsBefore['bill-reference-purchase'].n);
  expect('vendor-ledger-accounting back to start',
    reportsEnd['vendor-ledger-accounting'].n, reportsBefore['vendor-ledger-accounting'].n);
  console.log(`  NOTE  vendor-outstanding ended at ${reportsEnd['vendor-outstanding'].n} (L-25)`);
  expect('vendor-balance-logs kept its history (append-only)',
    reportsEnd['vendor-balance-logs'].n > reportsBefore['vendor-balance-logs'].n, true);

  // ---- "Other" vendor, id 0 (L-10 / P4-19) ----
  console.log('\n"Other" vendor (vendor_id 0):');
  const other = await api('POST', '/api/purchases', {
    vendor_id: 0, contact_number: '9000000009', vendor_name: 'Walk-in Supplier',
    address: 'Market', city: 'Agra', state: 'Uttar Pradesh', state_code: 9,
    date: '2026-09-20', payment_status: 0,
    items: [{
      product_id: PRODUCT, qty: 1, rate: 100, total: 100,
      gst_percentage: 0, cgst: 0, sgst: 0, igst: 0, tax: 0,
      part: 'OTHER-VENDOR', car_model: '', model_id: null, company_id: null
    }],
    packing_forwarding_qty: 0, packing_forwarding_rate: 0, packing_forwarding_total: 0,
    total_cgst: 0, total_sgst: 0, total_igst: 0, total_tax: 0,
    notes: 'P4-19 Other vendor test'
  });
  expect('purchase from "Other" vendor is accepted', other.status, 201);
  if (other.status === 201) {
    await api('DELETE', `/api/purchases/${other.json.purchase.id}`);
    expect('and reverses cleanly', (await counts()).purchase, before.purchase);
  } else {
    console.log('        ' + other.text);
  }

  const failed = checks.filter(c => !c).length;
  console.log('\n' + '='.repeat(66));
  console.log(failed === 0 ? 'FLOW VERIFICATION CLEAN\n' : `${failed} of ${checks.length} checks FAILED\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nFLOW ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
