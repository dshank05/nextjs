import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Eye, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { ExportMenu } from '../../components/common/ExportMenu'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'
import { useCustomers } from '../../hooks/useStaff'
import { useCustomerTransactions, useDeleteCustomerTransaction } from '../../hooks/useCustomers'
import type { CustomerTransaction, TransactionType, TransactionSortField } from '../../types/customer-transactions'

// ✅ Custom sessionStorage hook: Unique per tab, persists on refresh
function useSessionStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // Hydration fix: Read from sessionStorage only after component mounts
  useEffect(() => {
    try {
      const item = window.sessionStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(error);
    }
  }, [key]);

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}

type SortOrder = 'asc' | 'desc'

export default function CustomerTransactionsPage() {
  const { showSnackbar } = useSnackbar()
  const [page, setPage] = useState(1)
  const limit = 50

  // UI state - show transactions only after customer selection
  const [showTransactions, setShowTransactions] = useState(false)

  // Delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteTransaction, setDeleteTransaction] = useState<{ id: number; type: string } | null>(null)

  // Filters
  const [selectedCustomer, setSelectedCustomer] = useSessionStorage<string>('customer-transactions-customer', '')
  const [dateFrom, setDateFrom] = useSessionStorage<string>('customer-transactions-dateFrom', '')
  const [dateTo, setDateTo] = useSessionStorage<string>('customer-transactions-dateTo', '')
  const [paymentMode, setPaymentMode] = useState<string>('')
  const [paymentType, setPaymentType] = useState<string>('')
  const [transactionType, setTransactionType] = useState<TransactionType>('all')

  // Sorting - ✅ FIX: Changed to ascending order to show oldest transactions first
  const [sortBy, setSortBy] = useState<TransactionSortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // React Query hooks
  const { data: customers = [] } = useCustomers()

  const { data: transactionsData, isLoading: loading } = useCustomerTransactions({
    customer_id: selectedCustomer,
    page,
    limit,
    sortBy,
    sortOrder,
    type: transactionType,
    dateFrom,
    dateTo,
    payment_mode: paymentMode,
    payment_type: paymentType
  })

  const transactions = transactionsData?.data || []
  const totalPages = transactionsData?.pagination?.totalPages || 1
  const total = transactionsData?.pagination?.total || 0

  const deleteMutation = useDeleteCustomerTransaction()

  // Initialize with current month date range (only if no stored dates)
  useEffect(() => {
    // ✅ Check sessionStorage directly to avoid overwriting saved values
    const storedDateFrom = sessionStorage.getItem('customer-transactions-dateFrom');
    const storedDateTo = sessionStorage.getItem('customer-transactions-dateTo');
    
    // ✅ Only set defaults if no values exist in sessionStorage
    if (!storedDateFrom && !storedDateTo && !dateFrom && !dateTo) {
      const now = new Date()
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      setDateFrom(formatStartDateForAPI(firstDay))
      setDateTo(formatEndDateForAPI(lastDay))
    }
  }, []);
  
  // ✅ Cleanup sessionStorage on component unmount
  useEffect(() => {
    return () => {
      // Clear all customer-transactions sessionStorage keys when leaving page
      sessionStorage.removeItem('customer-transactions-customer');
      sessionStorage.removeItem('customer-transactions-dateFrom');
      sessionStorage.removeItem('customer-transactions-dateTo');
    };
  }, []);

  // Show transactions when customer is selected
  useEffect(() => {
    if (selectedCustomer) {
      setShowTransactions(true)
    }
  }, [selectedCustomer])

  const handleClearFilters = () => {
    // Clear customer selection and hide transactions
    setSelectedCustomer('')
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
  }

  const handleSort = (field: TransactionSortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const getSortIcon = (field: TransactionSortField) => {
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

  const getTransactionTypeBadge = (type: 'INCOME' | 'EXPENSE') => {
    if (type === 'INCOME') {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full font-medium">INCOME</span>
    }
    return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full font-medium">EXPENSE</span>
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

  const handleDeleteClick = (id: number, type: 'INCOME' | 'EXPENSE') => {
    setDeleteTransaction({ id, type: type === 'INCOME' ? 'income' : 'expense' })
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTransaction) return

    deleteMutation.mutate(
      {
        id: deleteTransaction.id,
        type: deleteTransaction.type as 'income' | 'expense'
      },
      {
        onSuccess: () => {
          showSnackbar('success', 'Transaction deleted successfully', 3000)
          setShowDeleteModal(false)
          setDeleteTransaction(null)
        },
        onError: (error: any) => {
          showSnackbar('error', error.message || 'Failed to delete transaction', 5000)
        }
      }
    )
  }

  // Prepare export data
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'invoice_numbers', label: 'Invoice No.', enabled: true },
    { key: 'date', label: 'Date', enabled: true },
    { key: 'customer_name', label: 'Customer', enabled: true },
    { key: 'amount', label: 'Amount', enabled: true },
    { key: 'transaction_type', label: 'Type', enabled: true },
    { key: 'payment_mode', label: 'Payment Mode', enabled: true },
    { key: 'payment_type', label: 'Payment Type', enabled: true }
  ]

  const exportData = transactions.map(t => ({
    id: t.id,
    invoice_numbers: t.invoice_numbers.length > 0 ? t.invoice_numbers.join(', ') : 'Direct',
    date: new Date(t.date * 1000).toLocaleDateString('en-IN'),
    customer_name: t.customer_name,
    amount: t.amount,
    transaction_type: t.transaction_type,
    payment_mode: t.payment_mode === 0 ? 'Cash' : 'Bank',
    payment_type: formatType(t.payment_type)
  }))

  const exportConfig = {
    title: 'Customer Transactions',
    fileName: `customer-transactions-${getLocalDateString()}`
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          {/* Header Section */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-slate-200">Customer Transactions</h1>

            <div className="flex items-center gap-2">
              {showTransactions && (
                <ExportMenu
                  data={exportData}
                  columns={exportColumns}
                  config={exportConfig}
                />
              )}
              <Link
                href="/customer-transactions/create"
                className="btn-primary"
              >
                Create Transaction
              </Link>
            </div>

          </div>

          {/* Filters Section - All in same row, customer always visible, others conditional */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
            {/* Customer Filter - Always Visible */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Customer <span className="text-red-400">*</span>
              </label>
              <SearchableSelect
                options={[
                  { id: '', name: 'Select customer...' },
                  ...customers.map(c => ({
                    id: c.id.toString(),
                    name: c.billing_name || c.name
                  }))
                ]}
                selectedValue={selectedCustomer}
                onSelectionChange={(value) => {
                  setSelectedCustomer(value || '')
                  setPage(1)
                }}
                placeholder="Select customer..."
              />
            </div>

            {/* Date Range Filter - Show only after customer selected */}
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

            {/* Payment Mode Filter - Show only after customer selected */}
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

            {/* Payment Type Filter - Show only after customer selected */}
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

            {/* Transaction Type Filter - Show only after customer selected */}
            {showTransactions && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
                <SearchableSelect
                  options={[
                    { id: 'all', name: 'All Transactions' },
                    { id: 'income', name: 'Income Only' },
                    { id: 'expense', name: 'Expense Only' }
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

            {/* Clear Filters Button - Show only after customer selected */}
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
            /* Initial State - No Customer Selected */
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-600/20 mb-4">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-300 mb-2">
                Select a Customer to View Transactions
              </h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Choose a customer from the dropdown above to view their payment and refund transactions for the current month.
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
                        onClick={() => handleSort('customer_name')}
                      >
                        Customer {getSortIcon('customer_name')}
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
                          <div className="font-medium">{transaction.customer_name}</div>
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
                              href={`/customer-transactions/view/${transaction.id}?type=${transaction.transaction_type === 'INCOME' ? 'income' : 'expense'}`}
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
        message={`This action is irreversible. The transaction will be permanently deleted and all allocations will be removed. Payment/refund statuses for affected invoices/returns will be recalculated.`}
        confirmText="Delete Transaction"
        cancelText="Cancel"
        showLoading={deleteMutation.isPending}
        loadingText="Deleting..."
      />
    </div>
  )
}
