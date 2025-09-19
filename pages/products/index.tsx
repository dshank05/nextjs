// In pages/products/index.tsx

import { useState, useEffect, ReactNode } from 'react';
import { useDebounce } from '../../hooks/useDebounce'; // CREATE and adjust path if needed
import { ProductFilters } from '../../components/products/ProductFilters'; // Adjust path if needed
import { ProductTable } from '../../components/products/ProductTable'; // Adjust path if needed
import { CreateProductModal } from '../../components/products/CreateProductModal'; // New modal component

// Interfaces remain here, as they define the data shape for this page
interface Product {
  [x: string]: ReactNode;
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
}
interface ProductResponse {
  products: Product[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Products() {
  // All state is managed in the parent "controller" component
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [filterOptions, setFilterOptions] = useState<{ categories: any[], subcategories: any[], companies: any[] }>({ categories: [], subcategories: [], companies: [] });

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Apply the debounce hook to the search term
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Effect to fetch static filter options once on component mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // This effect handles resetting to page 1 ONLY when filters change
  useEffect(() => {
    // Don't run on initial mount
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm, categoryFilter, subcategoryFilter, companyFilter, stockFilter])


  // This effect handles the actual data fetching whenever a dependency changes
  useEffect(() => {
    fetchProducts();
  }, [
    // Page & limit changes will trigger a refetch directly
    pagination.page,
    pagination.limit,
    // Filter changes will trigger a refetch via the effect above which changes the page to 1
    // and this effect will catch that page change.
    // We keep them here as dependencies to ensure fetches happen correctly if the page is already 1.
    debouncedSearchTerm,
    categoryFilter,
    subcategoryFilter,
    companyFilter,
    stockFilter,
  ]);

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm, // Use the debounced value for the API call
        category: categoryFilter,
        subcategory: subcategoryFilter,
        company: companyFilter,
        lowStock: stockFilter === 'low-stock' ? 'true' : 'false'
      });
      const response = await fetch(`/api/products/optimized?${params}`);
      if (response.ok) {
        const data: ProductResponse = await response.json();
        const startIndex = (data.pagination.page - 1) * data.pagination.limit;
        const productsWithIndex = (data.products || []).map((p, idx) => ({ ...p, index: startIndex + idx + 1 }));
        setProducts(productsWithIndex);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('');
    setSubcategoryFilter('');
    setCompanyFilter('');
    setStockFilter('all');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          Add Product
        </button>
      </div>

      <ProductFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        subcategoryFilter={subcategoryFilter}
        setSubcategoryFilter={setSubcategoryFilter}
        companyFilter={companyFilter}
        setCompanyFilter={setCompanyFilter}
        stockFilter={stockFilter}
        setStockFilter={setStockFilter}
        limit={pagination.limit}
        handleLimitChange={handleLimitChange}
        clearFilters={clearFilters}
        filterOptions={filterOptions}
      />

      <ProductTable
        products={products}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
      />

      <CreateProductModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          setShowCreateModal(false);
          fetchProducts(); // Refresh the product list
        }}
        filterOptions={filterOptions}
      />
    </div>
  );
}
