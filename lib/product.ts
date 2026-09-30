import { prisma } from './db';

/**
 * Product business rules, in one place.
 *
 * These lived in pages/products/create.tsx - the browser decided what a product
 * was called, which GST rate applied, what its stock became, and whether it was
 * valid at all. The server accepted whatever arrived. That is how editing a
 * product came to reset its stock (F-75), and how an empty product name got
 * through a door that create keeps shut (F-79).
 *
 * The browser is entitled to decide what the user typed. It is not entitled to
 * decide what the record means.
 */

export interface ProductInput {
  [key: string]: any;
}

export interface ValidationFailure {
  status: number;
  message: string;
}

/**
 * Fields the server owns outright. A client that sends one of these is ignored,
 * not trusted:
 *
 *   product_name - built from the category, subcategory, company, car models
 *                  and part number the product points at (PQ-12). The browser
 *                  used to build it from whatever dropdown lists it had loaded.
 *   stock        - derived from purchases, sales and returns. The form has no
 *                  field for it, yet it was sending one (F-75, F-85).
 *   rack_number  - denormalised from rack_id, which the server already has (F-84).
 *   display_name - the name with the id in front; rewritten with the name on
 *                  every save, not only on create (PQ-55).
 *   is_active    - owned by the deactivate path.
 *   last_purchase_date / latest_purchase_rate - maintained by the purchase flow.
 */
export const SERVER_OWNED_FIELDS = [
  'product_name',
  'stock',
  'rack_number',
  'display_name',
  'is_active',
  'last_purchase_date',
  'latest_purchase_rate'
];

const blank = (v: any) => v === undefined || v === null || String(v).trim() === '';

/** A whole number, or null when blank. `undefined` means "not a number". */
const toInt = (v: any): number | null | undefined => {
  if (blank(v)) return null;
  const t = String(v).trim();
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : undefined;
};

/** A finite number, or null when blank. `undefined` means "not a number". */
const toFloat = (v: any): number | null | undefined => {
  if (blank(v)) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
};

const INT_FIELDS: Array<[string, string]> = [
  ['warehouse_id', 'Warehouse'], ['product_category_id', 'Category'], ['product_subcategory_id', 'Subcategory'],
  ['company_id', 'Company'], ['gst_rate_id', 'GST rate'], ['rack_id', 'Rack'],
  ['min_stock', 'Minimum stock'], ['opening_stock', 'Opening stock']
];
const MONEY_FIELDS: Array<[string, string]> = [
  ['opening_rate', 'Opening rate'], ['mrp', 'MRP'], ['discount', 'Discount'], ['margin', 'Margin']
];
// Quantities and money cannot be negative (F-110; the likely route to F-73).
const NON_NEGATIVE = ['opening_stock', 'min_stock', 'opening_rate', 'mrp', 'discount', 'margin'];

/**
 * The product rules, enforced on the server for create and update alike
 * (F-79, F-86). `partial` is for updates: a field that was not sent is not
 * re-required; a field that WAS sent is validated either way.
 *
 * Numbers must be numbers: "12abc" used to be read as 12 and "abc" stored as
 * NULL without a word (PQ-45). Every lookup runs in one round of parallel
 * queries rather than up to seven in a row.
 */
export async function validateProduct(
  input: ProductInput,
  options: { partial?: boolean; productId?: number } = {}
): Promise<ValidationFailure | null> {
  const partial = options.partial === true;
  const sent = (field: string) => input[field] !== undefined;
  const bad = (message: string) => ({ status: 400, message });

  // 1. Shape: every sent number parses, nothing negative.
  const n: Record<string, number | null> = {};
  for (const [field, label] of INT_FIELDS) {
    if (!sent(field)) continue;
    const v = toInt(input[field]);
    if (v === undefined) return bad(`${label} must be a whole number`);
    n[field] = v;
  }
  for (const [field, label] of MONEY_FIELDS) {
    if (!sent(field)) continue;
    const v = toFloat(input[field]);
    if (v === undefined) return bad(`${label} must be a number`);
    n[field] = v;
  }
  for (const field of NON_NEGATIVE) {
    const v = n[field];
    if (v !== undefined && v !== null && v < 0) {
      const label = [...INT_FIELDS, ...MONEY_FIELDS].find(([f]) => f === field)![1];
      return bad(`${label} cannot be negative`);
    }
  }
  const modelIds = sent('car_model_ids')
    ? String(input.car_model_ids || '').split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (modelIds.some((id) => !/^\d+$/.test(id))) return bad('Car models must be a list of ids');

  // 2. Required on create.
  if (!partial || sent('warehouse_id')) {
    if (!n.warehouse_id) return bad('Warehouse is required');
  }
  if (!partial && !n.product_category_id) return bad('Category is required');
  if (!partial && !n.company_id) return bad('Company is required');

  // 3. Everything referenced exists - one parallel round.
  const [warehouse, category, company, subcategory, gstRate, rack, models, stored] = await Promise.all([
    n.warehouse_id ? prisma.warehouse.findUnique({ where: { id: n.warehouse_id }, select: { id: true } }) : null,
    n.product_category_id ? prisma.product_category.findUnique({ where: { id: n.product_category_id }, select: { id: true } }) : null,
    n.company_id ? prisma.product_company.findUnique({ where: { id: n.company_id }, select: { id: true } }) : null,
    n.product_subcategory_id ? prisma.product_subcategory.findUnique({ where: { id: n.product_subcategory_id }, select: { id: true } }) : null,
    n.gst_rate_id ? prisma.gst_tax_rate.findUnique({ where: { id: n.gst_rate_id }, select: { id: true } }) : null,
    n.rack_id ? prisma.warehouse_racks.findUnique({ where: { id: n.rack_id }, select: { warehouse_id: true } }) : null,
    modelIds.length ? prisma.car_models.count({ where: { id: { in: modelIds.map(Number) } } }) : 0,
    // The stored warehouse, for a rack sent without one (F-99).
    n.rack_id && !n.warehouse_id && partial && options.productId
      ? prisma.product.findUnique({ where: { id: options.productId }, select: { warehouse_id: true } })
      : null
  ]);

  if (n.warehouse_id && !warehouse) return bad('Invalid warehouse selected');
  if (n.product_category_id && !category) return bad('Invalid category selected');
  if (n.company_id && !company) return bad('Invalid company selected');
  if (n.product_subcategory_id && !subcategory) return bad('Invalid subcategory selected');
  if (n.gst_rate_id && !gstRate) return bad('Invalid GST rate selected');
  if (modelIds.length && models !== new Set(modelIds).size) return bad('A selected car model does not exist');
  if (n.rack_id) {
    if (!rack) return bad('Invalid rack selected');
    const warehouseId = n.warehouse_id ?? stored?.warehouse_id ?? null;
    if (warehouseId && rack.warehouse_id !== warehouseId) return bad('That rack belongs to a different warehouse');
  }

  return null;
}

/**
 * Part numbers are unique across ALL products, active or not - the database's
 * UNIQUE index does not care about is_active (F-100). MySQL's default collation
 * makes the comparison case-insensitive. `is_active` comes back so the caller
 * can say which case it is.
 */
export async function findConflictingPartNo(
  partNo: string | null | undefined,
  excludeProductId?: number
): Promise<{ id: number; is_active: boolean } | null> {
  if (!partNo || partNo.trim() === '') return null;
  return prisma.product.findFirst({
    where: { part_no: partNo.trim(), ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
    select: { id: true, is_active: true }
  });
}

/** The message both create and update give for a part-number clash. */
export function partNoConflictMessage(
  partNo: string,
  conflict: { id: number; is_active: boolean }
): string {
  const where = conflict.is_active
    ? `another product (ID: ${conflict.id})`
    : `a deactivated product (ID: ${conflict.id}), which still holds it`;
  return `Part number "${String(partNo).trim()}" is already in use by ${where}. Please use a different part number.`;
}

/**
 * rack_number is denormalised from rack_id. The browser used to look it up in
 * its own loaded list and send the string alongside the id; the server has the
 * id and can read the authoritative value (F-84).
 */
export async function resolveRackNumber(rackId: number | null): Promise<string | null> {
  if (!rackId) return null;
  const rack = await prisma.warehouse_racks.findUnique({
    where: { id: rackId },
    select: { rack_number: true }
  });
  return rack ? rack.rack_number : null;
}

/**
 * Translate a client payload into columns, taking ONLY client-writable fields.
 *
 * `partial: true` (update) includes a column only when the client actually sent
 * it, so anything not mentioned keeps its stored value. The previous update
 * wrote all 21 columns on every save with 0/null fallbacks, so omitting a field
 * silently zeroed it (F-78) - and sending `stock` reset the stock (F-75).
 */
export async function buildProductData(
  input: ProductInput,
  options: { partial?: boolean } = {}
): Promise<Record<string, any>> {
  const partial = options.partial === true;
  const data: Record<string, any> = {};
  const has = (field: string) => !partial || input[field] !== undefined;

  if (has('product_category_id')) data.product_category_id = toInt(input.product_category_id);
  if (has('product_subcategory_id')) data.product_subcategory_id = toInt(input.product_subcategory_id);
  if (has('car_model_ids')) {
    const ids = String(input.car_model_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    data.car_model_ids = ids.length ? ids.join(',') : null;
  }
  if (has('company_id')) data.company_id = toInt(input.company_id);
  if (has('part_no')) data.part_no = input.part_no ? String(input.part_no).trim() : null;
  if (has('min_stock')) data.min_stock = toInt(input.min_stock) || 0;
  if (has('opening_stock')) data.opening_stock = toInt(input.opening_stock) || 0;
  if (has('opening_rate')) data.opening_rate = toFloat(input.opening_rate) || 0;
  if (has('hsn')) data.hsn = input.hsn || null;
  if (has('descriptions')) data.descriptions = input.descriptions || null;
  if (has('notes')) data.notes = input.notes || null;
  if (has('mrp')) data.mrp = toFloat(input.mrp);
  if (has('discount')) data.discount = toFloat(input.discount);
  if (has('margin')) data.margin = toFloat(input.margin);
  if (has('warehouse_id')) data.warehouse_id = toInt(input.warehouse_id);
  if (has('gst_rate_id')) data.gst_rate_id = toInt(input.gst_rate_id);

  // rack_id and rack_number move together, and rack_number comes from the
  // server's own lookup rather than from whatever the client computed.
  if (has('rack_id')) {
    const rackId = toInt(input.rack_id) ?? null;
    data.rack_id = rackId;
    data.rack_number = await resolveRackNumber(rackId);
  }

  return data;
}

/** The stored columns a product's name is built from. */
export interface ProductNameParts {
  product_category_id?: number | null;
  product_subcategory_id?: number | null;
  company_id?: number | null;
  car_model_ids?: string | null;
  part_no?: string | null;
}

/**
 * The product's name, built on the server from the ids it points at (PQ-12).
 *
 * Same parts, in the same order, as the form's old generateProductDisplay():
 * car models, category, subcategory, company, part number - except that EVERY
 * car model is included, not just the first. The id goes in front, as it
 * always has once a product exists (F-77, by design).
 */
export async function buildProductName(id: number, parts: ProductNameParts): Promise<string> {
  const modelIds = (parts.car_model_ids || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  const [models, category, subcategory, company] = await Promise.all([
    modelIds.length
      ? prisma.car_models.findMany({ where: { id: { in: modelIds } }, select: { id: true, model_name: true } })
      : Promise.resolve([] as { id: number; model_name: string | null }[]),
    parts.product_category_id
      ? prisma.product_category.findUnique({ where: { id: parts.product_category_id }, select: { category_name: true } })
      : Promise.resolve(null),
    parts.product_subcategory_id
      ? prisma.product_subcategory.findUnique({ where: { id: parts.product_subcategory_id }, select: { subcategory_name: true } })
      : Promise.resolve(null),
    parts.company_id
      ? prisma.product_company.findUnique({ where: { id: parts.company_id }, select: { company_name: true } })
      : Promise.resolve(null)
  ]);

  // Keep the order the ids were stored in, not the order the query returned.
  const modelName = new Map(models.map((m) => [m.id, m.model_name]));
  const modelNames = modelIds.map((mid) => modelName.get(mid)).filter(Boolean).join(' / ');

  return [
    String(id),
    modelNames,
    category?.category_name,
    subcategory?.subcategory_name,
    company?.company_name,
    parts.part_no?.trim()
  ]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Selling price, one rule everywhere (PQ-39, owner decision 2026-09-30):
 * the latest purchase rate + margin - discount, or the opening rate + margin -
 * discount until the product has been purchased.
 */
export function sellingPrice(p: {
  latestPurchaseRate?: number | null;
  opening_rate?: number | null;
  margin?: number | null;
  discount?: number | null;
}): number {
  const base = p.latestPurchaseRate && p.latestPurchaseRate > 0 ? p.latestPurchaseRate : p.opening_rate || 0;
  return base + (p.margin || 0) - (p.discount || 0);
}
