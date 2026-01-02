import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { PurchaseTable } from '../../components/transactions/PurchaseTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';

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
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  packing_forwarding_total?:number;
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

export default function PurchasesPage() {
  const { showSnackbar } = useSnackbar();

  // Define filter type
  type PurchaseFilterState = {
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    billReference: string;
    itemCount: string;
    paymentMode: string;
    total: string;
    totalTax: string;
    packingForwardingTotal: string;
    sortBy: string;
    sortOrder: string;
  };

  // Create persistent filter state using use-storage-state (sessionStorage - clears on tab close)
  const [currentFilters, setCurrentFilters] = useStorageState<PurchaseFilterState>('purchases-page-filters', {
    defaultValue: {
      vendorFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      billReference: '',
      itemCount: '',
      paymentMode: '',
      total: '',
      totalTax: '',
      packingForwardingTotal: '',
      sortBy: 'invoice_no',
      sortOrder: 'asc'
    },
    storage: "session"
  });

  // AbortController ref for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Debounce timeout ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);



  // Data states
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Debounced fetch function with abort controller
  const debouncedFetchPurchases = useCallback((filtersToUse?: typeof currentFilters) => {
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
      fetchPurchases(abortControllerRef.current?.signal, filtersToUse);
    }, 300); // 300ms debounce delay
  }, [currentFilters]); // Add currentFilters to dependencies

  // Fetch purchases when pagination or search change (but not filters - handled by handleApplyFilters)
  useEffect(() => {
    debouncedFetchPurchases();
  }, [pagination.page, pagination.limit, searchTerm, debouncedFetchPurchases]);

  // Listen for broadcast messages to refresh data when purchases are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Purchase ${msg.type} in another tab, refreshing data...`);
        debouncedFetchPurchases();
      }
    });

    return unsubscribe;
  }, [debouncedFetchPurchases]);

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

  const fetchPurchases = async (signal?: AbortSignal, overrideFilters?: typeof currentFilters) => {
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

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        // Add filter parameters
        vendor: filtersToUse.vendorFilter,
        status: filtersToUse.statusFilter,
        startDate: filtersToUse.dateFrom,
        endDate: filtersToUse.dateTo,
        amountMin: filtersToUse.amountMin,
        amountMax: filtersToUse.amountMax,
        uid: filtersToUse.uidFilter,
        billReference: filtersToUse.billReference,
        itemCount: filtersToUse.itemCount,
        paymentMode: filtersToUse.paymentMode,
        totalTax: filtersToUse.totalTax,
        packingForwardingTotal: filtersToUse.packingForwardingTotal || '',
        // Note: 'total' filter is mapped to amountMin if provided (for exact amount search)
        ...(filtersToUse.total && !filtersToUse.amountMin ? { amountMin: filtersToUse.total, amountMax: filtersToUse.total } : {}),
        // Add sort parameters
        sortBy: filtersToUse.sortBy || 'invoice_no',
        sortOrder: filtersToUse.sortOrder || 'asc'
      });

      console.log('🚀 Purchases fetchPurchases - API call with params:', Object.fromEntries(params));
      console.log('🚀 Purchases fetchPurchases - filters used:', filtersToUse);

      const response = await fetch(`/api/purchases?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch purchases');
      }

      const data = await response.json();

      // Transform API data to match our interface
      const transformedPurchases: Purchase[] = (data.purchases || []).map((purchase: any) => ({
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        select_vendor: purchase.select_vendor,
        vendor_name: purchase.vendor_name,
        vendor_address: purchase.vendor_address,
        vendor_gstin: purchase.vendor_gstin,
        items_total: purchase.items_total,
        freight: purchase.freight,
        total_taxable_value: purchase.total_taxable_value,
        taxrate: purchase.taxrate,
        total_cgst: purchase.total_cgst,
        total_sgst: purchase.total_sgst,
        total_igst: purchase.total_igst,
        total_tax: purchase.total_tax,
        packing_forwarding_total:purchase.packing_forwarding_total,
        total: purchase.total,
        notes: purchase.notes,
        invoice_date: purchase.invoice_date,
        status: purchase.status,
        payment_status: purchase.payment_status,
        payment_mode: purchase.payment_mode,
        fy: purchase.fy,
        transport: purchase.transport,
        item_count: purchase.item_count,
        formattedDate: purchase.formattedDate,
        bill_reference: purchase.bill_reference,
        return_status: purchase.return_status,
        type: 'purchase',
        customer_vendor_name: purchase.vendor_name,
        customer_vendor_address: purchase.vendor_address,
        customer_vendor_gstin: purchase.vendor_gstin
      }));

      setPurchases(transformedPurchases);
      setPagination(data.pagination);
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Purchase fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch purchases:', err);
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





  // Print individual purchase
  const handlePrintPurchase = (transaction: Purchase) => {
    console.log('Printing purchase:', transaction.id);
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for purchase ${transaction.invoice_no} will be implemented`);
  };

  // Handle filter application
  const handleApplyFilters = (filters: PurchaseFilterState) => {
    console.log('📥 Purchases index handleApplyFilters received:', filters);

    // Check if this is a sort operation (only sortBy/sortOrder changed)
    const isSortOperation = (
      filters.vendorFilter === currentFilters.vendorFilter &&
      filters.statusFilter === currentFilters.statusFilter &&
      filters.dateFrom === currentFilters.dateFrom &&
      filters.dateTo === currentFilters.dateTo &&
      filters.amountMin === currentFilters.amountMin &&
      filters.amountMax === currentFilters.amountMax &&
      filters.uidFilter === currentFilters.uidFilter &&
      filters.billReference === currentFilters.billReference &&
      filters.itemCount === currentFilters.itemCount &&
      filters.paymentMode === currentFilters.paymentMode &&
      filters.total === currentFilters.total &&
      filters.totalTax === currentFilters.totalTax &&
      filters.packingForwardingTotal === currentFilters.packingForwardingTotal &&
      (filters.sortBy !== currentFilters.sortBy || filters.sortOrder !== currentFilters.sortOrder)
    );

    setCurrentFilters(filters);
    // Reset to first page when applying filters
    setPagination(prev => ({ ...prev, page: 1 }));

    // For sort operations, fetch immediately without debouncing
    if (isSortOperation) {
      console.log('🎯 Sort operation detected - fetching immediately');
      fetchPurchases(undefined, filters);
    } else {
      console.log('🔄 Filter operation detected - using debounced fetch');
      // For other filter changes, use debounced fetch with new filters
      debouncedFetchPurchases(filters);
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
                <div className="text-red-400 font-medium">Error loading purchases</div>
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

      <PurchaseTable
        purchases={purchases}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}} // Export handled internally by PurchaseTable
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}} // Handled by Link in component
        onPrintDetails={handlePrintPurchase}

        sortBy={currentFilters.sortBy as 'invoice_no' | 'vendor_name' | 'total' | 'invoice_date' | 'payment_status' | 'bill_reference' | 'item_count' | 'payment_mode' | 'total_tax'}
        sortOrder={currentFilters.sortOrder as 'asc' | 'desc'}
        initialFilters={{
          vendorFilter: currentFilters.vendorFilter,
          statusFilter: currentFilters.statusFilter,
          dateFrom: currentFilters.dateFrom,
          dateTo: currentFilters.dateTo,
          amountMin: currentFilters.amountMin,
          amountMax: currentFilters.amountMax,
          uidFilter: currentFilters.uidFilter,
          billReference: currentFilters.billReference,
          itemCount: currentFilters.itemCount,
          paymentMode: currentFilters.paymentMode,
          total: currentFilters.total,
          totalTax: currentFilters.totalTax,
          packingForwardingTotal: currentFilters.packingForwardingTotal
        }}
        actionButton={(
          <Link
            href="/purchases/create"
            className="btn-primary"
          >
            Add Purchase
          </Link>
        )}
      />


    </div>
  );
}
