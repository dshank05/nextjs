// Purchase and Purchase Returns types

import { BaseFilters, Pagination, PaymentStatus, PaymentMode } from './common';

// ============================================================================
// PURCHASE TYPES
// ============================================================================

export interface Purchase {
  id: number;
  invoice_number?: string;
  invoice_no: number; // Made required to match usage
  vendor_id?: number;
  vendor_name?: string;
  vendor_address?: string;
  vendor_gstin?: string;
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
  date?: number | string;
  invoice_date: number | string; // Made required to match usage
  payment_status?: PaymentStatus;
  payment_mode?: PaymentMode;
  fy: number;
  transport?: string;
  transport_name?: string;
  vehicle_number?: string;
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  packing_forwarding_total?: number;
  type?: 'purchase';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
}

export interface PurchaseFilters extends BaseFilters {
  vendorFilter?: string;
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

export interface PurchasesResponse {
  purchases: Purchase[];
  pagination: Pagination;
}

// ============================================================================
// PURCHASE RETURN TYPES
// ============================================================================

export interface PurchaseReturn {
  id: number;
  return_no: string;
  invoice_no?: string; // Invoice number from the original purchase
  return_date: string;
  vendor_id: number;
  vendor_name: string;
  vendor_address?: string;
  vendor_gstin?: string;
  total_amount: number;
  total_tax: number;
  refund_amount: number;
  status: number;
  payment_status: number;
  payment_mode: number;
  payment_date?: number;
  fy: number;
  notes?: string;
  item_count: number;
  formattedDate?: string;
  statusText?: string;
  packing_forwarding_total?: number; // P/F amount
}

export interface PurchaseReturnFilters extends BaseFilters {
  returnNoFilter?: string;
  vendorFilter?: string;
  statusFilter?: string;
  amountMin?: string;
  amountMax?: string;
  uidFilter?: string;
  itemCount?: string;
  paymentMode?: string;
  packingForwardingTotal?: string;
}

export interface PurchaseReturnsResponse {
  returns: PurchaseReturn[];
  pagination: Pagination;
}

// Purchase Return Create/Edit Page Types
export interface PurchaseBill {
  id: string;
  invoice_no: string;
  bill_reference: string;
  invoice_date: string;
  total_amount: number;
  has_tax: boolean;
  items: PurchaseReturnItem[];
  available_items: number;
  total_items: number;
}

export interface PurchaseReturnItem {
  id: string;
  purchase_item_id?: number; // ID of the purchase item in purchaseitems table
  product_id: number;
  product_name: string;
  display_name?: string;
  part_number?: string;
  original_qty?: number; // Original purchase quantity
  already_returned?: number; // How much was already returned
  available_qty: number;
  is_fully_returned?: boolean; // Flag for UI
  unit_price: number;
  tax_rate: number;
  bill_reference: string;
  invoice_date: string;
  return_qty?: number; // Added for edit mode
  return_reason_id?: number; // Added for edit mode
  current_stock: number; // Current stock from product table
}

export interface ReturnReasons {
  id: number;
  reason_name: string;
  type: string;
}

export interface SelectedReturnItem extends PurchaseReturnItem {
  return_qty: number;
  return_reason_id: number;
  return_notes?: string;
  // Calculated fields
  subtotal: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

// Purchase Return View Page Types
export interface ReturnItem {
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

// ============================================================================
// PURCHASE FORM & ITEMS
// ============================================================================

export interface PurchaseItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string;
  car_model: string;
  category: string;
  sub_category: string;
  company: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  original_qty?: number;
  returned_qty?: number;
  available_qty?: number;
  is_fully_returned?: boolean;
  return_history?: Array<{
    return_id: string;
    return_no: string;
    qty: number;
    date: number;
    unit_price: number;
    tax_amount: number;
    cgst: number;
    sgst: number;
    igst: number;
    reason_id: number;
    notes: string;
  }>;
}

export interface PurchaseReturnStatus {
  has_returns: boolean;
  fully_returned_items: number;
  total_items: number;
  is_fully_returned: boolean;
  status: 'NO_RETURNS' | 'PARTIAL_RETURN' | 'FULLY_RETURNED';
}

export interface PurchaseFormData {
  invoice_number: string;
  bill_reference: string;
  bill_reference_date: string;
  staff_id?: number | null;
  date: string;
  vendor_name: string;
  contact_number: string;
  email_id: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  state_code?: number;
  gst_number: string;
  pin_code: string;
  transport_name: string;
  vehicle_number: string;
  transport_cost: string;
  bill: string;
  tax: string;
  tax_rate: string;
  basic_value: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  notes: string;
  total_tax: string;
  payment_status: number;
  payment_mode: number;
}
