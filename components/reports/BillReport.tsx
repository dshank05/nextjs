import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { SearchableSelect, ExportMenu } from '../common'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/**
 * Sale, Invoice C and Purchase reports: one page (server: lib/bill-report.ts).
 * Summary for the period, returns beside it and the net, GST split, the top
 * customers / vendors and products, and the day-by-day totals.
 */
type Mode = 'sale' | 'salex' | 'purchase'

const CFG = {
  sale: { title: 'Sales Report', endpoint: '/api/reports/sales', party: 'Customers', billWord: 'Sales', choice: true, tax: true },
  salex: { title: 'Invoice C Report', endpoint: '/api/reports/salex-report', party: 'Customers', billWord: 'Invoice C bills', choice: false, tax: false },
  purchase: { title: 'Purchase Report', endpoint: '/api/reports/purchase', party: 'Vendors', billWord: 'Purchases', choice: false, tax: true }
} as const

const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="text-slate-400 text-sm mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

export function BillReport({ mode }: { mode: Mode }) {
  const c = CFG[mode]
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reportType, setReportType] = useState<'sale' | 'salex' | 'both'>('sale')

  useEffect(() => {
    const now = new Date()
    setDateFrom(formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  }, [])

  const params = useMemo(() => {
    const p = new URLSearchParams({ dateFrom, dateTo })
    if (c.choice) p.set('reportType', reportType)
    return p.toString()
  }, [dateFrom, dateTo, reportType, c.choice])

  const { data, isLoading, error } = useQuery({
    queryKey: ['bill-report', mode, params],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${c.endpoint}?${params}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load the report')
      return body
    },
    enabled: !!dateFrom && !!dateTo,
    staleTime: 60000,
    refetchOnWindowFocus: false
  })

  const s = data?.summary
  const parties: any[] = data?.topCustomers || []
  const products: any[] = data?.topProducts || []
  const daily: any[] = data?.dailySales || []
  const showTax = c.tax && (mode !== 'sale' || reportType !== 'salex')

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-6">{c.title}</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={dateFrom}
              endDate={dateTo}
              onDateChange={(start, end) => { setDateFrom(start); setDateTo(end) }}
              placeholder="Select date range..."
            />
          </div>
          {c.choice && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Bills</label>
              <SearchableSelect
                options={[
                  { id: 'sale', name: 'Sale only' },
                  { id: 'salex', name: 'Invoice C only' },
                  { id: 'both', name: 'Sale + Invoice C' }
                ]}
                selectedValue={reportType}
                onSelectionChange={(v) => setReportType(((v as any) || 'sale'))}
                placeholder="Select..."
              />
            </div>
          )}
          <div className="flex items-end">
            <ExportMenu
              data={daily}
              columns={[
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total_sales', label: 'Bills', enabled: true },
                { key: 'total_revenue', label: 'Total', enabled: true }
              ]}
              config={{ title: c.title, fileName: `${c.title.replace(/ /g, '_')}_${getLocalDateString()}` }}
            />
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        )}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}

        {s && !isLoading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <Card label={c.billWord} value={s.totalSales} sub={`${s.paidSales} paid · ${s.partiallyPaidSales} partial · ${s.unpaidSales} unpaid`} />
              <Card label="Bill total" value={money(s.totalRevenue)} sub={`Average ${money(s.avgOrderValue)}`} />
              <Card label="Taxable value" value={money(s.taxable)} />
              {showTax
                ? <Card label="GST" value={money(s.tax)} sub={`CGST ${money(s.cgst)} · SGST ${money(s.sgst)} · IGST ${money(s.igst)}`} />
                : <Card label="GST" value="—" sub="Invoice C carries no GST" />}
              <Card label="Returns in period" value={money(s.returnsAmount)} sub={`${s.returnsCount} return(s)`} />
              <Card label="Net of returns" value={money(s.netRevenue)} sub={`Cash ${money(s.cashSales)} · Bank ${money(s.bankSales)}`} />
            </div>
            <p className="text-xs text-slate-500 mb-6">
              Items: {s.totalItems} · {c.party}: {s.totalCustomers}. Cash / Bank is the payment mode on the bill.
              Returns are those dated in the period, whichever bill they belong to.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="text-lg font-semibold text-white mb-4">Top {c.party}</h3>
                <table className="table">
                  <thead><tr><th>#</th><th>Name</th><th className="text-right">Bills</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {parties.slice(0, 15).map((p, i) => (
                      <tr key={`${p.party_id}-${i}`}>
                        <td>{i + 1}</td><td className="text-slate-300">{p.customer_name}</td>
                        <td className="text-right">{p.total_sales}</td><td className="text-right text-white">{money(p.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="text-lg font-semibold text-white mb-4">Top Products</h3>
                <table className="table">
                  <thead><tr><th>#</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Taxable</th></tr></thead>
                  <tbody>
                    {products.slice(0, 15).map((p, i) => (
                      <tr key={`${p.product_id}-${i}`}>
                        <td>{i + 1}</td><td className="text-slate-300">{p.product_name}</td>
                        <td className="text-right">{p.total_qty}</td><td className="text-right text-white">{money(p.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-4">Day by day</h3>
              <table className="table">
                <thead><tr><th>Date</th><th className="text-right">Bills</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {daily.map(d => (
                    <tr key={d.date}><td>{d.date}</td><td className="text-right">{d.total_sales}</td><td className="text-right text-white">{money(d.total_revenue)}</td></tr>
                  ))}
                  {daily.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No bills in this period</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
