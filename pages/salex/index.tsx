import { useState, useEffect } from 'react'
import { TransactionTable } from '../../components/transactions/TransactionTable'
import { TransactionFilters } from '../../components/transactions/TransactionFilters'

// Define types for salex data (matching the invoicex and invoice_itemsx tables)
interface SalexItem {
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

interface Salex {
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
  payment_mode?: number
  fy: number
  mode?: number
  type?: 'sale' | 'salex' | 'purchase'
  items?: SalexItem[]
  item_count?: number
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function SalexPage() {
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
  const [salex, setSalex] = useState<Salex[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0
  })
  const [loading, setLoading] = useState(false)

  // Fetch salex data from API
  const fetchSalex = async (page: number = 1) => {
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

      // Add amount filters if provided
      if (amountMin) params.append('amountMin', amountMin)
      if (amountMax) params.append('amountMax', amountMax)

      const response = await fetch(`/api/salex?${params}`)
      const data = await response.json()

      if (response.ok) {
        setSalex(data.salex || [])
        setPagination(data.pagination || {
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0
        })
      } else {
        console.error('Failed to fetch salex:', data.message)
        setSalex([])
        setPagination({
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0
        })
      }
    } catch (error) {
      console.error('Error fetching salex:', error)
      setSalex([])
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
    fetchSalex(newPage)
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

  // Handle view details
  const handleViewDetails = (sale: Salex) => {
    console.log('View details for salex:', sale)
    alert(`Viewing details for SALEX Invoice #${sale.invoice_no}`)
  }

  // Initial load and when filters change
  useEffect(() => {
    fetchSalex(1)
  }, [searchTerm, customerVendorFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit])

  // Convert salex data to transaction format for the table component
  const salexAsTransactions = salex.map(sale => ({
    ...sale,
    type: 'salex' as const,
    customer_vendor_name: sale.customer_name,
    customer_vendor_address: sale.customer_address,
    customer_vendor_gstin: sale.customer_gstin,
    invoice_date: sale.invoice_date
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button className="btn-primary">
          New SALEX
        </button>
      </div>

      {/* Filters */}
      <div>
        <TransactionFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          transactionType="salex"
          setTransactionType={() => {}} // Not used for salex page
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

      {/* SALEX Table */}
      <TransactionTable
        transactions={salexAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        hideTypeColumn={true}
      />


    </div>
  )
}
