/**
 * The shape of an Indian financial year, in one place.
 *
 * S-74: these rules were written out twice, in full — once in
 * `pages/settings/financialyear.tsx` and once in
 * `pages/api/financial-years/index.ts`. Both carried their own `parseDate`,
 * their own "must start April 1", their own "must end March 31" and their own
 * one-year-span check. A statutory rule with two homes is a rule that can
 * disagree with itself, and the browser copy is the one a caller can skip.
 *
 * CGST Rule 46(b) is why this matters beyond tidiness: invoice numbers are a
 * consecutive serial unique *within a financial year*, so what counts as a
 * financial year decides when numbering restarts.
 */

export interface FinancialYearDates {
  startDate: Date
  endDate: Date
  /** "2026-2027" */
  fy: string
}

/**
 * Parse YYYY-MM-DD in LOCAL time.
 *
 * `new Date("2026-04-01")` is UTC midnight, which lands on 31 March in any
 * timezone behind UTC. Taking the parts by hand avoids that.
 */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Validate a proposed financial year.
 *
 * @returns the parsed dates and derived label, or a message explaining the
 *          refusal. Never throws: both callers want to show the reason.
 */
export function validateFinancialYear(
  start: string,
  end: string
): { ok: true; value: FinancialYearDates } | { ok: false; message: string } {
  if (!start || !end) {
    return { ok: false, message: 'Start date and end date are required' }
  }

  const startDate = parseLocalDate(start)
  const endDate = parseLocalDate(end)

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { ok: false, message: 'Invalid date format' }
  }

  if (endDate <= startDate) {
    return { ok: false, message: 'End date must be after start date' }
  }

  // Months are 0-indexed: 3 is April, 2 is March.
  if (startDate.getMonth() !== 3 || startDate.getDate() !== 1) {
    return { ok: false, message: 'Financial year must start on April 1' }
  }

  if (endDate.getMonth() !== 2 || endDate.getDate() !== 31) {
    return { ok: false, message: 'Financial year must end on March 31' }
  }

  const startYear = startDate.getFullYear()
  const endYear = endDate.getFullYear()

  if (endYear !== startYear + 1) {
    return {
      ok: false,
      message: 'Financial year must span exactly one year (e.g. April 1, 2024 → March 31, 2025)',
    }
  }

  return { ok: true, value: { startDate, endDate, fy: `${startYear}-${endYear}` } }
}

/** Do two date ranges overlap at all? */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
