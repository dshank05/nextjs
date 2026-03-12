import { useQuery } from '@tanstack/react-query';
import type { Vendor } from '../types/vendors';

async function fetchVendors(signal?: AbortSignal): Promise<Vendor[]> {
  const response = await fetch('/api/vendors?dropdown=true', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch vendors');
  }

  const data = await response.json();
  return data.vendors || [];
}

export function useVendors() {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: ({ signal }) => fetchVendors(signal),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
