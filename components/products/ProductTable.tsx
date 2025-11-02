import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, ChevronDown, X, Check } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';

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
    stockFilter: string;
    startDate: string;
    endDate: string;
    uidFilter: string;
    partNoFilter: string;
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
  // Filter states
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [modelFilter, setModelFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [uidFilter, setUidFilter] = useState('');
  const [partNoFilter, setPartNoFilter] = useState('');
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

  // Sorting states
  const [sortBy, setSortBy] = useState<SortField>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Debounced search
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Fetch dynamic subcategories when category changes
  useEffect(() => {
    if (categoryFilter) {
      fetchDynamicSubcategories(categoryFilter);
      setSubcategoryFilter('');
    } else {
      setDynamicSubcategories([]);
    }
  }, [categoryFilter]);

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



  // Sorting logic
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case 'id':
          aValue = a.id || 0;
          bValue = b.id || 0;
          break;
        case 'categoryName':
          aValue = a.categoryName?.toString().toLowerCase() || '';
          bValue = b.categoryName?.toString().toLowerCase() || '';
          break;
        case 'companyName':
          aValue = a.companyName?.toString().toLowerCase() || '';
          bValue = b.companyName?.toString().toLowerCase() || '';
          break;
        case 'subcategoryName':
          aValue = a.subcategoryName?.toString().toLowerCase() || '';
          bValue = b.subcategoryName?.toString().toLowerCase() || '';
          break;
        case 'part_no':
          aValue = a.part_no?.toString().toLowerCase() || '';
          bValue = b.part_no?.toString().toLowerCase() || '';
          break;
        case 'stock':
          aValue = a.stock || 0;
          bValue = b.stock || 0;
          break;
        case 'rate':
          aValue = a.latestPurchaseRate || a.rate || 0;
          bValue = b.latestPurchaseRate || b.rate || 0;
          break;
        case 'lastPurchaseDate':
          aValue = a.lastPurchaseDate || '';
          bValue = b.lastPurchaseDate || '';
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [products, sortBy, sortOrder]);

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
      <div className="flex items-center justify-end gap-2 mb-4">
        {onExport && (
          <>
            <button className="btn-secondary" onClick={() => onExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => onExport('pdf')}>
              📄 Export PDF
            </button>
          </>
        )}
        {actionButton && (
          <div className="flex-shrink-0">
            {actionButton}
          </div>
        )}
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4 mb-4">
        {/* UID Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">UID</label>
          <input
            type="text"
            placeholder="Enter product ID..."
            value={uidFilter}
            onChange={(e) => {
              setUidFilter(e.target.value);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter,
                  subcategoryFilter,
                  modelFilter,
                  companyFilter,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter: e.target.value,
                  partNoFilter
                });
              }
            }}
            className="input w-full"
          />
        </div>

        {/* Search Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Category Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Categories' },
              ...filterOptions.categories
            ]}
            selectedValue={categoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setCategoryFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter: newValue,
                  subcategoryFilter,
                  modelFilter,
                  companyFilter,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter,
                  partNoFilter
                });
              }
            }}
            placeholder="Select category..."
          />
        </div>

        {/* Subcategory Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Subcategories' },
              ...dynamicSubcategories.map(sub => ({ id: sub.id, name: sub.subcategory_name }))
            ]}
            selectedValue={subcategoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setSubcategoryFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter,
                  subcategoryFilter: newValue,
                  modelFilter,
                  companyFilter,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter,
                  partNoFilter
                });
              }
            }}
            placeholder={categoryFilter ? (dynamicSubcategoriesLoading ? "Loading..." : "Select subcategory...") : "Select a category first"}
            className={!categoryFilter ? 'opacity-50 cursor-not-allowed' : ''}
          />
        </div>

        {/* Car Models Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Car Models</label>
          <SearchableMultiSelect
            options={filterOptions.models}
            selectedValues={modelFilter}
            onSelectionChange={(values) => {
              setModelFilter(values);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter,
                  subcategoryFilter,
                  modelFilter: values,
                  companyFilter,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter,
                  partNoFilter
                });
              }
            }}
            placeholder="Select car models..."
          />
        </div>

        {/* Company Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Companies' },
              ...filterOptions.companies
            ]}
            selectedValue={companyFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setCompanyFilter(newValue);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter,
                  subcategoryFilter,
                  modelFilter,
                  companyFilter: newValue,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter,
                  partNoFilter
                });
              }
            }}
            placeholder="Select company..."
          />
        </div>

        {/* Part No Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Part No</label>
          <input
            type="text"
            placeholder="Enter part number..."
            value={partNoFilter}
            onChange={(e) => {
              setPartNoFilter(e.target.value);
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  categoryFilter,
                  subcategoryFilter,
                  modelFilter,
                  companyFilter,
                  stockFilter,
                  startDate,
                  endDate,
                  uidFilter,
                  partNoFilter: e.target.value
                });
              }
            }}
            className="input w-full"
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

              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((product, idx) => (
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
                          className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full border border-blue-500/30"
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
                <td>
                  <Link href={`/products/view/${product.id}`} title="View Product Details" className="btn-icon text-slate-300">
                    <Eye className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedProducts.length === 0 && !loading && (
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
