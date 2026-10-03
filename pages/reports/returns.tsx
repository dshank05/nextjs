import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { SearchableSelect, ExportMenu, ClearableInput } from '../../components/common'
import { useDebounce } from '../../hooks/useDebounce'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/** Return registers: sale, Invoice C and purchase returns (server: lib/return-register.ts). */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const KIND_LABEL: Record<string, string> = { sale: 'Sale', salex: 'Invoice C', purchase: 'Purchase' }

export default function ReturnRegisterPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounce(search, 400)
  const limit = 50

  useEffect(() => {
    const now = new Date()
    setDateFrom(formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  }, [])
  useEffect(() => { setPage(1) }, [dateFrom, dateTo, kind, status, debounced])

  const params = useMemo(() => {
    const p = new URLSearchParams({ kind, page: String(page), limit: String(limit) })
    if (dateFrom) p.set('dateFrom', dateFrom)
    if (dateTo) p.set('dateTo', dateTo)
    if (status !== '') p.set('status', status)
    if (debounced) p.set('search', debounced)
    return p
  }, [kind, page, dateFrom, dateTo, status, debounced])

  const { data, isLoading, error } = useQuery({
    queryKey: ['return-register', params.toString()],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/reports/returns?${params}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load returns')
      return body
    },
    refetchOnWindowFocus: false
  })
  const rows: any[] = data?.returns || []
  const t = data?.totals
  const totalPages = data?.pagination?.totalPages || 1

  const exportAll = async () => {
    const p = new URLSearchParams(params); p.set('page', '1'); p.set('limit', '5000')
    const r = await fetch(`/api/reports/returns?${p}`)
    return r.ok ? (await r.json()).returns || [] : []
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-6">Return Register</h1>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e) }} placeholder="All dates" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Returns</label>
            <SearchableSelect
              options={[{ id: 'all', name: 'All returns' }, { id: 'customer', name: 'Sale + Invoice C' }, { id: 'sale', name: 'Sale' }, { id: 'salex', name: 'Invoice C' }, { id: 'purchase', name: 'Purchase' }]}
              selectedValue={kind} onSelectionChange={v => setKind(v || 'all')} placeholder="All returns" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
            <SearchableSelect
              options={[{ id: '', name: 'Any' }, { id: '0', name: 'Pending' }, { id: '1', name: 'Complete' }, { id: '2', name: 'Partial' }]}
              selectedValue={status} onSelectionChange={v => setStatus(v || '')} placeholder="Any" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Party / note</label>
            <ClearableInput value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Name or debit note" className="input w-full" />
          </div>
        </div>

        {t && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
            {(['sale', 'salex', 'purchase'] as const).filter(k => t.byKind[k]).map(k => (
              <div key={k} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="text-slate-400 text-sm">{KIND_LABEL[k]} returns ({t.byKind[k].count})</div>
                <div className="text-xl font-bold text-white">{money(t.byKind[k].refund)}</div>
                <div className="text-xs text-slate-400">Taxable {money(t.byKind[k].taxable)} · GST {money(t.byKind[k].tax)}</div>
              </div>
            ))}
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Settled (complete)</div>
              <div className="text-xl font-bold text-green-300">{money(t.settled)}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">Waiting for refund</div>
              <div className="text-xl font-bold text-yellow-300">{money(t.pending)}</div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-3 text-sm text-slate-400">
          <div>{data?.pagination?.total ?? 0} returns</div>
          <ExportMenu
            data={rows}
            fetchAll={exportAll}
            columns={[
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'note_no', label: 'Note No', enabled: true },
              { key: 'kind', label: 'Type', enabled: true, format: (r: any) => KIND_LABEL[r.kind] },
              { key: 'party_name', label: 'Party', enabled: true },
              { key: 'bill_no', label: 'Bill', enabled: true },
              { key: 'items', label: 'Items', enabled: true },
              { key: 'taxable', label: 'Taxable', enabled: true },
              { key: 'tax', label: 'GST', enabled: true },
              { key: 'charges', label: 'P&F / Freight', enabled: true },
              { key: 'refund', label: 'Refund', enabled: true },
              { key: 'status_text', label: 'Status', enabled: true }
            ]}
            config={{ title: 'Return Register', fileName: `Return_Register_${getLocalDateString()}` }}
          />
        </div>

        {isLoading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}
        {!isLoading && !error && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Note</th><th>Type</th><th>Party</th><th>Bill</th><th className="text-right">Items</th>
                  <th className="text-right">Taxable</th><th className="text-right">GST</th><th className="text-right">P&amp;F / Freight</th>
                  <th className="text-right">Refund</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>{r.formattedDate}</td>
                    <td><Link href={r.url} className="text-blue-400 hover:underline">{r.note_no}</Link></td>
                    <td>{KIND_LABEL[r.kind]}</td>
                    <td className="text-slate-300">{r.party_name}</td>
                    <td>{r.bill_no ?? '—'}</td>
                    <td className="text-right">{r.items}</td>
                    <td className="text-right">{money(r.taxable)}</td>
                    <td className="text-right">{r.tax ? money(r.tax) : '—'}</td>
                    <td className="text-right">{r.charges ? money(r.charges) : '—'}</td>
                    <td className="text-right text-white font-semibold">{money(r.refund)}</td>
                    <td>
                      <span className={`px-2 py-1 text-xs rounded-full ${r.status === 1 ? 'bg-green-600' : r.status === 2 ? 'bg-orange-600' : 'bg-yellow-600'} text-white`}>{r.status_text}</span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={11} className="text-center text-slate-400 py-6">No returns</td></tr>}
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
