/**
 * Sale RETURN hooks (Phase 6 territory). The bill hooks - list, one bill,
 * create / update / delete, next number - moved to hooks/useSaleBills.ts,
 * one set for sale and Invoice C.
 */

// ============================================================================
// SALE RETURN HOOKS
// ============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SaleReturnFilters, SaleReturnsResponse } from '../types/sales';

async function fetchSaleReturns(filters: SaleReturnFilters, signal?: AbortSignal): Promise<SaleReturnsResponse> {
  const params = new URLSearchParams();
  
  params.append('page', filters.page.toString());
  params.append('limit', filters.limit.toString());
  
  if (filters.search) params.append('search', filters.search);
  if (filters.customerFilter) params.append('customer', filters.customerFilter);
  if (filters.statusFilter && filters.statusFilter !== 'all') params.append('status', filters.statusFilter);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  params.append('sortBy', filters.sortBy || 'return_date');
  params.append('sortOrder', filters.sortOrder || 'desc');

  const response = await fetch(`/api/sale-returns?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch sale returns');
  }

  const data = await response.json();

  return {
    returns: data.returns || [],
    pagination: data.pagination || {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      totalPages: 1
    }
  };
}

export function useSaleReturns(filters: SaleReturnFilters) {
  return useQuery({
    queryKey: ['saleReturns', filters],
    queryFn: ({ signal }) => fetchSaleReturns(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Sale and Invoice C returns are numbered separately, so a return is named by
 * id AND type ('invoice' | 'invoicex'); the server refuses an id that names two.
 */
const returnUrl = (id: string | number, type?: string | null) =>
  `/api/sale-returns/${id}${type ? `?type=${encodeURIComponent(type)}` : ''}`;

async function fetchSaleReturn(id: string | number, type?: string | null, signal?: AbortSignal): Promise<any> {
  const response = await fetch(returnUrl(id, type), { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch sale return');
  }
  return data;
}

export function useSaleReturn(id: string | number | undefined, type?: string | null) {
  return useQuery({
    queryKey: ['saleReturn', id, type ?? null],
    queryFn: ({ signal }) => fetchSaleReturn(id!, type, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Delete Sale Return Mutation
async function deleteSaleReturn({ id, type }: { id: number; type: string }) {
  const response = await fetch(returnUrl(id, type), {
    method: 'DELETE'
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success) {
    throw new Error(data.message || data.error || 'Failed to delete sale return');
  }

  return data;
}

export function useDeleteSaleReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSaleReturn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saleReturns'] });
    },
  });
}

// Create Sale Return Mutation
async function createSaleReturn(data: any) {
  const response = await fetch('/api/sale-returns/customer-return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to create sale return');
  }

  return result;
}

export function useCreateSaleReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSaleReturn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saleReturns'] });
    },
  });
}

// Update Sale Return Mutation
async function updateSaleReturn({ id, data }: { id: string; data: any }) {
  const response = await fetch(returnUrl(id, data?.invoice_type), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to update sale return');
  }

  return result;
}

export function useUpdateSaleReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSaleReturn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saleReturns'] });
      queryClient.invalidateQueries({ queryKey: ['saleReturn'] });
    },
  });
}

// ============================================================================
// SALE RETURN REASONS HOOK
// ============================================================================

async function fetchSaleReturnReasons(signal?: AbortSignal): Promise<any[]> {
  const response = await fetch('/api/return-reasons?type=sale', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch return reasons');
  }

  const data = await response.json();
  return data.data || [];
}

export function useSaleReturnReasons() {
  return useQuery({
    queryKey: ['returnReasons', 'sale'],
    queryFn: ({ signal }) => fetchSaleReturnReasons(signal),
    staleTime: 10 * 60 * 1000, // 10 minutes - rarely changes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// CUSTOMER BILLS FOR SALE RETURN
// ============================================================================

interface CustomerBillsParams {
  customerId: string;
  page?: number;
  limit?: number;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

async function fetchCustomerBills(params: CustomerBillsParams, signal?: AbortSignal): Promise<any> {
  const queryParams = new URLSearchParams({
    customer_id: params.customerId,
    page: (params.page || 1).toString(),
    limit: (params.limit || 50).toString(),
    ...(params.search && { search: params.search }),
    ...(params.fromDate && { from_date: params.fromDate }),
    ...(params.toDate && { to_date: params.toDate })
  });

  const response = await fetch(`/api/sale-returns/customer-items?${queryParams}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer bills');
  }

  const data = await response.json();
  return data.data || { bills: [], pagination: {}, filters: {} };
}

export function useCustomerBills(params: CustomerBillsParams) {
  return useQuery({
    queryKey: ['customerBills', params],
    queryFn: ({ signal }) => fetchCustomerBills(params, signal),
    enabled: !!params.customerId, // Only run if customer is selected
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
