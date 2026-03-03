import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { SalexTable } from '../../components/transactions/SalexTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';

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
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  packing_forwarding_total?: number;
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

export default function SalexPage() {
  const { showSnackbar } = useSnackbar();

  type SalexFilterState = {
    customerFilter: string;
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

  const [currentFilters, setCurrentFilters] = useStorageState<SalexFilterState>('salex-page-filters', {
    defaultValue: {
      customerFilter: '',
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [salex, setSalex] = useState<Salex[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const debouncedFetchSalex = useCallback((filtersToUse?: typeof currentFilters) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    debounceTimeoutRef.current = setTimeout(() => {
      fetchSalex(abortControllerRef.current?.signal, filtersToUse);
    }, 300);
  }, [currentFilters]);

  useEffect(() => {
    debouncedFetchSalex();
  }, [pagination.page, pagination.limit, searchTerm, debouncedFetchSalex]);

  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'salex' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Salex ${msg.type} in another tab, refreshing data...`);
        debouncedFetchSalex();
      }
    });

    return unsubscribe;
  }, [debouncedFetchSalex]);

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

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('salex-page-filters');
      }
    };
  }, []);

  const fetchSalex = async (signal?: AbortSignal, overrideFilters?: typeof currentFilters) => {
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      const filtersToUse = overrideFilters || currentFilters;

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        vendor: filtersToUse.customerFilter,
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
        ...(filtersToUse.total && !filtersToUse.amountMin ? { amountMin: filtersToUse.total, amountMax: filtersToUse.total } : {}),
        sortBy: filtersToUse.sortBy || 'invoice_no',
        sortOrder: filtersToUse.sortOrder || 'asc'
      });

      console.log('🚀 Salex fetchSalex - API call with params:', Object.fromEntries(params));

      const response = await fetch(`/api/salex?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch salex');
      }

      const data = await response.json();

      const transformedSalex: Salex[] = (data.salex || []).map((salex: any) => ({
        id: salex.id,
        invoice_no: salex.invoice_no,
        select_customer: salex.select_customer,
        customer_name: salex.customer_name,
        customer_address: salex.customer_address,
        customer_gstin: salex.customer_gstin,
        items_total: salex.items_total,
        freight: salex.freight,
        total_taxable_value: salex.total_taxable_value,
        taxrate: salex.taxrate,
        total_cgst: salex.total_cgst,
        total_sgst: salex.total_sgst,
        total_igst: salex.total_igst,
        total_tax: salex.total_tax,
        packing_forwarding_total: salex.packing_forwarding_total,
        total: salex.total,
        notes: salex.notes,
        invoice_date: salex.invoice_date,
        status: salex.status,
        payment_status: salex.payment_status,
        payment_mode: salex.payment_mode,
        fy: salex.fy,
        transport: salex.transport,
        item_count: salex.item_count,
        formattedDate: salex.formattedDate,
        bill_reference: salex.bill_reference,
        return_status: salex.return_status,
        type: 'salex',
        customer_vendor_name: salex.customer_name,
        customer_vendor_address: salex.customer_address,
        customer_vendor_gstin: salex.customer_gstin
      }));

      setSalex(transformedSalex);
      setPagination(data.pagination);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Salex fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch salex:', err);
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

  const handlePrintSalex = (transaction: Salex) => {
    console.log('Printing salex:', transaction.id);
    alert(`Print functionality for salex ${transaction.invoice_no} will be implemented`);
  };

  const handleApplyFilters = (filters: SalexFilterState) => {
    console.log('📥 Salex index handleApplyFilters received:', filters);

    const isSortOperation = (
      filters.customerFilter === currentFilters.customerFilter &&
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
    setPagination(prev => ({ ...prev, page: 1 }));

    if (isSortOperation) {
      console.log('🎯 Sort operation detected - fetching immediately');
      fetchSalex(undefined, filters);
    } else {
      console.log('🔄 Filter operation detected - using debounced fetch');
      debouncedFetchSalex(filters);
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
                <div className="text-red-400 font-medium">Error loading salex</div>
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

      <SalexTable
        salex={salex}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}}
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}}
        onPrintDetails={handlePrintSalex}
        sortBy={currentFilters.sortBy as 'invoice_no' | 'customer_name' | 'total' | 'invoice_date' | 'payment_status' | 'bill_reference' | 'item_count' | 'payment_mode' | 'total_tax'}
        sortOrder={currentFilters.sortOrder as 'asc' | 'desc'}
        initialFilters={{
          customerFilter: currentFilters.customerFilter,
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
            href="/salex/create"
            className="btn-primary"
          >
            Add Salex
          </Link>
        )}
      />
    </div>
  );
}
