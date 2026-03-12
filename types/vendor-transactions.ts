// Vendor Transaction Types

export interface VendorTransaction {
  id: number;
  transaction_type: 'EXPENSE' | 'INCOME';
  vendor_id: number;
  vendor_name: string;
  date: number;
  amount: number;
  payment_mode: number;
  payment_type: string;
  notes: string | null;
  invoice_numbers: string[];
  allocations_count: number;
  fy: number;
}

export type TransactionType = 'all' | 'expense' | 'income';
export type SortField = 'id' | 'vendor_name' | 'amount' | 'date' | 'type';
export type SortOrder = 'asc' | 'desc';

export interface VendorTransactionFilters {
  page: number;
  limit: number;
  vendor_id?: string;
  dateFrom?: string;
  dateTo?: string;
  payment_mode?: string;
  payment_type?: string;
  type: TransactionType;
  sortBy: SortField;
  sortOrder: SortOrder;
}

export interface VendorTransactionsResponse {
  transactions: VendorTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// View Page Types
export interface VendorTransactionDetail {
  id: number;
  vendor: {
    id: number;
    name: string;
    contact: string | null;
    email: string | null;
  };
  payment_date?: number;
  refund_date?: number;
  payment_amount?: number;
  refund_amount?: number;
  payment_mode?: number;
  refund_mode?: number;
  payment_mode_text?: string;
  refund_mode_text?: string;
  payment_type?: string;
  refund_type?: string;
  notes: string | null;
  fy: number;
  allocations: Array<{
    allocation_id: number;
    purchase_id?: number;
    return_id?: number;
    invoice_no?: number;
    debit_note_no?: string;
    invoice_date?: number;
    return_date?: number;
    bill_reference?: string;
    allocated_amount: number;
    purchase_total?: number;
    return_total?: number;
    payment_status?: number;
    payment_status_text?: string;
  }>;
  summary: {
    payment_amount?: number;
    refund_amount?: number;
    total_allocated: number;
    allocation_count: number;
    difference: number;
  };
}

// Create/Edit Page Types
export interface OutstandingBill {
  purchase_id: number;
  invoice_no: number;
  invoice_date: number;
  total_bill: number;
  total_paid: number;
  outstanding_amount: number;
  payment_status: number;
  allocated?: number;
  isInCurrentPayment?: boolean;
}

export interface OutstandingReturn {
  return_id: number;
  return_no: string;
  return_date: number;
  total_return: number;
  total_refunded: number;
  outstanding_refund: number;
  payment_status: number;
  allocated?: number;
  isInCurrentPayment?: boolean;
}

export type OperationType = 'EXPENSE' | 'INCOME' | '';
export type PaymentType = 'BILL_SPECIFIC' | 'MIXED' | 'DIRECT';
