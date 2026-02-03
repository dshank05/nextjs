import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Eye, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { ExportMenu } from '../../components/common/ExportMenu'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'

interface Transaction {
  id: number
  transaction_type: 'EXPENSE' | 'INCOME'
  vendor_id: number
  vendor_name: string
  date: number
  amount: number
  payment_mode: number
  payment_type: string
  notes: string | null
  invoice_numbers: string[]
  allocations_count: number
  fy: number
}

type TransactionType = 'all' | 'expense' | 'income'
type SortField = 'id' | 'vendor_name' | 'amount' | 'date' | 'type'
type SortOrder = 'asc' | 'desc'

export default function VendorTransactionsPage() {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 50

  // UI state - show transactions only after vendor selection
  const [showTransactions, setShowTransactions] = useState(false)

  // Delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteTransaction, setDeleteTransaction] = useState<{ id: number; type: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filters
  const [vendors, setVendors] = useState<any[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [paymentMode, setPaymentMode] = useState<string>('')
  const [paymentType, setPaymentType] = useState<string>('')
  const [transactionType, setTransactionType] = useState<TransactionType>('all')

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // Initialize with current month date range
  useEffect(() => {
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setDateFrom(formatStartDateForAPI(firstDay))
    setDateTo(formatEndDateForAPI(lastDay))

    fetchVendors()
  }, [])

  // Only fetch transactions when vendor is selected
  useEffect(() => {
    if (selectedVendor) {
      setShowTransactions(true)
      fetchTransactions()
    }
  }, [page, selectedVendor, dateFrom, dateTo, paymentMode, paymentType, transactionType, sortBy, sortOrder])

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
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sortBy,
        sortOrder,
        type: transactionType
      })

      if (selectedVendor) params.append('vendor_id', selectedVendor)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (paymentMode) params.append('payment_mode', paymentMode)
      if (paymentType) params.append('payment_type', paymentType)

      const response = await fetch(`/api/vendor-transactions?${params}`)
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

  const handleClearFilters = () => {
    // Clear vendor selection and hide transactions
    setSelectedVendor('')
    setShowTransactions(false)

    // Reset to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setDateFrom(formatStartDateForAPI(firstDay))
    setDateTo(formatEndDateForAPI(lastDay))
    setPaymentMode('')
    setPaymentType('')
    setTransactionType('all')
    setPage(1)
    setTransactions([])
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

  const getTransactionTypeBadge = (type: 'EXPENSE' | 'INCOME') => {
    if (type === 'EXPENSE') {
      return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full font-medium">EXPENSE</span>
    }
    return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full font-medium">INCOME</span>
  }

  const formatInvoiceNumbers = (invoiceNumbers: string[]) => {
    if (!invoiceNumbers || invoiceNumbers.length === 0) {
      return <span className="text-slate-500">Direct</span>
    }

    if (invoiceNumbers.length <= 3) {
      return <span className="text-slate-300">{invoiceNumbers.join(', ')}</span>
    }

    const displayed = invoiceNumbers.slice(0, 3).join(', ')
    const remaining = invoiceNumbers.length - 3
    return (
      <span className="text-slate-300">
        {displayed}
        <span className="text-blue-400 ml-1">+{remaining} more</span>
      </span>
    )
  }

  const getPageNumbers = () => {
    const pages = []
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, page + 2)
    for (let i = start; i <= end; i++) pages.push(i)
    return pages
  }

  const handleDeleteClick = (id: number, type: 'EXPENSE' | 'INCOME') => {
    setDeleteTransaction({ id, type: type === 'EXPENSE' ? 'expense' : 'income' })
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTransaction) return

    setDeleting(true)
    try {
      const endpoint = deleteTransaction.type === 'expense'
        ? `/api/vendor-payments/${deleteTransaction.id}`
        : `/api/vendor-refunds/${deleteTransaction.id}`

      const response = await fetch(endpoint, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        showSnackbar('success', 'Transaction deleted successfully', 3000)
        fetchTransactions() // Refresh list
        setShowDeleteModal(false)
        setDeleteTransaction(null)
      } else {
        showSnackbar('error', data.error || 'Failed to delete transaction', 5000)
      }
    } catch (error) {
      console.error('Error deleting transaction:', error)
      showSnackbar('error', 'Failed to delete transaction', 5000)
    } finally {
      setDeleting(false)
    }
  }

  // Prepare export data
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'invoice_numbers', label: 'Invoice No.', enabled: true },
    { key: 'date', label: 'Date', enabled: true },
    { key: 'vendor_name', label: 'Vendor', enabled: true },
    { key: 'amount', label: 'Amount', enabled: true },
    { key: 'transaction_type', label: 'Type', enabled: true },
    { key: 'payment_mode', label: 'Payment Mode', enabled: true },
    { key: 'payment_type', label: 'Payment Type', enabled: true }
  ]

  const exportData = transactions.map(t => ({
    id: t.id,
    invoice_numbers: t.invoice_numbers.length > 0 ? t.invoice_numbers.join(', ') : 'Direct',
    date: new Date(t.date * 1000).toLocaleDateString('en-IN'),
    vendor_name: t.vendor_name,
    amount: t.amount,
    transaction_type: t.transaction_type,
    payment_mode: t.payment_mode === 0 ? 'Cash' : 'Bank',
    payment_type: formatType(t.payment_type)
  }))

  const exportConfig = {
    title: 'Vendor Transactions',
    fileName: `vendor-transactions-${getLocalDateString()}`
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          {/* Header Section */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-slate-200">Vendor Transactions</h1>

            <div className="flex items-center gap-2">
              {showTransactions && (
                <ExportMenu
                  data={exportData}
                  columns={exportColumns}
                  config={exportConfig}
                />
              )}
              <Link
                href="/entry/vendor-transaction"
                className="btn-primary"
              >
                Create Transaction
              </Link>
            </div>

          </div>

          {/* Filters Section - All in same row, vendor always visible, others conditional */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
            {/* Vendor Filter - Always Visible */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Vendor <span className="text-red-400">*</span>
              </label>
              <SearchableSelect
                options={[
                  { id: '', name: 'Select vendor...' },
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

            {/* Date Range Filter - Show only after vendor selected */}
            {showTransactions && (
              <div>
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
            )}

            {/* Payment Mode Filter - Show only after vendor selected */}
            {showTransactions && (
              <div>
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
            )}

            {/* Payment Type Filter - Show only after vendor selected */}
            {showTransactions && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Type</label>
                <SearchableSelect
                  options={[
                    { id: '', name: 'All Types' },
                    { id: 'BILL_SPECIFIC', name: 'Bill Specific' },
                    { id: 'RETURN_SPECIFIC', name: 'Return Specific' },
                    { id: 'MIXED', name: 'Mixed' },
                    { id: 'DIRECT', name: 'Direct' }
                  ]}
                  selectedValue={paymentType}
                  onSelectionChange={(value) => {
                    setPaymentType(value || '')
                    setPage(1)
                  }}
                  placeholder="Select type..."
                />
              </div>
            )}

            {/* Transaction Type Filter - Show only after vendor selected */}
            {showTransactions && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
                <SearchableSelect
                  options={[
                    { id: 'all', name: 'All Transactions' },
                    { id: 'expense', name: 'Expense Only' },
                    { id: 'income', name: 'Income Only' }
                  ]}
                  selectedValue={transactionType}
                  onSelectionChange={(value) => {
                    setTransactionType((value || 'all') as TransactionType)
                    setPage(1)
                  }}
                  placeholder="Select type..."
                />
              </div>
            )}

            {/* Clear Filters Button - Show only after vendor selected */}
            {showTransactions && (
              <div className="flex items-end">
                <button
                  onClick={handleClearFilters}
                  className="btn-secondary w-full"
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>

          {!showTransactions ? (
            /* Initial State - No Vendor Selected */
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-600/20 mb-4">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                Select a Vendor to View Transactions
              </h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Choose a vendor from the dropdown above to view their payment and refund transactions for the current month.
              </p>
            </div>
          ) : (
            <>
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
                      <th>Invoice No.</th>
                      <th
                        className="cursor-pointer hover:bg-slate-700/50"
                        onClick={() => handleSort('date')}
                      >
                        Date {getSortIcon('date')}
                      </th>
                      <th
                        className="cursor-pointer hover:bg-slate-700/50"
                        onClick={() => handleSort('vendor_name')}
                      >
                        Vendor {getSortIcon('vendor_name')}
                      </th>
                      <th
                        className="text-right cursor-pointer hover:bg-slate-700/50"
                        onClick={() => handleSort('amount')}
                      >
                        Amount {getSortIcon('amount')}
                      </th>
                      <th
                        className="cursor-pointer hover:bg-slate-700/50"
                        onClick={() => handleSort('type')}
                      >
                        Type {getSortIcon('type')}
                      </th>
                      <th>Payment Mode</th>
                      <th>Payment Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction, idx) => (
                      <tr key={`${transaction.transaction_type}-${transaction.id}`}>
                        <td>{(page - 1) * limit + idx + 1}</td>
                        <td className="font-mono text-slate-300">{transaction.id}</td>
                        <td className="text-slate-300 text-sm">
                          {formatInvoiceNumbers(transaction.invoice_numbers)}
                        </td>
                        <td className="text-slate-300">
                          {new Date(transaction.date * 1000).toLocaleDateString('en-IN')}
                        </td>
                        <td className="text-slate-300">
                          <div className="font-medium">{transaction.vendor_name}</div>
                        </td>
                        <td className="text-right text-slate-300 font-semibold">
                          ₹{transaction.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td>
                          {getTransactionTypeBadge(transaction.transaction_type)}
                        </td>
                        <td className="text-slate-300">
                          {transaction.payment_mode === 0 ? 'Cash' : 'Bank'}
                        </td>
                        <td>
                          <span className={`px-2 py-1 ${getTypeBadgeColor(transaction.payment_type)} text-white text-xs rounded-full`}>
                            {formatType(transaction.payment_type)}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center space-x-2">
                            <Link
                              href={`/vendor-transactions/view/${transaction.id}?type=${transaction.transaction_type === 'EXPENSE' ? 'expense' : 'income'}`}
                              title="View Transaction Details"
                              className="btn-icon text-slate-300 hover:text-blue-400"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                            <button
                              onClick={() => handleDeleteClick(transaction.id, transaction.transaction_type)}
                              title="Delete Transaction"
                              className="btn-icon text-red-400 hover:text-red-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {transactions.length === 0 && !loading && (
                  <div className="text-center py-8 text-slate-400">
                    No transactions found with the current filters.
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
                        <span className="text-slate-400">...</span>
                      </>
                    )}
                    {getPageNumbers().map(p => (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`px-3 py-1 rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
                      >
                        {p}
                      </button>
                    ))}
                    {page < totalPages - 2 && (
                      <>
                        <span className="text-slate-400">...</span>
                        <button onClick={() => setPage(totalPages)} className="px-3 py-1 rounded hover:bg-slate-700 text-slate-300">
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
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onCancel={() => {
          setShowDeleteModal(false)
          setDeleteTransaction(null)
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Transaction?"
        message={`This action is irreversible. The transaction will be permanently deleted and all allocations will be removed. Payment/refund statuses for affected bills/returns will be recalculated.`}
        confirmText="Delete Transaction"
        cancelText="Cancel"
        showLoading={deleting}
        loadingText="Deleting..."
      />
    </div>
  )
}
