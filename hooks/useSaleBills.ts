import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SaleKind, SaleBillRow, SaleListFilters } from '../types/sales';
import type { Pagination } from '../types/common';

/**
 * Sale and Invoice C bills - one set of hooks for both kinds.
 *
 * Replaces the bill half of hooks/useSales.ts and all of hooks/useSalex.ts,
 * which were copies that sent list filters under names the API did not read
 * (SA-20) and asked for the next number with a sort the API ignored (SA-16).
 * Query keys are unchanged so the views' cross-tab invalidation still lands.
 */

const API: Record<SaleKind, string> = { sale: '/api/sales', salex: '/api/salex' };
export const listKey = (kind: SaleKind) => (kind === 'sale' ? 'sales' : 'salex');
export const billKey = (kind: SaleKind) => (kind === 'sale' ? 'sale' : 'salex-item');

/** List parameters, named exactly as lib/sale-query.ts reads them. */
export function saleListParams(filters: SaleListFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  };
  set('page', filters.page);
  set('limit', filters.limit);
  set('search', filters.search);
  set('customer', filters.customerFilter);
  if (filters.statusFilter && filters.statusFilter !== 'all') set('status', filters.statusFilter);
  set('startDate', filters.dateFrom);
  set('endDate', filters.dateTo);
  set('uid', filters.uidFilter);
  set('billReference', filters.billReference);
  set('itemCount', filters.itemCount);
  set('paymentMode', filters.paymentMode);
  set('totalTax', filters.totalTax);
  set('packingForwardingTotal', filters.packingForwardingTotal);
  set('notes', filters.notes);
  // "Total" is an exact amount: the same value as both bounds.
  set('amountMin', filters.amountMin || filters.total);
  set('amountMax', filters.amountMax || (filters.amountMin ? '' : filters.total));
  set('sortBy', filters.sortBy || 'invoice_date');
  set('sortOrder', filters.sortOrder || 'desc');
  return params;
}

export async function fetchSaleBills(kind: SaleKind, filters: SaleListFilters, signal?: AbortSignal): Promise<{ rows: SaleBillRow[]; pagination: Pagination }> {
  const response = await fetch(`${API[kind]}?${saleListParams(filters)}`, { signal });
  if (!response.ok) throw new Error(`Failed to fetch ${kind === 'sale' ? 'sales' : 'Invoice C bills'}`);
  const data = await response.json();
  return { rows: data.data || [], pagination: data.pagination };
}

export function useSaleBills(kind: SaleKind, filters: SaleListFilters) {
  return useQuery({
    queryKey: [listKey(kind), filters],
    queryFn: ({ signal }) => fetchSaleBills(kind, filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });
}

export function useSaleBill(kind: SaleKind, id: string | number | undefined) {
  return useQuery({
    // String key, to match the view's router id (PU-04).
    queryKey: [billKey(kind), id === undefined ? undefined : String(id)],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API[kind]}/${id}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch the bill');
      return response.json();
    },
    enabled: id !== undefined && id !== null && id !== '',
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || 'The request failed');
  return result;
}

export function useCreateSaleBill(kind: SaleKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => send(API[kind], 'POST', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [listKey(kind)] });
      queryClient.invalidateQueries({ queryKey: ['nextSaleNumber', kind] });
    }
  });
}

export function useUpdateSaleBill(kind: SaleKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => send(`${API[kind]}/${id}`, 'PUT', payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [listKey(kind)] });
      queryClient.invalidateQueries({ queryKey: [billKey(kind), String(variables.id)] });
    }
  });
}

export function useDeleteSaleBill(kind: SaleKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => send(`${API[kind]}/${id}`, 'DELETE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [listKey(kind)] })
  });
}

/** The number the next bill will get, from the counter's own year (SA-16). */
export function useNextSaleNumber(kind: SaleKind, enabled = true) {
  return useQuery({
    queryKey: ['nextSaleNumber', kind],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API[kind]}/last-invoice`, { signal });
      if (!response.ok) throw new Error('Failed to fetch the next invoice number');
      const data = await response.json();
      return Number(data.nextInvoiceNumber) || 1;
    },
    enabled,
    staleTime: 0,
    gcTime: 60 * 1000,
    refetchOnWindowFocus: false
  });
}
