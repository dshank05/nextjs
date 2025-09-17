import { useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'

interface DashboardStats {
  totalProducts: number
  lowStockProducts: number
  totalInvoices: number
  totalPurchases: number
  todaysSales: number
  todaysPurchases: number
  lastSale: {
    amount: number
    date: number | string
    invoiceNo: number
  } | null
  lastPurchase: {
    amount: number
    date: string // Unix timestamp as string
    invoiceNo: number
  } | null
}

interface DailyStats {
  date: string
  sales: number
  purchases: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalProducts: 0,
    lowStockProducts: 0,
    totalInvoices: 0,
    totalPurchases: 0,
    todaysSales: 0,
    todaysPurchases: 0,
    lastSale: null,
    lastPurchase: null,
  })
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0] // YYYY-MM-DD format
  })
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null)
  const [dailyStatsLoading, setDailyStatsLoading] = useState(false)

  // Generate last 5 days for navigation
  const last5Days = Array.from({ length: 5 }, (_, i) => {
    const date = subDays(new Date(), i)
    return {
      date: date.toISOString().split('T')[0],
      label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : format(date, 'MMM d')
    }
  })

  useEffect(() => {
    // Fetch dashboard stats
    fetchDashboardStats()
  }, [])

  useEffect(() => {
    // Fetch daily stats when selected date changes
    fetchDailyStats(selectedDate)
  }, [selectedDate])

  const fetchDashboardStats = async () => {
    try {
      const response = await fetch('/api/dashboard/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchDailyStats = async (date: string) => {
    setDailyStatsLoading(true)
    try {
      const response = await fetch(`/api/dashboard/daily-stats?date=${date}`)
      if (response.ok) {
        const data = await response.json()
        setDailyStats(data)
      }
    } catch (error) {
      console.error('Error fetching daily stats:', error)
    } finally {
      setDailyStatsLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="text-slate-400 text-sm">
          {format(new Date(), 'PPPP')}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="stat-card primary">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-lg">📦</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-blue-100 truncate">Total Products</dt>
                <dd className="text-lg font-semibold text-white">{stats.totalProducts}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="stat-card warning">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-lg">⚠️</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-amber-100 truncate">Low Stock Items</dt>
                <dd className="text-lg font-semibold text-white">{stats.lowStockProducts}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="stat-card success">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-lg">🧾</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-emerald-100 truncate">Total Invoices</dt>
                <dd className="text-lg font-semibold text-white">{stats.totalInvoices}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="stat-card danger">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <span className="text-lg">🛒</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-red-100 truncate">Total Purchases</dt>
                <dd className="text-lg font-semibold text-white">{stats.totalPurchases}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Sales and Purchases with Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Daily Sales</h3>
            <div className="flex gap-1">
              {last5Days.map((day) => (
                <button
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors duration-200 ${
                    selectedDate === day.date
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
          {dailyStatsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
            </div>
          ) : (
            <div>
              <div className="text-3xl font-bold text-emerald-400 mb-2">
                ₹{(dailyStats?.sales || 0).toLocaleString()}
              </div>
              <p className="text-slate-400 text-sm">
                Sales for {last5Days.find(d => d.date === selectedDate)?.label || format(new Date(selectedDate), 'MMM d')}
              </p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Daily Purchases</h3>
            <div className="flex gap-1">
              {last5Days.map((day) => (
                <button
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors duration-200 ${
                    selectedDate === day.date
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
          {dailyStatsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
            </div>
          ) : (
            <div>
              <div className="text-3xl font-bold text-blue-400 mb-2">
                ₹{(dailyStats?.purchases || 0).toLocaleString()}
              </div>
              <p className="text-slate-400 text-sm">
                Purchases for {last5Days.find(d => d.date === selectedDate)?.label || format(new Date(selectedDate), 'MMM d')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Last Sale and Purchase */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Last Sale</h3>
          {stats.lastSale ? (
            <div>
              <div className="text-2xl font-bold text-emerald-400 mb-2">
                ₹{stats.lastSale.amount.toLocaleString()}
              </div>
              <p className="text-slate-400 text-sm mb-1">
                Invoice #{stats.lastSale.invoiceNo}
              </p>
              <p className="text-slate-400 text-xs">
                {(() => {
                  try {
                    const date = typeof stats.lastSale.date === 'number' 
                      ? new Date(stats.lastSale.date * 1000)
                      : new Date(stats.lastSale.date)
                    return isNaN(date.getTime()) ? String(stats.lastSale.date) : format(date, 'PPP')
                  } catch (error) {
                    return String(stats.lastSale.date)
                  }
                })()}
              </p>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No sales found</div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Last Purchase</h3>
          {stats.lastPurchase ? (
            <div>
              <div className="text-2xl font-bold text-blue-400 mb-2">
                ₹{stats.lastPurchase.amount.toLocaleString()}
              </div>
              <p className="text-slate-400 text-sm mb-1">
                Invoice #{stats.lastPurchase.invoiceNo}
              </p>
              <p className="text-slate-400 text-xs">
                {(() => {
                  try {
                    // Purchase date is Unix timestamp as string
                    const timestamp = parseInt(stats.lastPurchase.date, 10)
                    const date = new Date(timestamp * 1000) // Convert to milliseconds
                    return isNaN(date.getTime()) ? stats.lastPurchase.date : format(date, 'PPP')
                  } catch (error) {
                    return stats.lastPurchase.date
                  }
                })()}
              </p>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No purchases found</div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <a
            href="/invoices/new"
            className="flex flex-col items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors duration-200"
          >
            <span className="text-2xl mb-2">🧾</span>
            <span className="text-sm text-slate-300">New Invoice</span>
          </a>
          
          <a
            href="/purchases/new"
            className="flex flex-col items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors duration-200"
          >
            <span className="text-2xl mb-2">🛒</span>
            <span className="text-sm text-slate-300">New Purchase</span>
          </a>
          
          <a
            href="/products/new"
            className="flex flex-col items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors duration-200"
          >
            <span className="text-2xl mb-2">📦</span>
            <span className="text-sm text-slate-300">Add Product</span>
          </a>
          
          <a
            href="/products/lowstock"
            className="flex flex-col items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors duration-200"
          >
            <span className="text-2xl mb-2">⚠️</span>
            <span className="text-sm text-slate-300">Low Stock</span>
          </a>
        </div>
      </div>
    </div>
  )
}
