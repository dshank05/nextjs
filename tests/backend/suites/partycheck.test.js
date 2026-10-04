// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import custIndex from '../../../pages/api/customers/index';
import custOne from '../../../pages/api/customers/[id]';
import custStatus from '../../../pages/api/customers/[id]/status';
import vendIndex from '../../../pages/api/vendors/index';
import vendOne from '../../../pages/api/vendors/[id]';
import vendStatus from '../../../pages/api/vendors/[id]/status';
import dsIndex from '../../../pages/api/deadstock/index';
import dsOne from '../../../pages/api/deadstock/[id]';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
test('customers / vendors', async () => {
  Object.assign(store, {
    customer_details: [{ id: 1, billing_name: 'Old Customer', billing_address: 'A', billing_state: 'Uttar Pradesh', billing_state_code: 9, shipping_address: 'A', contact_no: '9876543210', status: 'Active' }],
    vendor_details: [{ id: 1, vendor_name: 'Zeta Parts', state: 'Delhi', state_code: 7, city: 'Delhi', contact_no: '9876543210', status: 'Inactive' },
                     { id: 2, vendor_name: 'Alpha Motors', state: 'Uttar Pradesh', state_code: 9, city: 'Agra', contact_no: '9123456780', status: 'Active' }],
    customer_ledger: [{ id: 1, customer_id: 1, debit: 500, credit: 120 }], vendor_ledger: [],
    invoice: [{ id: 1, select_customer: 1 }], invoicex: [], customer_payments: [], customer_refunds: [],
    purchase: [], purchase_returns: [], vendor_payments: [], vendor_refunds: [],
    product: [{ id: 1, product_name: 'Brake Pad', part_no: 'BP1', stock: 2 }], deadstock: []
  });
  const cust = { billing_name: 'Ravi Motors', billing_address: 'Main Rd', billing_state: 'Uttar Pradesh', billing_state_code: '9', contact_no: '9876500000', contact_no_2: '9876500001', contact_no_3: '9876500002', email: 'r@x.in' };
  let r = await call(custIndex, 'POST', {}, cust);
  const c = store.customer_details.find(x => x.billing_name === 'Ravi Motors');
  ok('customer create saves Phone 2 / Phone 3 and Active (dropped before)', r.status === 201 && c.contact_no_2 === '9876500001' && c.contact_no_3 === '9876500002' && c.status === 'Active', { r: r.body, c });
  ok('customer create: shipping falls back to billing (NOT NULL column)', c.shipping_address === 'Main Rd' && c.shipping_state === 'Uttar Pradesh' && c.shipping_name === 'Ravi Motors', c);
  r = await call(custIndex, 'POST', {}, { ...cust, contact_no: '12345', billing_gstin: 'ABC', email: 'nope' });
  ok('server refuses a bad phone, GSTIN and email (only the form checked)', r.status === 400 && r.body.errors.length === 3, r.body);
  r = await call(custIndex, 'POST', {}, { billing_name: '' });
  ok('required fields listed', r.status === 400 && r.body.message === 'Validation failed' && r.body.errors.some(e => e.includes('Billing name')), r.body);

  r = await call(custOne, 'GET', { id: '1' });
  ok('customer GET: string id and outstanding = ledger sum (380)', r.status === 200 && r.body.id === '1' && r.body.outstanding === 380, r.body);
  r = await call(custOne, 'DELETE', { id: '1' });
  ok('deleting a customer with a bill is refused', r.status === 409 && store.customer_details.some(x => x.id === 1), r.body);
  r = await call(custOne, 'DELETE', { id: String(c.id) });
  ok('a customer without history can be deleted', r.status === 200 && !store.customer_details.some(x => x.id === c.id), r.body);

  r = await call(vendOne, 'PUT', { id: '1' }, { vendor_name: 'Zeta Parts', state: 'Delhi', state_code: '7', contact_no: '9876543210', city: 'New Delhi' });
  ok('editing an inactive vendor keeps it inactive (was set Active)', r.status === 200 && store.vendor_details[0].status === 'Inactive' && store.vendor_details[0].city === 'New Delhi', { r: r.body, v: store.vendor_details[0] });
  r = await call(vendStatus, 'PUT', { id: '1' }, { status: 'Active' });
  ok('status change needs confirmation', r.status === 400, r.body);
  r = await call(vendStatus, 'PUT', { id: '1' }, { status: 'Active', confirmed: true });
  ok('status change', r.status === 200 && store.vendor_details[0].status === 'Active', r.body);
  r = await call(vendIndex, 'GET', { sortBy: 'name', sortOrder: 'asc', page: '1', limit: '1' });
  ok('vendor list sorted on the server across pages', r.body.vendors.length === 1 && r.body.vendors[0].vendor_name === 'Alpha Motors' && r.body.pagination.total === 2, r.body);
  r = await call(vendIndex, 'GET', { sortBy: 'state', sortOrder: 'asc' });
  ok('sort by state', r.body.vendors.map(v => v.state).join() === 'Delhi,Uttar Pradesh', r.body.vendors);
  store.vendor_details[0].status = 'Inactive';
  r = await call(vendIndex, 'GET', { dropdown: 'true' });
  ok('dropdown: active ones only, all of them', r.body.vendors.length === 1 && r.body.vendors[0].id === '2', r.body);
  r = await call(custStatus, 'GET', { id: '1' });
  ok('customer status GET', r.status === 200 && r.body.status === 'Active' && r.body.name === 'Old Customer', r.body);

  // ---------------- dead stock
  r = await call(dsIndex, 'POST', {}, { product_id: 1, quantity: 1.5, reason: 'rust' });
  ok('dead stock: fractions refused (whole units)', r.status === 400, r.body);
  r = await call(dsIndex, 'POST', {}, { product_id: 1, quantity: 3, reason: 'rust' });
  ok('dead stock: more than in stock refused', r.status === 400 && r.body.error_code === 'INSUFFICIENT_STOCK', r.body);
  r = await call(dsIndex, 'POST', {}, { product_id: 1, quantity: 2, reason: 'rust' });
  const d = store.deadstock[0];
  ok('dead stock add: stock 2 -> 0', r.status === 201 && store.product[0].stock === 0 && d.quantity === 2, { r: r.body, p: store.product[0] });
  r = await call(dsOne, 'PUT', { id: String(d.id) }, { quantity: 6, reason: 'rust' });
  ok('dead stock edit to more than stock allows is refused (left stock at -4 before)', r.status === 400 && store.product[0].stock === 0 && d.quantity === 2, { r: r.body, p: store.product[0] });
  r = await call(dsOne, 'PUT', { id: String(d.id) }, { quantity: 1, reason: 'rust, one fixed' });
  ok('dead stock edit down returns a unit', r.status === 200 && store.product[0].stock === 1 && d.quantity === 1 && d.reason === 'rust, one fixed', { r: r.body, p: store.product[0], d });
  r = await call(dsIndex, 'GET', { sortBy: 'quantity', sortOrder: 'asc' });
  ok('dead stock list', r.status === 200 && r.body.deadstock[0].product_name === 'Brake Pad' && r.body.pagination.total === 1, r.body);
  r = await call(dsOne, 'DELETE', { id: String(d.id) });
  ok('dead stock delete returns the units', r.status === 200 && store.product[0].stock === 2 && store.deadstock.length === 0, { r: r.body, p: store.product[0] });
  expect(FAILED).toEqual([]);
}, 170000);
