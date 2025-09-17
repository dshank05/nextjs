import { useEffect, useState } from 'react'
import { format } from 'date-fns'

interface DashboardStats {
  totalProducts: number
  lowStockProducts: number
  totalInvoices: number
  totalPurchases: number
  todaysSales: number
  todaysPurchases: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalProducts: 0,
    lowStockProducts: 0,
    totalInvoices: 0,
    totalPurchases: 0,
    todaysSales: 0,
    todaysPurchases: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch dashboard stats
    fetchDashboardStats()
  }, [])

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

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Today's Sales</h3>
          <div className="text-3xl font-bold text-emerald-400 mb-2">
            ₹{stats.todaysSales.toLocaleString()}
          </div>
          <p className="text-slate-400 text-sm">Total sales amount for today</p>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Today's Purchases</h3>
          <div className="text-3xl font-bold text-blue-400 mb-2">
            ₹{stats.todaysPurchases.toLocaleString()}
          </div>
          <p className="text-slate-400 text-sm">Total purchase amount for today</p>
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
