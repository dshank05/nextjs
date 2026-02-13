import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { SaleTable } from '../../components/transactions/SaleTable';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';

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
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  type?: 'sale';
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

export default function SalePage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // Define filter type
  type SaleFilterState = {
    customerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    sortBy: string;
    sortOrder: string;
  };

  // Create persistent filter state using use-storage-state (sessionStorage - clears on tab close)
  const [currentFilters, setCurrentFilters] = useStorageState<SaleFilterState>('sales-page-filters', {
    defaultValue: {
      customerFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      sortBy: 'invoice_date',
      sortOrder: 'desc'
    },
    storage: "session"
  });

  // AbortController ref for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Debounce timeout ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  // Data states
  const [sales, setSales] = useState<Sale[]>([]);
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
  const debouncedFetchSales = useCallback(() => {
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
      fetchSales(abortControllerRef.current?.signal);
    }, 300); // 300ms debounce delay
  }, [currentFilters]); // Add currentFilters to dependencies

  // Fetch sales when pagination or search change (but not filters - handled by handleApplyFilters)
  useEffect(() => {
    debouncedFetchSales();
  }, [pagination.page, pagination.limit, searchTerm, debouncedFetchSales]);

  // Listen for broadcast messages to refresh data when sales are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'sales' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Sale ${msg.type} in another tab, refreshing data...`);
        debouncedFetchSales();
      }
    });

    return unsubscribe;
  }, [debouncedFetchSales]);

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

  // ✅ Clear sessionStorage when component unmounts (user navigates away)
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('sales-page-filters');
      }
    };
  }, []);

  const fetchSales = async (signal?: AbortSignal, overrideFilters?: typeof currentFilters) => {
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
        customer: filtersToUse.customerFilter,
        status: filtersToUse.statusFilter,
        dateFrom: filtersToUse.dateFrom,
        dateTo: filtersToUse.dateTo,
        amountMin: filtersToUse.amountMin,
        amountMax: filtersToUse.amountMax,
        uid: filtersToUse.uidFilter,
        // Add sort parameters
        sortBy: filtersToUse.sortBy || 'invoice_date',
        sortOrder: filtersToUse.sortOrder || 'desc'
      });

      const response = await fetch(`/api/sales?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sales');
      }

      const data = await response.json();

      // Transform API data to match our interface
      const transformedSales: Sale[] = (data.sales || []).map((sale: any) => ({
        id: sale.id,
        invoice_no: sale.invoice_no,
        select_customer: sale.select_customer,
        customer_name: sale.customer_name,
        customer_address: sale.customer_address,
        customer_gstin: sale.customer_gstin,
        items_total: sale.items_total,
        freight: sale.freight,
        total_taxable_value: sale.total_taxable_value,
        taxrate: sale.taxrate,
        total_cgst: sale.total_cgst,
        total_sgst: sale.total_sgst,
        total_igst: sale.total_igst,
        total_tax: sale.total_tax,
        total: sale.total,
        notes: sale.notes,
        invoice_date: sale.invoice_date,
        status: sale.status,
        payment_status: sale.payment_status,
        payment_mode: sale.payment_mode,
        fy: sale.fy,
        mode: sale.mode,
        type: sale.type,
        item_count: sale.item_count,
        formattedDate: sale.formattedDate,
        bill_reference: sale.bill_reference,
        return_status: sale.return_status,
        customer_vendor_name: sale.customer_name,
        customer_vendor_address: sale.customer_address,
        customer_vendor_gstin: sale.customer_gstin
      }));

      setSales(transformedSales);
      setPagination(data.pagination);
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Sale fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch sales:', err);
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



  // Handle return actions
  const handlePartialReturn = (transaction: Sale) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0 || returnStatus === 1) {
      console.log('Starting partial return for sale:', transaction.id);
      router.push(`/entry/salereturn-create?invoice=${transaction.id}&type=partial`);
    } else {
      alert('Full returns cannot be modified with partial returns.');
    }
  };

  const handleReturnWholeOrder = (transaction: Sale) => {
    console.log('Return whole order for sale:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return;

    setProcessingReturn(true);
    try {
      const response = await fetch('/api/sale-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_id: selectedTransaction.id,
          return_type: 'sale',
          full_return: true,
          return_date: Math.floor(Date.now() / 1000),
          notes: 'Full order return processed automatically'
        })
      });

      if (response.ok) {
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`);
        fetchSales();
      } else {
        const error = await response.json();
        showSnackbar('error', `Failed to process return: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred while processing return');
    } finally {
      setProcessingReturn(false);
      setShowReturnModal(false);
      setSelectedTransaction(null);
    }
  };

  const cancelReturnWholeOrder = () => {
    setShowReturnModal(false);
    setSelectedTransaction(null);
  };

  const handleFullReturn = (transaction: Sale) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0) {
      handleReturnWholeOrder(transaction);
    } else {
      alert('Full returns are only available for sales with no previous returns.');
    }
  };

  // Handle filter application
  const handleApplyFilters = (filters: SaleFilterState) => {
    console.log('📥 Sales index handleApplyFilters received:', filters);

    // Check if this is a sort operation (only sortBy/sortOrder changed)
    const isSortOperation = (
      filters.customerFilter === currentFilters.customerFilter &&
      filters.statusFilter === currentFilters.statusFilter &&
      filters.dateFrom === currentFilters.dateFrom &&
      filters.dateTo === currentFilters.dateTo &&
      // filters.amountMin === currentFilters.amountMin &&
      // filters.amountMax === currentFilters.amountMax &&
      filters.uidFilter === currentFilters.uidFilter &&
      (filters.sortBy !== currentFilters.sortBy || filters.sortOrder !== currentFilters.sortOrder)
    );

    setCurrentFilters(filters);
    // Reset to first page when applying filters
    setPagination(prev => ({ ...prev, page: 1 }));

    // For sort operations, fetch immediately without debouncing
    if (isSortOperation) {
      console.log('🎯 Sort operation detected - fetching immediately');
      fetchSales(undefined, filters);
    } else {
      console.log('🔄 Filter operation detected - using debounced fetch');
      // For other filter changes, use debounced fetch
      debouncedFetchSales();
    }
  };

  // Print individual sale
  const handlePrintSale = (transaction: Sale) => {
    console.log('Printing sale:', transaction.id);
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for sale ${transaction.invoice_no} will be implemented`);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading sales</div>
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

      <SaleTable
        sales={sales}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}} // Export handled internally by SaleTable
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}} // Handled by Link in component
        onPrintDetails={handlePrintSale}
        onPartialReturn={handlePartialReturn}
        onFullReturn={handleFullReturn}
        initialFilters={{
          customerFilter: currentFilters.customerFilter,
          statusFilter: currentFilters.statusFilter,
          dateFrom: currentFilters.dateFrom,
          dateTo: currentFilters.dateTo,
          // amountMin: currentFilters.amountMin,
          // amountMax: currentFilters.amountMax,
          uidFilter: currentFilters.uidFilter
        }}
        actionButton={(
          <Link
            href="/sale/create"
            className="btn-primary"
          >
            Add New Invoice
          </Link>
        )}
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_vendor_name})?

This will return all items in the sale order and cannot be undone.`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmReturnWholeOrder}
        onCancel={cancelReturnWholeOrder}
      />
    </div>
  );
}
