import { useQuery } from '@tanstack/react-query';
import type { Salex, SalexFilters } from '../types/sales';

interface SalexResponse {
  salexs: Salex[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

async function fetchSalex(filters: SalexFilters, signal?: AbortSignal): Promise<SalexResponse> {
  const params = new URLSearchParams();
  
  params.append('page', filters.page.toString());
  params.append('limit', filters.limit.toString());
  
  if (filters.search) params.append('search', filters.search);
  if (filters.customerFilter) params.append('customer', filters.customerFilter);
  if (filters.statusFilter) params.append('status', filters.statusFilter);
  if (filters.dateFrom) params.append('startDate', filters.dateFrom);
  if (filters.dateTo) params.append('endDate', filters.dateTo);
  if (filters.amountMin) params.append('amountMin', filters.amountMin);
  if (filters.amountMax) params.append('amountMax', filters.amountMax);
  if (filters.uidFilter) params.append('uid', filters.uidFilter);
  if (filters.billReference) params.append('billRef', filters.billReference);
  if (filters.itemCount) params.append('items', filters.itemCount);
  if (filters.paymentMode) params.append('paymentMode', filters.paymentMode);
  if (filters.packingForwardingTotal) params.append('pf', filters.packingForwardingTotal);
  if (filters.total && !filters.amountMin) {
    params.append('amountMin', filters.total);
    params.append('amountMax', filters.total);
  }
  params.append('sortBy', filters.sortBy || 'invoice_no');
  params.append('sortOrder', filters.sortOrder || 'asc');

  const response = await fetch(`/api/salex?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch salex');
  }

  const data = await response.json();

  // Transform salex data
  const transformedSalex: Salex[] = (data.salexs || []).map((salex: any) => ({
    id: salex.id,
    invoice_no: salex.invoice_no,
    select_customer: salex.select_customer,
    customer_name: salex.customer_name,
    customer_address: salex.customer_address,
    customer_gstin: salex.customer_gstin,
    items_total: salex.items_total,
    freight: salex.freight,
    total_taxable_value: salex.total_taxable_value,
    total: salex.total,
    notes: salex.notes,
    invoice_date: salex.invoice_date,
    status: salex.status,
    payment_status: salex.payment_status,
    payment_mode: salex.payment_mode,
    fy: salex.fy,
    transport: salex.transport,
    item_count: salex.item_count,
    formattedDate: salex.formattedDate,
    bill_reference: salex.bill_reference,
    return_status: salex.return_status,
    packing_forwarding_total: salex.packing_forwarding_total,
    type: 'salex',
    customer_vendor_name: salex.customer_name,
    customer_vendor_address: salex.customer_address,
    customer_vendor_gstin: salex.customer_gstin
  }));

  return {
    salexs: transformedSalex,
    pagination: data.pagination
  };
}

export function useSalex(filters: SalexFilters) {
  return useQuery({
    queryKey: ['salex', filters],
    queryFn: ({ signal }) => fetchSalex(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchSalexItem(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/salex/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch salex');
  }

  return response.json();
}

export function useSalexItem(id: string | number | undefined) {
  return useQuery({
    queryKey: ['salex-item', id],
    queryFn: ({ signal }) => fetchSalexItem(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// SALEX MUTATIONS
// ============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

// Create Salex Mutation
async function createSalex(data: any) {
  const response = await fetch('/api/salex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to create salex');
  }

  return result;
}

export function useCreateSalex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSalex,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salex'] });
    },
  });
}

// Update Salex Mutation
async function updateSalex({ id, data }: { id: string | number; data: any }) {
  const response = await fetch(`/api/salex/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to update salex');
  }

  return result;
}

export function useUpdateSalex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSalex,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['salex'] });
      queryClient.invalidateQueries({ queryKey: ['salex-item', variables.id] });
    },
  });
}

// Delete Salex Mutation
async function deleteSalex(id: number) {
  const response = await fetch(`/api/salex/${id}`, {
    method: 'DELETE'
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to delete salex');
  }

  return data;
}

export function useDeleteSalex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSalex,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salex'] });
    },
  });
}
