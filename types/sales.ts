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

// ============================================================================
// SALEX CREATE/EDIT TYPES (Tax-Exempt Sales)
// ============================================================================

export interface SalexInvoiceItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string;
  car_model_ids: string[];
  car_model_names: string[];
  category_id: number;
  category_name: string;
  subcategory_id: number;
  subcategory_name: string;
  company_id: number;
  company_name: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number; // Kept for display but not used in calculations
  discount_percentage: number;
  tax: number; // Always 0 for salex
  discount_amount: number;
  total: number;
  hsn: string;
  mrp: number;
  discount: number;
  margin: number;
  cgst: number; // Always 0 for salex
  sgst: number; // Always 0 for salex
  igst: number; // Always 0 for salex
}

export interface SalexFormData {
  invoice_number: string;
  bill_reference: string;
  staff_id?: number | null;
  date: string;
  customer_name: string;
  contact_number: string;
  mechanic_name: string;
  vehicle_number: string;
  commission: string;
  address: string;
  address_2: string;
  transport_name: string;
  city: string;
  email_id: string;
  discount: string;
  state: string;
  state_code?: number;
  gst_number: string;
  tax: string;
  notes: string;
  payment_status: number;
  payment_mode: number;
  total_discount: string;
  subtotal: string;
  total_tax: string;
  grand_total: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  tax_rate: string;
  basic_value: string;
  pin_code: string;
}


export interface SaleInvoiceItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string;
  car_model_ids: string[];
  car_model_names: string[];
  category_id: number;
  category_name: string;
  subcategory_id: number;
  subcategory_name: string;
  company_id: number;
  company_name: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number;
  discount_percentage: number;
  tax: number;
  discount_amount: number;
  total: number;
  hsn: string;
  mrp: number;
  discount: number;
  margin: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface SaleFormData {
  invoice_number: string;
  bill_reference: string;
  staff_id?: number | null;
  date: string;
  customer_name: string;
  contact_number: string;
  mechanic_name: string;
  mechanic_id?: number | null;
  vehicle_number: string;
  commission: string;
  address: string;
  address_2: string;
  transport_name: string;
  city: string;
  email_id: string;
  discount: string;
  state: string;
  state_code?: number;
  gst_number: string;
  tax: string;
  notes: string;
  payment_status: number;
  payment_mode: number;
  total_discount: string;
  subtotal: string;
  total_tax: string;
  grand_total: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  pin_code: string;
}
