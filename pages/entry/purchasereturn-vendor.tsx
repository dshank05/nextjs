import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { PurchaseReturnTable } from '../../components/transactions/PurchaseReturnTable';
import { useSnackbar } from '../../components/SnackbarProvider';

interface PurchaseReturn {
  id: number;
  return_no: string;
  invoice_no?: string; // Invoice number from the original purchase
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
  packing_forwarding_total?: number; // P/F amount
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function PurchaseReturnIndexPage() {
  const { showSnackbar } = useSnackbar();

  // Define filter type
  type ReturnFilterState = {
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
  };

  // Create persistent filter state using use-storage-state (sessionStorage - clears on tab close)
  const [currentFilters, setCurrentFilters] = useStorageState<ReturnFilterState>('purchase-returns-page-filters-v3', {
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
      sortOrder: 'asc'
    },
    storage: "session"
  });

  // AbortController ref for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Debounce timeout ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Data states
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounced fetch function with abort controller
  const debouncedFetchReturns = useCallback((filtersToUse?: typeof currentFilters) => {
    // Clear previous timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Set new timeout for debounced execution
    debounceTimeoutRef.current = setTimeout(() => {
      fetchReturns(abortControllerRef.current?.signal, filtersToUse);
    }, 300); // 300ms debounce delay
  }, [currentFilters]); // Add currentFilters to dependencies

  // Fetch returns when pagination changes (filters handled by handleApplyFilters)
  useEffect(() => {
    debouncedFetchReturns();
  }, [pagination.page, pagination.limit, debouncedFetchReturns]);

  // Cleanup: Cancel any pending requests and timeouts when component unmounts
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchReturns = async (signal?: AbortSignal, overrideFilters?: typeof currentFilters) => {
    try {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      // Use override filters if provided, otherwise use current state
      const filtersToUse = overrideFilters || currentFilters;

      // Build API query parameters - Send ALL parameters like purchase page
      const queryParams = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: filtersToUse.returnNoFilter || '',
        vendor: filtersToUse.vendorFilter || '',
        status: filtersToUse.statusFilter !== 'all' ? filtersToUse.statusFilter : '',
        dateFrom: filtersToUse.dateFrom || '',
        dateTo: filtersToUse.dateTo || '',
        amountMin: filtersToUse.amountMin || '',
        amountMax: filtersToUse.amountMax || '',
        uid: filtersToUse.uidFilter || '',
        itemCount: filtersToUse.itemCount || '',
        paymentMode: filtersToUse.paymentMode || '',
        packingForwardingTotal: filtersToUse.packingForwardingTotal || '',
        sortBy: filtersToUse.sortBy || 'return_no',
        sortOrder: filtersToUse.sortOrder || 'asc'
      });

      const response = await fetch(`/api/purchase-returns?${queryParams}`, {
        signal: abortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to match our interface
      const transformedReturns: PurchaseReturn[] = data.returns.map((ret: any) => ({
        id: ret.id,
        return_no: ret.return_no,
        invoice_no: ret.invoice_no, 
        return_date: ret.return_date ? new Date(ret.return_date * 1000).toISOString().split('T')[0] : '',
        vendor_id: 0, // Not needed in UI
        vendor_name: ret.vendor_name,
        total_amount: ret.total_amount,
        total_tax: ret.total_tax,
        refund_amount: ret.refund_amount || (ret.total_amount + ret.total_tax),
        status: ret.status === 'Completed' ? 1 : 0,
        payment_status: ret.payment_status ?? 0,
        payment_mode: ret.payment_mode ?? 1,
        payment_date: ret.payment_date,
        fy: ret.fy,
        notes: ret.notes,
        item_count: ret.item_count,
        formattedDate: ret.formattedDate,
        statusText: ret.status,
        packing_forwarding_total: ret.packing_forwarding_total || 0
      }));

      setReturns(transformedReturns);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages
      }));

    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Return fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to load returns');
      console.error('Failed to fetch returns:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Handle filter application
  const handleApplyFilters = (filters: ReturnFilterState) => {
    console.log('📥 Purchase Returns handleApplyFilters received:', filters);

    // Check if this is a sort operation (only sortBy/sortOrder changed)
    const isSortOperation = (
      filters.vendorFilter === currentFilters.vendorFilter &&
      filters.statusFilter === currentFilters.statusFilter &&
      filters.dateFrom === currentFilters.dateFrom &&
      filters.dateTo === currentFilters.dateTo &&
      filters.amountMin === currentFilters.amountMin &&
      filters.amountMax === currentFilters.amountMax &&
      (filters.sortBy !== currentFilters.sortBy || filters.sortOrder !== currentFilters.sortOrder)
    );

    setCurrentFilters(filters);
    // Reset to first page when applying filters
    setPagination(prev => ({ ...prev, page: 1 }));

    // For sort operations, fetch immediately without debouncing
    if (isSortOperation) {
      console.log('🎯 Sort operation detected - fetching immediately');
      fetchReturns(undefined, filters);
    } else {
      console.log('🔄 Filter operation detected - using debounced fetch');
      // For other filter changes, use debounced fetch with new filters
      debouncedFetchReturns(filters);
    }
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
                <div className="text-red-300 text-sm">{error}</div>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <PurchaseReturnTable
        returns={returns}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        itemsPerPage={pagination.limit}
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
