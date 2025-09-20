import { useState, useEffect } from 'react'
import { TransactionTable } from '../../components/transactions/TransactionTable'
import { TransactionFilters } from '../../components/transactions/TransactionFilters'

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
  id: number;
  invoice_no: number;
  select_customer?: number;
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
  items_total: number;
  freight?: number;
  total_taxable_value: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  total: number;
  notes?: string;
  invoice_date: number | string;
  status?: number;
  payment_mode?: number;
  fy: number;
  mode?: number;
  type?: 'sale' | 'salex' | 'purchase';
  items?: SaleItem[];
  item_count?: number;
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function SalesPage() {
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

  // Mock data for sales (using Invoice and Invoiceitems tables structure)
  const mockSales: Sale[] = [
    {
      id: 1,
      invoice_no: 1001,
      select_customer: 1,
      customer_name: 'ABC Electronics',
      customer_gstin: '22AAAAA0000A1Z5',
      items_total: 50000,
      total_taxable_value: 50000,
      total: 59000,
      invoice_date: Date.now() / 1000 - 86400, // Yesterday
      fy: 2025,
      freight: 1000,
      taxrate: 18,
      total_cgst: 4500,
      total_sgst: 4500,
      total_tax: 9000,
      status: 1,
      payment_mode: 1,
      item_count: 3,
      items: [
        {
          id: 1,
          invoice_no: 1001,
          name_of_product: 'AC Switch',
          hsn: '85365010',
          part: 'SW-001',
          qty: 10,
          rate: 2000,
          subtotal: 20000,
          fy: 2025,
          invoice_date: Date.now() / 1000 - 86400
        },
        {
          id: 2,
          invoice_no: 1001,
          name_of_product: 'Relay Module',
          hsn: '85364900',
          part: 'RL-002',
          qty: 5,
          rate: 3000,
          subtotal: 15000,
          fy: 2025,
          invoice_date: Date.now() / 1000 - 86400
        },
        {
          id: 3,
          invoice_no: 1001,
          name_of_product: 'Control Panel',
          hsn: '85371000',
          part: 'CP-003',
          qty: 2,
          rate: 7500,
          subtotal: 15000,
          fy: 2025,
          invoice_date: Date.now() / 1000 - 86400
        }
      ]
    },
    {
      id: 2,
      invoice_no: 1002,
      select_customer: 2,
      customer_name: 'XYZ Traders',
      customer_gstin: '11CCCCC0000C3X7',
      items_total: 30000,
      total_taxable_value: 30000,
      total: 35400,
      invoice_date: Date.now() / 1000 - 259200, // 3 days ago
      fy: 2025,
      freight: 500,
      taxrate: 18,
      total_igst: 5400,
      total_tax: 5400,
      status: 2,
      payment_mode: 2,
      notes: 'Interstate transaction',
      item_count: 2
    },
    {
      id: 3,
      invoice_no: 1003,
      select_customer: 3,
      customer_name: 'Metro Distributors',
      customer_gstin: '44DDDDD0000D4W8',
      items_total: 25000,
      total_taxable_value: 25000,
      total: 29500,
      invoice_date: Date.now() / 1000, // Today
      fy: 2025,
      freight: 0,
      taxrate: 18,
      total_cgst: 2250,
      total_sgst: 2250,
      total_tax: 4500,
      status: 0,
      payment_mode: 4,
      item_count: 1
    }
  ]

  // Simulate API call
  const fetchSales = async (page: number = 1) => {
    setLoading(true)

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))

    // Apply filters to mock data
    let filteredData = [...mockSales]

    // Search filter
    if (searchTerm) {
      filteredData = filteredData.filter(sale =>
        sale.invoice_no.toString().includes(searchTerm.toLowerCase()) ||
        sale.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.customer_gstin?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Customer filter
    if (customerVendorFilter) {
      filteredData = filteredData.filter(sale =>
        sale.customer_name?.toLowerCase().includes(customerVendorFilter.toLowerCase())
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      const statusMap: { [key: string]: number } = {
        'paid': 1,
        'pending': 0,
        'cancelled': 2,
        'draft': undefined
      }
      const statusValue = statusMap[statusFilter]
      filteredData = filteredData.filter(sale => sale.status === statusValue)
    }

    // Date filters
    if (dateFrom) {
      const fromDate = new Date(dateFrom).getTime() / 1000
      filteredData = filteredData.filter(sale => {
        const saleDate = typeof sale.invoice_date === 'string' ? new Date(sale.invoice_date).getTime() / 1000 : sale.invoice_date
        return saleDate >= fromDate
      })
    }

    if (dateTo) {
      const toDate = new Date(dateTo).getTime() / 1000
      filteredData = filteredData.filter(sale => {
        const saleDate = typeof sale.invoice_date === 'string' ? new Date(sale.invoice_date).getTime() / 1000 : sale.invoice_date
        return saleDate <= toDate
      })
    }

    // Amount filters
    if (amountMin) {
      const minAmount = parseFloat(amountMin)
      filteredData = filteredData.filter(sale => sale.total >= minAmount)
    }

    if (amountMax) {
      const maxAmount = parseFloat(amountMax)
      filteredData = filteredData.filter(sale => sale.total <= maxAmount)
    }

    // Pagination
    const total = filteredData.length
    const totalPages = Math.ceil(total / limit)
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit
    const paginatedData = filteredData.slice(startIndex, endIndex)

    setSales(paginatedData)
    setPagination({
      page,
      limit,
      total,
      totalPages
    })
    setLoading(false)
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

  // Handle view details
  const handleViewDetails = (sale: Sale) => {
    console.log('View details for sale:', sale)
    alert(`Viewing details for Sale Invoice #${sale.invoice_no}`)
  }

  // Initial load and when filters change
  useEffect(() => {
    fetchSales(1)
  }, [searchTerm, customerVendorFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit])

  // Convert sales data to transaction format for the table component
  const salesAsTransactions = sales.map(sale => ({
    ...sale,
    type: 'sale' as const,
    customer_vendor_name: sale.customer_name,
    customer_vendor_address: sale.customer_address,
    customer_vendor_gstin: sale.customer_gstin,
    invoice_date: sale.invoice_date
  }))

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Sales Management</h1>
        <p className="text-slate-400">Manage sales invoices and transactions</p>
      </div>

      {/* Filters */}
      <div className="mb-6">
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
        />
      </div>

      {/* Sales Table */}
      <TransactionTable
        transactions={salesAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
      />

      {/* Summary Statistics */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total Sales</h3>
          <p className="text-2xl font-bold text-blue-400">{pagination.total}</p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total Revenue</h3>
          <p className="text-2xl font-bold text-green-400">
            ₹{sales.reduce((sum, sale) => sum + sale.total, 0).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total GST</h3>
          <p className="text-2xl font-bold text-purple-400">
            ₹{sales.reduce((sum, sale) => sum + (sale.total_tax || 0), 0).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Pending Amount</h3>
          <p className="text-2xl font-bold text-yellow-400">
            ₹{sales
              .filter(sale => sale.status === 0)
              .reduce((sum, sale) => sum + sale.total, 0)
              .toLocaleString('en-IN')}
          </p>
        </div>
      </div>
    </div>
  )
}
