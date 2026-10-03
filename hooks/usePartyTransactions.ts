import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SessionStorageService from '../lib/sessionStorage';

/**
 * Customer and vendor transactions (payments and refunds), one set of hooks.
 * Replaces the transaction half of useCustomers.ts and useVendorTransactions.ts,
 * which were copies of each other. A customer PAYS us (income); we PAY a
 * vendor (expense) - `isPayment` hides that difference from the screens.
 */
export type Party = 'customer' | 'vendor';
export type Direction = 'income' | 'expense';

export const PARTY = {
  customer: {
    label: 'Customer', plural: 'customers', nameField: 'billing_name', idField: 'customer_id',
    payments: '/api/customer-payments', refunds: '/api/customer-refunds', list: '/api/customer-transactions',
    paymentDirection: 'income' as Direction,
    formUrl: '/customer-transactions/create', viewUrl: (id: number, d: Direction) => `/customer-transactions/view/${id}?type=${d}`,
    listKey: 'customerTransactions', detailKey: 'customerTransaction', billsKey: 'customerOpenBills',
    sessionModule: (isPayment: boolean) => (isPayment ? 'customer-payments' : 'customer-refunds'),
    billWord: 'invoice', billsWord: 'Invoices', paymentTypeLabel: 'Invoice Specific',
    paymentVerb: 'RECEIPT (Receive from Customer)', refundVerb: 'PAYMENT (Pay Customer)',
    paymentBanner: 'RECEIPT', refundBanner: 'PAYMENT'
  },
  vendor: {
    label: 'Vendor', plural: 'vendors', nameField: 'vendor_name', idField: 'vendor_id',
    payments: '/api/vendor-payments', refunds: '/api/vendor-refunds', list: '/api/vendor-transactions',
    paymentDirection: 'expense' as Direction,
    formUrl: '/entry/vendor-transaction', viewUrl: (id: number, d: Direction) => `/vendor-transactions/view/${id}?type=${d}`,
    listKey: 'vendorTransactions', detailKey: 'vendorTransaction', billsKey: 'vendorOpenBills',
    sessionModule: (isPayment: boolean) => (isPayment ? 'vendor-payments' : 'vendor-refunds'),
    billWord: 'bill', billsWord: 'Bills', paymentTypeLabel: 'Bill Specific',
    paymentVerb: 'PAYMENT (Pay Vendor)', refundVerb: 'RECEIPT (Receive Refund)',
    paymentBanner: 'PAYMENT', refundBanner: 'RECEIPT'
  }
} as const;

export const isPaymentDirection = (party: Party, d: Direction) => PARTY[party].paymentDirection === d;
export const directionOf = (party: Party, isPayment: boolean): Direction =>
  isPayment ? PARTY[party].paymentDirection : PARTY[party].paymentDirection === 'income' ? 'expense' : 'income';

/** The server's refusal text, whichever field it used. */
export async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || (Array.isArray(data.errors) && data.errors.join('; ')) || fallback);
  }
  return data;
}

// ---------------------------------------------------------------- list

export interface PartyTxFilters {
  partyId: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  type: 'all' | Direction;
  dateFrom?: string;
  dateTo?: string;
  payment_mode?: string;
  payment_type?: string;
}

export function usePartyTransactionList(party: Party, f: PartyTxFilters) {
  const P = PARTY[party];
  return useQuery({
    queryKey: [P.listKey, f],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(f.page), limit: String(f.limit), sortBy: f.sortBy, sortOrder: f.sortOrder, type: f.type });
      params.set(P.idField, f.partyId);
      if (f.dateFrom) params.set('dateFrom', f.dateFrom);
      if (f.dateTo) params.set('dateTo', f.dateTo);
      if (f.payment_mode) params.set('payment_mode', f.payment_mode);
      if (f.payment_type) params.set('payment_type', f.payment_type);
      const data = await readJson(await fetch(`${P.list}?${params}`, { signal }), `Failed to fetch ${party} transactions`);
      return {
        rows: (data.data || []) as any[],
        pagination: data.pagination || { page: f.page, limit: f.limit, total: 0, totalPages: 1 },
        totals: data.totals as { income: number; expense: number; net: number; count: number } | undefined
      };
    },
    enabled: !!f.partyId,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- detail

export interface TxAllocation {
  key: string;
  /** what the allocation points at */
  kind: 'sale' | 'salex' | 'purchase' | 'sale_return' | 'salex_return' | 'purchase_return';
  billId: number;
  label: string;
  href: string | null;
  kindLabel?: string;
  reference?: string | null;
  date: number;
  total: number;
  allocated: number;
  status?: number;
}

export interface TxDetail {
  id: number;
  isPayment: boolean;
  direction: Direction;
  partyRef: { id: number; name: string; contact?: string | null; email?: string | null };
  amount: number;
  date: number;
  mode: number;
  type: string;
  notes: string | null;
  fy: number;
  allocations: TxAllocation[];
  summary: { total_allocated: number; allocation_count: number; difference: number };
  raw: any;
}

export function normalizeDetail(party: Party, isPayment: boolean, raw: any): TxDetail {
  const P = PARTY[party];
  const who = raw[party] || {};
  const allocations: TxAllocation[] = (raw.allocations || []).map((a: any): TxAllocation => {
    if (party === 'customer' && isPayment) {
      const salex = !!a.invoicex_id;
      const id = salex ? a.invoicex_id : a.invoice_id;
      return { key: `${salex ? 'salex' : 'sale'}-${id}`, kind: salex ? 'salex' : 'sale', billId: id,
        label: salex ? `C-${a.invoice_no}` : `INV-${a.invoice_no}`, href: salex ? `/salex/view/${id}` : `/sale/view/${id}`,
        kindLabel: salex ? 'Invoice C' : 'Sale', date: a.invoice_date, total: Number(a.invoice_total) || 0,
        allocated: Number(a.allocated_amount) || 0, status: a.payment_status };
    }
    if (party === 'customer') {
      const salex = (a.return_type || a.type) === 'salex';
      return { key: `${salex ? 'salex' : 'sale'}_return-${a.return_id}`, kind: salex ? 'salex_return' : 'sale_return', billId: a.return_id,
        label: a.credit_note_no || `RET-${a.return_id}`,
        href: `/entry/salereturn/${a.return_id}?type=${salex ? 'invoicex' : 'invoice'}`, kindLabel: salex ? 'Invoice C' : 'Sale',
        date: a.return_date ?? a.allocation_date, total: Number(a.return_total) || 0, allocated: Number(a.allocated_amount) || 0, status: a.payment_status };
    }
    if (isPayment) {
      return { key: `purchase-${a.purchase_id}`, kind: 'purchase', billId: a.purchase_id, label: `INV-${a.invoice_no}`,
        href: `/purchases/view/${a.purchase_id}`, reference: a.bill_reference || null, date: a.invoice_date,
        total: Number(a.purchase_total) || 0, allocated: Number(a.allocated_amount) || 0, status: a.payment_status };
    }
    return { key: `purchase_return-${a.return_id}`, kind: 'purchase_return', billId: a.return_id,
      label: a.debit_note_no || a.return_no || `PR-${a.return_id}`, href: `/entry/purchasereturn-vendor/${a.return_id}`,
      date: a.return_date ?? a.allocation_date, total: Number(a.return_total) || 0, allocated: Number(a.allocated_amount) || 0, status: a.payment_status };
  });
  const amount = Number(isPayment ? raw.payment_amount : raw.refund_amount) || 0;
  const allocated = allocations.reduce((s, a) => s + a.allocated, 0);
  return {
    id: raw.id,
    isPayment,
    direction: directionOf(party, isPayment),
    partyRef: { id: who.id ?? raw[P.idField], name: who.name || who[P.nameField] || 'Unknown', contact: who.contact ?? null, email: who.email ?? null },
    amount,
    date: isPayment ? raw.payment_date : raw.refund_date,
    mode: Number(isPayment ? raw.payment_mode : raw.refund_mode) || 0,
    type: (isPayment ? raw.payment_type : raw.refund_type) || '',
    notes: raw.notes ?? null,
    fy: raw.fy,
    allocations,
    summary: raw.summary || { total_allocated: allocated, allocation_count: allocations.length, difference: amount - allocated },
    raw
  };
}

/** A detail the view put in session storage for the edit screen, if it is one of ours. */
export function cachedDetail(party: Party, id: string | undefined, direction: Direction | undefined): TxDetail | undefined {
  if (!id || !direction || typeof window === 'undefined') return undefined;
  const isPayment = isPaymentDirection(party, direction);
  const hit = SessionStorageService.get(PARTY[party].sessionModule(isPayment), id) as any;
  return hit && Array.isArray(hit.allocations) && hit.isPayment === isPayment && hit.partyRef ? hit as TxDetail : undefined;
}

export function usePartyTransaction(party: Party, id: string | undefined, direction: Direction | undefined, initial?: TxDetail) {
  const P = PARTY[party];
  return useQuery({
    initialData: initial,
    queryKey: [P.detailKey, id, direction],
    queryFn: async ({ signal }) => {
      const isPayment = isPaymentDirection(party, direction!);
      const data = await readJson(await fetch(`${isPayment ? P.payments : P.refunds}/${id}`, { signal }), 'Transaction not found');
      return normalizeDetail(party, isPayment, data.data || data.payment || data.refund);
    },
    enabled: !!id && !!direction,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- open bills

export interface OpenBill {
  key: string;
  kind: 'sale' | 'salex' | 'purchase';
  id: number;
  label: string;
  badge?: string;
  date: number;
  total: number;
  paid: number;
  outstanding: number;
}

/** The party's bills with money still owed on them (every bill when `all`). */
export function usePartyOpenBills(party: Party, partyId: number | undefined, all = false) {
  const P = PARTY[party];
  return useQuery({
    queryKey: [P.billsKey, partyId, all],
    queryFn: async ({ signal }) => {
      const sources = party === 'customer'
        ? [['sale', `/api/sales?customer=${partyId}&limit=1000&sortOrder=asc`, 'sales'], ['salex', `/api/salex?customer=${partyId}&limit=1000&sortOrder=asc`, 'salexs']]
        : [['purchase', `/api/purchases?vendor=${partyId}&limit=1000&sortOrder=asc`, 'purchases']];
      const lists = await Promise.all(sources.map(async ([kind, url, legacy]) => {
        const data = await readJson(await fetch(url, { signal }), 'Failed to load bills');
        return ((data.data || data[legacy] || []) as any[]).map(b => ({ ...b, kind }));
      }));
      return lists.flat()
        .filter((b: any) => all || Number(b.remaining_amount) > 0)
        .sort((a: any, b: any) => (a.invoice_date || 0) - (b.invoice_date || 0))
        .map((b: any): OpenBill => ({
          key: `${b.kind}-${b.id}`,
          kind: b.kind,
          id: b.id,
          label: b.kind === 'salex' ? `C-${b.invoice_no}` : b.kind === 'sale' ? `SINV-${b.invoice_no}` : String(b.invoice_no),
          badge: b.kind === 'salex' ? 'Invoice C' : undefined,
          date: b.invoice_date,
          total: Number(b.total) || 0,
          paid: Number(b.total_paid) || 0,
          outstanding: Number(b.remaining_amount) || 0
        }));
    },
    enabled: !!partyId && partyId > 0,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- mutations

/**
 * A payment or refund moves bills' paid status, the party's balance, ledger and
 * reports. A key list (the old hooks had one per party) misses whatever screen
 * it forgot, so everything is marked stale and what is on screen refetches - the
 * same rule as hooks/useReturns.ts.
 */
function useRefresh(_party: Party) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSavePartyTransaction(party: Party) {
  const P = PARTY[party];
  const refresh = useRefresh(party);
  return useMutation({
    mutationFn: async ({ id, isPayment, payload }: { id?: number; isPayment: boolean; payload: any }) => {
      const base = isPayment ? P.payments : P.refunds;
      const response = await fetch(id ? `${base}/${id}` : base, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return readJson(response, `Failed to ${id ? 'update' : 'record'} the transaction`);
    },
    onSuccess: refresh
  });
}

export function useDeletePartyTransaction(party: Party) {
  const P = PARTY[party];
  const refresh = useRefresh(party);
  return useMutation({
    mutationFn: async ({ id, direction }: { id: number; direction: Direction }) => {
      const base = isPaymentDirection(party, direction) ? P.payments : P.refunds;
      return readJson(await fetch(`${base}/${id}`, { method: 'DELETE' }), 'Failed to delete transaction');
    },
    onSuccess: refresh
  });
}

export function useCurrentFY() {
  return useQuery({
    queryKey: ['currentFY'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/financial-years', { signal });
      if (!r.ok) throw new Error('Failed to fetch financial year');
      return (await r.json()).currentFyId || 2024;
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });
}

/** The party dropdown, as { id, name }. */
export function usePartyOptions(party: Party) {
  const P = PARTY[party];
  return useQuery({
    queryKey: [P.plural],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch(`/api/${P.plural}?dropdown=true`, { signal }), `Failed to fetch ${P.plural}`);
      return (data[P.plural] || []) as any[];
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    select: (rows: any[]) => rows.map(r => ({ id: String(r.id), name: r[P.nameField] || r.name || '' }))
  });
}
