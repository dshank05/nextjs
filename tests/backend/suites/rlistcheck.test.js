// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import saleList from '../../../pages/api/sale-returns/index';
import saleOne from '../../../pages/api/sale-returns/[id]';
import saleCreate from '../../../pages/api/sale-returns/customer-return';
import purList from '../../../pages/api/purchase-returns/index';
import purOne from '../../../pages/api/purchase-returns/[id]';
import purCreate from '../../../pages/api/purchase-returns/vendor-return';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const call = async (h, method, query, body) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; }, setHeader() {}, end() { return res; } }; await h({ method, query, body, headers: {} }, res); return { status, body: out }; };
const D = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d, 6) / 1000);
const ids = (r) => r.body.returns.map(x => `${x.invoice_type || 'p'}-${x.id}`).join(',');
test('returns lists', async () => {
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], note_counters: [], financial_year: [{ id: 4, fy: '2026-27' }],
    customer_details: [{ id: 1, billing_name: 'Ravi Motors', billing_gstin: 'G1', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
                       { id: 2, billing_name: 'Kumar Auto', billing_gstin: 'G2', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    invoice: [{ id: 1, invoice_no: 101, select_customer: 1, return_status: 0 }, { id: 2, invoice_no: 205, select_customer: 2, return_status: 0 }],
    invoicex: [{ id: 1, invoice_no: 7, select_customer: 1, return_status: 0 }],
    invoiceitems: [{ id: 1, invoice_no: 1, product_id: 1, qty: 5, rate: 100, discount: 0, gst_percentage: 18, igst: 0, name_of_product: 'Pad' },
                   { id: 2, invoice_no: 2, product_id: 1, qty: 5, rate: 100, discount: 0, gst_percentage: 18, igst: 0, name_of_product: 'Pad' }],
    invoice_itemsx: [{ id: 1, invoice_no: 1, product_id: 1, qty: 5, rate: 50, discount: 0, gst_percentage: 0, igst: 0, name_of_product: 'Pad' }],
    sale_returns: [
      { id: 1, invoice_id: 1, return_date: D(2026, 10, 1), total_amount: 100, total_tax: 18, refund_amount: 118, status: 'Pending', payment_status: 1, payment_mode: 0, notes: 'ok', fy: 4 },
      { id: 2, invoice_id: 2, return_date: D(2026, 10, 2), total_amount: 200, total_tax: 36, refund_amount: 236, status: 'Pending', payment_status: 0, payment_mode: 1, notes: '', fy: 4 }],
    salex_returns: [{ id: 1, invoicex_id: 1, return_date: D(2026, 10, 3), total_amount: 50, refund_amount: 50, status: 'Pending', payment_status: 0, payment_mode: 1, notes: '', fy: 4 }],
    sale_return_items: [{ id: 1, sale_return_id: 1, invoice_item_id: 1, return_qty: 1, unit_price: 100, tax_amount: 18, return_reason_id: 1, notes: '' },
                        { id: 2, sale_return_id: 2, invoice_item_id: 2, return_qty: 2, unit_price: 100, tax_amount: 36, return_reason_id: 1, notes: '' }],
    salex_return_items: [{ id: 1, salex_return_id: 1, invoice_itemx_id: 1, return_qty: 1, unit_price: 50, return_reason_id: 1, notes: '' }],
    return_reasons: [{ id: 1, reason_name: 'Damaged' }],
    product: [{ id: 1, product_name: 'Pad', display_name: 'Pad', part_no: 'P1', stock: 50 }],
    vendor_details: [{ id: 1, vendor_name: 'Bosch India', tax_id: 'VG', address: 'Agra', state_code: 9, contact_no: '9', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
                     { id: 2, vendor_name: 'Lumax', tax_id: '', address: '', state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    purchase: [{ id: 1, vendor_id: 1, invoice_no: 501, invoice_date: D(2026, 9, 1), bill_reference: 'BREF-501', total: 1000, return_status: 0 },
               { id: 2, vendor_id: 2, invoice_no: 502, invoice_date: D(2026, 9, 2), bill_reference: '', total: 500, return_status: 0 }],
    purchaseitems: [{ id: 10, purchase_id: 1, product_id: 1, qty: 3, rate: 100, gst_percentage: 18, igst: 0, name_of_product: 'Pad' },
                    { id: 11, purchase_id: 1, product_id: 1, qty: 4, rate: 50, gst_percentage: 18, igst: 0, name_of_product: 'Pad' },
                    { id: 12, purchase_id: 2, product_id: 1, qty: 2, rate: 10, gst_percentage: 0, igst: 0, name_of_product: 'Pad' }],
    purchase_returns: [], purchase_return_items: [], vendor_ledger: [], vendor_balance_logs: [], refund_allocations: [], vendor_refunds: [],
    customer_ledger: [], customer_balance_logs: [], customer_refund_allocations: []
  });

  // ---------------- sale list
  let r = await call(saleList, 'GET', { status: 'Completed' });
  ok('sale list: "Complete" filter finds the refunded return (status column was never updated)', r.status === 200 && ids(r) === 'invoice-1', r.body);
  r = await call(saleList, 'GET', { status: '0', sortBy: 'return_date', sortOrder: 'asc' });
  ok('sale list: pending refund = the two unrefunded', ids(r) === 'invoice-2,invoicex-1', ids(r));
  r = await call(saleList, 'GET', { customer: 'kumar', search: 'kumar' });
  ok('sale list: customer name finds its return (search was notes-only)', ids(r) === 'invoice-2', r.body);
  r = await call(saleList, 'GET', { uid: '205' });
  ok('sale list: invoice number filter matches the bill, not the return id', ids(r) === 'invoice-2', ids(r));
  r = await call(saleList, 'GET', { itemCount: '1', paymentMode: '0' });
  ok('sale list: items qty and payment mode are applied', ids(r) === 'invoice-1', ids(r));
  r = await call(saleList, 'GET', { search: 'SXR-001' });
  ok('sale list: SXR-001 finds the Invoice C return only', ids(r) === 'invoicex-1', ids(r));
  r = await call(saleList, 'GET', { sortBy: 'invoice_no', sortOrder: 'asc' });
  ok('sale list: sorts by invoice number (fell back to date)', r.body.returns.map(x => x.invoice_no).join(',') === '7,101,205', r.body.returns.map(x => x.invoice_no));
  r = await call(saleList, 'GET', { customer_id: '1', limit: '1000' });
  ok('sale list: customer id (Pending-returns hint) - both kinds, rows keep refund_amount', ids(r).split(',').sort().join() === 'invoice-1,invoicex-1' && r.body.returns.every(x => x.refund_amount > 0), r.body);
  r = await call(saleList, 'GET', { customer: '1', limit: '1000' });
  ok('sale list: a number typed in the customer NAME box is a name, not an id (D-18)', r.body.returns.length === 0, r.body);
  r = await call(saleList, 'GET', { dateFrom: '2026-10-02' });
  ok('sale list: a range with only a start works', r.body.pagination.total === 2, r.body.pagination);

  // ---------------- sale payment date from the form
  r = await call(saleOne, 'PUT', { id: '2', type: 'invoice' }, { invoice_type: 'invoice', return_date: '2026-10-02', return_notes: 'kept', payment_status: 1, payment_mode: 0, payment_date: '2026-10-05',
    items: [{ invoice_item_id: 2, invoice_type: 'invoice', return_qty: 2, return_reason_id: 1, notes: 'line note' }] });
  const s2 = store.sale_returns.find(x => x.id === 2);
  ok('sale edit: payment date "2026-10-05" stored as that day (was 2026 = Jan 1970)', r.status === 200 && s2.payment_date > 1790000000 && new Date(s2.payment_date * 1000).toISOString().startsWith('2026-10-0'), { r: r.body, s2 });
  ok('sale edit: notes and line note kept', s2.notes === 'kept' && store.sale_return_items.some(i => i.sale_return_id === 2 && i.notes === 'line note'), store.sale_return_items);

  // ---------------- purchase create / detail / edit
  r = await call(purCreate, 'POST', {}, { vendor_id: 1, return_date: '2026-10-03', return_notes: 'first', payment_status: 0, payment_mode: 1,
    items: [{ purchase_item_id: 10, return_qty: 3, return_reason_id: 1, notes: 'n10' }] });
  const pA = r.body?.data?.return?.id;
  ok('purchase create', r.status === 201 && pA, r.body);
  r = await call(purCreate, 'POST', {}, { vendor_id: 1, return_date: '2026-10-04', payment_status: 1, payment_mode: 0, payment_date: '2026-10-06',
    items: [{ purchase_item_id: 11, return_qty: 1, return_reason_id: 1 }] });
  const pB = r.body?.data?.return?.id;
  const rb = store.purchase_returns.find(x => x.id === pB);
  ok('purchase create complete: payment date is the one sent (was the return date)', r.status === 201 && new Date(rb.payment_date * 1000).toISOString().startsWith('2026-10-0') && rb.payment_date !== rb.return_date, rb);

  r = await call(purOne, 'GET', { id: String(pA) });
  const bill = r.body?.data?.bills?.[0];
  const l10 = bill?.items.find(i => i.purchase_item_id === 10), l11 = bill?.items.find(i => i.purchase_item_id === 11);
  ok('purchase detail: own line keeps its 3 available (edit could not keep it)', l10 && l10.available_qty === 3 && l10.return_qty === 3, l10);
  ok('purchase detail: other line counts the other return (showed all 4)', l11 && l11.available_qty === 3 && l11.already_returned === 1, l11);
  ok('purchase detail: bill reference is the bill\'s own (repeated the number)', bill?.bill_reference === 'BREF-501' && bill?.invoice_no === '501', bill);
  ok('purchase detail: stored tax split and line note shown', l10.cgst === 27 && l10.sgst === 27 && l10.notes === 'n10', l10);

  r = await call(purOne, 'PUT', { id: String(pA) }, { return_date: '2026-10-03', return_notes: 'edited', payment_status: 0, payment_mode: 1,
    items: [{ purchase_item_id: 10, return_qty: 3, return_reason_id: 1, notes: 'n10' }] });
  const ra = store.purchase_returns.find(x => x.id === pA);
  ok('purchase edit: return_notes saved (the route read `notes` and blanked it)', r.status === 200 && ra.notes === 'edited', { r: r.body, ra });
  ok('purchase edit: same quantity kept, line note kept', store.purchase_return_items.some(i => i.purchase_return_id === pA && i.return_qty === 3 && i.notes === 'n10'), store.purchase_return_items);

  // ---------------- purchase list
  r = await call(purList, 'GET', { vendor: '1', sortBy: 'return_no', sortOrder: 'asc' });
  ok('purchase list: vendor id, sorted by return no', r.status === 200 && r.body.returns.map(x => x.id).join() === `${pA},${pB}`, r.body);
  ok('purchase list: invoice no, items, P/F, debit note', r.body.returns[0].invoice_no === '501' && r.body.returns[0].item_count === 1 && 'packing_forwarding_total' in r.body.returns[0] && r.body.returns[0].debit_note_no, r.body.returns[0]);
  r = await call(purList, 'GET', { status: '1' });
  ok('purchase list: status 1 = refunded', r.body.returns.map(x => x.id).join() === String(pB), r.body.returns);
  r = await call(purList, 'GET', { search: 'bosch' });
  ok('purchase list: vendor name search', r.body.pagination.total === 2, r.body.pagination);
  r = await call(purList, 'GET', { search: `PR-${String(pB).padStart(3, '0')}` });
  ok('purchase list: PR-n search', r.body.returns.length === 1 && r.body.returns[0].id === pB, r.body.returns);
  r = await call(purList, 'GET', { uid: '502' });
  ok('purchase list: invoice filter, nothing on 502', r.body.pagination.total === 0, r.body.pagination);

  r = await call(purOne, 'DELETE', { id: String(pA) });
  ok('purchase delete', r.status === 200 && !store.purchase_returns.some(x => x.id === pA), r.body);
  expect(FAILED).toEqual([]);
}, 170000);
