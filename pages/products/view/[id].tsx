import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit } from 'lucide-react';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { ImageCarousel } from '../../../components/common/ImageCarousel';
import { useSnackbar } from '../../../components/SnackbarProvider';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { useProduct } from '../../../hooks/useProducts';
import { useQueryClient } from '@tanstack/react-query';
import { broadcast } from '../../../lib/broadcast';
import type { ProductTransactionRow } from '../../../types/products';

// History dates arrive as ISO timestamps and are formatted once, here (PQ-01).
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN') : '-');

/** One of the five "last five" tables - they were five copies of this (PQ-21, client side). */
function HistoryTable({ title, rows, numberLabel, partyLabel, empty }: {
  title: string;
  rows: ProductTransactionRow[];
  numberLabel: string;
  partyLabel: string;
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4 pb-2 border-b border-slate-700">{title}</h3>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-16">SN</th>
              <th>{numberLabel}</th>
              <th>{partyLabel}</th>
              <th>QTY</th>
              <th>RATE</th>
              <th>AMOUNT</th>
              <th>DATE</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((r) => (
              <tr key={r.sn}>
                <td>{r.sn}</td>
                <td>{r.invoice_number || r.voucher_number || '-'}</td>
                <td>{r.vendor || r.customer || '-'}</td>
                <td>{r.qty}</td>
                <td>₹{r.rate}</td>
                <td>₹{r.amount}</td>
                <td>{formatDate(r.date)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-4">{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProductView() {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { id } = router.query;
  
  // Query hook
  const { data: product, isLoading, refetch } = useProduct(id as string);
  const queryClient = useQueryClient();
  
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Transaction data state
  const [purchases, setPurchases] = useState<ProductTransactionRow[]>([]);
  const [sales, setSales] = useState<ProductTransactionRow[]>([]);
  const [salex, setSalex] = useState<ProductTransactionRow[]>([]);
  const [saleReturns, setSaleReturns] = useState<ProductTransactionRow[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<ProductTransactionRow[]>([]);

  useEffect(() => {
    if (id) {
      fetchTransactionData();
    }
  }, [id]);

  // Listen for broadcast messages
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'products' && msg.type === 'updated' && msg.id && msg.id.toString() === id?.toString()) {
        console.log(`🔄 Product ${msg.id} updated in another tab, refreshing view page...`);
        refetch();
        fetchTransactionData();
      }
    });

    return unsubscribe;
  }, [id, refetch]);

  const fetchTransactionData = async () => {
    if (!id) return;

    try {
      const endpoints = [
        { key: 'purchases', endpoint: 'purchases' },
        { key: 'sales', endpoint: 'sales' },
        { key: 'salex', endpoint: 'salex' },
        { key: 'saleReturns', endpoint: 'sale-returns' },
        { key: 'purchaseReturns', endpoint: 'purchase-returns' }
      ];

      const responses = await Promise.all(
        endpoints.map(({ endpoint }) =>
          fetch(`/api/products/${id}/${endpoint}`)
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
        )
      );

      setPurchases(responses[0] || []);
      setSales(responses[1] || []);
      setSalex(responses[2] || []);
      setSaleReturns(responses[3] || []);
      setPurchaseReturns(responses[4] || []);
    } catch (error) {
      console.error('Error fetching transaction data:', error);
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
      // The status route, not PUT /api/products/[id]. That endpoint parses
      // multipart form data for the product form and rejects a JSON body, so
      // this toggle answered 400 every time it was pressed and a deactivated
      // product could never be brought back (F-91).
      const response = await fetch(`/api/products/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus ? 'Active' : 'Inactive' }),
      });

      if (response.ok) {
        showSnackbar('success', `Product ${action}d successfully!`);
        setShowConfirmModal(false);
        // The list is a cached query; without this it kept showing the product
        // it was just told to hide, for up to two minutes (PQ-16).
        queryClient.invalidateQueries({ queryKey: ['products'] });
        broadcast({ type: 'updated', resource: 'products', id: Number(id) });
        refetch();
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

  if (isLoading) {
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
        {/* Product Display Name Section */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 mb-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-blue-100">
              {product.product_name} | UID: {product.id}
            </h1>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Image Display */}
          <div className="flex flex-col items-center justify-center">
            {product.pic || product.barcode ? (
              <ImageCarousel
                items={[
                  ...(product.pic ? [{
                    id: 'product-image',
                    src: product.pic.startsWith('http') ? product.pic : `${window.location.origin}${product.pic}`,
                    alt: product.product_name,
                    type: 'image' as const
                  }] : []),
                  ...(product.barcode ? [{
                    id: 'product-barcode',
                    src: product.barcode.startsWith('http') ? product.barcode : `${window.location.origin}${product.barcode}`,
                    alt: 'Product Barcode',
                    type: 'barcode' as const
                  }] : [])
                ]}
              />
            ) : (
              <div className="w-[28rem] h-80 bg-slate-600 rounded-xl flex items-center justify-center shadow-lg">
                <div className="text-slate-400 font-medium text-center">
                  <div className="text-4xl mb-2">📷</div>
                  <div>NO IMAGE FOUND</div>
                </div>
              </div>
            )}
          </div>

          {/* Right: All Product Information in 6x3 Grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* Row 1 */}
            <div className="flex justify-between">
              <span className="text-slate-400">Category:</span>
              <span className="text-white font-medium">{product.categoryName || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Company:</span>
              <span className="text-white font-medium">{product.companyName || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Subcategory:</span>
              <span className="text-white font-medium">{product.subcategoryName || 'N/A'}</span>
            </div>

            {/* Row 2 */}
            <div className="flex justify-between">
              <span className="text-slate-400">Part Number:</span>
              <span className="text-white font-medium">{product.part_no || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Stock:</span>
              <span className="text-white font-medium">{product.stock || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Min Stock:</span>
              <span className="text-white font-medium">{product.min_stock || 0}</span>
            </div>

            {/* Row 3 */}
            <div className="flex justify-between">
              <span className="text-slate-400">MRP:</span>
              <span className="text-white font-medium">₹{product.mrp || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Discount:</span>
              <span className="text-white font-medium">₹{product.discount || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Margin:</span>
              <span className="text-white font-medium">₹{product.margin || '0'}</span>
            </div>

            {/* Row 4 */}
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
              <span className="text-white font-medium">{product.gst_rate_id ? `${product.gst_rate ?? 0}%` : 'N/A'}</span>
            </div>

            {/* Row 5 */}
            <div className="flex justify-between">
              <span className="text-slate-400">HSN:</span>
              <span className="text-white font-medium">{product.hsn || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Latest Rate:</span>
              <span className="text-white font-medium">₹{product.latestPurchaseRate || product.opening_rate || 0}</span>
            </div>
            <div className="col-span-1"></div>

            {/* Row 6 - Notes and Description (2 columns) */}
            <div className="col-span-3 grid grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col">
                <span className="text-slate-400 text-sm mb-2 font-medium">Notes:</span>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-16 max-h-24 overflow-y-auto">
                  {product.notes || 'No notes available'}
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-400 text-sm mb-2 font-medium">Description:</span>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-16 max-h-24 overflow-y-auto">
                  {product.descriptions || 'No description available'}
                </div>
              </div>
            </div>

            {/* Row 7 - Car Models (full row, can display multiple) */}
            <div className="col-span-3 mb-4">
              <div className="flex items-start gap-2">
                <span className="text-slate-400 font-medium">Compatible Models:</span>
                <div className="flex flex-wrap gap-2 flex-1">
                  {product.carModelsDisplay ? (
                    product.carModelsDisplay.split(', ').map((model, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-blue-600/20 text-blue-300 text-sm rounded-full border border-blue-500/30 font-medium"
                      >
                        {model.trim()}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400">No models specified</span>
                  )}
                </div>
              </div>
            </div>

            {/* Row 8 - Actions */}
            <div className="col-span-3 flex justify-end space-x-3 pt-2">
              <button
                onClick={toggleProductStatus}
                className={`btn-secondary flex items-center gap-2 ${product.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                title={product.is_active ? 'Make Product Inactive' : 'Reactivate Product'}
              >
                {product.is_active ? '🚫 Inactive' : '✅ Reactivate'}
              </button>
              <Link
                href={`/products/create?edit=${id}`}
                className="btn-primary flex items-center gap-2"
                title="Edit Product"
              >
                <Edit className="w-4 h-4" />
                Edit
              </Link>
            </div>
          </div>
        </div>



        {/* Transaction Tables Section - Merged into main card */}
        <div className="space-y-6 p-6 pt-0">
          <HistoryTable title="LAST FIVE PURCHASE" rows={purchases} numberLabel="INVOICE NUMBER" partyLabel="VENDOR" empty="No purchase records found" />
          <HistoryTable title="LAST FIVE SALE" rows={sales} numberLabel="INVOICE NUMBER" partyLabel="CUSTOMER" empty="No sales records found" />
          <HistoryTable title="LAST FIVE SALE X" rows={salex} numberLabel="INVOICE NUMBER" partyLabel="CUSTOMER" empty="No salex records found" />
          <HistoryTable title="LAST FIVE SALE RETURN" rows={saleReturns} numberLabel="VOUCHER NUMBER" partyLabel="CUSTOMER" empty="No sale return records found" />
          <HistoryTable title="LAST FIVE PURCHASE RETURN" rows={purchaseReturns} numberLabel="VOUCHER NUMBER" partyLabel="VENDOR" empty="No purchase return records found" />
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
