import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, FileText, Truck } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';


interface InvoiceItem {
  product_id: number;
  name_of_product: string;
  category_id?: number;
  subcategory_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  rate: number;
  subtotal?: number;
  gst_percentage?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  tax?: number;
  discount?: number;
  discountrate?: number;
  invoice_date?: number;
  fy?: number;
}

interface Customer {
  id?: number;
  billing_name?: string;
  billing_address?: string;
  contact_no?: string;
  email?: string;
  billing_gstin?: string;
}

interface Staff {
  id: number;
  name: string;
  phone: string;
  email?: string;
  status: string;
}

interface Mechanic {
  id: number;
  name: string;
  phone: string;
  status: string;
}

interface ShippingDetails {
  user_name: string;
  address: string;
  gstin: string;
}

interface TransportDetails {
  trans_mode: string;
  vehicle_no: string;
}

interface Invoice {
  invoice_no: number;
  invoice_date: number;
  select_customer: number;
  items_total: number;
  freight: number;
  total_taxable_value: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_tax: number;
  total: number;
  bill_reference?: string;
  staff_id?: number;
  staff_details?: string;
  mechanic_id?: number;
  commission?: number;
  discount?: number;
  tax?: string;
  packing_forwarding_qty?: number;
  packing_forwarding_rate?: number;
  packing_forwarding_total?: number;
  payment_status: number;
  payment_mode: number;
  notes?: string;
  descriptions?: string;
  fy: number;
  updated_at: string;

  invoiceItems: InvoiceItem[];
  customer_id: number;
  shippingDetails?: ShippingDetails;
  useShippingAddress: boolean;
  transportDetails: TransportDetails;

  // Derived properties for UI
  formattedDate?: string;
  customer?: Customer;
  staff?: Staff;
  mechanic?: Mechanic;
  vehicle_number?: string;
  transport_name?: string;
  item_count?: number;
  items?: InvoiceItem[]; // Alias for invoiceItems for compatibility
}

export default function InvoiceView() {
  const router = useRouter();
  const { id } = router.query;
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchInvoice();
    }
  }, [id]);

  // Listen for broadcast messages to refresh data when sales are updated in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'sales' && msg.type === 'updated' && msg.data?.id === parseInt(id as string)) {
        console.log(`🔄 Sale ${msg.data.id} updated in another tab, refreshing data...`);
        fetchInvoice();
      }
    });

    return unsubscribe;
  }, [id]);

  const fetchInvoice = async () => {
    try {
      const response = await fetch(`/api/sales/${id}`);
      if (response.ok) {
        const data = await response.json();

        // Create derived transport properties
        const vehicle_number = data.transportDetails?.vehicle_no || '';
        const transport_name = data.transportDetails?.trans_mode || '';

        // Create enhanced invoice object - customer, staff, mechanic data now comes directly from API
        const enhancedInvoice = {
          ...data,
          vehicle_number,
          transport_name,
          item_count: data.invoiceItems?.length || 0,
          items: data.invoiceItems || [], // Alias for compatibility
          formattedDate: new Date(data.invoice_date * 1000).toLocaleDateString('en-IN')
        };

        setInvoice(enhancedInvoice);
        setInvoiceItems(data.invoiceItems || []);
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditInvoice = () => {
    if (invoice) {
      SessionStorageService.set('sales', id.toString(), {
        invoice,
        invoiceItems
      });
    }
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Invoice not found</p>
      </div>
    );
  }

  const getStatusBadge = (paymentStatus?: number) => {
    switch (paymentStatus) {
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
      {/* Main Invoice Overview Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Info Icon */}
          <div className="flex flex-col items-center justify-center">
            <div className="w-48 h-32 bg-slate-600 rounded-xl flex items-center justify-center mb-4">
              <div className="text-6xl">🧾</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Sales Invoice #{invoice.invoice_no}</h3>
            <p className="text-slate-400 text-sm mb-2">{invoice.customer?.billing_name || 'N/A'} • {formatDate(invoice.invoice_date)}</p>
            <div className="flex items-center gap-2 mt-2">{getStatusBadge(invoice.payment_status)}</div>
          </div>

          {/* Right: Key-Value Display + Actions */}
          <div className="space-y-4">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Customer:</span>
              <span className="text-white font-medium">{invoice.customer?.billing_name || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Invoice Number:</span>
              <span className="text-white font-medium">{invoice.invoice_no}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Staff Details:</span>
              <span className="text-white font-medium">{invoice.staff_details || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{invoice.customer?.contact_no || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{invoice.items_total.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Total Amount:</span>
              <span className="text-white font-semibold text-lg">₹{invoice.total.toLocaleString('en-IN')}</span>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Link
                href={`/sale/create?edit=${id}`}
                onClick={handleEditInvoice}
                className="btn-primary flex items-center gap-2"
                title="Edit Invoice"
              >
                <Edit className="w-4 h-4" />
                Edit
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Information Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📋 Invoice Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🧾 Invoice Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Invoice Number:</span>
                <span className="text-white font-medium">{invoice.invoice_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Date:</span>
                <span className="text-white font-medium">{formatDate(invoice.invoice_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status:</span>
            <span className="text-white font-medium">{getStatusBadge(invoice.payment_status)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment Mode:</span>
                <span className="text-white font-medium">{getPaymentModeText(invoice.payment_mode)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🏢 Customer Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Customer Name:</span>
                <span className="text-white font-medium">{invoice.customer?.billing_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Contact:</span>
                <span className="text-white font-medium">{invoice.customer?.contact_no || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="text-white font-medium">{invoice.customer?.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GSTIN:</span>
                <span className="text-white font-medium">{invoice.customer?.billing_gstin || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">👨‍💼 Staff & Mechanic</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Staff Name:</span>
                <span className="text-white font-medium">{invoice.staff?.name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Staff Phone:</span>
                <span className="text-white font-medium">{invoice.staff?.phone || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mechanic Name:</span>
                <span className="text-white font-medium">{invoice.mechanic?.name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mechanic Phone:</span>
                <span className="text-white font-medium">{invoice.mechanic?.phone || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Commission:</span>
                <span className="text-white font-medium">₹{invoice.commission?.toLocaleString('en-IN') || '0'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📊 Financial Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Items Total:</span>
                <span className="text-white font-medium">₹{invoice.items_total.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Freight:</span>
                <span className="text-white font-medium">₹{invoice.freight?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Taxable Value:</span>
                <span className="text-white font-medium">₹{invoice.total_taxable_value.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Tax:</span>
                <span className="text-white font-medium">₹{invoice.total_tax?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-slate-400">Grand Total:</span>
                <span className="text-white font-medium">₹{invoice.total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* GST Breakdown Section */}
        <div className="p-6 pt-0">
          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">💰 GST Breakdown</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">CGST:</span>
                <span className="text-white font-medium">₹{invoice.total_cgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">SGST:</span>
                <span className="text-white font-medium">₹{invoice.total_sgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-700 rounded">
                <span className="text-slate-400">IGST:</span>
                <span className="text-white font-medium">₹{invoice.total_igst?.toLocaleString('en-IN') || '0'}</span>
              </div>
            </div>
          </div>

          {/* Transport Details Section */}
          <div className="space-y-4 mt-6">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🚚 Complete Transport Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">Transport Name:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {invoice.transport_name || 'N/A'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Vehicle Number:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {invoice.vehicle_number || 'N/A'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Freight:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  ₹{invoice.freight?.toLocaleString('en-IN') || '0'}
                </div>
              </div>
            </div>
          </div>

          {/* Packing & Forwarding Section */}
          <div className="space-y-4 mt-6">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📦 Packing & Forwarding</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">QTY:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm font-medium">
                  {invoice.packing_forwarding_qty?.toString() || '0'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">RATE:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm font-medium">
                  ₹{invoice.packing_forwarding_rate?.toLocaleString('en-IN') || '0'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">TOTAL:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm font-semibold text-green-400">
                  ₹{invoice.packing_forwarding_total?.toLocaleString('en-IN') || '0'}
                </div>
              </div>
            </div>
          </div>

          {/* Additional Information Section */}
          <div className="space-y-4 mt-6">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📝 Additional Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">Descriptions:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-[100px]">
                  {invoice.descriptions || 'No descriptions available'}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Notes:</label>
                <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-[100px]">
                  {invoice.notes || 'No notes available'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Items Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📦 Invoice Items ({invoiceItems.length})</h2>
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
                {invoiceItems.map((item, index) => (
                  <tr key={item.product_id}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">{item.name_of_product}</td>
                    <td className="text-slate-300">{item.part || 'N/A'}</td>
                    <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                    <td className="text-slate-300 font-medium">{item.qty}</td>
                    <td className="text-slate-300">₹{item.rate.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300 font-semibold">₹{item.subtotal.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {invoiceItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-4">
                      No items found for this invoice
                    </td>
                  </tr>
                )}
              </tbody>
              {invoiceItems.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <td colSpan={5} className="text-right text-slate-300 font-semibold py-2">Items Total:</td>
                    <td className="text-white font-bold pl-6">₹{invoice.items_total.toLocaleString('en-IN')}</td>
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
