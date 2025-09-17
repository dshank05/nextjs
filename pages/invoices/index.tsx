import { useState, useEffect } from 'react'
import { format } from 'date-fns'

interface Invoice {
  id: number
  invoice_no: number
  invoice_date: number
  total: number
  total_taxable_value: number
  total_tax: number
  status?: number
  fy: number
  customerName?: string
  itemCount?: number
  formattedDate?: string
  formattedTotal?: string
}

interface SalesAnalytics {
  summary: {
    totalInvoices: number
    totalSales: number
    totalTaxableValue: number
    totalTax: number
    averageInvoiceValue: number
  }
  salesByMonth: any[]
  topProducts: any[]
  recentCustomers: any[]
  salesTrends: any[]
  gstBreakdown: {
    cgst: number
    sgst: number
    igst: number
  }
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [analytics, setAnalytics] = useState<SalesAnalytics | null>(null)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasMore: false
  })
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState('month') // month, year, custom
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    fetchInvoices()
    fetchAnalytics()
  }, [pagination.page, pagination.limit])

  useEffect(() => {
    // Reset to page 1 when filters change
    if (pagination.page !== 1) {
      setPagination(prev => ({ ...prev, page: 1 }))
    } else {
      fetchInvoices()
      fetchAnalytics()
    }
  }, [searchTerm, dateRange, startDate, endDate])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        startDate,
        endDate
      })

      const response = await fetch(`/api/invoices?${params}`)
      if (response.ok) {
        const data = await response.json()
        setInvoices(data.invoices || [])
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true)
    try {
      const params = new URLSearchParams({
        period: dateRange,
        startDate,
        endDate
      })

      const response = await fetch(`/api/sales/analytics?${params}`)
      if (response.ok) {
        const data = await response.json()
        setAnalytics(data)
      }
    } catch (error) {
      console.error('Error fetching analytics:', error)
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
  }

  const clearFilters = () => {
    setSearchTerm('')
    setDateRange('month')
    setStartDate('')
    setEndDate('')
  }

  if (loading && analyticsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button className="btn-primary">
          New Invoice
        </button>
      </div>

      {/* Sales Analytics Summary */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="stat-card primary">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">🧾</span>
              </div>
              <div className="ml-4">
                <p className="text-blue-100 text-sm">Total Invoices</p>
                <p className="text-2xl font-semibold">{analytics.summary.totalInvoices}</p>
              </div>
            </div>
          </div>

          <div className="stat-card success">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">💰</span>
              </div>
              <div className="ml-4">
                <p className="text-emerald-100 text-sm">
                  Total Sales ({dateRange === 'month' ? 'This Month' : dateRange === 'year' ? 'This Year' : 'Custom Period'})
                </p>
                <p className="text-2xl font-semibold">₹{analytics.summary.totalSales.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="stat-card warning">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">📊</span>
              </div>
              <div className="ml-4">
                <p className="text-amber-100 text-sm">Avg Invoice Value</p>
                <p className="text-2xl font-semibold">₹{Math.round(analytics.summary.averageInvoiceValue).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="stat-card danger">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">🏛️</span>
              </div>
              <div className="ml-4">
                <p className="text-red-100 text-sm">Total GST</p>
                <p className="text-2xl font-semibold">₹{analytics.summary.totalTax.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sales Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Sales Trend (Last 30 Days)</h3>
          {analytics && analytics.salesTrends && (
            <div className="space-y-3">
              {analytics.salesTrends.slice(0, 10).map((trend: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="text-slate-300 text-sm">
                    {format(new Date(trend.sale_date), 'MMM dd')}
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-slate-400 text-xs">{trend.invoice_count} invoices</div>
                    <div className="text-emerald-400 font-medium">
                      ₹{parseInt(trend.total_sales).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Products */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Top Selling Products</h3>
          {analytics && analytics.topProducts && (
            <div className="space-y-3">
              {analytics.topProducts.slice(0, 8).map((product: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="text-slate-300 text-sm truncate flex-1">
                    {product.product_name}
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-slate-400 text-xs">Qty: {product.total_qty}</div>
                    <div className="text-blue-400 font-medium">
                      ₹{parseInt(product.total_value).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Search & Filter Invoices</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Search Invoice/Notes</label>
            <input
              type="text"
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input w-full"
            />
          </div>

          {/* Date Range */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Period</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="select w-full"
            >
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Start Date */}
          {dateRange === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input w-full"
              />
            </div>
          )}

          {/* End Date */}
          {dateRange === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input w-full"
              />
            </div>
          )}

          {/* Clear Filters */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn-secondary w-full"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Sales Invoices</h3>
          <div className="text-sm text-slate-400">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} invoices
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Taxable Value</th>
                <th>GST</th>
                <th>Total Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="font-medium text-white">INV-{invoice.invoice_no}</td>
                  <td className="text-slate-300">
                    {format(new Date(invoice.invoice_date * 1000), 'dd/MM/yyyy')}
                  </td>
                  <td className="text-slate-300">{invoice.customerName || 'N/A'}</td>
                  <td className="text-slate-300">{invoice.itemCount || 0} items</td>
                  <td className="text-slate-300">₹{invoice.total_taxable_value.toLocaleString()}</td>
                  <td className="text-slate-300">₹{(invoice.total_tax || 0).toLocaleString()}</td>
                  <td className="text-emerald-400 font-semibold">₹{invoice.total.toLocaleString()}</td>
                  <td>
                    <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                      Completed
                    </span>
                  </td>
                  <td>
                    <div className="flex space-x-2">
                      <button className="text-blue-400 hover:text-blue-300 text-sm">View</button>
                      <button className="text-green-400 hover:text-green-300 text-sm">Edit</button>
                      <button className="text-purple-400 hover:text-purple-300 text-sm">PDF</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {invoices.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm ? `No invoices found matching "${searchTerm}"` : 'No invoices found'}
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            {/* Previous Button */}
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {/* Page Info */}
            <div className="text-sm text-slate-400">
              Page {pagination.page} of {pagination.totalPages}
            </div>

            {/* Next Button */}
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Top Customers and GST Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Customers */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Customers</h3>
          {analytics && analytics.recentCustomers && (
            <div className="space-y-3">
              {analytics.recentCustomers.slice(0, 8).map((customer: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="text-slate-300 text-sm truncate flex-1">
                    {customer.user_name}
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-slate-400 text-xs">{customer.invoice_count} invoices</div>
                    <div className="text-emerald-400 font-medium">
                      ₹{parseInt(customer.total_value).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GST Breakdown */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">GST Breakdown</h3>
          {analytics && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">CGST</span>
                <span className="text-blue-400 font-medium">₹{analytics.gstBreakdown.cgst.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">SGST</span>
                <span className="text-green-400 font-medium">₹{analytics.gstBreakdown.sgst.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">IGST</span>
                <span className="text-purple-400 font-medium">₹{analytics.gstBreakdown.igst.toLocaleString()}</span>
              </div>
              <div className="pt-3 border-t border-slate-600">
                <div className="flex items-center justify-between">
                  <span className="text-white font-semibold">Total GST</span>
                  <span className="text-emerald-400 font-bold text-lg">
                    ₹{(analytics.gstBreakdown.cgst + analytics.gstBreakdown.sgst + analytics.gstBreakdown.igst).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sales Trend Visual Graph */}
      {analytics && analytics.salesTrends && analytics.salesTrends.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">
            Sales Trend Graph ({dateRange === 'month' ? 'This Month' : dateRange === 'year' ? 'This Year' : 'Custom Period'})
          </h3>
          
          {/* Chart Container */}
          <div className="relative">
            <div className="h-64 flex items-end justify-between space-x-1 bg-slate-800/50 p-4 rounded-lg">
              {analytics.salesTrends.slice(0, 15).map((trend: any, index: number) => {
                const maxSales = Math.max(...analytics.salesTrends.map((t: any) => parseFloat(t.total_sales)))
                const height = maxSales > 0 ? (parseFloat(trend.total_sales) / maxSales) * 100 : 0
                
                return (
                  <div key={index} className="flex flex-col items-center group cursor-pointer">
                    {/* Bar */}
                    <div className="relative flex items-end h-48">
                      <div 
                        className="w-6 bg-gradient-to-t from-blue-500 to-emerald-400 rounded-t-sm transition-all duration-500 hover:from-blue-400 hover:to-emerald-300"
                        style={{ height: `${height}%`, minHeight: '4px' }}
                      ></div>
                      
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap border border-slate-600">
                          <div className="font-semibold">₹{parseFloat(trend.total_sales).toLocaleString()}</div>
                          <div className="text-slate-400">{trend.invoice_count} invoices</div>
                          <div className="text-slate-400">{format(new Date(trend.sale_date), 'MMM dd')}</div>
                        </div>
                        {/* Arrow */}
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                          <div className="border-4 border-transparent border-t-slate-900"></div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Date Label */}
                    <div className="text-xs text-slate-400 mt-2 transform -rotate-45 origin-center">
                      {format(new Date(trend.sale_date), 'MM/dd')}
                    </div>
                  </div>
                )
              })}
            </div>
            
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 h-64 flex flex-col justify-between text-xs text-slate-400 -ml-12">
              {analytics.salesTrends.length > 0 && (() => {
                const maxSales = Math.max(...analytics.salesTrends.map((t: any) => parseFloat(t.total_sales)))
                return [
                  <div key="max">₹{Math.round(maxSales).toLocaleString()}</div>,
                  <div key="mid">₹{Math.round(maxSales * 0.5).toLocaleString()}</div>,
                  <div key="min">₹0</div>
                ]
              })()}
            </div>
          </div>
          
          {/* Chart Legend */}
          <div className="mt-4 flex items-center justify-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-emerald-400 rounded"></div>
              <span className="text-slate-300">Daily Sales Amount</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-slate-600 rounded"></div>
              <span className="text-slate-400">Hover for details</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
