import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { readJson } from './readJson';

/**
 * Customer and vendor master records, one set of hooks (DETAILS_PLAN D2).
 * The dropdown hooks (useCustomers / useVendors) stay where they are; this is
 * the details list, one record, save, status and delete.
 */
export type PartyKind = 'customer' | 'vendor';

export const PARTY_UI = {
  customer: {
    label: 'Customer', plural: 'customers', api: '/api/customers', nameField: 'billing_name',
    listUrl: '/entry/customerdetails', formUrl: '/customers/create', viewUrl: (id: string | number) => `/customers/view/${id}`,
    gstLabel: 'GSTIN', gstField: 'billing_gstin', cityField: 'billing_city', stateField: 'billing_state', stateCodeField: 'billing_state_code',
    icon: '👤', emptyIcon: '👥', ledgerUrl: '/reports/customer-ledger', ledgerKey: 'customer-ledger-party',
    txUrl: '/customer-transactions', txKey: 'customer-transactions-customer'
  },
  vendor: {
    label: 'Vendor', plural: 'vendors', api: '/api/vendors', nameField: 'vendor_name',
    listUrl: '/entry/vendordetails', formUrl: '/vendors/create', viewUrl: (id: string | number) => `/vendors/view/${id}`,
    gstLabel: 'GST ID', gstField: 'tax_id', cityField: 'city', stateField: 'state', stateCodeField: 'state_code',
    icon: '🏭', emptyIcon: '🏢', ledgerUrl: '/reports/vendor-ledger', ledgerKey: 'vendor-ledger-party',
    txUrl: '/vendor-transactions', txKey: 'vendor-transactions-vendor'
  }
} as const;

export { readJson };

export interface PartyListFilters {
  page: number;
  limit: number;
  search: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function usePartyList(kind: PartyKind, f: PartyListFilters) {
  const P = PARTY_UI[kind];
  return useQuery({
    queryKey: [`${kind}Details`, f],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ page: String(f.page), limit: String(f.limit), sortBy: f.sortBy, sortOrder: f.sortOrder });
      if (f.search) p.set('search', f.search);
      const data = await readJson(await fetch(`${P.api}?${p}`, { signal }), `Failed to fetch ${P.plural}`);
      return { rows: (data[P.plural] || []) as any[], pagination: data.pagination || { page: 1, limit: f.limit, total: 0, totalPages: 1 } };
    },
    placeholderData: keepPreviousData,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

export function useParty(kind: PartyKind, id: string | undefined) {
  const P = PARTY_UI[kind];
  return useQuery({
    queryKey: [kind, id],
    queryFn: async ({ signal }) => readJson(await fetch(`${P.api}/${id}`, { signal }), `${P.label} not found`),
    enabled: !!id,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

/**
 * Every active customer or vendor, for dropdowns - the one fetch behind
 * useCustomers, useVendors, usePartyOptions and useReturnParties (they were four
 * copies on the same query key).
 */
export function usePartyRows(kind: PartyKind) {
  const P = PARTY_UI[kind];
  return useQuery({
    queryKey: [P.plural],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch(`${P.api}?dropdown=true`, { signal }), `Failed to fetch ${P.plural}`);
      return (data[P.plural] || []) as any[];
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false
  });
}

/** After any change: the party is in dropdowns, bills and reports, so everything refetches. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSaveParty(kind: PartyKind) {
  const P = PARTY_UI[kind];
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: any }) =>
      readJson(await fetch(id ? `${P.api}/${id}` : P.api, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }), `Failed to ${id ? 'update' : 'create'} ${kind}`),
    onSuccess: refresh
  });
}

export function usePartyStatus(kind: PartyKind) {
  const P = PARTY_UI[kind];
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'Active' | 'Inactive' }) =>
      readJson(await fetch(`${P.api}/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, confirmed: true })
      }), `Failed to update ${kind} status`),
    onSuccess: refresh
  });
}
