import { useState, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useRouter } from 'next/router';
import { ArrowUp, ArrowDown, Eye, Trash2 } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../../components/common';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { getLocalDateString } from '../../lib/date-utils';
import { useSaleReturns, useDeleteSaleReturn } from '../../hooks/useSales';
import { useDebounce } from '../../hooks/useDebounce';
import type { SaleReturnFilters } from '../../types/sales';

export default function SaleReturnPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // Define filter type
  type ReturnFilterState = {
    returnNoFilter: string;
    customerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    itemCount: string;
    paymentMode: string;
    sortBy: string;
    sortOrder: string;
  };

  // Create persistent filter state
  const [currentFilters, setCurrentFilters] = useStorageState<ReturnFilterState>('sale-returns-page-filters', {
    defaultValue: {
      returnNoFilter: '',
      customerFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      itemCount: '',
      paymentMode: '',
      sortBy: 'return_date',
      sortOrder: 'desc'
    },
    storage: "session"
  });

  // Pagination state
  const [page, setPage] = useState(1);
  const limit = 50;

  // Filter states
  const [filters, setFilters] = useState({
    returnNoFilter: currentFilters.returnNoFilter || '',
    customerFilter: currentFilters.customerFilter || '',
    statusFilter: currentFilters.statusFilter || 'all',
    dateFrom: currentFilters.dateFrom || '',
    dateTo: currentFilters.dateTo || '',
    amountMin: currentFilters.amountMin || '',
    amountMax: currentFilters.amountMax || '',
    uidFilter: currentFilters.uidFilter || '',
    itemCount: currentFilters.itemCount || '',
    paymentMode: currentFilters.paymentMode || '',
    sortBy: currentFilters.sortBy || 'return_date',
    sortOrder: currentFilters.sortOrder || 'desc'
  });

  // Debounce search terms
  const debouncedReturnNo = useDebounce(filters.returnNoFilter, 300);
  const debouncedCustomer = useDebounce(filters.customerFilter, 300);
  const debouncedUid = useDebounce(filters.uidFilter, 300);

  // Build query filters
  const queryFilters: SaleReturnFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedReturnNo || debouncedCustomer || debouncedUid,
    customerFilter: debouncedCustomer,
    statusFilter: filters.statusFilter,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder as 'asc' | 'desc'
  }), [page, limit, debouncedReturnNo, debouncedCustomer, debouncedUid, filters]);

  // Query hooks
  const { data, isLoading, error } = useSaleReturns(queryFilters);
  const deleteReturn = useDeleteSaleReturn();

  const returns = data?.returns || [];
  const pagination = data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 };

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [returnToDelete, setReturnToDelete] = useState<{ id: number; type: string } | null>(null);

  // Handle filter application
  const handleApplyFilters = (newFilters: ReturnFilterState) => {
    setCurrentFilters(newFilters);
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  };

  const clearFilters = () => {
    const clearedFilters = {
      returnNoFilter: '',
      customerFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      itemCount: '',
      paymentMode: '',
      sortBy: currentFilters.sortBy,
      sortOrder: currentFilters.sortOrder
    };
    setFilters(clearedFilters);
    handleApplyFilters(clearedFilters);
  };

  const handleDeleteClick = (returnItem: any) => {
    setReturnToDelete({ id: returnItem.id, type: returnItem.invoice_type });
    setDeleteModalOpen(true);
  };

  const handleCancelDelete = () => {
    setDeleteModalOpen(false);
    setReturnToDelete(null);
  };

  const handleConfirmDelete = () => {
    if (!returnToDelete) return;

    deleteReturn.mutate(returnToDelete.id, {
      onSuccess: () => {
        showSnackbar('success', `Return deleted successfully`);
        setDeleteModalOpen(false);
        setReturnToDelete(null);
      },
      onError: (error: Error) => {
        showSnackbar('error', error.message || 'Failed to delete return');
      }
    });
  };

  const handleSort = (field: string) => {
    const newSortOrder = filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : 'asc';
    handleApplyFilters({
      ...currentFilters,
      sortBy: field,
      sortOrder: newSortOrder
    });
  };



  const getSortIcon = (field: string) => {
    if (currentFilters.sortBy !== field) {
      return null;
    }
    return currentFilters.sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const getStatusBadge = (status: string) => {
    if (status === 'Completed') {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Complete</span>;
    } else {
      return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Pending</span>;
    }
  };

  const getPaymentStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
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
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading returns</div>
                <div className="text-red-300 text-sm">{error.message}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-end gap-2 mb-4">
          <div className="flex items-center gap-2">
            <ExportMenu
              data={returns}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'return_no', label: 'Return No', enabled: true },
                { key: 'invoice_no', label: 'Invoice No', enabled: true },
                { key: 'customer_name', label: 'Customer Name', enabled: true },
                { key: 'item_count', label: 'Items Qty', enabled: true },
                { key: 'total_amount', label: 'Total', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'status', label: 'Return Status', enabled: true },
                { key: 'notes', label: 'Notes', enabled: true },
              ]}
              config={{
                title: 'Sale Returns Report',
                fileName: `Sale_Returns_Report_${getLocalDateString()}`
              }}
            />
            <Link
              href="/entry/salereturn-create"
              className="btn-primary"
            >
              Create Return
            </Link>
          </div>
        </div>

        {/* Filters Section */}
        <div className="grid grid-cols-8 gap-4 mb-4">
          {/* Return No Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Return No</label>
            <ClearableInput
              type="text"
              placeholder="Enter return no"
              value={filters.returnNoFilter}
              onChange={(e) => {
                const newValue = e.target.value;
                setFilters(prev => ({ ...prev, returnNoFilter: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  returnNoFilter: newValue
                });
              }}
            />
          </div>

          {/* Invoice No Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Invoice No</label>
            <ClearableInput
              type="text"
              placeholder="Enter invoice no"
              value={filters.uidFilter}
              onChange={(e) => {
                const newValue = e.target.value;
                setFilters(prev => ({ ...prev, uidFilter: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  uidFilter: newValue
                });
              }}
            />
          </div>

          {/* Customer Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Customer</label>
            <ClearableInput
              type="text"
              placeholder="Enter customer name"
              value={filters.customerFilter}
              onChange={(e) => {
                const newValue = e.target.value;
                setFilters(prev => ({ ...prev, customerFilter: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  customerFilter: newValue
                });
              }}
            />
          </div>

          {/* Items Qty Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Items Qty</label>
            <ClearableInput
              type="number"
              placeholder="Enter item count"
              value={filters.itemCount}
              onChange={(e) => {
                const newValue = e.target.value;
                setFilters(prev => ({ ...prev, itemCount: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  itemCount: newValue
                });
              }}
              min="0"
            />
          </div>

          {/* Date Range Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
            <DateRangeFilter
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onDateChange={(start, end) => {
                setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }));
                handleApplyFilters({
                  ...currentFilters,
                  dateFrom: start,
                  dateTo: end
                });
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
              selectedValue={filters.paymentMode}
              onSelectionChange={(value) => {
                const newValue = value || '';
                setFilters(prev => ({ ...prev, paymentMode: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  paymentMode: newValue
                });
              }}
              placeholder="Select payment mode..."
            />
          </div>

          {/* Return Status Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Return Status</label>
            <SearchableSelect
              options={[
                { id: 'all', name: 'All Status' },
                { id: 'Completed', name: 'Complete' },
                { id: 'Pending', name: 'Pending' }
              ]}
              selectedValue={filters.statusFilter}
              onSelectionChange={(value) => {
                const newValue = value || 'all';
                setFilters(prev => ({ ...prev, statusFilter: newValue }));
                handleApplyFilters({
                  ...currentFilters,
                  statusFilter: newValue
                });
              }}
              placeholder="Select status..."
            />
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
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
          {isLoading && (
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
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_no')}>
                  Invoice No. {getSortIcon('invoice_no')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('customer_name')}>
                  Customer {getSortIcon('customer_name')}
                </th>
                <th>Type</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('item_count')}>
                  Items Qty {getSortIcon('item_count')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total_amount')}>
                  Total {getSortIcon('total_amount')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('return_date')}>
                  Date {getSortIcon('return_date')}
                </th>
                <th>Payment Mode</th>
                <th>Return Status</th>
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
                    {returnItem.invoice_no}
                  </td>
                  <td className="text-slate-300">
                    <div className="font-medium">{returnItem.customer_name}</div>
                  </td>
                  <td className="text-slate-300">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      returnItem.invoice_type === 'invoicex' 
                        ? 'bg-purple-600 text-white' 
                        : 'bg-blue-600 text-white'
                    }`}>
                      {returnItem.invoice_type === 'invoicex' ? 'Salex' : 'Sale'}
                    </span>
                  </td>
                  <td className="text-slate-300">
                    <div className="flex items-center gap-1">
                      <span>{returnItem.item_count}</span>
                      <span className="text-xs text-slate-400">items</span>
                    </div>
                  </td>
                  <td className="text-slate-300 font-semibold">₹{returnItem.total_amount?.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{returnItem.formattedDate}</td>
                  <td className="text-slate-300">
                    {returnItem.payment_mode === 0 ? 'Cash' : returnItem.payment_mode === 1 ? 'Bank' : 'N/A'}
                  </td>
                  <td>{getPaymentStatusBadge(returnItem.payment_status)}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Link
                        href={`/entry/salereturn/${returnItem.id}`}
                        title="View Return Details"
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => handleDeleteClick(returnItem)}
                        title="Delete Return"
                        className="btn-icon text-red-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {returns.length === 0 && !isLoading && (
            <div className="text-center py-8 text-slate-400">
              {filters.returnNoFilter || filters.customerFilter || filters.dateFrom || filters.dateTo || filters.statusFilter !== 'all'
                ? 'No sale returns found with the current filters.'
                : 'No sale returns found. Click "Create Return" to create a new return.'
              }
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button onClick={() => setPage(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
            <div className="flex space-x-2">
              {pagination.page > 3 && <> <button onClick={() => setPage(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
              {getPageNumbers().map(p => <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
              {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => setPage(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
            </div>
            <button onClick={() => setPage(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Sale Return"
        message={
          returnToDelete
            ? `Are you sure you want to delete this return? This action is irreversible and will restore stock quantities, create reversal entries in the ledger, and update customer balance. This operation cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={deleteReturn.isPending}
        loadingText="Deleting..."
      />
    </div>
  );
}
