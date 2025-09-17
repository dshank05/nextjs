import { useState, useEffect } from 'react'

interface Product {
  id: number
  product_name: string
  product_category?: string
  company?: string
  stock?: number
  min_stock?: number
  rate?: number
  part_no?: string
}

export default function LowStock() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLowStockProducts()
  }, [])

  const fetchLowStockProducts = async () => {
    try {
      const response = await fetch('/api/products?lowStock=true&limit=1000')
      if (response.ok) {
        const data = await response.json()
        // Filter for low stock products on frontend for now
        const lowStockProducts = (data.products || []).filter((p: Product) => 
          (p.stock || 0) < (p.min_stock || 0)
        )
        setProducts(lowStockProducts)
      }
    } catch (error) {
      console.error('Error fetching low stock products:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Low Stock Alert</h1>
        <div className="flex space-x-2">
          <button 
            onClick={fetchLowStockProducts}
            className="btn-secondary"
          >
            Refresh
          </button>
          <button className="btn-primary">
            Add Stock
          </button>
        </div>
      </div>

      {/* Alert Banner */}
      {products.length > 0 && (
        <div className="bg-red-600/20 border border-red-500 rounded-lg p-4">
          <div className="flex items-center">
            <span className="text-2xl mr-3">⚠️</span>
            <div>
              <h3 className="text-red-400 font-semibold">Low Stock Alert!</h3>
              <p className="text-red-300 text-sm">
                {products.length} products are running low on stock and need immediate attention.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="stat-card danger">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-3xl">📉</span>
            </div>
            <div className="ml-4">
              <p className="text-red-100 text-sm">Critical Stock Items</p>
              <p className="text-3xl font-bold">{products.length}</p>
              <p className="text-red-200 text-sm">Products below minimum stock</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-red-100 text-sm">Action Required</p>
            <p className="text-2xl font-semibold">🚨</p>
          </div>
        </div>
      </div>

      {/* Low Stock Products Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Products Requiring Immediate Attention</h3>
          <span className="text-sm text-slate-400">
            Showing products where stock &lt; minimum stock
          </span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Part No</th>
                <th>Category</th>
                <th>Company</th>
                <th>Current Stock</th>
                <th>Min Required</th>
                <th>Shortage</th>
                <th>Rate</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const shortage = (product.min_stock || 0) - (product.stock || 0)
                const criticalLevel = (product.stock || 0) === 0
                
                return (
                  <tr key={product.id} className={criticalLevel ? 'bg-red-900/30' : ''}>
                    <td className="font-medium text-white">{product.product_name}</td>
                    <td className="text-slate-300">{product.part_no || '-'}</td>
                    <td className="text-slate-300">{product.product_category || '-'}</td>
                    <td className="text-slate-300">{product.company || '-'}</td>
                    <td className={`font-semibold ${criticalLevel ? 'text-red-400' : 'text-orange-400'}`}>
                      {product.stock || 0}
                    </td>
                    <td className="text-slate-300">{product.min_stock || 0}</td>
                    <td className="text-red-400 font-semibold">-{shortage}</td>
                    <td className="text-slate-300">₹{product.rate || 0}</td>
                    <td>
                      {criticalLevel ? (
                        <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full font-semibold">
                          🚨 OUT OF STOCK
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">
                          ⚠️ LOW STOCK
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          
          {products.length === 0 && (
            <div className="text-center py-12">
              <span className="text-6xl mb-4 block">✅</span>
              <h3 className="text-xl font-semibold text-green-400 mb-2">All Good!</h3>
              <p className="text-slate-400">
                No products are currently running low on stock.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      {products.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="flex items-center justify-center p-4 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
              <span className="text-xl mr-2">📦</span>
              <span>Create Purchase Order</span>
            </button>
            <button className="flex items-center justify-center p-4 bg-green-600 hover:bg-green-700 rounded-lg transition-colors">
              <span className="text-xl mr-2">📊</span>
              <span>Export Low Stock Report</span>
            </button>
            <button className="flex items-center justify-center p-4 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
              <span className="text-xl mr-2">🔔</span>
              <span>Set Up Alerts</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
