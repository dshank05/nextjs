import { useQuery } from '@tanstack/react-query';
import type { Sale, SaleFilters, SalesResponse, Salex, SalexFilters, SalexResponse } from '../types/sales';

async function fetchSales(filters: SaleFilters, signal?: AbortSignal): Promise<SalesResponse> {
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
  if (filters.totalTax) params.append('taxAmount', filters.totalTax);
  if (filters.packingForwardingTotal) params.append('pf', filters.packingForwardingTotal);
  if (filters.total && !filters.amountMin) {
    params.append('amountMin', filters.total);
    params.append('amountMax', filters.total);
  }
  params.append('sortBy', filters.sortBy || 'invoice_no');
  params.append('sortOrder', filters.sortOrder || 'asc');

  const response = await fetch(`/api/sales?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch sales');
  }

  const data = await response.json();

  // Transform sales data
  const transformedSales: Sale[] = (data.sales || []).map((sale: any) => ({
    id: sale.id,
    invoice_no: sale.invoice_no,
    select_customer: sale.select_customer,
    customer_name: sale.customer_name,
    customer_address: sale.customer_address,
    customer_gstin: sale.customer_gstin,
    items_total: sale.items_total,
    freight: sale.freight,
    total_taxable_value: sale.total_taxable_value,
    taxrate: sale.taxrate,
    total_cgst: sale.total_cgst,
    total_sgst: sale.total_sgst,
    total_igst: sale.total_igst,
    total_tax: sale.total_tax,
    packing_forwarding_total: sale.packing_forwarding_total,
    total: sale.total,
    notes: sale.notes,
    invoice_date: sale.invoice_date,
    status: sale.status,
    payment_status: sale.payment_status,
    payment_mode: sale.payment_mode,
    fy: sale.fy,
    transport: sale.transport,
    item_count: sale.item_count,
    formattedDate: sale.formattedDate,
    bill_reference: sale.bill_reference,
    return_status: sale.return_status,
    type: 'sale',
    customer_vendor_name: sale.customer_name,
    customer_vendor_address: sale.customer_address,
    customer_vendor_gstin: sale.customer_gstin
  }));

  return {
    sales: transformedSales,
    pagination: data.pagination
  };
}

export function useSales(filters: SaleFilters) {
  return useQuery({
    queryKey: ['sales', filters],
    queryFn: ({ signal }) => fetchSales(filters, signal),
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
}

async function fetchSale(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/sales/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch sale');
  }

  return response.json();
}

export function useSale(id: string | number | undefined) {
  return useQuery({
    queryKey: ['sale', id],
    queryFn: ({ signal }) => fetchSale(id!, signal),
    enabled: !!id, // Only run query if id exists
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// SALE RETURN HOOKS
// ============================================================================

import type { SaleReturn, SaleReturnFilters, SaleReturnsResponse } from '../types/sales';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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

async function fetchSaleReturn(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/sale-returns/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch sale return');
  }

  return response.json();
}

export function useSaleReturn(id: string | number | undefined) {
  return useQuery({
    queryKey: ['saleReturn', id],
    queryFn: ({ signal }) => fetchSaleReturn(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Delete Sale Return Mutation
async function deleteSaleReturn(id: number) {
  const response = await fetch(`/api/sale-returns/${id}`, {
    method: 'DELETE'
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to delete sale return');
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
  const response = await fetch(`/api/sale-returns/${id}`, {
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
