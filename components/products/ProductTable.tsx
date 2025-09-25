// In components/products/ProductTable.tsx

import { ReactNode, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye } from 'lucide-react';

// Define types for props
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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ProductTableProps {
  products: Product[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
}

type SortField = 'product_name' | 'categoryName' | 'companyName' | 'part_no' | 'stock' | 'rate';
type SortOrder = 'asc' | 'desc';

export const ProductTable = ({ products, pagination, loading, onPageChange }: ProductTableProps) => {
  const [sortBy, setSortBy] = useState<SortField>('product_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

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
        case 'product_name':
          aValue = a.product_name?.toString().toLowerCase() || '';
          bValue = b.product_name?.toString().toLowerCase() || '';
          break;
        case 'categoryName':
          aValue = a.categoryName?.toString().toLowerCase() || '';
          bValue = b.categoryName?.toString().toLowerCase() || '';
          break;
        case 'companyName':
          aValue = a.companyName?.toString().toLowerCase() || '';
          bValue = b.companyName?.toString().toLowerCase() || '';
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
      return <ArrowUpDown className="inline w-4 h-4 ml-1" />;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  if (loading) {
    return (
      <div className="card h-[600px] flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
        <div>Showing {products.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} products</div>
        <div>Page {pagination.page} of {pagination.totalPages}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>S.N</th>
              <th>UID</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('product_name')}>
                Product Name {getSortIcon('product_name')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('categoryName')}>
                Category {getSortIcon('categoryName')}
              </th>
              <th>Subcategory</th>
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
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((product, idx) => (
              <tr key={product.id}>
                <td>{idx + 1}</td>
                <td className="text-slate-400 text-sm">{product.id}</td>
                <td className="font-medium text-white">{product.product_name}</td>
                <td className="text-slate-300">{product.categoryName || '-'}</td>
                <td className="text-slate-300">{(product as any).subcategoryName || '-'}</td>
                <td className="text-slate-300 min-w-32">{(product as any).carModelsDisplay ? (
                  <div className="flex flex-wrap gap-1">
                    {(product as any).carModelsDisplay.split(', ').map((model: string, index: number) => (
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
                )}</td>
                <td className="text-slate-300">{product.companyName || '-'}</td>
                <td className="text-slate-300">{product.part_no || '-'}</td>
                <td className="text-slate-300">{product.stock || 0}</td>
                <td className="text-slate-300">₹{product.latestPurchaseRate || product.rate || 0}</td>
                <td>{(product.stock || 0) === 0 ? (
                  <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full font-semibold">
                    🚨 Out of Stock
                  </span>
                ) : (product.stock || 0) < 2 || (product.stock || 0) < (product.min_stock || 0) ? (
                  <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">
                    ⚠️ Low Stock
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                    ✅ In Stock
                  </span>
                )}</td>
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
