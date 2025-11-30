import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowUp, ArrowDown, Eye } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';

interface PurchaseReturn {
  id: number;
  return_no: string;
  return_date: string;
  vendor_id: number;
  vendor_name: string;
  total_amount: number;
  total_tax: number;
  refund_amount: number;
  status: number;
  payment_status: number;
  payment_mode: number;
  payment_date?: number;
  fy: number;
  notes?: string;
  item_count: number;
  formattedDate?: string;
  statusText?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PurchaseReturnTableProps {
  returns: PurchaseReturn[];
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
    sortBy: string;
    sortOrder: string;
  }) => void;
  onViewDetails?: (returnItem: PurchaseReturn) => void;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  initialFilters?: {
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
  };
}

type SortField = 'return_no' | 'vendor_name' | 'total_amount' | 'return_date' | 'status' | 'item_count';
type SortOrder = 'asc' | 'desc';

export const PurchaseReturnTable: React.FC<PurchaseReturnTableProps> = ({
  returns,
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
  sortBy: propSortBy = 'return_date',
  sortOrder: propSortOrder = 'desc',
  initialFilters
}) => {
  // Filter states - initialize with initialFilters if provided
  const [filters, setFilters] = useState({
    vendorFilter: initialFilters?.vendorFilter || '',
    statusFilter: initialFilters?.statusFilter || 'all',
    dateFrom: initialFilters?.dateFrom || '',
    dateTo: initialFilters?.dateTo || '',
    amountMin: initialFilters?.amountMin || '',
    amountMax: initialFilters?.amountMax || ''
  });

  // Use props for sorting state (controlled component)
  const sortBy = propSortBy;
  const sortOrder = propSortOrder;

  // Update filters when initialFilters change
  useEffect(() => {
    if (initialFilters) {
      setFilters({
        vendorFilter: initialFilters.vendorFilter || '',
        statusFilter: initialFilters.statusFilter || 'all',
        dateFrom: initialFilters.dateFrom || '',
        dateTo: initialFilters.dateTo || '',
        amountMin: initialFilters.amountMin || '',
        amountMax: initialFilters.amountMax || ''
      });
    }
  }, [initialFilters]);

  const clearFilters = () => {
    onSearchChange('');
    setFilters({
      vendorFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: ''
    });
  };

  // Sorting logic - now uses backend sorting
  const handleSort = (field: SortField) => {
    const newSortOrder = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';

    // Apply filters with new sort parameters (parent will update props)
    if (onApplyFilters) {
      const filterParams = {
        vendorFilter: filters.vendorFilter,
        statusFilter: filters.statusFilter,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        sortBy: field,
        sortOrder: newSortOrder
      };
      onApplyFilters(filterParams);
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

  const getStatusBadge = (status: number) => {
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Completed</span>;
    } else {
      return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Pending</span>;
    }
  };

  const getPaymentStatusBadge = (paymentStatus: number) => {
    if (paymentStatus === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
    } else {
      return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Unpaid</span>;
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
        <div className="flex items-center gap-2">
          <ExportMenu
            data={returns}
            columns={[
              { key: 'id', label: 'ID', enabled: true },
              { key: 'return_no', label: 'Return No', enabled: true },
              { key: 'vendor_name', label: 'Vendor Name', enabled: true },
              { key: 'item_count', label: 'Items Qty', enabled: true },
              { key: 'total_amount', label: 'Total Amount', enabled: true },
              { key: 'total_tax', label: 'Tax Amount', enabled: true },
              { key: 'refund_amount', label: 'Refund Amount', enabled: true },
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'statusText', label: 'Status', enabled: true },
              { key: 'notes', label: 'Notes', enabled: true },
            ]}
            config={{
              title: 'Purchase Returns Report',
              fileName: `Purchase_Returns_Report_${new Date().toISOString().split('T')[0]}`
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
      <div className="grid grid-cols-6 gap-4 mb-4">
        {/* Return No Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Return No</label>
          <ClearableInput
            type="text"
            placeholder="Enter return no"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        {/* Vendor Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
          <ClearableInput
            type="text"
            placeholder="Filter by vendor"
            value={filters.vendorFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, vendorFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  vendorFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
          />
        </div>

        {/* Amount Min Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Min Amount</label>
          <ClearableInput
            type="number"
            placeholder="Min amount"
            value={filters.amountMin}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, amountMin: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  amountMin: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Amount Max Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount</label>
          <ClearableInput
            type="number"
            placeholder="Max amount"
            value={filters.amountMax}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, amountMax: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  amountMax: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Date Range Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
          <DateRangeFilter
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onDateChange={(start, end) => {
              setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  dateFrom: start,
                  dateTo: end,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() => {
              clearFilters();
              // Apply cleared filters
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter: '',
                  statusFilter: 'all',
                  dateFrom: '',
                  dateTo: '',
                  amountMin: '',
                  amountMax: '',
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
          <div>Showing {returns.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} returns</div>
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
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('return_no')}>
                Return No {getSortIcon('return_no')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('vendor_name')}>
                Vendor {getSortIcon('vendor_name')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('item_count')}>
                Items Qty
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total_amount')}>
                Refund Amount {getSortIcon('total_amount')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('return_date')}>
                Date {getSortIcon('return_date')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                Status {getSortIcon('status')}
              </th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((returnItem, idx) => (
              <tr key={returnItem.id}>
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="font-medium text-white">
                  {returnItem.return_no}
                </td>
                <td className="text-slate-300">
                  <div className="font-medium">{returnItem.vendor_name}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{returnItem.item_count}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{returnItem.refund_amount.toLocaleString('en-IN')}</td>
                <td className="text-slate-300">{returnItem.formattedDate}</td>
                <td>{getStatusBadge(returnItem.status)}</td>
                <td>{getPaymentStatusBadge(returnItem.payment_status)}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/entry/purchasereturn-vendor/${returnItem.id}`}
                      title="View Return Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {returns.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">
            {searchTerm || filters.vendorFilter || filters.dateFrom || filters.dateTo || filters.statusFilter !== 'all'
              ? 'No purchase returns found with the current filters.'
              : 'No purchase returns found'
            }
          </div>
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
