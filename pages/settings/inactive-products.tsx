import { useState, useEffect } from 'react';
import { useUrlState } from '../../hooks/useUrlState';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ClearableInput, ExportMenu } from '../../components/common';

interface Product {
  id: number;
  product_name: string;
  stock?: number;
  min_stock?: number;
  part_no?: string;
  categoryName?: string;
  companyName?: string;
  subcategoryName?: string;
  is_active?: boolean;
}

interface ProductsResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export default function InactiveProducts() {
  const { showSnackbar } = useSnackbar();
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
    hasMore: false
  });
  const [loading, setLoading] = useState(true);
  // Mirrored in the URL so search and sort survive a refresh and a return
  // from an edit, and so a filtered list can be linked (F-49).
  const [searchTerm, setSearchTerm] = useUrlState<string>('search', '');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useUrlState<string>('sortBy', 'product_name');
  const [sortOrder, setSortOrder] = useUrlState<'asc' | 'desc'>('sortOrder', 'asc');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchInactiveProducts();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
      setPagination(prev => ({ ...prev, page: 1 })); // a result on page 3 of the old order means nothing in the new one (S-13)
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const fetchInactiveProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        // The debounced term, not the raw one (S-12).
        search: debouncedSearchTerm.trim(),
        // S-34: ask the database for inactive products. This used to request
        // `includeInactive=true` - which returns BOTH - and then filter the page
        // in the browser. With 601 of 602 products active and the list ordered
        // by id descending, page one was almost entirely active rows, so the
        // screen looked empty however many inactive products there were. The
        // pagination was then recomputed from the filtered count, which made it
        // meaningless as well.
        isActive: 'false',
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/products?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ProductsResponse = await response.json();

      setProducts(data.products);
      setPagination(data.pagination);

    } catch (error) {
      console.error('Error fetching inactive products:', error);
      showSnackbar('error', 'Could not load inactive products');
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

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleReactivate = (product: Product) => {
    setSelectedProduct(product);
    setShowConfirmModal(true);
  };

  const handleConfirmReactivate = async () => {
    if (!selectedProduct) return;

    setConfirmLoading(true);

    try {
      // The status route, not PUT /api/products/[id] - see F-91. This screen is
      // the one the deactivate message points people at ("can be restored from
      // Inactive Products"), and until now the button here always failed.
      const response = await fetch(`/api/products/${selectedProduct.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: true }),
      });

      if (response.ok) {
        setShowConfirmModal(false);
        setSelectedProduct(null);
        fetchInactiveProducts(); // Refresh the list
        showSnackbar('success', 'Product reactivated successfully!');
      } else {
        const errorData = await response.json();
        showSnackbar('error', `Failed to reactivate product: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error reactivating product:', error);
      showSnackbar('error', `Failed to reactivate product: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCancelReactivate = () => {
    if (!confirmLoading) {
      setShowConfirmModal(false);
      setSelectedProduct(null);
    }
  };

  return (
    <div className="space-y-6">

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Inactive Products</label>
              <ClearableInput
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-40">
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-end space-x-2 mb-2">
          <ExportMenu
            data={products}
            columns={[
              { key: 'product_name', label: 'Product Name', enabled: true },
              { key: 'part_no', label: 'Part Number', enabled: true },
              { key: 'categoryName', label: 'Category', enabled: true },
              { key: 'companyName', label: 'Company', enabled: true },
              { key: 'stock', label: 'Stock', enabled: true },
            ]}
            config={{
              title: 'Inactive Products Report',
              fileName: 'Inactive_Products'
            }}
          />
        </div>
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {products.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} inactive products</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('product_name')}>
                      Product Name {getSortIcon('product_name')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('part_no')}>
                      Part Number {getSortIcon('part_no')}
                    </th>
                    {/* S-36: Category and Company are not sortable columns on
                        `product` - they are joined names, and these headers used
                        to sort by the raw foreign key while displaying the text.
                        Plain headings until the endpoint can sort on the join. */}
                    <th>Category</th>
                    <th>Company</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('stock')}>
                      Stock {getSortIcon('stock')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={product.id}>
                      <td>{(pagination.page - 1) * pagination.limit + index + 1}</td>
                      <td className="font-medium text-white">{product.product_name}</td>
                      <td>{product.part_no || 'N/A'}</td>
                      <td>{product.categoryName || 'N/A'}</td>
                      <td>{product.companyName || 'N/A'}</td>
                      <td>{product.stock || 0}</td>
                      <td className="text-right">
                        <button
                          className="btn-primary"
                          onClick={() => handleReactivate(product)}
                          title="Reactivate Product"
                        >
                          ✅ Reactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {products.length === 0 && !loading && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">📦</div>
                  <h3 className="text-lg font-semibold text-white mb-2">No inactive products found</h3>
                  <p className="text-slate-400">All products are currently active.</p>
                </div>
              )}
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                <button onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
                <div className="flex space-x-2">
                  {pagination.page > 3 && <> <button onClick={() => handlePageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
                  {getPageNumbers().map(p => <button key={p} onClick={() => handlePageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
                  {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => handlePageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
                </div>
                <button onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Reactivate Product"
        message={selectedProduct ? `Are you sure you want to reactivate "${selectedProduct.product_name}"?` : ''}
        confirmText="Reactivate"
        showLoading={confirmLoading}
        onConfirm={handleConfirmReactivate}
        onCancel={handleCancelReactivate}
      />
    </div>
  );
}
