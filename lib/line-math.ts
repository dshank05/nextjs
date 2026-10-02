/**
 * Line arithmetic for bill forms: qty, rate, GST and total, in both directions.
 *
 * This is the browser's PREVIEW - the server recomputes every figure from qty,
 * rate and GST % and stores its own (lib/purchase.ts). The purchase form had
 * this written out in about a dozen places with four rounding rules; the inline
 * "total -> rate" step ignored GST, so tax was charged twice (PU-05). One copy,
 * shared, with the GST-aware rule the sale form already used.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A form value as a number; empty or junk is 0. */
export const parseNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Quantities are whole units (owner decision, PU-33). */
export const wholeQty = (v: unknown): number => Math.round(parseNum(v));

export interface LineAmounts {
  taxable: number;
  tax: number;
  total: number;
}

/** qty × rate (less any discount), and GST on it. */
export function lineAmounts(qty: number, rate: number, gstPercent: number, discountPercent = 0): LineAmounts {
  const taxable = qty * rate * (1 - discountPercent / 100);
  const tax = (taxable * gstPercent) / 100;
  return { taxable, tax, total: taxable + tax };
}

/** The rate that makes a line come to a typed total, GST and discount included. Paise kept. */
export function rateFromTotal(total: number, qty: number, gstPercent: number, discountPercent = 0): number {
  const divisor = qty * (1 + gstPercent / 100) * (1 - discountPercent / 100);
  return divisor > 0 ? round2(total / divisor) : 0;
}

/** Rupees for display, two decimals at most. */
export const money = (n: number): string =>
  round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
