/**
 * GST supply-type resolution — the single source of truth for CGST/SGST vs IGST.
 *
 * THE RULE (IGST Act s.10):
 *   Compare the supplier's state with the PLACE OF SUPPLY.
 *   Same state     -> intra-state -> CGST + SGST, half each.
 *   Different state-> inter-state -> IGST, full amount.
 *
 * For goods billed to a registered party, the place of supply is the BILL-TO
 * state, not the ship-to state (s.10(1)(b)). If you bill Gujarat and ship to
 * Karnataka on the buyer's instruction, the tax still follows Gujarat; the
 * ship-to address is recorded as the delivery address and changes nothing.
 * Do not "fix" this to use the shipping address.
 *
 * For an over-the-counter sale where no address is captured, there is no
 * movement of goods, so the place of supply is where the goods are at the time
 * of delivery (s.10(1)(c)) — the shop itself. That makes a walk-in sale
 * intra-state. See UNKNOWN handling below.
 *
 * Before this module existed, `pages/sale/create.tsx` decided this twice and
 * the two disagreed, which made some sales impossible to save. See
 * docs/AUDIT_PLAN.md, finding F-28.
 */

export type SupplyType = 'INTRA_STATE' | 'INTER_STATE';

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

/** Valid GST state codes are 01-38 (38 = Ladakh, split from J&K in 2019). */
export const MIN_GST_STATE_CODE = 1;
export const MAX_GST_STATE_CODE = 38;

export function isValidGstStateCode(code: unknown): code is number {
  return (
    typeof code === 'number' &&
    Number.isInteger(code) &&
    code >= MIN_GST_STATE_CODE &&
    code <= MAX_GST_STATE_CODE
  );
}

/**
 * The supplier's state code is the first two digits of its GSTIN.
 *
 * Deriving it from the GSTIN rather than storing it separately means the two
 * can never drift apart. `business_details` has no state column, so the GSTIN
 * is the only place this exists.
 *
 * @returns the state code, or null if the GSTIN is missing or malformed
 */
export function getBusinessStateCode(gstin?: string | null): number | null {
  if (!gstin) return null;
  const code = parseInt(gstin.trim().slice(0, 2), 10);
  return isValidGstStateCode(code) ? code : null;
}

/**
 * Decide whether a supply is intra-state or inter-state.
 *
 * `customerStateCode` should be the BILLING state code. Pass `null` or
 * `undefined` when the customer has no state recorded at all (a walk-in or
 * "Other" customer) — that is treated as a counter sale and therefore
 * intra-state.
 *
 * A state that IS recorded but whose code is not a valid GST code (notably 0,
 * which is what `states.code` defaults to — see F-29) is NOT silently treated
 * as intra-state. Guessing there would mean charging CGST+SGST on a genuine
 * inter-state sale, which understates IGST and is a real tax error. Callers
 * get `null` and should surface a configuration error instead.
 *
 * @param customerStateCode - billing state code, or null/undefined if no state recorded
 * @param businessStateCode - the supplier's own state code
 * @param hasCustomerState - whether a state was actually selected; defaults to
 *                           inferring from `customerStateCode != null`
 * @returns the supply type, or `null` when a state was named but its code is unusable
 */
export function resolveSupplyType(
  customerStateCode: number | null | undefined,
  businessStateCode: number | null,
  hasCustomerState?: boolean
): SupplyType | null {
  const stateWasSelected =
    hasCustomerState !== undefined ? hasCustomerState : customerStateCode != null;

  // No state recorded at all -> counter sale -> intra-state.
  if (!stateWasSelected) return 'INTRA_STATE';

  // A state was named but we cannot resolve its GST code. Do not guess.
  if (!isValidGstStateCode(customerStateCode)) return null;
  if (!isValidGstStateCode(businessStateCode)) return null;

  return customerStateCode === businessStateCode ? 'INTRA_STATE' : 'INTER_STATE';
}

/**
 * Split a tax amount into CGST/SGST/IGST for a given supply type.
 *
 * NOTE: this does not round. Rounding to the nearest rupee per component
 * (CGST Act s.170 + Rule 51) is finding F-34 and is deliberately kept separate
 * so that fix can land on its own and be reviewed on its own.
 */
export function splitGst(taxAmount: number, supplyType: SupplyType): GstSplit {
  if (supplyType === 'INTRA_STATE') {
    return { cgst: taxAmount / 2, sgst: taxAmount / 2, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: taxAmount };
}

/**
 * Convenience wrapper: resolve the supply type and split in one call.
 *
 * Returns a zero split when the supply type cannot be resolved, alongside
 * `supplyType: null` so the caller can tell "no tax" from "cannot determine".
 */
export function calculateGstBreakdown(
  taxAmount: number,
  customerStateCode: number | null | undefined,
  businessStateCode: number | null,
  hasCustomerState?: boolean
): GstSplit & { supplyType: SupplyType | null } {
  const supplyType = resolveSupplyType(
    customerStateCode,
    businessStateCode,
    hasCustomerState
  );

  if (!supplyType) {
    return { cgst: 0, sgst: 0, igst: 0, supplyType: null };
  }

  return { ...splitGst(taxAmount, supplyType), supplyType };
}
