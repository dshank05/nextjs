import { prisma } from './db';

/**
 * Profit by period: gross profit on goods, by month and by product.
 *
 *  net sales   = line taxable value (ex-GST, after discount) of sale and
 *                Invoice C lines, less the value of returned lines
 *  cost        = quantity x the product's last purchase rate on or before the
 *                sale date (ex-GST purchase line rate); a return gives back the
 *                cost at its original sale date. With no purchase yet: the
 *                product's latest purchase rate, then its opening rate.
 *  gross profit = net sales - cost
 *
 * Freight and packing charged on bills, and expenses, are outside it: this is
 * the margin on goods.
 */
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const IST = 19800;

const COST = (dateExpr: string) => `COALESCE(
  (SELECT pi.rate FROM purchase_items pi JOIN purchase pp ON pp.id = pi.purchase_id
   WHERE pi.product_id = l.product_id AND pp.invoice_date <= ${dateExpr} AND pi.rate > 0
   ORDER BY pp.invoice_date DESC, pi.id DESC LIMIT 1),
  NULLIF(pr.latest_purchase_rate, 0), pr.opening_rate, 0)`;

const LINES = `
  SELECT i.product_id, h.invoice_date AS d, h.invoice_date AS sold_on, i.qty AS qty, i.subtotal AS revenue
  FROM invoice_items i JOIN invoice h ON h.id = i.invoice_no
  UNION ALL
  SELECT i.product_id, h.invoice_date, h.invoice_date, i.qty, i.subtotal
  FROM invoice_itemsx i JOIN invoicex h ON h.id = i.invoice_no
  UNION ALL
  SELECT i.product_id, r.return_date, h.invoice_date, -x.return_qty, -(x.return_qty * x.unit_price)
  FROM sale_return_items x JOIN sale_returns r ON r.id = x.sale_return_id
  JOIN invoice_items i ON i.id = x.invoice_item_id JOIN invoice h ON h.id = i.invoice_no
  UNION ALL
  SELECT i.product_id, r.return_date, h.invoice_date, -x.return_qty, -(x.return_qty * x.unit_price)
  FROM salex_return_items x JOIN salex_returns r ON r.id = x.salex_return_id
  JOIN invoice_itemsx i ON i.id = x.invoice_itemx_id JOIN invoicex h ON h.id = i.invoice_no`;

export async function profitReport(start: number, end: number, productLimit = 100) {
  const costed = `
    SELECT l.product_id, l.d, l.qty, l.revenue, l.qty * ${COST('l.sold_on')} AS cost,
           pr.product_name, pr.display_name
    FROM (${LINES}) l LEFT JOIN product pr ON pr.id = l.product_id
    WHERE l.d BETWEEN ? AND ?`;
  const [months, products] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT FLOOR((c.d + ${IST}) / 86400) AS day,
              SUM(CASE WHEN c.revenue >= 0 THEN c.revenue ELSE 0 END) AS sales,
              SUM(CASE WHEN c.revenue < 0 THEN -c.revenue ELSE 0 END) AS returns,
              SUM(c.cost) AS cost
       FROM (${costed}) c GROUP BY day ORDER BY day`, start, end) as Promise<any[]>,
    prisma.$queryRawUnsafe(
      `SELECT c.product_id, MAX(COALESCE(c.display_name, c.product_name)) AS name, SUM(c.qty) AS qty,
              SUM(c.revenue) AS net_sales, SUM(c.cost) AS cost
       FROM (${costed}) c GROUP BY c.product_id ORDER BY SUM(c.revenue) - SUM(c.cost) DESC`, start, end) as Promise<any[]>
  ]);

  // Days to months in JS (India days already).
  const monthMap = new Map<string, { sales: number; returns: number; cost: number }>();
  for (const m of months) {
    const dt = new Date(n(m.day) * 86400 * 1000);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    const cur = monthMap.get(key) || { sales: 0, returns: 0, cost: 0 };
    cur.sales += n(m.sales); cur.returns += n(m.returns); cur.cost += n(m.cost);
    monthMap.set(key, cur);
  }
  const row = (sales: number, returns: number, cost: number) => {
    const net = r2(sales - returns);
    const profit = r2(net - cost);
    return { sales: r2(sales), returns: r2(returns), net_sales: net, cost: r2(cost), profit, margin: net ? r2((profit / net) * 100) : 0 };
  };
  const byMonth = Array.from(monthMap.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, v]) => ({ month, ...row(v.sales, v.returns, v.cost) }));
  const total = row(byMonth.reduce((s, m) => s + m.sales, 0), byMonth.reduce((s, m) => s + m.returns, 0), byMonth.reduce((s, m) => s + m.cost, 0));
  const byProduct = products.map(p => {
    const net = r2(n(p.net_sales)), cost = r2(n(p.cost)), profit = r2(net - cost);
    return { product_id: n(p.product_id), product_name: p.name || 'Unknown', qty: n(p.qty), net_sales: net, cost, profit, margin: net ? r2((profit / net) * 100) : 0 };
  });
  return {
    success: true,
    total,
    byMonth,
    topProducts: byProduct.slice(0, productLimit),
    lossMaking: byProduct.filter(p => p.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 50),
    productCount: byProduct.length
  };
}
