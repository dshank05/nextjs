import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { SearchableSelect, ExportMenu, ClearableInput } from '../../components/common'
import { useDebounce } from '../../hooks/useDebounce'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/**
 * Opening / Closing Stock (server: lib/stock-report.ts). Quantities from the
 * movements in the range; values at the last purchase rate on each date.
 */
const qty = (v: number) => (v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OpeningClosingStock() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('product_name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const debounced = useDebounce(search, 400)
  const limit = 100

  useEffect(() => {
    const now = new Date()
    setDateFrom(formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
    // E-12: the lookup lives under /api/products (/api/categories was a 404).
    fetch('/api/products/categories?dropdown=true').then(r => (r.ok ? r.json() : { categories: [] })).then(d =>
      setCategories([{ id: '', name: 'All categories' }, ...(d.categories || []).map((c: any) => ({ id: String(c.id), name: c.category_name }))])
    ).catch(() => {})
  }, [])
  useEffect(() => { setPage(1) }, [dateFrom, dateTo, debounced, category, showAll, sortBy, sortOrder])

  const params = useMemo(() => {
    const p = new URLSearchParams({ dateFrom, dateTo, page: String(page), limit: String(limit), sortBy, sortOrder })
    if (debounced) p.set('search', debounced)
    if (category) p.set('categoryFilter', category)
    if (showAll) p.set('all', '1')
    return p
  }, [dateFrom, dateTo, page, debounced, category, showAll, sortBy, sortOrder])

  const { data, isLoading, error } = useQuery({
    queryKey: ['opening-closing', params.toString()],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/reports/opening-closing?${params}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load the stock report')
      return body
    },
    enabled: !!dateFrom && !!dateTo,
    refetchOnWindowFocus: false
  })
  const rows: any[] = data?.products || []
  const t = data?.totals
  const totalPages = data?.pagination?.totalPages || 1

  const sortHead = (key: string, label: string, right = true) => (
    <th
      className={`cursor-pointer hover:bg-slate-700/50 ${right ? 'text-right' : ''}`}
      onClick={() => { if (sortBy === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); else { setSortBy(key); setSortOrder(key === 'product_name' ? 'asc' : 'desc') } }}
    >
      {label}{sortBy === key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  const exportAll = async () => {
    const p = new URLSearchParams(params)
    p.set('page', '1'); p.set('limit', '5000')
    const r = await fetch(`/api/reports/opening-closing?${p}`)
    return r.ok ? (await r.json()).products || [] : []
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-2">Opening / Closing Stock</h1>
        <p className="text-sm text-slate-400 mb-6">
          Quantity at the start of the range, what came in and went out, and the quantity at the end. Values use the
          last purchase rate on or before each date.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e) }} placeholder="Select date range..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Product</label>
            <ClearableInput value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Name, part no, HSN" className="input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
            <SearchableSelect options={categories} selectedValue={category} onSelectionChange={v => setCategory(v || '')} placeholder="All categories" />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Include products with no stock or movement
            </label>
          </div>
        </div>

        {t && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Opening</div><div className="text-xl font-bold text-white">{qty(t.opening_qty)}</div><div className="text-xs text-slate-400">{money(t.opening_value)}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">In</div><div className="text-xl font-bold text-green-300">{qty(t.purchased + t.sale_returned + t.new_stock_in)}</div><div className="text-xs text-slate-400">Purchased {qty(t.purchased)} · Sale returns {qty(t.sale_returned)}{t.new_stock_in ? ` · New products ${qty(t.new_stock_in)}` : ''}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Out</div><div className="text-xl font-bold text-red-300">{qty(t.sold + t.purchase_returned + t.dead_stock)}</div><div className="text-xs text-slate-400">Sold {qty(t.sold)} · Purchase returns {qty(t.purchase_returned)} · Dead stock {qty(t.dead_stock)}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Closing</div><div className="text-xl font-bold text-white">{qty(t.closing_qty)}</div><div className="text-xs text-slate-400">{money(t.closing_value)}</div></div>
          </div>
        )}
        {t?.mismatched_products > 0 && (
          <div className="mb-4 text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-700/40 rounded p-3">
            {t.mismatched_products} product(s): today&apos;s stock does not equal what the documents add up to (older data or a direct change). The column &quot;Differs by&quot; shows how much.
          </div>
        )}

        <div className="flex justify-between items-center mb-3 text-sm text-slate-400">
          <div>{data?.pagination?.total ?? 0} products</div>
          <ExportMenu
            data={rows}
            fetchAll={exportAll}
            columns={[
              { key: 'product_name', label: 'Product', enabled: true },
              { key: 'part_no', label: 'Part No', enabled: true },
              { key: 'opening_qty', label: 'Opening Qty', enabled: true },
              { key: 'opening_value', label: 'Opening Value', enabled: true },
              { key: 'purchased', label: 'Purchased', enabled: true },
              { key: 'purchase_returned', label: 'Purchase Returns', enabled: true },
              { key: 'sold', label: 'Sold', enabled: true },
              { key: 'sale_returned', label: 'Sale Returns', enabled: true },
              { key: 'dead_stock', label: 'Dead Stock', enabled: true },
              { key: 'closing_qty', label: 'Closing Qty', enabled: true },
              { key: 'closing_rate', label: 'Rate', enabled: true },
              { key: 'closing_value', label: 'Closing Value', enabled: true }
            ]}
            config={{ title: 'Opening / Closing Stock', fileName: `Opening_Closing_Stock_${getLocalDateString()}` }}
          />
        </div>

        {isLoading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}

        {!isLoading && !error && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {sortHead('product_name', 'Product', false)}
                  {sortHead('opening_qty', 'Opening')}
                  {sortHead('purchased', 'Purchased')}
                  <th className="text-right">Pur. Ret.</th>
                  {sortHead('sold', 'Sold')}
                  <th className="text-right">Sale Ret.</th>
                  <th className="text-right">Dead</th>
                  {sortHead('closing_qty', 'Closing')}
                  <th className="text-right">Rate</th>
                  {sortHead('closing_value', 'Value')}
                  {sortHead('mismatch', 'Differs by')}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.product_id}>
                    <td>
                      <Link href={`/products/view/${r.product_id}`} className="text-blue-400 hover:underline">{r.product_name}</Link>
                      {r.part_no && <div className="text-xs text-slate-500">{r.part_no}</div>}
                    </td>
                    <td className="text-right">{qty(r.opening_qty)}</td>
                    <td className="text-right text-green-300">{r.purchased ? qty(r.purchased) : '—'}</td>
                    <td className="text-right">{r.purchase_returned ? qty(r.purchase_returned) : '—'}</td>
                    <td className="text-right text-red-300">{r.sold ? qty(r.sold) : '—'}</td>
                    <td className="text-right">{r.sale_returned ? qty(r.sale_returned) : '—'}</td>
                    <td className="text-right">{r.dead_stock ? qty(r.dead_stock) : '—'}</td>
                    <td className="text-right font-semibold text-white">{qty(r.closing_qty)}</td>
                    <td className="text-right">{money(r.closing_rate)}</td>
                    <td className="text-right text-white">{money(r.closing_value)}</td>
                    <td className={`text-right ${r.mismatch ? 'text-yellow-300' : 'text-slate-500'}`}>{r.mismatch ? qty(r.mismatch) : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={11} className="text-center text-slate-400 py-6">No products</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button className="btn-secondary disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="text-slate-400 text-sm">Page {page} of {totalPages}</span>
            <button className="btn-secondary disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
