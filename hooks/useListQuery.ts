import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUrlState } from './useUrlState'
import { useDebounce } from './useDebounce'

/**
 * Search, sort, page and limit for a settings list, in one place.
 *
 * Every list page owned its own copy of this, and the copies disagreed. Each of
 * the following was present on some pages and not others:
 *
 * - **The debounce was defeated** (S-12). The effect depended on the *debounced*
 *   search term but the request sent the *raw* one, so any render that fired the
 *   effect mid-keystroke sent a value the user had already changed. Here there
 *   is only one way to build the query string, and it uses the debounced value —
 *   the raw one is exposed solely to bind the input.
 * - **Sorting did not return to page 1** (S-13), so re-sorting from page 3 landed
 *   on page 3 of a different ordering. `toggleSort` resets it.
 * - **Serial numbers restarted at 1 on every page** (S-14) because rows were
 *   numbered `index + 1`. `serialNumber(index)` applies the offset. `bankdetails`
 *   even computed the right value and then ignored it.
 *
 * Search, sort and limit all reset the page, because a result on page 3 of the
 * old query is meaningless in the new one.
 */

export interface PaginationState {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface UseListQueryOptions {
  /** Sort column applied before the user picks one. */
  defaultSort: string
  defaultOrder?: 'asc' | 'desc'
  defaultLimit?: number
  /** Extra query parameters sent on every request, e.g. `includeInactive`. */
  fixedParams?: Record<string, string>
  debounceMs?: number
}

export function useListQuery(opts: UseListQueryOptions) {
  const {
    defaultSort,
    defaultOrder = 'asc',
    defaultLimit = 50,
    fixedParams,
    debounceMs = 300,
  } = opts

  // Mirrored in the URL so a filtered list survives a refresh and can be
  // linked (F-49).
  const [search, setSearchRaw] = useUrlState<string>('search', '')
  const [sortBy, setSortBy] = useUrlState<string>('sortBy', defaultSort)
  const [sortOrder, setSortOrder] = useUrlState<'asc' | 'desc'>('sortOrder', defaultOrder)

  const [page, setPage] = useState(1)
  const [limit, setLimitRaw] = useState(defaultLimit)
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: defaultLimit,
    total: 0,
    totalPages: 1,
    hasMore: false,
  })

  const debouncedSearch = useDebounce(search, debounceMs)

  // One effect, not the two-that-overlap several pages carried (S-16).
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, sortBy, sortOrder])

  const setSearch = useCallback((next: string) => setSearchRaw(next), [setSearchRaw])

  const setLimit = useCallback((next: number) => {
    setLimitRaw(next)
    setPage(1)
  }, [])

  const toggleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
      } else {
        setSortBy(field)
        setSortOrder('asc')
      }
      setPage(1)
    },
    [sortBy, sortOrder, setSortBy, setSortOrder]
  )

  const goToPage = useCallback(
    (next: number) => {
      if (next > 0 && next <= Math.max(1, pagination.totalPages)) setPage(next)
    },
    [pagination.totalPages]
  )

  /**
   * The query string. Built from the DEBOUNCED search term — that is the whole
   * point of S-12, and it is why pages should never assemble this themselves.
   */
  const params = useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      search: debouncedSearch.trim(),
      sortBy,
      sortOrder,
    })
    if (fixedParams) {
      for (const [k, v] of Object.entries(fixedParams)) p.set(k, v)
    }
    return p
    // fixedParams is a literal at every call site; depending on its identity
    // would rebuild the string on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, debouncedSearch, sortBy, sortOrder])

  /** The row number to display, offset by the page (S-14). */
  const serialNumber = useCallback(
    (index: number) => (page - 1) * limit + index + 1,
    [page, limit]
  )

  return {
    // bind to the input
    search,
    setSearch,
    // what actually goes to the server
    debouncedSearch,
    params,
    // sorting
    sortBy,
    sortOrder,
    toggleSort,
    // paging
    page,
    goToPage,
    limit,
    setLimit,
    pagination,
    setPagination,
    serialNumber,
  }
}
