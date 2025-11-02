import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, FileText, Printer, FileMinus, Undo2 } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';

interface PurchaseItem {
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

interface Purchase {
  id: number;
  invoice_no: number;
  select_vendor?: number;
  vendor_name?: string;
  vendor_address?: string;
  vendor_gstin?: string;
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
  items?: PurchaseItem[];
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  type?: 'purchase';
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
  vendors: { id: string; name?: string; vendor_name?: string; gstin?: string; contact?: string; email?: string }[];
}

interface PurchaseTableProps {
  purchases: Purchase[];
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
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
  }) => void;
  onViewDetails?: (purchase: Purchase) => void;
  onPrintDetails?: (purchase: Purchase) => void;
  onPartialReturn?: (purchase: Purchase) => void;
  onFullReturn?: (purchase: Purchase) => void;
}

type SortField = 'invoice_no' | 'customer_vendor_name' | 'total' | 'invoice_date' | 'status';
type SortOrder = 'asc' | 'desc';

export const PurchaseTable: React.FC<PurchaseTableProps> = ({
  purchases,
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
  const [vendorFilter, setVendorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [uidFilter, setUidFilter] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ vendors: [] });

  // UI states for dropdowns
  const [vendorSearch, setVendorSearch] = useState('');
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);

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
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setFilterOptions({ vendors: data.vendors || [] });
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  // Filter handlers
  const handleVendorSelect = (vendor: { id: string; name?: string; vendor_name?: string }) => {
    setVendorFilter(vendor.id);
    setVendorSearch(vendor.name || vendor.vendor_name || '');
    setShowVendorDropdown(false);
    // Auto-apply filter
    if (onApplyFilters) {
      onApplyFilters({
        vendorFilter: vendor.id,
        statusFilter,
        dateFrom,
        dateTo,
        amountMin,
        amountMax,
        uidFilter
      });
    }
  };

  const clearFilters = () => {
    onSearchChange('');
    setVendorFilter('');
    setVendorSearch('');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setUidFilter('');
  };

  // Filtered options
  const filteredVendors = filterOptions.vendors.filter(vendor =>
    (vendor.name || vendor.vendor_name || '').toLowerCase().includes(vendorSearch.toLowerCase())
  );

  // Sorting logic
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Normalize date values for sorting
  const normalizeDateValue = (dateValue: number | string): number => {
    if (typeof dateValue === 'string') {
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) {
          return timestamp;
        }
      }
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
      return 0;
    }
    return dateValue;
  };

  const sortedPurchases = useMemo(() => {
    return [...purchases].sort((a, b) => {
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
  }, [purchases, sortBy, sortOrder]);

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
        {onExport && (
          <>
            <button className="btn-secondary" onClick={() => onExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => onExport('pdf')}>
              📄 Export PDF
            </button>
          </>
        )}
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
          <input
            type="number"
            placeholder="Enter invoice no"
            value={uidFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setUidFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter: newValue
                });
              }
            }}
            className="input w-full"
            min="1"
          />
        </div>

        {/* Search Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
          <input
            type="text"
            placeholder="Search purchases..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Vendor Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Vendors' },
              ...filterOptions.vendors.map(vendor => ({
                id: vendor.id,
                name: vendor.name || vendor.vendor_name || ''
              }))
            ]}
            selectedValue={vendorFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setVendorFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter: newValue,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter
                });
              }
            }}
            placeholder="Select vendor..."
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
                  vendorFilter,
                  statusFilter,
                  dateFrom: start,
                  dateTo: end,
                  amountMin,
                  amountMax,
                  uidFilter
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
                  vendorFilter,
                  statusFilter: newValue,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax,
                  uidFilter
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
          <input
            type="number"
            placeholder="0"
            value={amountMin}
            onChange={(e) => {
              const newValue = e.target.value;
              setAmountMin(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin: newValue,
                  amountMax,
                  uidFilter
                });
              }
            }}
            className="input w-full"
            min="0"
          />
        </div>

        {/* Amount Max */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount (₹)</label>
          <input
            type="number"
            placeholder="No limit"
            value={amountMax}
            onChange={(e) => {
              const newValue = e.target.value;
              setAmountMax(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter,
                  statusFilter,
                  dateFrom,
                  dateTo,
                  amountMin,
                  amountMax: newValue,
                  uidFilter
                });
              }
            }}
            className="input w-full"
            min="0"
          />
        </div>
      </div>

      {/* Table Section */}
      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {purchases.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} purchases</div>
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
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_vendor_name')}>
                Vendor {getSortIcon('customer_vendor_name')}
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
            {sortedPurchases.map((purchase, idx) => (
              <tr key={purchase.id}>
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="font-medium text-white">
                  {purchase.invoice_no}
                </td>
                <td className="text-slate-300">{purchase.bill_reference || 'N/A'}</td>
                <td className="text-slate-300">
                  <div className="font-medium">{purchase.customer_vendor_name || purchase.vendor_name || 'N/A'}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{purchase.item_count || purchase.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{purchase.total.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{formatDate(purchase.invoice_date)}</td>
                <td className="text-slate-300">{getPaymentModeText(purchase.payment_mode)}</td>
                <td>{getStatusBadge(purchase.payment_status)}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/purchases/view/${purchase.id}`}
                      title="View Purchase Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    {onPrintDetails && (
                      <button
                        onClick={() => onPrintDetails(purchase)}
                        title="Print Purchase Details"
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {onPartialReturn && (
                      <button
                        onClick={() => onPartialReturn(purchase)}
                        title="Create Partial Return"
                        className={`btn-icon text-blue-400 hover:text-blue-300 ${(purchase.return_status || 0) > 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(purchase.return_status || 0) > 1}
                      >
                        <FileMinus className="w-4 h-4" />
                      </button>
                    )}
                    {onFullReturn && (
                      <button
                        onClick={() => onFullReturn(purchase)}
                        title="Create Full Return"
                        className={`btn-icon text-green-400 hover:text-green-300 ${(purchase.return_status || 0) !== 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(purchase.return_status || 0) !== 0}
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

        {sortedPurchases.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No purchases found with the current filters.</div>
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
