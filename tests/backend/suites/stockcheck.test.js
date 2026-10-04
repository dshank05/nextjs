// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { store } from '../support/dbstub.js';
import { installSqlMirror } from '../support/sqlmirror.js';
import { stockReport } from '../../../lib/stock-report';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
const D = (y, m, d, h = 12) => Math.floor(Date.UTC(y, m - 1, d, h) / 1000) - 19800;
test('stock report', async () => {
  Object.assign(store, {
    product: [
      // Pad: opening 10 (created Sept), stock now 10+5-1-3+1-2 = 10 ... computed below
      { id: 1, product_name: 'Pad', display_name: 'Brake Pad', part_no: 'BP1', hsn: '8708', stock: 9, opening_stock: 10, created_at: new Date(Date.UTC(2026, 8, 1)), latest_purchase_rate: 60, opening_rate: 40 },
      // Disc: created in October with opening 4; stock now matches
      { id: 2, product_name: 'Disc', display_name: 'Disc', part_no: 'D1', hsn: '8708', stock: 3, opening_stock: 4, created_at: new Date(Date.UTC(2026, 9, 10)), latest_purchase_rate: null, opening_rate: 100 },
      { id: 3, product_name: 'Idle', display_name: 'Idle', part_no: '', hsn: '', stock: 0, opening_stock: 0, created_at: null, latest_purchase_rate: 0, opening_rate: 0 }],
    purchase: [{ id: 1, invoice_date: D(2026, 9, 20) }, { id: 2, invoice_date: D(2026, 10, 5) }, { id: 3, invoice_date: D(2026, 11, 3) }],
    purchase_items: [
      { id: 1, purchase_id: 1, product_id: 1, qty: 5, rate: 50 },
      { id: 2, purchase_id: 2, product_id: 1, qty: 4, rate: 55 },
      { id: 3, purchase_id: 3, product_id: 1, qty: 1, rate: 70 }],
    invoice: [{ id: 1, invoice_date: D(2026, 9, 25) }, { id: 2, invoice_date: D(2026, 10, 15) }],
    invoice_items: [{ id: 1, invoice_no: 1, product_id: 1, qty: 3 }, { id: 2, invoice_no: 2, product_id: 1, qty: 6 }],
    invoicex: [{ id: 1, invoice_date: D(2026, 10, 16) }],
    invoice_itemsx: [{ id: 1, invoice_no: 1, product_id: 2, qty: 1 }],
    sale_returns: [{ id: 1, return_date: D(2026, 10, 20) }],
    sale_return_items: [{ id: 1, sale_return_id: 1, invoice_item_id: 2, return_qty: 2 }],
    purchase_returns: [{ id: 1, return_date: D(2026, 10, 25) }],
    purchase_return_items: [{ id: 1, purchase_return_id: 1, purchase_item_id: 2, return_qty: 1 }],
    deadstock: [{ id: 1, product_id: 1, quantity: 1, created_at: new Date(Date.UTC(2026, 9, 28)) }]
  });
  installSqlMirror(store, {}, {
    salex_returns: ['id', 'return_date'], salex_return_items: ['id', 'salex_return_id', 'invoice_itemx_id', 'return_qty']
  });
  const oct = { start: D(2026, 10, 1, 0), end: D(2026, 11, 1, 0) - 1 };
  const r = await stockReport({ ...oct, limit: 50, skip: 0 });
  const pad = r.items.find(i => i.product_id === 1), disc = r.items.find(i => i.product_id === 2);
  // Pad: before Oct: 10 + 5 - 3 = 12. Oct: +4 -6 +2 -1 -1 = -2 -> closing 10. After: +1 -> 11 now; stored 9 -> mismatch -2
  ok('Pad opening = opening stock + Sept purchase - Sept sale = 12', pad.opening_qty === 12, pad);
  ok('Pad October movements', pad.purchased === 4 && pad.sold === 6 && pad.sale_returned === 2 && pad.purchase_returned === 1 && pad.dead_stock === 1, pad);
  ok('Pad closing 10', pad.closing_qty === 10, pad);
  ok('rates as of each date: opening at Sept rate 50, closing at Oct rate 55 (not Nov 70)', pad.opening_rate === 50 && pad.closing_rate === 55 && pad.closing_value === 550 && pad.opening_value === 600, pad);
  ok('stored stock that does not add up is flagged (now 11 by documents, 9 stored)', pad.mismatch === -2, pad);
  ok('product created in the range: its opening stock comes in, not opening', disc.opening_qty === 0 && disc.new_stock_in === 4 && disc.sold === 1 && disc.closing_qty === 3 && disc.mismatch === 0, disc);
  ok('no purchase yet: rate falls back to opening rate', disc.closing_rate === 100 && disc.closing_value === 300, disc);
  ok('idle product hidden by default', !r.items.some(i => i.product_id === 3) && r.total === 2, r.total);
  ok('totals', r.totals.closing_qty === 13 && r.totals.closing_value === 850 && r.totals.mismatched_products === 1, r.totals);
  const all = await stockReport({ ...oct, limit: 50, skip: 0, activeOnly: false });
  ok('show all includes the idle product', all.total === 3);
  expect(FAILED).toEqual([]);
}, 170000);
