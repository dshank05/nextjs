import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, ChevronDown, X, Check } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ClearableInput, ExportMenu } from '../common';

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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string }[];
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
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
  actionButton?: React.ReactNode;
  onExport?: (exportType: 'excel' | 'pdf') => void;
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
  itemsPerPage,
  onItemsPerPageChange,
  actionButton,
  onExport,
  onApplyFilters
}) => {
  // Consolidated filter state
  const [filters, setFilters] = useState({
    categoryFilter: '',
    subcategoryFilter: '',
    modelFilter: [] as string[],
    companyFilter: '',
    quantityFilter: '',
    stockFilter: 'all',
    startDate: '',
    endDate: '',
    uidFilter: '',
    partNoFilter: ''
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // UI states for dropdowns - no longer needed after migration

  // Dynamic subcategories state
  const [dynamicSubcategories, setDynamicSubcategories] = useState<{ id: string; subcategory_name: string; category_id?: number; index?: number }[]>([]);
  const [dynamicSubcategoriesLoading, setDynamicSubcategoriesLoading] = useState(false);

  // Sorting states - now using backend sorting
  const [sortBy, setSortBy] = useState<SortField>('categoryName');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Debounced search
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Fetch dynamic subcategories when category changes
  useEffect(() => {
    if (filters.categoryFilter) {
      fetchDynamicSubcategories(filters.categoryFilter);
      setFilters(prev => ({ ...prev, subcategoryFilter: '' }));
    } else {
      setDynamicSubcategories([]);
    }
  }, [filters.categoryFilter]);

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchDynamicSubcategories = async (categoryId: string) => {
    if (!categoryId) {
      setDynamicSubcategories([]);
      return;
    }

    setDynamicSubcategoriesLoading(true);
    try {
      const response = await fetch(`/api/products/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setDynamicSubcategories(data.subcategories || []);
      } else {
        console.error('Failed to fetch subcategories:', response.status);
        setDynamicSubcategories([]);
      }
    } catch (error) {
      console.error('Error fetching dynamic subcategories:', error);
      setDynamicSubcategories([]);
    } finally {
      setDynamicSubcategoriesLoading(false);
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

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
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
            data={products.map((product, idx) => ({ ...product, serialNumber: idx + 1 }))}
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
              fileName: `Product_Report_${new Date().toISOString().split('T')[0]}`,
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
      <div className="flex flex-wrap gap-4 mb-4">
        {/* UID Filter */}
        <div className="w-32 flex-shrink-0">
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
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Categories' },
              ...filterOptions.categories
            ]}
            selectedValue={filters.categoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setFilters(prev => ({ ...prev, categoryFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  categoryFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select category..."
          />
        </div>

        {/* Subcategory Filter */}
        <div className="flex-1 min-w-0">
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
            placeholder={filters.categoryFilter ? (dynamicSubcategoriesLoading ? "Loading..." : "Select subcategory...") : "Select a category first"}
            disabled={!filters.categoryFilter}
          />
        </div>

        {/* Car Models Filter */}
        <div className="flex-1 min-w-0">
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
        <div className="flex-1 min-w-0">
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
        <div className="flex-1 min-w-0">
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
        <div className="w-32 flex-shrink-0">
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
        <div className="flex-1 min-w-0">
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
      </div>

      {/* Table Section */}
      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {products.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} products</div>
          <div>Page {pagination.page} of {pagination.totalPages}</div>
        </div>
      )}

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
                UID {getSortIcon('id')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('categoryName')}>
                Category {getSortIcon('categoryName')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('subcategoryName')}>
                Subcategory {getSortIcon('subcategoryName')}
              </th>
              <th>Car Models</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('companyName')}>
                Company {getSortIcon('companyName')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('part_no')}>
                Part Number {getSortIcon('part_no')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('stock')}>
                Stock {getSortIcon('stock')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('rate')}>
                Rate {getSortIcon('rate')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('lastPurchaseDate')}>
                Last Purchase Date {getSortIcon('lastPurchaseDate')}
              </th>

              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, idx) => (
              <tr key={product.id}>
                <td>{idx + 1}</td>
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
                  <Link href={`/products/view/${product.id}`} title="View Product Details" className="btn-icon text-slate-300">
                    <Eye className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {products.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No products found with the current filters.</div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
          <button onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
          <div className="flex space-x-2">
            {pagination.page > 3 && <> <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
            {getPageNumbers().map(p => <button key={p} onClick={() => onPageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
            {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
          </div>
          <button onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
        </div>
      )}

    </div>
  );
};
