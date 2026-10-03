import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Customer hooks. Payments and refunds live in hooks/usePartyTransactions.ts.

async function fetchCustomer(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/customers/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer');
  }

  return response.json();
}

export function useCustomer(id: string | number | undefined) {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: ({ signal }) => fetchCustomer(id!, signal),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function updateCustomerStatus({ id, status }: { id: string; status: string }) {
  const response = await fetch(`/api/customers/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, confirmed: true })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to update customer status');
  }

  return result;
}

export function useUpdateCustomerStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomerStatus,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Customer dropdown list.
//
// This used to live in hooks/useStaff.ts, which is why three unrelated pages
// imported `useCustomers` from a file named after staff. Its natural home is
// here, beside the other customer hooks (G-03).
// ---------------------------------------------------------------------------

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
