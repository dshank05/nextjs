import { splitGst, SupplyType } from './gst';

/**
 * Bill arithmetic: one copy, used by the server to compute what is stored and
 * by the forms to preview it, for purchase, sale and salex alike.
 *
 * Rounding (F-34, owner decision 2026-10-02):
 *   - rates, line amounts and per-line tax keep paise (2 dp);
 *   - CGST, SGST and IGST are each rounded to the nearest rupee, half up, on
 *     the bill totals (CGST Act s.170 / Rule 51);
 *   - the grand total is rounded to the nearest rupee.
 *
 * Discounts are a fixed AMOUNT per line, taken off before tax - the rule the
 * sale and salex forms already used. Purchase sends none.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Nearest rupee, half up (half away from zero for a negative figure). */
export const roundRupee = (n: number): number => {
  const v = round2(n);
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
};

/** A form value as a number; empty or junk is 0. */
export const parseNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Quantities are whole units (owner decision, PU-33). */
export const wholeQty = (v: unknown): number => Math.round(parseNum(v));

export interface BillItemInput {
  qty: unknown;
  rate: unknown;
  gst_percentage?: unknown;
  /** Fixed amount off this line, before tax. */
  discount?: unknown;
}

export interface BillLine {
  qty: number;
  rate: number;
  /** qty × rate */
  gross: number;
  discount: number;
  /** discount as a % of gross, for display and the legacy column */
  discountrate: number;
  /** gross − discount: what tax is charged on */
  taxable: number;
  gst_percentage: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Bill {
  lines: BillLine[];
  grossTotal: number;
  discountTotal: number;
  /** Σ taxable - items after discount, before tax */
  itemsTotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  packingTotal: number;
  freight: number;
  grandTotal: number;
}

/** One line. `supplyType` null means the split cannot be decided: no tax is charged. */
export function billLine(item: BillItemInput, supplyType: SupplyType | null, taxFree = false): BillLine {
  const qty = wholeQty(item.qty);
  const rate = parseNum(item.rate);
  const gross = round2(qty * rate);
  const discount = round2(Math.min(Math.max(parseNum(item.discount), 0), Math.max(gross, 0)));
  const taxable = round2(gross - discount);
  const gst = taxFree ? 0 : parseNum(item.gst_percentage);
  const tax = supplyType ? round2((taxable * gst) / 100) : 0;
  const split = supplyType && tax ? splitGst(tax, supplyType) : { cgst: 0, sgst: 0, igst: 0 };
  return {
    qty,
    rate,
    gross,
    discount,
    discountrate: gross > 0 ? round2((discount / gross) * 100) : 0,
    taxable,
    gst_percentage: gst,
    tax,
    cgst: round2(split.cgst),
    sgst: round2(split.sgst),
    igst: round2(split.igst)
  };
}

/**
 * The whole bill. `freight` is added to the grand total only when passed:
 * sale includes it, purchase stores it beside the bill (owner, 2026-10-02).
 */
export function computeBill(
  items: BillItemInput[],
  opts: { supplyType: SupplyType | null; taxFree?: boolean; packingTotal?: number; freight?: number }
): Bill {
  const lines = (items || []).map(i => billLine(i, opts.supplyType, opts.taxFree));
  const sum = (pick: (l: BillLine) => number) => lines.reduce((a, l) => a + pick(l), 0);
  const totalCgst = roundRupee(sum(l => l.cgst));
  const totalSgst = roundRupee(sum(l => l.sgst));
  const totalIgst = roundRupee(sum(l => l.igst));
  const totalTax = totalCgst + totalSgst + totalIgst;
  const itemsTotal = round2(sum(l => l.taxable));
  const packingTotal = round2(opts.packingTotal || 0);
  const freight = round2(opts.freight || 0);
  return {
    lines,
    grossTotal: round2(sum(l => l.gross)),
    discountTotal: round2(sum(l => l.discount)),
    itemsTotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    packingTotal,
    freight,
    grandTotal: roundRupee(itemsTotal + packingTotal + freight + totalTax)
  };
}

/** Packing & forwarding: qty × rate; a total typed with no qty is one unit at that price. */
export function packingAmount(qty: unknown, rate: unknown, total?: unknown): { qty: number; rate: number; total: number } {
  const q = parseNum(qty);
  if (q <= 0) {
    const t = parseNum(total);
    return t > 0 ? { qty: 1, rate: t, total: round2(t) } : { qty: 0, rate: 0, total: 0 };
  }
  const r = parseNum(rate);
  return { qty: q, rate: r, total: round2(q * r) };
}

export interface LineAmounts {
  taxable: number;
  tax: number;
  total: number;
}

/** One line's preview: qty × rate less a fixed discount, and GST on it. */
export function lineAmounts(qty: number, rate: number, gstPercent: number, discountAmount = 0): LineAmounts {
  const taxable = round2(qty * rate - discountAmount);
  const tax = round2((taxable * gstPercent) / 100);
  return { taxable, tax, total: round2(taxable + tax) };
}

/** The rate that makes a line come to a typed total, GST and a fixed discount included. Paise kept. */
export function rateFromTotal(total: number, qty: number, gstPercent: number, discountAmount = 0): number {
  if (qty <= 0) return 0;
  const taxable = total / (1 + gstPercent / 100);
  return round2((taxable + discountAmount) / qty);
}

/** Rupees for display, two decimals at most. */
export const money = (n: number): string =>
  round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
