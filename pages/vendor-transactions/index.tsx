import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Eye, ArrowUp, ArrowDown } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'

interface Transaction {
  id: number
  vendor_id: number
  vendor_name: string
  payment_date?: number
  refund_date?: number
  payment_amount?: number
  refund_amount?: number
  payment_mode?: number
  refund_mode?: number
  payment_type?: string
  refund_type?: string
  notes: string | null
  fy: number
  allocations: any[]
}

type TabType = 'EXPENSE' | 'INCOME'
type SortField = 'id' | 'vendor_name' | 'payment_amount' | 'refund_amount' | 'payment_date' | 'refund_date'
type SortOrder = 'asc' | 'desc'

export default function VendorTransactionsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('EXPENSE')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 50

  // Filters
  const [vendors, setVendors] = useState<any[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [paymentMode, setPaymentMode] = useState<string>('')

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>('id')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  useEffect(() => {
    fetchVendors()
  }, [])

  useEffect(() => {
    fetchTransactions()
  }, [activeTab, page, selectedVendor, dateFrom, dateTo, paymentMode, sortBy, sortOrder])

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      setVendors(data.vendors || [])
    } catch (error) {
      console.error('Error fetching vendors:', error)
    }
  }

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const endpoint = activeTab === 'EXPENSE' 
        ? '/api/vendor-payments' 
        : '/api/vendor-refunds'
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sortBy: activeTab === 'EXPENSE' ? sortBy : (sortBy === 'payment_amount' ? 'refund_amount' : sortBy === 'payment_date' ? 'refund_date' : sortBy),
        sortOrder
      })
      
      if (selectedVendor) params.append('vendor_id', selectedVendor)
      if (dateFrom) {
        const timestamp = Math.floor(new Date(dateFrom).getTime() / 1000)
        params.append('dateFrom', timestamp.toString())
      }
      if (dateTo) {
        const timestamp = Math.floor(new Date(dateTo).getTime() / 1000)
        params.append('dateTo', timestamp.toString())
      }
      if (paymentMode) params.append(activeTab === 'EXPENSE' ? 'payment_mode' : 'refund_mode', paymentMode)

      const response = await fetch(`${endpoint}?${params}`)
      const data = await response.json()

      if (data.success) {
        setTransactions(data.data || [])
        setTotalPages(data.pagination?.totalPages || 1)
        setTotal(data.pagination?.total || 0)
      }
    } catch (error) {
      console.error('Error fetching transactions:', error)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setPage(1)
    // Reset sort when changing tabs
    setSortBy('id')
    setSortOrder('asc')
  }

  const handleClearFilters = () => {
    setSelectedVendor('')
    setDateFrom('')
    setDateTo('')
    setPaymentMode('')
    setPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) return null
    return sortOrder === 'asc' ? <ArrowUp className="inline w-4 h-4 ml-1" /> : <ArrowDown className="inline w-4 h-4 ml-1" />
  }

  const getAmount = (transaction: Transaction) => {
    return activeTab === 'EXPENSE' 
      ? transaction.payment_amount 
      : transaction.refund_amount
  }

  const getDate = (transaction: Transaction) => {
    return activeTab === 'EXPENSE' 
      ? transaction.payment_date 
      : transaction.refund_date
  }

  const getMode = (transaction: Transaction) => {
    const mode = activeTab === 'EXPENSE' 
      ? transaction.payment_mode 
      : transaction.refund_mode
    return mode === 0 ? 'Cash' : 'Bank'
  }

  const getType = (transaction: Transaction) => {
    const type = activeTab === 'EXPENSE' 
      ? transaction.payment_type 
      : transaction.refund_type
    return formatType(type || '')
  }

  const formatType = (type: string): string => {
    switch (type) {
      case 'BILL_SPECIFIC': return 'Bill Specific'
      case 'RETURN_SPECIFIC': return 'Return Specific'
      case 'MIXED': return 'Mixed'
      case 'DIRECT': return 'Direct'
      default: return type
    }
  }

  const getTypeBadgeColor = (type: string): string => {
    switch (type) {
      case 'BILL_SPECIFIC':
      case 'RETURN_SPECIFIC':
        return 'bg-blue-600'
      case 'MIXED':
        return 'bg-purple-600'
      case 'DIRECT':
        return 'bg-green-600'
      default:
        return 'bg-slate-600'
    }
  }

  const getPageNumbers = () => {
    const pages = []
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, page + 2)
    for (let i = start; i <= end; i++) pages.push(i)
    return pages
  }

  return (
    <div className="space-y-6">
      <div className="card">
        {/* Tab Switcher */}
        <div className="flex gap-4 mb-4 border-b border-slate-700">
          <button
            onClick={() => handleTabChange('EXPENSE')}
            className={`px-6 py-3 font-medium transition-colors relative ${
              activeTab === 'EXPENSE'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            EXPENSE (Payments)
          </button>
          <button
            onClick={() => handleTabChange('INCOME')}
            className={`px-6 py-3 font-medium transition-colors relative ${
              activeTab === 'INCOME'
                ? 'text-green-400 border-b-2 border-green-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            INCOME (Refunds)
          </button>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-2 mb-4">
          <Link
            href="/entry/vendor-transaction"
            className="btn-primary"
          >
            Add Transaction
          </Link>
        </div>

        {/* Filters Section */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          {/* Vendor Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
            <SearchableSelect
              options={[
                { id: '', name: 'All Vendors' },
                ...vendors.map(v => ({
                  id: v.id.toString(),
                  name: v.vendor_name
                }))
              ]}
              selectedValue={selectedVendor}
              onSelectionChange={(value) => {
                setSelectedVendor(value || '')
                setPage(1)
              }}
              placeholder="Select vendor..."
            />
          </div>

          {/* Date Range Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={dateFrom}
              endDate={dateTo}
              onDateChange={(start, end) => {
                setDateFrom(start)
                setDateTo(end)
                setPage(1)
              }}
              placeholder="Select date range..."
            />
          </div>

          {/* Payment Mode Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
            <SearchableSelect
              options={[
                { id: '', name: 'All Modes' },
                { id: '0', name: 'Cash' },
                { id: '1', name: 'Bank' }
              ]}
              selectedValue={paymentMode}
              onSelectionChange={(value) => {
                setPaymentMode(value || '')
                setPage(1)
              }}
              placeholder="Select mode..."
            />
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            <button
              onClick={handleClearFilters}
              className="btn-secondary px-4 py-2 w-full"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {transactions.length > 0 ? ((page - 1) * limit) + 1 : 0} to {Math.min(page * limit, total)} of {total} transactions</div>
          <div>Page {page} of {totalPages}</div>
        </div>

        {/* Table Section */}
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                <th 
                  className="cursor-pointer hover:bg-slate-700/50" 
                  onClick={() => handleSort('id')}
                >
                  ID {getSortIcon('id')}
                </th>
                <th 
                  className="cursor-pointer hover:bg-slate-700/50"
                  onClick={() => handleSort(activeTab === 'EXPENSE' ? 'payment_date' : 'refund_date')}
                >
                  Date {getSortIcon(activeTab === 'EXPENSE' ? 'payment_date' : 'refund_date')}
                </th>
                <th 
                  className="cursor-pointer hover:bg-slate-700/50"
                  onClick={() => handleSort('vendor_name')}
                >
                  Vendor {getSortIcon('vendor_name')}
                </th>
                <th 
                  className="text-right cursor-pointer hover:bg-slate-700/50"
                  onClick={() => handleSort(activeTab === 'EXPENSE' ? 'payment_amount' : 'refund_amount')}
                >
                  Amount {getSortIcon(activeTab === 'EXPENSE' ? 'payment_amount' : 'refund_amount')}
                </th>
                <th>Type</th>
                <th>Mode</th>
                <th>Allocations</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction, idx) => {
                const type = activeTab === 'EXPENSE' ? transaction.payment_type : transaction.refund_type
                return (
                  <tr key={transaction.id}>
                    <td>{(page - 1) * limit + idx + 1}</td>
                    <td className="font-mono text-slate-300">{transaction.id}</td>
                    <td className="text-slate-300">
                      {new Date((getDate(transaction) || 0) * 1000).toLocaleDateString('en-IN')}
                    </td>
                    <td className="text-slate-300">
                      <div className="font-medium">{transaction.vendor_name}</div>
                    </td>
                    <td className="text-right text-slate-300 font-semibold">
                      ₹{(getAmount(transaction) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td>
                      <span className={`px-2 py-1 ${getTypeBadgeColor(type || '')} text-white text-xs rounded-full`}>
                        {formatType(type || '')}
                      </span>
                    </td>
                    <td className="text-slate-300">{getMode(transaction)}</td>
                    <td className="text-slate-300">
                      {transaction.allocations?.length || 0} {activeTab === 'EXPENSE' ? 'bill(s)' : 'return(s)'}
                    </td>
                    <td>
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/vendor-transactions/view/${transaction.id}?type=${activeTab === 'EXPENSE' ? 'expense' : 'income'}`}
                          title="View Transaction Details"
                          className="btn-icon text-slate-300"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {transactions.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              No {activeTab === 'EXPENSE' ? 'payments' : 'refunds'} found with the current filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button 
              onClick={() => setPage(page - 1)} 
              disabled={page === 1} 
              className="btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <div className="flex space-x-2">
              {page > 3 && (
                <>
                  <button onClick={() => setPage(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button>
                  <span>...</span>
                </>
              )}
              {getPageNumbers().map(p => (
                <button 
                  key={p} 
                  onClick={() => setPage(p)} 
                  className={`px-3 py-1 rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}
                >
                  {p}
                </button>
              ))}
              {page < totalPages - 2 && (
                <>
                  <span>...</span>
                  <button onClick={() => setPage(totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">
                    {totalPages}
                  </button>
                </>
              )}
            </div>
            <button 
              onClick={() => setPage(page + 1)} 
              disabled={page === totalPages} 
              className="btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
