// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { createSale } from '../../../lib/sale-create';
import { updateSale } from '../../../lib/sale-edit';
import { deleteSale } from '../../../lib/sale-delete';
import { loadSaleDetail } from '../../../lib/sale-read';
import { computeBill, roundRupee } from '../../../lib/line-math';
import { computePurchaseTotals } from '../../../lib/purchase';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }],
    business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],
    customer_details: [
      { id: 1, billing_name: 'Master Name', billing_address: 'M addr', billing_state: 'UP', billing_state_code: 9, contact_no: '999', total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
      { id: 2, billing_name: 'Delhi Co', billing_address: 'D', billing_state: 'DL', billing_state_code: 7, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    product: [{ id: 1, product_name: 'P1', stock: 50, product_category_id: 3, hsn: 'H1', company_id: 5 }, { id: 2, product_name: 'P2', stock: 1, product_category_id: 4, hsn: 'H2' }],
    invoice: [], invoicex: [], invoiceitems: [], invoice_itemsx: [], bill_tosales: [], bill_tosalesx: [], shipto: [], shiptox: [],
    transport_details: [], transport_detailsx: [], customer_ledger: [], customer_payments: [], customer_payment_allocations: [],
    customer_balance_logs: [], sale_return_items: [], salex_return_items: [], sale_returns: [], salex_returns: [], staff: [{ id: 3, name: 'S' }], mechanic: [],
  });
};
const err = async (fn, code) => { try { await fn(); return 'no error'; } catch (e) { return e.code === code ? true : (e.code || e.message); } };
const saleBody = (extra = {}) => ({
  select_customer: 1, date: '2026-10-02', fy: 2026, payment_status: 0, payment_mode: 1, transport_cost: 30,
  packing_forwarding_qty: 1, packing_forwarding_rate: 50, total: 1, total_tax: 999, total_cgst: 5,
  invoiceItems: [
    { product_id: 1, qty: 2, rate: 100, gst_percentage: 18, discount: 10, cgst: 1, tax: 1, product_name: 'HACK' },
    { product_id: 1, qty: 1, rate: 100, gst_percentage: 18 }],
  ...extra
});
test('sale create / edit / delete', async () => {
  // ---- line-math rounding (F-34)
  const b = computeBill([{ qty: 1, rate: 125, gst_percentage: 20 }], { supplyType: 'INTRA_STATE' });
  ok('F-34: CGST/SGST 12.5 each round half up to 13', b.totalCgst === 13 && b.totalSgst === 13 && b.totalTax === 26 && b.grandTotal === 151, b);
  const b2 = computeBill([{ qty: 3, rate: 33.33, gst_percentage: 18 }], { supplyType: 'INTER_STATE', packingTotal: 0.4 });
  ok('F-34: IGST rounded, line keeps paise, grand to rupee', b2.lines[0].taxable === 99.99 && b2.lines[0].tax === 18 && b2.totalIgst === 18 && b2.grandTotal === 118, b2);
  ok('roundRupee half up', roundRupee(10.5) === 11 && roundRupee(10.49) === 10 && roundRupee(-2.5) === -3);
  const pt = computePurchaseTotals({ items: [{ product_id: 1, qty: 1, rate: 125, gst_percentage: 20 }], packingQty: 0, packingRate: 0, vendorStateCode: 9, businessGstin: '09ABCDE1234F1Z5', hasVendorState: true });
  ok('purchase rounds the same way (sync)', pt.totalCgst === 13 && pt.totalTax === 26 && pt.grandTotal === 151, pt);

  // ---- create sale
  reset();
  const r = await createSale('sale', saleBody());
  const h = store.invoice[0];
  ok('SA-04: fy is the current FY, not the body', h.fy === 4, h);
  ok('SA-07: discount taken off', h.items_total === 290 && h.discount === 10, h);
  ok('SA-09: tax computed (34.2+18 -> CGST 26, SGST 26)', h.total_cgst === 26 && h.total_sgst === 26 && h.total_igst === 0 && h.total_tax === 52, h);
  ok('freight + P&F in the sale total, rounded', h.total === 422 && r.total === 422 && h.freight === 30 && h.packing_forwarding_total === 50, h);
  const ls = store.invoiceitems;
  ok('lines from server: name from product, tax, subtotal net', ls.length === 2 && ls[0].name_of_product === 'P1' && near(ls[0].tax, 34.2) && ls[0].subtotal === 190 && ls[0].discount === 10 && ls[0].invoice_no === h.id, ls);
  ok('stock down by 3', store.product[0].stock === 47, store.product[0]);
  ok('ledger SALE debit 422 labelled sale', store.customer_ledger.length === 1 && store.customer_ledger[0].debit === 422 && store.customer_ledger[0].reference_type === 'sale', store.customer_ledger);
  ok('snapshot from master when not sent', store.bill_tosales[0].billing_name === 'Master Name' && store.bill_tosales[0].billing_state_code === 9, store.bill_tosales[0]);

  // inter-state customer -> IGST
  reset();
  await createSale('sale', saleBody({ select_customer: 2, invoiceItems: [{ product_id: 1, qty: 1, rate: 100, gst_percentage: 18 }], transport_cost: 0, packing_forwarding_qty: 0 }));
  ok('inter-state: IGST', store.invoice[0].total_igst === 18 && store.invoice[0].total_cgst === 0 && store.invoice[0].total === 118, store.invoice[0]);

  // refusals
  reset();
  ok('SA-14: two lines over stock refused', await err(() => createSale('sale', saleBody({ invoiceItems: [{ product_id: 2, qty: 1, rate: 1 }, { product_id: 2, qty: 1, rate: 1 }] })), 'INSUFFICIENT_STOCK') === true);
  ok('SA-15: Partial on create refused', await err(() => createSale('sale', saleBody({ payment_status: 2 })), 'VALIDATION') === true);
  ok('negative qty refused', await err(() => createSale('sale', saleBody({ invoiceItems: [{ product_id: 1, qty: -2, rate: 1 }] })), 'VALIDATION') === true);
  ok('SA-22: unknown customer refused', await err(() => createSale('salex', saleBody({ select_customer: 99 })), 'VALIDATION') === true);
  ok('Other needs a name and phone', await err(() => createSale('sale', saleBody({ select_customer: 0 })), 'VALIDATION') === true);
  ok('discount above line refused', await err(() => createSale('sale', saleBody({ invoiceItems: [{ product_id: 1, qty: 1, rate: 10, discount: 11 }] })), 'VALIDATION') === true);
  ok('nothing written by refusals', store.invoice.length === 0 && store.product[1].stock === 1);

  // ---- create salex: no tax, discount kept, server totals
  reset();
  await createSale('salex', saleBody({ freight: 5, transport_cost: undefined, items_total: 1, total_taxable_value: 1 }));
  const x = store.invoicex[0];
  ok('SA-06: salex amounts from server, GST forced 0', x.total_tax === 0 && x.items_total === 290 && x.total === 345 && x.discount === 10, x);
  ok('salex lines tax-free', store.invoice_itemsx.every(l => l.tax === 0 && l.gst_percentage === 0), store.invoice_itemsx);
  ok('salex ledger labelled salex', store.customer_ledger[0].reference_type === 'salex', store.customer_ledger);

  // ---- paid with advance
  reset();
  store.customer_details[0].total_paid = 100;
  await createSale('salex', saleBody({ payment_status: 1, invoiceItems: [{ product_id: 1, qty: 1, rate: 400 }], transport_cost: 0, packing_forwarding_qty: 0 }));
  const al = store.customer_payment_allocations;
  ok('paid: advance 100 + new 300, on invoicex', al.length === 2 && al.every(a => a.invoicex_id === store.invoicex[0].id && !a.invoice_id) && al.map(a => a.allocated_amount).sort((a, b) => a - b).join() === '100,300', al);
  const pay = store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED');
  ok('paid: PAYMENT_RECEIVED credit 300', pay && pay.credit === 300 && pay.debit === 0 && pay.reference_type === 'salex', pay);
  ok('paid: counters', store.customer_details[0].total_paid === 400 && store.customer_details[0].total_allocated === 400, store.customer_details[0]);

  // ---- edit
  reset();
  await createSale('sale', saleBody({ notes: 'keep', bill_reference: 'BR1' }));
  const id = store.invoice[0].id;
  const [l1, l2] = store.invoiceitems;
  ok('SA-11: customer change refused', await err(() => updateSale('sale', id, { select_customer: 2 }), 'CUSTOMER_CHANGE_NOT_ALLOWED') === true);
  ok('resent Partial ignored, no error', (await err(() => updateSale('sale', id, { payment_status: 2 }), 'X')) === 'no error');
  await updateSale('sale', id, { invoiceItems: [
    { line_id: l1.id, product_id: 1, qty: 2, rate: 120, gst_percentage: 18, discount: 10 },
    { line_id: l2.id, product_id: 1, qty: 1, rate: 100, gst_percentage: 18 }] });
  const e1 = store.invoiceitems.find(l => l.id === l1.id);
  ok('SA-13: rate-only edit saved', e1.rate === 120 && e1.subtotal === 230 && e1.discount === 10, e1);
  const eh = store.invoice[0];
  ok('header recomputed (230+100 taxable)', eh.items_total === 330 && eh.total === roundRupee(330 + 50 + 30 + 30 + 30), eh);
  ok('absent fields kept', eh.notes === 'keep' && eh.bill_reference === 'BR1' && eh.freight === 30, eh);
  ok('stock unchanged by rate edit', store.product[0].stock === 47, store.product[0]);
  ok('ledger SALE updated to new total', store.customer_ledger.find(l => l.transaction_type === 'SALE').debit === eh.total, store.customer_ledger);

  // edit with no items keeps lines and money
  const before = store.invoice[0].total;
  await updateSale('sale', id, { notes: 'n2' });
  ok('no items sent: lines and total kept', store.invoiceitems.length === 2 && store.invoice[0].total === before && store.invoice[0].notes === 'n2', store.invoice[0]);

  // qty increase beyond stock
  ok('edit over stock refused', await err(() => updateSale('sale', id, { invoiceItems: [{ line_id: l1.id, product_id: 1, qty: 100, rate: 1 }, { line_id: l2.id, product_id: 1, qty: 1, rate: 1 }] }), 'INSUFFICIENT_STOCK') === true);

  // returns guard
  store.sale_return_items.push({ id: 1, invoice_item_id: l2.id, return_qty: 1, sale_return_id: 1 });
  ok('remove a returned line refused', await err(() => updateSale('sale', id, { invoiceItems: [{ line_id: l1.id, product_id: 1, qty: 2, rate: 120 }] }), 'CANNOT_DELETE_RETURNED_ITEM') === true);
  store.sale_return_items.length = 0;

  // remove a line restores stock; add a new product
  await updateSale('sale', id, { date: '2026-10-05', invoiceItems: [{ line_id: l1.id, product_id: 1, qty: 2, rate: 120, gst_percentage: 18, discount: 10 }, { product_id: 2, qty: 1, rate: 50 }] });
  ok('line removed + P2 added: stock', store.product[0].stock === 48 && store.product[1].stock === 0, store.product);
  const newLine = store.invoiceitems.find(l => l.product_id === 2);
  ok('new line keyed by header id with existing fy', newLine && newLine.invoice_no === id && newLine.fy === 4 && newLine.name_of_product === 'P2', newLine);
  ok('date moves header and lines', store.invoiceitems.every(l => l.invoice_date === store.invoice[0].invoice_date), store.invoiceitems);

  // ---- salex edit keeps discount (SA-10)
  reset();
  await createSale('salex', saleBody({ transport_cost: 0, packing_forwarding_qty: 0 }));
  const xid = store.invoicex[0].id;
  const xl = store.invoice_itemsx;
  await updateSale('salex', xid, { invoiceItems: [{ line_id: xl[0].id, product_id: 1, qty: 3, rate: 100, discount: 10 }, { line_id: xl[1].id, product_id: 1, qty: 1, rate: 100 }] });
  ok('SA-10: salex discount survives edit', store.invoicex[0].items_total === 390 && store.invoicex[0].discount === 10 && store.invoice_itemsx[0].discount === 10, store.invoicex[0]);

  // ---- 0 -> 1 on edit (registered) allocates to the right table
  await updateSale('salex', xid, { payment_status: 1, payment_mode: 0 });
  ok('salex marked paid on edit: allocation on invoicex', store.customer_payment_allocations.length === 1 && store.customer_payment_allocations[0].invoicex_id === xid && !store.customer_payment_allocations[0].invoice_id, store.customer_payment_allocations);
  const pr = store.customer_ledger.find(l => l.transaction_type === 'PAYMENT_RECEIVED');
  ok('... and credits the customer', pr && pr.credit === store.invoicex[0].total && pr.debit === 0 && pr.reference_type === 'salex', pr);
  await updateSale('salex', xid, { payment_status: 0 });
  ok('unmark: allocation removed (SA-02)', store.customer_payment_allocations.length === 0, store.customer_payment_allocations);

  // ---- read
  reset();
  await createSale('sale', saleBody({ customer_name: 'Bill Name', address_2: 'Line 2' }));
  store.customer_details[0].billing_name = 'Renamed Later';
  const d = await loadSaleDetail('sale', store.invoice[0].id);
  ok('SA-21: snapshot name, not the master', d.customer_name === 'Bill Name' && d.customer.billing_name === 'Bill Name' && d.address_2 === 'Line 2', d.customer);
  ok('SA-05: id returned', d.id === store.invoice[0].id);
  ok('lines carry line_id', d.items.every(i => i.line_id === i.id), d.items);

  // ---- delete
  store.sale_returns.push({ id: 1, invoice_id: store.invoice[0].id });
  ok('delete with returns refused', await err(() => deleteSale('sale', store.invoice[0].id), 'HAS_RETURNS') === true);
  reset();
  await createSale('sale', saleBody({ select_customer: 0, customer_name: 'Walk in', contact_number: '1' }));
  ok('Other: no ledger', store.customer_ledger.length === 0);
  await deleteSale('sale', store.invoice[0].id);
  ok('Other delete: stock back, rows gone', store.product[0].stock === 50 && store.invoice.length === 0 && store.invoiceitems.length === 0 && store.bill_tosales.length === 0, store);
  expect(FAILED).toEqual([]);
}, 170000);
