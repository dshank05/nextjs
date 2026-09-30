import { useCallback, useMemo, useRef, useState } from 'react'
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
 *
 * The reset is DERIVED, not an effect. The first version set page 1 in an
 * effect after the debounced term changed - so the render in between built a
 * query string with the new term and the old page, the page fetched it, then
 * fetched again for page 1, and whichever response arrived last won. Now the
 * page is stored together with the query it belongs to, and a page recorded
 * against a different query reads as 1. There is never a render with the old
 * page and the new query.
 *
 * `beginRequest()` covers the remaining race: a slow response for an old query
 * arriving after a fast one for the new. Each page calls it before fetching and
 * drops the response if `isCurrent()` is false by the time it lands.
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
  /**
   * Extra filters that CAN change (already debounced by the caller). Part of
   * the query, so changing one returns to page 1 like search and sort do.
   */
  extraParams?: Record<string, string>
  debounceMs?: number
}

export function useListQuery(opts: UseListQueryOptions) {
  const {
    defaultSort,
    defaultOrder = 'asc',
    defaultLimit = 50,
    fixedParams,
    extraParams,
    debounceMs = 300,
  } = opts
  const extraKey = extraParams ? JSON.stringify(extraParams) : ''

  // Mirrored in the URL so a filtered list survives a refresh and can be
  // linked (F-49).
  const [search, setSearchRaw] = useUrlState<string>('search', '')
  const [sortBy, setSortBy] = useUrlState<string>('sortBy', defaultSort)
  const [sortOrder, setSortOrder] = useUrlState<'asc' | 'desc'>('sortOrder', defaultOrder)

  const [limit, setLimit] = useState(defaultLimit)
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: defaultLimit,
    total: 0,
    totalPages: 1,
    hasMore: false,
  })

  const debouncedSearch = useDebounce(search, debounceMs)

  // Everything that, when it changes, makes the current page number meaningless.
  const queryKey = `${debouncedSearch.trim()}\u0000${sortBy}\u0000${sortOrder}\u0000${limit}\u0000${extraKey}`
  const [pageState, setPageState] = useState({ page: 1, key: queryKey })
  const page = pageState.key === queryKey ? pageState.page : 1
  const setPage = useCallback(
    (next: number) => setPageState({ page: next, key: queryKey }),
    [queryKey]
  )

  const setSearch = useCallback((next: string) => setSearchRaw(next), [setSearchRaw])

  const toggleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
      } else {
        setSortBy(field)
        setSortOrder('asc')
      }
      // No explicit reset: the sort is part of queryKey, so page reads as 1.
    },
    [sortBy, sortOrder, setSortBy, setSortOrder]
  )

  const goToPage = useCallback(
    (next: number) => {
      if (next > 0 && next <= Math.max(1, pagination.totalPages)) setPage(next)
    },
    [pagination.totalPages, setPage]
  )

  // Stale-response guard (see the header).
  const requestSeq = useRef(0)
  const beginRequest = useCallback(() => {
    const id = ++requestSeq.current
    return () => id === requestSeq.current
  }, [])

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
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) p.set(k, v)
    }
    return p
    // fixedParams is a literal at every call site; depending on its identity
    // would rebuild the string on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, debouncedSearch, sortBy, sortOrder, extraKey])

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
    beginRequest,
  }
}
