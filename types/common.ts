// Common types used across the application

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

export interface BaseFilters {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: string; // Changed from 'asc' | 'desc' to string for flexibility
}

export type PaymentStatus = 0 | 1 | 2; // 0: Unpaid, 1: Paid, 2: Partially Paid
export type PaymentMode = 0 | 1; // 0: Cash, 1: Bank

export interface PaymentSummary {
  total_bill: number;
  total_paid: number;
  remaining_amount: number;
  payment_count: number;
}

export interface PaymentHistory {
  id: number;
  payment_date: number;
  amount: number;
  payment_mode: PaymentMode;
  notes?: string;
}
