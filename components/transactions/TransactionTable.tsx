import { ReactNode, useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, FileText, Truck } from 'lucide-react';

// Define types for transaction data
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
  select_customer?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface TransactionTableProps {
  transactions: Transaction[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  onViewDetails: (transaction: Transaction) => void;
  hideTypeColumn?: boolean; // New optional prop to hide type column
}

type SortField = 'invoice_no' | 'customer_vendor_name' | 'total' | 'invoice_date' | 'status';
type SortOrder = 'asc' | 'desc';

export const TransactionTable = ({
  transactions,
  pagination,
  loading,
  onPageChange,
  onViewDetails,
  hideTypeColumn = false
}: TransactionTableProps) => {
  const [sortBy, setSortBy] = useState<SortField>('invoice_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const toggleRowExpansion = (transactionId: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(transactionId)) {
      newExpanded.delete(transactionId);
    } else {
      newExpanded.add(transactionId);
    }
    setExpandedRows(newExpanded);
  };

  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case 'invoice_no':
          aValue = a.invoice_no;
          bValue = b.invoice_no;
          break;
        case 'customer_vendor_name':
          aValue = a.customer_vendor_name?.toString().toLowerCase() || '';
          bValue = b.customer_vendor_name?.toString().toLowerCase() || '';
          break;
        case 'total':
          aValue = a.total;
          bValue = b.total;
          break;
        case 'invoice_date':
          aValue = typeof a.invoice_date === 'string' ? new Date(a.invoice_date).getTime() : a.invoice_date;
          bValue = typeof b.invoice_date === 'string' ? new Date(b.invoice_date).getTime() : b.invoice_date;
          break;
        case 'status':
          aValue = a.status || 0;
          bValue = b.status || 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [transactions, sortBy, sortOrder]);

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="inline w-4 h-4 ml-1" />;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const formatDate = (dateValue: number | string) => {
    if (typeof dateValue === 'string') {
      return new Date(dateValue).toLocaleDateString('en-IN');
    }
    return new Date(dateValue * 1000).toLocaleDateString('en-IN');
  };

  const getStatusBadge = (status?: number, type?: string) => {
    if (type === 'purchase') {
      switch (status) {
        case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Received</span>;
        case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Pending</span>;
        default: return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Unknown</span>;
      }
    } else {
      switch (status) {
        case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
        case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Pending</span>;
        case 2: return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Cancelled</span>;
        default: return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Draft</span>;
      }
    }
  };

  const getPaymentModeText = (mode?: number) => {
    switch (mode) {
      case 1: return 'Cash';
      case 2: return 'Cheque';
      case 3: return 'Online';
      case 4: return 'Credit';
      default: return 'N/A';
    }
  };

  if (loading) {
    return (
      <div className="card h-[600px] flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
        <div>Showing {transactions.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} transactions</div>
        <div>Page {pagination.page} of {pagination.totalPages}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>S.N</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_no')}>
                Invoice No {getSortIcon('invoice_no')}
              </th>
              {!hideTypeColumn && <th>Type</th>}
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_vendor_name')}>
                Customer/Vendor {getSortIcon('customer_vendor_name')}
              </th>
              <th>Items</th>
              <th>Taxable Value</th>
              <th>Tax Amount</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total')}>
                Total {getSortIcon('total')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_date')}>
                Date {getSortIcon('invoice_date')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                Status {getSortIcon('status')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.map((transaction, index) => (
              <tr key={transaction.id}>
                <td>{(pagination.page - 1) * pagination.limit + index + 1}</td>
                <td className="font-medium text-white">
                  {transaction.invoice_no}
                </td>
                {!hideTypeColumn && (
                  <td>
                    <span className={`px-2 py-1 text-xs rounded-full font-semibold ${
                      transaction.type === 'sale' ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' :
                      transaction.type === 'salex' ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' :
                      'bg-green-600/20 text-green-300 border border-green-500/30'
                    }`}>
                      {transaction.type.toUpperCase()}
                    </span>
                  </td>
                )}
                <td className="text-slate-300">
                  <div>
                    <div className="font-medium">{transaction.customer_vendor_name || 'N/A'}</div>
                    {transaction.customer_vendor_gstin && (
                      <div className="text-xs text-slate-400">GSTIN: {transaction.customer_vendor_gstin}</div>
                    )}
                  </div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{transaction.item_count || transaction.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300">₹{transaction.total_taxable_value?.toLocaleString('en-IN') || '0'}</td>
                <td className="text-slate-300">
                  <div className="text-sm">
                    {transaction.total_tax ? (
                      <div>
                        <div>₹{transaction.total_tax.toLocaleString('en-IN')}</div>
                        {transaction.taxrate && <div className="text-xs text-slate-400">@{transaction.taxrate}%</div>}
                      </div>
                    ) : '₹0'}
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{transaction.total.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{formatDate(transaction.invoice_date)}</td>
                <td>{getStatusBadge(transaction.status, transaction.type)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRowExpansion(transaction.id)}
                      className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {onViewDetails && (
                      <button
                        onClick={() => onViewDetails(transaction)}
                        className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
                        title="View Full Details"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedTransactions.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No transactions found with the current filters.</div>
        )}
      </div>

      {/* Expanded Row Details */}
      {sortedTransactions.map((transaction) => (
        expandedRows.has(transaction.id) && (
          <div key={`details-${transaction.id}`} className="border-t border-slate-700 mt-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Transaction Details</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Invoice No:</span>
                    <span className="text-white">{transaction.invoice_no}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Type:</span>
                    <span className="text-white">{transaction.type.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Date:</span>
                    <span className="text-white">{formatDate(transaction.invoice_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Payment Mode:</span>
                    <span className="text-white">{getPaymentModeText(transaction.payment_mode)}</span>
                  </div>
                  {transaction.transport && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Transport:</span>
                      <span className="text-white">{transaction.transport}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Financial Summary</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Items Total:</span>
                    <span className="text-white">₹{transaction.items_total?.toLocaleString('en-IN') || '0'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Freight:</span>
                    <span className="text-white">₹{transaction.freight?.toLocaleString('en-IN') || '0'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Taxable Value:</span>
                    <span className="text-white">₹{transaction.total_taxable_value.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Tax:</span>
                    <span className="text-white">₹{transaction.total_tax?.toLocaleString('en-IN') || '0'}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-slate-400">Grand Total:</span>
                    <span className="text-white">₹{transaction.total.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white mb-2">GST Breakdown</h4>
                <div className="space-y-1 text-sm">
                  {transaction.total_cgst && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">CGST:</span>
                      <span className="text-white">₹{transaction.total_cgst.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {transaction.total_sgst && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">SGST:</span>
                      <span className="text-white">₹{transaction.total_sgst.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {transaction.total_igst && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">IGST:</span>
                      <span className="text-white">₹{transaction.total_igst.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {transaction.notes && (
                    <div className="mt-2">
                      <span className="text-slate-400 text-xs">Notes:</span>
                      <p className="text-white text-xs mt-1">{transaction.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Items Table */}
            {transaction.items && transaction.items.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Items</h4>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>HSN</th>
                        <th>Part No</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transaction.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="text-slate-300">{item.name_of_product}</td>
                          <td className="text-slate-300">{item.hsn || '-'}</td>
                          <td className="text-slate-300">{item.part || '-'}</td>
                          <td className="text-slate-300">{item.qty}</td>
                          <td className="text-slate-300">₹{item.rate.toLocaleString('en-IN')}</td>
                          <td className="text-slate-300">₹{item.subtotal.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      ))}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
          <button
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page === 1}
            className="btn-secondary disabled:opacity-50"
          >
            Previous
          </button>
          <div className="flex space-x-2">
            {pagination.page > 3 && (
              <>
                <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button>
                <span>...</span>
              </>
            )}
            {getPageNumbers().map(p => (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}
              >
                {p}
              </button>
            ))}
            {pagination.page < pagination.totalPages - 2 && (
              <>
                <span>...</span>
                <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">
                  {pagination.totalPages}
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page === pagination.totalPages}
            className="btn-secondary disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
