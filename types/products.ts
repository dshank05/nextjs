// Product and inventory types

export interface Product {
  company_id?: number;
  id: number;
  product_name: string;
  display_name?: string;
  hsn?: string;
  product_category?: string;
  product_subcategory?: string;
  product_category_id?: number;
  product_subcategory_id?: number;
  car_model_ids?: string;
  company?: string;
  pic?: string;
  part_no?: string;
  min_stock?: number;
  stock?: number;
  rate?: number;
  notes?: string;
  category_name?: string;
  categoryName?: string;
  subcategory_name?: string;
  subcategoryName?: string;
  subcategoryNames?: string;
  companyName?: string;
  gst_rate?: number;
  selling_price?: number;
  gst_rate_percentage?: number;
  latest_purchase_rate?: number;
  latestPurchaseRate?: number;
  latest_selling_price?: number;
  gst_rate_id?: number;
  opening_rate?: number;
  lastPurchaseDate?: string;
  carModelsDisplay?: string;
  barcode?: string;
}

export interface ProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  categoryFilter?: string;
  subcategoryFilter?: string;
  modelFilter?: string | string[];
  companyFilter?: string;
  quantityFilter?: string;
  stockFilter?: string;
  startDate?: string;
  endDate?: string;
  uidFilter?: string;
  partNoFilter?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  fetchAll?: boolean;
}

export interface ProductsResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface ProductCategory {
  id: number;
  name: string;
}

export interface ProductSubcategory {
  id: number;
  name: string;
  category_id: number;
}

export interface ProductCompany {
  id: number;
  name: string;
}

export interface ProductModel {
  id: number;
  name: string;
}

export interface FilterOptions {
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
  companies: ProductCompany[];
  models: ProductModel[];
}

// ============================================================================
// PRODUCT TRANSACTION TYPES
// ============================================================================

export interface ProductTransactionRow {
  sn: number;
  invoice_number?: string;
  voucher_number?: string;
  vendor?: string;
  customer?: string;
  qty: number;
  rate: number;
  amount: number;
  /** ISO timestamp, or null when the document has no date. Formatted in the browser. */
  date: string | null;
}
