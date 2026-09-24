import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { getLocalDateString } from '../lib/date-utils'

/**
 * The dashboard.
 *
 * It used to make four requests on mount - `stats`, `trends`, and `daily-stats`
 * twice - for about 1.7 seconds of API time, of which roughly half was waste:
 * `trends` was fetched and never rendered (D-01), and the Daily Sales and Daily
 * Purchases panels each fetched the same endpoint with the same default date
 * (D-02). All three endpoints are now one, `/api/dashboard`.
 *
 * Dates are sent as YYYY-MM-DD from here rather than derived on the server,
 * because the browser is the only side that knows the user's timezone (D-09).
 */

interface DashboardData {
  totals: { products: number; lowStock: number; sales: number; purchases: number }
  today: { date: string; sales: number; purchases: number }
  salesDay: { date: string; total: number }
  purchasesDay: { date: string; total: number }
  lastSale: { amount: number; date: number; invoiceNo: number } | null
  lastPurchase: { amount: number; date: number; invoiceNo: number } | null
}

const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`

/** Unix seconds, or a date string, rendered as a readable date. */
function formatStamp(value: number | string): string {
  try {
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
    return isNaN(date.getTime()) ? String(value) : format(date, 'PPP')
  } catch {
    return String(value)
  }
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  // A failed load used to leave the page showing zeros with nothing to say so,
  // because every fetch was `if (response.ok)` with no else (D-10).
  const [error, setError] = useState<string | null>(null)

  const [salesDate, setSalesDate] = useState(() => getLocalDateString())
  const [purchasesDate, setPurchasesDate] = useState(() => getLocalDateString())

  // Recomputed only when the component mounts, not on every render.
  const last5Days = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const date = subDays(new Date(), i)
        return {
          date: getLocalDateString(date),
          label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : format(date, 'MMM d'),
        }
      }),
    []
  )

  const load = useCallback(async (sales: string, purchases: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        today: getLocalDateString(),
        salesDate: sales,
        purchasesDate: purchases,
      })
      const response = await fetch(`/api/dashboard?${params}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message || `Request failed (${response.status})`)
      }
      setData(await response.json())
    } catch (e) {
      console.error('Dashboard load failed:', e)
      setError(e instanceof Error ? e.message : 'Could not load the dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(salesDate, purchasesDate)
  }, [load, salesDate, purchasesDate])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  const cards = [
    { tone: 'primary', icon: '📦', label: 'Total Products', labelTone: 'text-blue-100', value: (data?.totals.products ?? 0).toLocaleString() },
    { tone: 'warning', icon: '⚠️', label: 'Low Stock', labelTone: 'text-amber-100', value: (data?.totals.lowStock ?? 0).toLocaleString() },
    { tone: 'success', icon: '🧾', label: 'Total Sales', labelTone: 'text-emerald-100', value: (data?.totals.sales ?? 0).toLocaleString() },
    { tone: 'danger', icon: '🛒', label: 'Total Purchases', labelTone: 'text-red-100', value: (data?.totals.purchases ?? 0).toLocaleString() },
    { tone: 'info', icon: '💰', label: "Today's Sales", labelTone: 'text-cyan-100', value: money(data?.today.sales ?? 0) },
    { tone: 'secondary', icon: '📈', label: "Today's Purchases", labelTone: 'text-purple-100', value: money(data?.today.purchases ?? 0) },
  ]

  const dayPanels = [
    {
      title: 'Daily Sales',
      selected: salesDate,
      onSelect: setSalesDate,
      total: data?.salesDay.total ?? 0,
      activeClass: 'bg-emerald-600 text-white',
      amountClass: 'text-3xl font-bold text-emerald-400 mb-2',
      noun: 'Sales',
    },
    {
      title: 'Daily Purchases',
      selected: purchasesDate,
      onSelect: setPurchasesDate,
      total: data?.purchasesDay.total ?? 0,
      activeClass: 'bg-blue-600 text-white',
      amountClass: 'text-3xl font-bold text-blue-400 mb-2',
      noun: 'Purchases',
    },
  ]

  return (
    <div className="space-y-8 p-8 min-h-screen bg-slate-900">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <div className="text-slate-400 text-sm">{format(new Date(), 'PPPP')}</div>
      </div>

      {error && (
        <div className="card border border-red-700 bg-red-900/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-red-200">Could not load the dashboard</div>
              <div className="text-sm text-red-300/80 mt-1">{error}</div>
            </div>
            <button className="btn-secondary" onClick={() => load(salesDate, purchasesDate)}>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((card) => (
          <div key={card.label} className={`stat-card ${card.tone}`}>
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                  <span className="text-xl">{card.icon}</span>
                </div>
              </div>
              <div className="ml-4 w-0 flex-1">
                <dl>
                  <dt className={`text-sm font-medium ${card.labelTone} truncate`}>{card.label}</dt>
                  <dd className="text-xl font-bold text-white">{card.value}</dd>
                </dl>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Daily Sales and Purchases with Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {dayPanels.map((panel) => (
          <div className="card" key={panel.title}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{panel.title}</h3>
              <div className="flex gap-1">
                {last5Days.map((day) => (
                  <button
                    key={day.date}
                    onClick={() => panel.onSelect(day.date)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors duration-200 ${
                      panel.selected === day.date
                        ? panel.activeClass
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400"></div>
              </div>
            ) : (
              <div>
                <div className={panel.amountClass}>{money(panel.total)}</div>
                <p className="text-slate-400 text-sm">
                  {panel.noun} for{' '}
                  {last5Days.find((d) => d.date === panel.selected)?.label ||
                    format(new Date(panel.selected), 'MMM d')}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Last Sale and Purchase */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Last Sale</h3>
          {data?.lastSale ? (
            <div>
              <div className="text-2xl font-bold text-emerald-400 mb-2">{money(data.lastSale.amount)}</div>
              <p className="text-slate-400 text-sm mb-1">Invoice #{data.lastSale.invoiceNo}</p>
              <p className="text-slate-400 text-xs">{formatStamp(data.lastSale.date)}</p>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No sales found</div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Last Purchase</h3>
          {data?.lastPurchase ? (
            <div>
              <div className="text-2xl font-bold text-blue-400 mb-2">{money(data.lastPurchase.amount)}</div>
              <p className="text-slate-400 text-sm mb-1">Invoice #{data.lastPurchase.invoiceNo}</p>
              <p className="text-slate-400 text-xs">{formatStamp(data.lastPurchase.date)}</p>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No purchases found</div>
          )}
        </div>
      </div>
    </div>
  )
}
