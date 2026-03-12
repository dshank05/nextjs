import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { 
  VendorTransaction, 
  VendorTransactionFilters, 
  VendorTransactionsResponse,
  VendorTransactionDetail,
  OutstandingBill,
  OutstandingReturn
} from '../types/vendor-transactions';

// ============================================================================
// QUERY HOOKS
// ============================================================================

async function fetchVendorTransactions(
  filters: VendorTransactionFilters, 
  signal?: AbortSignal
): Promise<VendorTransactionsResponse> {
  const params = new URLSearchParams({
    page: filters.page.toString(),
    limit: filters.limit.toString(),
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    type: filters.type
  });

  if (filters.vendor_id) params.append('vendor_id', filters.vendor_id);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.payment_mode) params.append('payment_mode', filters.payment_mode);
  if (filters.payment_type) params.append('payment_type', filters.payment_type);

  const response = await fetch(`/api/vendor-transactions?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch vendor transactions');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch vendor transactions');
  }

  return {
    transactions: data.data || [],
    pagination: data.pagination || {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      totalPages: 1,
      hasNext: false,
      hasPrev: false
    }
  };
}

export function useVendorTransactions(filters: VendorTransactionFilters) {
  return useQuery({
    queryKey: ['vendorTransactions', filters],
    queryFn: ({ signal }) => fetchVendorTransactions(filters, signal),
    enabled: !!filters.vendor_id, // Only fetch when vendor is selected
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Single Transaction Query
async function fetchVendorTransaction(
  id: string | number,
  type: 'expense' | 'income',
  signal?: AbortSignal
): Promise<VendorTransactionDetail> {
  const endpoint = type === 'expense'
    ? `/api/vendor-payments/${id}`
    : `/api/vendor-refunds/${id}`;

  const response = await fetch(endpoint, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch transaction');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch transaction');
  }

  return data.data;
}

export function useVendorTransaction(
  id: string | number | undefined,
  type: 'expense' | 'income' | undefined
) {
  return useQuery({
    queryKey: ['vendorTransaction', id, type],
    queryFn: ({ signal }) => fetchVendorTransaction(id!, type!, signal),
    enabled: !!id && !!type,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

interface DeleteTransactionParams {
  id: number;
  type: 'expense' | 'income';
}

async function deleteVendorTransaction({ id, type }: DeleteTransactionParams) {
  const endpoint = type === 'expense'
    ? `/api/vendor-payments/${id}`
    : `/api/vendor-refunds/${id}`;

  const response = await fetch(endpoint, {
    method: 'DELETE'
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to delete transaction');
  }

  return data;
}

export function useDeleteVendorTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteVendorTransaction,
    onSuccess: () => {
      // Invalidate vendor transactions list
      queryClient.invalidateQueries({ queryKey: ['vendorTransactions'] });
    },
  });
}

// Outstanding Bills Query
async function fetchOutstandingBills(
  vendorId: number,
  signal?: AbortSignal
): Promise<OutstandingBill[]> {
  const response = await fetch(
    `/api/purchases?vendor=${vendorId}&limit=1000&sortOrder=asc`,
    { signal }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch outstanding bills');
  }

  const data = await response.json();

  if (!data.purchases) {
    return [];
  }

  return data.purchases
    .filter((p: any) => p.remaining_amount > 0)
    .map((p: any) => ({
      purchase_id: p.id,
      invoice_no: p.invoice_no,
      invoice_date: p.invoice_date,
      total_bill: p.total,
      total_paid: p.total_paid || 0,
      outstanding_amount: p.remaining_amount,
      payment_status: p.payment_status,
      allocated: 0,
      isInCurrentPayment: false
    }));
}

export function useOutstandingBills(vendorId: number | undefined) {
  return useQuery({
    queryKey: ['outstandingBills', vendorId],
    queryFn: ({ signal }) => fetchOutstandingBills(vendorId!, signal),
    enabled: !!vendorId && vendorId > 0,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Outstanding Returns Query
async function fetchOutstandingReturns(
  vendorId: number,
  signal?: AbortSignal
): Promise<OutstandingReturn[]> {
  const response = await fetch(
    `/api/purchase-returns?vendor=${vendorId}&limit=1000&sortOrder=asc`,
    { signal }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch outstanding returns');
  }

  const data = await response.json();

  if (!data.returns) {
    return [];
  }

  return data.returns
    .filter((r: any) => r.remaining_refund > 0)
    .map((r: any) => ({
      return_id: r.id,
      return_no: r.return_no,
      return_date: r.return_date,
      total_return: r.refund_amount,
      total_refunded: r.total_refunded || 0,
      outstanding_refund: r.remaining_refund,
      payment_status: r.payment_status,
      allocated: 0,
      isInCurrentPayment: false
    }));
}

export function useOutstandingReturns(vendorId: number | undefined) {
  return useQuery({
    queryKey: ['outstandingReturns', vendorId],
    queryFn: ({ signal }) => fetchOutstandingReturns(vendorId!, signal),
    enabled: !!vendorId && vendorId > 0,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Current FY Query
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

// Create/Update Transaction Mutations
interface CreateVendorTransactionPayload {
  vendor_id: string;
  payment_amount?: number;
  refund_amount?: number;
  payment_mode?: number;
  refund_mode?: number;
  payment_date?: number;
  refund_date?: number;
  payment_type?: string;
  refund_type?: string;
  notes: string;
  allocations: Array<{
    purchase_id?: number;
    return_id?: number;
    allocated_amount: number;
    notes: string;
  }>;
  fy: number;
}

async function createVendorTransaction(payload: CreateVendorTransactionPayload) {
  const isExpense = payload.payment_amount !== undefined;
  const endpoint = isExpense ? '/api/vendor-payments' : '/api/vendor-refunds';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to create transaction');
  }

  return data;
}

async function updateVendorTransaction(
  id: number,
  payload: CreateVendorTransactionPayload,
  isExpense: boolean
) {
  const endpoint = isExpense
    ? `/api/vendor-payments/${id}`
    : `/api/vendor-refunds/${id}`;

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to update transaction');
  }

  return data;
}

export function useCreateVendorTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createVendorTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendorTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['outstandingBills'] });
      queryClient.invalidateQueries({ queryKey: ['outstandingReturns'] });
    },
  });
}

export function useUpdateVendorTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload, isExpense }: { id: number; payload: CreateVendorTransactionPayload; isExpense: boolean }) =>
      updateVendorTransaction(id, payload, isExpense),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendorTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['vendorTransaction', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['outstandingBills'] });
      queryClient.invalidateQueries({ queryKey: ['outstandingReturns'] });
    },
  });
}
