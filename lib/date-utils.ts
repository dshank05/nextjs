/**
 * Centralized date utility functions for consistent date handling across frontend and backend
 * 
 * PROBLEM:
 * - Frontend: `.toISOString().split('T')[0]` creates midnight UTC dates causing timezone issues
 * - Backend: Date range queries often miss entries at end of day (23:59:59)
 * 
 * SOLUTION:
 * - Frontend: Use formatDateForAPI() to add T12:00:00 for consistency
 * - Backend: Use parseDateRange() to get proper start (00:00:00) and end (23:59:59) timestamps
 */

/**
 * Format START date for API - beginning of day (00:00:00)
 * 
 * USE IN: Frontend pages when setting FROM date in date ranges
 * 
 * EXAMPLE:
 * ```typescript
 * const oneMonthAgo = new Date();
 * oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
 * const fromDate = formatStartDateForAPI(oneMonthAgo); // "2025-12-30T00:00:00"
 * ```
 * 
 * @param date - Date object to format
 * @returns Date string in format "YYYY-MM-DDTHH:MM:SS" with time set to 00:00:00
 */
export function formatStartDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00`;
}

/**
 * Format END date for API - end of day (23:59:59)
 * 
 * USE IN: Frontend pages when setting TO date in date ranges
 * 
 * EXAMPLE:
 * ```typescript
 * const today = new Date();
 * const toDate = formatEndDateForAPI(today); // "2026-01-31T23:59:59"
 * ```
 * 
 * @param date - Date object to format
 * @returns Date string in format "YYYY-MM-DDTHH:MM:SS" with time set to 23:59:59
 */
export function formatEndDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T23:59:59`;
}

/**
 * @deprecated Use formatStartDateForAPI() or formatEndDateForAPI() instead
 * Format date for API calls - adds T00:00:00 for backward compatibility
 * 
 * @param date - Date object to format
 * @returns Date string in format "YYYY-MM-DDTHH:MM:SS" with time set to 00:00:00
 */
export function formatDateForAPI(date: Date): string {
  return formatStartDateForAPI(date);
}

/**
 * Get local date string (YYYY-MM-DD) from browser's timezone
 * 
 * USE IN: Frontend forms when setting default dates or displaying dates
 * 
 * AVOIDS: UTC conversion issues from .toISOString()
 * 
 * PROBLEM WITH .toISOString().split('T')[0]:
 * - Always converts to UTC, causing date shifts across timezones
 * - Example: Feb 2, 2026 4:47 PM PST → Feb 3, 2026 in UTC
 * 
 * SOLUTION:
 * - Uses local date methods (getFullYear, getMonth, getDate)
 * - Respects user's timezone without conversion
 * 
 * @param date - Date object (defaults to now)
 * @returns Date string in local timezone "YYYY-MM-DD"
 * 
 * @example
 * ```typescript
 * // Set form default to today (local timezone)
 * const today = getLocalDateString();
 * setFormData(prev => ({ ...prev, date: today }));
 * 
 * // Format a specific date
 * const myDate = new Date(2026, 1, 2); // Feb 2, 2026
 * const formatted = getLocalDateString(myDate); // "2026-02-02"
 * ```
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert YYYY-MM-DD date string to Unix timestamp at midnight local time
 * 
 * USE IN: ALL frontend and backend code converting date strings to timestamps
 * 
 * CRITICAL: This function parses dates in LOCAL timezone, not UTC.
 * - Input "2026-02-07" becomes Feb 7, 2026 00:00:00 in server's timezone
 * - For India deployment: Feb 7, 2026 00:00:00 IST
 * - Ensures consistent timestamps for same date across POST/PUT operations
 * 
 * WHY MANUAL PARSING:
 * - new Date("2026-02-07") interprets as UTC midnight, causing timezone shifts
 * - In PST (UTC-8): "2026-02-07" becomes Feb 6, 4:00 PM (wrong day!)
 * - Manual parsing creates Date in local timezone (correct)
 * 
 * @param dateString - Date in "YYYY-MM-DD" format
 * @returns Unix timestamp (seconds) at 00:00:00 local time
 * 
 * @example
 * ```typescript
 * import { convertDateToTimestamp } from '../../lib/date-utils';
 * 
 * // Frontend: Convert date input to timestamp
 * const timestamp = convertDateToTimestamp("2026-02-07");
 * 
 * // Backend: Convert received date string to timestamp
 * const invoiceDate = convertDateToTimestamp(req.body.invoice_date);
 * 
 * // Result (in IST): Feb 7, 2026 00:00:00 IST
 * // Same date, same timestamp - ledger entries merge correctly!
 * ```
 */
export function convertDateToTimestamp(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/**
 * Parse date range for database queries with proper time boundaries
 * 
 * Converts date strings like "2026-01-30" to Unix timestamps with:
 * - Start: 00:00:00 (beginning of day)
 * - End: 23:59:59 (end of day)
 * 
 * USE IN: ALL backend API endpoints with date filters
 * 
 * EXAMPLE:
 * ```typescript
 * import { parseDateRange } from '../../lib/date-utils';
 * 
 * const { startTimestamp, endTimestamp } = parseDateRange(
 *   req.query.dateFrom as string,
 *   req.query.dateTo as string
 * );
 * 
 * // Use in Prisma query:
 * where: {
 *   date: {
 *     gte: startTimestamp,
 *     lte: endTimestamp  // Now includes 23:59:59!
 *   }
 * }
 * ```
 * 
 * @param dateFrom - Start date string (e.g., "2026-01-01" or "2026-01-01T12:00:00")
 * @param dateTo - End date string (e.g., "2026-01-30" or "2026-01-30T12:00:00")
 * @returns Object with startTimestamp (start of day) and endTimestamp (end of day) in Unix seconds
 */
export function parseDateRange(dateFrom: string, dateTo: string): {
  startTimestamp: number;
  endTimestamp: number;
} {
  // Parse start date - set to 00:00:00 (beginning of day)
  const startDate = new Date(dateFrom);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  // Parse end date - set to 23:59:59 (end of day)
  const endDate = new Date(dateTo);
  endDate.setHours(23, 59, 59, 999);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  return { startTimestamp, endTimestamp };
}
