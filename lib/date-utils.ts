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
 * Format date for API calls - adds T12:00:00 for timezone consistency
 * 
 * USE IN: Frontend pages when generating initial date ranges
 * 
 * EXAMPLE:
 * ```typescript
 * const today = new Date();
 * const oneMonthAgo = new Date(today);
 * oneMonthAgo.setMonth(today.getMonth() - 1);
 * 
 * const fromDate = formatDateForAPI(oneMonthAgo); // "2025-12-30T12:00:00"
 * const toDate = formatDateForAPI(today);         // "2026-01-30T12:00:00"
 * ```
 * 
 * @param date - Date object to format
 * @returns Date string in format "YYYY-MM-DDTHH:MM:SS" with time set to 12:00:00
 */
export function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T12:00:00`;
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
