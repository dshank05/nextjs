import { prisma } from './db';

/**
 * Cash / bank book: every recorded movement of money, by day, with a running
 * balance - in Cash (mode 0), Bank (mode 1) or both.
 *
 *  In:  payments from customers, refunds from vendors, completed purchase
 *       returns (the vendor paid back)
 *  Out: payments to vendors, refunds to customers, completed sale / Invoice C
 *       returns (we paid back)
 *
 * A completed return is money moving (it is how a return is refunded, owner
 * decision 2026-10-03), dated by its payment date. Payment rows written by
 * allocateFromAdvance to carry an advance that had no payment row are
 * bookkeeping, not money, and are left out. There is no opening cash setting,
 * so "brought forward" is everything recorded before the range.
 */
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const CARRIED = 'Advance carried in the balance with no payment row%';
const pad3 = (v: number) => String(v).padStart(3, '0');

const UNION = `
  SELECT 'customer_payment' AS kind, p.id, p.payment_date AS d, p.payment_mode AS mode, p.payment_amount AS amt, 1 AS dir,
         c.billing_name AS party, p.notes AS notes
  FROM customer_payments p LEFT JOIN customer_details c ON c.id = p.customer_id
  WHERE COALESCE(p.notes, '') NOT LIKE ?
  UNION ALL
  SELECT 'vendor_refund', r.id, r.refund_date, r.refund_mode, r.refund_amount, 1, v.vendor_name, r.notes
  FROM vendor_refunds r LEFT JOIN vendor_details v ON v.id = r.vendor_id
  UNION ALL
  SELECT 'purchase_return', r.id, COALESCE(r.payment_date, r.return_date), r.payment_mode,
         COALESCE(r.refund_amount, r.total_amount + COALESCE(r.total_tax, 0)), 1, v.vendor_name, r.debit_note_no
  FROM purchase_returns r LEFT JOIN vendor_details v ON v.id = r.vendor_id WHERE r.payment_status = 1
  UNION ALL
  SELECT 'vendor_payment', p.id, p.payment_date, p.payment_mode, p.payment_amount, -1, v.vendor_name, p.notes
  FROM vendor_payments p LEFT JOIN vendor_details v ON v.id = p.vendor_id
  WHERE COALESCE(p.notes, '') NOT LIKE ?
  UNION ALL
  SELECT 'customer_refund', r.id, r.refund_date, r.refund_mode, r.refund_amount, -1, c.billing_name, r.notes
  FROM customer_refunds r LEFT JOIN customer_details c ON c.id = r.customer_id
  UNION ALL
  SELECT 'sale_return', r.id, COALESCE(r.payment_date, r.return_date), r.payment_mode,
         COALESCE(r.refund_amount, r.total_amount + COALESCE(r.total_tax, 0)), -1, c.billing_name, NULL
  FROM sale_returns r LEFT JOIN invoice h ON h.id = r.invoice_id LEFT JOIN customer_details c ON c.id = h.select_customer
  WHERE r.payment_status = 1
  UNION ALL
  SELECT 'salex_return', r.id, COALESCE(r.payment_date, r.return_date), r.payment_mode,
         COALESCE(r.refund_amount, r.total_amount), -1, c.billing_name, NULL
  FROM salex_returns r LEFT JOIN invoicex h ON h.id = r.invoicex_id LEFT JOIN customer_details c ON c.id = h.select_customer
  WHERE r.payment_status = 1`;

const LABEL: Record<string, string> = {
  customer_payment: 'Received from customer', vendor_refund: 'Refund from vendor', purchase_return: 'Purchase return refunded',
  vendor_payment: 'Paid to vendor', customer_refund: 'Refund to customer', sale_return: 'Sale return refunded', salex_return: 'Invoice C return refunded'
};
function link(kind: string, id: number) {
  switch (kind) {
    case 'customer_payment': return { ref: `PAY-${id}`, url: `/customer-transactions/view/${id}?type=income` };
    case 'customer_refund': return { ref: `REF-${id}`, url: `/customer-transactions/view/${id}?type=expense` };
    case 'vendor_payment': return { ref: `PAY-${id}`, url: `/vendor-transactions/view/${id}?type=expense` };
    case 'vendor_refund': return { ref: `REF-${id}`, url: `/vendor-transactions/view/${id}?type=income` };
    case 'purchase_return': return { ref: `PR-${pad3(id)}`, url: `/entry/purchasereturn-vendor/${id}` };
    case 'sale_return': return { ref: `SR-${pad3(id)}`, url: `/entry/salereturn/${id}?type=invoice` };
    default: return { ref: `SXR-${pad3(id)}`, url: `/entry/salereturn/${id}?type=invoicex` };
  }
}

export async function cashBook(Q: { start: number; end: number; mode: number | null; limit: number; skip: number }) {
  const modeSql = Q.mode === null ? '' : ' AND t.mode = ?';
  const base = [CARRIED, CARRIED];
  const modeP = Q.mode === null ? [] : [Q.mode];
  const [before, rows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT SUM(t.amt * t.dir) AS bal FROM (${UNION}) t WHERE t.d < ?${modeSql}`, ...base, Q.start, ...modeP) as Promise<any[]>,
    prisma.$queryRawUnsafe(
      `SELECT t.* FROM (${UNION}) t WHERE t.d BETWEEN ? AND ?${modeSql} ORDER BY t.d, t.dir DESC, t.kind, t.id`,
      ...base, Q.start, Q.end, ...modeP) as Promise<any[]>
  ]);

  const opening = r2(n(before[0]?.bal));
  let running = opening;
  let inTotal = 0, outTotal = 0, cashNet = 0, bankNet = 0;
  const all = rows.map(r => {
    const amt = r2(n(r.amt));
    const into = n(r.dir) > 0;
    running = r2(running + (into ? amt : -amt));
    if (into) inTotal += amt; else outTotal += amt;
    if (n(r.mode) === 0) cashNet += into ? amt : -amt; else bankNet += into ? amt : -amt;
    const d = n(r.d);
    const l = link(r.kind, n(r.id));
    return {
      kind: r.kind, id: n(r.id), date: d,
      formattedDate: new Date(d * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      particulars: LABEL[r.kind] || r.kind, party: r.party || '', notes: r.notes || '',
      mode: n(r.mode) === 0 ? 'Cash' : 'Bank', reference: l.ref, url: l.url,
      money_in: into ? amt : 0, money_out: into ? 0 : amt, balance: running
    };
  });
  return {
    opening,
    rows: all.slice(Q.skip, Q.skip + Q.limit),
    total: all.length,
    totals: { in: r2(inTotal), out: r2(outTotal), closing: running, cashNet: r2(cashNet), bankNet: r2(bankNet) },
    // the balance just before the first row of this page
    pageOpening: Q.skip > 0 && all[Q.skip - 1] ? all[Q.skip - 1].balance : opening
  };
}
