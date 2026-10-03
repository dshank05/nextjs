import { useQuery } from '@tanstack/react-query';

// Customer dropdown hook. One customer, save and status live in hooks/useParties.ts;
// payments and refunds in hooks/usePartyTransactions.ts.

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
