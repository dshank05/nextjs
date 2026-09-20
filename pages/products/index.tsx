import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { ProductTable } from '../../components/products/ProductTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useProducts } from '../../hooks/useProducts';
import { useDebounce } from '../../hooks/useDebounce';
import type { ProductFilters } from '../../types/products';

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

  // Create persistent filter state
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
    storage: "session"
  });

  // Persisted alongside the filters above, in the same session storage.
  //
  // The filter panel already survived a refresh, but search and page number did
  // not - so returning from a product you had found by searching dropped you
  // back at an unfiltered page one (F-65). Kept on session storage rather than
  // moved to the URL: this page's filter state is a twelve-field object, which
  // makes for an unreadable query string, and the settings pages that DID move
  // to the URL each carry only three simple values.
  const [page, setPage] = useStorageState<number>('products-page-number', {
    defaultValue: 1,
    storage: 'session'
  });
  const [limit, setLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useStorageState<string>('products-page-search', {
    defaultValue: '',
    storage: 'session'
  });

  // Debounce search
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Build query filters
  const queryFilters: ProductFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedSearch,
    categoryFilter: currentFilters.categoryFilter,
    subcategoryFilter: currentFilters.subcategoryFilter,
    modelFilter: currentFilters.modelFilter,
    companyFilter: currentFilters.companyFilter,
    quantityFilter: currentFilters.quantityFilter,
    stockFilter: currentFilters.stockFilter,
    startDate: currentFilters.startDate,
    endDate: currentFilters.endDate,
    uidFilter: currentFilters.uidFilter,
    partNoFilter: currentFilters.partNoFilter,
    sortBy: currentFilters.sortBy,
    sortOrder: currentFilters.sortOrder as 'asc' | 'desc'
  }), [page, limit, debouncedSearch, currentFilters]);

  // Query hook
  const { data, isLoading, error, refetch } = useProducts(queryFilters);

  const products = data?.products || [];
  const pagination = data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false };

  // Listen for broadcast messages
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'products' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Product ${msg.type} in another tab, refreshing data...`);
        refetch();
      }
    });

    return unsubscribe;
  }, [refetch]);

  // Clear sessionStorage on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('products-page-filters');
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPage(newPage);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  // Handle filter application
  const handleApplyFilters = (filters: FilterState) => {
    setCurrentFilters(filters);
    setPage(1);
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
                <div className="text-red-300 text-sm">{error.message}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ProductTable
        products={products}
        pagination={pagination}
        loading={isLoading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => { }}
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
