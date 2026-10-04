import { useQueryClient } from '@tanstack/react-query';

/**
 * The shared react-query caches that Settings masters feed (E-08).
 *
 * The settings screens save with plain fetch and refresh only their own list,
 * while the bill and party forms read these caches - states and the business
 * details for 30 minutes, mechanics and staff for 5. A state added in Settings
 * was missing from the party / bill pickers; a corrected business GSTIN kept
 * deciding CGST/SGST vs IGST from the old one; a new mechanic was not in the
 * bill form. Each settings save now marks its cache stale.
 *
 * Keys are the ones the hooks use: useStates, useBusinessDetails,
 * useMechanics, useStaff.
 */
export const SHARED_CACHE_KEYS = {
  states: ['states'],
  businessDetails: ['business-details'],
  mechanics: ['mechanics'],
  staff: ['staff']
} as const;

export type SharedCache = keyof typeof SHARED_CACHE_KEYS;

export function useRefreshSharedCache(cache: SharedCache) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [...SHARED_CACHE_KEYS[cache]] });
}
