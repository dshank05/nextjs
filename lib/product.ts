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
 *   stock        - derived from purchases, sales and returns. The form has no
 *                  field for it, yet it was sending one (F-75, F-85).
 *   rack_number  - denormalised from rack_id, which the server already has (F-84).
 *   display_name - composed from the id, which only exists after insert.
 *   is_active    - owned by the deactivate path.
 *   last_purchase_date / latest_purchase_rate - maintained by the purchase flow.
 */
export const SERVER_OWNED_FIELDS = [
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
  options: { partial?: boolean } = {}
): Promise<ValidationFailure | null> {
  const partial = options.partial === true;
  const supplied = (field: string) => input[field] !== undefined;

  if (supplied('product_name') && String(input.product_name || '').trim() === '') {
    return { status: 400, message: 'Product name cannot be empty' };
  }
  if (!partial && !String(input.product_name || '').trim()) {
    return { status: 400, message: 'Product name is required' };
  }

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

  if (supplied('rack_id')) {
    const rackId = toInt(input.rack_id);
    if (rackId) {
      const rack = await prisma.warehouse_racks.findUnique({ where: { id: rackId } });
      if (!rack) {
        return { status: 400, message: 'Invalid rack selected' };
      }
      const warehouseId = toInt(input.warehouse_id);
      if (warehouseId && rack.warehouse_id !== warehouseId) {
        return { status: 400, message: 'That rack belongs to a different warehouse' };
      }
    }
  }

  return null;
}

/** Part numbers are unique among active products, case-insensitively. */
export async function findConflictingPartNo(
  partNo: string | null | undefined,
  excludeProductId?: number
): Promise<{ id: number } | null> {
  if (!partNo || partNo.trim() === '') return null;
  const trimmed = partNo.trim();

  const rows = excludeProductId
    ? (await prisma.$queryRaw`
        SELECT id FROM product
        WHERE LOWER(part_no) = LOWER(${trimmed}) AND is_active = true AND id != ${excludeProductId}
        LIMIT 1` as any[])
    : (await prisma.$queryRaw`
        SELECT id FROM product
        WHERE LOWER(part_no) = LOWER(${trimmed}) AND is_active = true
        LIMIT 1` as any[]);

  return rows.length > 0 ? { id: rows[0].id } : null;
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

  if (input.product_name !== undefined) data.product_name = String(input.product_name).trim();
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
