import { useQuery } from '@tanstack/react-query';

export interface BusinessDetails {
  id: number;
  gstin: string;
  name: string;
  tagline?: string | null;
  address_line_1: string;
  address_line_2?: string | null;
  pin_code?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  fax?: string | null;
  terms?: string | null;
}

async function fetchBusinessDetails(signal?: AbortSignal): Promise<BusinessDetails | null> {
  const response = await fetch('/api/business-details', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch business details');
  }

  const data = await response.json();
  // The endpoint answers {} when nothing is configured yet.
  return Object.keys(data).length === 0 ? null : (data as BusinessDetails);
}

/**
 * The business's own details, including the GSTIN.
 *
 * Six screens were each doing their own bare fetch('/api/business-details').
 * More importantly, pages/sale/create.tsx was not fetching it at all - it read
 * the supplier state code from NEXT_PUBLIC_BUSINESS_GSTIN, an environment
 * variable that is set nowhere, so it always fell through to a hardcoded 9.
 * Editing the GSTIN in settings changed nothing on the page that needs it most.
 */
export function useBusinessDetails() {
  return useQuery({
    queryKey: ['business-details'],
    queryFn: ({ signal }) => fetchBusinessDetails(signal),
    staleTime: 30 * 60 * 1000, // 30 minutes - rarely changes
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
