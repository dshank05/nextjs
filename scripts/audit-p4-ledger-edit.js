/**
 * Repro: does editing a purchase amount corrupt vendor_ledger.balance?
 *
 * executeLedgerUpdates (transaction-handler.ts:372-378) reseeds
 * recalculateBalancesAfter from the id of the row it JUST updated - but that
 * row's own `balance` was not touched by the updateMany, because
 * LedgerUpdateOperation.data can only carry debit/credit/notes.
 *
 * Create A, create B, edit A's amount upward. Then every stored balance from
 * A onward should be wrong by the delta.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:3000';
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
    method, headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text: text.slice(0, 400) };
}
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

async function ledger() {
  return prisma.vendor_ledger.findMany({
    where: { vendor_id: VENDOR },
    orderBy: { id: 'asc' },
    select: { id: true, transaction_type: true, debit: true, credit: true, balance: true }
  });
}
function dump(rows, label) {
  console.log(`\n  ${label}`);
  console.log('    id      type        debit   credit   stored    recomputed');
  let run = 0; let bad = 0;
  for (const r of rows) {
    run = run + Number(r.debit) - Number(r.credit);
    const ok = Math.abs(Number(r.balance) - run) < 0.005;
    if (!ok) bad++;
    console.log(`    ${String(r.id).padEnd(7)} ${String(r.transaction_type).padEnd(11)} ${String(r.debit).padStart(6)} ${String(r.credit).padStart(8)} ${String(r.balance).padStart(8)}  ${String(run).padStart(10)}  ${ok ? '' : '  <-- MISMATCH'}`);
  }
  return bad;
}

(async () => {
  await login();
  console.log('\nRepro: purchase edit vs vendor_ledger.balance\n' + '='.repeat(66));

  const startRows = await prisma.vendor_ledger.count();
  if (startRows !== 0) console.log(`  note: ledger starts with ${startRows} rows`);

  const a = await api('POST', '/api/purchases', envelope([line(602, 5, 100)], 'repro A'));
  if (a.status !== 201) throw new Error(`create A: ${a.status} ${a.text}`);
  const idA = a.json.purchase.id;

  const b = await api('POST', '/api/purchases', envelope([line(601, 2, 50)], 'repro B'));
  if (b.status !== 201) throw new Error(`create B: ${b.status} ${b.text}`);
  const idB = b.json.purchase.id;

  console.log(`\n  created purchase A=${idA} (500) and B=${idB} (100)`);
  let bad = dump(await ledger(), 'BEFORE edit');
  console.log(`    -> ${bad} mismatched row(s)`);

  const e = await api('PUT', `/api/purchases/${idA}`, envelope([line(602, 9, 100)], 'repro A edited'));
  if (e.status !== 200) throw new Error(`edit A: ${e.status} ${e.text}`);
  console.log(`\n  edited purchase A: 5 x 100 = 500  ->  9 x 100 = 900`);

  bad = dump(await ledger(), 'AFTER edit');
  console.log(`    -> ${bad} mismatched row(s)`);

  console.log('\n  cleaning up...');
  await api('DELETE', `/api/purchases/${idA}`);
  await api('DELETE', `/api/purchases/${idB}`);
  const left = await prisma.vendor_ledger.count();
  console.log(`  ledger rows left: ${left} (started ${startRows})`);

  console.log('\n' + '='.repeat(66));
  console.log(bad > 0
    ? `CONFIRMED - ${bad} ledger row(s) hold a balance that does not match their own debits/credits\n`
    : 'NOT REPRODUCED - stored balances agree with the recomputation\n');
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('\nREPRO ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
