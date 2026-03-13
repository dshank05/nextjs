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

// Mechanics Hook
async function fetchMechanics(signal?: AbortSignal): Promise<any[]> {
  const response = await fetch('/api/mechanics', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch mechanics');
  }

  const data = await response.json();
  return data.mechanics || [];
}

export function useMechanics() {
  return useQuery({
    queryKey: ['mechanics'],
    queryFn: ({ signal }) => fetchMechanics(signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Customers Hook
async function fetchCustomers(signal?: AbortSignal): Promise<any[]> {
  const response = await fetch('/api/customers?dropdown=true', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customers');
  }

  const data = await response.json();
  return data.customers || [];
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: ({ signal }) => fetchCustomers(signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
