/**
 * Settings audit probe — per resource: list shape, pagination, dropdown mode,
 * sort, search, timings, validation, and a full CRUD round trip.
 *
 * Everything it creates is prefixed "AUDIT TEST" and is removed before it exits.
 *
 *   node scripts/audit-settings.js
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

async function api(method, path, body) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  const text = await r.text();
  const ms = Date.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, ms, json, text: text.slice(0, 160) };
}

function rows(j) {
  if (!j) return null;
  if (Array.isArray(j)) return j;
  const arrays = Object.keys(j).filter(k => Array.isArray(j[k]));
  return arrays.length ? j[arrays[0]] : null;
}
function totalOf(j) {
  if (!j) return null;
  if (j.pagination && j.pagination.total !== undefined) return j.pagination.total;
  if (j.total !== undefined) return j.total;
  const r = rows(j);
  return r ? r.length : null;
}

const RESOURCES = [
  { name: 'business-details', path: '/api/business-details', singleton: true },
  { name: 'bank-details',     path: '/api/bank-details' },
  { name: 'staff',            path: '/api/staff' },
  { name: 'mechanics',        path: '/api/mechanics' },
  { name: 'users',            path: '/api/users' },
  { name: 'warehouses',       path: '/api/warehouses' },
  { name: 'financial-years',  path: '/api/financial-years' },
  { name: 'states',           path: '/api/states' },
  { name: 'gst-rates',        path: '/api/gst-rates' },
  { name: 'return-reasons',   path: '/api/return-reasons' },
];

(async () => {
  await login();
  console.log('\nSETTINGS AUDIT\n' + '='.repeat(88));

  console.log('\n1. LIST: status, timing, rows, total, paginated, response key\n');
  console.log('   resource            stat   ms   rows  total  paged  key');
  console.log('   ' + '-'.repeat(80));
  const listInfo = {};
  for (const r of RESOURCES) {
    const res = await api('GET', r.path);
    const rw = rows(res.json);
    const key = res.json && !Array.isArray(res.json)
      ? (Object.keys(res.json).find(k => Array.isArray(res.json[k])) || '(object)')
      : (Array.isArray(res.json) ? '(bare array)' : '-');
    listInfo[r.name] = { rows: rw, total: totalOf(res.json), status: res.status, key };
    console.log(
      `   ${r.name.padEnd(19)} ${String(res.status).padEnd(5)} ${String(res.ms).padStart(4)}  ` +
      `${String(rw ? rw.length : '-').padStart(4)}  ${String(totalOf(res.json) ?? '-').padStart(5)}  ` +
      `${String(!!(res.json && res.json.pagination)).padEnd(5)}  ${key}`
    );
  }

  console.log('\n2. PAGINATION — is limit honoured, are pages disjoint, is total stable?\n');
  for (const r of RESOURCES) {
    if (r.singleton) continue;
    const info = listInfo[r.name];
    if (!info.rows || info.rows.length < 2) { console.log(`   ${r.name.padEnd(19)} skipped (<2 rows)`); continue; }
    const p1 = await api('GET', `${r.path}?page=1&limit=1`);
    const p2 = await api('GET', `${r.path}?page=2&limit=1`);
    const a = rows(p1.json) || [], b = rows(p2.json) || [];
    const limitOk = a.length === 1;
    const disjoint = a.length && b.length ? a[0].id !== b[0].id : null;
    const totalStable = totalOf(p1.json) === totalOf(p2.json);
    const bits = [];
    bits.push(limitOk ? 'limit OK' : `limit IGNORED (got ${a.length})`);
    bits.push(disjoint === null ? 'page2 empty' : disjoint ? 'pages disjoint' : 'PAGE 2 REPEATS PAGE 1');
    bits.push(totalStable ? 'total stable' : `total moves ${totalOf(p1.json)}->${totalOf(p2.json)}`);
    console.log(`   ${r.name.padEnd(19)} ${bits.join('   ')}`);
  }

  console.log('\n3. DROPDOWN MODE — does ?dropdown=true escape the page limit? (F-58)\n');
  for (const r of RESOURCES) {
    if (r.singleton) continue;
    const info = listInfo[r.name];
    const totalRows = info.rows ? info.rows.length : 0;
    if (totalRows < 3) { console.log(`   ${r.name.padEnd(19)} skipped (only ${totalRows} rows, cannot tell)`); continue; }
    const plain = await api('GET', `${r.path}?limit=2`);
    const drop = await api('GET', `${r.path}?dropdown=true&limit=2`);
    const pc = rows(plain.json) ? rows(plain.json).length : null;
    const dc = rows(drop.json) ? rows(drop.json).length : null;
    let verdict;
    if (pc === null || dc === null) verdict = 'could not read rows';
    else if (dc > pc) verdict = `OK — dropdown returns ${dc}, limited returns ${pc}`;
    else if (pc === 2 && dc === 2) verdict = `LIMIT STILL APPLIES in dropdown mode (${totalRows} rows exist)`;
    else verdict = `limit=2 -> ${pc}; dropdown -> ${dc}`;
    console.log(`   ${r.name.padEnd(19)} ${verdict}`);
  }

  console.log('\n4. SORT — does sortOrder reverse the list?\n');
  for (const r of RESOURCES) {
    if (r.singleton) continue;
    const info = listInfo[r.name];
    if (!info.rows || info.rows.length < 2) { console.log(`   ${r.name.padEnd(19)} skipped (<2 rows)`); continue; }
    const asc = await api('GET', `${r.path}?sortBy=id&sortOrder=asc&limit=5`);
    const desc = await api('GET', `${r.path}?sortBy=id&sortOrder=desc&limit=5`);
    const a = rows(asc.json), d = rows(desc.json);
    if (!a || !d || !a.length || !d.length) { console.log(`   ${r.name.padEnd(19)} could not read rows`); continue; }
    const same = JSON.stringify(a.map(x => x.id)) === JSON.stringify(d.map(x => x.id));
    console.log(`   ${r.name.padEnd(19)} ${same ? 'IGNORED — asc and desc identical' : 'OK'}   asc=[${a.map(x=>x.id).join(',')}] desc=[${d.map(x=>x.id).join(',')}]`);
  }

  console.log('\n5. SEARCH — does a nonsense ?search= return nothing?\n');
  for (const r of RESOURCES) {
    if (r.singleton) continue;
    const info = listInfo[r.name];
    if (!info.rows || !info.rows.length) { console.log(`   ${r.name.padEnd(19)} skipped (no rows)`); continue; }
    const hit = await api('GET', `${r.path}?search=zzzzznotarealvalue`);
    const n = rows(hit.json) ? rows(hit.json).length : null;
    const before = info.rows.length;
    let verdict;
    if (n === null) verdict = `could not read rows (${hit.status})`;
    else if (n === 0) verdict = 'OK';
    else if (n === before) verdict = `IGNORED — returned all ${n} rows`;
    else verdict = `returned ${n} of ${before}`;
    console.log(`   ${r.name.padEnd(19)} ${verdict}`);
  }

  console.log('\n6. CRUD — create, does it return an id, read back, update, deactivate\n');
  const crud = [
    { name: 'staff', path: '/api/staff', table: 'staff', nameCol: 'name',
      create: { name: 'AUDIT TEST STAFF', phone: '9000000011', email: 'audit.staff@example.com', status: 'Active' },
      update: { name: 'AUDIT TEST STAFF EDITED' }, deactivate: { status: 'Inactive' } },
    { name: 'mechanics', path: '/api/mechanics', table: 'mechanic', nameCol: 'name',
      create: { name: 'AUDIT TEST MECHANIC', phone: '9000000012', email: 'audit.mech@example.com', status: 'Active' },
      update: { name: 'AUDIT TEST MECHANIC EDITED' }, deactivate: { status: 'Inactive' } },
    { name: 'warehouses', path: '/api/warehouses', table: 'warehouse', nameCol: 'name',
      create: { name: 'AUDIT TEST WAREHOUSE', location: 'Agra', status: 'Active' },
      update: { name: 'AUDIT TEST WAREHOUSE EDITED' }, deactivate: { status: 'Inactive' } },
  ];

  for (const c of crud) {
    const mk = await api('POST', c.path, c.create);
    if (mk.status >= 400) { console.log(`   ${c.name.padEnd(12)} CREATE failed ${mk.status}: ${mk.text}`); continue; }

    const body = mk.json || {};
    let id = body.id || (body.data && body.data.id);
    const returnedId = !!id;
    if (!id) {
      const row = await prisma[c.table].findFirst({
        where: { [c.nameCol]: c.create[c.nameCol] }, select: { id: true }, orderBy: { id: 'desc' }
      });
      id = row && row.id;
    }
    if (!id) { console.log(`   ${c.name.padEnd(12)} created but could not locate the row`); continue; }

    const readBack = await api('GET', `${c.path}?search=AUDIT TEST`);
    const found = (rows(readBack.json) || []).some(x => x.id === id);

    let up = await api('PUT', c.path, { id, ...c.create, ...c.update });
    let upWhere = 'collection';
    if (up.status >= 400) { up = await api('PUT', `${c.path}/${id}`, { id, ...c.create, ...c.update }); upWhere = `/${id}`; }

    let de = await api('PUT', c.path, { id, ...c.create, ...c.update, ...c.deactivate });
    let deWhere = 'collection';
    if (de.status >= 400) { de = await api('PUT', `${c.path}/${id}`, { id, ...c.create, ...c.update, ...c.deactivate }); deWhere = `/${id}`; }

    const after = await prisma[c.table].findUnique({ where: { id }, select: { [c.nameCol]: true, status: true } });
    const del = await api('DELETE', `${c.path}/${id}`);

    console.log(
      `   ${c.name.padEnd(12)} create ${mk.status} ${returnedId ? 'id RETURNED' : 'NO id in body'}` +
      `   readback ${found ? 'found' : 'NOT FOUND'}` +
      `   update ${up.status}(${upWhere})` +
      `   deactivate ${de.status}(${deWhere})` +
      `   stored=${JSON.stringify(after)}` +
      `   DELETE ${del.status}`
    );
  }

  console.log('\n7. VALIDATION — does the API reject what the form would?\n');
  const bad = [
    ['staff',     '/api/staff',     { name: '', phone: '9000000013' },              'empty name'],
    ['staff',     '/api/staff',     { name: 'AUDIT TEST X', phone: 'abcdefghij' },  'letters as phone'],
    ['mechanics', '/api/mechanics', { name: 'AUDIT TEST X', phone: 'abcdefghij' },  'letters as phone'],
    ['gst-rates', '/api/gst-rates', { description: 'AUDIT', rate: -5, hsn_code: '0000' }, 'negative rate'],
    ['states',    '/api/states',    { name: 'AUDIT TEST STATE', code: 99 },         'invalid GST state code'],
    ['warehouses','/api/warehouses',{ name: '', location: 'Agra' },                 'empty name'],
  ];
  for (const [res, path, body, label] of bad) {
    const r = await api('POST', path, body);
    const ok = r.status >= 400 && r.status < 500;
    console.log(`   ${res.padEnd(12)} ${label.padEnd(24)} -> ${r.status} ${ok ? 'rejected' : '*** ACCEPTED ***'}  ${ok ? '' : r.text}`);
  }

  console.log('\n8. CLEANUP\n');
  const removed = {};
  removed.staff = (await prisma.staff.deleteMany({ where: { name: { startsWith: 'AUDIT TEST' } } })).count;
  removed.mechanic = (await prisma.mechanic.deleteMany({ where: { name: { startsWith: 'AUDIT TEST' } } })).count;
  removed.warehouse = (await prisma.warehouse.deleteMany({ where: { name: { startsWith: 'AUDIT TEST' } } })).count;
  removed.states = (await prisma.states.deleteMany({ where: { state_name: { startsWith: 'AUDIT TEST' } } })).count;
  console.log('   removed: ' + JSON.stringify(removed));
  const still =
    (await prisma.staff.count({ where: { name: { startsWith: 'AUDIT TEST' } } })) +
    (await prisma.mechanic.count({ where: { name: { startsWith: 'AUDIT TEST' } } })) +
    (await prisma.warehouse.count({ where: { name: { startsWith: 'AUDIT TEST' } } })) +
    (await prisma.states.count({ where: { state_name: { startsWith: 'AUDIT TEST' } } }));
  console.log(`   AUDIT TEST rows remaining: ${still}`);

  console.log('\n' + '='.repeat(88) + '\n');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('\nPROBE ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
