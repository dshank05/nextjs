import type { NextApiRequest } from 'next'

/**
 * One parser for the list parameters every settings endpoint accepts.
 *
 * Each of the twelve wrote its own, and they disagreed in ways that were
 * invisible until measured:
 *
 * - `states` and `users` never implemented `dropdown=true`, so F-58's fix - a
 *   picker silently showing only its first page - was never applied to them
 *   (S-55).
 * - `racks` reads no sort parameter at all, which is why its page sorts in the
 *   browser (S-77 / S-37).
 * - `states` whitelists `['state_name', 'code']`, so `sortBy=id` silently falls
 *   back rather than being refused (S-32).
 * - `bank-details`, `states` and `financial-years` take `limit` without bound,
 *   so `limit=0` yields `totalPages = Infinity` and `limit=100000` is a full
 *   table scan.
 *
 * The silent fallback is kept deliberately - refusing an unknown sort field
 * would break callers that currently work - but it is now reported, so the
 * caller can tell "sorted by what I asked" from "sorted by something else".
 */

export interface ListQueryOptions {
  /** Columns this resource may be sorted by. Anything else falls back. */
  sortFields: string[]
  defaultSort: string
  defaultOrder?: 'asc' | 'desc'
  /** Cap on `limit`. A list endpoint should never be asked for everything. */
  maxLimit?: number
}

export interface ListQuery {
  page: number
  limit: number
  skip: number
  take: number
  search: string
  sortField: string
  sortOrder: 'asc' | 'desc'
  /** True when the caller asked for a sort field this resource does not have. */
  sortFellBack: boolean
  /** `dropdown=true`: every matching row, unpaginated. */
  isDropdown: boolean
  includeInactive: boolean
}

const DEFAULT_LIMIT = 50
const DEFAULT_MAX_LIMIT = 500

export function parseListQuery(req: NextApiRequest, opts: ListQueryOptions): ListQuery {
  const q = req.query
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)

  const maxLimit = opts.maxLimit ?? DEFAULT_MAX_LIMIT

  const rawPage = parseInt(String(first(q.page) ?? '1'), 10)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1

  const rawLimit = parseInt(String(first(q.limit) ?? String(DEFAULT_LIMIT)), 10)
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : DEFAULT_LIMIT

  const search = String(first(q.search) ?? '').trim()

  const requestedSort = String(first(q.sortBy) ?? opts.defaultSort)
  const sortAllowed = opts.sortFields.includes(requestedSort)
  const sortField = sortAllowed ? requestedSort : opts.defaultSort

  const requestedOrder = String(first(q.sortOrder) ?? opts.defaultOrder ?? 'asc')
  const sortOrder: 'asc' | 'desc' = requestedOrder === 'desc' ? 'desc' : 'asc'

  const isDropdown = String(first(q.dropdown) ?? 'false') === 'true'
  const includeInactive = String(first(q.includeInactive) ?? 'false') === 'true'

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    search,
    sortField,
    sortOrder,
    sortFellBack: !sortAllowed,
    isDropdown,
    includeInactive,
  }
}

/**
 * Prisma arguments for paging, or nothing at all in dropdown mode.
 *
 * A dropdown needs every row: one that shows the first fifty is worse than a
 * slow one, because the missing entry simply cannot be selected and nothing
 * says so (F-58).
 */
export function paginationArgs(list: ListQuery) {
  return list.isDropdown ? {} : { skip: list.skip, take: list.take }
}

export function orderByArgs(list: ListQuery) {
  return { [list.sortField]: list.sortOrder }
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export function buildPagination(list: ListQuery, total: number): Pagination {
  // In dropdown mode every row was returned, so there is exactly one page.
  const totalPages = list.isDropdown ? 1 : Math.max(1, Math.ceil(total / list.limit))
  return {
    page: list.isDropdown ? 1 : list.page,
    limit: list.isDropdown ? total : list.limit,
    total,
    totalPages,
    hasMore: list.isDropdown ? false : list.page < totalPages,
  }
}

/**
 * The list envelope.
 *
 * `data` is canonical. The resource-named key (`staff`, `warehouses`, …) is
 * emitted alongside it so that pages and hooks can be migrated one at a time
 * rather than in one breaking change - several of these endpoints are read by
 * the sale and purchase forms, not only by their own settings page.
 *
 * Once every consumer reads `data`, drop `legacyKey` and this paragraph.
 */
export function listResponse<T>(
  rows: T[],
  pagination: Pagination,
  legacyKey?: string,
  extra?: Record<string, unknown>
) {
  const body: Record<string, unknown> = { data: rows, pagination, ...extra }
  if (legacyKey) body[legacyKey] = rows
  return body
}
