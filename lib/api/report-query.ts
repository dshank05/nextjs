import type { NextApiRequest } from 'next'
import { parseDateRange } from '../date-utils'

/**
 * Paging and date-range parsing for the report endpoints.
 *
 * Each report parsed these itself: two used `parseDateRange`, two built
 * `new Date('YYYY-MM-DD')` - 00:00 UTC - and compared `<=` against it, so the
 * last day of the range was left out (PU-28, PU-29). No limit was capped and a
 * junk page became `skip: NaN`, a 500.
 */

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
export const queryString = (req: NextApiRequest, key: string) => String(first(req.query[key]) ?? '').trim()
export const queryInt = (req: NextApiRequest, key: string): number | null => {
  const s = queryString(req, key)
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}
export const queryFloat = (req: NextApiRequest, key: string): number | null => {
  const s = queryString(req, key)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function reportPage(req: NextApiRequest, defaultLimit = 50, maxLimit = 500) {
  const page = Math.max(1, queryInt(req, 'page') ?? 1)
  const rawLimit = queryInt(req, 'limit') ?? defaultLimit
  const limit = Math.min(Math.max(1, rawLimit), maxLimit)
  return { page, limit, skip: (page - 1) * limit }
}

export function reportPagination(page: number, limit: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  return { page, limit, total, totalPages, hasMore: page < totalPages }
}

/**
 * Whole local days as unix seconds, both ends inclusive. Either end may be
 * given alone; neither gives null.
 */
export function reportDayRange(req: NextApiRequest, fromKey = 'dateFrom', toKey = 'dateTo') {
  const from = queryString(req, fromKey)
  const to = queryString(req, toKey)
  if (!from && !to) return null
  const range = parseDateRange(from || to, to || from)
  return { start: from ? range.startTimestamp : null, end: to ? range.endTimestamp : null }
}
