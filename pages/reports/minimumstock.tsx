import { useState, useEffect } from 'react';
import { SearchableSelect, ClearableInput, ExportMenu } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';
import { AlertTriangle, Package, TrendingDown } from 'lucide-react';

interface LowStockProduct {
  id: number;
  product_name: string;
  hsn: string;
  part: string;
  current_stock: number;
  minimum_stock: number;
  reorder_level: number;
  reorder_quantity: number;
  unit: string;
  category_name: string;
  company_name: string;
  model_name: string;
  stock_status: string;
  shortage: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function MinimumStockPage() {
  const [products, setProducts] = useState<LowStockProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');

  const [categories, setCategories] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [pagination.page, searchTerm, categoryFilter, companyFilter, modelFilter]);

  const fetchFilterOptions = async () => {
    try {
      const [catRes, compRes, modRes] = await Promise.all([
        fetch('/api/categories'),
        fetch('/api/companies'),
        fetch('/api/models')
      ]);

      if (catRes.ok) {
        const data = await catRes.json();
        setCategories([{ id: '', category_name: 'All Categories' }, ...(data.categories || [])]);
      }
      if (compRes.ok) {
        const data = await compRes.json();
        setCompanies([{ id: '', company_name: 'All Companies' }, ...(data.companies || [])]);
      }
      if (modRes.ok) {
        const data = await modRes.json();
        setModels([{ id: '', model_name: 'All Models' }, ...(data.models || [])]);
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        categoryFilter,
        companyFilter,
        modelFilter
      });

      const response = await fetch(`/api/reports/minimum-stock?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('');
    setCompanyFilter('');
    setModelFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getStockStatusBadge = (status: string) => {
    switch (status) {
      case 'Out of Stock':
        return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Out of Stock</span>;
      case 'Below Minimum':
        return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Below Minimum</span>;
      case 'Below Reorder Level':
        return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Below Reorder</span>;
      default:
        return <span className="px-2 py-1 bg-slate-600 text-white text-xs rounded-full">{status}</span>;
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  // Calculate summary stats
  const outOfStockCount = products.filter(p => p.current_stock === 0).length;
  const belowMinimumCount = products.filter(p => p.current_stock > 0 && p.current_stock < p.minimum_stock).length;
  const totalShortage = products.reduce((sum, p) => sum + p.shortage, 0);

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-6">Minimum Stock Report</h1>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-red-900/30 border border-red-600 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-red-300 text-sm">Out of Stock</span>
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div className="text-3xl font-bold text-white">{outOfStockCount}</div>
          </div>

          <div className="bg-orange-900/30 border border-orange-600 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-orange-300 text-sm">Below Minimum</span>
              <TrendingDown className="w-5 h-5 text-orange-400" />
            </div>
            <div className="text-3xl font-bold text-white">{belowMinimumCount}</div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-300 text-sm">Total Products</span>
              <Package className="w-5 h-5 text-blue-400" />
            </div>
            <div className="text-3xl font-bold text-white">{pagination.total}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
            <ClearableInput
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
            <SearchableSelect
              options={categories.map(c => ({ id: c.id.toString(), name: c.category_name }))}
              selectedValue={categoryFilter}
              onSelectionChange={(value) => setCategoryFilter(value || '')}
              placeholder="Select category..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
            <SearchableSelect
              options={companies.map(c => ({ id: c.id.toString(), name: c.company_name }))}
              selectedValue={companyFilter}
              onSelectionChange={(value) => setCompanyFilter(value || '')}
              placeholder="Select company..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Model</label>
            <SearchableSelect
              options={models.map(m => ({ id: m.id.toString(), name: m.model_name }))}
              selectedValue={modelFilter}
              onSelectionChange={(value) => setModelFilter(value || '')}
              placeholder="Select model..."
            />
          </div>

          <div className="flex items-end gap-2">
            <button onClick={clearFilters} className="btn-secondary px-4 py-2">
              Clear Filters
            </button>
            <ExportMenu
              data={products}
              columns={[
                { key: 'product_name', label: 'Product Name', enabled: true },
                { key: 'hsn', label: 'HSN', enabled: true },
                { key: 'current_stock', label: 'Current Stock', enabled: true },
                { key: 'minimum_stock', label: 'Minimum Stock', enabled: true },
                { key: 'shortage', label: 'Shortage', enabled: true },
                { key: 'reorder_quantity', label: 'Reorder Qty', enabled: true },
                { key: 'category_name', label: 'Category', enabled: true },
                { key: 'company_name', label: 'Company', enabled: true },
                { key: 'stock_status', label: 'Status', enabled: true }
              ]}
              config={{
                title: 'Minimum Stock Report',
                fileName: `Minimum_Stock_Report_${getLocalDateString()}`
              }}
            />
          </div>
        </div>

        {/* Pagination Info */}
        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {products.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} products
            </div>
            <div>Page {pagination.page} of {pagination.totalPages}</div>
          </div>
        )}

        {/* Table */}
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
                <th>Product Name</th>
                <th>HSN</th>
                <th>Category</th>
                <th>Company</th>
                <th>Current Stock</th>
                <th>Minimum Stock</th>
                <th>Shortage</th>
                <th>Reorder Qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, idx) => (
                <tr key={product.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{product.product_name}</td>
                  <td className="text-slate-300">{product.hsn || 'N/A'}</td>
                  <td className="text-slate-300">{product.category_name}</td>
                  <td className="text-slate-300">{product.company_name}</td>
                  <td className={`font-semibold ${product.current_stock === 0 ? 'text-red-400' : 'text-slate-300'}`}>
                    {product.current_stock} {product.unit}
                  </td>
                  <td className="text-slate-300">{product.minimum_stock} {product.unit}</td>
                  <td className="text-orange-400 font-semibold">{product.shortage} {product.unit}</td>
                  <td className="text-blue-400">{product.reorder_quantity} {product.unit}</td>
                  <td>{getStockStatusBadge(product.stock_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              No low stock products found.
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page === 1}
              className="btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <div className="flex space-x-2">
              {pagination.page > 3 && (
                <>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: 1 }))}
                    className="px-3 py-1 rounded hover:bg-slate-700"
                  >
                    1
                  </button>
                  <span>...</span>
                </>
              )}
              {getPageNumbers().map(p => (
                <button
                  key={p}
                  onClick={() => setPagination(prev => ({ ...prev, page: p }))}
                  className={`px-3 py-1 rounded ${
                    p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
              {pagination.page < pagination.totalPages - 2 && (
                <>
                  <span>...</span>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: pagination.totalPages }))}
                    className="px-3 py-1 rounded hover:bg-slate-700"
                  >
                    {pagination.totalPages}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page === pagination.totalPages}
              className="btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
