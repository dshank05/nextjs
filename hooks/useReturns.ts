import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { usePartyRows } from './useParties';
import { readJson } from './readJson';
import SessionStorageService from '../lib/sessionStorage';

/**
 * Sale and purchase returns, one set of hooks (RETURNS_PLAN R1). Replaces the
 * return halves of useSales.ts and usePurchases.ts and the return types.
 * A customer return is a sale or an Invoice C return (`type` invoice /
 * invoicex: their ids overlap); a vendor return is a purchase return.
 */
export type ReturnParty = 'customer' | 'vendor';
export type SaleType = 'invoice' | 'invoicex';

export const RET = {
  customer: {
    label: 'Customer', plural: 'customers', nameField: 'billing_name', title: 'Sale Return',
    listUrl: '/entry/salereturn', formUrl: '/entry/salereturn-create',
    viewUrl: (id: number, type?: string | null) => `/entry/salereturn/${id}?type=${type || 'invoice'}`,
    listApi: '/api/sale-returns', createApi: '/api/sale-returns/customer-return', billsApi: '/api/sale-returns/customer-items',
    oneApi: (id: number | string, type?: string | null) => `/api/sale-returns/${id}${type ? `?type=${encodeURIComponent(type)}` : ''}`,
    partyParam: 'customer', billsPartyParam: 'customer_id', partyIdField: 'customer_id', reasonType: 'sale',
    listKey: 'saleReturns', detailKey: 'saleReturn', billsKey: 'customerReturnBills',
    sessionModule: 'sale-returns', noteWord: 'Credit Note', billWord: 'Invoice'
  },
  vendor: {
    label: 'Vendor', plural: 'vendors', nameField: 'vendor_name', title: 'Purchase Return',
    listUrl: '/entry/purchasereturn-vendor', formUrl: '/entry/purchasereturn-vendor-create',
    viewUrl: (id: number) => `/entry/purchasereturn-vendor/${id}`,
    listApi: '/api/purchase-returns', createApi: '/api/purchase-returns/vendor-return', billsApi: '/api/purchase-returns/vendor-items',
    oneApi: (id: number | string) => `/api/purchase-returns/${id}`,
    partyParam: 'vendor', billsPartyParam: 'vendor_id', partyIdField: 'vendor_id', reasonType: 'purchase',
    listKey: 'purchaseReturns', detailKey: 'purchaseReturn', billsKey: 'vendorReturnBills',
    sessionModule: 'purchase-returns', noteWord: 'Debit Note', billWord: 'Bill'
  }
} as const;

/** One set of words for the refund state everywhere (owner decision 2026-10-03). */
export const REFUND_STATUS: Record<number, { text: string; cls: string }> = {
  0: { text: 'Pending refund', cls: 'bg-yellow-600' },
  1: { text: 'Refunded', cls: 'bg-green-600' },
  2: { text: 'Partly refunded', cls: 'bg-orange-600' }
};

export { readJson };

/** 'YYYY-MM-DD' in local time from a date string, ISO string or seconds. */
export function toYmd(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === 'number' || /^\d+$/.test(String(v)) ? new Date(Number(v) * 1000) : new Date(String(v));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- list

export interface ReturnListFilters {
  page: number;
  limit: number;
  returnNo: string;
  invoiceNo: string;
  party: string;
  itemCount: string;
  dateFrom: string;
  dateTo: string;
  paymentMode: string;
  status: string;
  pf: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function useReturnList(party: ReturnParty, f: ReturnListFilters) {
  const R = RET[party];
  return useQuery({
    queryKey: [R.listKey, f],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ page: String(f.page), limit: String(f.limit), sortBy: f.sortBy, sortOrder: f.sortOrder });
      if (f.returnNo) p.set('search', f.returnNo);
      if (f.invoiceNo) p.set('uid', f.invoiceNo);
      if (f.party) p.set(R.partyParam, f.party);
      if (f.itemCount) p.set('itemCount', f.itemCount);
      if (f.dateFrom) p.set('dateFrom', f.dateFrom);
      if (f.dateTo) p.set('dateTo', f.dateTo);
      if (f.paymentMode) p.set('paymentMode', f.paymentMode);
      if (f.status && f.status !== 'all') p.set('status', f.status);
      if (f.pf && party === 'vendor') p.set('packingForwardingTotal', f.pf);
      const data = await readJson(await fetch(`${R.listApi}?${p}`, { signal }), `Failed to fetch ${R.title.toLowerCase()}s`);
      return {
        rows: (data.returns || []) as any[],
        pagination: data.pagination || { page: f.page, limit: f.limit, total: 0, totalPages: 1 }
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- lines and bills

export interface ReturnLine {
  key: string;            // the server's item id (kind-prefixed for sale lines)
  lineId: number;         // invoice_item_id / purchase_item_id
  type?: SaleType;
  productId: number;
  name: string;
  part: string;
  originalQty: number;
  already: number;
  available: number;
  fullyReturned: boolean;
  unitPrice: number;
  ceiling: number;        // the most the line can be refunded at per unit
  taxRate: number;
  stock: number | null;
  returnQty: number;
  reasonId: number;
  reason: string;
  notes: string;
  taxAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  billNo: string;
  billRef: string;
}

export interface ReturnBill {
  key: string;
  billId: number;
  type?: SaleType;
  invoiceNo: string;
  reference: string;
  date: string;
  total: number;
  hasTax: boolean;
  availableItems: number;
  totalItems: number;
  lines: ReturnLine[];
}

const n = (v: unknown) => Number(v) || 0;

export function normalizeBill(party: ReturnParty, b: any): ReturnBill {
  const type: SaleType | undefined = party === 'customer' ? (b.invoice_type === 'invoicex' ? 'invoicex' : 'invoice') : undefined;
  const billNo = String(b.invoice_no ?? '');
  return {
    key: String(b.id),
    billId: n(b.invoice_id ?? b.purchase_id ?? String(b.id).replace(/^\D+-/, '')),
    type,
    invoiceNo: billNo,
    reference: b.bill_reference || '',
    date: toYmd(b.invoice_date),
    total: n(b.total_amount),
    hasTax: party === 'customer' ? type === 'invoice' && !!b.has_tax : !!b.has_tax,
    availableItems: n(b.available_items),
    totalItems: n(b.total_items),
    lines: (b.items || []).map((i: any): ReturnLine => {
      const available = n(i.available_qty);
      return {
        key: String(i.id),
        lineId: n(i.invoice_item_id ?? i.purchase_item_id ?? i.sale_item_id ?? i.id),
        type: party === 'customer' ? (i.invoice_type === 'invoicex' ? 'invoicex' : type) : undefined,
        productId: n(i.product_id),
        name: i.product_name || i.display_name || 'Unknown Product',
        part: i.part_number || '',
        originalQty: n(i.original_qty),
        already: n(i.already_returned),
        available,
        fullyReturned: i.is_fully_returned ?? available <= 0,
        unitPrice: n(i.unit_price),
        ceiling: n(i.net_unit_price ?? i.unit_price),
        taxRate: n(i.tax_rate),
        stock: i.current_stock === undefined ? null : n(i.current_stock),
        returnQty: n(i.return_qty),
        reasonId: n(i.return_reason_id) || 1,
        reason: i.return_reason || '',
        notes: i.notes || '',
        taxAmount: n(i.tax_amount),
        cgst: n(i.cgst),
        sgst: n(i.sgst),
        igst: n(i.igst),
        billNo: String(i.bill_no ?? billNo),
        billRef: i.bill_reference && i.bill_reference !== billNo ? i.bill_reference : (b.bill_reference || '')
      };
    })
  };
}

export interface BillQuery {
  page: number;
  search: string;
  itemSearch: string;
  from: string;
  to: string;
}

/** The party's bills that still have something to return. */
export function useReturnBills(party: ReturnParty, partyId: string, q: BillQuery, enabled = true) {
  const R = RET[party];
  return useQuery({
    queryKey: [R.billsKey, partyId, q],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ [R.billsPartyParam]: partyId, page: String(q.page), limit: '50' });
      if (q.search) p.set('search', q.search);
      if (q.itemSearch && party === 'vendor') p.set('item_search', q.itemSearch);
      if (q.from && q.to) { p.set('from_date', q.from); p.set('to_date', q.to); }
      const data = await readJson(await fetch(`${R.billsApi}?${p}`, { signal }), 'Failed to load bills');
      const d = data.data || {};
      return {
        bills: ((d.bills || []) as any[]).map(b => normalizeBill(party, b)),
        pagination: d.pagination || { page: 1, totalPages: 1, total: 0, hasNext: false, hasPrev: false }
      };
    },
    enabled: enabled && !!partyId,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- detail

export interface ReturnDetail {
  party: ReturnParty;
  id: number;
  type: SaleType | null;
  returnNo: string;
  noteNo: string | null;
  date: string;
  partyId: number;
  partyName: string;
  partyState: string;
  gstin: string;
  address: string;
  totalAmount: number;
  totalTax: number;
  pf: number;
  refundAmount: number;
  paymentStatus: number;
  paymentMode: number;
  paymentDate: string;
  notes: string;
  bills: ReturnBill[];
  raw: any;
}

export function normalizeDetail(party: ReturnParty, data: any): ReturnDetail {
  const r = data.return || {};
  const who = party === 'customer' ? data.customer || {} : data.vendor || {};
  return {
    party,
    id: n(r.id),
    type: party === 'customer' ? (r.invoice_type === 'invoicex' ? 'invoicex' : 'invoice') : null,
    returnNo: r.return_no || '',
    noteNo: r.debit_note_no || null,
    date: toYmd(r.return_date),
    partyId: n(who.id),
    partyName: who.customer_name || who.billing_name || who.vendor_name || 'Other',
    partyState: who.state || '',
    gstin: who.gstin || '',
    address: who.address || '',
    totalAmount: n(r.total_amount),
    totalTax: n(r.total_tax),
    pf: n(r.packing_forwarding_amount),
    refundAmount: n(r.refund_amount),
    paymentStatus: n(r.payment_status),
    paymentMode: r.payment_mode ?? 1,
    paymentDate: toYmd(r.payment_date),
    notes: r.notes || '',
    bills: (data.bills || []).map((b: any) => normalizeBill(party, b)),
    raw: data
  };
}

/** A detail the view put in session storage for the edit screen. */
export function cachedReturn(party: ReturnParty, id: string | undefined, type: string | undefined): ReturnDetail | undefined {
  if (!id || typeof window === 'undefined') return undefined;
  const hit = SessionStorageService.get(RET[party].sessionModule, party === 'customer' ? `${type || 'invoice'}-${id}` : id) as any;
  return hit && hit.party === party && Array.isArray(hit.bills) ? hit as ReturnDetail : undefined;
}

export function useReturnDetail(party: ReturnParty, id: string | undefined, type: string | undefined, initial?: ReturnDetail) {
  const R = RET[party];
  return useQuery({
    queryKey: [R.detailKey, id, party === 'customer' ? type || null : null],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch(R.oneApi(id!, party === 'customer' ? type : undefined), { signal }), `Failed to fetch ${R.title.toLowerCase()}`);
      return normalizeDetail(party, data.data);
    },
    initialData: initial,
    enabled: !!id,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------- reasons, parties

export function useReturnReasons(party: ReturnParty) {
  const type = RET[party].reasonType;
  return useQuery({
    queryKey: ['returnReasons', type],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch(`/api/return-reasons?type=${type}`, { signal }), 'Failed to fetch return reasons');
      return (data.data || []) as { id: number; reason_name: string }[];
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });
}

/** The party dropdown: same cache as useCustomers / useVendors. */
export function useReturnParties(party: ReturnParty) {
  return usePartyRows(party);
}

// ---------------------------------------------------------------- mutations

/**
 * A return moves stock, the bill's return status, the party's balance and
 * ledger, and the reports; refreshing only the returns list left all of those
 * stale. Everything is marked stale and what is on screen refetches.
 */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSaveReturn(party: ReturnParty) {
  const R = RET[party];
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async ({ id, type, payload }: { id?: number; type?: string | null; payload: any }) => {
      const response = await fetch(id ? R.oneApi(id, party === 'customer' ? type : undefined) : R.createApi, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return readJson(response, `Failed to ${id ? 'update' : 'create'} the return`);
    },
    onSuccess: refresh
  });
}

export function useDeleteReturn(party: ReturnParty) {
  const R = RET[party];
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async ({ id, type }: { id: number; type?: string | null }) =>
      readJson(await fetch(R.oneApi(id, party === 'customer' ? type : undefined), { method: 'DELETE' }), 'Failed to delete return'),
    onSuccess: refresh
  });
}
