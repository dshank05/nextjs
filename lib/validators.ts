/**
 * Small shared field validators.
 *
 * These live in one module because the page and the API must apply the SAME
 * rule. When they drift, the form accepts a value the server then rejects, or
 * worse, the server accepts something the form would have caught - that was
 * F-54 (phone) and F-59 (phone and email on staff/mechanics).
 */

/** Exactly ten digits, ignoring surrounding whitespace. */
export function isTenDigitPhone(value?: string | null): boolean {
  return /^[0-9]{10}$/.test((value || '').trim());
}

/**
 * Pragmatic email check: something, an @, a dotted domain, no whitespace.
 *
 * Deliberately not RFC 5322. A fully correct email regex is famously enormous
 * and still cannot tell you the address exists; this catches the mistakes
 * people actually make when typing one into a form.
 */
export function isValidEmail(value?: string | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
}
