import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useQueryClient } from '@tanstack/react-query';
import { PurchaseTable } from '../../components/transactions/PurchaseTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { usePurchases } from '../../hooks/usePurchases';
import type { Purchase } from '../../types/purchases';
import { useDebounce } from '../../hooks/useDebounce';

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

export default function PurchasesPage() {
  const queryClient = useQueryClient();

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

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const queryFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedSearchTerm,
    ...currentFilters
  }), [page, limit, debouncedSearchTerm, currentFilters]);

  const { data, isLoading, error, refetch } = usePurchases(queryFilters);

  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Purchase ${msg.type} in another tab, refreshing data...`);
        queryClient.invalidateQueries({ queryKey: ['purchases'] });
      }
    });

    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('purchases-page-filters');
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    if (data && newPage > 0 && newPage <= data.pagination.totalPages) {
      setPage(newPage);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const handlePrintPurchase = (transaction: Purchase) => {
    console.log('Printing purchase:', transaction.id);
    alert(`Print functionality for purchase ${transaction.invoice_no} will be implemented`);
  };

  const handleApplyFilters = (filters: PurchaseFilterState) => {
    console.log('📥 Purchases index handleApplyFilters received:', filters);
    setCurrentFilters(filters);
    setPage(1);
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
                <div className="text-red-300 text-sm">{error.message}</div>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <PurchaseTable
        purchases={data?.purchases || []}
        pagination={data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 }}
        loading={isLoading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}}
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}}
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
