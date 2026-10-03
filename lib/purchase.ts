import { prisma } from './db';
import { getBusinessStateCode, resolveSupplyType, SupplyType } from './gst';
import { computeBill } from './line-math';

/**
 * Purchase business rules, in one place.
 *
 * The same module shape as lib/product.ts, for the same reason. Before this,
 * create and update each had their own copy of every rule and the copies had
 * drifted:
 *
 *   - create accepted payment_status 0 or 1; update accepted 0, 1 or 2 (L-5)
 *   - create stored the client's packing_forwarding_total as sent; update
 *     RECOMPUTED it from qty x rate, so the same input produced different
 *     totals depending on which path wrote it (L-20)
 *   - update computed all three totals inside `if (items && Array.isArray(...))`,
 *     so an edit that omitted items wrote total = 0 (L-21)
 *   - both stored whatever CGST/SGST/IGST the client sent, with nothing
 *     checking them against total_tax - a purchase was observed holding
 *     total_tax = 0 while its components summed to 36 (L-22)
 *
 * The browser decides what the user typed. The server decides what the record
 * means.
 */

export interface PurchaseInput {
  [key: string]: any;
}

export interface ValidationFailure {
  status: number;
  message: string;
}

/**
 * Fields the server owns outright. A client that sends one of these is ignored:
 *
 *   invoice_no       - allocated by lib/invoice-counter and guarded by
 *                      UNIQUE(fy, invoice_no). A client picking its own number
 *                      is a separate, explicit action, not a field on the form.
 *   fy               - taken from settings.currentfy, never from the payload.
 *   items_total, total_taxable_value, total_tax, total_cgst, total_sgst,
 *   total_igst, total  - all derived from the lines below.
 *   return_status    - maintained by the purchase-return flow.
 */
export const SERVER_OWNED_FIELDS = [
  'invoice_no',
  'fy',
  'items_total',
  'total_taxable_value',
  'total_tax',
  'total_cgst',
  'total_sgst',
  'total_igst',
  'total',
  'return_status'
];

/** Valid payment states, shared by create and update so they cannot drift. */
export const PAYMENT_STATUS = { UNPAID: 0, PAID: 1, PARTIAL: 2 } as const;

/**
 * Partial (2) is deliberately NOT settable by a client on either path.
 *
 * It is a DERIVED state: a purchase is partial when its allocations cover some
 * but not all of its total. The update path already computes it that way and
 * overrides whatever it was sent. Letting a client assert it directly is how
 * payment_status and payment_allocations come to disagree, which assertion A3
 * exists to catch.
 */
export const CLIENT_SETTABLE_PAYMENT_STATUSES: number[] = [
  PAYMENT_STATUS.UNPAID,
  PAYMENT_STATUS.PAID
];

export const VALID_PAYMENT_MODES = [0, 1]; // 0 = Cash, 1 = Bank

/**
 * Strict parse: a missing or empty field is 0, anything that is not wholly a
 * number is NaN. parseFloat read "12abc" as 12 (PU-34).
 */
export const toNumber = (v: any): number => {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** One numeric coercion for every amount, so a missing field is 0, never NaN. */
export const num = (v: any): number => {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Quantities are whole units (owner decision, PU-33). Rounded once, here, so the
 * stored line and the stock movement are the same number.
 */
export const lineQty = (v: any): number => Math.round(num(v));

export interface PurchaseLineTotals {
  product_id: number;
  qty: number;
  rate: number;
  taxable: number;
  gst_percentage: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface PurchaseTotals {
  lines: PurchaseLineTotals[];
  itemsTotal: number;
  packingTotal: number;
  totalTax: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
  supplyType: SupplyType | null;
}

/**
 * Compute every money figure on a purchase from the lines and the two state
 * codes. Nothing here is read from the payload's own totals.
 *
 * On a PURCHASE the roles are reversed relative to a sale: the VENDOR is the
 * supplier and we are the recipient, so the comparison is the vendor's state
 * against ours. `resolveSupplyType` only tests the two codes for equality, so
 * it serves both directions.
 *
 * The arithmetic itself - including the F-34 rounding - is lib/line-math.ts
 * `computeBill`, the same function sale and salex use, so the documents
 * cannot round differently. Freight (transport_cost) is stored beside a
 * purchase and is NOT part of its total; that is existing, intended behaviour.
 */
export function computePurchaseTotals(params: {
  items: any[];
  packingQty?: any;
  packingRate?: any;
  packingTotal?: any;
  vendorStateCode?: number | null;
  businessGstin?: string | null;
  hasVendorState?: boolean;
}): PurchaseTotals {
  const businessStateCode = getBusinessStateCode(params.businessGstin);
  const supplyType = resolveSupplyType(
    params.vendorStateCode,
    businessStateCode,
    params.hasVendorState
  );

  // Packing is always derived from qty x rate when either is sent. Create used
  // to store the client's packing_forwarding_total verbatim while update
  // recomputed it (L-20); the derived one is the only one that cannot be wrong.
  const packingTotal =
    params.packingQty !== undefined || params.packingRate !== undefined
      ? num(params.packingQty) * num(params.packingRate)
      : num(params.packingTotal);

  const items = params.items || [];
  // Purchases carry no discount (P4-21), so none is passed through.
  const bill = computeBill(
    items.map((item: any) => ({ qty: item.qty, rate: item.rate, gst_percentage: item.gst_percentage })),
    { supplyType, packingTotal }
  );

  return {
    lines: bill.lines.map((l, i) => ({
      product_id: parseInt(items[i].product_id),
      qty: l.qty,
      rate: l.rate,
      taxable: l.taxable,
      gst_percentage: l.gst_percentage,
      tax: l.tax,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst
    })),
    itemsTotal: bill.itemsTotal,
    packingTotal: bill.packingTotal,
    totalTax: bill.totalTax,
    totalCgst: bill.totalCgst,
    totalSgst: bill.totalSgst,
    totalIgst: bill.totalIgst,
    grandTotal: bill.grandTotal,
    supplyType
  };
}

/**
 * The rules both create and update enforce.
 *
 * `partial` is for updates: a field that was not sent is not being changed, so
 * it is not re-required. A field that WAS sent is validated either way.
 */
export async function validatePurchase(
  input: PurchaseInput,
  options: { partial?: boolean } = {}
): Promise<ValidationFailure | null> {
  const partial = options.partial === true;
  const supplied = (field: string) => input[field] !== undefined;

  // Items
  if (!partial || supplied('items')) {
    const items = input.items;
    if (!Array.isArray(items) || items.length === 0) {
      return { status: 400, message: 'A purchase needs at least one line item' };
    }
    for (const item of items) {
      const productId = parseInt(item?.product_id);
      if (!productId || isNaN(productId)) {
        return { status: 400, message: 'Every line needs a valid product' };
      }
      for (const [field, label] of [['qty', 'Quantity'], ['rate', 'Rate'], ['gst_percentage', 'GST %']]) {
        if (Number.isNaN(toNumber(item[field]))) {
          return { status: 400, message: `${label} must be a number` };
        }
      }
      if (lineQty(item.qty) < 1) {
        return { status: 400, message: 'Every line needs a quantity of at least 1' };
      }
      if (num(item.rate) < 0) {
        return { status: 400, message: 'Rates cannot be negative' };
      }
      const gst = num(item.gst_percentage);
      if (gst < 0 || gst > 100) {
        return { status: 400, message: 'A GST percentage must be between 0 and 100' };
      }
    }
  }

  // Vendor. 0 is the "Other" vendor and is a real row - see
  // scripts/audit-seed-vendors.js and lead L-10.
  if (!partial || supplied('vendor_id')) {
    const raw = input.vendor_id;
    if (raw === undefined || raw === null || raw === '') {
      return { status: 400, message: 'A vendor is required' };
    }
    const vendorId = parseInt(String(raw));
    if (isNaN(vendorId)) {
      return { status: 400, message: 'Invalid vendor selected' };
    }
    if (!(await prisma.vendor_details.findUnique({ where: { id: vendorId } }))) {
      return { status: 400, message: 'Invalid vendor selected - vendor does not exist' };
    }
  }

  // Payment status and mode
  if (!partial || supplied('payment_status')) {
    const status = input.payment_status;
    const parsed = status === undefined || status === null ? 0 : parseInt(String(status));
    if (!CLIENT_SETTABLE_PAYMENT_STATUSES.includes(parsed)) {
      return {
        status: 400,
        message: 'Invalid payment_status: must be 0 (Unpaid) or 1 (Paid). Partial is derived from allocations, not set directly.'
      };
    }
    if (parsed === PAYMENT_STATUS.PAID) {
      const mode = input.payment_mode;
      if (mode === undefined || mode === null) {
        return { status: 400, message: 'Payment mode (Cash/Bank) is required for paid purchases' };
      }
    }
  }

  if (supplied('payment_mode') && input.payment_mode !== null) {
    const mode = parseInt(String(input.payment_mode));
    if (!VALID_PAYMENT_MODES.includes(mode)) {
      return { status: 400, message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)' };
    }
  }

  // Money that cannot be negative
  for (const [field, label] of [
    ['packing_forwarding_qty', 'Packing/forwarding quantity'],
    ['packing_forwarding_rate', 'Packing/forwarding rate'],
    ['transport_cost', 'Transport cost']
  ] as Array<[string, string]>) {
    if (supplied(field) && num(input[field]) < 0) {
      return { status: 400, message: `${label} cannot be negative` };
    }
  }

  // Staff
  if (supplied('staff_id') && input.staff_id !== null && input.staff_id !== '') {
    const staffId = parseInt(String(input.staff_id));
    if (isNaN(staffId) || !(await prisma.staff.findUnique({ where: { id: staffId } }))) {
      return { status: 400, message: 'Invalid staff member selected' };
    }
  }

  return null;
}

/** The business's own GSTIN, which is where its state code comes from (F-30). */
export async function getBusinessGstin(tx?: any): Promise<string | null> {
  const client = tx || prisma;
  const business = await client.business_details.findFirst({ select: { gstin: true } });
  return business?.gstin ?? null;
}
