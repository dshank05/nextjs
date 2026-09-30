import { useQuery } from '@tanstack/react-query';
import type { DeadstockFilters, DeadstockResponse } from '../types/deadstock';

// Moved out of hooks/useProducts.ts (PQ-44).

async function fetchDeadstock(filters: DeadstockFilters, signal?: AbortSignal): Promise<DeadstockResponse> {
  const params = new URLSearchParams();
  
  params.append('page', filters.page.toString());
  params.append('limit', filters.limit.toString());
  if (filters.search) params.append('search', filters.search);
  params.append('sortBy', filters.sortBy || 'created_at');
  params.append('sortOrder', filters.sortOrder || 'desc');

  const response = await fetch(`/api/deadstock?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch deadstock');
  }

  const data = await response.json();

  return {
    deadstock: data.deadstock || [],
    pagination: data.pagination || {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      totalPages: 1
    }
  };
}

export function useDeadstock(filters: DeadstockFilters) {
  return useQuery({
    queryKey: ['deadstock', filters],
    queryFn: ({ signal }) => fetchDeadstock(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
