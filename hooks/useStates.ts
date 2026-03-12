import { useQuery } from '@tanstack/react-query';

interface State {
  id: string;
  name: string;
  code: number;
}

async function fetchStates(signal?: AbortSignal): Promise<State[]> {
  const response = await fetch('/api/states', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch states');
  }

  const data = await response.json();
  // Transform states data to match SearchableSelect format
  return data.states.map((state: any) => ({
    id: state.id.toString(),
    name: state.state_name || state.name,
    code: state.code
  }));
}

export function useStates() {
  return useQuery({
    queryKey: ['states'],
    queryFn: ({ signal }) => fetchStates(signal),
    staleTime: 30 * 60 * 1000, // 30 minutes - rarely changes
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
