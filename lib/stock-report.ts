import { prisma } from './db';

/**
 * Opening / Closing Stock: per product, for a date range, the quantity at the
 * start, what came in and went out, and the quantity at the end, valued at
 * the last purchase rate on each date (owner choice, 2026-10-03).
 *
 * Built from the movements, not from `product.stock`: stock is set only at
 * creation (opening_stock, F-75) and after that moves only with documents, so
 * the movements are the whole story:
 *
 *   + opening stock (dated when the product was created)
 *   + purchases               - purchase returns
 *   - sales and Invoice C     + sale and Invoice C returns
 *   - dead stock (dated when marked)
 *
 * `stock_now` is the stored product.stock; `mismatch` flags a product whose
 * movements up to now do not add up to it (older data, or a direct DB edit).
 * Rate on a date: the newest purchase line on or before it; else the product's
 * latest_purchase_rate, then its opening_rate.
 */

const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const q = (sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe(sql, ...p) as Promise<any[]>;

/** Quantity before `start`, inside [start, end], and after `end`, per product, for one movement source. */
function moves(sql: { from: string; date: string; qty: string }, start: number, end: number) {
  return q(
    `SELECT product_id,
            SUM(CASE WHEN ${sql.date} < ? THEN ${sql.qty} ELSE 0 END) AS before_q,
            SUM(CASE WHEN ${sql.date} BETWEEN ? AND ? THEN ${sql.qty} ELSE 0 END) AS in_q,
            SUM(CASE WHEN ${sql.date} > ? THEN ${sql.qty} ELSE 0 END) AS after_q
     FROM (${sql.from}) m GROUP BY product_id`,
    start, start, end, end
  );
}

const SOURCES = {
  purchased: { from: 'SELECT i.product_id, h.invoice_date AS d, i.qty AS qty FROM purchase_items i JOIN purchase h ON h.id = i.purchase_id', date: 'd', qty: 'qty' },
  purchaseReturned: {
    from: `SELECT pi.product_id, pr.return_date AS d, r.return_qty AS qty FROM purchase_return_items r
           JOIN purchase_returns pr ON pr.id = r.purchase_return_id JOIN purchase_items pi ON pi.id = r.purchase_item_id`,
    date: 'd', qty: 'qty'
  },
  sold: {
    from: `SELECT i.product_id, h.invoice_date AS d, i.qty AS qty FROM invoice_items i JOIN invoice h ON h.id = i.invoice_no
           UNION ALL
           SELECT i.product_id, h.invoice_date AS d, i.qty AS qty FROM invoice_itemsx i JOIN invoicex h ON h.id = i.invoice_no`,
    date: 'd', qty: 'qty'
  },
  saleReturned: {
    from: `SELECT ii.product_id, sr.return_date AS d, r.return_qty AS qty FROM sale_return_items r
           JOIN sale_returns sr ON sr.id = r.sale_return_id JOIN invoice_items ii ON ii.id = r.invoice_item_id
           UNION ALL
           SELECT ii.product_id, sr.return_date AS d, r.return_qty AS qty FROM salex_return_items r
           JOIN salex_returns sr ON sr.id = r.salex_return_id JOIN invoice_itemsx ii ON ii.id = r.invoice_itemx_id`,
    date: 'd', qty: 'qty'
  }
} as const;

type Src = keyof typeof SOURCES;

async function ratesAsOf(at: number): Promise<Map<number, number>> {
  const rows = await q(
    `SELECT product_id, rate FROM (
       SELECT i.product_id, i.rate,
              ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY h.invoice_date DESC, i.id DESC) AS rn
       FROM purchase_items i JOIN purchase h ON h.id = i.purchase_id
       WHERE h.invoice_date <= ? AND i.rate > 0
     ) latest WHERE rn = 1`, at);
  return new Map(rows.map(r => [n(r.product_id), n(r.rate)]));
}

export interface StockReportQuery {
  start: number;
  end: number;
  search?: string;
  categoryId?: number | null;
  /** only products with stock or movement in the range */
  activeOnly?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
  skip: number;
}

export async function stockReport(Q: StockReportQuery) {
  const where: any = {};
  if (Q.categoryId != null) where.product_category_id = Q.categoryId;
  if (Q.search) where.OR = [{ product_name: { contains: Q.search } }, { part_no: { contains: Q.search } }, { hsn: { contains: Q.search } }];

  const [products, dead, openRates, closeRates, ...sourceRows] = await Promise.all([
    prisma.product.findMany({
      where,
      select: { id: true, product_name: true, display_name: true, part_no: true, hsn: true, stock: true, opening_stock: true, created_at: true, latest_purchase_rate: true, opening_rate: true }
    }),
    (prisma as any).deadstock.findMany({ select: { product_id: true, quantity: true, created_at: true } }),
    ratesAsOf(Q.start - 1),
    ratesAsOf(Q.end),
    ...(Object.keys(SOURCES) as Src[]).map(k => moves(SOURCES[k], Q.start, Q.end))
  ]);

  const by: Record<string, Map<number, { before: number; inside: number; after: number }>> = {};
  (Object.keys(SOURCES) as Src[]).forEach((k, i) => {
    by[k] = new Map(sourceRows[i].map((r: any) => [n(r.product_id), { before: n(r.before_q), inside: n(r.in_q), after: n(r.after_q) }]));
  });
  // Opening stock and dead stock are dated in JS (created_at is a DateTime).
  const split = (when: Date | null | undefined) => {
    const t = when ? Math.floor(new Date(when).getTime() / 1000) : 0;
    return t < Q.start ? 'before' : t <= Q.end ? 'inside' : 'after';
  };
  const deadBy = new Map<number, { before: number; inside: number; after: number }>();
  for (const d of dead) {
    const cur = deadBy.get(d.product_id) || { before: 0, inside: 0, after: 0 };
    cur[split(d.created_at)] += n(d.quantity);
    deadBy.set(d.product_id, cur);
  }
  const zero = { before: 0, inside: 0, after: 0 };

  const rows = products.map(p => {
    const g = (k: Src) => by[k].get(p.id) || zero;
    const pu = g('purchased'), pr = g('purchaseReturned'), so = g('sold'), sr = g('saleReturned');
    const de = deadBy.get(p.id) || zero;
    const os = { before: 0, inside: 0, after: 0 };
    os[split(p.created_at)] += n(p.opening_stock);
    const net = (x: 'before' | 'inside' | 'after') => os[x] + pu[x] - pr[x] - so[x] + sr[x] - de[x];
    const opening = net('before');
    const closing = opening + net('inside');
    const now = closing + net('after');
    const fallback = n(p.latest_purchase_rate) || n(p.opening_rate);
    const openRate = openRates.get(p.id) ?? fallback;
    const closeRate = closeRates.get(p.id) ?? fallback;
    return {
      product_id: p.id,
      product_name: p.display_name || p.product_name,
      part_no: p.part_no || '',
      hsn: p.hsn || '',
      opening_qty: opening,
      opening_rate: openRate,
      opening_value: r2(opening * openRate),
      new_stock_in: os.inside,
      purchased: pu.inside,
      purchase_returned: pr.inside,
      sold: so.inside,
      sale_returned: sr.inside,
      dead_stock: de.inside,
      closing_qty: closing,
      closing_rate: closeRate,
      closing_value: r2(closing * closeRate),
      stock_now: n(p.stock),
      mismatch: Math.abs(now - n(p.stock)) > 0.0001 ? r2(n(p.stock) - now) : 0
    };
  });

  const moved = (r: any) => r.opening_qty || r.closing_qty || r.purchased || r.sold || r.purchase_returned || r.sale_returned || r.dead_stock || r.new_stock_in;
  const list = Q.activeOnly === false ? rows : rows.filter(moved);
  const key = ['product_name', 'opening_qty', 'closing_qty', 'closing_value', 'sold', 'purchased', 'mismatch'].includes(String(Q.sortBy)) ? String(Q.sortBy) : 'product_name';
  const dir = Q.sortOrder === 'desc' ? -1 : 1;
  list.sort((a: any, b: any) => {
    const x = typeof a[key] === 'string' ? a[key].toLowerCase() : a[key];
    const y = typeof b[key] === 'string' ? b[key].toLowerCase() : b[key];
    return dir * (x < y ? -1 : x > y ? 1 : a.product_id - b.product_id);
  });

  const sum = (f: string) => r2(list.reduce((s: number, r: any) => s + r[f], 0));
  return {
    items: list.slice(Q.skip, Q.skip + Q.limit),
    total: list.length,
    totals: {
      opening_qty: sum('opening_qty'), opening_value: sum('opening_value'),
      purchased: sum('purchased'), purchase_returned: sum('purchase_returned'),
      sold: sum('sold'), sale_returned: sum('sale_returned'), dead_stock: sum('dead_stock'), new_stock_in: sum('new_stock_in'),
      closing_qty: sum('closing_qty'), closing_value: sum('closing_value'),
      mismatched_products: list.filter((r: any) => r.mismatch !== 0).length
    }
  };
}
