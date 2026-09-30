// Deadstock types. Moved out of types/products.ts (PQ-44).

export interface Deadstock {
  id: number;
  product_id: number;
  product_name: string;
  part_no: string;
  quantity: number;
  reason: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  formatted_created_at: string;
  formatted_updated_at: string;
}

export interface DeadstockFilters {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DeadstockResponse {
  deadstock: Deadstock[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
