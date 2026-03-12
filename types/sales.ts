// Sales, Salex, and Sale Returns types

import { BaseFilters, Pagination, PaymentStatus, PaymentMode } from './common';

// ============================================================================
// SALE TYPES
// ============================================================================

export interface Sale {
  id: number;
  invoice_no: number;
  select_customer?: number;
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
  items_total: number;
  freight?: number;
  total_taxable_value: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  total: number;
  notes?: string;
  invoice_date: number | string;
  status?: number;
  payment_status?: PaymentStatus;
  payment_mode?: PaymentMode;
  fy: number;
  transport?: string;
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  packing_forwarding_total?: number;
  type?: 'sale';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
}

export interface SaleFilters extends BaseFilters {
  customerFilter?: string;
  statusFilter?: string;
  amountMin?: string;
  amountMax?: string;
  uidFilter?: string;
  billReference?: string;
  itemCount?: string;
  paymentMode?: string;
  total?: string;
  totalTax?: string;
  packingForwardingTotal?: string;
}

export interface SalesResponse {
  sales: Sale[];
  pagination: Pagination;
}

// ============================================================================
// SALEX TYPES (Tax-Exempt Sales)
// ============================================================================

export interface Salex {
  id: number;
  invoice_no: number; // Changed to number only to match component expectations
  customer_id?: number;
  select_customer?: number; // Alias for customer_id
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
  items_total: number;
  freight?: number;
  total_taxable_value: number;
  total: number;
  notes?: string;
  date: number | string;
  invoice_date: number | string; // Made required to match component expectations
  payment_status?: PaymentStatus;
  payment_mode?: PaymentMode;
  fy: number;
  transport?: string;
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  packing_forwarding_total?: number;
  type?: 'salex';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
}

export interface SalexFilters extends BaseFilters {
  customerFilter?: string;
  statusFilter?: string;
  amountMin?: string;
  amountMax?: string;
  uidFilter?: string;
  billReference?: string;
  itemCount?: string;
  paymentMode?: string;
  total?: string;
  packingForwardingTotal?: string;
}

export interface SalexResponse {
  salex: Salex[];
  pagination: Pagination;
}

// ============================================================================
// SALE RETURN TYPES
// ============================================================================

export interface SaleReturn {
  id: number;
  return_no: string;
  invoice_no?: string;
  invoice_id: number;
  invoice_type: 'invoice' | 'invoicex';
  return_date: string | number;
  customer_id: number;
  customer_name: string;
  customer_gstin?: string;
  total_amount: number;
  total_tax: number;
  refund_amount: number;
  status: string;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode;
  payment_date?: number;
  fy: number;
  notes?: string;
  item_count: number;
  formattedDate?: string;
  packing_forwarding_total?: number;
}

export interface SaleReturnFilters extends BaseFilters {
  customerFilter?: string;
  statusFilter?: string;
  returnNoFilter?: string;
  amountMin?: string;
  amountMax?: string;
  uidFilter?: string;
  itemCount?: string;
  paymentMode?: string;
}

export interface SaleReturnsResponse {
  returns: SaleReturn[];
  pagination: Pagination;
}
