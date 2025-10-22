import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { TransactionTable } from '../../components/transactions/TransactionTable'
import { TransactionFilters } from '../../components/transactions/TransactionFilters'
import { FileText, Download, Printer } from 'lucide-react'
import { exportToPDF, exportToExcel, getTableForExport } from '../../lib/export-utils'

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
    limit: 25,
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
          limit: 25,
          total: 0,
          totalPages: 0
        })
      } else {
        console.error('Failed to fetch sales:', data.message)
        setSales([])
        setPagination({
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0
        })
      }
    } catch (error) {
      console.error('Error fetching sales:', error)
      setSales([])
      setPagination({
        page: 1,
        limit: 25,
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
    payment_mode: sale.payment_mode
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
      />


    </div>
  )
}
