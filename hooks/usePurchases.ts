import { useQuery } from '@tanstack/react-query';
import type { Purchase, PurchaseFilters, PurchasesResponse } from '../types/purchases';

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
