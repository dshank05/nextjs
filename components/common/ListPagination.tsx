import React from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import type { PaginationState } from '../../hooks/useListQuery'

/**
 * The pagination control for settings lists.
 *
 * There were **two** implementations, not one copied block (which is what this
 * audit first recorded, wrongly, as S-18). Seven pages used a numbered control
 * with an ellipsis; `staff` and `mechanics` used a bare Previous / "Page X of Y"
 * / Next. Worse, the two families disagreed about when the list ends: the
 * numbered ones disable Next on `page === totalPages`, the bare ones on
 * `!hasMore` (S-56). Whichever is right, they cannot both be.
 *
 * This is the numbered one, and it disables Next on `page >= totalPages`.
 * `hasMore` is computed by the server from the same two numbers, so the two
 * rules only ever differed when one of them was wrong.
 */
export function ListPagination({
  pagination,
  onPageChange,
}: {
  pagination: PaginationState
  onPageChange: (page: number) => void
}) {
  if (pagination.totalPages <= 1) return null

  const { page, totalPages } = pagination
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  const pages: number[] = []
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary disabled:opacity-50"
      >
        Previous
      </button>

      <div className="flex space-x-2">
        {page > 3 && (
          <>
            <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">
              1
            </button>
            <span>...</span>
          </>
        )}
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-3 py-1 rounded ${
              p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'
            }`}
          >
            {p}
          </button>
        ))}
        {page < totalPages - 2 && (
          <>
            <span>...</span>
            <button
              onClick={() => onPageChange(totalPages)}
              className="px-3 py-1 rounded hover:bg-slate-700"
            >
              {totalPages}
            </button>
          </>
        )}
      </div>

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="btn-secondary disabled:opacity-50"
      >
        Next
      </button>
    </div>
  )
}

/**
 * The "Showing 1 to 50 of 602" line, which every page also wrote out by hand.
 */
export function ListSummary({
  pagination,
  shown,
  noun,
}: {
  pagination: PaginationState
  shown: number
  noun: string
}) {
  const from = shown > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0
  const to = Math.min(pagination.page * pagination.limit, pagination.total)

  return (
    <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
      <div>
        Showing {from} to {to} of {pagination.total} {noun}
      </div>
      <div>
        Page {pagination.page} of {pagination.totalPages}
      </div>
    </div>
  )
}

/** The arrow beside a sortable column heading. */
export function SortIcon({
  field,
  sortBy,
  sortOrder,
}: {
  field: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}) {
  if (sortBy !== field) return null
  return sortOrder === 'asc' ? (
    <ArrowUp className="inline w-4 h-4 ml-1" />
  ) : (
    <ArrowDown className="inline w-4 h-4 ml-1" />
  )
}

/** The items-per-page select, identical on every page. */
export function PageSizeSelect({
  limit,
  onChange,
}: {
  limit: number
  onChange: (limit: number) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
      <select
        value={limit}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="select w-full min-w-24"
      >
        <option value="10">10</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
  )
}
