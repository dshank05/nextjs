import type { NextApiRequest } from 'next';
import { prisma } from './db';
import { sellingPrice } from './product';
import { convertDateToTimestamp } from './date-utils';

/**
 * The product list (PQ-20): one parser, one parameterised SQL path (PQ-19),
 * one row shape.
 */

export interface ProductListQuery {
  page: number;
  limit: number;
  fetchAll: boolean;
  search: string;
  categoryId: number | null;
  subcategoryId: number | null;
  companyId: number | null;
  modelIds: number[];
  uid: number | null;
  partNo: string;
  quantity: number | null;
  stockFilter: 'all' | 'in_stock' | 'out_of_stock' | 'low_stock';
  startDate: number | null;
  endDate: number | null;
  /** 'true' | 'false' | 'all' — active only unless asked (F-107). */
  isActive: 'true' | 'false' | 'all';
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const first = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();
const int = (v: unknown) => {
  const n = parseInt(first(v), 10);
  return Number.isNaN(n) ? null : n;
};

const MAX_LIMIT = 500;

/** Sort keys and their SQL. `rate` orders by the value shown (PQ-11). */
const SORT_SQL: Record<string, string> = {
  id: 'p.id',
  product_name: 'p.product_name',
  part_no: 'p.part_no',
  stock: 'p.stock',
  min_stock: 'p.min_stock',
  rate: 'COALESCE(NULLIF(p.latest_purchase_rate, 0), p.opening_rate)',
  lastPurchaseDate: 'p.last_purchase_date',
  last_purchase_date: 'p.last_purchase_date',
  categoryName: 'pc.category_name',
  subcategoryName: 'psc.subcategory_name',
  companyName: 'pcm.company_name'
};

export function parseProductListQuery(req: NextApiRequest): ProductListQuery {
  const q = req.query;
  const rawLimit = int(q.limit);
  const stock = first(q.stockFilter);
  const isActive = first(q.isActive) || (first(q.includeInactive) === 'true' ? 'all' : 'true');
  const date = (v: unknown, endOfDay: boolean) => {
    const s = first(v);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    // Parsed by parts in local time (D-17), not with new Date('YYYY-MM-DD').
    return convertDateToTimestamp(s.slice(0, 10)) + (endOfDay ? 86399 : 0);
  };
  const sortBy = first(q.sortBy);
  return {
    page: Math.max(1, int(q.page) ?? 1),
    limit: rawLimit && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 50,
    fetchAll: first(q.fetchAll) === 'true',
    search: first(q.search),
    categoryId: int(q.category),
    subcategoryId: int(q.subcategory),
    companyId: int(q.company_id),
    modelIds: first(q.model).split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)),
    uid: int(q.uid),
    partNo: first(q.part_no),
    quantity: int(q.quantity),
    stockFilter: (['in_stock', 'out_of_stock', 'low_stock'].includes(stock) ? stock : 'all') as ProductListQuery['stockFilter'],
    startDate: date(q.startDate, false),
    endDate: date(q.endDate, true),
    isActive: (['true', 'false', 'all'].includes(isActive) ? isActive : 'true') as ProductListQuery['isActive'],
    sortBy: SORT_SQL[sortBy] ? sortBy : 'categoryName',
    sortOrder: first(q.sortOrder) === 'desc' ? 'desc' : 'asc'
  };
}

/** The four positions an id can take in the comma-joined car_model_ids (F-17). */
const CAR_MODEL_SQL = '(p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids LIKE ? OR p.car_model_ids = ?)';
const carModelParams = (id: number) => [`%,${id},%`, `${id},%`, `%,${id}`, String(id)];

export async function listProducts(q: ProductListQuery) {
  const where: string[] = [];
  const params: any[] = [];
  const add = (sql: string, ...values: any[]) => { where.push(sql); params.push(...values); };

  if (q.isActive !== 'all') add('p.is_active = ?', q.isActive === 'true');
  if (q.uid !== null) add('p.id = ?', q.uid);
  if (q.categoryId !== null) add('p.product_category_id = ?', q.categoryId);
  if (q.subcategoryId !== null) add('p.product_subcategory_id = ?', q.subcategoryId);
  if (q.companyId !== null) add('p.company_id = ?', q.companyId);
  if (q.partNo) add('p.part_no LIKE ?', `%${q.partNo}%`);
  if (q.search) add('(p.display_name LIKE ? OR p.product_name LIKE ? OR p.part_no LIKE ?)', `%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  // An exact quantity is the more specific request and wins over a stock status.
  if (q.quantity !== null) add('p.stock = ?', q.quantity);
  else if (q.stockFilter === 'in_stock') add('p.stock > 0');
  // <= 0: a product at -1 is out of stock too (F-73).
  else if (q.stockFilter === 'out_of_stock') add('p.stock <= 0');
  // Below a minimum someone actually set; 0 or NULL means none was (F-70).
  if (q.stockFilter === 'low_stock') add('p.min_stock IS NOT NULL AND p.min_stock > 0 AND p.stock < p.min_stock');
  if (q.startDate !== null) add('p.last_purchase_date >= ?', q.startDate);
  if (q.endDate !== null) add('p.last_purchase_date <= ?', q.endDate);
  if (q.modelIds.length) {
    add(`(${q.modelIds.map(() => CAR_MODEL_SQL).join(' OR ')})`, ...q.modelIds.flatMap(carModelParams));
  }

  const from = `
    FROM product p
    LEFT JOIN product_category pc ON p.product_category_id = pc.id
    LEFT JOIN product_subcategory psc ON p.product_subcategory_id = psc.id
    LEFT JOIN product_company pcm ON p.company_id = pcm.id
    LEFT JOIN gst_tax_rate g ON p.gst_rate_id = g.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;

  // Sort column and direction come from SORT_SQL and a two-value check, so
  // neither is user text; id breaks ties so paging is stable.
  const order = `ORDER BY ${SORT_SQL[q.sortBy]} ${q.sortOrder}, p.id ${q.sortOrder}`;
  const page = q.fetchAll ? '' : 'LIMIT ? OFFSET ?';
  const pageParams = q.fetchAll ? [] : [q.limit, (q.page - 1) * q.limit];

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count ${from}`, ...params) as Promise<any[]>,
    prisma.$queryRawUnsafe(
      `SELECT p.*, pc.category_name, psc.subcategory_name, pcm.company_name, g.rate AS gst_rate_value ${from} ${order} ${page}`,
      ...params, ...pageParams
    ) as Promise<any[]>
  ]);
  const total = Number(countRows[0]?.count ?? 0);

  const ids = rows.map((r) => r.id);
  const modelIds = Array.from(new Set(rows.flatMap((r) => parseIds(r.car_model_ids))));
  const [rates, models] = await Promise.all([
    latestPurchaseRates(ids),
    modelIds.length
      ? prisma.car_models.findMany({ where: { id: { in: modelIds } }, select: { id: true, model_name: true } })
      : Promise.resolve([] as { id: number; model_name: string }[])
  ]);
  const modelName = new Map(models.map((m) => [m.id, m.model_name]));

  const products = rows.map((p) => {
    const latest = rates.get(p.id);
    const latestRate = latest?.rate || p.latest_purchase_rate || null;
    const lastPurchase = p.last_purchase_date || latest?.date || null;
    return {
      id: p.id,
      product_name: p.product_name,
      display_name: p.display_name || undefined,
      part_no: p.part_no || '',
      stock: p.stock ?? 0,
      min_stock: p.min_stock ?? 0,
      is_active: Boolean(p.is_active),
      product_category_id: p.product_category_id ?? undefined,
      categoryName: p.category_name || '',
      product_subcategory_id: p.product_subcategory_id ?? undefined,
      subcategoryName: p.subcategory_name || undefined,
      company_id: p.company_id ?? undefined,
      companyName: p.company_name || '',
      car_model_ids: p.car_model_ids || undefined,
      carModelsDisplay: parseIds(p.car_model_ids).map((id) => modelName.get(id)).filter(Boolean).join(', ') || undefined,
      hsn: p.hsn || undefined,
      pic: p.pic || undefined,
      barcode: p.barcode || undefined,
      opening_rate: p.opening_rate || 0,
      latest_purchase_rate: latestRate,
      // The Rate column: latest purchase rate, else opening rate.
      rate: latestRate || p.opening_rate || 0,
      latestPurchaseRate: latestRate || p.opening_rate || 0,
      latest_selling_price: sellingPrice({ latestPurchaseRate: latestRate, opening_rate: p.opening_rate, margin: p.margin, discount: p.discount }),
      gst_rate_id: p.gst_rate_id ?? undefined,
      gst_rate_percentage: p.gst_rate_value ?? 0,
      // ISO; formatted in the browser, not in the server's timezone (PQ-38).
      lastPurchaseDate: lastPurchase ? new Date(Number(lastPurchase) * 1000).toISOString() : null
    };
  });

  const totalPages = q.fetchAll ? 1 : Math.max(1, Math.ceil(total / q.limit));
  return {
    products,
    pagination: {
      page: q.fetchAll ? 1 : q.page,
      limit: q.fetchAll ? total : q.limit,
      total,
      totalPages,
      hasMore: !q.fetchAll && q.page < totalPages
    }
  };
}

function parseIds(csv: string | null | undefined): number[] {
  return (csv || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

/**
 * Latest purchase rate per product: newest date, highest rate on a tie (PQ-22).
 * On failure: logged, empty, callers use the stored columns.
 */
export async function latestPurchaseRates(productIds: number[]): Promise<Map<number, { rate: number; date: number }>> {
  const map = new Map<number, { rate: number; date: number }>();
  if (!productIds.length) return map;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT product_id, rate, invoice_date FROM (
         SELECT product_id, rate, invoice_date,
                ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY invoice_date DESC, rate DESC) AS rn
         FROM purchase_items
         WHERE product_id IN (${productIds.map(() => '?').join(',')}) AND rate > 0
       ) latest WHERE rn = 1`,
      ...productIds
    )) as any[];
    for (const r of rows) map.set(Number(r.product_id), { rate: Number(r.rate), date: Number(r.invoice_date) });
  } catch (error) {
    console.error('Latest purchase rates failed; using stored rates:', error);
  }
  return map;
}
