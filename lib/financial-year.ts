import { prisma } from './db';

/**
 * Financial year resolution — the single source of truth.
 *
 * RULE: the financial year is set in Settings, and the app follows it.
 *
 * `settings.currentfy` holds a FOREIGN KEY to `financial_year.id` — a small
 * integer like 3. It is NOT a calendar year. The calendar period it represents
 * lives in `financial_year.fy` ("2024-2025") plus `start_date` / `end_date`,
 * and is for display and reporting only. It is never written onto a document.
 *
 * Every document (`invoice`, `invoicex`, `purchase`, returns, payments,
 * refunds, ledger entries) stores that id in its `fy` column.
 *
 * Do NOT derive the financial year locally. Before this module existed there
 * were three competing strategies in the codebase — `settings.currentfy`,
 * a calendar year from `getMonth() >= 3 ? year : year - 1`, and inheriting
 * `fy` from a related document — which meant editing a record could silently
 * move it into a different financial year than the one it was created in.
 * See docs/AUDIT_PLAN.md, finding F-01.
 */

/**
 * Resolve the current financial year id from Settings.
 *
 * Call this OUTSIDE an interactive transaction where possible. Passing a
 * transaction client is supported for callers that are already inside one.
 *
 * @param client - Optional Prisma client or transaction client
 * @returns The `financial_year.id` currently set in Settings
 * @throws If Settings has no current financial year configured
 */
export async function getCurrentFinancialYear(client?: any): Promise<number> {
  const db = client || prisma;

  const settings = await db.settings.findFirst({
    select: { currentfy: true }
  });

  if (!settings || !settings.currentfy) {
    throw new Error(
      'Current financial year is not set in Settings. ' +
      'Set one under Settings > Financial Year before creating documents.'
    );
  }

  return settings.currentfy;
}

/**
 * Load the current financial year record, including its calendar period.
 *
 * Use this for display ("FY 2024-2025") or when a date needs to be validated
 * against the open period. Use `getCurrentFinancialYear()` when all you need
 * is the id to stamp onto a document.
 *
 * @param client - Optional Prisma client or transaction client
 */
export async function getCurrentFinancialYearRecord(client?: any) {
  const db = client || prisma;
  const id = await getCurrentFinancialYear(db);

  const record = await db.financial_year.findUnique({
    where: { id }
  });

  if (!record) {
    throw new Error(
      `Settings points at financial year ${id}, but no such record exists.`
    );
  }

  return record;
}

/**
 * Check whether a document date falls inside the current financial year.
 *
 * Returns `true` when the period cannot be determined (the FY record has no
 * start/end dates), so this never blocks a save on incomplete configuration.
 *
 * NOTE: nothing calls this yet. Documents are currently stamped with the
 * current FY regardless of their date, which means a backdated document is
 * booked into the open period rather than the period it belongs to. Whether
 * to enforce this is an open business decision — see docs/AUDIT_PLAN.md.
 *
 * @param dateTimestamp - Document date as a Unix timestamp (seconds)
 * @param client - Optional Prisma client or transaction client
 */
export async function isWithinCurrentFinancialYear(
  dateTimestamp: number,
  client?: any
): Promise<boolean> {
  const record = await getCurrentFinancialYearRecord(client);

  if (!record.start_date || !record.end_date) return true;

  const date = new Date(dateTimestamp * 1000);
  const start = new Date(record.start_date);
  const end = new Date(record.end_date);

  // Compare on date boundaries, ignoring time of day.
  end.setHours(23, 59, 59, 999);

  return date >= start && date <= end;
}
