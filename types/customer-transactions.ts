// Customer Transaction types

import { BaseFilters, Pagination } from './common';

export interface CustomerTransaction {
  id: number;
  transaction_type: 'INCOME' | 'EXPENSE';
  customer_id: number;
  customer_name: string;
  date: number;
  amount: number;
  payment_mode: number;
  payment_type: string;
  notes: string | null;
  invoice_numbers: string[];
  allocations_count: number;
  fy: number;
}

export type TransactionType = 'all' | 'income' | 'expense';
export type TransactionSortField = 'id' | 'customer_name' | 'amount' | 'date' | 'type';

export interface CustomerTransactionFilters extends BaseFilters {
  customer_id?: string;
  dateFrom?: string;
  dateTo?: string;
  payment_mode?: string;
  payment_type?: string;
  type?: TransactionType;
  sortBy?: TransactionSortField;
}

export interface CustomerTransactionsResponse {
  data: CustomerTransaction[];
  pagination: Pagination;
  success: boolean;
}

// Transaction detail view types
export interface TransactionAllocation {
  allocation_id: number;
  invoice_id?: number;
  invoicex_id?: number;
  return_id?: number;
  invoice_no?: number | string;
  credit_note_no?: string;
  invoice_date?: number;
  return_date?: number;
  allocated_amount: number;
  invoice_total?: number;
  return_total?: number;
  payment_status?: number;
  payment_status_text?: string;
  type?: string;
}

export interface TransactionSummary {
  payment_amount?: number;
  refund_amount?: number;
  total_allocated: number;
  allocation_count: number;
  difference: number;
}

export interface TransactionCustomer {
  id: number;
  name: string;
  contact: string | null;
  email: string | null;
}

export interface TransactionData {
  id: number;
  customer: TransactionCustomer;
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
  allocations: TransactionAllocation[];
  summary: TransactionSummary;
}

// Customer transaction create/edit page types
export interface OutstandingInvoice {
  invoice_id: number;
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
  credit_note_no: string;
  return_date: number;
  total_return: number;
  total_refunded: number;
  outstanding_refund: number;
  payment_status: number;
  allocated?: number;
  isInCurrentPayment?: boolean;
}

export interface CustomerBasic {
  id: number;
  billing_name: string;
}

export type OperationType = 'INCOME' | 'EXPENSE' | '';
export type PaymentType = 'BILL_SPECIFIC' | 'MIXED' | 'DIRECT';
