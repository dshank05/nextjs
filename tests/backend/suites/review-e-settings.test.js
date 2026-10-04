// Review E - settings masters: CRUD round trips from the payloads the settings screens send
// (fixtures/settings/captured.json, captured by the page harness), the owner rules D1-D4,
// and where each master shows up elsewhere. After every scenario: A1-A14 and the 16 reports.
import { store, call, H as FH, ex, create, K } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats } from '../support/flowlib.js';
import { seedStock } from '../support/scenlib.js';
const FX = require('../fixtures/settings/captured.json');
const SHOW = !!process.env.REVIEW_E_SHOW;
const sc = (id, title, fn, { known = [], open = null } = {}) =>
  ((open && !SHOW) ? test.failing : test)(`${id} ${title}${open ? `  [OPEN ${open}]` : ''}`, async () => {
    reset(); seedStock(); seed(); stats.failures = [];
    await fn();
    await checkAll(id, known);
    await checkReports(id);
    expect(stats.failures).toEqual([]);
  });

// ---- the routes, addressed the way the screens address them
const R = {
  'mechanics': require('../../../pages/api/mechanics/index').default,
  'mechanics/:id': require('../../../pages/api/mechanics/[id]').default,
  'mechanics/:id/status': require('../../../pages/api/mechanics/[id]/status').default,
  'staff': require('../../../pages/api/staff/index').default,
  'staff/:id': require('../../../pages/api/staff/[id]').default,
  'staff/:id/status': require('../../../pages/api/staff/[id]/status').default,
  'gst-rates': require('../../../pages/api/gst-rates/index').default,
  'gst-rates/:id/status': require('../../../pages/api/gst-rates/[id]/status').default,
  'states': require('../../../pages/api/states/index').default,
  'states/:id': require('../../../pages/api/states/[id]').default,
  'products/categories': require('../../../pages/api/products/categories/index').default,
  'products/categories/:id': require('../../../pages/api/products/categories/[id]').default,
  'products/subcategories': require('../../../pages/api/products/subcategories/index').default,
  'products/subcategories/:id': require('../../../pages/api/products/subcategories/[id]').default,
  'warehouses': require('../../../pages/api/warehouses/index').default,
  'warehouses/:id/status': require('../../../pages/api/warehouses/[warehouseId]/status').default,
  'warehouses/:id/racks': require('../../../pages/api/warehouses/[warehouseId]/racks').default,
  'racks': require('../../../pages/api/racks/index').default,
  'bank-details': require('../../../pages/api/bank-details/index').default,
  'business-details': require('../../../pages/api/business-details/index').default,
  'users': require('../../../pages/api/users/index').default,
  'users/:id/status': require('../../../pages/api/users/[id]/status').default,
  'financial-years': require('../../../pages/api/financial-years/index').default,
  'financial-years/:id/current': require('../../../pages/api/financial-years/[id]/current').default,
  'products/:id/status': require('../../../pages/api/products/[id]/status').default,
  'reports/mechanic-sales': require('../../../pages/api/reports/mechanic-sales').default,
  'reports/staff-sales': require('../../../pages/api/reports/staff-sales').default,
  'dashboard': require('../../../pages/api/dashboard/index').default,
  'reports/minimum-stock': require('../../../pages/api/reports/minimum-stock').default
};
async function api(method, url, body) {
  const u = new URL(url, 'http://x');
  const query = Object.fromEntries(u.searchParams.entries());
  let id;
  const key = u.pathname.replace(/^\/api\//, '').split('/').map(p => (/^\d+$/.test(p) ? (id = p, ':id') : p)).join('/');
  if (id) { query.id = id; if (key.startsWith('warehouses/:id/')) query.warehouseId = id; }
  if (!R[key]) throw new Error('no route ' + key);
  return call(R[key], method, query, body ?? undefined);
}
const replay = (f, patch = {}) => api(f.method, f.path + (f.search || ''), f.body == null ? undefined : { ...f.body, ...patch });
const clone = (o) => JSON.parse(JSON.stringify(o));
const changed = (a, b) => Object.keys({ ...a, ...b }).filter(k => !['updated_at', 'created_at'].includes(k) && JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null));
const row = (t, id) => store[t].find(r => r.id === id);

function seed() {
  Object.assign(store, {
    mechanic: [clone(FX.mechanicEditUnchanged_before)],
    staff: [clone(FX.staffEditUnchanged_before)],
    gst_tax_rate: [clone(FX.gstEditUnchanged_before)],
    states: [{ id: 1, state_name: 'Uttar Pradesh', code: 9 }, { id: 2, state_name: 'Delhi', code: 7 }, { id: 3, state_name: 'Goa', code: 30 }],
    product_category: [{ id: 1, category_name: 'Brakes' }, { id: 2, category_name: 'Engine' }],
    product_subcategory: [{ id: 1, subcategory_name: 'Pads', category_id: 1 }],
    warehouse: [clone(FX.warehouseEditUnchanged_before), { id: 2, name: 'Godown', location: 'Agra', status: 'Active' }],
    warehouse_racks: [clone(FX.rackEditUnchanged_before)],
    bank_details: [clone(FX.bankEditUnchanged_before)],
    business_details: [clone(FX.businessEditUnchanged_before)],
    user: [clone(FX.userEditUnchanged_before)],
    financial_year: [{ id: 4, fy: '2026-2027', start_date: new Date(Date.UTC(2026, 3, 1)), end_date: new Date(Date.UTC(2027, 2, 31)) }],
    shipto: [], shiptox: []
  });
  // the seeded customers / vendors name their state like the screens do
  store.customer_details.forEach(c => { c.billing_state = c.billing_state_code === 9 ? 'Uttar Pradesh' : 'Delhi'; });
  store.vendor_details.forEach(v => { v.state = v.state_code === 9 ? 'Uttar Pradesh' : v.state_code === 7 ? 'Delhi' : null; });
}

describe('Review E - settings', () => {
  afterEach(() => { globalThis.__session = undefined; jest.useRealTimers(); });

  // ------------------------------------------------------------ mechanics / staff (twins)
  for (const [key, table, label] of [['mechanic', 'mechanic', 'mechanics'], ['staff', 'staff', 'staff']]) {
    sc(`E-S1 ${key}`, `${key}: create (screen payload) -> list -> save unchanged -> edit one -> status; dropdown and report follow`, async () => {
      const c = await replay(FX[`${key}Create`]);
      const made = store[table].at(-1);
      ex('E-S1', `${key} created 201, name trimmed, Active`, c.status === 201 && made.name === FX[`${key}Create`].body.name.trim() && made.status === 'Active', c.body);
      const l = await api('GET', `/api/${label}${FX[`${key}List`]}`);
      ex('E-S1', 'the screen list (includeInactive) shows it, Page 1 of 1', l.body[label === 'staff' ? 'staff' : 'mechanics'].length === 2 && l.body.pagination.totalPages === 1, l.body.pagination);
      const before = clone(row(table, 1));
      const u = await replay(FX[`${key}EditUnchanged`]);
      ex('E-S1', 'save unchanged: nothing changes ("" for a blank optional field stays null)', u.status === 200 && changed(before, row(table, 1)).length === 0, changed(before, row(table, 1)));
      await replay(FX[`${key}EditOne`]);
      const one = changed(before, row(table, 1));
      ex('E-S1', 'edit one field: only it', one.length === 1 && one[0] === (key === 'mechanic' ? 'city' : 'email'), one);
      // a bill names them, then they are deactivated
      const { id: bill } = await create(K.sale, { partyId: 1, items: [[1, 1, 100, 0]], extra: { [`${key}_id`]: 1 } });
      const s = await replay(FX[`${key}Status`]);
      ex('E-S1', 'status route: Inactive', s.status === 200 && row(table, 1).status === 'Inactive', s.body);
      const dd = await api('GET', `/api/${label}?dropdown=true`);
      ex('E-S1', 'the bill form dropdown (dropdown=true) leaves it out', !(dd.body[label === 'staff' ? 'staff' : 'mechanics']).some(m => m.id === 1), dd.body);
      const rep = await api('GET', `/api/reports/${key === 'mechanic' ? 'mechanic-sales' : 'staff-sales'}?page=1&limit=50&dateFrom=2026-10-01T00%3A00%3A00&dateTo=2026-10-31T23%3A59%3A59&transactionType=all`);
      ex('E-S1', 'its old bill still shows under its name in the report', rep.status === 200 && rep.body.data.some(r => (r.mechanic_name || r.staff_name) === before.name), rep.body.data);
      const again = await replay(FX[`${key}Status`]);
      ex('E-S1', 'pressing Deactivate twice is a success, not an error', again.status === 200, again.body);
      ex('E-S1', 'bill made', !!bill);
    });
  }

  // ------------------------------------------------------------ GST rates
  sc('E-S2', 'GST rate: create 0.25 % -> save unchanged keeps status -> edit HSN -> deactivate -> edit keeps Inactive', async () => {
    const c = await replay(FX.gstCreate);
    ex('E-S2', 'created 0.25', c.status === 201 && store.gst_tax_rate.some(g => g.rate === 0.25), c.body);
    const before = clone(row('gst_tax_rate', 1));
    await replay(FX.gstEditUnchanged);
    ex('E-S2', 'unchanged: nothing', changed(before, row('gst_tax_rate', 1)).length === 0, changed(before, row('gst_tax_rate', 1)));
    await replay(FX.gstStatus);
    await replay(FX.gstEditOne);
    ex('E-S2', 'edit after deactivate: HSN changes, stays Inactive (the form no longer sends status)', row('gst_tax_rate', 1).hsn_code === '8714' && row('gst_tax_rate', 1).status === 'Inactive', row('gst_tax_rate', 1));
    const neg = await replay(FX.gstEditOne, { rate: '-5' });
    ex('E-S2', 'PUT rate -5: refused', neg.status === 400, neg.body);
    const dup = await replay(FX.gstCreate);
    ex('E-S2', 'same description again: refused', dup.status === 400, dup.body);
    const list = await api('GET', `/api/gst-rates${FX.gstList}`);
    ex('E-S2', 'the screen list shows both, inactive included', list.body.gstRates.length === 2, list.body);
  });

  // ------------------------------------------------------------ states (D4)
  sc('E-S3', 'states: create -> save unchanged -> rename in use refused (customer by name) -> delete in use refused (vendor, bill snapshots) -> unused deleted', async () => {
    const c = await replay(FX.stateCreate);
    ex('E-S3', 'created with code 6 (sent as "6")', c.status === 201 && store.states.some(s => s.state_name === 'Haryana' && s.code === 6), c.body);
    const before = clone(row('states', 1));
    const u = await replay(FX.stateEditUnchanged);
    ex('E-S3', 'save unchanged of a state in use: allowed, nothing changes', u.status === 200 && changed(before, row('states', 1)).length === 0, u.body);
    const rn = await replay(FX.stateRenameInUse);
    ex('E-S3', 'rename while a customer names it: 409', rn.status === 409 && row('states', 1).state_name === 'Uttar Pradesh', rn.body);
    const d = await replay(FX.stateDeleteInUse);
    ex('E-S3', 'delete Delhi (a customer and a vendor name it): 409', d.status === 409 && !!row('states', 2), d.body);
    // Goa: only a purchase's bill-to snapshot uses it
    store.bill_to.push({ id: 900, purchase_id: 900, vendor_name: 'X', address: '', state: 'Goa' });
    const g = await api('DELETE', '/api/states/3');
    ex('E-S3', 'delete a state only a purchase snapshot uses: 409', g.status === 409, g.body);
    store.bill_to.pop();
    store.bill_tosalesx.push({ id: 900, invoice_no: 900, billing_name: 'X', billing_address: '', billing_state: 'Goa' });
    ex('E-S3', 'delete a state only an Invoice C snapshot uses: 409', (await api('DELETE', '/api/states/3')).status === 409);
    store.bill_tosalesx.pop();
    const hid = store.states.find(s => s.state_name === 'Haryana').id;
    const ok = await api('DELETE', `/api/states/${hid}`);
    ex('E-S3', 'an unused state is deleted', ok.status === 200 && !store.states.some(s => s.id === hid), ok.body);
    const list = await api('GET', `/api/states${FX.statesList}`);
    ex('E-S3', 'useStates reads {id, state_name, code}', list.body.states.every(s => 'id' in s && 'state_name' in s && 'code' in s), list.body.states);
  });

  sc('E-07', 'changing the GST code of a state in use is refused or carried to the parties that name it', async () => {
    const r = await replay(FX.stateCodeChangeInUse);
    const custs = store.customer_details.filter(c => c.billing_state === 'Uttar Pradesh');
    ex('E-07', 'refused (409), or every customer naming the state now carries code 10 (today: 200 and they keep 9)', r.status === 409 || custs.every(c => c.billing_state_code === 10), { status: r.status, codes: custs.map(c => c.billing_state_code) });
  }, { open: 'E-07' });

  sc('E-09', 'a state used only by a sale\'s ship-to snapshot cannot be deleted (bill snapshots, D4)', async () => {
    store.shipto.push({ id: 900, invoice_no: 900, shipping_address: 'x', shipping_state: 'Goa', shipping_state_code: 30, shipping: true });
    const r = await api('DELETE', '/api/states/3');
    ex('E-09', 'refused (today: deleted - shipto / shiptox are not checked)', r.status === 409 && store.states.some(s => s.id === 3), r.body);
  }, { open: 'E-09' });

  // ------------------------------------------------------------ product lookups
  sc('E-S4', 'category / subcategory: create, save unchanged, duplicate, delete guarded by products', async () => {
    const c = await replay(FX.categoryCreate);
    ex('E-S4', 'category created', c.status === 201 && store.product_category.some(x => x.category_name === 'Clutch'), c.body);
    const before = clone(row('product_category', 1));
    await replay(FX.categoryEditUnchanged);
    ex('E-S4', 'unchanged: nothing', changed(before, row('product_category', 1)).length === 0);
    ex('E-S4', 'duplicate name: 409', (await replay(FX.categoryCreate)).status === 409);
    const del = await api('DELETE', '/api/products/categories/1');
    ex('E-S4', 'delete a category products use: 409 (the seeded products are Brakes)', del.status === 409 && !!row('product_category', 1), del.body);
    const s = await replay(FX.subcategoryCreate);
    ex('E-S4', 'subcategory under Engine', s.status === 201 && store.product_subcategory.some(x => x.subcategory_name === 'Gaskets' && x.category_id === 2), s.body);
    const sb = clone(row('product_subcategory', 1));
    await replay(FX.subcategoryEditUnchanged);
    ex('E-S4', 'subcategory unchanged: nothing', changed(sb, row('product_subcategory', 1)).length === 0);
    const bad = await replay(FX.subcategoryCreate, { category_id: 99, subcategory_name: 'X' });
    ex('E-S4', 'unknown category: 400', bad.status === 400, bad.body);
    const l = await api('GET', `/api/products/subcategories${FX.subcategoryList}`);
    ex('E-S4', 'subcategory list with its category', l.body.data.every(x => x.category?.category_name), l.body.data);
  });

  // ------------------------------------------------------------ warehouses / racks
  sc('E-S5', 'warehouse and racks: create, save unchanged, edit one, status, rack duplicate / move', async () => {
    const c = await replay(FX.warehouseCreate);
    ex('E-S5', 'warehouse created (the form sends id 0 too)', c.status === 201 && store.warehouse.some(w => w.name === 'Annexe'), c.body);
    const before = clone(row('warehouse', 1));
    await replay(FX.warehouseEditUnchanged);
    ex('E-S5', 'unchanged: nothing', changed(before, row('warehouse', 1)).length === 0);
    await replay(FX.warehouseEditOne);
    ex('E-S5', 'location only', JSON.stringify(changed(before, row('warehouse', 1))) === '["location"]', changed(before, row('warehouse', 1)));
    const s = await replay(FX.warehouseStatus);
    ex('E-S5', 'status route', s.status === 200 && row('warehouse', 1).status === 'Inactive', s.body);
    const dd = await api('GET', `/api/warehouses${FX.rackWarehouseOptions}`);
    ex('E-S5', 'the rack form picker (dropdown) leaves the inactive warehouse out', !dd.body.warehouses.some(w => w.id === 1), dd.body.warehouses);
    const rc = await replay(FX.rackCreate);
    ex('E-S5', 'rack B2 in Godown (trimmed)', rc.status === 201 && store.warehouse_racks.some(r => r.rack_number === 'B2' && r.warehouse_id === 2), rc.body);
    ex('E-S5', 'same rack number again: refused', (await replay(FX.rackCreate)).status === 400);
    const rb = clone(row('warehouse_racks', 1));
    await replay(FX.rackEditUnchanged);
    ex('E-S5', 'rack unchanged: nothing', changed(rb, row('warehouse_racks', 1)).length === 0, changed(rb, row('warehouse_racks', 1)));
    const mv = await replay(FX.rackEditUnchanged, { warehouse_id: '2' });
    ex('E-S5', 'rack moved to Godown (URL = owner, body = target)', mv.status === 200 && row('warehouse_racks', 1).warehouse_id === 2, mv.body);
    const st = await api('PUT', '/api/warehouses/2/racks', FX.rackStatus.body);
    ex('E-S5', 'rack status by {id, status}', st.status === 200 && row('warehouse_racks', 1).status === 'Inactive', st.body);
    const l = await api('GET', `/api/racks${FX.rackList}`);
    ex('E-S5', 'rack list with warehouse names', l.body.racks.every(r => r.warehouse_name), l.body.racks);
  });

  // ------------------------------------------------------------ bank / business
  sc('E-S6', 'bank and business details: create, save unchanged, edit one, normalising', async () => {
    const c = await replay(FX.bankCreate);
    ex('E-S6', 'bank created, IFSC upper-cased', c.status === 201 && store.bank_details.some(b => b.bank_name === 'Savings' && b.ifsc === 'HDFC0001234'), c.body);
    const before = clone(row('bank_details', 1));
    await replay(FX.bankEditUnchanged);
    ex('E-S6', 'bank unchanged: nothing ("" stays null)', changed(before, row('bank_details', 1)).length === 0, changed(before, row('bank_details', 1)));
    await replay(FX.bankEditOne);
    ex('E-S6', 'IFSC only', JSON.stringify(changed(before, row('bank_details', 1))) === '["ifsc"]');
    ex('E-S6', 'same account number again: 409', (await replay(FX.bankCreate)).status === 409);
    const bb = clone(row('business_details', 1));
    await replay(FX.businessEditUnchanged);
    ex('E-S6', 'business unchanged: nothing', changed(bb, row('business_details', 1)).length === 0, changed(bb, row('business_details', 1)));
    await replay(FX.businessEditOne);
    ex('E-S6', 'business email only', JSON.stringify(changed(bb, row('business_details', 1))) === '["email"]');
    const lc = await replay(FX.businessEditUnchanged, { gstin: '09abcde1234f1z5' });
    ex('E-S6', 'GSTIN saved upper-case', lc.status === 200 && row('business_details', 1).gstin === '09ABCDE1234F1Z5', lc.body);
    ex('E-S6', 'bad GSTIN refused', (await replay(FX.businessEditUnchanged, { gstin: '99XX' })).status === 400);
  });

  // ------------------------------------------------------------ users (D1)
  sc('E-S7', 'users: create, save unchanged, deactivate others; own login and the last active user refused', async () => {
    const c = await replay(FX.userCreate);
    const nu = store.user.find(u => u.username === 'counter1');
    ex('E-S7', 'created Active (status "10")', c.status === 201 && nu?.status === 10, c.body);
    const before = clone(row('user', 1));
    const u = await replay(FX.userEditUnchanged);
    ex('E-S7', 'save unchanged (empty password): nothing changes', u.status === 200 && changed(before, row('user', 1)).length === 0, changed(before, row('user', 1)));
    globalThis.__session = { user: { id: '1' } };
    const self = await api('PATCH', '/api/users/1/status', { status: 'Inactive' });
    ex('E-S7', 'own login: 409', self.status === 409 && row('user', 1).status === 10, self.body);
    const selfEdit = await replay(FX.userEditUnchanged, { status: '0' });
    ex('E-S7', 'own login through the edit form: 409', selfEdit.status === 409 && row('user', 1).status === 10, selfEdit.body);
    const other = await api('PATCH', `/api/users/${nu.id}/status`, FX.userStatus.body);
    ex('E-S7', 'another user: deactivated', other.status === 200 && nu && store.user.find(x => x.id === nu.id).status === 0, other.body);
    globalThis.__session = { user: { id: '77' } };
    const last = await api('PATCH', '/api/users/1/status', { status: 'Inactive' });
    ex('E-S7', 'the last active user: 409', last.status === 409 && row('user', 1).status === 10, last.body);
  });

  sc('E-03', 'a user created in Settings fits the user table (auth_key VARCHAR(32))', async () => {
    await replay(FX.userCreate);
    const nu = store.user.find(u => u.username === 'counter1');
    ex('E-03', 'auth_key at most 32 characters (today 48: randomBytes(24).toString("hex"))', nu && nu.auth_key.length <= 32, nu?.auth_key?.length);
  }, { open: 'E-03' });

  // ------------------------------------------------------------ financial years (D2)
  sc('E-S8', 'financial years: past year allowed, overlap refused, last day still current, list', async () => {
    const c = await replay(FX.fyCreate);
    ex('E-S8', 'a past year that overlaps nothing: 201', c.status === 201 && store.financial_year.some(f => f.fy === '2025-2026'), c.body);
    const dup = await replay(FX.fyCreate);
    ex('E-S8', 'again: 409', dup.status === 409, dup.body);
    const ov = await api('POST', '/api/financial-years', { start_date: '2026-04-01', end_date: '2027-03-31' });
    ex('E-S8', 'the open year again: 409', ov.status === 409, ov.body);
    const bad = await api('POST', '/api/financial-years', { start_date: '2026-04-02', end_date: '2027-03-31' });
    ex('E-S8', 'not 1 April: 400', bad.status === 400, bad.body);
    jest.useFakeTimers({ now: new Date('2027-03-31T23:30:00+05:30'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    const last = await api('PUT', '/api/financial-years/4/current');
    ex('E-S8', '31 March 23:30: the year can still be made current', last.status === 200, last.body);
    jest.setSystemTime(new Date('2027-04-01T00:00:30+05:30'));
    const after = await api('PUT', '/api/financial-years/4/current');
    ex('E-S8', '1 April 00:00:30: refused (ended)', after.status === 400, after.body);
    jest.useRealTimers();
    const l = await api('GET', `/api/financial-years${FX.fyList}`);
    ex('E-S8', 'the screen list: current id and both years', l.body.currentFyId === 4 && l.body.financialYears.length === 2, l.body);
  });

  sc('E-04', 'a financial year created in Settings is handed to the DATE column as its own day (1 April), not the UTC day before', async () => {
    await replay(FX.fyCreate);
    const f = store.financial_year.find(x => x.fy === '2025-2026');
    // Prisma writes a @db.Date as the UTC calendar day of the Date it is given.
    ex('E-04', 'start_date is 2025-04-01 in UTC (today 2025-03-31T18:30Z: stored as 31 March)', f && f.start_date.toISOString().slice(0, 10) === '2025-04-01', f && f.start_date.toISOString());
  }, { open: 'E-04' });

  // ------------------------------------------------------------ inactive products / dashboard low stock
  sc('E-S9', 'inactive products: reactivate by the status route; dashboard and Minimum Stock count active products only', async () => {
    Object.assign(store.product.find(p => p.id === 2), { min_stock: 2000, is_active: false }); // 1000 in stock: low, but inactive
    Object.assign(store.product.find(p => p.id === 1), { min_stock: 2000 }); // 1000 in stock: low
    const d1 = await api('GET', '/api/dashboard?today=2026-10-03&salesDate=2026-10-03&purchasesDate=2026-10-03');
    ex('E-S9', 'dashboard: low stock 1 (the inactive one is not counted), products = active', d1.body.totals.lowStock === 1 && d1.body.totals.products === store.product.filter(p => p.is_active).length, d1.body.totals);
    const r = await replay(FX.inactiveReactivate);
    ex('E-S9', 'reactivated', r.status === 200 && store.product.find(p => p.id === 2).is_active === true, r.body);
    const d2 = await api('GET', '/api/dashboard?today=2026-10-03&salesDate=2026-10-03&purchasesDate=2026-10-03');
    ex('E-S9', 'dashboard follows: low stock 2', d2.body.totals.lowStock === 2, d2.body.totals);
    const ms = await api('GET', '/api/reports/minimum-stock?page=1&limit=50&search=&categoryFilter=&companyFilter=&modelFilter=');
    ex('E-S9', 'Minimum Stock lists the same two', ms.body.pagination.total === 2, ms.body);
  });
});
