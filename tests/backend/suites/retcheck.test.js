// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { customerTransactionHandler as CTH } from '../../../lib/customer-transaction-handler';
const _ex = CTH.executeInTransaction.bind(CTH); CTH.executeInTransaction = async (tx, r) => { if (globalThis.DBG) console.log('OPS', JSON.stringify(r)); return _ex(tx, r); };
const _he = CTH.handleReturnEdit.bind(CTH); CTH.handleReturnEdit = async (p) => { if (globalThis.DBG) console.log('PARAMS', JSON.stringify({ ...p, tx: undefined })); return _he(p); };
import { createSale } from '../../../lib/sale-create';
import { createCustomerReturns, updateSaleReturn, deleteSaleReturn, findSaleReturn, loadSaleReturnDetail, netUnitPrice } from '../../../lib/sale-return';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const err = async (fn, code) => { try { await fn(); return 'no error'; } catch (e) { return e.code === code ? true : (e.code || e.message); } };
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    settings: [{ id: 1, currentfy: 4 }], business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],
    customer_details: [
      { id: 1, billing_name: 'C1', billing_state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 },
      { id: 2, billing_name: 'C2', billing_state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    product: [{ id: 1, product_name: 'P1', stock: 50 }, { id: 2, product_name: 'P2', stock: 50 }],
    invoice: [], invoicex: [], invoiceitems: [], invoice_itemsx: [], bill_tosales: [], bill_tosalesx: [], shipto: [], shiptox: [],
    transport_details: [], transport_detailsx: [], customer_ledger: [], customer_payments: [], customer_payment_allocations: [],
    customer_refund_allocations: [], customer_balance_logs: [], sale_return_items: [], salex_return_items: [], sale_returns: [], salex_returns: [], staff: [], mechanic: []
  });
};
const body = (items, extra = {}) => ({ select_customer: 1, date: '2026-10-02', payment_status: 0, payment_mode: 1, invoiceItems: items, ...extra });
test('sale and Invoice C returns', async () => {
  reset();
  await createSale('sale', body([{ product_id: 1, qty: 2, rate: 100, gst_percentage: 18, discount: 10 }, { product_id: 2, qty: 1, rate: 100, gst_percentage: 18 }]));
  await createSale('salex', body([{ product_id: 2, qty: 3, rate: 40, discount: 6 }]));
  const sl = store.invoiceitems, xl = store.invoice_itemsx;
  ok('fixture: sale and salex line ids collide', sl[0].id === xl[0].id, { sl: sl.map(l => l.id), xl: xl.map(l => l.id) });
  ok('net unit price = rate less discount per unit', netUnitPrice(sl[0]) === 95 && netUnitPrice(xl[0]) === 38, [sl[0], xl[0]]);
  const sid = store.invoice[0].id, xid = store.invoicex[0].id;
  const stock2 = store.product[1].stock;

  ok('kind required when the request names no bill',
    await err(() => createCustomerReturns({ customer_id: 1, items: [{ invoice_item_id: sl[0].id, return_qty: 1 }] }), 'KIND_REQUIRED'));
  ok('price above what it sold for is refused',
    await err(() => createCustomerReturns({ customer_id: 1, items: [{ invoice_item_id: sl[0].id, invoice_type: 'invoice', return_qty: 1, unit_price: 100 }] }), 'PRICE_ABOVE_SALE'));
  ok('another customer\'s bill is refused',
    await err(() => createCustomerReturns({ customer_id: 2, items: [{ invoice_item_id: sl[0].id, invoice_type: 'invoice', return_qty: 1 }] }), 'FOREIGN_BILL'));
  ok('over-return is refused',
    await err(() => createCustomerReturns({ customer_id: 1, items: [{ invoice_item_id: sl[0].id, invoice_type: 'invoice', return_qty: 3 }] }), 'OVER_RETURN'));
  ok('nothing written by refused requests', store.sale_returns.length === 0 && store.salex_returns.length === 0);

  // one request, a sale line and the salex line with the SAME id
  const made = await createCustomerReturns({ customer_id: 1, payment_status: 0, items: [
    { invoice_item_id: sl[0].id, invoice_type: 'invoice', return_qty: 1 },
    { invoice_item_id: xl[0].id, invoice_type: 'invoicex', return_qty: 2 }] });
  const sr = store.sale_returns[0], xr = store.salex_returns[0];
  ok('two returns, one per bill and kind', made.length === 2 && sr && xr && sr.invoice_id === sid && xr.invoicex_id === xid, made);
  const sri = store.sale_return_items[0];
  ok('sale return priced at net 95 with 18% tax (8.55 + 8.55 -> 9 + 9)', sri.unit_price === 95 && sri.tax_amount === 17.1 && sr.total_amount === 95 && sr.total_tax === 18 && sr.refund_amount === 113, { sri, sr });
  ok('salex return at net 38, no tax', store.salex_return_items[0].unit_price === 38 && xr.total_amount === 76 && xr.refund_amount === 76, xr);
  ok('return status by header id: both partial', store.invoice[0].return_status === 1 && store.invoicex[0].return_status === 1);
  ok('stock back: P1 +1, P2 +2', store.product[0].stock === 50 - 2 + 1 && store.product[1].stock === stock2 + 2, store.product);
  ok('pending return: no ledger, no counters', store.customer_ledger.filter(l => /return/.test(l.reference_type || '')).length === 0 && store.customer_details[0].total_refunded === 0);

  ok('ids collide: an id alone is ambiguous', sr.id === xr.id && await err(() => findSaleReturn(sr.id, null), 'AMBIGUOUS_RETURN'), [sr.id, xr.id]);
  const det = await loadSaleReturnDetail(sr.id, 'sale');
  const d0 = det.bills[0].items.find(i => i.invoice_item_id === sl[0].id);
  ok('detail: kind in ids, available excludes this return, tax rate real', d0.id === `invoice-${sl[0].id}` && d0.available_qty === 2 && d0.return_qty === 1 && d0.tax_rate === 18 && det.return.invoice_type === 'invoice', d0);

  // edit: own qty is available again; beyond the line refused
  ok('edit beyond the line refused', await err(() => updateSaleReturn('sale', sr.id, { items: [{ invoice_item_id: sl[0].id, return_qty: 3 }] }), 'OVER_RETURN'));
  ok('edit: a salex line on a sale return refused', await err(() => updateSaleReturn('sale', sr.id, { items: [{ invoice_item_id: sl[0].id, invoice_type: 'invoicex', return_qty: 1 }] }), 'KIND_MISMATCH'));
  await updateSaleReturn('sale', sr.id, { items: [{ invoice_item_id: sl[0].id, return_qty: 2 }, { invoice_item_id: sl[1].id, return_qty: 1 }] });
  ok('edit to the whole bill: status full, stock moved by the difference', store.invoice[0].return_status === 2 && store.product[0].stock === 50 && store.sale_returns[0].refund_amount === 342 && store.sale_returns[0].total_amount === 290, { r: store.sale_returns[0], p: store.product });

  // complete return: counters, then delete reverses exactly
  const c = await createCustomerReturns({ customer_id: 1, invoicex_id: xid, payment_status: 1, items: [{ invoice_item_id: xl[0].id, return_qty: 1 }] });
  const cust = store.customer_details[0];
  ok('complete return: refund counters raised by 38', cust.total_refunded === 38 && cust.total_refund_allocated === 38, cust);
  ok('complete return: CREDIT_NOTE + REFUND with the note number', store.customer_ledger.some(l => l.transaction_type === 'CREDIT_NOTE' && l.reference_no === c[0].return_no) && store.customer_ledger.some(l => l.transaction_type === 'REFUND'), store.customer_ledger);
  ok('invoicex now fully returned', store.invoicex[0].return_status === 2);
  await deleteSaleReturn('salex', c[0].id);
  ok('delete reverses the counters exactly', cust.total_refunded === 0 && cust.total_refund_allocated === 0, cust);
  ok('delete removes its ledger rows and lines; status back to partial', !store.customer_ledger.some(l => l.reference_id === c[0].id && l.reference_type === 'salex_return') && store.salex_returns.length === 1 && store.invoicex[0].return_status === 1, { l: store.customer_ledger, s: store.invoicex[0] });
  ok('delete puts stock back out (salex 2 + sale line 1 still returned)', store.product[1].stock === stock2 + 3, store.product);

  // completed through edit, then deleted
  const pend = await createCustomerReturns({ customer_id: 1, invoicex_id: xid, items: [{ invoice_item_id: xl[0].id, return_qty: 1 }] });
  console.log('pend', pend[0].id, store.salex_returns.map(r=>[r.id,r.payment_status])); await updateSaleReturn('salex', pend[0].id, { payment_status: 1, items: [{ invoice_item_id: xl[0].id, return_qty: 1 }] });
  console.log(store.customer_ledger.slice(-3), store.salex_returns);
  ok('completed by edit: counters raised by 38', store.customer_details[0].total_refunded === 38, { cust: store.customer_details[0], same: cust === store.customer_details[0] });
  ok('completed return can no longer be edited', await err(() => updateSaleReturn('salex', pend[0].id, { items: [{ invoice_item_id: xl[0].id, return_qty: 1 }] }), 'REFUNDED_RETURN_EDIT_BLOCKED'));
  await deleteSaleReturn('salex', pend[0].id);
  ok('delete after edit-completion reverses exactly', cust.total_refunded === 0 && cust.total_refund_allocated === 0, cust);

  // full return of what is left
  reset();
  await createSale('sale', body([{ product_id: 1, qty: 4, rate: 10, gst_percentage: 0 }]));
  const iid = store.invoice[0].id;
  await createCustomerReturns({ customer_id: 1, invoice_id: iid, items: [{ invoice_item_id: store.invoiceitems[0].id, return_qty: 1 }] });
  await createCustomerReturns({ customer_id: 1, invoice_id: iid, return_type: 'full' });
  ok('full return takes only what is left (3)', store.sale_return_items[1].return_qty === 3 && store.invoice[0].return_status === 2, store.sale_return_items);
  ok('nothing left: a second full return is refused', await err(() => createCustomerReturns({ customer_id: 1, invoice_id: iid, return_type: 'full' }), 'VALIDATION'));
  expect(FAILED).toEqual([]);
}, 170000);
