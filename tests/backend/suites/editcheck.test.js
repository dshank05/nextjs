// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { updatePurchase } from '../../../lib/purchase-edit';
import { loadPurchaseDetail } from '../../../lib/purchase-read';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    business_details: [{ id: 1, gstin: '09ABCDE1234F1Z5' }],              // business in state 09
    vendor_details: [{ id: 1, vendor_name: 'V', state_code: 9, total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }],
    product: [{ id: 1, product_name: 'P1', stock: 50, product_category_id: 3, hsn: 'H1' }, { id: 2, product_name: 'P2', stock: 50, product_category_id: 4, hsn: 'H2' }],
    purchase: [{ id: 7, invoice_no: 12, fy: 4, vendor_id: 1, payment_status: 0, payment_mode: 0, total: 236, invoice_date: 1000, return_status: 0,
      notes: 'keep me', descriptions: 'desc', transport_name: 'T', freight: 30, packing_forwarding_qty: 0, packing_forwarding_rate: 0, bill_reference: 'BR' }],
    purchaseitems: [
      { id: 101, purchase_id: 7, invoice_no: 12, fy: 4, product_id: 1, qty: 1, rate: 100, gst_percentage: 18, name_of_product: 'P1', company_id: 5, model_id: 6, car_model: 'Alto', part: 'A1', invoice_date: 1000, subtotal: 100 },
      { id: 102, purchase_id: 7, invoice_no: 12, fy: 4, product_id: 1, qty: 1, rate: 100, gst_percentage: 0, name_of_product: 'P1', company_id: 5, model_id: 6, car_model: 'Alto', part: 'A1', invoice_date: 1000, subtotal: 100 },
      { id: 900, purchase_id: 99, invoice_no: 12, fy: 3, product_id: 2, qty: 9, rate: 1, name_of_product: 'P2', invoice_date: 1, subtotal: 9 }, // other year, same number
    ],
    bill_to: [{ id: 1, purchase_id: 7, invoice_no: 12, fy: 4, vendor_name: 'V', state_code: 9, pin_code: '201301' }],
    payment_allocations: [], purchase_return_items: [], vendor_ledger: [],
  });
};
const lines = () => store.purchaseitems.filter(l => l.purchase_id === 7).sort((a, b) => a.id - b.id);
const expectErr = async (body, code) => { try { await updatePurchase(7, body); return 'no error'; } catch (e) { return e.code === code ? true : e.code || e.message; } };
test('purchase edit totals and ledger', async () => {
  // 1. Two lines of one product: edit the SECOND by line_id (was refused, L-24)
  reset();
  await updatePurchase(7, { items: [
    { line_id: 101, product_id: 1, qty: 1, rate: 100, gst_percentage: 18 },
    { line_id: 102, product_id: 1, qty: 4, rate: 100, gst_percentage: 0 } ] });
  ok('dup product: second line qty saved', lines().find(l => l.id === 102).qty === 4, lines());
  ok('dup product: stock +3 only', store.product[0].stock === 53, store.product[0]);
  ok('other FY line untouched', store.purchaseitems.find(l => l.id === 900).qty === 9);

  // 2. GST-only change is saved on the line, header matches lines (PU-14)
  reset();
  await updatePurchase(7, { items: [
    { line_id: 101, product_id: 1, qty: 1, rate: 100, gst_percentage: 28 },
    { line_id: 102, product_id: 1, qty: 1, rate: 100, gst_percentage: 0 } ] });
  const l101 = lines()[0], h = store.purchase[0];
  ok('GST% saved on line', l101.gst_percentage === 28 && Math.abs(l101.tax - 28) < 1e-9 && Math.abs(l101.cgst - 14) < 1e-9, l101);
  ok('header tax = sum of lines', Math.abs(h.total_tax - lines().reduce((s, l) => s + l.tax, 0)) < 1e-9 && h.total === 258, h); // 228 + stored freight 30 (BILLS_PLAN Q1: freight in the total)

  // 3. company / model / part edits saved (PU-15); 4. date moves the lines (PU-16)
  reset();
  await updatePurchase(7, { date: 2000, items: [
    { line_id: 101, product_id: 1, qty: 1, rate: 100, gst_percentage: 18, company_id: 8, model_id: 9, car_model: 'Swift', part: 'B2' },
    { line_id: 102, product_id: 1, qty: 1, rate: 100, gst_percentage: 0 } ] });
  const e = lines()[0];
  ok('company/model/part saved', e.company_id === 8 && e.model_id === 9 && e.car_model === 'Swift' && e.part === 'B2', e);
  ok('untouched line keeps its model', lines()[1].car_model === 'Alto' && lines()[1].company_id === 5, lines()[1]);
  ok('bill date on every line', lines().every(l => l.invoice_date === 2000) && store.purchase[0].invoice_date === 2000, lines());

  // 5. absent fields keep stored values (PU-19)
  reset();
  await updatePurchase(7, { notes: 'new note' });
  const k = store.purchase[0];
  ok('absent fields kept', k.descriptions === 'desc' && k.transport_name === 'T' && k.freight === 30 && k.bill_reference === 'BR' && k.payment_status === 0, k);
  ok('sent field saved', k.notes === 'new note');
  ok('no items sent: lines kept', lines().length === 2 && store.product[0].stock === 50, lines());
  ok('bill_to pin kept', store.bill_to[0].pin_code === '201301', store.bill_to[0]);

  // 6. a part-paid bill resent with status 2 saves (PU-35) and stays 2
  reset();
  store.purchase[0].payment_status = 2; store.payment_allocations = [{ id: 1, purchase_id: 7, allocated_amount: 50, payment_id: 1 }];
  const r6 = await expectErr({ payment_status: 2, notes: 'x' }, 'none');
  ok('part-paid edit accepted', r6 === 'no error', r6);
  ok('status stays partial', store.purchase[0].payment_status === 2, store.purchase[0]);

  // 7. qty below returned is refused; removing a returned line is refused
  reset();
  store.purchase_return_items = [{ id: 1, purchase_item_id: 101, return_qty: 1 }];
  ok('qty below returned refused', (await expectErr({ items: [{ line_id: 101, product_id: 1, qty: 0.4, rate: 100 }, { line_id: 102, product_id: 1, qty: 1, rate: 100 }] }, 'VALIDATION')) === true);
  ok('returned line removal refused', (await expectErr({ items: [{ line_id: 102, product_id: 1, qty: 1, rate: 100 }] }, 'CANNOT_DELETE_RETURNED_ITEM')) === true);

  // 8. tax split from the bill's own state (PU-18): master 09, bill 27 -> IGST
  reset();
  store.bill_to[0].state_code = 27;
  await updatePurchase(7, { notes: 'y' });
  ok('IGST from bill state', store.purchase[0].total_igst > 0 && store.purchase[0].total_cgst === 0, store.purchase[0]);

  // 9. new duplicate lines in one payload: both stored, stock for both (PU-17)
  reset();
  await updatePurchase(7, { items: [
    { line_id: 101, product_id: 1, qty: 1, rate: 100, gst_percentage: 18 },
    { line_id: 102, product_id: 1, qty: 1, rate: 100, gst_percentage: 0 },
    { product_id: 2, qty: 2, rate: 10 }, { product_id: 2, qty: 3, rate: 12 } ] });
  ok('both new lines stored', lines().filter(l => l.product_id === 2).length === 2, lines());
  ok('stock for both', store.product[1].stock === 55, store.product[1]);
  ok('new line fields from product', lines().filter(l => l.product_id === 2).every(l => l.name_of_product === 'P2' && l.category_id === 4 && l.purchase_id === 7 && l.fy === 4 && l.invoice_no === 12), lines());

  // 10. removing a line takes its stock out; foreign line id refused
  reset();
  await updatePurchase(7, { items: [{ line_id: 101, product_id: 1, qty: 1, rate: 100, gst_percentage: 18 }] });
  ok('removed line deleted + stock -1', lines().length === 1 && store.product[0].stock === 49, [lines(), store.product[0]]);
  reset();
  ok('foreign line_id refused', (await expectErr({ items: [{ line_id: 900, product_id: 2, qty: 1, rate: 1 }] }, 'FOREIGN_LINE')) === true);
  ok('vendor change refused', (await expectErr({ vendor_id: 2 }, 'VENDOR_CHANGE_NOT_ALLOWED')) === true);

  // GET loader
  reset();
  store.purchase_return_items = [{ id: 1, purchase_item_id: 101, purchase_return_id: 4, return_qty: 1, unit_price: 100, purchase_return: { id: 4, return_date: 5, status: 1 } }];
  store.purchase_returns = [{ id: 4, total_amount: 100 }];
  const d = await loadPurchaseDetail(7);
  ok('GET: lines carry line_id', d.items.map(i => i.line_id).join() === '101,102', d.items);
  ok('GET: return counted once, one bill', d.returns.length === 1 && d.returns[0].total_bills_count === 1, d.returns);
  ok('GET: line 101 fully returned', d.items[0].is_fully_returned === true && d.return_status.status === 'PARTIAL_RETURN', d.return_status);
  store.purchaseitems = []; const empty = await loadPurchaseDetail(7);
  ok('GET: no lines is not fully returned', empty.return_status.is_fully_returned === false, empty.return_status);
  expect(FAILED).toEqual([]);
}, 170000);
