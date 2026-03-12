import { useQuery } from '@tanstack/react-query';
import type { Staff } from '../types/staff';

async function fetchStaff(signal?: AbortSignal): Promise<Staff[]> {
  const response = await fetch('/api/staff', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch staff');
  }

  const data = await response.json();
  return data.staff || [];
}

export function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: ({ signal }) => fetchStaff(signal),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
