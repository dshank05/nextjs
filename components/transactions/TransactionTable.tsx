import { ReactNode, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, FileText, Truck, Printer } from 'lucide-react';

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
  invoice_date: number | string;
}

interface Transaction {
  payment_status: number;
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
  bill_reference?: string;
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

interface CustomAction {
  label: string;
  icon: ReactNode;
  onClick: (transaction: Transaction) => void;
  className?: string;
  title?: string;
  enabled?: (transaction: Transaction) => boolean; // Optional function to check if action is enabled
}

interface TransactionTableProps {
  transactions: Transaction[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  onViewDetails: (transaction: Transaction) => void;
  onPrintDetails?: (transaction: Transaction) => void; // New optional callback for print action
  hideTypeColumn?: boolean; // New optional prop to hide type column
  customActions?: CustomAction[]; // New optional prop for custom action buttons
  allowedTransactionTypes?: string[]; // New optional prop to limit transaction types shown
}

type SortField = 'invoice_no' | 'customer_vendor_name' | 'total' | 'invoice_date' | 'status';
type SortOrder = 'asc' | 'desc';

export const TransactionTable = ({
  transactions,
  pagination,
  loading,
  onPageChange,
  onViewDetails,
  onPrintDetails,
  hideTypeColumn = false,
  customActions = []
}: TransactionTableProps) => {
  const [sortBy, setSortBy] = useState<SortField>('invoice_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  // Normalize date values for sorting - consistent with formatDate function
  const normalizeDateValue = (dateValue: number | string): number => {
    if (typeof dateValue === 'string') {
      // Try to parse as Unix timestamp first (if it's all digits)
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) { // Likely a Unix timestamp
          return timestamp;
        }
      }
      // Try parsing as regular date string
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
      return 0; // Invalid date
    }
    // Number: assume Unix timestamp in seconds
    return dateValue;
  };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
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
          // Parse date values consistently for sorting
          aValue = normalizeDateValue(a.invoice_date);
          bValue = normalizeDateValue(b.invoice_date);
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
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const formatDate = (dateValue: number | string) => {
    if (typeof dateValue === 'string') {
      // Try to parse as Unix timestamp first (if it's all digits)
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) { // Likely a Unix timestamp
          return new Date(timestamp * 1000).toLocaleDateString('en-IN');
        }
      }
      // Try parsing as regular date string
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN');
      }
      return 'Invalid Date';
    }
    // Number: assume Unix timestamp in seconds
    return new Date(dateValue * 1000).toLocaleDateString('en-IN');
  };

  const getStatusBadge = (status?: number, type?: string) => {
    // Handle all three payment statuses: 0 (Unpaid), 1 (Paid), 2 (Partially Paid)
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
    } else if (status === 2) {
      return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
    } else {
      return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
    }
  };

  const getPaymentModeText = (mode?: number) => {
    switch (mode) {
      case 0: return 'Cash';
      case 1: return 'Bank';
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
    <div>
      <div className="mb-3 flex justify-between items-center text-sm text-slate-400">
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
              <th>Bill Ref</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_vendor_name')}>
                Customer/Vendor {getSortIcon('customer_vendor_name')}
              </th>
              <th>Items</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total')}>
                Total {getSortIcon('total')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_date')}>
                Date {getSortIcon('invoice_date')}
              </th>
              <th>Payment Mode</th>
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
                      transaction.type === 'sale' ? 'bg-blue-600/20 text-blue-300' :
                      transaction.type === 'salex' ? 'bg-purple-600/20 text-purple-300' :
                      'bg-green-600/20 text-green-300'
                    }`}>
                      {transaction.type.toUpperCase()}
                    </span>
                  </td>
                )}
                <td className="text-slate-300">{transaction.bill_reference || 'N/A'}</td>
                <td className="text-slate-300">
                  <div className="font-medium">{transaction.customer_vendor_name || 'N/A'}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{transaction.item_count || transaction.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{transaction.total?.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{formatDate(transaction.invoice_date)}</td>
                <td className="text-slate-300">{getPaymentModeText(transaction.payment_mode)}</td>
                <td>{getStatusBadge(transaction.payment_status, transaction.type)}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/${transaction.type === 'purchase' ? 'purchases' : transaction.type}/view/${transaction.id}`}
                      title={`View ${transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)} Details`}
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    {onPrintDetails && (
                      <button
                        onClick={() => onPrintDetails(transaction)}
                        title={`Print ${transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)} Details`}
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {customActions.map((action, actionIndex) => {
                      const isEnabled = action.enabled ? action.enabled(transaction) : true;
                      return (
                        <button
                          key={actionIndex}
                          onClick={() => action.onClick(transaction)}
                          title={action.title}
                          className={`btn-icon ${action.className} ${!isEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          disabled={!isEnabled}
                        >
                          {action.icon}
                        </button>
                      );
                    })}
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

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4">
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
