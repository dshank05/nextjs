// In components/products/ProductTable.tsx

import { ReactNode } from 'react';

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

export const ProductTable = ({ products, pagination, loading, onPageChange }: ProductTableProps) => {

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
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
              <th>Product Name</th>
              <th>Category</th>
              <th>Car Model</th>
              <th>Company</th>
              <th>Part Number</th>
              <th>Stock</th>
              <th>Rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.index}</td>
                <td className="text-slate-400 text-sm">{product.id}</td>
                <td className="font-medium text-white">{product.product_name}</td>
                <td className="text-slate-300">{product.categoryName || '-'}</td>
                <td className="text-slate-300 min-w-48">{product.subcategoryNames ? (
                  <div className="flex flex-wrap gap-1">
                    {product.subcategoryNames.split(', ').map((model, index) => (
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