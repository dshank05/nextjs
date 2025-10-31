import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { TransactionTable } from '../../components/transactions/TransactionTable'
import { TransactionFilters } from '../../components/transactions/TransactionFilters'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { FileText, Download, Printer, Undo2, FileMinus } from 'lucide-react'
import { exportToPDF, exportToExcel, getTableForExport } from '../../lib/export-utils'
import { useSnackbar } from '../../components/SnackbarProvider'

// Define types for sales data (matching the Invoice and Invoiceitems tables)
interface SaleItem {
  id: number
  invoice_no: number
  name_of_product: string
  category_id?: number
  model_id?: number
  company_id?: number
  hsn?: string
  part?: string
  qty: number
  rate: number
  subtotal: number
  fy: number
  invoice_date: number | string
}

interface Sale {
  id: number
  invoice_no: number
  select_customer?: number
  customer_name?: string
  customer_address?: string
  customer_gstin?: string
  items_total: number
  freight?: number
  total_taxable_value: number
  taxrate?: number
  total_cgst?: number
  total_sgst?: number
  total_igst?: number
  total_tax?: number
  total: number
  notes?: string
  invoice_date: number | string
  status?: number
  payment_status?: number  // Payment status from API (0=Unpaid, 1=Paid)
  payment_mode?: number    // Payment mode from API (0=Cash, 1=Bank)
  fy: number
  mode?: number
  type?: number
  items?: SaleItem[]
  item_count?: number
  return_status?: number // 0=none, 1=partial, 2=full
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function SalePage() {
  // Router for navigation
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null)
  const [processingReturn, setProcessingReturn] = useState(false)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [customerVendorFilter, setCustomerVendorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [limit, setLimit] = useState(25)

  // Data states
  const [sales, setSales] = useState<Sale[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  })
  const [loading, setLoading] = useState(false)

  // Fetch sales data from API
  const fetchSales = async (page: number = 1) => {
    setLoading(true)

    try {
      // Build query parameters
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        search: searchTerm,
        startDate: dateFrom,
        endDate: dateTo,
        fy: '' // Add financial year if needed
      })

      // Add status filter if provided
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', getApiStatusFilter())
      }

      // Add amount filters if provided (send even if empty for consistency)
      if (amountMin !== undefined && amountMin !== null && amountMin !== '') {
        params.append('amountMin', amountMin)
      }
      if (amountMax !== undefined && amountMax !== null && amountMax !== '') {
        params.append('amountMax', amountMax)
      }

      // Add customer/vendor filter (for client-side filtering but send to API anyway)
      if (customerVendorFilter && customerVendorFilter !== '') {
        params.append('vendor', customerVendorFilter)
      }

      const response = await fetch(`/api/sales?${params}`)
      const data = await response.json()

      if (response.ok) {
        setSales(data.sales || [])
        setPagination(data.pagination || {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        })
      } else {
        console.error('Failed to fetch sales:', data.message)
        setSales([])
        setPagination({
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        })
      }
    } catch (error) {
      console.error('Error fetching sales:', error)
      setSales([])
      setPagination({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      })
    } finally {
      setLoading(false)
    }
  }

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
    fetchSales(newPage)
  }

  // Handle limit changes
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit)
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }))
  }

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('')
    setCustomerVendorFilter('')
    setStatusFilter('all')
    setDateFrom('')
    setDateTo('')
    setAmountMin('')
    setAmountMax('')
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  // Get API status values based on UI filter values
  const getApiStatusFilter = () => {
    switch (statusFilter) {
      case 'paid': return '1'
      case 'unpaid': return '0'
      case 'unknown': return 'unknown'
      default: return ''
    }
  }

  // Handle view details
  const handleViewDetails = (transaction: any) => {
    console.log('View details for sale:', transaction)
    router.push(`/sale/view/${transaction.id}`)
  }

  // Initial load and when filters change
  useEffect(() => {
    fetchSales(1)
  }, [searchTerm, customerVendorFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit])

  // Convert sales data to transaction format for the table component
  const allTransactions = sales.map(sale => ({
    ...sale,
    type: 'sale' as const,
    customer_vendor_name: sale.customer_name,
    customer_vendor_address: sale.customer_address,
    customer_vendor_gstin: sale.customer_gstin,
    invoice_date: sale.invoice_date,
    status: sale.payment_status,  // Map payment_status to status for TransactionTable compatibility
    payment_status: sale.payment_status,
    payment_mode: sale.payment_mode,
    return_status: sale.return_status || 0 // Add return_status for enable/disable logic
  }))

  // Customer filtering: For now, disable filtering since we're properly storing IDs
  // In proper implementation, API would filter by customer ID or client would have ID mapping
  const salesAsTransactions = allTransactions

  // Export functions
  const handleExportPDF = async () => {
    console.log('Exporting sales to PDF...')
    const tableElement = getTableForExport()
    if (tableElement && salesAsTransactions.length > 0) {
      await exportToPDF(tableElement, salesAsTransactions, {
        title: 'Invoice Report',
        fileName: 'invoice_report'
      })
    } else {
      alert('No data to export. Please ensure there are records visible.')
    }
  }

  const handleExportExcel = () => {
    console.log('Exporting sales to Excel...')
    if (salesAsTransactions.length > 0) {
      exportToExcel(salesAsTransactions, {
        title: 'Invoice Report',
        fileName: 'invoice_report'
      })
    } else {
      alert('No data to export. Please ensure there are records visible.')
    }
  }

  // Print individual sale
  const handlePrintSale = (transaction: any) => {
    console.log('Printing sale:', transaction.id)
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for sale ${transaction.invoice_no} will be implemented`)
  }

  // Handle return actions
  const handlePartialReturn = (transaction: any) => {
    const returnStatus = transaction.return_status || 0
    if (returnStatus === 0 || returnStatus === 1) {
      console.log('Starting partial return for sale:', transaction.id)
      router.push(`/entry/salereturn-create?invoice=${transaction.id}&type=partial`)
    } else {
      alert('Full returns cannot be modified with partial returns.')
    }
  }

  const handleReturnWholeOrder = (transaction: any) => {
    console.log('Return whole order for sale:', transaction)
    setSelectedTransaction(transaction)
    setShowReturnModal(true)
  }

  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return

    setProcessingReturn(true)
    try {
      const response = await fetch('/api/sale-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_id: selectedTransaction.id,
          return_type: 'sale',
          full_return: true,
          return_date: Math.floor(Date.now() / 1000),
          notes: 'Full order return processed automatically'
        })
      })

      if (response.ok) {
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`)
        fetchSales(pagination.page)
      } else {
        const error = await response.json()
        showSnackbar('error', `Failed to process return: ${error.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error processing return:', error)
      showSnackbar('error', 'Network error occurred while processing return')
    } finally {
      setProcessingReturn(false)
      setShowReturnModal(false)
      setSelectedTransaction(null)
    }
  }

  const cancelReturnWholeOrder = () => {
    setShowReturnModal(false)
    setSelectedTransaction(null)
  }

  const handleFullReturn = (transaction: any) => {
    const returnStatus = transaction.return_status || 0
    if (returnStatus === 0) {
      handleReturnWholeOrder(transaction)
    } else {
      alert('Full returns are only available for sales with no previous returns.')
    }
  }

  // Define custom actions for returns with enable/disable logic
  const customActions = [
    {
      label: 'Partial Return',
      icon: <FileMinus className="w-4 h-4" />,
      onClick: handlePartialReturn,
      className: 'text-blue-400 hover:text-blue-300',
      title: 'Create Partial Return',
      enabled: (transaction: any) => {
        const returnStatus = transaction.return_status || 0
        return returnStatus === 0 || returnStatus === 1
      }
    },
    {
      label: 'Full Return',
      icon: <Undo2 className="w-4 h-4" />,
      onClick: handleFullReturn,
      className: 'text-green-400 hover:text-green-300',
      title: 'Create Full Return',
      enabled: (transaction: any) => {
        const returnStatus = transaction.return_status || 0
        return returnStatus === 0
      }
    }
  ]

  return (
    <div className="space-y-2">
      {/* Header with Export Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={handleExportPDF}
            className="btn-secondary flex items-center space-x-2"
          >
            <FileText className="w-4 h-4" />
            <span>Export as PDF</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="btn-secondary flex items-center space-x-2"
          >
            <Download className="w-4 h-4" />
            <span>Export as Excel</span>
          </button>
        </div>

        {/* <button
          onClick={() => router.push('/sale/create')}
          className="btn-primary"
        >
          New Sales Invoice
        </button> */}
      </div>

      {/* Filters */}
      <div>
        <TransactionFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          transactionType="sale"
          setTransactionType={() => {}} // Not used for sales page
          customerVendorFilter={customerVendorFilter}
          setCustomerVendorFilter={setCustomerVendorFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          amountMin={amountMin}
          setAmountMin={setAmountMin}
          amountMax={amountMax}
          setAmountMax={setAmountMax}
          limit={limit}
          handleLimitChange={handleLimitChange}
          clearFilters={clearFilters}
          hideTransactionType={true}
        />
      </div>

      {/* Sales Table */}
      <TransactionTable
        transactions={salesAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        onPrintDetails={handlePrintSale}
        hideTypeColumn={true}
        customActions={customActions}
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_vendor_name})?

This will return all items in the sale order and cannot be undone.`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmReturnWholeOrder}
        onCancel={cancelReturnWholeOrder}
      />

    </div>
  )
}
