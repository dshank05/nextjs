// Sales and Invoice C types (return types: hooks/useReturns.ts)

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
