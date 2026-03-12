import { useQuery } from '@tanstack/react-query';
import type { Product, FilterOptions, DeadstockFilters, DeadstockResponse, ProductFilters, ProductsResponse } from '../types/products';

async function fetchProducts(filters: ProductFilters, signal?: AbortSignal): Promise<ProductsResponse> {
  const params = new URLSearchParams();
  
  // Pagination
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());
  
  // Search and filters
  if (filters.search) params.append('search', filters.search);
  if (filters.categoryFilter) params.append('category', filters.categoryFilter);
  if (filters.subcategoryFilter) params.append('subcategory', filters.subcategoryFilter);
  if (filters.modelFilter) {
    const modelValue = Array.isArray(filters.modelFilter) ? filters.modelFilter.join(',') : filters.modelFilter;
    params.append('model', modelValue);
  }
  if (filters.companyFilter) params.append('company_id', filters.companyFilter);
  if (filters.quantityFilter) params.append('quantity', filters.quantityFilter);
  if (filters.stockFilter === 'low') params.append('lowStock', 'true');
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.uidFilter) params.append('uid', filters.uidFilter);
  if (filters.partNoFilter) params.append('part_no', filters.partNoFilter);
  
  // Sorting
  params.append('sortBy', filters.sortBy || 'categoryName');
  params.append('sortOrder', filters.sortOrder || 'asc');
  
  // Fetch all flag
  if (filters.fetchAll) params.append('fetchAll', 'true');

  const url = `/api/products/optimized?${params.toString()}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }

  const data = await response.json();
  
  // Transform products
  const transformedProducts: Product[] = (data.products || []).map((product: any) => ({
    id: product.id,
    product_name: product.product_name,
    stock: product.stock,
    min_stock: product.min_stock,
    rate: product.rate,
    part_no: product.part_no,
    categoryName: product.categoryName,
    companyName: product.companyName,
    subcategoryNames: product.subcategoryNames,
    latestPurchaseRate: product.latestPurchaseRate,
    lastPurchaseDate: product.lastPurchaseDate,
    carModelsDisplay: product.carModelsDisplay,
    subcategoryName: product.subcategoryName,
    pic: product.pic,
    barcode: product.barcode
  }));

  return {
    products: transformedProducts,
    pagination: data.pagination || {
      page: filters.page || 1,
      limit: filters.limit || 50,
      total: 0,
      totalPages: 1,
      hasMore: false
    }
  };
}

async function fetchFilterOptions(signal?: AbortSignal): Promise<FilterOptions> {
  const response = await fetch('/api/products/filters', { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch filter options');
  }

  return response.json();
}

export function useProducts(filters: ProductFilters = {}) {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: ({ signal }) => fetchProducts(filters, signal),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ['filterOptions'],
    queryFn: ({ signal }) => fetchFilterOptions(signal),
    staleTime: 10 * 60 * 1000, // 10 minutes - rarely changes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// DEADSTOCK HOOKS
// ============================================================================

async function fetchDeadstock(filters: DeadstockFilters, signal?: AbortSignal): Promise<DeadstockResponse> {
  const params = new URLSearchParams();
  
  params.append('page', filters.page.toString());
  params.append('limit', filters.limit.toString());
  if (filters.search) params.append('search', filters.search);
  params.append('sortBy', filters.sortBy || 'created_at');
  params.append('sortOrder', filters.sortOrder || 'desc');

  const response = await fetch(`/api/deadstock?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch deadstock');
  }

  const data = await response.json();

  return {
    deadstock: data.deadstock || [],
    pagination: data.pagination || {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      totalPages: 1
    }
  };
}

export function useDeadstock(filters: DeadstockFilters) {
  return useQuery({
    queryKey: ['deadstock', filters],
    queryFn: ({ signal }) => fetchDeadstock(filters, signal),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Single Product Query
async function fetchProduct(id: string | number, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`/api/products/${id}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch product');
  }

  return response.json();
}

export function useProduct(id: string | number | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: ({ signal }) => fetchProduct(id!, signal),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// PRODUCT MUTATIONS
// ============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

// Create Product Mutation
async function createProduct(formData: FormData) {
  const response = await fetch('/api/products', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create product');
  }

  return data;
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// Update Product Mutation
async function updateProduct({ id, formData }: { id: string | number; formData: FormData }) {
  const response = await fetch(`/api/products/${id}`, {
    method: 'PUT',
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to update product');
  }

  return data;
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProduct,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] });
    },
  });
}
