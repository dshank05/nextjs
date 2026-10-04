// Scenario helpers (SCENARIO_TESTS_PLAN): one kind table for sale / Invoice C / purchase, fresh
// store per scenario, and A1-A14 + the 16 report checks after each one.
import { store } from './dbstub.js';
import { stats, ok, out, quiet, call, sum, r2, N, checkAll, checkReports, H, reset } from './flowlib.js';
export { store, stats, ok, out, quiet, call, sum, r2, N, H };

export const K = {
  sale: { name: 'sale', label: 'sale', create: H.sales, one: H.saleOne, list: H.sales, bills: 'invoice', lines: 'invoiceitems', lineFk: 'invoice_no', snap: 'bill_tosales', transport: 'transport_details',
    party: 'customer', master: 'customer_details', partyField: 'select_customer', ledger: 'customer_ledger', who: 'customer_id', ref: 'sale', billType: 'SALE', payType: 'PAYMENT', listParam: 'customer',
    payCreate: H.cpCreate, payOne: H.cpOne, payTable: 'customer_payments', allocTable: 'customer_payment_allocations', payFk: 'invoice_id', stockSign: -1, taxed: true },
  salex: { name: 'salex', label: 'Invoice C', create: H.salex, one: H.salexOne, list: H.salex, bills: 'invoicex', lines: 'invoice_itemsx', lineFk: 'invoice_no', snap: 'bill_tosalesx', transport: 'transport_detailsx',
    party: 'customer', master: 'customer_details', partyField: 'select_customer', ledger: 'customer_ledger', who: 'customer_id', ref: 'salex', billType: 'SALE', payType: 'PAYMENT', listParam: 'customer',
    payCreate: H.cpCreate, payOne: H.cpOne, payTable: 'customer_payments', allocTable: 'customer_payment_allocations', payFk: 'invoicex_id', stockSign: -1, taxed: false },
  purchase: { name: 'purchase', label: 'purchase', create: H.purchases, one: H.purchaseOne, list: H.purchases, bills: 'purchase', lines: 'purchaseitems', lineFk: 'purchase_id', snap: 'bill_to', transport: null,
    party: 'vendor', master: 'vendor_details', partyField: 'vendor_id', ledger: 'vendor_ledger', who: 'vendor_id', ref: 'purchase', billType: 'PURCHASE', payType: 'PAYMENT', listParam: 'vendor',
    payCreate: H.vpCreate, payOne: H.vpOne, payTable: 'vendor_payments', allocTable: 'payment_allocations', payFk: 'purchase_id', stockSign: 1, taxed: true }
};
export const KINDS = [K.sale, K.salex, K.purchase];

// ---- reading the tables
export const rows = (k, pid = 1) => store[k.ledger].filter(l => l[k.who] === pid);
export const bal = (k, pid = 1) => r2(sum(rows(k, pid), l => N(l.debit) - N(l.credit)));
export const billRows = (k, id) => store[k.ledger].filter(l => l.reference_type === k.ref && l.reference_id === id && String(l.transaction_type).startsWith(k.billType));
export const billNet = (k, id) => r2(sum(billRows(k, id), l => N(l.debit) - N(l.credit)));
export const payRows = (k, pid = 1) => rows(k, pid).filter(l => String(l.transaction_type).startsWith(k.payType));
export const allocs = (k, id) => store[k.allocTable].filter(a => a[k.payFk] === id);
export const paidOn = (k, id) => r2(sum(allocs(k, id), a => N(a.allocated_amount)));
export const lines = (k, id) => store[k.lines].filter(l => l[k.lineFk] === id);
export const bill = (k, id) => store[k.bills].find(b => b.id === id);
export const payments = (k, pid = 1) => store[k.payTable].filter(p => p[k.who] === pid);
export const stock = (pid) => store.product.find(p => p.id === pid).stock;
export const party = (k, pid = 1) => store[k.master].find(p => p.id === pid);
export const counters = (k, pid = 1) => { const p = party(k, pid); return { paid: N(p.total_paid), alloc: N(p.total_allocated), refunded: N(p.total_refunded), refAlloc: N(p.total_refund_allocated) }; };

// ---- writing through the routes
export const D = (d) => `2026-10-${String(d).padStart(2, '0')}`;
export function billBody(k, { items = [[1, 10, 1000, 0]], status = 0, mode, freight, date = D(2), partyId = 1, extra = {} } = {}) {
  const its = items.map(([product_id, qty, rate, gst]) => ({ product_id, qty, rate, gst_percentage: gst }));
  const b = { date, payment_status: status, ...(mode !== undefined ? { payment_mode: mode } : {}), ...(freight ? { transport_cost: freight } : {}), ...extra };
  return k.name === 'purchase' ? { vendor_id: partyId, state_code: partyId === 2 ? 7 : 9, items: its, ...b } : { select_customer: partyId, invoiceItems: its, ...b };
}
export async function create(k, opts = {}) {
  const r = await call(k.create, 'POST', {}, billBody(k, opts));
  const id = r.body?.purchase?.id ?? r.body?.sale?.id;
  return { r, id };
}
/** Edit lines by product (existing lines keep their line_id; a product left out is removed). */
export async function edit(k, id, { items, status, mode, freight, extra = {} } = {}) {
  const body = { ...extra };
  if (items) {
    const have = lines(k, id);
    const its = items.map(([product_id, qty, rate, gst]) => { const l = have.find(x => x.product_id === product_id); return { ...(l ? { line_id: l.id, id: l.id } : {}), product_id, qty, rate, gst_percentage: gst }; });
    if (k.name === 'purchase') body.items = its; else body.invoiceItems = its;
  }
  if (status !== undefined) body.payment_status = status;
  if (mode !== undefined) body.payment_mode = mode;
  if (freight !== undefined) body.transport_cost = freight;
  return call(k.one, 'PUT', { id: String(id) }, body);
}
export async function pay(k, amount, list, { mode = 1, type, notes, partyId = 1, date = D(3) } = {}) {
  const body = { [k.who]: partyId, payment_date: date, payment_mode: mode, payment_amount: amount, ...(type ? { payment_type: type } : {}), ...(notes ? { notes } : {}),
    allocations: list.map(([kk, id, amt]) => ({ [kk.payFk]: id, allocated_amount: amt })) };
  const r = await call(k.payCreate, 'POST', {}, body);
  return { r, id: r.body?.data?.payment?.id };
}
export const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(store).map(([t, v]) => [t, Array.isArray(v) ? v.length : 0])));
export const deep = (o, key) => { if (!o || typeof o !== 'object') return undefined; if (key in o) return o[key]; for (const v of Object.values(o)) { const f = deep(v, key); if (f !== undefined) return f; } return undefined; };

// ---- running a scenario: one jest test each
// `open`: a finding waiting for the owner's decision - registered with test.failing, so the run
// stays green while it is open and turns red the day it is fixed (then make it a plain test).
// `known`: assertions an open audit item explains (F-02), reported but not failed.
export function seedStock() { for (const p of store.product) { p.stock = 1000; p.opening_stock = 1000; } store.product.push({ id: 4, product_name: 'Disc Rotor', stock: 1000, opening_stock: 1000, is_active: true, hsn: '8708', gst_percentage: 12, product_category_id: 1, minimum_stock: 0 }); }
export function sc(id, title, fn, { known = [], open = null } = {}) {
  (open ? test.failing : test)(`${id} ${title}${open ? `  [OPEN ${open}]` : ''}`, async () => {
    reset(); seedStock(); stats.failures = [];
    await fn();
    await checkAll(id, known);
    await checkReports(id);
    expect(stats.failures).toEqual([]);
  });
}
export const ex = (id, what, cond, info) => ok(`${id} ${what}`, cond, info);
