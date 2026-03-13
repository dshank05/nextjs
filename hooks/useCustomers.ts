import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerTransactionFilters, CustomerTransactionsResponse } from '../types/customer-transactions';

// ============================================================================
// CUSTOMER QUERY HOOKS
// ============================================================================

async function fetchCustomer(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/customers/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer');
  }

  return response.json();
}

export function useCustomer(id: string | number | undefined) {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: ({ signal }) => fetchCustomer(id!, signal),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// CUSTOMER TRANSACTIONS
// ============================================================================

async function fetchCustomerTransactions(filters: CustomerTransactionFilters, signal?: AbortSignal): Promise<CustomerTransactionsResponse> {
  const params = new URLSearchParams({
    page: filters.page.toString(),
    limit: filters.limit.toString(),
    sortBy: filters.sortBy || 'date',
    sortOrder: filters.sortOrder || 'asc',
    type: filters.type || 'all'
  });

  if (filters.customer_id) params.append('customer_id', filters.customer_id);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.payment_mode) params.append('payment_mode', filters.payment_mode);
  if (filters.payment_type) params.append('payment_type', filters.payment_type);

  const response = await fetch(`/api/customer-transactions?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer transactions');
  }

  return response.json();
}

export function useCustomerTransactions(filters: CustomerTransactionFilters) {
  return useQuery({
    queryKey: ['customerTransactions', filters],
    queryFn: ({ signal }) => fetchCustomerTransactions(filters, signal),
    enabled: !!filters.customer_id, // Only fetch if customer is selected
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// CUSTOMER PAYMENT/REFUND DETAIL HOOKS
// ============================================================================

async function fetchCustomerPayment(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/customer-payments/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer payment');
  }

  const data = await response.json();
  return data.payment || data.data;
}

export function useCustomerPayment(id: string | number | undefined) {
  return useQuery({
    queryKey: ['customerPayment', id],
    queryFn: ({ signal }) => fetchCustomerPayment(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchCustomerRefund(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/customer-refunds/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch customer refund');
  }

  const data = await response.json();
  return data.data || data.refund;
}

export function useCustomerRefund(id: string | number | undefined) {
  return useQuery({
    queryKey: ['customerRefund', id],
    queryFn: ({ signal }) => fetchCustomerRefund(id!, signal),
    enabled: !!id,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// FINANCIAL YEAR HOOK
// ============================================================================

async function fetchCurrentFY(signal?: AbortSignal): Promise<number> {
  const response = await fetch('/api/financial-years', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch financial year');
  }

  const data = await response.json();
  return data.currentFyId || 2024;
}

export function useCurrentFY() {
  return useQuery({
    queryKey: ['currentFY'],
    queryFn: ({ signal }) => fetchCurrentFY(signal),
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// CUSTOMER PAYMENT/REFUND MUTATIONS
// ============================================================================

// Create Customer Payment
async function createCustomerPayment(payload: any) {
  const response = await fetch('/api/customer-payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to create customer payment');
  }

  return result;
}

export function useCreateCustomerPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCustomerPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['customerPayment'] });
    },
  });
}

// Update Customer Payment
async function updateCustomerPayment({ id, payload }: { id: number; payload: any }) {
  const response = await fetch(`/api/customer-payments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to update customer payment');
  }

  return result;
}

export function useUpdateCustomerPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomerPayment,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customerPayment', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['customerTransactions'] });
    },
  });
}

// Create Customer Refund
async function createCustomerRefund(payload: any) {
  const response = await fetch('/api/customer-refunds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to create customer refund');
  }

  return result;
}

export function useCreateCustomerRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCustomerRefund,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['customerRefund'] });
    },
  });
}

// Update Customer Refund
async function updateCustomerRefund({ id, payload }: { id: number; payload: any }) {
  const response = await fetch(`/api/customer-refunds/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to update customer refund');
  }

  return result;
}

export function useUpdateCustomerRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomerRefund,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customerRefund', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['customerTransactions'] });
    },
  });
}

// ============================================================================
// CUSTOMER MUTATIONS
// ============================================================================

// Update Customer Status
async function updateCustomerStatus({ id, status }: { id: string; status: string }) {
  const response = await fetch(`/api/customers/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, confirmed: true })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to update customer status');
  }

  return result;
}

export function useUpdateCustomerStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomerStatus,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// Delete Customer Transaction (Payment or Refund)
async function deleteCustomerTransaction({ id, type }: { id: number; type: 'income' | 'expense' }) {
  const endpoint = type === 'income'
    ? `/api/customer-payments/${id}`
    : `/api/customer-refunds/${id}`;

  const response = await fetch(endpoint, {
    method: 'DELETE'
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to delete transaction');
  }

  return result;
}

export function useDeleteCustomerTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCustomerTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customerTransactions'] });
    },
  });
}
