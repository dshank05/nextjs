import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit } from 'lucide-react';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { useSnackbar } from '../../../components/SnackbarProvider';

interface Product {
  id: number;
  product_name: string;
  stock?: number;
  min_stock?: number;
  rate?: number;
  part_no?: string;
  categoryName?: string;
  companyName?: string;
  subcategoryName?: string;
  carModelsDisplay?: string;
  latestPurchaseRate?: number;
  hsn?: string;
  gst_rate?: string;
  warehouse?: string;
  rack_number?: string;
  descriptions?: string;
  notes?: string;
  mrp?: string;
  discount?: string;
  sale_price?: string;
  is_active?: boolean;
}

export default function ProductView() {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { id } = router.query;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProduct();
    }
  }, [id]);

  const fetchProduct = async () => {
    try {
      const response = await fetch(`/api/products/${id}`);
      if (response.ok) {
        const data = await response.json();
        setProduct(data);
      }
    } catch (error) {
      console.error('Error fetching product:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleProductStatus = () => {
    if (!product) return;
    setShowConfirmModal(true);
  };

  const handleConfirmProductStatusToggle = async () => {
    if (!product) return;

    setConfirmLoading(true);
    const newStatus = !product.is_active;
    const action = newStatus ? 'reactivate' : 'deactivate';

    try {
      const response = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: newStatus }),
      });

      if (response.ok) {
        setProduct(prev => prev ? { ...prev, is_active: newStatus } : null);
        showSnackbar('success', `Product ${action}d successfully!`);
        setShowConfirmModal(false);
        // Navigate back to product index page after successful deactivation
        router.push('/products');
      } else {
        const errorData = await response.json();
        showSnackbar('error', `Failed to ${action} product: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error toggling product status:', error);
      showSnackbar('error', `Failed to ${action} product: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCancelProductStatusToggle = () => {
    if (!confirmLoading) {
      setShowConfirmModal(false);
    }
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Product not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Product Overview Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Image */}
          <div className="flex flex-col items-center justify-center">
            <div className="w-48 h-32 bg-slate-600 rounded-xl flex items-center justify-center mb-4">
              <div className="text-6xl">📦</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{product.product_name}</h3>
            <p className="text-slate-400 text-sm mb-2">{product.categoryName} • {product.companyName}</p>
          </div>

          {/* Right: Key-Value Display + Actions */}
          <div className="space-y-4">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Category:</span>
              <span className="text-white font-medium">{product.categoryName || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Company:</span>
              <span className="text-white font-medium">{product.companyName || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Subcategory:</span>
              <span className="text-white font-medium">{product.subcategoryName || 'N/A'}</span>
            </div>
            {product.carModelsDisplay && (
              <div className="border-b border-slate-700 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Compatible Models:</span>
                  <div className="flex flex-wrap gap-1">
                    {product.carModelsDisplay.split(', ').map((model, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full border border-blue-500/30"
                      >
                        {model.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Stock:</span>
              <span className="text-white font-medium">{product.stock || 0}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Latest Rate:</span>
              <span className="text-white font-medium">₹{product.latestPurchaseRate || product.rate || 0}</span>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={toggleProductStatus}
                className={`btn-secondary flex items-center gap-2 ${product.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                title={product.is_active ? 'Make Product Inactive' : 'Reactivate Product'}
              >
                {product.is_active ? '🚫 Inactive' : '✅ Reactivate'}
              </button>
              <Link href={`/products/create?edit=${product.id}`} className="btn-primary flex items-center gap-2" title="Edit Product">
                <Edit className="w-4 h-4" />
                Edit
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Information Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📋 Detailed Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🛒 Sales & Pricing</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">MRP:</span>
                <span className="text-white font-medium">₹{product.mrp || '0.00'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sale Price:</span>
                <span className="text-white font-medium">₹{product.sale_price || '0.00'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Discount:</span>
                <span className="text-white font-medium">₹{product.discount || '0.00'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📦 Inventory</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Stock:</span>
                <span className="text-white font-medium">{product.stock || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Min Stock:</span>
                <span className="text-white font-medium">{product.min_stock || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Part Number:</span>
                <span className="text-white font-medium">{product.part_no || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🏢 Location & Tax</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Warehouse:</span>
                <span className="text-white font-medium">{product.warehouse || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Rack:</span>
                <span className="text-white font-medium">{product.rack_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GST Rate:</span>
                <span className="text-white font-medium">{product.gst_rate || 'N/A'}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">HSN:</span>
                <span className="text-white font-medium">{product.hsn || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📝 Additional Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">Notes:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-16">
                  {product.notes || 'No notes available'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Descriptions:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-16">
                  {product.descriptions || 'No descriptions available'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Last 5 Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Last Five Purchase */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">LAST FIVE PURCHASE</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>INVOICE NUMBER</th>
                  <th>VENDOR</th>
                  <th>QTY</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>4</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>5</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Last Five Sale */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">LAST FIVE SALE</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>INVOICE NUMBER</th>
                  <th>CUSTOMER</th>
                  <th>QTY</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>4</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>5</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Last Five Sale X */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">LAST FIVE SALE X</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>INVOICE NUMBER</th>
                  <th>CUSTOMER</th>
                  <th>QTY</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>4</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>5</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Last Five Sale Return */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">LAST FIVE SALE RETURN</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>VOUCHER NUMBER</th>
                  <th>CUSTOMER</th>
                  <th>QTY</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>4</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
                <tr>
                  <td>5</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Last Five Purchase Return */}
        <div className="card col-span-1 lg:col-span-2">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">LAST FIVE PURCHASE RETURN</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>VOUCHER NUMBER</th>
                  <th>VENDOR</th>
                  <th>QTY</th>
                  <th>RATE</th>
                  <th>AMOUNT</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                  <td className="text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={product?.is_active ? 'Deactivate Product' : 'Reactivate Product'}
        message={`Are you sure you want to ${product?.is_active ? 'deactivate' : 'reactivate'} this product?`}
        confirmText={product?.is_active ? 'Deactivate' : 'Reactivate'}
        showLoading={confirmLoading}
        onConfirm={handleConfirmProductStatusToggle}
        onCancel={handleCancelProductStatusToggle}
      />
    </div>
  );
}
