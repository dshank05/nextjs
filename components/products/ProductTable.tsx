import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, Image } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ClearableInput, ExportMenu, ImagePreviewModal } from '../common';
import { getLocalDateString } from '../../lib/date-utils';
import { ListPagination, ListSummary, SortIcon } from '../common/ListPagination';
import type { PaginationState } from '../../hooks/useListQuery';
import { useFilterOptions } from '../../hooks/useProducts';
import type { Product, ProductListFilters, FilterOptions } from '../../types/products';

const NO_OPTIONS: FilterOptions = { categories: [], subcategories: [], companies: [], models: [] };

type Filters = Omit<ProductListFilters, 'sortBy' | 'sortOrder'>;

interface ProductTableProps {
  products: Product[];
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  actionButton?: React.ReactNode;
  /** Every row matching the current filters, for export (S-89). */
  fetchAllForExport?: () => Promise<Product[]>;
  onApplyFilters?: (filters: ProductListFilters) => void;
  initialFilters?: ProductListFilters;
}

/** The API sends an ISO timestamp; format it here, in the viewer's timezone (PQ-38). */
const formatPurchaseDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-');

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
  const [filters, setFilters] = useState<Filters>({
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
  // Shared, cached filter options (PQ-29).
  const { data: filterOptions = NO_OPTIONS } = useFilterOptions();

  // The chosen category's subcategories, from the loaded filter options (PQ-07).
  const dynamicSubcategories = filters.categoryFilter
    ? filterOptions.subcategories
        .filter(sub => String(sub.category_id) === String(filters.categoryFilter))
        .map(sub => ({ id: String(sub.id), subcategory_name: sub.name }))
    : [];

  // Sort starts from what the page restored (PQ-09).
  const [sortBy, setSortBy] = useState<SortField>((initialFilters?.sortBy as SortField) || 'categoryName');
  const [sortOrder, setSortOrder] = useState<SortOrder>((initialFilters?.sortOrder as SortOrder) || 'asc');

  // Every filter control applies itself: update local state and hand the whole
  // set, with the current sort, to the page (PQ-26 - this was seven copies).
  const applyFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onApplyFilters?.({ ...next, sortBy, sortOrder });
  };

  // Image preview modal state
  const [imagePreviewModal, setImagePreviewModal] = useState({
    isOpen: false,
    productName: '',
    imageUrl: '',
    barcodeUrl: ''
  });

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

  // The subcategory is cleared where the user picks a category, not in an effect (PQ-10).

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
              { key: 'lastPurchaseDate', label: 'Last Purchase Date', enabled: true, format: (row: any) => formatPurchaseDate(row.lastPurchaseDate) },
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
              applyFilter({ uidFilter: newValue });
            }}
          />
        </div>

        {/* Category Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Categories' },
              ...filterOptions.categories.map(o => ({ id: String(o.id), name: o.name }))
            ]}
            selectedValue={filters.categoryFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              // A new category invalidates the chosen subcategory - cleared here,
              // on the user's pick, not in an effect (PQ-10).
              const subcategoryFilter = newValue === filters.categoryFilter ? filters.subcategoryFilter : '';
              applyFilter({ categoryFilter: newValue, subcategoryFilter });
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
              applyFilter({ subcategoryFilter: newValue });
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
              ...filterOptions.models.map(o => ({ id: String(o.id), name: o.name }))
            ]}
            selectedValue={filters.modelFilter.length > 0 ? filters.modelFilter[0] : ''}
            onSelectionChange={(value) => {
              const newValue = value || '';
              const newModelFilter = newValue ? [newValue] : [];
              applyFilter({ modelFilter: newModelFilter });
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
              ...filterOptions.companies.map(o => ({ id: String(o.id), name: o.name }))
            ]}
            selectedValue={filters.companyFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              applyFilter({ companyFilter: newValue });
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
              applyFilter({ partNoFilter: newValue });
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
              applyFilter({ quantityFilter: newValue });
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
              applyFilter({ startDate: start, endDate: end });
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() => {
              applyFilter({
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
              });
            }}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table Section */}
      <ListSummary pagination={pagination} shown={products.length} noun="products" />

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
                <td className="text-slate-300">{formatPurchaseDate(product.lastPurchaseDate)}</td>
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

      <ListPagination pagination={pagination} onPageChange={onPageChange} />

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
