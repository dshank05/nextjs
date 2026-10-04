// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { num, toNumber, lineQty, validatePurchase, computePurchaseTotals } from '../../../lib/purchase';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
test('whole-unit quantities', async () => {
  ok('num "12abc" -> 0', num('12abc') === 0); ok('toNumber "12abc" NaN', Number.isNaN(toNumber('12abc')));
  ok('num "" -> 0', num('') === 0); ok('num " 7.5 " -> 7.5', num(' 7.5 ') === 7.5);
  ok('lineQty 2.6 -> 3', lineQty('2.6') === 3);
  const v = (items) => validatePurchase({ items }, { partial: true });
  ok('rejects "12abc" qty', (await v([{ product_id: 1, qty: '12abc', rate: 5 }]))?.message === 'Quantity must be a number', await v([{ product_id: 1, qty: '12abc', rate: 5 }]));
  ok('rejects 0.4 qty', !!(await v([{ product_id: 1, qty: 0.4, rate: 5 }])));
  ok('accepts 1', (await v([{ product_id: 1, qty: '1', rate: '5' }])) === null);
  ok('rejects rate "x"', (await v([{ product_id: 1, qty: 1, rate: 'x' }]))?.message === 'Rate must be a number');
  const t = computePurchaseTotals({ items: [{ product_id: 1, qty: '2.6', rate: 10, gst_percentage: 18 }], vendorStateCode: 9, businessGstin: '09ABCDE1234F1Z5', hasVendorState: true });
  ok('totals use whole qty', t.lines[0].qty === 3 && t.itemsTotal === 30, t.lines[0]);
  expect(FAILED).toEqual([]);
}, 170000);
