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

const toInt = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
};

const toFloat = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
};

/**
 * The rules validateForm() enforces in the browser, enforced where they cannot
 * be bypassed.
 *
 * `partial` is for updates: a field that was not sent is not being changed, so
 * it is not re-required. A field that WAS sent is validated either way.
 */
export async function validateProduct(
  input: ProductInput,
  options: { partial?: boolean; productId?: number } = {}
): Promise<ValidationFailure | null> {
  const partial = options.partial === true;
  const supplied = (field: string) => input[field] !== undefined;

  if (!partial || supplied('warehouse_id')) {
    const warehouseId = toInt(input.warehouse_id);
    if (!warehouseId) {
      return { status: 400, message: 'Warehouse is required' };
    }
    if (!(await prisma.warehouse.findUnique({ where: { id: warehouseId } }))) {
      return { status: 400, message: 'Invalid warehouse selected' };
    }
  }

  if (!partial || supplied('product_category_id')) {
    const categoryId = toInt(input.product_category_id);
    if (!partial && !categoryId) {
      return { status: 400, message: 'Category is required' };
    }
    if (categoryId && !(await prisma.product_category.findUnique({ where: { id: categoryId } }))) {
      return { status: 400, message: 'Invalid category selected' };
    }
  }

  if (!partial || supplied('company_id')) {
    const companyId = toInt(input.company_id);
    if (!partial && !companyId) {
      return { status: 400, message: 'Company is required' };
    }
    if (companyId && !(await prisma.product_company.findUnique({ where: { id: companyId } }))) {
      return { status: 400, message: 'Invalid company selected' };
    }
  }

  if (supplied('product_subcategory_id')) {
    const subcategoryId = toInt(input.product_subcategory_id);
    if (subcategoryId && !(await prisma.product_subcategory.findUnique({ where: { id: subcategoryId } }))) {
      return { status: 400, message: 'Invalid subcategory selected' };
    }
  }

  if (supplied('gst_rate_id')) {
    const gstRateId = toInt(input.gst_rate_id);
    if (gstRateId && !(await prisma.gst_tax_rate.findUnique({ where: { id: gstRateId } }))) {
      return { status: 400, message: 'Invalid GST rate selected' };
    }
  }

  // Quantities and money cannot be negative.
  //
  // Nothing checked this anywhere - not the form, which uses <input
  // type="number"> with no `min`, and not the server. Product 211 currently
  // holds `stock = -1` with `opening_stock = -1` behind it, and a negative
  // opening stock is the only way in through this endpoint, so this is very
  // likely how it got there (F-73, F-110). A negative opening stock also
  // becomes the starting `stock` on create, and `opening_stock` is the baseline
  // the stock reconciliation assertion measures against.
  const NON_NEGATIVE: Array<[string, string]> = [
    ['opening_stock', 'Opening stock'],
    ['min_stock', 'Minimum stock'],
    ['opening_rate', 'Opening rate'],
    ['mrp', 'MRP'],
    ['discount', 'Discount'],
    ['margin', 'Margin']
  ];
  for (const [field, label] of NON_NEGATIVE) {
    if (!supplied(field)) continue;
    const value = toFloat(input[field]);
    if (value !== null && value < 0) {
      return { status: 400, message: `${label} cannot be negative` };
    }
  }

  if (supplied('rack_id')) {
    const rackId = toInt(input.rack_id);
    if (rackId) {
      const rack = await prisma.warehouse_racks.findUnique({ where: { id: rackId } });
      if (!rack) {
        return { status: 400, message: 'Invalid rack selected' };
      }

      // Which warehouse to check the rack against: the one in this payload if
      // it was sent, otherwise the one already stored on the product.
      //
      // The stored fallback is the point. This only compared against
      // `input.warehouse_id`, so on a partial update carrying `rack_id` alone
      // the check was skipped entirely and a product could be moved to a rack
      // in a completely different warehouse (F-99). The form always sends both,
      // which is why nothing noticed - but the whole reason the rules moved to
      // the server is that the form is not the only caller.
      let warehouseId = toInt(input.warehouse_id);
      if (!warehouseId && partial && options.productId) {
        const current = await prisma.product.findUnique({
          where: { id: options.productId },
          select: { warehouse_id: true }
        });
        warehouseId = current?.warehouse_id ?? null;
      }

      if (warehouseId && rack.warehouse_id !== warehouseId) {
        return { status: 400, message: 'That rack belongs to a different warehouse' };
      }
    }
  }

  return null;
}

/**
 * Part numbers are unique across ALL products, case-insensitively.
 *
 * Across all of them, not just the active ones. `part_no` carries a database
 * level UNIQUE index that does not care about `is_active`, and since F-63 made
 * delete a deactivation rather than a delete, inactive rows stay in the table
 * holding their part numbers. Checking only active products meant the app said
 * yes and the database then said no, surfacing as a confusing constraint error
 * against a product the user could not see anywhere in the UI (F-100).
 *
 * `is_active` comes back so the caller can say which case it is.
 */
export async function findConflictingPartNo(
  partNo: string | null | undefined,
  excludeProductId?: number
): Promise<{ id: number; is_active: boolean } | null> {
  if (!partNo || partNo.trim() === '') return null;
  const trimmed = partNo.trim();

  const rows = excludeProductId
    ? (await prisma.$queryRaw`
        SELECT id, is_active FROM product
        WHERE LOWER(part_no) = LOWER(${trimmed}) AND id != ${excludeProductId}
        LIMIT 1` as any[])
    : (await prisma.$queryRaw`
        SELECT id, is_active FROM product
        WHERE LOWER(part_no) = LOWER(${trimmed})
        LIMIT 1` as any[]);

  return rows.length > 0
    ? { id: rows[0].id, is_active: Boolean(rows[0].is_active) }
    : null;
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
  if (has('car_model_ids')) data.car_model_ids = input.car_model_ids || null;
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
    const rackId = toInt(input.rack_id);
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
