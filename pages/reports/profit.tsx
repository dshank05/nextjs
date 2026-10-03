import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { ExportMenu } from '../../components/common'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/** Gross profit by period (server: lib/profit-report.ts). */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTHS[parseInt(mm) - 1]} ${y}` }

export default function ProfitPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  useEffect(() => {
    // Default: this financial year so far (April to now)
    const now = new Date()
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    setDateFrom(formatStartDateForAPI(new Date(fyStart, 3, 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  }, [])

  const { data: d, isLoading, error } = useQuery({
    queryKey: ['profit', dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/reports/profit?${new URLSearchParams({ dateFrom, dateTo })}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load the profit report')
      return body
    },
    enabled: !!dateFrom && !!dateTo,
    refetchOnWindowFocus: false
  })

  const ProductTable = ({ title, rows }: { title: string; rows: any[] }) => (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 overflow-x-auto">
      <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      <table className="table">
        <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Net sales</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.product_id}>
              <td><Link href={`/products/view/${p.product_id}`} className="text-blue-400 hover:underline">{p.product_name}</Link></td>
              <td className="text-right">{p.qty}</td><td className="text-right">{money(p.net_sales)}</td><td className="text-right">{money(p.cost)}</td>
              <td className={`text-right font-semibold ${p.profit < 0 ? 'text-red-300' : 'text-white'}`}>{money(p.profit)}</td>
              <td className="text-right">{p.margin}%</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-3">None</td></tr>}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-2">Profit by Period</h1>
        <p className="text-sm text-slate-400 mb-6">
          Gross profit on goods: sales (ex-GST, after discount) less returns, less cost at the last purchase rate on or before each sale.
          Freight, packing and expenses are not included.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">Period</label>
            <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e) }} placeholder="Select period..." />
          </div>
          <div className="flex items-end">
            {d && (
              <ExportMenu
                data={d.topProducts}
                columns={[
                  { key: 'product_name', label: 'Product', enabled: true }, { key: 'qty', label: 'Qty', enabled: true },
                  { key: 'net_sales', label: 'Net Sales', enabled: true }, { key: 'cost', label: 'Cost', enabled: true },
                  { key: 'profit', label: 'Profit', enabled: true }, { key: 'margin', label: 'Margin %', enabled: true }
                ]}
                config={{ title: 'Profit by Product', fileName: `Profit_by_Product_${getLocalDateString()}` }}
              />
            )}
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}
        {d && !isLoading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Sales</div><div className="text-xl font-bold text-white">{money(d.total.sales)}</div></div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Returns</div><div className="text-xl font-bold text-white">{money(d.total.returns)}</div></div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Cost of goods</div><div className="text-xl font-bold text-white">{money(d.total.cost)}</div></div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Gross profit</div><div className={`text-xl font-bold ${d.total.profit < 0 ? 'text-red-300' : 'text-green-300'}`}>{money(d.total.profit)}</div></div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Margin</div><div className="text-xl font-bold text-white">{d.total.margin}%</div></div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6 overflow-x-auto">
              <h3 className="text-lg font-semibold text-white mb-3">By month</h3>
              <table className="table">
                <thead><tr><th>Month</th><th className="text-right">Sales</th><th className="text-right">Returns</th><th className="text-right">Net sales</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr></thead>
                <tbody>
                  {d.byMonth.map((m: any) => (
                    <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="text-right">{money(m.sales)}</td><td className="text-right">{money(m.returns)}</td><td className="text-right">{money(m.net_sales)}</td><td className="text-right">{money(m.cost)}</td><td className={`text-right font-semibold ${m.profit < 0 ? 'text-red-300' : 'text-white'}`}>{money(m.profit)}</td><td className="text-right">{m.margin}%</td></tr>
                  ))}
                  {d.byMonth.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-3">No sales</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ProductTable title={`Most profitable products (${d.productCount} sold)`} rows={d.topProducts.slice(0, 25)} />
              <ProductTable title="Sold below cost" rows={d.lossMaking.slice(0, 25)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
