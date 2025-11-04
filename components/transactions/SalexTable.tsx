import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, FileText, Printer, FileMinus, Undo2 } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';

interface SalexItem {
  id: number;
  invoice_no: number;
  name_of_product: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  unit?: number;
  rate: number;
  subtotal: number;
  fy: number;
  invoice_date: number | string;
}

interface Salex {
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
  payment_status?: number;
  payment_mode?: number;
  fy: number;
  transport?: string;
  items?: SalexItem[];
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  type?: 'salex';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  customers: { id: string; name?: string; billing_name?: string; gstin?: string; contact?: string; email?: string }[];
}

interface SalexTableProps {
  salexs: Salex[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
  actionButton?: React.ReactNode;
  onExport?: (exportType: 'excel' | 'pdf') => void;
  onApplyFilters?: (filters: {
    customerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    sortBy?: string;
    sortOrder?: string;
  }) => void;
  onViewDetails?: (salex: Salex) => void;
  onPrintDetails?: (salex: Salex) => void;
  onPartialReturn?: (salex: Salex) => void;
  onFullReturn?: (salex: Salex) => void;
}

type SortField = 'invoice_no' | 'customer_name' | 'total' | 'invoice_date' | 'payment_status';
type SortOrder = 'asc' | 'desc';

export const SalexTable: React.FC<SalexTableProps> = ({
  salexs,
  pagination,
  loading,
  onPageChange,
  searchTerm,
  onSearchChange,
  itemsPerPage,
  onItemsPerPageChange,
  actionButton,
  onExport,
  onApplyFilters,
  onViewDetails,
  onPrintDetails,
  onPartialReturn,
  onFullReturn
}) => {
  // Filter states
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [uidFilter, setUidFilter] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ customers: [] });

  // UI states for dropdowns
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Sorting states
  const [sortBy, setSortBy] = useState<SortField>('invoice_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Debounced search
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setFilterOptions({ customers: data.customers || [] });
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  // Filter handlers
  const handleCustomerSelect = (customer: { id: string; name?: string; billing_name?: string }) => {
    setCustomerFilter(customer.id);
    setCustomerSearch(customer.name || customer.billing_name || '');
    setShowCustomerDropdown(false);
    // Auto-apply filter
    if (onApplyFilters) {
      onApplyFilters({
        customerFilter: customer.id,
        statusFilter,
        dateFrom,
        dateTo,
        amountMin,
        amountMax,
        uidFilter,
        sortBy,
        sortOrder
      });
    }
  };

  const clearFilters = () => {
    onSearchChange('');
    setCustomerFilter('');
    setCustomerSearch('');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setUidFilter('');
  };

  // Filtered options
  const filteredCustomers = filterOptions.customers.filter(customer =>
    (customer.name || customer.billing_name || '').toLowerCase().includes(customerSearch.toLowerCase())
  );

  // Sorting logic - now uses backend sorting
  const handleSort = (field: SortField) => {
    const newSortOrder = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';
    setSortBy(field);
    setSortOrder(newSortOrder);

    // Apply filters with new sort parameters
    if (onApplyFilters) {
      onApplyFilters({
        customerFilter,
        statusFilter,
        dateFrom,
        dateTo,
        amountMin,
        amountMax,
        uidFilter,
        sortBy: field,
        sortOrder: newSortOrder
      });
    }
  };

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
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) {
          return new Date(timestamp * 1000).toLocaleDateString('en-IN');
        }
      }
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN');
      }
      return 'Invalid Date';
    }
    return new Date(dateValue * 1000).toLocaleDateString('en-IN');
  };

  const getStatusBadge = (status?: number) => {
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
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

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-end gap-2 mb-4">
        <ExportMenu
          data={salexs}
          columns={[
            { key: 'id', label: 'ID', enabled: true },
            { key: 'invoice_no', label: 'Invoice No', enabled: true },
            { key: 'customer_vendor_name', label: 'Customer Name', enabled: true },
            { key: 'total', label: 'Total Amount', enabled: true },
            { key: 'invoice_date', label: 'Invoice Date', enabled: true },
            { key: 'payment_status', label: 'Payment Status', enabled: true },
            { key: 'bill_reference', label: 'Bill Reference', enabled: true },
          ]}
          config={{
            title: 'Salex Report',
            fileName: `Salex_Report_${new Date().toISOString().split('T')[0]}`
          }}
        />
        {actionButton && (
          <div className="flex-shrink-0">
            {actionButton}
          </div>
        )}
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4 mb-4">
        {/* UID Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Invoice No</label>
          <ClearableInput
            type="number"
            placeholder="Enter invoice no"
            value={uidFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setUidFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="1"
          />
        </div>

        {/* Search Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
          <ClearableInput
            type="text"
            placeholder="Search salex..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        {/* Customer Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Customer</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Customers' },
              ...filterOptions.customers.map(customer => ({
                id: customer.id,
                name: customer.name || customer.billing_name || ''
              }))
            ]}
            selectedValue={customerFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setCustomerFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter: newValue,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select customer..."
          />
        </div>

        {/* Date Range Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
          <DateRangeFilter
            startDate={dateFrom}
            endDate={dateTo}
            onDateChange={(start, end) => {
              setDateFrom(start);
              setDateTo(end);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom: start,
                  dateTo: end,
                  amountMin,
                  amountMax,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setStatusFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter: newValue,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            className="select w-full"
          >
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </div>

        {/* Amount Min */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Min Amount (₹)</label>
          <ClearableInput
            type="number"
            placeholder="0"
            value={amountMin}
            onChange={(e) => {
              const newValue = e.target.value;
              setAmountMin(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin: newValue,
                  amountMax,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Amount Max */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount (₹)</label>
          <ClearableInput
            type="number"
            placeholder="No limit"
            value={amountMax}
            onChange={(e) => {
              const newValue = e.target.value;
              setAmountMax(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax: newValue,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>
      </div>

      {/* Table Section */}
      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {salexs.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} salex</div>
          <div>Page {pagination.page} of {pagination.totalPages}</div>
        </div>
      )}

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
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_no')}>
                Invoice No {getSortIcon('invoice_no')}
              </th>
              <th>Bill Ref</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_name')}>
                Customer {getSortIcon('customer_name')}
              </th>
              <th>Items</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total')}>
                Total {getSortIcon('total')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_date')}>
                Date {getSortIcon('invoice_date')}
              </th>
              <th>Payment Mode</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_status')}>
                Status {getSortIcon('payment_status')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {salexs.map((salex, idx) => (
              <tr key={salex.id}>
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="font-medium text-white">
                  {salex.invoice_no}
                </td>
                <td className="text-slate-300">{salex.bill_reference || 'N/A'}</td>
                <td className="text-slate-300">
                  <div className="font-medium">{salex.customer_vendor_name || salex.customer_name || 'N/A'}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{salex.item_count || salex.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{salex.total.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{formatDate(salex.invoice_date)}</td>
                <td className="text-slate-300">{getPaymentModeText(salex.payment_mode)}</td>
                <td>{getStatusBadge(salex.payment_status)}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/salex/view/${salex.id}`}
                      title="View Salex Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    {onPrintDetails && (
                      <button
                        onClick={() => onPrintDetails(salex)}
                        title="Print Salex Details"
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {onPartialReturn && (
                      <button
                        onClick={() => onPartialReturn(salex)}
                        title="Create Partial Return"
                        className={`btn-icon text-blue-400 hover:text-blue-300 ${(salex.return_status || 0) > 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(salex.return_status || 0) > 1}
                      >
                        <FileMinus className="w-4 h-4" />
                      </button>
                    )}
                    {onFullReturn && (
                      <button
                        onClick={() => onFullReturn(salex)}
                        title="Create Full Return"
                        className={`btn-icon text-green-400 hover:text-green-300 ${(salex.return_status || 0) !== 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(salex.return_status || 0) !== 0}
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {salexs.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No salex found with the current filters.</div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
          <button onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
          <div className="flex space-x-2">
            {pagination.page > 3 && <> <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
            {getPageNumbers().map(p => <button key={p} onClick={() => onPageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
            {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
          </div>
          <button onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
        </div>
      )}

    </div>
  );
};
