import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { SearchableSelect, ExportMenu } from '../../components/common'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/** Cash / bank book (server: lib/cash-book.ts). */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CashBookPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [mode, setMode] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 100

  useEffect(() => {
    const now = new Date()
    setDateFrom(formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  }, [])
  useEffect(() => { setPage(1) }, [dateFrom, dateTo, mode])

  const params = useMemo(() => new URLSearchParams({ dateFrom, dateTo, mode, page: String(page), limit: String(limit) }), [dateFrom, dateTo, mode, page])
  const { data, isLoading, error } = useQuery({
    queryKey: ['cash-book', params.toString()],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/reports/cash-book?${params}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load the cash / bank book')
      return body
    },
    enabled: !!dateFrom && !!dateTo,
    refetchOnWindowFocus: false
  })
  const rows: any[] = data?.rows || []
  const t = data?.totals
  const totalPages = data?.pagination?.totalPages || 1

  const exportAll = async () => {
    const p = new URLSearchParams(params); p.set('page', '1'); p.set('limit', '5000')
    const r = await fetch(`/api/reports/cash-book?${p}`)
    return r.ok ? (await r.json()).rows || [] : []
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-2">Cash / Bank Book</h1>
        <p className="text-sm text-slate-400 mb-6">
          Every recorded receipt and payment: customer payments and refunds, vendor payments and refunds, and returns marked complete.
          &quot;Brought forward&quot; is everything recorded before the period (there is no opening cash entry).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">Period</label>
            <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e) }} placeholder="Select period..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Book</label>
            <SearchableSelect options={[{ id: 'all', name: 'Cash + Bank' }, { id: 'cash', name: 'Cash' }, { id: 'bank', name: 'Bank' }]} selectedValue={mode} onSelectionChange={v => setMode(v || 'all')} placeholder="Cash + Bank" />
          </div>
          <div className="flex items-end">
            <ExportMenu
              data={rows}
              fetchAll={exportAll}
              columns={[
                { key: 'formattedDate', label: 'Date', enabled: true }, { key: 'particulars', label: 'Particulars', enabled: true },
                { key: 'party', label: 'Party', enabled: true }, { key: 'reference', label: 'Reference', enabled: true },
                { key: 'mode', label: 'Mode', enabled: true }, { key: 'money_in', label: 'In', enabled: true },
                { key: 'money_out', label: 'Out', enabled: true }, { key: 'balance', label: 'Balance', enabled: true }
              ]}
              config={{ title: 'Cash Bank Book', fileName: `Cash_Bank_Book_${getLocalDateString()}` }}
            />
          </div>
        </div>

        {t && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Brought forward</div><div className="text-xl font-bold text-white">{money(data.opening)}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Money in</div><div className="text-xl font-bold text-green-300">{money(t.in)}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Money out</div><div className="text-xl font-bold text-red-300">{money(t.out)}</div></div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Closing</div><div className="text-xl font-bold text-white">{money(t.closing)}</div>{mode === 'all' && <div className="text-xs text-slate-400">Period net: cash {money(t.cashNet)} · bank {money(t.bankNet)}</div>}</div>
          </div>
        )}

        {isLoading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}
        {!isLoading && !error && data && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Particulars</th><th>Party</th><th>Ref</th><th>Mode</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                <tr className="bg-slate-800/40"><td colSpan={7} className="text-slate-400">{page > 1 ? 'Carried from the previous page' : 'Brought forward'}</td><td className="text-right text-white">{money(data.pageOpening)}</td></tr>
                {rows.map(r => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>{r.formattedDate}</td>
                    <td className="text-slate-300">{r.particulars}{r.notes && <div className="text-xs text-slate-500 truncate max-w-xs">{r.notes}</div>}</td>
                    <td>{r.party}</td>
                    <td><Link href={r.url} className="text-blue-400 hover:underline">{r.reference}</Link></td>
                    <td>{r.mode}</td>
                    <td className="text-right text-green-300">{r.money_in ? money(r.money_in) : ''}</td>
                    <td className="text-right text-red-300">{r.money_out ? money(r.money_out) : ''}</td>
                    <td className="text-right text-white">{money(r.balance)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-6">Nothing recorded in this period</td></tr>}
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
