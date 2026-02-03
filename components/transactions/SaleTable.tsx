import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, FileText, Printer, FileMinus, Undo2 } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';
import { getLocalDateString } from '../../lib/date-utils';

interface SaleItem {
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
  payment_status?: number;
  payment_mode?: number;
  fy: number;
  transport?: string;
  items?: SaleItem[];
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  type?: 'sale';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
  packing_forwarding_total?: number;
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

interface SaleTableProps {
  sales: Sale[];
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
    uidFilter: string;
    billRef?: string;
    items?: string;
    total?: string;
    taxAmount?: string;
    pf?: string;
    paymentMode?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => void;
  onViewDetails?: (sale: Sale) => void;
  onPrintDetails?: (sale: Sale) => void;
  onPartialReturn?: (sale: Sale) => void;
  onFullReturn?: (sale: Sale) => void;
  initialFilters?: {
    customerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    uidFilter: string;
  };
}

type SortField = 'invoice_no' | 'customer_name' | 'total' | 'invoice_date' | 'payment_status' | 'bill_reference' | 'item_count' | 'total_tax' | 'packing_forwarding_total' | 'payment_mode';
type SortOrder = 'asc' | 'desc';

export const SaleTable: React.FC<SaleTableProps> = ({
  sales,
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
  onFullReturn,
  initialFilters
}) => {
  // Filter states - initialize with initialFilters if provided
  const [customerFilter, setCustomerFilter] = useState(initialFilters?.customerFilter || '');
  const [statusFilter, setStatusFilter] = useState(initialFilters?.statusFilter || 'all');
  const [dateFrom, setDateFrom] = useState(initialFilters?.dateFrom || '');
  const [dateTo, setDateTo] = useState(initialFilters?.dateTo || '');
  const [uidFilter, setUidFilter] = useState(initialFilters?.uidFilter || '');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ customers: [] });

  // Column-specific filter states
  const [billRefFilter, setBillRefFilter] = useState('');
  const [taxAmountFilter, setTaxAmountFilter] = useState('');
  const [pfFilter, setPfFilter] = useState('');
  const [paymentModeFilter, setPaymentModeFilter] = useState('');

  // UI states for dropdowns
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Sorting states
  const [sortBy, setSortBy] = useState<SortField>('invoice_no');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Debounced search
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Update filters when initialFilters change
  useEffect(() => {
    if (initialFilters) {
      setCustomerFilter(initialFilters.customerFilter || '');
      setStatusFilter(initialFilters.statusFilter || 'all');
      setDateFrom(initialFilters.dateFrom || '');
      setDateTo(initialFilters.dateTo || '');
      setUidFilter(initialFilters.uidFilter || '');
    }
  }, [initialFilters]);

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
        uidFilter,
        billRef: billRefFilter,
        taxAmount: taxAmountFilter,
        pf: pfFilter,
        paymentMode: paymentModeFilter,
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
    setUidFilter('');
    setBillRefFilter('');
    setTaxAmountFilter('');
    setPfFilter('');
    setPaymentModeFilter('');
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

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-4">
        {/* TOP SEARCH BOX - COMMENTED OUT */}
        {/* <div className="flex items-center gap-2">
          <div className="w-64">
            <ClearableInput
              type="text"
              placeholder="Search sales..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div> */}
        <div className="flex items-center gap-2 ml-auto">
          <ExportMenu
            data={sales}
            columns={[
              { key: 'id', label: 'ID', enabled: true },
              { key: 'invoice_no', label: 'Invoice No', enabled: true },
              { key: 'bill_reference', label: 'Bill Reference', enabled: true },
              { key: 'customer_vendor_name', label: 'Customer Name', enabled: true },
              { key: 'item_count', label: 'Items Count', enabled: true },
              { key: 'total', label: 'Total Amount', enabled: true },
              { key: 'invoice_date', label: 'Invoice Date', enabled: true },
              { key: 'payment_mode', label: 'Payment Mode', enabled: true },
              { key: 'payment_status', label: 'Payment Status', enabled: true },
              { key: 'notes', label: 'Notes', enabled: true },
            ]}
            config={{
              title: 'Sale Report',
              fileName: `Sale_Report_${getLocalDateString()}`
            }}
          />
          {actionButton && (
            <div className="flex-shrink-0">
              {actionButton}
            </div>
          )}
        </div>
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-10 gap-4 mb-4">
        {/* Invoice No Filter */}
        <div className="flex-1">
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
                  uidFilter: newValue,
                  billRef: billRefFilter,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: paymentModeFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="1"
          />
        </div>

        {/* Bill Ref Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Bill Ref</label>
          <ClearableInput
            type="text"
            placeholder="Enter bill reference"
            value={billRefFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setBillRefFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  billRef: newValue,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: paymentModeFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
          />
        </div>

        {/* Customer Filter */}
        <div className="flex-1">
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
                  uidFilter,
                  billRef: billRefFilter,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: paymentModeFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select customer..."
          />
        </div>

        {/* Items Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Items</label>
          <ClearableInput
            type="number"
            placeholder="Enter item count"
            value={''}
            onChange={(e) => {
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Total Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Total (₹)</label>
          <ClearableInput
            type="number"
            placeholder="Enter total amount"
            value={''}
            onChange={(e) => {
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
            step="0.01"
          />
        </div>

        {/* TAX AMOUNT Filter - COMMENTED OUT */}
        {/* <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">TAX AMOUNT (₹)</label>
          <ClearableInput
            type="number"
            placeholder="Enter tax amount"
            value={taxAmountFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setTaxAmountFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
            step="0.01"
          />
        </div> */}

        {/* P/F Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">P/F (₹)</label>
          <ClearableInput
            type="number"
            placeholder="Enter P/F amount"
            value={pfFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setPfFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
            step="0.01"
          />
        </div>

        {/* Date Range Filter */}
        <div className="flex-1">
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
                  uidFilter,
                  billRef: billRefFilter,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: paymentModeFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Payment Mode Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Modes' },
              { id: '0', name: 'Cash' },
              { id: '1', name: 'Bank' }
            ]}
            selectedValue={paymentModeFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setPaymentModeFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  billRef: billRefFilter,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select payment mode..."
          />
        </div>

        {/* Status Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Payment Status</label>
          <SearchableSelect
            options={[
              { id: 'all', name: 'All Status' },
              { id: 'paid', name: 'Paid' },
              { id: 'unpaid', name: 'Unpaid' }
            ]}
            selectedValue={statusFilter}
            onSelectionChange={(value) => {
              const newValue = value || 'all';
              setStatusFilter(newValue);
              // Auto-apply filter - convert frontend values to API values
              if (onApplyFilters) {
                let apiStatusValue = '';
                if (newValue === 'paid') {
                  apiStatusValue = '1';
                } else if (newValue === 'unpaid') {
                  apiStatusValue = '0';
                } else if (newValue === 'all') {
                  apiStatusValue = '';
                }
                onApplyFilters({
                  customerFilter,
                  statusFilter: apiStatusValue,
                  dateFrom,
                  dateTo,
                  uidFilter,
                  billRef: billRefFilter,
                  taxAmount: taxAmountFilter,
                  pf: pfFilter,
                  paymentMode: paymentModeFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select status..."
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() => {
              setCustomerFilter('');
              setStatusFilter('all');
              setDateFrom('');
              setDateTo('');
              setUidFilter('');
              setBillRefFilter('');
              setTaxAmountFilter('');
              setPfFilter('');
              setPaymentModeFilter('');
              // Apply cleared filters
              if (onApplyFilters) {
                onApplyFilters({
                  customerFilter: '',
                  statusFilter: 'all',
                  dateFrom: '',
                  dateTo: '',
                  uidFilter: '',
                  sortBy,
                  sortOrder
                });
              }
            }}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table Section */}
      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {sales.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} sales</div>
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
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('bill_reference')}>
                Bill Ref {getSortIcon('bill_reference')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_name')}>
                Customer {getSortIcon('customer_name')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('item_count')}>
                Items {getSortIcon('item_count')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total')}>
                Total {getSortIcon('total')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total_tax')}>
                TAX AMOUNT {getSortIcon('total_tax')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('packing_forwarding_total')}>
                P/F {getSortIcon('packing_forwarding_total')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_date')}>
                Date {getSortIcon('invoice_date')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_mode')}>
                Payment Mode {getSortIcon('payment_mode')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_status')}>
                Payment Status {getSortIcon('payment_status')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale, idx) => (
              <tr key={sale.id}>
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="font-medium text-white">
                  {sale.invoice_no}
                </td>
                <td className="text-slate-300">{sale.bill_reference || 'N/A'}</td>
                <td className="text-slate-300">
                  <div className="font-medium">{sale.customer_vendor_name || sale.customer_name || 'N/A'}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{sale.item_count || sale.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{sale.total?.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">₹{(sale.total_tax || 0)?.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">₹{(sale.packing_forwarding_total || 0)?.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{formatDate(sale.invoice_date)}</td>
                <td className="text-slate-300">{getPaymentModeText(sale.payment_mode)}</td>
                <td>{getStatusBadge(sale.payment_status)}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/sale/view/${sale.id}`}
                      title="View Sale Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    {onPrintDetails && (
                      <button
                        onClick={() => onPrintDetails(sale)}
                        title="Print Sale Details"
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {/* RETURN BUTTONS - COMMENTED OUT */}
                    {/* {onPartialReturn && (
                      <button
                        onClick={() => onPartialReturn(sale)}
                        title="Create Partial Return"
                        className={`btn-icon text-blue-400 hover:text-blue-300 ${(sale.return_status || 0) === 2 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(sale.return_status || 0) === 2}
                      >
                        <FileMinus className="w-4 h-4" />
                      </button>
                    )}
                    {onFullReturn && (
                      <button
                        onClick={() => onFullReturn(sale)}
                        title="Create Full Return"
                        className={`btn-icon text-green-400 hover:text-green-300 ${(sale.return_status || 0) !== 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(sale.return_status || 0) !== 0}
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    )} */}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sales.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No sales found with the current filters.</div>
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
