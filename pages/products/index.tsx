import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { ProductTable } from '../../components/products/ProductTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useProducts, fetchProducts } from '../../hooks/useProducts';
import { useDebounce } from '../../hooks/useDebounce';
import type { ProductFilters, ProductListFilters } from '../../types/products';

export default function Products() {
  type FilterState = ProductListFilters & { sortBy: string; sortOrder: string };

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
  // Fixed page size: the list has no page-size control.
  const limit = 50;
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
        refetch();
      }
    });

    return unsubscribe;
  }, [refetch]);

  // No unmount cleanup.
  //
  // There was one, and it cleared 'products-page-filters' only. Once F-65 made
  // the search term and the page number persist too, that left the three out of
  // step: navigating into a product and back restored your search and put you
  // on page 5, with every filter silently wiped. Either all of it survives or
  // none of it does, and surviving is the point of F-65 - you came back from a
  // product you had found by filtering. "Clear Filters" is how you clear them.
  //
  // A persisted page number can outlive the result set it was valid for, so it
  // is corrected below rather than left pointing past the end.
  useEffect(() => {
    if (!isLoading && pagination.totalPages > 0 && page > pagination.totalPages) {
      setPage(1);
    }
  }, [isLoading, pagination.totalPages, page, setPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPage(newPage);
    }
  };


  // Stable, so the table's sync effect runs when the restored filters change,
  // not on every render; and it carries the sort, which the table used to
  // reset to its default (PQ-09).
  const initialFilters = useMemo(() => ({
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
    sortOrder: currentFilters.sortOrder
  }), [currentFilters]);

  // Handle filter application
  const handleApplyFilters = (filters: ProductListFilters) => {
    setCurrentFilters({ ...currentFilters, ...filters } as FilterState);
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
        onApplyFilters={handleApplyFilters}
        initialFilters={initialFilters}
        fetchAllForExport={async () => (await fetchProducts({ ...queryFilters, fetchAll: true })).products}
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
