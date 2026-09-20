/**
 * Bank identifier validation.
 *
 * Lives beside lib/gst.ts rather than inside the API route because the settings
 * page has to apply exactly the same rule. When the page and the server
 * disagree about a format, the form accepts a value the server then rejects -
 * that was F-54 on the phone fields.
 */

/**
 * Validate the shape of an IFSC.
 *
 * 11 characters, fixed by RBI: a 4-letter bank code, then a literal '0'
 * reserved for future use, then a 6-character alphanumeric branch code.
 *
 * Format only. Whether the branch actually exists cannot be known without the
 * RBI directory or a network lookup, and a settings save is not the place to
 * make an external call. This catches the typos that occur in practice: wrong
 * length, digits in the bank code, something other than 0 in the fifth slot.
 */
export function isValidIfsc(ifsc?: string | null): boolean {
  if (!ifsc) return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/** Canonical stored form: trimmed and uppercased. */
export function normaliseIfsc(ifsc?: string | null): string | null {
  const value = (ifsc || '').trim().toUpperCase();
  return value === '' ? null : value;
}
