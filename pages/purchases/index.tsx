import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useQueryClient } from '@tanstack/react-query';
import { PurchaseTable, EMPTY_PURCHASE_FILTERS, type PurchaseListFilters } from '../../components/transactions/PurchaseTable';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import { usePurchases, fetchPurchases } from '../../hooks/usePurchases';
import { useDebounce } from '../../hooks/useDebounce';
import type { PurchaseFilters } from '../../types/purchases';

/**
 * The purchase list. Filters and page persist together in session storage, as
 * on the product list (F-65): they were saved and then deleted on unmount, so
 * coming back from a bill lost them, and a new filter left the page where it
 * was (PU-24).
 */
const LIMIT = 50;

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useStorageState<PurchaseListFilters>('purchases-page-filters', {
    defaultValue: EMPTY_PURCHASE_FILTERS,
    storage: 'session'
  });
  const [page, setPage] = useStorageState<number>('purchases-page-number', { defaultValue: 1, storage: 'session' });

  // Typed filters settle before they query; the page is part of what they reset.
  const settled = useDebounce(filters, 300);
  const query: PurchaseFilters = useMemo(() => ({ ...settled, page, limit: LIMIT }), [settled, page]);
  const { data, isLoading, error, refetch } = usePurchases(query);
  const purchases = data?.purchases || [];
  const pagination = data?.pagination
    ? { hasMore: false, ...data.pagination }
    : { page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false };

  useEffect(() => subscribeBroadcast((msg) => {
    if (msg.resource === 'purchases' && ['created', 'updated', 'deleted'].includes(msg.type)) {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    }
  }), [queryClient]);

  // A remembered page past the end of the current results goes back to 1.
  useEffect(() => {
    if (!isLoading && pagination.totalPages > 0 && page > pagination.totalPages) setPage(1);
  }, [isLoading, pagination.totalPages, page, setPage]);

  const changeFilters = (patch: Partial<PurchaseListFilters>) => {
    setFilters({ ...filters, ...patch });
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
            <button onClick={() => refetch()} className="btn-secondary text-red-400 text-sm py-1 px-3">Retry</button>
          </div>
        </div>
      )}

      <PurchaseTable
        purchases={purchases}
        pagination={pagination}
        loading={isLoading}
        filters={filters}
        onFiltersChange={changeFilters}
        onPageChange={(next) => { if (next > 0 && next <= pagination.totalPages) setPage(next); }}
        onDeleted={(purchase) => {
          // Same filters means the same query key; without this the deleted row stayed (PU-37).
          queryClient.invalidateQueries({ queryKey: ['purchases'] });
          broadcast({ type: 'deleted', resource: 'purchases', data: { id: purchase.id } });
        }}
        fetchAllForExport={async () => (await fetchPurchases({ ...settled, page: 1, limit: 1000 })).purchases}
        actionButton={<Link href="/purchases/create" className="btn-primary">Add Purchase</Link>}
      />
    </div>
  );
}
