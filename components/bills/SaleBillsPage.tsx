import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useQueryClient } from '@tanstack/react-query';
import { SaleBillTable, EMPTY_SALE_FILTERS, type SaleListFilterState } from './SaleBillTable';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import { useSaleBills, fetchSaleBills, listKey } from '../../hooks/useSaleBills';
import { useDebounce } from '../../hooks/useDebounce';
import type { SaleKind, SaleListFilters } from '../../types/sales';

/**
 * The sale / Invoice C list page. Filters and page persist together in session
 * storage, as on the purchase list: they used to be deleted on unmount, so
 * coming back from a bill lost them.
 */
const LIMIT = 50;
const RESOURCE: Record<SaleKind, string> = { sale: 'sales', salex: 'salex' };

export function SaleBillsPage({ kind }: { kind: SaleKind }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useStorageState<SaleListFilterState>(`${kind}-page-filters`, {
    defaultValue: EMPTY_SALE_FILTERS,
    storage: 'session'
  });
  const [page, setPage] = useStorageState<number>(`${kind}-page-number`, { defaultValue: 1, storage: 'session' });

  const settled = useDebounce(filters, 300);
  const query: SaleListFilters = useMemo(() => ({ ...settled, page, limit: LIMIT }), [settled, page]);
  const { data, isLoading, error, refetch } = useSaleBills(kind, query);
  const rows = data?.rows || [];
  const pagination = data?.pagination
    ? { hasMore: false, ...data.pagination }
    : { page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false };

  useEffect(() => subscribeBroadcast((msg) => {
    if (msg.resource === RESOURCE[kind] && ['created', 'updated', 'deleted'].includes(msg.type)) {
      queryClient.invalidateQueries({ queryKey: [listKey(kind)] });
    }
  }), [queryClient, kind]);

  useEffect(() => {
    if (!isLoading && pagination.totalPages > 0 && page > pagination.totalPages) setPage(1);
  }, [isLoading, pagination.totalPages, page, setPage]);

  const changeFilters = (patch: Partial<SaleListFilterState>) => {
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
                <div className="text-red-400 font-medium">Error loading bills</div>
                <div className="text-red-300 text-sm">{(error as Error).message}</div>
              </div>
            </div>
            <button onClick={() => refetch()} className="btn-secondary text-red-400 text-sm py-1 px-3">Retry</button>
          </div>
        </div>
      )}

      <SaleBillTable
        kind={kind}
        rows={rows}
        pagination={pagination}
        loading={isLoading}
        filters={filters}
        onFiltersChange={changeFilters}
        onPageChange={(next) => { if (next > 0 && next <= pagination.totalPages) setPage(next); }}
        onDeleted={(row) => {
          queryClient.invalidateQueries({ queryKey: [listKey(kind)] });
          broadcast({ type: 'deleted', resource: RESOURCE[kind] as any, data: { id: row.id } });
        }}
        fetchAllForExport={async () => (await fetchSaleBills(kind, { ...settled, page: 1, limit: 1000 })).rows}
        actionButton={<Link href={`/${kind}/create`} className="btn-primary">{kind === 'sale' ? 'Add Sale' : 'Add Invoice C'}</Link>}
      />
    </div>
  );
}
