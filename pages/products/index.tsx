import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { ProductTable } from '../../components/products/ProductTable';
import { subscribeBroadcast } from '../../lib/broadcast';

interface Product {
  id: number;
  product_name: string;
  stock?: number;
  min_stock?: number;
  rate?: number;
  part_no?: string;
  categoryName?: string;
  companyName?: string;
  subcategoryNames?: string;
  latestPurchaseRate?: number;
  lastPurchaseDate?: string;
  carModelsDisplay?: string;
  subcategoryName?: string;
  pic?: string; // Product image URL
  barcode?: string; // Barcode image URL
}

interface ProductResponse {
  products: Product[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Products() {
  // Define filter type
  type FilterState = {
    categoryFilter: string;
    subcategoryFilter: string;
    modelFilter: string[];
    companyFilter: string;
    quantityFilter: string;
    stockFilter: string;
    startDate: string;
    endDate: string;
    uidFilter: string;
    partNoFilter: string;
    sortBy: string;
    sortOrder: string;
  };

  // Create persistent filter state using use-storage-state (sessionStorage - clears on tab close)
  const [currentFilters, setCurrentFilters] = useStorageState<FilterState>('products-page-filters', {
    defaultValue: {
      categoryFilter: '',
      subcategoryFilter: '',
      modelFilter: [],
      companyFilter: '',
      quantityFilter: '',
      stockFilter: 'all',
      startDate: '',
      endDate: '',
      uidFilter: '',
      partNoFilter: '',
      sortBy: 'categoryName',
      sortOrder: 'asc'
    },
    storage: sessionStorage
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Refs for debouncing and abort controllers
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProducts = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        // Add filter parameters
        category: currentFilters.categoryFilter,
        subcategory: currentFilters.subcategoryFilter,
        model: currentFilters.modelFilter.join(','),
        company_id: currentFilters.companyFilter,
        quantity: currentFilters.quantityFilter,
        lowStock: currentFilters.stockFilter === 'low' ? 'true' : 'false',
        startDate: currentFilters.startDate,
        endDate: currentFilters.endDate,
        uid: currentFilters.uidFilter,
        part_no: currentFilters.partNoFilter,
        // Add sort parameters
        sortBy: currentFilters.sortBy || 'categoryName',
        sortOrder: currentFilters.sortOrder || 'asc'
      });

      const response = await fetch(`/api/products/optimized?${params}`, {
        signal // Pass abort signal to fetch
      });

      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }

      const data: ProductResponse = await response.json();

      // Transform API data to match our interface
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
        pic: product.pic, // ✅ Added for Media column
        barcode: product.barcode // ✅ Added for Media column
      }));

      setProducts(transformedProducts);
      setPagination(data.pagination);
    } catch (err) {
      // Don't set error if request was aborted
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, currentFilters]);

  // Debounced fetch function with abort controller
  const debouncedFetchProducts = useCallback(() => {
    // Clear previous timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Set new timeout for debounced execution
    debounceTimeoutRef.current = setTimeout(() => {
      fetchProducts(abortControllerRef.current?.signal);
    }, 300); // 300ms debounce delay
  }, [currentFilters]); // Add currentFilters to dependencies

  // Fetch products when pagination, search, or filters change
  useEffect(() => {
    debouncedFetchProducts();
  }, [pagination.page, pagination.limit, searchTerm, currentFilters, debouncedFetchProducts]);

  // Listen for broadcast messages to refresh data when products are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'products' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Product ${msg.type} in another tab, refreshing data...`);
        fetchProducts();
      }
    });

    return unsubscribe;
  }, [fetchProducts]);

  // Cleanup timeouts and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };



  // Handle filter application
  const handleApplyFilters = (filters: FilterState) => {
    setCurrentFilters(filters);
    // Reset to first page when applying filters
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading products</div>
                <div className="text-red-300 text-sm">{error}</div>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <ProductTable
        products={products}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}} // Export handled internally by ProductTable
        onApplyFilters={handleApplyFilters}
        initialFilters={{
          categoryFilter: currentFilters.categoryFilter,
          subcategoryFilter: currentFilters.subcategoryFilter,
          modelFilter: currentFilters.modelFilter,
          companyFilter: currentFilters.companyFilter,
          quantityFilter: currentFilters.quantityFilter,
          stockFilter: currentFilters.stockFilter,
          startDate: currentFilters.startDate,
          endDate: currentFilters.endDate,
          uidFilter: currentFilters.uidFilter,
          partNoFilter: currentFilters.partNoFilter
        }}
        actionButton={(
          <Link
            href="/products/create"
            className="btn-primary"
          >
            Add Product
          </Link>
        )}
      />
    </div>
  );
}
