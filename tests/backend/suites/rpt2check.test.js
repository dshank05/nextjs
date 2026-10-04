// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { installSqlMirror } from '../support/sqlmirror.js';
import { returnRegister } from '../../../lib/return-register';
import { gstReport } from '../../../lib/gst-report';
import { cashBook } from '../../../lib/cash-book';
import { profitReport } from '../../../lib/profit-report';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const D = (y, m, d, h = 12) => Math.floor(Date.UTC(y, m - 1, d, h) / 1000) - 19800;
test('GST, cash book, profit, returns register', async () => {
  Object.assign(store, {
    customer_details: [{ id: 1, billing_name: 'Ravi' }],
    vendor_details: [{ id: 1, vendor_name: 'Bosch' }],
    product: [{ id: 1, product_name: 'Pad', display_name: 'Pad', latest_purchase_rate: 60, opening_rate: 40 }, { id: 2, product_name: 'Disc', display_name: 'Disc', latest_purchase_rate: 0, opening_rate: 300 }],
    invoice: [
      { id: 1, invoice_no: 1, select_customer: 1, invoice_date: D(2026, 10, 3), total: 236, total_taxable_value: 200, total_tax: 36, total_cgst: 18, total_sgst: 18, total_igst: 0, payment_mode: 0 },
      { id: 2, invoice_no: 2, select_customer: 1, invoice_date: D(2026, 10, 9), total: 118, total_taxable_value: 100, total_tax: 18, total_cgst: 0, total_sgst: 0, total_igst: 18, payment_mode: 1 }],
    bill_tosales: [{ id: 1, invoice_no: 1, billing_gstin: '09AAAA' }, { id: 2, invoice_no: 2, billing_gstin: '' }],
    invoice_items: [
      { id: 1, invoice_no: 1, product_id: 1, qty: 2, subtotal: 200, gst_percentage: 18, cgst: 18, sgst: 18, igst: 0, hsn: '8708' },
      { id: 2, invoice_no: 2, product_id: 2, qty: 1, subtotal: 100, gst_percentage: 18, cgst: 0, sgst: 0, igst: 18, hsn: '8708' }],
    invoicex: [{ id: 1, invoice_no: 1, select_customer: 1, invoice_date: D(2026, 10, 4), total: 50 }],
    invoice_itemsx: [{ id: 1, invoice_no: 1, product_id: 1, qty: 1, subtotal: 50 }],
    purchase: [{ id: 1, invoice_no: 7, vendor_id: 1, invoice_date: D(2026, 10, 1), total: 590, total_taxable_value: 500, total_tax: 90, total_cgst: 45, total_sgst: 45, total_igst: 0 }],
    purchase_items: [{ id: 1, purchase_id: 1, product_id: 1, qty: 10, rate: 50, subtotal: 500, gst_percentage: 18, cgst: 45, sgst: 45, igst: 0 }],
    sale_returns: [{ id: 1, invoice_id: 1, return_date: D(2026, 10, 10), total_amount: 100, total_tax: 18, refund_amount: 118, payment_status: 1, payment_mode: 0, payment_date: D(2026, 10, 10) }],
    sale_return_items: [{ id: 1, sale_return_id: 1, invoice_item_id: 1, return_qty: 1, unit_price: 100, tax_amount: 18 }],
    purchase_returns: [{ id: 1, vendor_id: 1, purchase_id: 1, debit_note_no: 'DN-4-001', return_date: D(2026, 10, 12), total_amount: 50, total_tax: 9, packing_forwarding_amount: 5, freight_amount: 0, refund_amount: 64, payment_status: 0, payment_mode: 1, payment_date: null }],
    purchase_return_items: [{ id: 1, purchase_return_id: 1, purchase_item_id: 1, return_qty: 1, unit_price: 50, cgst: 4.5, sgst: 4.5, igst: 0 }],
    customer_payments: [
      { id: 1, customer_id: 1, payment_date: D(2026, 9, 30), payment_amount: 100, payment_mode: 0, notes: '' },
      { id: 2, customer_id: 1, payment_date: D(2026, 10, 3), payment_amount: 236, payment_mode: 0, notes: 'with bill' },
      { id: 3, customer_id: 1, payment_date: D(2026, 10, 5), payment_amount: 40, payment_mode: 0, notes: 'Advance carried in the balance with no payment row (refund credit or older data)' }],
    vendor_payments: [{ id: 1, vendor_id: 1, payment_date: D(2026, 10, 2), payment_amount: 590, payment_mode: 1, notes: null }],
    customer_refunds: [{ id: 1, customer_id: 1, refund_date: D(2026, 10, 15), refund_amount: 20, refund_mode: 0, notes: null }],
    vendor_refunds: [{ id: 1, vendor_id: 1, refund_date: D(2026, 10, 16), refund_amount: 10, refund_mode: 1, notes: null }]
  });
  installSqlMirror(store, {}, {
    salex_returns: ['id', 'invoicex_id', 'return_date', 'total_amount', 'refund_amount', 'payment_status', 'payment_mode', 'payment_date'],
    salex_return_items: ['id', 'salex_return_id', 'invoice_itemx_id', 'return_qty', 'unit_price']
  });
  const oct = { start: D(2026, 10, 1, 0), end: D(2026, 11, 1, 0) - 1 };

  const rr = await returnRegister({ ...oct, kinds: ['sale', 'salex', 'purchase'], limit: 50, skip: 0 });
  ok('register: both returns, newest first, note numbers', rr.items.length === 2 && rr.items[0].note_no === 'DN-4-001' && rr.items[1].return_no === 'SR-001', rr.items);
  ok('register: charges, party, bill', rr.items[0].charges === 5 && rr.items[0].party_name === 'Bosch' && rr.items[0].bill_no === '7' && rr.items[1].party_name === 'Ravi', rr.items);
  ok('register: settled 118, waiting 64', rr.totals.settled === 118 && rr.totals.pending === 64 && rr.totals.refund === 182, rr.totals);
  const rr2 = await returnRegister({ ...oct, kinds: ['sale', 'salex'], status: 0, limit: 50, skip: 0 });
  ok('register: customer returns pending = none', rr2.items.length === 0 && rr2.total === 0);

  const g = await gstReport(oct.start, oct.end);
  ok('gst output heads from bills', g.output.cgst === 18 && g.output.sgst === 18 && g.output.igst === 18 && g.output.tax === 54, g.output);
  ok('gst B2B / B2C by bill GSTIN', g.output.b2b.count === 1 && g.output.b2b.tax === 36 && g.output.b2c.igst === 18, g.output);
  ok('credit note split as the line (CGST/SGST 9 each)', g.creditNotes.cgst === 9 && g.creditNotes.sgst === 9 && g.creditNotes.igst === 0 && g.creditNotes.taxable === 100, g.creditNotes);
  ok('input less debit notes', g.input.tax === 90 && g.debitNotes.tax === 9, { i: g.input, d: g.debitNotes });
  ok('net per head: CGST 18-9-(45-4.5) = -31.5, IGST 18', g.net.cgst === -31.5 && g.net.sgst === -31.5 && g.net.igst === 18 && g.net.total === -45, g.net);
  ok('rate and HSN tables; Invoice C as non-GST', g.output.byRate.length === 1 && g.output.byRate[0].rate === 18 && g.hsn[0].qty === 3 && g.nonGst.total === 50, g);

  const cb = await cashBook({ ...oct, mode: null, limit: 100, skip: 0 });
  // before Oct: +100 cash. Oct: +236 cash, -590 bank, -118 cash (sale return complete), -20 cash refund, +10 bank refund; carried row excluded; pending purchase return excluded
  ok('cash book: brought forward 100', cb.opening === 100, cb.opening);
  ok('cash book: in 246, out 728, closing -382', cb.totals.in === 246 && cb.totals.out === 728 && cb.totals.closing === -382, cb.totals);
  ok('cash book: carried-advance row and pending return left out', !cb.rows.some(r => r.kind === 'customer_payment' && r.id === 3) && !cb.rows.some(r => r.kind === 'purchase_return'), cb.rows);
  const cash = await cashBook({ ...oct, mode: 0, limit: 100, skip: 0 });
  ok('cash only: 100 + 236 - 118 - 20 = 198', cash.totals.closing === 198, cash.totals);
  const pg = await cashBook({ ...oct, mode: null, limit: 2, skip: 2 });
  ok('page 2 starts from the running balance', pg.pageOpening === 100 + 236 - 590 && pg.rows.length === 2, pg);

  const pr = await profitReport(oct.start, oct.end);
  // Pad: sold 2 @100 (cost 50 each, Oct 1 purchase) + 1 via Invoice C @50 -> rev 250 cost 150; return 1 @100 cost back 50 -> net 150 cost 100
  // Disc: sold 1 @100, no purchase -> latest 0 -> opening 300 -> loss 200
  const pad = pr.topProducts.find(p => p.product_id === 1), disc = pr.lossMaking.find(p => p.product_id === 2);
  ok('profit: Pad net 150, cost 100, profit 50', pad && pad.net_sales === 150 && pad.cost === 100 && pad.profit === 50, pad);
  ok('profit: Disc costed at opening rate, below cost', disc && disc.cost === 300 && disc.profit === -200, disc);
  ok('profit: month totals', pr.byMonth.length === 1 && pr.byMonth[0].sales === 350 && pr.byMonth[0].returns === 100 && pr.total.profit === -150, pr.byMonth);
  expect(FAILED).toEqual([]);
}, 170000);
