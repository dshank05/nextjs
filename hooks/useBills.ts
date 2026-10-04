import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { readJson } from './readJson';

/**
 * Purchase, Sale and Invoice C bills - one set of hooks (BILLS_PLAN B2).
 * Replaces hooks/usePurchases.ts and hooks/useSaleBills.ts. Query keys are the
 * ones those used ('purchases' / 'sales' / 'salex' for lists, 'purchase' /
 * 'sale' / 'salex-item' for one bill), so anything still invalidating them lands.
 * After a save or delete every query refetches: a bill moves stock, the ledger,
 * outstanding and payment screens, not just its own list.
 */
export type BillKind = 'purchase' | 'sale' | 'salex';

export const BILL = {
  purchase: {
    title: 'Purchase', noun: 'purchases', party: 'vendor' as const, partyLabel: 'Vendor', partyParam: 'vendor',
    api: '/api/purchases', listKey: 'purchases', docKey: 'purchase', resource: 'purchases',
    listUrl: '/purchases', viewUrl: '/purchases/view', formUrl: '/purchases/create',
    viewTitle: 'Purchase', numberLabel: 'INVOICE NUMBER', addLabel: 'Add Purchase', reportFile: 'Purchase_Report',
    taxFree: false, discount: false, banner: 'bg-blue-900/20 border-blue-700/50', bannerText: 'text-blue-100',
    returnCreate: (id: number) => `/entry/purchasereturn-vendor-create?purchase=${id}`,
    returnView: (id: number) => `/entry/purchasereturn-vendor/${id}`
  },
  sale: {
    title: 'Sale', noun: 'sales', party: 'customer' as const, partyLabel: 'Customer', partyParam: 'customer',
    api: '/api/sales', listKey: 'sales', docKey: 'sale', resource: 'sales',
    listUrl: '/sale', viewUrl: '/sale/view', formUrl: '/sale/create',
    viewTitle: 'Sales Invoice', numberLabel: 'INVOICE NUMBER', addLabel: 'Add Sale', reportFile: 'Sales_Report',
    taxFree: false, discount: true, banner: 'bg-green-900/20 border-green-700/50', bannerText: 'text-green-100',
    returnCreate: (id: number) => `/entry/salereturn-create?invoice=${id}&type=invoice`,
    returnView: (id: number) => `/entry/salereturn/${id}?type=invoice`
  },
  salex: {
    title: 'Invoice C', noun: 'Invoice C bills', party: 'customer' as const, partyLabel: 'Customer', partyParam: 'customer',
    api: '/api/salex', listKey: 'salex', docKey: 'salex-item', resource: 'salex',
    listUrl: '/salex', viewUrl: '/salex/view', formUrl: '/salex/create',
    viewTitle: 'Invoice C', numberLabel: 'INVOICE C NUMBER', addLabel: 'Add Invoice C', reportFile: 'Invoice_C_Report',
    taxFree: true, discount: true, banner: 'bg-blue-900/20 border-blue-700/50', bannerText: 'text-blue-100',
    returnCreate: (id: number) => `/entry/salereturn-create?invoice=${id}&type=invoicex`,
    returnView: (id: number) => `/entry/salereturn/${id}?type=invoicex`
  }
} as const;

// ------------------------------------------------------------------ list

export interface BillListFilterState {
  partyFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  uidFilter: string;
  billReference: string;
  itemCount: string;
  paymentMode: string;
  total: string;
  totalTax: string;
  packingForwardingTotal: string;
  notes: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

/** All three lists open newest first (owner, 2026-10-03: purchase too). */
export const EMPTY_BILL_FILTERS: BillListFilterState = {
  partyFilter: '', statusFilter: 'all', dateFrom: '', dateTo: '', uidFilter: '', billReference: '', itemCount: '',
  paymentMode: '', total: '', totalTax: '', packingForwardingTotal: '', notes: '', sortBy: 'invoice_date', sortOrder: 'desc'
};

export interface BillRow {
  id: number;
  invoice_no: number;
  bill_reference: string;
  bill_reference_date: string | null;
  party_name: string;
  item_count: number;
  total: number;
  total_tax: number;
  packing_forwarding_total: number;
  invoice_date: number;
  payment_mode: number | null;
  payment_status: number | null;
  return_status: number;
  notes: string;
}

/** List parameters, named exactly as lib/purchase-query.ts and lib/sale-query.ts read them. */
export function billListParams(kind: BillKind, f: BillListFilterState & { page: number; limit: number }): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  };
  set('page', f.page);
  set('limit', f.limit);
  set(BILL[kind].partyParam, f.partyFilter);
  if (f.statusFilter && f.statusFilter !== 'all') set('status', f.statusFilter);
  set('startDate', f.dateFrom);
  set('endDate', f.dateTo);
  set('uid', f.uidFilter);
  set('billReference', f.billReference);
  set('itemCount', f.itemCount);
  set('paymentMode', f.paymentMode);
  set('totalTax', f.totalTax);
  set('packingForwardingTotal', f.packingForwardingTotal);
  if (kind !== 'purchase') set('notes', f.notes);
  // "Total" is an exact amount: the same value as both bounds.
  set('amountMin', f.total);
  set('amountMax', f.total);
  set('sortBy', f.sortBy || 'invoice_date');
  set('sortOrder', f.sortOrder || 'desc');
  return params;
}

const toRow = (r: any): BillRow => ({
  id: r.id,
  invoice_no: r.invoice_no,
  bill_reference: r.bill_reference || '',
  bill_reference_date: r.bill_reference_date || null,
  party_name: r.vendor_name ?? r.customer_name ?? '',
  item_count: Number(r.item_count) || 0,
  total: Number(r.total) || 0,
  total_tax: Number(r.total_tax) || 0,
  packing_forwarding_total: Number(r.packing_forwarding_total) || 0,
  invoice_date: r.invoice_date,
  payment_mode: r.payment_mode ?? null,
  payment_status: r.payment_status ?? null,
  return_status: Number(r.return_status) || 0,
  notes: r.notes || ''
});

export async function fetchBills(kind: BillKind, f: BillListFilterState & { page: number; limit: number }, signal?: AbortSignal) {
  const B = BILL[kind];
  const data = await readJson(await fetch(`${B.api}?${billListParams(kind, f)}`, { signal }), `Failed to fetch ${B.noun}`);
  const rows = (data.data || data.purchases || []).map(toRow) as BillRow[];
  return { rows, pagination: data.pagination || { page: f.page, limit: f.limit, total: rows.length, totalPages: 1, hasMore: false } };
}

/**
 * Every bill the filters match, for "Export all" (B-12): the API caps a page at 1,000 rows, so
 * the export asked for one page and silently stopped at the newest 1,000. Pages through instead.
 */
export async function fetchAllBills(kind: BillKind, f: BillListFilterState) {
  const limit = 1000;
  const first = await fetchBills(kind, { ...f, page: 1, limit });
  const rows = [...first.rows];
  const pages = Math.max(1, Number(first.pagination?.totalPages) || 1);
  for (let page = 2; page <= pages; page++) rows.push(...(await fetchBills(kind, { ...f, page, limit })).rows);
  return rows;
}

export function useBillList(kind: BillKind, f: BillListFilterState & { page: number; limit: number }) {
  return useQuery({
    queryKey: [BILL[kind].listKey, f],
    queryFn: ({ signal }) => fetchBills(kind, f, signal),
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

// ------------------------------------------------------------------ one bill

export interface BillParty {
  id: number;
  name: string;
  contact: string;
  email: string;
  gstin: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  state_code: number | null;
  pin_code: string;
}

export interface BillItem {
  id: number;
  line_id: number;
  product_id: number;
  product_name: string;
  display_name: string;
  part: string;
  hsn: string;
  car_model: string;
  model_id: number | null;
  company_id: number | null;
  qty: number;
  rate: number;
  discount: number;
  gst_percentage: number;
  subtotal: number;
  tax: number;
  total: number;
  original_qty: number;
  returned_qty: number;
  is_fully_returned: boolean;
}

export interface BillReturn {
  id: number;
  return_no: string;
  return_date: number;
  amount: number;
  refund_amount: number;
  payment_status: number;
  payment_mode: number | null;
  notes: string;
  multi_bill: { bills: number; refund: number } | null;
  items: { name: string; part: string; qty: number; unit_price: number; tax: number; total: number }[];
}

export interface Bill {
  kind: BillKind;
  id: number;
  invoice_no: number;
  invoice_date: number;
  fy: number;
  party: BillParty;
  bill_reference: string;
  bill_reference_date: string;
  staff_id: number | null;
  staff_name: string;
  mechanic_id: number | null;
  mechanic_name: string;
  commission: number;
  transport_name: string;
  vehicle_number: string;
  freight: number;
  descriptions: string;
  notes: string;
  items_total: number;
  discount: number;
  packing_qty: number;
  packing_rate: number;
  packing_total: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_tax: number;
  total: number;
  payment_status: number;
  payment_mode: number | null;
  return_status: { has_returns: boolean; fully_returned_items: number; total_items: number; is_fully_returned: boolean; status: string };
  returns: BillReturn[];
  payment_summary: { total_bill: number; total_paid: number; remaining_amount: number; payment_count: number } | null;
  payment_history: any[];
  items: BillItem[];
  /** The API's own object, for the export layouts that read it. */
  raw: any;
}

const n = (v: any) => Number(v) || 0;

/** lib/purchase-read.ts and lib/sale-read.ts, as one shape. */
export function normalizeBill(kind: BillKind, d: any): Bill {
  const isPurchase = kind === 'purchase';
  // Purchase: the bill's own snapshot (bill_to) first, the vendor block after, as the old form read it.
  const b = d.bill_to || {};
  const v = d.vendor || {};
  const pick = (snap: any, master: any) => (snap !== undefined && snap !== null ? snap : master);
  const party: BillParty = isPurchase
    ? {
        id: d.vendor_id ?? 0,
        name: pick(b.vendor_name, v.vendor_name) || '',
        contact: pick(b.contact_no, v.contact_no) || '',
        email: pick(b.email, v.email) || '',
        gstin: pick(b.gstin, v.tax_id) || '',
        address: pick(b.address, v.address) || '',
        address_2: pick(b.address2, v.address_2) || '',
        city: pick(b.city, v.city) || '',
        state: pick(b.state, v.state) || '',
        state_code: pick(b.state_code, v.state_code) ?? null,
        pin_code: pick(b.pin_code, v.pin_code) || ''
      }
    : {
        id: d.customer_id ?? d.select_customer ?? 0, name: d.customer_name || '', contact: d.contact_number || '', email: d.email_id || '',
        gstin: d.gst_number || '', address: d.address || '', address_2: d.address_2 || '', city: d.city || '', state: d.state || '',
        state_code: d.state_code ?? null, pin_code: ''
      };
  const items: BillItem[] = (d.items || []).map((i: any) => {
    const subtotal = n(i.subtotal);
    const tax = n(i.tax);
    return {
      id: i.id, line_id: i.line_id ?? i.id, product_id: i.product_id,
      product_name: i.product_name || i.name_of_product || '', display_name: i.display_name || i.product_name || i.name_of_product || '',
      part: i.part || '', hsn: i.hsn || '', car_model: i.car_model || '', model_id: i.model_id ?? null, company_id: i.company_id ?? null,
      qty: n(i.qty), rate: n(i.rate), discount: n(i.discount), gst_percentage: n(i.gst_percentage),
      // Stored figures: what the server computed and rounded, never re-derived here.
      subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100,
      original_qty: n(i.original_qty ?? i.qty), returned_qty: n(i.returned_qty), is_fully_returned: !!i.is_fully_returned
    };
  });
  const returns: BillReturn[] = (d.returns || []).map((r: any) => ({
    id: r.id,
    return_no: r.return_no,
    return_date: r.return_date,
    amount: isPurchase ? n(r.this_bill_total) : n(r.total_amount),
    refund_amount: n(r.refund_amount),
    payment_status: n(r.payment_status),
    payment_mode: r.payment_mode ?? null,
    notes: r.notes || '',
    multi_bill: isPurchase && r.is_multi_bill_return ? { bills: n(r.total_bills_count), refund: n(r.refund_amount) } : null,
    items: (r.items || []).map((it: any) => {
      const qty = n(it.return_qty ?? it.qty);
      const price = n(it.unit_price ?? it.rate);
      const tax = n(it.tax_amount);
      return { name: it.display_name || it.product_name || '', part: it.part_number || '', qty, unit_price: price, tax, total: Math.round((qty * price + tax) * 100) / 100 };
    })
  }));
  return {
    kind,
    id: d.id,
    invoice_no: n(d.invoice_no ?? d.invoice_number),
    invoice_date: n(d.invoice_date ?? d.date),
    fy: n(d.fy),
    party,
    bill_reference: d.bill_reference || '',
    bill_reference_date: d.bill_reference_date || '',
    staff_id: d.staff_id ?? null,
    staff_name: d.staff?.name || d.staff_details || '',
    mechanic_id: d.mechanic_id ?? null,
    mechanic_name: d.mechanic?.name || '',
    commission: n(d.commission),
    transport_name: d.transport_name || d.transportDetails?.trans_mode || '',
    vehicle_number: d.vehicle_number || d.transportDetails?.vehicle_no || '',
    freight: n(d.freight ?? d.transport_cost),
    descriptions: d.descriptions || '',
    notes: d.notes || '',
    items_total: n(d.items_total),
    discount: n(d.discount),
    packing_qty: n(d.packing_forwarding_qty),
    packing_rate: n(d.packing_forwarding_rate),
    packing_total: n(d.packing_forwarding_total),
    total_cgst: n(d.total_cgst),
    total_sgst: n(d.total_sgst),
    total_igst: n(d.total_igst),
    total_tax: n(d.total_tax),
    total: n(d.total),
    payment_status: n(d.payment_status),
    payment_mode: d.payment_mode ?? null,
    return_status: d.return_status && typeof d.return_status === 'object'
      ? d.return_status
      : { has_returns: false, fully_returned_items: 0, total_items: items.length, is_fully_returned: false, status: 'NO_RETURNS' },
    returns,
    payment_summary: d.payment_summary || null,
    payment_history: d.payment_history || [],
    items,
    raw: d
  };
}

export function useBill(kind: BillKind, id: string | number | undefined) {
  return useQuery({
    // String key, to match the view's router id (PU-04).
    queryKey: [BILL[kind].docKey, id === undefined ? undefined : String(id)],
    queryFn: async ({ signal }) => normalizeBill(kind, await readJson(await fetch(`${BILL[kind].api}/${id}`, { signal }), `${BILL[kind].title} not found`)),
    enabled: id !== undefined && id !== null && id !== '',
    staleTime: 30000,
    refetchOnWindowFocus: false
  });
}

/** The number the next bill will get, from the counter's own year. */
export function useNextBillNumber(kind: BillKind, enabled = true) {
  return useQuery({
    queryKey: ['nextBillNumber', kind],
    queryFn: async ({ signal }) => {
      const data = await readJson(await fetch(`${BILL[kind].api}/last-invoice`, { signal }), 'Failed to fetch the next invoice number');
      return Number(data.nextInvoiceNumber) || (Number(data.lastInvoiceNumber) || 0) + 1;
    },
    enabled,
    staleTime: 0,
    gcTime: 60 * 1000,
    refetchOnWindowFocus: false
  });
}

// ------------------------------------------------------------------ changes

async function send(url: string, method: string, body: unknown, fallback: string) {
  return readJson(await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }), fallback);
}

/** Create (no id) or update. Resolves to the bill's id. */
export function useSaveBill(kind: BillKind) {
  const qc = useQueryClient();
  const B = BILL[kind];
  return useMutation({
    mutationFn: async ({ id, payload }: { id?: number; payload: any }) => {
      const data = await send(id ? `${B.api}/${id}` : B.api, id ? 'PUT' : 'POST', payload, `Failed to ${id ? 'update' : 'create'} ${B.title}`);
      return (id ?? data?.purchase?.id ?? data?.data?.id ?? data?.sale?.id) as number | undefined;
    },
    onSuccess: () => qc.invalidateQueries()
  });
}

export function useDeleteBill(kind: BillKind) {
  const qc = useQueryClient();
  const B = BILL[kind];
  return useMutation({
    mutationFn: (id: number) => send(`${B.api}/${id}`, 'DELETE', undefined, `Failed to delete ${B.title}`),
    onSuccess: () => qc.invalidateQueries()
  });
}
