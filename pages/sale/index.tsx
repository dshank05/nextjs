import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { SaleTable } from '../../components/transactions/SaleTable';
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
  packing_forwarding_total?: number;
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

export default function SalesPage() {
  const { showSnackbar } = useSnackbar();

  type SaleFilterState = {
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

  const [currentFilters, setCurrentFilters] = useStorageState<SaleFilterState>('sales-page-filters', {
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

  const debouncedFetchSales = useCallback((filtersToUse?: typeof currentFilters) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    debounceTimeoutRef.current = setTimeout(() => {
      fetchSales(abortControllerRef.current?.signal, filtersToUse);
    }, 300);
  }, [currentFilters]);

  useEffect(() => {
    debouncedFetchSales();
  }, [pagination.page, pagination.limit, searchTerm, debouncedFetchSales]);

  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'sales' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Sale ${msg.type} in another tab, refreshing data...`);
        debouncedFetchSales();
      }
    });

    return unsubscribe;
  }, [debouncedFetchSales]);

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
        sessionStorage.removeItem('sales-page-filters');
      }
    };
  }, []);

  const fetchSales = async (signal?: AbortSignal, overrideFilters?: typeof currentFilters) => {
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      const filtersToUse = overrideFilters || currentFilters;

      const params = new URLSearchParams();
      params.append('page', pagination.page.toString());
      params.append('limit', pagination.limit.toString());
      
      if (searchTerm) params.append('search', searchTerm);
      if (filtersToUse.customerFilter) params.append('vendor', filtersToUse.customerFilter);
      if (filtersToUse.statusFilter) params.append('status', filtersToUse.statusFilter);
      if (filtersToUse.dateFrom) params.append('startDate', filtersToUse.dateFrom);
      if (filtersToUse.dateTo) params.append('endDate', filtersToUse.dateTo);
      if (filtersToUse.amountMin) params.append('amountMin', filtersToUse.amountMin);
      if (filtersToUse.amountMax) params.append('amountMax', filtersToUse.amountMax);
      if (filtersToUse.uidFilter) params.append('uid', filtersToUse.uidFilter);
      if (filtersToUse.billReference) params.append('billReference', filtersToUse.billReference);
      if (filtersToUse.itemCount) params.append('itemCount', filtersToUse.itemCount);
      if (filtersToUse.paymentMode) params.append('paymentMode', filtersToUse.paymentMode);
      if (filtersToUse.totalTax) params.append('totalTax', filtersToUse.totalTax);
      if (filtersToUse.packingForwardingTotal) params.append('packingForwardingTotal', filtersToUse.packingForwardingTotal);
      if (filtersToUse.total && !filtersToUse.amountMin) {
        params.append('amountMin', filtersToUse.total);
        params.append('amountMax', filtersToUse.total);
      }
      params.append('sortBy', filtersToUse.sortBy || 'invoice_no');
      params.append('sortOrder', filtersToUse.sortOrder || 'asc');

      console.log('🚀 Sales fetchSales - API call with params:', Object.fromEntries(params));

      const response = await fetch(`/api/sales?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sales');
      }

      const data = await response.json();

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
        packing_forwarding_total: sale.packing_forwarding_total,
        total: sale.total,
        notes: sale.notes,
        invoice_date: sale.invoice_date,
        status: sale.status,
        payment_status: sale.payment_status,
        payment_mode: sale.payment_mode,
        fy: sale.fy,
        transport: sale.transport,
        item_count: sale.item_count,
        formattedDate: sale.formattedDate,
        bill_reference: sale.bill_reference,
        return_status: sale.return_status,
        type: 'sale',
        customer_vendor_name: sale.customer_name,
        customer_vendor_address: sale.customer_address,
        customer_vendor_gstin: sale.customer_gstin
      }));

      setSales(transformedSales);
      setPagination(data.pagination);
    } catch (err) {
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

  const handlePrintSale = (transaction: Sale) => {
    console.log('Printing sale:', transaction.id);
    alert(`Print functionality for sale ${transaction.invoice_no} will be implemented`);
  };

  const handleApplyFilters = (filters: SaleFilterState) => {
    console.log('📥 Sales index handleApplyFilters received:', filters);

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
      fetchSales(undefined, filters);
    } else {
      console.log('🔄 Filter operation detected - using debounced fetch');
      debouncedFetchSales(filters);
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
        onExport={() => {}}
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}}
        onPrintDetails={handlePrintSale}
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
            href="/sale/create"
            className="btn-primary"
          >
            Add Sale
          </Link>
        )}
      />
    </div>
  );
}
