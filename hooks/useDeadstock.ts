import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { readJson } from './readJson';

/**
 * Dead stock hooks (DETAILS_PLAN D4). Every change moves product stock, so after
 * a save or delete every screen refetches, not just this list.
 */
export interface Deadstock {
  id: number;
  product_id: number;
  product_name: string;
  part_no: string;
  quantity: number;
  reason: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  formatted_created_at: string;
  formatted_updated_at: string;
}

export interface DeadstockFilters {
  page: number;
  limit: number;
  search: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function useDeadstockList(f: DeadstockFilters) {
  return useQuery({
    queryKey: ['deadstock', f],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ page: String(f.page), limit: String(f.limit), sortBy: f.sortBy, sortOrder: f.sortOrder });
      if (f.search) p.set('search', f.search);
      const data = await readJson(await fetch(`/api/deadstock?${p}`, { signal }), 'Failed to fetch deadstock');
      return {
        rows: (data.deadstock || []) as Deadstock[],
        pagination: data.pagination || { page: f.page, limit: f.limit, total: 0, totalPages: 1 }
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

/** Every product with its stock, for the picker; fetched fresh each time the form opens. */
export function useStockProducts(enabled: boolean) {
  return useQuery({
    queryKey: ['products', 'deadstock-picker'],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch('/api/products?fetchAll=true', { signal }), 'Failed to load products');
      return (data.products || []) as { id: number; product_name: string; part_no?: string; stock?: number }[];
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false
  });
}

export function useSaveDeadstock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: { product_id: number; quantity: number; reason: string } }) =>
      readJson(await fetch(id ? `/api/deadstock/${id}` : '/api/deadstock', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }), `Failed to ${id ? 'update' : 'create'} deadstock`),
    onSuccess: () => qc.invalidateQueries()
  });
}

export function useDeleteDeadstock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      readJson(await fetch(`/api/deadstock/${id}`, { method: 'DELETE' }), 'Failed to delete deadstock entry'),
    onSuccess: () => qc.invalidateQueries()
  });
}
