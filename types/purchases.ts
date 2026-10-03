// Purchase types (return types: hooks/useReturns.ts)

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
  bill_reference_date?: string | null;
  return_status?: number;
  packing_forwarding_total?: number;
  total_paid?: number;
  remaining_amount?: number;
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
// PURCHASE FORM & ITEMS
// ============================================================================

export interface PurchaseReturnStatus {
  has_returns: boolean;
  fully_returned_items: number;
  total_items: number;
  is_fully_returned: boolean;
  status: 'NO_RETURNS' | 'PARTIAL_RETURN' | 'FULLY_RETURNED';
}
