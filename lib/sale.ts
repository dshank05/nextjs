import { prisma } from './db';
import { getBusinessStateCode, resolveSupplyType, SupplyType } from './gst';
import { computeBill, packingAmount, Bill } from './line-math';
import { toNumber, num, lineQty, PAYMENT_STATUS, CLIENT_SETTABLE_PAYMENT_STATUSES, VALID_PAYMENT_MODES } from './purchase';

/**
 * Sale and salex business rules, in one place - the lib/purchase.ts shape.
 *
 * Sale (GST invoice) and salex ("Invoice C", tax-free) are the same document
 * stored in two families of tables. They used to be two hand-copied APIs that
 * had drifted: sale read `fy` from the body and salex did not; sale took tax
 * from the browser and salex took EVERY amount from it; salex stored P&F as
 * null and sale as 0 (docs/SALE_AUDIT.md SA-04, SA-06, SA-09, SA-31). Now both
 * go through these functions, and the arithmetic is lib/line-math.ts
 * `computeBill`, the function purchase uses too.
 *
 * The browser decides what the user typed. The server decides what it means.
 */

export type SaleKind = 'sale' | 'salex';

/**
 * Prisma names for the two families. Lines and snapshots store the HEADER id
 * in their `invoice_no` column (not the printed number), and the salex tables
 * do not follow the sale names - `invoicexitems` does not exist and the
 * return-line FK is `invoice_itemx_id`.
 */
export const SALE_TABLES = {
  sale: {
    kind: 'sale' as SaleKind,
    label: 'Sale',
    header: 'invoice',
    items: 'invoiceitems',
    returns: 'sale_returns',
    returnItems: 'sale_return_items',
    returnFk: 'sale_return_id',
    returnItemFk: 'invoice_item_id',
    returnHeaderFk: 'invoice_id',
    returnRelation: 'sale_return',
    billTo: 'bill_tosales',
    shipTo: 'shipto',
    transport: 'transport_details',
    allocFk: 'invoice_id',
    counter: 'invoice' as const,
    taxFree: false
  },
  salex: {
    kind: 'salex' as SaleKind,
    label: 'Invoice C',
    header: 'invoicex',
    items: 'invoice_itemsx',
    returns: 'salex_returns',
    returnItems: 'salex_return_items',
    returnFk: 'salex_return_id',
    returnItemFk: 'invoice_itemx_id',
    returnHeaderFk: 'invoicex_id',
    returnRelation: 'salex_return',
    billTo: 'bill_tosalesx',
    shipTo: 'shiptox',
    transport: 'transport_detailsx',
    allocFk: 'invoicex_id',
    counter: 'invoicex' as const,
    taxFree: true
  }
} as const;

export type SaleTables = (typeof SALE_TABLES)[SaleKind];

export function saleTables(kind: string): SaleTables {
  const t = (SALE_TABLES as any)[kind];
  if (!t) throw new Error(`Unknown invoice type: ${kind}`);
  return t;
}

/** A refusal the route turns into a 4xx with this message and code. */
export class SaleError extends Error {
  constructor(
    public httpStatus: number,
    public clientMessage: string,
    public code: string,
    public detail?: unknown
  ) {
    super(code);
  }
}

export const intOrNull = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

/** The customer the request names: `select_customer`, or the older `customer_id`. 0 is "Other". */
export const requestedCustomer = (body: any): number | null =>
  intOrNull(body?.select_customer !== undefined && body?.select_customer !== null && body?.select_customer !== ''
    ? body.select_customer
    : body?.customer_id);

/** Freight: sale forms call it transport_cost, salex calls it freight. */
export const requestedFreight = (body: any): any =>
  body?.transport_cost !== undefined ? body.transport_cost : body?.freight;

/** The lines: `invoiceItems` (both forms) or `items`. */
export const requestedItems = (body: any): any[] | undefined =>
  Array.isArray(body?.invoiceItems) ? body.invoiceItems : Array.isArray(body?.items) ? body.items : undefined;

export interface SaleTotals {
  bill: Bill;
  supplyType: SupplyType | null;
  packing: { qty: number; rate: number; total: number };
}

/**
 * Every money figure on a sale or salex, from the lines, P&F, freight and the
 * bill's state. Freight IS part of a sale's total (owner, 2026-10-02); purchase
 * keeps it outside.
 *
 * Salex is tax-free: GST is forced to 0 whatever the lines carry, and no
 * state is needed.
 */
export function computeSaleTotals(params: {
  kind: SaleKind;
  items: any[];
  packingQty?: any;
  packingRate?: any;
  packingTotal?: any;
  freight?: any;
  stateCode?: number | null;
  businessGstin?: string | null;
}): SaleTotals {
  const t = saleTables(params.kind);
  const supplyType: SupplyType | null = t.taxFree
    ? 'INTRA_STATE'
    : resolveSupplyType(params.stateCode, getBusinessStateCode(params.businessGstin), params.stateCode != null);
  const packing = packingAmount(params.packingQty, params.packingRate, params.packingTotal);
  const bill = computeBill(
    (params.items || []).map((i: any) => ({
      qty: i.qty,
      rate: i.rate,
      gst_percentage: i.gst_percentage,
      discount: i.discount_amount !== undefined ? i.discount_amount : i.discount
    })),
    { supplyType, taxFree: t.taxFree, packingTotal: packing.total, freight: num(params.freight) }
  );
  return { bill, supplyType, packing };
}

/**
 * The rules create and edit both enforce. `partial` (edit): a field that was
 * not sent is not being changed, so it is not re-required.
 */
export async function validateSale(
  kind: SaleKind,
  input: any,
  options: { partial?: boolean } = {}
): Promise<SaleError | null> {
  const partial = options.partial === true;
  const supplied = (f: string) => input[f] !== undefined;
  const bad = (message: string) => new SaleError(400, message, 'VALIDATION');

  const items = requestedItems(input);
  if (!partial || items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) return bad('A bill needs at least one line item');
    for (const item of items) {
      const productId = intOrNull(item?.product_id);
      if (!productId) return bad('Every line needs a valid product');
      for (const [field, label] of [['qty', 'Quantity'], ['rate', 'Rate'], ['gst_percentage', 'GST %']]) {
        if (Number.isNaN(toNumber(item[field]))) return bad(`${label} must be a number`);
      }
      const discountRaw = item.discount_amount !== undefined ? item.discount_amount : item.discount;
      if (Number.isNaN(toNumber(discountRaw))) return bad('Discount must be a number');
      if (lineQty(item.qty) < 1) return bad('Every line needs a quantity of at least 1');
      if (num(item.rate) < 0) return bad('Rates cannot be negative');
      const gst = num(item.gst_percentage);
      if (gst < 0 || gst > 100) return bad('A GST percentage must be between 0 and 100');
      const discount = num(discountRaw);
      if (discount < 0) return bad('A discount cannot be negative');
      if (discount > lineQty(item.qty) * num(item.rate) + 0.005) return bad('A discount cannot be more than the line amount');
    }
  }

  const customerId = requestedCustomer(input);
  if (!partial || customerId !== null) {
    if (customerId === null) return bad('A customer is required');
    if (customerId !== 0 && !(await prisma.customer_details.findUnique({ where: { id: customerId }, select: { id: true } }))) {
      return bad('Invalid customer selected - customer does not exist');
    }
  }

  if (!partial || supplied('payment_status')) {
    const status = input.payment_status;
    const parsed = status === undefined || status === null || status === '' ? 0 : parseInt(String(status), 10);
    if (!CLIENT_SETTABLE_PAYMENT_STATUSES.includes(parsed)) {
      return bad('Invalid payment_status: must be 0 (Unpaid) or 1 (Paid). Partial is derived from allocations, not set directly.');
    }
    if (parsed === PAYMENT_STATUS.PAID && (input.payment_mode === undefined || input.payment_mode === null || input.payment_mode === '')) {
      return bad('Payment mode (Cash/Bank) is required for a paid bill');
    }
  }
  if (supplied('payment_mode') && input.payment_mode !== null && input.payment_mode !== '') {
    if (!VALID_PAYMENT_MODES.includes(parseInt(String(input.payment_mode), 10))) {
      return bad('Invalid payment_mode: must be 0 (Cash) or 1 (Bank)');
    }
  }

  for (const [field, label] of [
    ['packing_forwarding_qty', 'Packing/forwarding quantity'],
    ['packing_forwarding_rate', 'Packing/forwarding rate'],
    ['packing_forwarding_total', 'Packing/forwarding total'],
    ['transport_cost', 'Freight'],
    ['freight', 'Freight'],
    ['commission', 'Commission']
  ] as Array<[string, string]>) {
    if (supplied(field)) {
      if (Number.isNaN(toNumber(input[field]))) return bad(`${label} must be a number`);
      if (num(input[field]) < 0) return bad(`${label} cannot be negative`);
    }
  }

  for (const [field, model, label] of [['staff_id', 'staff', 'staff member'], ['mechanic_id', 'mechanic', 'mechanic']] as const) {
    if (supplied(field) && input[field] !== null && input[field] !== '') {
      const id = intOrNull(input[field]);
      if (id === null || !(await (prisma as any)[model].findUnique({ where: { id }, select: { id: true } }))) {
        return bad(`Invalid ${label} selected`);
      }
    }
  }

  // "Other" is a walk-in: the bill itself has to say who it was.
  if (!partial && customerId === 0) {
    if (!String(input.customer_name ?? '').trim()) return bad('Customer name is required for an "Other" customer');
    if (!String(input.contact_number ?? '').trim()) return bad('Phone number is required for an "Other" customer');
  }

  void kind;
  return null;
}

/**
 * Stock for a set of lines, checked per PRODUCT, not per line: two lines of one
 * product each passed against the full stock before (SA-14). `held` is what
 * this bill already took out (edit), which is available to it again.
 */
export async function assertStock(
  tx: any,
  need: Map<number, number>,
  held: Map<number, number> = new Map()
): Promise<void> {
  const ids = Array.from(need.keys());
  if (!ids.length) return;
  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, product_name: true, stock: true } });
  const byId = new Map<number, any>(products.map((p: any) => [p.id, p]));
  for (const [productId, qty] of Array.from(need.entries())) {
    const p = byId.get(productId);
    if (!p) throw new SaleError(400, 'A selected product does not exist', 'UNKNOWN_PRODUCT');
    const available = (p.stock || 0) + (held.get(productId) || 0);
    if (qty > available) {
      throw new SaleError(
        400,
        `Insufficient stock for "${p.product_name}": available ${available}, requested ${qty}`,
        'INSUFFICIENT_STOCK',
        { product_id: productId, product_name: p.product_name, available, requested: qty }
      );
    }
  }
}

/** The bill's state code: what the request says, else the customer master's. */
export function billStateCode(body: any, fallback: number | null | undefined): number | null {
  if (body && body.state_code !== undefined && body.state_code !== null && body.state_code !== '') {
    return intOrNull(body.state_code);
  }
  return fallback ?? null;
}

/** A date from the form (YYYY-MM-DD) or a unix timestamp in seconds. */
export function requestedDate(body: any, convert: (s: string) => number): number | null {
  const raw = body?.date ?? body?.invoice_date;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return raw > 1000000000 ? Math.floor(raw) : null;
  if (/^\d{9,}$/.test(String(raw))) return parseInt(String(raw), 10);
  return convert(String(raw));
}
