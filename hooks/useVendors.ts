import { usePartyRows } from './useParties';

/** Every active vendor, for dropdowns (hooks/useParties.ts usePartyRows). */
export function useVendors() {
  return usePartyRows('vendor');
}
