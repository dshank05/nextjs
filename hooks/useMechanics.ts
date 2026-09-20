import { useQuery } from '@tanstack/react-query';

// `dropdown=true` asks for every ACTIVE row, unpaginated (F-58).
async function fetchMechanics(signal?: AbortSignal): Promise<any[]> {
  const response = await fetch('/api/mechanics?dropdown=true', { signal });

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
