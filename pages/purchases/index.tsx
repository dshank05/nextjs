import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { TransactionTable } from '../../components/transactions/TransactionTable'
import { TransactionFilters } from '../../components/transactions/TransactionFilters'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { FileText, Download, Printer, Undo2, FileMinus } from 'lucide-react'
import { exportToPDF, exportToExcel, getTableForExport } from '../../lib/export-utils'
import { useSnackbar } from '../../components/SnackbarProvider'

// Define types for purchase data (matching the Purchase and Purchaseitems tables)
interface PurchaseItem {
  id: number
  invoice_no: number
  name_of_product: string
  category_id?: number
  model_id?: number
  company_id?: number
  hsn?: string
  part?: string
  qty: number
  unit?: number
  rate: number
  subtotal: number
  fy: number
  invoice_date: number | string
}

interface Purchase {
  id: number
  invoice_no: number
  select_vendor?: number
  vendor_name?: string
  vendor_address?: string
  vendor_gstin?: string
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
  payment_status?: number
  payment_mode?: number
  fy: number
  transport?: string
  items?: PurchaseItem[]
  item_count?: number
  formattedDate?: string
  bill_reference?: string
  return_status?: number // 0=none, 1=partial, 2=full
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function PurchasesPage() {
  // Router for navigation
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null)
  const [processingReturn, setProcessingReturn] = useState(false)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [limit, setLimit] = useState(25)

  // Data states
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  })
  const [loading, setLoading] = useState(false)

  // Fetch purchases data from API
  const fetchPurchases = async (page: number = 1) => {
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

      // Add vendor filter (for client-side filtering but send to API anyway)
      if (vendorFilter && vendorFilter !== '') {
        params.append('vendor', vendorFilter)
      }

      const response = await fetch(`/api/purchases?${params}`)
      const data = await response.json()

      if (response.ok) {
        setPurchases(data.purchases || [])
        setPagination(data.pagination || {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        })
      } else {
        console.error('Failed to fetch purchases:', data.message)
        setPurchases([])
        setPagination({
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        })
      }
    } catch (error) {
      console.error('Error fetching purchases:', error)
      setPurchases([])
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
    fetchPurchases(newPage)
  }

  // Handle limit changes
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit)
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }))
  }

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('')
    setVendorFilter('')
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
      default: return ''
    }
  }

  // Handle view details
  const handleViewDetails = (transaction: any) => {
    console.log('View details for purchase:', transaction)
    router.push(`/purchases/view/${transaction.id}`)
  }

  // Initial load and when filters change
  useEffect(() => {
    fetchPurchases(1)
  }, [searchTerm, vendorFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit])

  // Convert purchases data to transaction format for the table component
  const allTransactions = purchases.map(purchase => ({
    ...purchase,
    type: 'purchase' as const,
    customer_vendor_name: purchase.vendor_name,
    customer_vendor_address: purchase.vendor_address,
    customer_vendor_gstin: purchase.vendor_gstin,
    bill_reference: purchase.bill_reference,
    status: purchase.payment_status || 0, // Map payment_status to status for TransactionTable (ensure not undefined)
    payment_status: purchase.payment_status || 0, // Ensure payment_status is provided
    return_status: purchase.return_status || 0, // Add return_status for enable/disable logic
    invoice_date: purchase.formattedDate ||
                  (typeof purchase.invoice_date === 'number' ? purchase.invoice_date :
                   (purchase.invoice_date && purchase.invoice_date.trim() !== '') ? purchase.invoice_date : null)
  }))

  // Vendor filtering: For now, disable filtering since we're properly storing IDs
  // In proper implementation, API would filter by vendor ID or client would have ID mapping
  const purchasesAsTransactions = allTransactions

  // Export functions
  const handleExportPDF = async () => {
    console.log('Exporting purchases to PDF...')
    const tableElement = getTableForExport()
    if (tableElement && purchasesAsTransactions.length > 0) {
      await exportToPDF(tableElement, purchasesAsTransactions, {
        title: 'Purchases Report',
        fileName: 'purchases_report'
      })
    } else {
      alert('No data to export. Please ensure there are records visible.')
    }
  }

  const handleExportExcel = () => {
    console.log('Exporting purchases to Excel...')
    if (purchasesAsTransactions.length > 0) {
      exportToExcel(purchasesAsTransactions, {
        title: 'Purchases Report',
        fileName: 'purchases_report'
      })
    } else {
      alert('No data to export. Please ensure there are records visible.')
    }
  }

  // Print individual purchase
  const handlePrintPurchase = (transaction: any) => {
    console.log('Printing purchase:', transaction.id)
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for purchase ${transaction.invoice_no} will be implemented`)
  }

  // Handle return actions
  const handlePartialReturn = (transaction: any) => {
    const returnStatus = transaction.return_status || 0
    if (returnStatus === 0 || returnStatus === 1) {
      console.log('Starting partial return for purchase:', transaction.id)
      router.push(`/entry/purchasereturn-create?purchase=${transaction.id}&type=partial`)
    } else {
      alert('Full returns cannot be modified with partial returns. Use full return for fully returned purchases.')
    }
  }

  const handleReturnWholeOrder = (transaction: any) => {
    console.log('Return whole order for purchase:', transaction)
    setSelectedTransaction(transaction)
    setShowReturnModal(true)
  }

  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return

    setProcessingReturn(true)
    try {
      // Call the purchase returns API to create a full return
      const response = await fetch('/api/purchase-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          purchase_id: selectedTransaction.id,
          return_type: 'purchase',
          full_return: true, // Flag for full return
          return_date: Math.floor(Date.now() / 1000), // Current timestamp
          notes: 'Full order return processed automatically'
        })
      })

      if (response.ok) {
        const result = await response.json()
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`)
        // Refresh the data to update the table
        fetchPurchases(pagination.page)
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
      alert('Full returns are only available for purchases with no previous returns.')
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
      // Enable for none (0) or partial (1), disable for full (2)
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
      // Enable only for none (0), disable for partial (1) or full (2)
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

        {/* <button className="btn-primary">
          New Purchase Invoice
        </button> */}
      </div>

      {/* Filters */}
      <div>
        <TransactionFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          transactionType="purchase"
          setTransactionType={() => {}} // Not used for purchases page
          customerVendorFilter={vendorFilter}
          setCustomerVendorFilter={setVendorFilter}
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

      {/* Purchases Table */}
      <TransactionTable
        transactions={purchasesAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        onPrintDetails={handlePrintPurchase}
        hideTypeColumn={true}
        customActions={customActions}
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_vendor_name})?

This will return all items in the purchase order and cannot be undone.`}
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
