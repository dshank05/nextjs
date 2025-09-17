import { useState, useEffect } from 'react'

interface Purchase {
  id: number
  invoice_no: number
  invoice_date: string
  total: number
  status?: number
  fy: number
}

export default function Purchases() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPurchases()
  }, [])

  const fetchPurchases = async () => {
    try {
      // For now, let's just set loading to false
      setLoading(false)
    } catch (error) {
      console.error('Error fetching purchases:', error)
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
        <h1 className="text-2xl font-bold text-white">Purchase Orders</h1>
        <button className="btn-primary">
          New Purchase
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="stat-card primary">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-2xl">🛒</span>
            </div>
            <div className="ml-4">
              <p className="text-blue-100 text-sm">Total Purchases</p>
              <p className="text-2xl font-semibold">{purchases.length}</p>
            </div>
          </div>
        </div>

        <div className="stat-card success">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-2xl">💰</span>
            </div>
            <div className="ml-4">
              <p className="text-emerald-100 text-sm">Total Amount</p>
              <p className="text-2xl font-semibold">
                ₹{purchases.reduce((sum, pur) => sum + (pur.total || 0), 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-card warning">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-2xl">📅</span>
            </div>
            <div className="ml-4">
              <p className="text-amber-100 text-sm">This Month</p>
              <p className="text-2xl font-semibold">
                {purchases.filter(pur => {
                  const purchaseDate = new Date(pur.invoice_date)
                  const now = new Date()
                  return purchaseDate.getMonth() === now.getMonth()
                }).length}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-card danger">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-2xl">📊</span>
            </div>
            <div className="ml-4">
              <p className="text-red-100 text-sm">Pending</p>
              <p className="text-2xl font-semibold">
                {purchases.filter(pur => pur.status !== 1).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Purchases Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Purchase No</th>
                <th>Date</th>
                <th>Total Amount</th>
                <th>Financial Year</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    No purchase orders found. Your purchase data will appear here.
                  </td>
                </tr>
              ) : (
                purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="font-medium text-white">PUR-{purchase.invoice_no}</td>
                    <td className="text-slate-300">{purchase.invoice_date}</td>
                    <td className="text-slate-300">₹{purchase.total.toLocaleString()}</td>
                    <td className="text-slate-300">FY-{purchase.fy}</td>
                    <td>
                      <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                        Completed
                      </span>
                    </td>
                    <td>
                      <div className="flex space-x-2">
                        <button className="text-blue-400 hover:text-blue-300 text-sm">View</button>
                        <button className="text-green-400 hover:text-green-300 text-sm">Edit</button>
                        <button className="text-purple-400 hover:text-purple-300 text-sm">Print</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
