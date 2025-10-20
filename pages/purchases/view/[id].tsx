import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Trash2, FileText, Truck } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';

interface PurchaseItem {
  id?: number; // Optional since API creates new IDs
  invoice_no?: number;
  product_name: string; // Updated to match API
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string; // Now uses "part" instead of "part_number"
  qty: number;
  unit?: number;
  rate: number;
  tax?: number; // Added tax field
  total?: number; // Updated to match API (uses total instead of subtotal)
  subtotal?: number; // Keep for backward compatibility
  fy?: number;
  invoice_date?: number | string;
  product_id?: number; // Added from API
  car_model?: string; // Added from API
  gst_percentage?: number; // Added from API
  cgst?: number; // Added from API
  sgst?: number; // Added from API
  igst?: number; // Added from API
}

interface Vendor {
  id: string;
  vendor_name: string;
  contact_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  state_code?: number;
  tax_id?: string;
}

interface Staff {
  id: number;
  name: string;
  phone: string;
  email?: string;
  status: string;
}

interface Purchase {
  // Main purchase fields
  id: number;
  invoice_number: string;
  bill_reference?: string;
  staff_id?: number | null;
  date: number;  // Unix timestamp
  vendor_id?: number;
  transport_name?: string;
  vehicle_number?: string;
  transport_cost?: number;

  // Financial summary fields
  items_total: number;
  total_taxable_value: number;
  total_tax: number;
  total: number;
  freight?: number;  // For backward compatibility

  // Tax breakdown
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;

  // Additional fields
  descriptions?: string;
  packing_forwarding_qty?: number;
  packing_forwarding_rate?: number;
  packing_forwarding_total?: number;
  notes?: string;

  // Payment fields
  payment_status?: number;
  payment_mode?: number;

  // Legacy fields for compatibility
  invoice_no?: number;  // May still be used in some places
  invoice_date?: number | string;  // May still be used
  fy?: number;
  transport?: string;
  items?: PurchaseItem[];
  item_count?: number;
  formattedDate?: string;

  // Related data
  vendor?: Vendor | null;
  staff?: Staff | null;
}

export default function PurchaseView() {
  const router = useRouter();
  const { id } = router.query;
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchPurchase();
    }
  }, [id]);

  const fetchPurchase = async () => {
    try {
      const response = await fetch(`/api/purchases/${id}`);
      if (response.ok) {
        const data = await response.json();
        const purchaseData = data.purchase || data;
        setPurchase(purchaseData);
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditPurchase = () => {
    if (purchase) {
      SessionStorageService.set('purchases', id.toString(), purchase);
    }
    router.push(`/purchases/create?edit=${id}`);
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Purchase not found</p>
      </div>
    );
  }

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      default: return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Unknown</span>;
    }
  };

  const getPaymentModeText = (mode?: number) => {
    switch (mode) {
      case 0: return 'Cash';
      case 1: return 'Bank';
      default: return 'N/A';
    }
  };

  const formatDate = (dateValue: number | string) => {
    if (typeof dateValue === 'string') {
      // Try to parse as Unix timestamp first (if it's all digits)
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) { // Likely a Unix timestamp
          return new Date(timestamp * 1000).toLocaleDateString('en-IN');
        }
      }
      // Try parsing as regular date string
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN');
      }
      return 'Invalid Date';
    }
    // Number: assume Unix timestamp in seconds
    return new Date(dateValue * 1000).toLocaleDateString('en-IN');
  };

  return (
    <div className="space-y-6">
      {/* Main Purchase Overview Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Info Icon */}
          <div className="flex flex-col items-center justify-center">
            <div className="w-48 h-32 bg-slate-600 rounded-xl flex items-center justify-center mb-4">
              <div className="text-6xl">🧾</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Purchase Invoice #{purchase.invoice_number || purchase.invoice_no}</h3>
            <p className="text-slate-400 text-sm mb-2">{purchase.vendor?.vendor_name } • {formatDate(purchase.date || purchase.invoice_date)}</p>
            <div className="flex items-center gap-2 mt-2">{getStatusBadge(purchase.payment_status)}</div>
          </div>

          {/* Right: Key-Value Display + Actions */}
          <div className="space-y-4">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Vendor:</span>
              <span className="text-white font-medium">{purchase.vendor?.vendor_name }</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Invoice Number:</span>
              <span className="text-white font-medium">{purchase.invoice_number || purchase.invoice_no}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Bill Reference:</span>
              <span className="text-white font-medium">{purchase.bill_reference || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Staff Details:</span>
              <span className="text-white font-medium">{purchase.staff?.name || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{purchase.vendor?.contact_no || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{purchase.items_total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Total Amount:</span>
              <span className="text-white font-semibold text-lg">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={handleEditPurchase}
                className="btn-primary flex items-center gap-2"
                title="Edit Purchase"
              >
                <Edit className="w-4 h-4" />
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Information Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📋 Purchase Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🧾 Invoice Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Invoice Number:</span>
                <span className="text-white font-medium">{purchase.invoice_number || purchase.invoice_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Date:</span>
                <span className="text-white font-medium">{formatDate(purchase.date || purchase.invoice_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status:</span>
                <span className="text-white font-medium">{getStatusBadge(purchase.payment_status)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment Mode:</span>
                <span className="text-white font-medium">{getPaymentModeText(purchase.payment_mode)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🏢 Vendor Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Vendor Name:</span>
                <span className="text-white font-medium">{purchase.vendor?.vendor_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Contact:</span>
                <span className="text-white font-medium">{purchase.vendor?.contact_no || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="text-white font-medium">{purchase.vendor?.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GSTIN:</span>
                <span className="text-white font-medium">{purchase.vendor?.tax_id || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📊 Financial Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Items Total:</span>
                <span className="text-white font-medium">₹{purchase.items_total?.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Freight:</span>
                <span className="text-white font-medium">₹{purchase.freight?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Taxable Value:</span>
                <span className="text-white font-medium">₹{purchase.total_taxable_value?.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Tax:</span>
                <span className="text-white font-medium">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-slate-400">Grand Total:</span>
                <span className="text-white font-medium">₹{purchase.total?.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">💰 GST Breakdown</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">CGST:</span>
                <span className="text-white font-medium">₹{purchase.total_cgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">SGST:</span>
                <span className="text-white font-medium">₹{purchase.total_sgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">IGST:</span>
                <span className="text-white font-medium">₹{purchase.total_igst?.toLocaleString('en-IN') || '0'}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🚚 Transport & Additional Info</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">Transport Name:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {purchase.transport_name || 'No transport information available'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Vehicle Number:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {purchase.vehicle_number || 'No vehicle number available'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Freight:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  ₹{purchase.freight?.toLocaleString('en-IN') || '0'}
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="block text-slate-400 text-sm mb-1">Notes:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {purchase.notes || 'No notes available'}
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="block text-slate-400 text-sm mb-1">Descriptions:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {purchase.descriptions || 'No descriptions available'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase Items Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📦 Purchase Items ({purchase.items?.length || 0})</h2>
        <div className="p-6 pt-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>HSN</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {purchase.items?.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">{item.product_name}</td>
                    <td className="text-slate-300">{item.part || 'N/A'}</td>
                    <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                    <td className="text-slate-300 font-medium">{item.qty}</td>
                    <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300 font-semibold">₹{(item.total || item.subtotal)?.toLocaleString('en-IN')}</td>
                  </tr>
                )) || (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-4">
                      No items found for this purchase
                    </td>
                  </tr>
                )}
              </tbody>
              {purchase.items && purchase.items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <td colSpan={5} className="text-right text-slate-300 font-semibold py-2">Items Total:</td>
                    <td className="text-white font-bold pl-6">₹{purchase.items_total?.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
