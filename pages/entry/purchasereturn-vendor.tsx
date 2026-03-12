import { useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { PurchaseReturnTable } from '../../components/transactions/PurchaseReturnTable';
import { usePurchaseReturns } from '../../hooks/usePurchases';
import { useDebounce } from '../../hooks/useDebounce';
import type { PurchaseReturnFilters } from '../../types/purchases';

export default function PurchaseReturnIndexPage() {
  // Create persistent filter state using use-storage-state (sessionStorage - clears on tab close)
  const [currentFilters, setCurrentFilters] = useStorageState<PurchaseReturnFilters>('purchase-returns-page-filters-v3', {
    defaultValue: {
      returnNoFilter: '',
      vendorFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      itemCount: '',
      paymentMode: '',
      packingForwardingTotal: '',
      sortBy: 'return_no',
      sortOrder: 'asc',
      page: 1,
      limit: 50,
      search: ''
    },
    storage: "session"
  });

  // Debounce search filter
  const debouncedSearch = useDebounce(currentFilters.returnNoFilter, 300);

  // Memoize query filters
  const queryFilters = useMemo(() => ({
    ...currentFilters,
    search: debouncedSearch,
    returnNoFilter: debouncedSearch
  }), [currentFilters, debouncedSearch]);

  // Fetch purchase returns using query hook
  const { data, isLoading, error } = usePurchaseReturns(queryFilters);

  const returns = data?.returns || [];
  const pagination = data?.pagination || {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setCurrentFilters(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setCurrentFilters(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Handle filter application
  const handleApplyFilters = (filters: {
    returnNoFilter: string;
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    itemCount: string;
    paymentMode: string;
    packingForwardingTotal: string;
    sortBy: string;
    sortOrder: string;
  }) => {
    setCurrentFilters({ 
      ...filters, 
      page: 1, // Reset to first page when applying filters
      limit: currentFilters.limit, 
      search: filters.returnNoFilter 
    });
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
                <div className="text-red-300 text-sm">{error instanceof Error ? error.message : 'Failed to load returns'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <PurchaseReturnTable
        returns={returns}
        pagination={pagination}
        loading={isLoading}
        onPageChange={handlePageChange}
        itemsPerPage={currentFilters.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}} // Export handled internally by PurchaseReturnTable
        onApplyFilters={handleApplyFilters}
        sortBy={currentFilters.sortBy as 'return_no' | 'vendor_name' | 'total_amount' | 'return_date' | 'status' | 'item_count'}
        sortOrder={currentFilters.sortOrder as 'asc' | 'desc'}
        initialFilters={{
          returnNoFilter: currentFilters.returnNoFilter,
          vendorFilter: currentFilters.vendorFilter,
          statusFilter: currentFilters.statusFilter,
          dateFrom: currentFilters.dateFrom,
          dateTo: currentFilters.dateTo,
          amountMin: currentFilters.amountMin,
          amountMax: currentFilters.amountMax,
          uidFilter: currentFilters.uidFilter,
          itemCount: currentFilters.itemCount,
          paymentMode: currentFilters.paymentMode,
          packingForwardingTotal: currentFilters.packingForwardingTotal
        }}
        actionButton={(
          <Link
            href="/entry/purchasereturn-vendor-create"
            className="btn-primary"
          >
            Create Return
          </Link>
        )}
      />
    </div>
  );
}
