import { prisma } from './db';

/**
 * Sale, Invoice C and Purchase reports: one query set for all three.
 *
 * Before (R1):
 *  - /api/reports/sales answered a different contract from the one the Sale
 *    report page reads (startDate/endDate/summary|customer|product vs
 *    dateFrom/dateTo/sale|salex|both, `data` vs `summary`): the page never
 *    showed anything. Its customer and product queries used PostgreSQL syntax
 *    (`p.id::varchar`), a table that does not exist (`invoice_items` joined on
 *    a product NAME) and interpolated SQL as a bound parameter.
 *  - the Invoice C report matched lines to bills by the printed number
 *    (`invoice_no IN (bill.invoice_no)`), not the bill id: wrong lines, and
 *    other years' bills. Both parsed dates as UTC midnight.
 *  - there was no Purchase report at all (the sidebar link was a 404).
 *
 * Days are India days (UTC+5:30); amounts are the stored, server-computed ones.
 * Returns in the period are shown beside the bills and taken off for the net.
 */
export type BillKind = 'sale' | 'salex' | 'purchase';

const K = {
  sale: {
    head: 'invoice', items: 'invoice_items', itemFk: 'invoice_no', party: 'select_customer',
    partyTable: 'customer_details', partyName: 'billing_name',
    returns: 'sale_returns', returnFk: 'invoice_id', hasTax: true, hasItemsTax: true
  },
  salex: {
    head: 'invoicex', items: 'invoice_itemsx', itemFk: 'invoice_no', party: 'select_customer',
    partyTable: 'customer_details', partyName: 'billing_name',
    returns: 'salex_returns', returnFk: 'invoicex_id', hasTax: false, hasItemsTax: false
  },
  purchase: {
    head: 'purchase', items: 'purchase_items', itemFk: 'purchase_id', party: 'vendor_id',
    partyTable: 'vendor_details', partyName: 'vendor_name',
    returns: 'purchase_returns', returnFk: 'purchase_id', hasTax: true, hasItemsTax: true
  }
} as const;

const IST = 19800;
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const q = (sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe(sql, ...p) as Promise<any[]>;

export interface BillReportRange { start: number; end: number }

async function oneKind(kind: BillKind, range: BillReportRange, limit: number) {
  const k = K[kind];
  const w = 'h.invoice_date BETWEEN ? AND ?';
  const p = [range.start, range.end];
  const [sum, items, parties, products, daily, returns] = await Promise.all([
    q(`SELECT COUNT(*) AS bills, SUM(h.total) AS total, SUM(h.total_taxable_value) AS taxable,
              SUM(COALESCE(h.total_tax, 0)) AS tax, SUM(COALESCE(h.total_cgst, 0)) AS cgst,
              SUM(COALESCE(h.total_sgst, 0)) AS sgst, SUM(COALESCE(h.total_igst, 0)) AS igst,
              COUNT(DISTINCT h.${k.party}) AS parties,
              SUM(CASE WHEN h.payment_mode = 0 THEN h.total ELSE 0 END) AS cash,
              SUM(CASE WHEN h.payment_mode = 1 THEN h.total ELSE 0 END) AS bank,
              SUM(CASE WHEN h.payment_status = 1 THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN COALESCE(h.payment_status, 0) = 0 THEN 1 ELSE 0 END) AS unpaid,
              SUM(CASE WHEN h.payment_status = 2 THEN 1 ELSE 0 END) AS partial
       FROM ${k.head} h WHERE ${w}`, ...p),
    q(`SELECT SUM(i.qty) AS qty FROM ${k.items} i JOIN ${k.head} h ON h.id = i.${k.itemFk} WHERE ${w}`, ...p),
    q(`SELECT h.${k.party} AS party_id, MAX(d.${k.partyName}) AS name, COUNT(*) AS bills, SUM(h.total) AS total
       FROM ${k.head} h LEFT JOIN ${k.partyTable} d ON d.id = h.${k.party}
       WHERE ${w} GROUP BY h.${k.party} ORDER BY total DESC LIMIT ?`, ...p, limit),
    q(`SELECT i.product_id, MAX(i.name_of_product) AS name, SUM(i.qty) AS qty, SUM(i.subtotal) AS taxable, COUNT(DISTINCT h.id) AS bills
       FROM ${k.items} i JOIN ${k.head} h ON h.id = i.${k.itemFk}
       WHERE ${w} GROUP BY i.product_id ORDER BY qty DESC LIMIT ?`, ...p, limit),
    q(`SELECT FLOOR((h.invoice_date + ${IST}) / 86400) AS day, COUNT(*) AS bills, SUM(h.total) AS total
       FROM ${k.head} h WHERE ${w} GROUP BY day ORDER BY day`, ...p),
    q(`SELECT COUNT(*) AS returns, SUM(COALESCE(r.refund_amount, 0)) AS amount
       FROM ${k.returns} r WHERE r.return_date BETWEEN ? AND ?`, ...p)
  ]);
  return { kind, sum: sum[0] || {}, qty: n(items[0]?.qty), parties, products, daily, returns: returns[0] || {} };
}

export async function billReport(kinds: BillKind[], range: BillReportRange, limit = 50) {
  const parts = await Promise.all(kinds.map(k => oneKind(k, range, 1000)));
  const s = (f: string) => r2(parts.reduce((a, x) => a + n(x.sum[f]), 0));
  const bills = parts.reduce((a, x) => a + n(x.sum.bills), 0);
  const total = s('total');
  const returnsAmount = r2(parts.reduce((a, x) => a + n(x.returns.amount), 0));

  // Parties and products can appear under both sale and Invoice C: merge.
  const partyMap = new Map<string, any>();
  for (const x of parts) for (const r of x.parties) {
    const key = String(r.party_id ?? 0);
    const cur = partyMap.get(key) || { party_id: n(r.party_id), name: r.name || (n(r.party_id) === 0 ? 'Other' : 'Unknown'), bills: 0, total: 0 };
    cur.bills += n(r.bills); cur.total = r2(cur.total + n(r.total));
    partyMap.set(key, cur);
  }
  const productMap = new Map<string, any>();
  for (const x of parts) for (const r of x.products) {
    const key = String(r.product_id ?? r.name);
    const cur = productMap.get(key) || { product_id: n(r.product_id), name: r.name || 'Unknown', qty: 0, taxable: 0, bills: 0 };
    cur.qty += n(r.qty); cur.taxable = r2(cur.taxable + n(r.taxable)); cur.bills += n(r.bills);
    productMap.set(key, cur);
  }
  const dayMap = new Map<number, { bills: number; total: number }>();
  for (const x of parts) for (const r of x.daily) {
    const d = n(r.day);
    const cur = dayMap.get(d) || { bills: 0, total: 0 };
    cur.bills += n(r.bills); cur.total = r2(cur.total + n(r.total));
    dayMap.set(d, cur);
  }
  const dayLabel = (d: number) => {
    const dt = new Date(d * 86400 * 1000);
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  };

  const topParties = Array.from(partyMap.values()).sort((a, b) => b.total - a.total).slice(0, limit);
  const topProducts = Array.from(productMap.values()).sort((a, b) => b.qty - a.qty || b.taxable - a.taxable).slice(0, limit);

  return {
    success: true,
    summary: {
      totalSales: bills,
      totalRevenue: total,
      taxable: s('taxable'),
      tax: s('tax'),
      cgst: s('cgst'),
      sgst: s('sgst'),
      igst: s('igst'),
      totalItems: parts.reduce((a, x) => a + x.qty, 0),
      totalCustomers: partyMap.size,
      avgOrderValue: bills ? r2(total / bills) : 0,
      cashSales: s('cash'),
      bankSales: s('bank'),
      paidSales: s('paid'),
      unpaidSales: s('unpaid'),
      partiallyPaidSales: s('partial'),
      returnsCount: parts.reduce((a, x) => a + n(x.returns.returns), 0),
      returnsAmount,
      netRevenue: r2(total - returnsAmount)
    },
    // Field names kept from the old sale/salex contract.
    topCustomers: topParties.map(p => ({ party_id: p.party_id, customer_name: p.name, party_name: p.name, total_sales: p.bills, total_revenue: p.total })),
    topProducts: topProducts.map(p => ({ product_id: p.product_id, product_name: p.name, total_qty: p.qty, total_revenue: p.taxable, bills: p.bills })),
    dailySales: Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0])
      .map(([d, v]) => ({ date: dayLabel(d), total_sales: v.bills, total_revenue: v.total }))
  };
}
