import { useState, useEffect } from 'react';
import { TransactionTable } from '../../components/transactions/TransactionTable';
import { TransactionFilters } from '../../components/transactions/TransactionFilters';

// Define types for transaction data (matching the component interfaces)
interface TransactionItem {
  id: number;
  invoice_no: number;
  name_of_product: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  rate: number;
  subtotal: number;
  fy: number;
  invoice_date: number;
}

interface Transaction {
  id: number;
  invoice_no: number;
  type: 'sale' | 'salex' | 'purchase';
  items_total: number;
  total_taxable_value: number;
  total: number;
  invoice_date: number | string;
  fy: number;
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
  freight?: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  notes?: string;
  status?: number;
  payment_mode?: number;
  transport?: string;
  items?: TransactionItem[];
  item_count?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function TransactionsPage() {
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [transactionType, setTransactionType] = useState('all');
  const [customerVendorFilter, setCustomerVendorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [limit, setLimit] = useState(25);

  // Data states
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);

  // Mock data for demonstration
  const mockTransactions: Transaction[] = [
    {
      id: 1,
      invoice_no: 1001,
      type: 'sale',
      items_total: 50000,
      total_taxable_value: 50000,
      total: 59000,
      invoice_date: Date.now() / 1000 - 86400, // Yesterday
      fy: 2025,
      customer_vendor_name: 'ABC Electronics',
      customer_vendor_gstin: '22AAAAA0000A1Z5',
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
      invoice_no: 2001,
      type: 'purchase',
      items_total: 75000,
      total_taxable_value: 75000,
      total: 88500,
      invoice_date: Date.now() / 1000 - 172800, // 2 days ago
      fy: 2025,
      customer_vendor_name: 'Global Supplies Ltd',
      customer_vendor_gstin: '33BBBBB0000B2Y6',
      freight: 1500,
      taxrate: 18,
      total_cgst: 6750,
      total_sgst: 6750,
      total_tax: 13500,
      status: 0,
      payment_mode: 3,
      transport: 'Blue Dart',
      item_count: 4
    },
    {
      id: 3,
      invoice_no: 1002,
      type: 'salex',
      items_total: 30000,
      total_taxable_value: 30000,
      total: 35400,
      invoice_date: Date.now() / 1000 - 259200, // 3 days ago
      fy: 2025,
      customer_vendor_name: 'XYZ Traders',
      customer_vendor_gstin: '11CCCCC0000C3X7',
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
      id: 4,
      invoice_no: 1003,
      type: 'sale',
      items_total: 25000,
      total_taxable_value: 25000,
      total: 29500,
      invoice_date: Date.now() / 1000, // Today
      fy: 2025,
      customer_vendor_name: 'Metro Distributors',
      customer_vendor_gstin: '44DDDDD0000D4W8',
      freight: 0,
      taxrate: 18,
      total_cgst: 2250,
      total_sgst: 2250,
      total_tax: 4500,
      status: 0,
      payment_mode: 4,
      item_count: 1
    }
  ];

  // Simulate API call
  const fetchTransactions = async (page: number = 1) => {
    setLoading(true);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Apply filters to mock data
    let filteredData = [...mockTransactions];

    // Search filter
    if (searchTerm) {
      filteredData = filteredData.filter(transaction =>
        transaction.invoice_no.toString().includes(searchTerm.toLowerCase()) ||
        transaction.customer_vendor_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.customer_vendor_gstin?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Transaction type filter
    if (transactionType !== 'all') {
      filteredData = filteredData.filter(transaction => transaction.type === transactionType);
    }

    // Customer/Vendor filter (simplified for demo)
    if (customerVendorFilter) {
      filteredData = filteredData.filter(transaction =>
        transaction.customer_vendor_name?.toLowerCase().includes(customerVendorFilter.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      const statusMap: { [key: string]: number } = {
        'paid': 1,
        'pending': 0,
        'cancelled': 2,
        'draft': undefined
      };
      const statusValue = statusMap[statusFilter];
      filteredData = filteredData.filter(transaction => transaction.status === statusValue);
    }

    // Date filters
    if (dateFrom) {
      const fromDate = new Date(dateFrom).getTime() / 1000;
      filteredData = filteredData.filter(transaction => {
        const transDate = typeof transaction.invoice_date === 'string'
          ? new Date(transaction.invoice_date).getTime() / 1000
          : transaction.invoice_date;
        return transDate >= fromDate;
      });
    }

    if (dateTo) {
      const toDate = new Date(dateTo).getTime() / 1000;
      filteredData = filteredData.filter(transaction => {
        const transDate = typeof transaction.invoice_date === 'string'
          ? new Date(transaction.invoice_date).getTime() / 1000
          : transaction.invoice_date;
        return transDate <= toDate;
      });
    }

    // Amount filters
    if (amountMin) {
      const minAmount = parseFloat(amountMin);
      filteredData = filteredData.filter(transaction => transaction.total >= minAmount);
    }

    if (amountMax) {
      const maxAmount = parseFloat(amountMax);
      filteredData = filteredData.filter(transaction => transaction.total <= maxAmount);
    }

    // Pagination
    const total = filteredData.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedData = filteredData.slice(startIndex, endIndex);

    setTransactions(paginatedData);
    setPagination({
      page,
      limit,
      total,
      totalPages
    });
    setLoading(false);
  };

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
    fetchTransactions(newPage);
  };

  // Handle limit changes
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setTransactionType('all');
    setCustomerVendorFilter('');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Handle view details
  const handleViewDetails = (transaction: Transaction) => {
    console.log('View details for transaction:', transaction);
    // In a real app, this would open a modal or navigate to detail page
    alert(`Viewing details for Invoice #${transaction.invoice_no}`);
  };

  // Initial load and when filters change
  useEffect(() => {
    fetchTransactions(1);
  }, [searchTerm, transactionType, customerVendorFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transaction Management</h1>
        <p className="text-slate-400">View and manage all sales, sales extended, and purchase transactions</p>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <TransactionFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          transactionType={transactionType}
          setTransactionType={setTransactionType}
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

      {/* Transaction Table */}
      <TransactionTable
        transactions={transactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
      />

      {/* Summary Statistics */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total Transactions</h3>
          <p className="text-2xl font-bold text-blue-400">{pagination.total}</p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total Sales</h3>
          <p className="text-2xl font-bold text-green-400">
            ₹{transactions
              .filter(t => t.type === 'sale' || t.type === 'salex')
              .reduce((sum, t) => sum + t.total, 0)
              .toLocaleString('en-IN')}
          </p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Total Purchases</h3>
          <p className="text-2xl font-bold text-red-400">
            ₹{transactions
              .filter(t => t.type === 'purchase')
              .reduce((sum, t) => sum + t.total, 0)
              .toLocaleString('en-IN')}
          </p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-2">Pending Amount</h3>
          <p className="text-2xl font-bold text-yellow-400">
            ₹{transactions
              .filter(t => t.status === 0)
              .reduce((sum, t) => sum + t.total, 0)
              .toLocaleString('en-IN')}
          </p>
        </div>
      </div>
    </div>
  );
}
