// Sales, Salex, and Sale Returns types

import { BaseFilters, Pagination, PaymentStatus, PaymentMode } from './common';

// ============================================================================
// SALE / INVOICE C BILLS - one shape for both kinds (lib/sale-query.ts)
// ============================================================================

export type SaleKind = 'sale' | 'salex';

/** A row of the sale or Invoice C list. */
export interface SaleBillRow {
  id: number;
  type: SaleKind;
  invoice_no: number;
  select_customer: number;
  customer_name: string;
  customer_address: string;
  customer_gstin: string;
  bill_reference: string;
  items_total: number;
  discount: number;
  freight: number;
  total_taxable_value: number;
  total_tax: number;
  packing_forwarding_total: number;
  total: number;
  notes: string;
  invoice_date: number;
  formattedDate: string;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode;
  return_status: number;
  fy: number;
  item_count: number;
  total_paid: number;
  remaining_amount: number;
  outstanding_amount: number;
}

/** List filters, named as lib/sale-query.ts reads them. */
export interface SaleListFilters extends BaseFilters {
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
  notes?: string;
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

// Sale Return View Types
export interface SaleReturnItem {
  id: number;
  product_name: string;
  part_number?: string;
  return_qty: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  return_reason: string;
  notes?: string;
  bill_reference?: string;
  bill_date?: string;
  invoice_no?: string;
}

// Sale Return Create Types
export interface SaleBill {
  id: string;
  invoice_no: string;
  bill_reference: string;
  invoice_date: string;
  total_amount: number;
  has_tax: boolean;
  items: SaleItemForReturn[];
  available_items: number;
  total_items: number;
  payment_status: number;
  outstanding_amount: number;
}

export interface SaleItemForReturn {
  id: string;
  invoice_item_id?: number;
  sale_item_id?: number;
  product_id: number;
  product_name: string;
  display_name?: string;
  part_number?: string;
  original_qty?: number;
  available_qty: number;
  unit_price: number;
  tax_rate: number;
  bill_reference: string;
  invoice_date: string;
  return_qty?: number;
  return_reason_id?: number;
}

export interface ReturnReason {
  id: number;
  reason_name: string;
  type: string;
}

export interface SelectedReturnItem extends SaleItemForReturn {
  return_qty: number;
  return_reason_id: number;
  return_notes?: string;
  subtotal: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}
