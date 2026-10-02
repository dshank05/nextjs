import { useQuery } from '@tanstack/react-query';
import type { Purchase, PurchaseFilters, PurchasesResponse, PurchaseReturn, PurchaseReturnFilters, PurchaseReturnsResponse } from '../types/purchases';

/**
 * List parameters, named exactly as `lib/purchase-query.ts` reads them. Four
 * of these were sent under other names (`billRef`, `items`, `taxAmount`,
 * `pf`) and silently ignored (PU-22).
 */
export function purchaseListParams(filters: PurchaseFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  };
  set('page', filters.page);
  set('limit', filters.limit);
  set('search', filters.search);
  set('vendor', filters.vendorFilter);
  if (filters.statusFilter && filters.statusFilter !== 'all') set('status', filters.statusFilter);
  set('startDate', filters.dateFrom);
  set('endDate', filters.dateTo);
  set('uid', filters.uidFilter);
  set('billReference', filters.billReference);
  set('itemCount', filters.itemCount);
  set('paymentMode', filters.paymentMode);
  set('totalTax', filters.totalTax);
  set('packingForwardingTotal', filters.packingForwardingTotal);
  // "Total" is an exact amount: the same value as both bounds.
  set('amountMin', filters.amountMin || filters.total);
  set('amountMax', filters.amountMax || (filters.amountMin ? '' : filters.total));
  set('sortBy', filters.sortBy || 'invoice_date');
  set('sortOrder', filters.sortOrder || 'desc');
  return params;
}

export async function fetchPurchases(filters: PurchaseFilters, signal?: AbortSignal): Promise<PurchasesResponse> {
  const response = await fetch(`/api/purchases?${purchaseListParams(filters)}`, { signal });
  if (!response.ok) {
    throw new Error('Failed to fetch purchases');
  }
  const data = await response.json();
  const purchases: Purchase[] = (data.data || data.purchases || []).map((purchase: any) => ({
    ...purchase,
    type: 'purchase',
    customer_vendor_name: purchase.vendor_name,
    customer_vendor_address: purchase.vendor_address,
    customer_vendor_gstin: purchase.vendor_gstin
  }));
  return { purchases, pagination: data.pagination };
}

export function usePurchases(filters: PurchaseFilters) {
  return useQuery({
    queryKey: ['purchases', filters],
    queryFn: ({ signal }) => fetchPurchases(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchPurchase(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/purchases/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch purchase');
  }

  return response.json();
}

export function usePurchase(id: string | number | undefined) {
  return useQuery({
    queryKey: ['purchase', id],
    queryFn: ({ signal }) => fetchPurchase(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchLastInvoiceNumber(signal?: AbortSignal): Promise<number> {
  const response = await fetch('/api/purchases/last-invoice', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch last invoice number');
  }

  const data = await response.json();
  const lastInvoiceNum = data.lastInvoiceNumber || 0;
  return lastInvoiceNum + 1;
}

export function useLastInvoiceNumber(enabled: boolean = true) {
  return useQuery({
    queryKey: ['lastInvoiceNumber', 'purchase'],
    queryFn: ({ signal }) => fetchLastInvoiceNumber(signal),
    enabled,
    staleTime: 0, // Always fetch fresh
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// PURCHASE RETURN QUERIES
// ============================================================================

async function fetchPurchaseReturns(filters: PurchaseReturnFilters, signal?: AbortSignal): Promise<PurchaseReturnsResponse> {
  const params = new URLSearchParams();
  
  params.append('page', filters.page.toString());
  params.append('limit', filters.limit.toString());
  
  if (filters.search) params.append('search', filters.search);
  if (filters.returnNoFilter) params.append('search', filters.returnNoFilter);
  if (filters.vendorFilter) params.append('vendor', filters.vendorFilter);
  if (filters.statusFilter && filters.statusFilter !== 'all') params.append('status', filters.statusFilter);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.amountMin) params.append('amountMin', filters.amountMin);
  if (filters.amountMax) params.append('amountMax', filters.amountMax);
  if (filters.uidFilter) params.append('uid', filters.uidFilter);
  if (filters.itemCount) params.append('itemCount', filters.itemCount);
  if (filters.paymentMode) params.append('paymentMode', filters.paymentMode);
  if (filters.packingForwardingTotal) params.append('packingForwardingTotal', filters.packingForwardingTotal);
  params.append('sortBy', filters.sortBy || 'return_no');
  params.append('sortOrder', filters.sortOrder || 'asc');

  const response = await fetch(`/api/purchase-returns?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch purchase returns');
  }

  const data = await response.json();

  // Transform API response to match our interface
  const transformedReturns: PurchaseReturn[] = (data.returns || []).map((ret: any) => ({
    id: ret.id,
    return_no: ret.return_no,
    invoice_no: ret.invoice_no,
    return_date: ret.return_date ? (() => {
      const date = new Date(ret.return_date * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    })() : '',
    vendor_id: ret.vendor_id || 0,
    vendor_name: ret.vendor_name,
    total_amount: ret.total_amount,
    total_tax: ret.total_tax,
    refund_amount: ret.refund_amount || (ret.total_amount + ret.total_tax),
    status: ret.status === 'Completed' ? 1 : 0,
    payment_status: ret.payment_status ?? 0,
    payment_mode: ret.payment_mode ?? 1,
    payment_date: ret.payment_date,
    fy: ret.fy,
    notes: ret.notes,
    item_count: ret.item_count,
    formattedDate: ret.formattedDate,
    statusText: ret.status,
    packing_forwarding_total: ret.packing_forwarding_total || 0
  }));

  return {
    returns: transformedReturns,
    pagination: data.pagination
  };
}

export function usePurchaseReturns(filters: PurchaseReturnFilters) {
  return useQuery({
    queryKey: ['purchaseReturns', filters],
    queryFn: ({ signal }) => fetchPurchaseReturns(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchPurchaseReturn(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/purchase-returns/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch purchase return');
  }

  return response.json();
}

export function usePurchaseReturn(id: string | number | undefined) {
  return useQuery({
    queryKey: ['purchaseReturn', id],
    queryFn: ({ signal }) => fetchPurchaseReturn(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Return Reasons Query
async function fetchReturnReasons(signal?: AbortSignal): Promise<any[]> {
  const response = await fetch('/api/return-reasons?type=purchase', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch return reasons');
  }

  const data = await response.json();
  return data.data || [];
}

export function useReturnReasons() {
  return useQuery({
    queryKey: ['returnReasons', 'purchase'],
    queryFn: ({ signal }) => fetchReturnReasons(signal),
    staleTime: 10 * 60 * 1000, // 10 minutes - rarely changes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Vendor Purchase Bills Query
interface VendorBillsFilters {
  vendor_id: string;
  page?: number;
  limit?: number;
  search?: string;
  item_search?: string;
  from_date?: string;
  to_date?: string;
}

async function fetchVendorPurchaseBills(filters: VendorBillsFilters, signal?: AbortSignal): Promise<any> {
  const params = new URLSearchParams({
    vendor_id: filters.vendor_id,
    page: (filters.page || 1).toString(),
    limit: (filters.limit || 50).toString(),
  });

  if (filters.search) params.append('search', filters.search);
  if (filters.item_search) params.append('item_search', filters.item_search);
  if (filters.from_date) params.append('from_date', filters.from_date);
  if (filters.to_date) params.append('to_date', filters.to_date);

  const response = await fetch(`/api/purchase-returns/vendor-items?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch vendor purchase bills');
  }

  return response.json();
}

export function useVendorPurchaseBills(filters: VendorBillsFilters) {
  return useQuery({
    queryKey: ['vendorPurchaseBills', filters],
    queryFn: ({ signal }) => fetchVendorPurchaseBills(filters, signal),
    enabled: !!filters.vendor_id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

interface CreatePurchasePayload {
  invoice_number?: string; // Optional for type compatibility, but required at runtime for POST
  bill_reference?: string;
  bill_reference_date?: string;
  staff_id?: number | null;
  date: string;
  vendor_id?: number;
  vendor_name: string;
  contact_number?: string;
  email_id?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  state_code?: number;
  gst_number?: string;
  pin_code?: string;
  transport_name?: string;
  vehicle_number?: string;
  transport_cost?: number;
  items: Array<{
    product_id: number;
    product_name: string;
    category_id?: number | null;
    subcategory_id?: number | null;
    company_id?: number | null;
    model_id?: number | null;
    car_model?: string;
    part?: string;
    qty: string;
    rate: string;
    gst_percentage?: string;
    cgst?: string;
    sgst?: string;
    igst?: string;
    tax?: string;
    total: string;
  }>;
  descriptions?: string;
  packing_forwarding_qty?: number;
  packing_forwarding_rate?: number;
  packing_forwarding_total?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  notes?: string;
  total_tax: string;
  payment_status?: number;
  payment_mode?: number;
}

interface UpdatePurchasePayload extends Omit<CreatePurchasePayload, 'invoice_number'> {}

async function createPurchase(payload: CreatePurchasePayload) {
  const response = await fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create purchase');
  }

  return response.json();
}

async function updatePurchase(id: number, payload: UpdatePurchasePayload) {
  const response = await fetch(`/api/purchases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update purchase');
  }

  return response.json();
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPurchase,
    onSuccess: (data) => {
      // Invalidate purchases list
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      
    },
  });
}

export function useUpdatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdatePurchasePayload }) => 
      updatePurchase(id, payload),
    onSuccess: (data, variables) => {
      // Invalidate purchases list
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      
      // Invalidate the specific purchase
      // String key: the view reads the id from the router, so ['purchase', 5]
      // and ['purchase', '5'] were two cache entries and the edited bill could
      // show its old figures for 30 s (PU-04).
      queryClient.invalidateQueries({ queryKey: ['purchase', String(variables.id)] });
    },
  });
}

// ============================================================================
// PURCHASE RETURN MUTATIONS
// ============================================================================

async function createPurchaseReturn(payload: any) {
  const response = await fetch('/api/purchase-returns/vendor-return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create purchase return');
  }

  return response.json();
}

async function updatePurchaseReturn(id: number | string, payload: any) {
  const response = await fetch(`/api/purchase-returns/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update purchase return');
  }

  return response.json();
}

export function useCreatePurchaseReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPurchaseReturn,
    onSuccess: (data) => {
      // Invalidate purchase returns list
      queryClient.invalidateQueries({ queryKey: ['purchaseReturns'] });
      
      // Optionally set the new return in cache
      if (data.return?.id) {
        queryClient.setQueryData(['purchaseReturn', data.return.id], data);
      }
    },
  });
}

export function useUpdatePurchaseReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: any }) => 
      updatePurchaseReturn(id, payload),
    onSuccess: (data, variables) => {
      // Invalidate purchase returns list
      queryClient.invalidateQueries({ queryKey: ['purchaseReturns'] });
      
      // Invalidate the specific return
      queryClient.invalidateQueries({ queryKey: ['purchaseReturn', variables.id] });
    },
  });
}
