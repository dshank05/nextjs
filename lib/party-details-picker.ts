/**
 * Party / people pickers on the REPORT screens (E-05, E-10).
 *
 * The bill and payment forms pick from `?dropdown=true`: every ACTIVE row,
 * unpaginated - the right list for new documents. A report has to reach a party
 * that has since been deactivated (an inactive customer can still owe money,
 * an inactive mechanic still has old sales), so the report pickers ask for
 * every row, inactive ones included, and mark the inactive ones.
 *
 * Client-safe: no database import.
 */
export const REPORT_PICKER_URL = {
  customer: '/api/customers?dropdown=true&includeInactive=true',
  vendor: '/api/vendors?dropdown=true&includeInactive=true',
  mechanic: '/api/mechanics?dropdown=true&includeInactive=true',
  staff: '/api/staff?dropdown=true&includeInactive=true'
} as const;

/** The name shown in a report picker: inactive rows are marked. */
export function pickerName(name: unknown, status: unknown): string {
  const text = name == null ? '' : String(name);
  return status === 'Inactive' ? `${text} (inactive)` : text;
}
