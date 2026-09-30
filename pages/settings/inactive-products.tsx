import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ClearableInput, ExportMenu } from '../../components/common';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';

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
  // Search, sort, page and limit: the shared list hook (§7b).
  // S-34: ask the database for inactive products. This used to request
  // `includeInactive=true` - which returns BOTH - and then filter the page in
  // the browser, so page one was almost entirely active rows and the screen
  // looked empty however many inactive products there were.
  const list = useListQuery({ defaultSort: 'product_name', fixedParams: { isActive: 'false' } });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const query = list.params.toString();
  useEffect(() => {
    fetchInactiveProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchInactiveProducts = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/products?${query}`);
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ProductsResponse = await response.json();
      if (!isCurrent()) return;
      setProducts(data.products);
      list.setPagination(data.pagination);

    } catch (error) {
      console.error('Error fetching inactive products:', error);
      showSnackbar('error', 'Could not load inactive products');
    } finally {
      if (isCurrent()) setLoading(false);
    }
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
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <div className="w-40">
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={list.limit}
                onChange={(e) => list.setLimit(parseInt(e.target.value, 10))}
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
            <ListSummary pagination={pagination} shown={products.length} noun="inactive products" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('product_name')}>
                      Product Name <SortIcon field="product_name" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('part_no')}>
                      Part Number <SortIcon field="part_no" {...sortProps} />
                    </th>
                    {/* S-36: Category and Company are not sortable columns on
                        `product` - they are joined names, and these headers used
                        to sort by the raw foreign key while displaying the text.
                        Plain headings until the endpoint can sort on the join. */}
                    <th>Category</th>
                    <th>Company</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('stock')}>
                      Stock <SortIcon field="stock" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={product.id}>
                      <td>{list.serialNumber(index)}</td>
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

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
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
