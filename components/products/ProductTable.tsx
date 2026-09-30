import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, Image } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ClearableInput, ExportMenu, ImagePreviewModal } from '../common';
import { getLocalDateString } from '../../lib/date-utils';
import { ListPagination, ListSummary, SortIcon } from '../common/ListPagination';

interface Product {
  id: number;
  product_name: string;
  stock?: number;
  min_stock?: number;
  rate?: number;
  part_no?: string;
  categoryName?: string;
  companyName?: string;
  latestPurchaseRate?: number;
  lastPurchaseDate?: string;
  carModelsDisplay?: string;
  subcategoryName?: string;
  pic?: string; // Product image URL
  barcode?: string; // Barcode image URL
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string; category_id?: number | null }[];
  companies: { id: string; name: string }[];
  models: { id: string; name: string }[];
}

interface ProductTableProps {
  products: Product[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  actionButton?: React.ReactNode;
  /** Every row matching the current filters, for export (S-89). */
  fetchAllForExport?: () => Promise<Product[]>;
  onApplyFilters?: (filters: {
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
    sortBy?: string;
    sortOrder?: string;
  }) => void;
  initialFilters?: {
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
    sortBy?: string;
    sortOrder?: string;
  };
}

type SortField = 'id' | 'categoryName' | 'companyName' | 'subcategoryName' | 'part_no' | 'stock' | 'rate' | 'lastPurchaseDate';
type SortOrder = 'asc' | 'desc';

export const ProductTable: React.FC<ProductTableProps> = ({
  products,
  pagination,
  loading,
  onPageChange,
  searchTerm,
  onSearchChange,
  actionButton,
  onApplyFilters,
  initialFilters,
  fetchAllForExport
}) => {
  // Consolidated filter state - initialize with initialFilters if provided
  const [filters, setFilters] = useState({
    categoryFilter: initialFilters?.categoryFilter || '',
    subcategoryFilter: initialFilters?.subcategoryFilter || '',
    modelFilter: initialFilters?.modelFilter || [],
    companyFilter: initialFilters?.companyFilter || '',
    quantityFilter: initialFilters?.quantityFilter || '',
    stockFilter: initialFilters?.stockFilter || 'all',
    startDate: initialFilters?.startDate || '',
    endDate: initialFilters?.endDate || '',
    uidFilter: initialFilters?.uidFilter || '',
    partNoFilter: initialFilters?.partNoFilter || ''
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // Subcategories of the chosen category, from the filter options already
  // loaded (each carries its category_id). This fetched the paginated
  // subcategories endpoint, which stops at 50 (PQ-07).
  const dynamicSubcategories = filters.categoryFilter
    ? filterOptions.subcategories
        .filter(sub => String(sub.category_id) === String(filters.categoryFilter))
        .map(sub => ({ id: String(sub.id), subcategory_name: sub.name }))
    : [];

  // Sort, starting from what the page restored. It always started at
  // categoryName/asc, so the arrow disagreed with the list after returning to
  // it, and the next filter change re-sent the default sort (PQ-09).
  const [sortBy, setSortBy] = useState<SortField>((initialFilters?.sortBy as SortField) || 'categoryName');
  const [sortOrder, setSortOrder] = useState<SortOrder>((initialFilters?.sortOrder as SortOrder) || 'asc');

  // Image preview modal state
  const [imagePreviewModal, setImagePreviewModal] = useState({
    isOpen: false,
    productName: '',
    imageUrl: '',
    barcodeUrl: ''
  });

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Update filters when initialFilters change
  useEffect(() => {
    if (initialFilters) {
      setFilters({
        categoryFilter: initialFilters.categoryFilter || '',
        subcategoryFilter: initialFilters.subcategoryFilter || '',
        modelFilter: initialFilters.modelFilter || [],
        companyFilter: initialFilters.companyFilter || '',
        quantityFilter: initialFilters.quantityFilter || '',
        stockFilter: initialFilters.stockFilter || 'all',
        startDate: initialFilters.startDate || '',
        endDate: initialFilters.endDate || '',
        uidFilter: initialFilters.uidFilter || '',
        partNoFilter: initialFilters.partNoFilter || ''
      });
      if (initialFilters.sortBy) setSortBy(initialFilters.sortBy as SortField);
      if (initialFilters.sortOrder) setSortOrder(initialFilters.sortOrder as SortOrder);
    }
  }, [initialFilters]);

  // No effect clears the subcategory when the category changes. It fired on
  // mount with the restored category and wiped the restored subcategory - F-88's
  // mechanism, on the list. The clear happens where the user picks a category
  // (PQ-10).

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };




  // Sorting logic - now triggers API re-fetch
  const handleSort = (field: SortField) => {
    const newSortBy = field;
    const newSortOrder = (sortBy === field && sortOrder === 'asc') ? 'desc' : 'asc';

    setSortBy(newSortBy);
    setSortOrder(newSortOrder);

    // Trigger API re-fetch with new sort parameters
    if (onApplyFilters) {
      onApplyFilters({
        ...filters,
        sortBy: newSortBy,
        sortOrder: newSortOrder
      });
    }
  };



  return (
    <div className="card">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div className="flex-1 max-w-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
          <ClearableInput
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            data={products.map((product, idx) => ({ ...product, serialNumber: (pagination.page - 1) * pagination.limit + idx + 1 }))}
            // Export every matching row, not only the page on screen (S-89).
            fetchAll={fetchAllForExport
              ? async () => (await fetchAllForExport()).map((product, idx) => ({ ...product, serialNumber: idx + 1 }))
              : undefined}
            columns={[
              { key: 'serialNumber', label: 'S.N', enabled: true },
              { key: 'id', label: 'UID', enabled: true },
              { key: 'product_name', label: 'Product Name', enabled: true },
              { key: 'categoryName', label: 'Category', enabled: true },
              { key: 'subcategoryName', label: 'Subcategory', enabled: true },
              { key: 'carModelsDisplay', label: 'Car Models', enabled: true },
              { key: 'companyName', label: 'Company', enabled: true },
              { key: 'part_no', label: 'Part Number', enabled: true },
              { key: 'stock', label: 'Stock Quantity', enabled: true },
              { key: 'rate', label: 'Rate', enabled: true },
              { key: 'lastPurchaseDate', label: 'Last Purchase Date', enabled: true },
            ]}
            config={{
              title: 'Product Report',
              fileName: `Product_Report_${getLocalDateString()}`,
              dropdownOptions: {
                'Category': filterOptions.categories.map(cat => cat.name),
                'Subcategory': dynamicSubcategories.map(sub => sub.subcategory_name),
                'Company': filterOptions.companies.map(comp => comp.name),
                'Car Models': filterOptions.models.map(model => model.name)
              }
            }}
          />
          {actionButton && (
            <div className="flex-shrink-0">
              {actionButton}
            </div>
          )}
        </div>
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-10 gap-4 mb-4">
        {/* UID Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">UID</label>
          <ClearableInput
            type="text"
            placeholder="Enter ID..."
            value={filters.uidFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, uidFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  uidFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
          />
        </div>

        {/* Category Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Categories' },
              ...filterOptions.categories
            ]}
            selectedValue={filters.categoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              // A new category invalidates the chosen subcategory - cleared here,
              // on the user's pick, not in an effect (PQ-10).
              const subcategoryFilter = newValue === filters.categoryFilter ? filters.subcategoryFilter : '';
              setFilters(prev => ({ ...prev, categoryFilter: newValue, subcategoryFilter }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  categoryFilter: newValue,
                  subcategoryFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select category..."
          />
        </div>

        {/* Subcategory Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Subcategories' },
              ...dynamicSubcategories.map(sub => ({ id: sub.id, name: sub.subcategory_name }))
            ]}
            selectedValue={filters.subcategoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setFilters(prev => ({ ...prev, subcategoryFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  subcategoryFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder={filters.categoryFilter ? "Select subcategory..." : "Select a category first"}
            disabled={!filters.categoryFilter}
          />
        </div>

        {/* Car Models Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Car Models</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Car Models' },
              ...filterOptions.models
            ]}
            selectedValue={filters.modelFilter.length > 0 ? filters.modelFilter[0] : ''}
            onSelectionChange={(value) => {
              const newValue = value || '';
              const newModelFilter = newValue ? [newValue] : [];
              setFilters(prev => ({ ...prev, modelFilter: newModelFilter }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  modelFilter: newModelFilter,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select car model..."
          />
        </div>

        {/* Company Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Companies' },
              ...filterOptions.companies
            ]}
            selectedValue={filters.companyFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setFilters(prev => ({ ...prev, companyFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  companyFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select company..."
          />
        </div>

        {/* Part No Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Part No</label>
          <ClearableInput
            type="text"
            placeholder="Enter part number..."
            value={filters.partNoFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, partNoFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  partNoFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
          />
        </div>

        {/* Quantity Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Quantity</label>
          <ClearableInput
            type="number"
            placeholder="Enter quantity..."
            value={filters.quantityFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, quantityFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  quantityFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Date Range Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
          <DateRangeFilter
            startDate={filters.startDate}
            endDate={filters.endDate}
            onDateChange={(start, end) => {
              setFilters(prev => ({ ...prev, startDate: start, endDate: end }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  startDate: start,
                  endDate: end,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() => {
              const clearedFilters = {
                categoryFilter: '',
                subcategoryFilter: '',
                modelFilter: [],
                companyFilter: '',
                quantityFilter: '',
                stockFilter: 'all',
                startDate: '',
                endDate: '',
                uidFilter: '',
                partNoFilter: ''
              };
              setFilters(clearedFilters);
              // Apply cleared filters
              if (onApplyFilters) {
                onApplyFilters({
                  ...clearedFilters,
                  sortBy,
                  sortOrder
                });
              }
            }}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table Section */}
      <ListSummary pagination={{ ...pagination, hasMore: pagination.page < pagination.totalPages }} shown={products.length} noun="products" />

      <div className="overflow-x-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        )}

        <table className="table">
          <thead>
            <tr>
              <th>S.N</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('id')}>
                UID <SortIcon field="id" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('categoryName')}>
                Category <SortIcon field="categoryName" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('subcategoryName')}>
                Subcategory <SortIcon field="subcategoryName" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th>Car Models</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('companyName')}>
                Company <SortIcon field="companyName" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('part_no')}>
                Part Number <SortIcon field="part_no" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('stock')}>
                Stock <SortIcon field="stock" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('rate')}>
                Rate <SortIcon field="rate" sortBy={sortBy} sortOrder={sortOrder} />
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('lastPurchaseDate')}>
                Last Purchase Date <SortIcon field="lastPurchaseDate" sortBy={sortBy} sortOrder={sortOrder} />
              </th>

              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, idx) => (
              <tr key={product.id}>
                {/* Offset by the page; this restarted at 1 on every page (S-14). */}
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="text-slate-400 text-sm">{product.id}</td>
                <td className="text-slate-300">{product.categoryName || '-'}</td>
                <td className="text-slate-300">{product.subcategoryName || '-'}</td>
                <td className="text-slate-300 min-w-32">
                  {product.carModelsDisplay ? (
                    <div className="flex flex-wrap gap-1">
                      {product.carModelsDisplay.split(', ').map((model: string, index: number) => (
                        <span
                          key={index}
                          className="px-2 py-1 bg-blue-600/20 text-blue-300 rounded-full border border-blue-500/30"
                        >
                          {model.trim()}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )}
                </td>
                <td className="text-slate-300">{product.companyName || '-'}</td>
                <td className="text-slate-300">{product.part_no || '-'}</td>
                <td className="text-slate-300">{product.stock || 0}</td>
                <td className="text-slate-300">₹{product.latestPurchaseRate || product.rate || 0}</td>
                <td className="text-slate-300">{product.lastPurchaseDate || '-'}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <Link href={`/products/view/${product.id}`} title="View Product Details" className="btn-icon text-slate-300">
                      <Eye className="w-4 h-4" />
                    </Link>
                    {(product.pic || product.barcode) && (
                      <button
                        onClick={() => setImagePreviewModal({
                          isOpen: true,
                          productName: product.product_name,
                          imageUrl: product.pic || '',
                          barcodeUrl: product.barcode || ''
                        })}
                        className="btn-icon text-blue-400 hover:text-blue-300 transition-colors"
                        title="View Product Media"
                      >
                        <Image className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {products.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No products found with the current filters.</div>
        )}
      </div>

      <ListPagination pagination={{ ...pagination, hasMore: pagination.page < pagination.totalPages }} onPageChange={onPageChange} />

      {/* Image Preview Modal */}
      <ImagePreviewModal
        isOpen={imagePreviewModal.isOpen}
        onClose={() => setImagePreviewModal(prev => ({ ...prev, isOpen: false }))}
        imageUrl={imagePreviewModal.imageUrl}
        barcodeUrl={imagePreviewModal.barcodeUrl}
        productName={imagePreviewModal.productName}
      />

    </div>
  );
};
