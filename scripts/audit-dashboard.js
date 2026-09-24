/**
 * Dashboard audit probe — timings, payloads, auth, and the low-stock cross-check.
 *
 * Read-only: creates nothing, deletes nothing.
 *
 *   node scripts/audit-dashboard.js
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
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json();
  if (!s.user) throw new Error('login failed');
}

async function timed(path, opts = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, { headers: opts.noAuth ? {} : { cookie }, redirect: 'manual' });
  const text = await r.text();
  const ms = Date.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, ms, json, text: text.slice(0, 200), location: r.headers.get('location') };
}

// Warm the route first: in dev the first hit compiles the page, which is
// hundreds of ms of webpack, not query time. Measuring that would be measuring
// Next.js, not this app.
async function measure(path, runs = 3) {
  await timed(path);
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) { last = await timed(path); times.push(last.ms); }
  times.sort((a, b) => a - b);
  return { ...last, median: times[Math.floor(times.length / 2)], times };
}

(async () => {
  await login();
  console.log('\nDASHBOARD AUDIT\n' + '='.repeat(72));

  console.log('\n1. API timings (warmed, median of 3)\n');
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const endpoints = [
    ['/api/dashboard/stats', 'stats'],
    [`/api/dashboard/daily-stats?date=${d}`, 'daily-stats'],
    ['/api/dashboard/trends', 'trends'],
  ];
  const results = {};
  for (const [path, name] of endpoints) {
    const r = await measure(path);
    results[name] = r;
    console.log(`   ${name.padEnd(13)} ${String(r.status).padEnd(4)} ${String(r.median + 'ms').padStart(7)}   (${r.times.join(', ')}ms)`);
  }

  console.log('\n2. Payloads\n');
  console.log('   stats:       ' + JSON.stringify(results['stats'].json));
  console.log('   daily-stats: ' + JSON.stringify(results['daily-stats'].json));
  const tr = results['trends'].json;
  console.log('   trends:      ' + (Array.isArray(tr) ? `${tr.length} days, ` + JSON.stringify(tr[0]) : JSON.stringify(tr)));

  console.log('\n3. Is the trends payload used by the page?\n');
  console.log('   pages/index.tsx fetches /api/dashboard/trends into state and renders');
  console.log('   nothing from it. Cost of that call, per dashboard load:');
  console.log(`      ${results['trends'].median}ms and ${Array.isArray(tr) ? tr.length * 3 : '?'} queries (5 days x sales + purchase + raw fallback)`);

  console.log('\n4. "Low stock" — three views, one question\n');
  const dashLow = results['stats'].json ? results['stats'].json.lowStockProducts : null;
  const minStock = await timed('/api/reports/minimum-stock?page=1&limit=1');
  const lowList = await timed('/api/products?stockFilter=low_stock&page=1&limit=1');

  const rawRule = await prisma.$queryRaw`SELECT COUNT(*) as count FROM product WHERE stock < min_stock AND min_stock IS NOT NULL`;
  const negative = await prisma.$queryRaw`SELECT COUNT(*) as count FROM product WHERE stock < 0`;

  console.log(`   dashboard /api/dashboard/stats .lowStockProducts : ${dashLow}`);
  console.log(`   report    /api/reports/minimum-stock  total      : ${minStock.json ? (minStock.json.total ?? minStock.json.pagination?.total ?? '?') : minStock.status}`);
  console.log(`   list      /api/products?stockFilter=low_stock    : ${lowList.json ? (lowList.json.pagination ? lowList.json.pagination.total : '?') : lowList.status}`);
  console.log(`   dashboard's own SQL rule re-run directly         : ${Number(rawRule[0].count)}`);
  console.log(`   products with stock < 0 (i.e. F-73 only)         : ${Number(negative[0].count)}`);

  console.log('\n5. Auth — are the dashboard APIs reachable with no session?\n');
  for (const [path, name] of endpoints) {
    const r = await timed(path, { noAuth: true });
    const verdict = r.status === 200 ? 'REACHABLE — no session needed' :
                    (r.status === 307 || r.status === 302) ? `redirected -> ${r.location}` :
                    `blocked (${r.status})`;
    console.log(`   ${name.padEnd(13)} ${verdict}`);
  }

  console.log('\n6. Error-body leakage\n');
  const bad = await timed('/api/dashboard/daily-stats?date=not-a-date');
  console.log(`   daily-stats?date=not-a-date -> ${bad.status}: ${bad.text}`);

  console.log('\n7. Dashboard page HTML\n');
  const page = await measure('/');
  console.log(`   GET /  ${page.status}  median ${page.median}ms  (${page.times.join(', ')}ms)  ${page.text.length} bytes sampled`);

  console.log('\n' + '='.repeat(72) + '\n');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('\nPROBE ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
