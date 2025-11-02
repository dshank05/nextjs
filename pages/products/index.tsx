import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ProductTable } from '../../components/products/ProductTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';

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
}

interface ProductResponse {
  products: Product[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Products() {
  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'product_name', label: 'Product Name', enabled: true },
    { key: 'part_no', label: 'Part No', enabled: true },
    { key: 'stock', label: 'Stock', enabled: true },
    { key: 'rate', label: 'Rate', enabled: true },
    { key: 'categoryName', label: 'Category', enabled: true },
    { key: 'companyName', label: 'Company', enabled: true },
  ];

  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentFilters, setCurrentFilters] = useState<{
    categoryFilter: string;
    subcategoryFilter: string;
    modelFilter: string[];
    companyFilter: string;
    stockFilter: string;
    startDate: string;
    endDate: string;
    uidFilter: string;
    partNoFilter: string;
  }>({
    categoryFilter: '',
    subcategoryFilter: '',
    modelFilter: [],
    companyFilter: '',
    stockFilter: 'all',
    startDate: '',
    endDate: '',
    uidFilter: '',
    partNoFilter: ''
  });

  // Fetch products when pagination, search, or filters change
  useEffect(() => {
    fetchProducts();
  }, [pagination.page, pagination.limit, searchTerm, currentFilters]);

  // Listen for broadcast messages to refresh data when products are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'products' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Product ${msg.type} in another tab, refreshing data...`);
        fetchProducts();
      }
    });

    return unsubscribe;
  }, []);

  const fetchProducts = async () => {
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
        lowStock: currentFilters.stockFilter === 'low' ? 'true' : 'false',
        startDate: currentFilters.startDate,
        endDate: currentFilters.endDate,
        uid: currentFilters.uidFilter,
        part_no: currentFilters.partNoFilter
      });

      const response = await fetch(`/api/products/optimized?${params}`);
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
        subcategoryName: product.subcategoryName
      }));

      setProducts(transformedProducts);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch products:', err);
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

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Product Report',
        fileName: `Product_Report_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, products, config);
    } else {
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    const exportData = products.map(product => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = product.id;
            break;
          case 'product_name':
            row['Product Name'] = product.product_name || '';
            break;
          case 'part_no':
            row['Part No'] = product.part_no || '';
            break;
          case 'stock':
            row.Stock = product.stock || 0;
            break;
          case 'rate':
            row.Rate = product.rate || 0;
            break;
          case 'categoryName':
            row.Category = product.categoryName || '';
            break;
          case 'companyName':
            row.Company = product.companyName || '';
            break;
        }
      });
      return row;
    });

    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Product Report',
      fileName: `Product_Report_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  // Handle filter application
  const handleApplyFilters = (filters: {
    categoryFilter: string;
    subcategoryFilter: string;
    modelFilter: string[];
    companyFilter: string;
    stockFilter: string;
    startDate: string;
    endDate: string;
    uidFilter: string;
    partNoFilter: string;
  }) => {
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
        onExport={handleExport}
        onApplyFilters={handleApplyFilters}
        actionButton={
          <a
            href="/products/create"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Add Product
          </a>
        }
      />

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />
    </div>
  );
}
