// Review B - Sales and Invoice C: every refusal the sale / Invoice C routes give, through the route,
// for both kinds - status, error_code, the message the screen shows (hooks/readJson.ts puts
// `message` in the snackbar), and NOTHING written (every table compared before and after).
// Bodies start from the screens' captured payloads (tests/backend/fixtures/sales) and change the
// one thing each refusal is about.
import fs from 'fs';
import path from 'path';
import { store, call, sum, r2, N, seedStock } from '../support/scenlib.js';
import { reset, checkAll, checkReports, stats, ok, H } from '../support/flowlib.js';

const FIX = path.join(__dirname, '../fixtures/sales');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const SEED = fx('seed.json');
function seed() {
  reset(); seedStock(); stats.failures = [];
  for (const c of SEED.customer_details) Object.assign(store.customer_details.find(x => x.id === c.id), c);
  store.staff = SEED.staff.map(s => ({ ...s }));
  store.mechanic = SEED.mechanic.map(m => ({ ...m }));
  for (const p of SEED.product) Object.assign(store.product.find(x => x.id === p.id), p);
}
const api = (kind) => ({ col: kind === 'sale' ? H.sales : H.salex, one: kind === 'sale' ? H.saleOne : H.salexOne });
const header = (kind) => kind === 'sale' ? 'invoice' : 'invoicex';
const lineTable = (kind) => kind === 'sale' ? 'invoiceitems' : 'invoice_itemsx';
const docLines = (kind, id) => store[lineTable(kind)].filter(l => l.invoice_no === id).sort((a, b) => a.id - b.id);
const doc = (kind, id) => store[header(kind)].find(b => b.id === id);
const body = (file) => structuredClone(fx(file).body);
function editBody(kind, file, id) {
  const b = body(file);
  const rows = docLines(kind, id);
  (b.invoiceItems || []).forEach((it, i) => { if (it.line_id !== undefined) it.line_id = rows[i]?.id; });
  return b;
}
const same = () => JSON.stringify(store);
const noDiscount = (b) => { b.invoiceItems[0].discount = 0; return b; };
/** One refusal: the answer, its code and message, and nothing written. */
async function refused(label, fn, status, code, message) {
  const before = same();
  const r = await fn();
  ok(`${label}: ${status}${code ? ' ' + code : ''}`, r.status === status && (!code || r.body?.error_code === code), r.body);
  if (message) ok(`${label}: message "${message}"`, String(r.body?.message || '').includes(message), r.body);
  ok(`${label}: nothing written`, same() === before, null);
  return r;
}

describe('Review B - refusals (sale and Invoice C)', () => {
  for (const kind of ['sale', 'salex']) {
    const A = api(kind);
    const create = (b) => call(A.col, 'POST', {}, b);

    test(`RF-${kind}-create: every create refusal, nothing written`, async () => {
      seed();
      const c = () => body(`${kind}-create.json`);
      await refused('no lines', () => create({ ...c(), invoiceItems: [] }), 400, 'VALIDATION', 'A bill needs at least one line item');
      await refused('line without a product', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], product_id: null }] }), 400, 'VALIDATION', 'Every line needs a valid product');
      await refused('product that does not exist', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], product_id: 77 }] }), 400, 'UNKNOWN_PRODUCT', 'A selected product does not exist');
      await refused('qty 0', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], qty: 0 }] }), 400, 'VALIDATION', 'quantity of at least 1');
      await refused('qty not a number', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], qty: 'two' }] }), 400, 'VALIDATION', 'Quantity must be a number');
      await refused('negative rate', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], rate: -1 }] }), 400, 'VALIDATION', 'Rates cannot be negative');
      await refused('GST over 100', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], gst_percentage: 101 }] }), 400, 'VALIDATION', 'between 0 and 100');
      await refused('discount over the line', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], discount: 2001 }] }), 400, 'VALIDATION', 'more than the line amount');
      await refused('negative discount', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], discount: -5 }] }), 400, 'VALIDATION', 'cannot be negative');
      await refused('no customer', () => { const b = c(); delete b.select_customer; return create(b); }, 400, 'VALIDATION', 'A customer is required');
      await refused('customer that does not exist', () => create({ ...c(), select_customer: 99 }), 400, 'VALIDATION', 'customer does not exist');
      await refused('"Other" with no name', () => create({ ...body(`${kind}-create-other.json`), customer_name: '' }), 400, 'VALIDATION', 'Customer name is required');
      await refused('"Other" with no phone', () => create({ ...body(`${kind}-create-other.json`), contact_number: ' ' }), 400, 'VALIDATION', 'Phone number is required');
      await refused('Partial asserted on create', () => create({ ...c(), payment_status: 2 }), 400, 'VALIDATION', 'Partial is derived');
      await refused('paid with no mode', () => { const b = c(); b.payment_status = 1; delete b.payment_mode; return create(b); }, 400, 'VALIDATION', 'Payment mode (Cash/Bank) is required');
      await refused('mode 5', () => create({ ...c(), payment_mode: 5 }), 400, 'VALIDATION', 'Invalid payment_mode');
      await refused('negative freight', () => create({ ...c(), transport_cost: -1 }), 400, 'VALIDATION', 'Freight cannot be negative');
      await refused('negative commission', () => create({ ...c(), commission: -1 }), 400, 'VALIDATION', 'Commission cannot be negative');
      await refused('negative P&F qty', () => create({ ...c(), packing_forwarding_qty: -1 }), 400, 'VALIDATION', 'cannot be negative');
      await refused('staff that does not exist', () => create({ ...c(), staff_id: 42 }), 400, 'VALIDATION', 'Invalid staff member');
      await refused('mechanic that does not exist', () => create({ ...c(), mechanic_id: 42 }), 400, 'VALIDATION', 'Invalid mechanic');
      // Stock is checked per product across lines (two lines of 600 against 1000).
      await refused('more than the shelf holds, over two lines', () => create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], qty: 600 }, { ...c().invoiceItems[0], qty: 600 }] }), 400, 'INSUFFICIENT_STOCK', 'Insufficient stock for "Brake Pad": available 1000, requested 1200');
      const r = await create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], qty: 1001 }] });
      ok('stock refusal names the product for the screen', r.body?.item?.product_id === 1 && r.body.item.available === 1000 && r.body.item.requested === 1001, r.body);
      // A state that has no GST code: a sale cannot decide CGST/SGST vs IGST; Invoice C carries no tax and goes through.
      const bad = { ...c(), state_code: 99, state: 'Nowhere' };
      if (kind === 'sale') await refused('state with no GST code', () => create(bad), 400, 'SUPPLY_TYPE_UNRESOLVED', 'Cannot determine the tax type');
      else { const ok2 = await create(bad); ok('Invoice C with an unknown state is taken (no tax to split)', ok2.status === 201, ok2.body); }
      // Rate 0 is allowed (owner: free lines).
      const free = await create({ ...c(), invoiceItems: [{ ...c().invoiceItems[0], rate: 0, discount: 0 }] });
      ok('rate 0 allowed', free.status === 201, free.body);
      await checkAll(`RF-${kind}-create`); await checkReports(`RF-${kind}-create`);
      expect(stats.failures).toEqual([]);
    });

    test(`RF-${kind}-edit: every edit refusal, nothing written`, async () => {
      seed();
      // Line 1 without its discount: a return of half a discounted line trips B-13 (tax rounding on returns).
      const made = await create(noDiscount(body(`${kind}-create.json`)));
      const id = made.body.sale.id;
      const e = () => noDiscount(editBody(kind, `${kind}-edit-notes.json`, id));
      const put = (b, qid = String(id)) => call(A.one, 'PUT', { id: qid }, b);
      await refused('bill that does not exist', () => put(e(), '4242'), 404, 'NOT_FOUND', 'not found');
      await refused('id that is not a number', () => put(e(), 'abc'), 400, null, `Invalid ${kind === 'sale' ? 'Sale' : 'Invoice C'} ID`);
      await refused('customer changed', () => put({ ...e(), select_customer: 2 }), 400, 'CUSTOMER_CHANGE_NOT_ALLOWED', 'cannot be changed');
      await refused('a line of another bill', () => { const b = e(); b.invoiceItems[0].line_id = 9999; return put(b); }, 400, 'FOREIGN_LINE', 'does not belong to this bill');
      await refused('the same line twice', () => { const b = e(); b.invoiceItems[1].line_id = b.invoiceItems[0].line_id; b.invoiceItems[1].product_id = b.invoiceItems[0].product_id; return put(b); }, 400, 'DUPLICATE_LINE_ID', 'sent twice');
      await refused('qty raised past the shelf', () => { const b = e(); b.invoiceItems[0].qty = 1001; return put(b); }, 400, 'INSUFFICIENT_STOCK', 'Insufficient stock');
      await refused('marked paid with no mode', () => { const b = e(); b.payment_status = 1; b.payment_mode = ''; return put(b); }, 400, 'VALIDATION', 'Payment mode');
      const resent = await put({ ...e(), payment_status: 2 });
      ok('a resent Partial is ignored, not refused (owner)', resent.status === 200 && doc(kind, id).payment_status === 0, resent.body);
      // returns: 1 Brake Pad back
      const line = docLines(kind, id)[0];
      const rr = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: '2026-10-04', payment_status: 0, payment_mode: 1,
        items: [{ invoice_item_id: line.id, invoice_type: kind === 'sale' ? 'invoice' : 'invoicex', return_qty: 1, return_reason_id: 1 }] });
      ok('return created', rr.status === 201, rr.body);
      await refused('line below what was returned', () => { const b = e(); b.invoiceItems[0].qty = 0.4; return put(b); }, 400, 'VALIDATION', 'quantity of at least 1');
      // qty 1 is allowed (= returned); a whole number below the returned 1 is 0 and refused above; take 2 back first
      const rr2 = await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: '2026-10-04', payment_status: 0, payment_mode: 1,
        items: [{ invoice_item_id: line.id, invoice_type: kind === 'sale' ? 'invoice' : 'invoicex', return_qty: 1, return_reason_id: 1 }] });
      ok('second return created (2 of 2 back)', rr2.status === 201, rr2.body);
      await refused('line below what was returned (2 back, qty 1)', () => { const b = e(); b.invoiceItems[0].qty = 1; return put(b); }, 400, 'QTY_BELOW_RETURNED', '2 units have already been returned');
      await refused('a returned line removed', () => { const b = e(); b.invoiceItems = [b.invoiceItems[1]]; return put(b); }, 400, 'CANNOT_DELETE_RETURNED_ITEM', 'units have been returned');
      // every line back: the bill is fully returned and cannot be edited at all
      const l2 = docLines(kind, id)[1];
      await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: '2026-10-04', payment_status: 0, payment_mode: 1,
        items: [{ invoice_item_id: l2.id, invoice_type: kind === 'sale' ? 'invoice' : 'invoicex', return_qty: 3, return_reason_id: 1 }] });
      ok('header says fully returned', doc(kind, id).return_status === 2, doc(kind, id));
      await refused('fully returned bill', () => put(e()), 400, 'FULLY_RETURNED', 'Cannot edit a fully returned bill');
      const d = (await call(A.one, 'GET', { id: String(id) })).body;
      ok('the edit form and view are told (return_status.is_fully_returned)', d.return_status.is_fully_returned === true && d.items.every(i => i.is_fully_returned), d.return_status);
      await checkAll(`RF-${kind}-edit`); await checkReports(`RF-${kind}-edit`);
      expect(stats.failures).toEqual([]);
    });

    test(`RF-${kind}-delete and route: refusals, nothing written`, async () => {
      seed();
      const made = await create(noDiscount(body(`${kind}-create.json`)));
      const id = made.body.sale.id;
      await refused('delete a bill that does not exist', () => call(A.one, 'DELETE', { id: '4242' }), 404, 'NOT_FOUND', 'not found');
      const line = docLines(kind, id)[0];
      await call(H.srCreate, 'POST', {}, { customer_id: 1, return_date: '2026-10-04', payment_status: 0, payment_mode: 1,
        items: [{ invoice_item_id: line.id, invoice_type: kind === 'sale' ? 'invoice' : 'invoicex', return_qty: 1, return_reason_id: 1 }] });
      ok('list row carries return_status for the disabled delete button', ((await call(A.col, 'GET', { page: '1', limit: '50' })).body.data || [])[0]?.return_status === 1);
      await refused('delete a bill with a return', () => call(A.one, 'DELETE', { id: String(id) }), 400, 'HAS_RETURNS', 'Delete its returns first');
      await refused('PATCH', () => call(A.one, 'PATCH', { id: String(id) }, {}), 405, null, 'Method not allowed');
      await refused('PUT on the collection', () => call(A.col, 'PUT', {}, {}), 405, null, null);
      globalThis.__session = false;
      try {
        await refused('signed out: list', () => call(A.col, 'GET', {}), 401, null, null);
        await refused('signed out: create', () => call(A.col, 'POST', {}, body(`${kind}-create.json`)), 401, null, null);
        await refused('signed out: delete', () => call(A.one, 'DELETE', { id: String(id) }), 401, null, null);
      } finally { delete globalThis.__session; }
      await checkAll(`RF-${kind}-delete`); await checkReports(`RF-${kind}-delete`);
      expect(stats.failures).toEqual([]);
    });
  }
});
