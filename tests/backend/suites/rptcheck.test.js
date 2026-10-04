// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { installSqlMirror } from '../support/sqlmirror.js';
import { billReport } from '../../../lib/bill-report';
import { partyOutstanding } from '../../../lib/party-outstanding';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const D = (y, m, d, h = 12) => Math.floor(Date.UTC(y, m - 1, d, h) / 1000) - 19800; // IST wall time
test('bill reports and outstanding', async () => {
  Object.assign(store, {
    customer_details: [{ id: 1, billing_name: 'Ravi', contact_no: '1', email: null, billing_address: '', billing_city: '', billing_state: '', billing_gstin: '' }, { id: 2, billing_name: 'Asha', contact_no: '2', email: null, billing_address: '', billing_city: '', billing_state: '', billing_gstin: '' }],
    vendor_details: [{ id: 1, vendor_name: 'Bosch', contact_no: '3', email: null, address: '', city: '', state: '', tax_id: '' }],
    invoice: [
      { id: 5, invoice_no: 11, select_customer: 1, invoice_date: D(2026, 10, 1, 0), total: 118, total_taxable_value: 100, total_tax: 18, total_cgst: 9, total_sgst: 9, total_igst: 0, payment_mode: 0, payment_status: 1 },
      { id: 6, invoice_no: 12, select_customer: 2, invoice_date: D(2026, 10, 31, 23), total: 236, total_taxable_value: 200, total_tax: 36, total_cgst: 18, total_sgst: 18, total_igst: 0, payment_mode: 1, payment_status: 0 },
      { id: 7, invoice_no: 13, select_customer: 2, invoice_date: D(2026, 11, 1, 0), total: 999, total_taxable_value: 999, total_tax: 0, payment_mode: 1, payment_status: 0 }],
    // Invoice C bill 5 shares the id with sale bill 5; its printed number is 12, like sale #6
    invoicex: [{ id: 5, invoice_no: 12, select_customer: 1, invoice_date: D(2026, 10, 15), total: 50, total_taxable_value: 50, total_tax: 0, total_cgst: 0, total_sgst: 0, total_igst: 0, payment_mode: 0, payment_status: 1 }],
    invoice_items: [
      { id: 1, invoice_no: 5, product_id: 1, name_of_product: 'Pad', qty: 2, subtotal: 100 },
      { id: 2, invoice_no: 6, product_id: 2, name_of_product: 'Disc', qty: 1, subtotal: 200 },
      { id: 3, invoice_no: 7, product_id: 2, name_of_product: 'Disc', qty: 9, subtotal: 999 }],
    invoice_itemsx: [{ id: 1, invoice_no: 5, product_id: 1, name_of_product: 'Pad', qty: 1, subtotal: 50 }, { id: 2, invoice_no: 12, product_id: 3, name_of_product: 'WRONG', qty: 7, subtotal: 1 }],
    sale_returns: [{ id: 1, invoice_id: 5, return_date: D(2026, 10, 20), refund_amount: 59 }],
    purchase: [{ id: 3, invoice_no: 21, vendor_id: 1, invoice_date: D(2026, 10, 2), total: 590, total_taxable_value: 500, total_tax: 90, total_cgst: 0, total_sgst: 0, total_igst: 90, payment_mode: 1, payment_status: 2 }],
    purchase_items: [{ id: 1, purchase_id: 3, product_id: 1, name_of_product: 'Pad', qty: 10, subtotal: 500 }],
    customer_ledger: [
      { id: 1, customer_id: 1, transaction_date: D(2026, 10, 1), transaction_type: 'SALE', reference_type: 'sale', reference_id: 5, reference_no: '11', debit: 118, credit: 0, balance: 999 },
      { id: 2, customer_id: 1, transaction_date: D(2026, 10, 1), transaction_type: 'PAYMENT_RECEIVED', reference_type: 'payment', reference_id: 1, reference_no: 'PAY-001', transaction_id: 1, debit: 0, credit: 200, balance: 999 },
      { id: 3, customer_id: 2, transaction_date: D(2026, 10, 31), transaction_type: 'SALE', reference_type: 'sale', reference_id: 6, reference_no: '12', debit: 236, credit: 0, balance: -5 },
      { id: 4, customer_id: 2, transaction_date: D(2026, 11, 2), transaction_type: 'SALE', reference_type: 'sale', reference_id: 7, reference_no: '13', debit: 999, credit: 0, balance: 0 }],
    vendor_ledger: [{ id: 1, vendor_id: 1, transaction_date: D(2026, 10, 2), transaction_type: 'PURCHASE', reference_type: 'purchase', reference_id: 3, reference_no: '21', debit: 590, credit: 0, balance: 0 }]
  });
  installSqlMirror(store, {}, {
    salex_returns: ['id', 'invoicex_id', 'return_date', 'refund_amount'],
    purchase_returns: ['id', 'purchase_id', 'return_date', 'refund_amount']
  });
  const oct = { start: D(2026, 10, 1, 0) - 0, end: D(2026, 11, 1, 0) - 1 };
  const s = await billReport(['sale'], oct);
  ok('sale: October bills only (first and last minute in, Nov 1 out)', s.summary.totalSales === 2 && s.summary.totalRevenue === 354, s.summary);
  ok('sale: GST split', s.summary.tax === 54 && s.summary.cgst === 27 && s.summary.sgst === 27 && s.summary.taxable === 300, s.summary);
  ok('sale: returns in period and net', s.summary.returnsAmount === 59 && s.summary.netRevenue === 295, s.summary);
  ok('sale: cash / bank by bill mode; paid/unpaid', s.summary.cashSales === 118 && s.summary.bankSales === 236 && s.summary.paidSales === 1 && s.summary.unpaidSales === 1, s.summary);
  ok('sale: items and top product', s.summary.totalItems === 3 && s.topProducts[0].product_name === 'Pad' && s.topProducts[0].total_qty === 2, s.topProducts);
  ok('sale: daily in India days', s.dailySales.length === 2 && s.dailySales[0].date === '01/10/2026' && s.dailySales[1].date === '31/10/2026', s.dailySales);
  const x = await billReport(['salex'], oct);
  ok('Invoice C: lines by bill id, not printed number', x.summary.totalItems === 1 && !x.topProducts.some(p => p.product_name === 'WRONG'), x.topProducts);
  const both = await billReport(['sale', 'salex'], oct);
  ok('both: totals add, customers merged', both.summary.totalSales === 3 && both.summary.totalRevenue === 404 && both.summary.totalCustomers === 2 && both.topProducts.find(p => p.product_name === 'Pad').total_qty === 3, both.summary);
  const pu = await billReport(['purchase'], oct);
  ok('purchase report', pu.summary.totalSales === 1 && pu.summary.igst === 90 && pu.summary.partiallyPaidSales === 1 && pu.topCustomers[0].customer_name === 'Bosch', pu);

  const c = await partyOutstanding('customer', { limit: 10, skip: 0, end: oct.end, sortBy: 'balance', sortOrder: 'desc' });
  const ravi = c.items.find(i => i.customer_id === 1), asha = c.items.find(i => i.customer_id === 2);
  ok('outstanding from the ledger sum, not the stored balance: Asha owes 236 as of 31 Oct', asha && asha.balance === 236, c.items);
  ok('advance shows as negative (Ravi paid 200 on a 118 bill)', ravi && ravi.balance === -82, c.items);
  ok('totals: owed 236, credit 82', c.totals.owed === 236 && c.totals.credit === 82 && c.total === 2, c.totals);
  ok('last transaction links to the bill', asha.reference_url === '/sale/view/6' && asha.reference_display === 'INV-12', asha);
  const c2 = await partyOutstanding('customer', { limit: 10, skip: 0, sortBy: 'balance', sortOrder: 'desc' });
  ok('no end date: everything (Asha 1235)', c2.items.find(i => i.customer_id === 2).balance === 1235, c2.items);
  const v = await partyOutstanding('vendor', { limit: 10, skip: 0 });
  ok('vendor: we owe 590', v.items[0].balance === 590 && v.items[0].vendor_name === 'Bosch' && v.items[0].reference_url === '/purchases/view/3', v.items);
  expect(FAILED).toEqual([]);
}, 170000);
