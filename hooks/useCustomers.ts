import { usePartyRows } from './useParties';

/** Every active customer, for dropdowns (hooks/useParties.ts usePartyRows). */
export function useCustomers() {
  return usePartyRows('customer');
}
