import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Trash2, FileText, Truck, Printer, FileSpreadsheet } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { ExportMenu } from '../../../components/common';

interface PurchaseItem {
  id?: number; // Optional since API creates new IDs
  invoice_no?: number;
  product_name: string; // Updated to match API
  display_name?: string;
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
  // Return status fields
  original_qty?: number;
  returned_qty?: number;
  available_qty?: number;
  is_fully_returned?: boolean;
  return_history?: Array<{
    return_id: string;
    return_no: string;
    qty: number;
    date: number;
    unit_price: number;
    tax_amount: number;
    cgst: number;
    sgst: number;
    igst: number;
    reason_id: number;
    notes: string;
  }>;
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

  // Return status
  return_status?: {
    has_returns: boolean;
    fully_returned_items: number;
    total_items: number;
    is_fully_returned: boolean;
    status: 'NO_RETURNS' | 'PARTIAL_RETURN' | 'FULLY_RETURNED';
  };

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

  // Listen for broadcast messages to refresh data when this purchase is updated in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && msg.type === 'updated' && msg.id && msg.id.toString() === id?.toString()) {
        console.log(`🔄 Purchase ${msg.id} updated in another tab, refreshing view page...`);
        fetchPurchase();
      }
    });

    return unsubscribe;
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

  // Universal print/PDF function using template-based printPage utility
  const handlePrintOrPDF = async (output: 'print' | 'pdf' = 'print') => {
    try {
      const { printPage } = await import('../../../lib/export-utils');

      // Fetch business details
      const businessResponse = await fetch('/api/business-details');
      const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

      await printPage({
        title: 'Purchase Invoice',
        businessDetails,
        output,
        pageType: 'purchase-view',
        data: purchase
      });
    } catch (error) {
      console.error('Print/PDF error:', error);
      alert(`Error generating ${output === 'pdf' ? 'PDF' : 'print'}. Please try again.`);
    }
  };

  // Simple Excel export function with Label-Value format (like the page layout)
  const handleExportPageAsExcel = () => {
    try {
      // ExportMenu passes data as array, so get the first item
      const purchaseData = Array.isArray(purchase) ? purchase[0] : purchase;

      // Create simple Label-Value Excel data (2 columns)
      const excelData = [];

      // Basic Information (like the page layout)
      excelData.push({ 'Label': 'Total:', 'Value': `₹${(purchase.total || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Items:', 'Value': purchase.items?.length || 0 });
      excelData.push({ 'Label': 'Invoice:', 'Value': purchase.invoice_number || purchase.invoice_no });
      excelData.push({ 'Label': 'Date:', 'Value': formatDate(purchase.date || purchase.invoice_date) });
      excelData.push({ 'Label': 'Status:', 'Value': purchase.payment_status === 1 ? 'Paid' : 'Unpaid' });
      excelData.push({ 'Label': 'Payment Mode:', 'Value': getPaymentModeText(purchase.payment_mode) });
      excelData.push({ 'Label': 'Bill Reference:', 'Value': purchase.bill_reference || 'N/A' });
      excelData.push({ 'Label': 'Bill Reference Date:', 'Value': (purchase as any).bill_reference_date || 'N/A' });

      // Vendor & Staff Info
      excelData.push({ 'Label': 'Vendor:', 'Value': purchase.vendor?.vendor_name || 'N/A' });
      excelData.push({ 'Label': 'Contact:', 'Value': purchase.vendor?.contact_no || 'N/A' });
      excelData.push({ 'Label': 'Email:', 'Value': purchase.vendor?.email || 'N/A' });
      excelData.push({ 'Label': 'GSTIN:', 'Value': purchase.vendor?.tax_id || 'N/A' });
      excelData.push({ 'Label': 'Staff:', 'Value': purchase.staff?.name || 'N/A' });

      // Financial Summary
      excelData.push({ 'Label': 'Items Total:', 'Value': `₹${(purchase.items_total || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Freight:', 'Value': `₹${(purchase.freight || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Taxable Value:', 'Value': `₹${(purchase.total_taxable_value || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Total Tax:', 'Value': `₹${(purchase.total_tax || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Grand Total:', 'Value': `₹${(purchase.total || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'CGST:', 'Value': `₹${(purchase.total_cgst || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'SGST:', 'Value': `₹${(purchase.total_sgst || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'IGST:', 'Value': `₹${(purchase.total_igst || 0).toLocaleString('en-IN')}` });

      // Transport & Additional
      excelData.push({ 'Label': 'Transport:', 'Value': purchase.transport_name || 'N/A' });
      excelData.push({ 'Label': 'Vehicle:', 'Value': purchase.vehicle_number || 'N/A' });
      excelData.push({ 'Label': 'Freight:', 'Value': `₹${(purchase.freight || 0).toLocaleString('en-IN')}` });
      excelData.push({ 'Label': 'Notes:', 'Value': purchase.notes || 'No notes available' });
      excelData.push({ 'Label': 'Descriptions:', 'Value': purchase.descriptions || 'No descriptions available' });

      // Add purchase items table
      if (purchase.items && purchase.items.length > 0) {
        excelData.push({ 'Label': '', 'Value': '' }); // Empty row
        excelData.push({ 'Label': 'PURCHASE ITEMS', 'Value': '' });

        // Add item headers
        excelData.push({ 'Label': 'SN', 'Value': 'Product Name' });
        excelData.push({ 'Label': '', 'Value': 'Part No' });
        excelData.push({ 'Label': '', 'Value': 'HSN' });
        excelData.push({ 'Label': '', 'Value': 'Qty' });
        excelData.push({ 'Label': '', 'Value': 'Rate' });
        excelData.push({ 'Label': '', 'Value': 'Tax %' });
        excelData.push({ 'Label': '', 'Value': 'Tax Amount' });
        excelData.push({ 'Label': '', 'Value': 'Subtotal' });

        // Add each item
        purchase.items.forEach((item, index) => {
          const taxAmount = (item.total || item.subtotal || 0) - ((item.qty * (item.rate || 0)) / (1 + (item.gst_percentage || 0) / 100));

          excelData.push({ 'Label': (index + 1).toString(), 'Value': item.display_name || item.product_name || 'N/A' });
          excelData.push({ 'Label': '', 'Value': item.part || 'N/A' });
          excelData.push({ 'Label': '', 'Value': item.hsn || 'N/A' });
          excelData.push({ 'Label': '', 'Value': item.qty || 0 });
          excelData.push({ 'Label': '', 'Value': `₹${(item.rate || 0).toLocaleString('en-IN')}` });
          excelData.push({ 'Label': '', 'Value': `${item.gst_percentage || item.tax || 0}%` });
          excelData.push({ 'Label': '', 'Value': `₹${taxAmount.toLocaleString('en-IN')}` });
          excelData.push({ 'Label': '', 'Value': `₹${(item.total || item.subtotal || 0).toLocaleString('en-IN')}` });
        });

        // Add totals
        excelData.push({ 'Label': '', 'Value': '' }); // Empty row
        excelData.push({ 'Label': 'TOTAL', 'Value': '' });
        excelData.push({ 'Label': '', 'Value': purchase.items.reduce((sum, item) => sum + (item.qty || 0), 0) });
        excelData.push({ 'Label': '', 'Value': '' });
        excelData.push({ 'Label': '', 'Value': '' });
        excelData.push({ 'Label': '', 'Value': '' });
        excelData.push({ 'Label': '', 'Value': `₹${(purchase.total_tax || 0).toLocaleString('en-IN')}` });
        excelData.push({ 'Label': '', 'Value': `₹${(purchase.items_total || 0).toLocaleString('en-IN')}` });
      }

      // Use the existing export utility
      const { exportToExcelGeneric } = require('../../../lib/export-utils');
      exportToExcelGeneric(excelData, {
        title: 'Purchase Details',
        fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}_${new Date().toISOString().split('T')[0]}`
      });

    } catch (error) {
      console.error('Excel export error:', error);
      alert('Error exporting Excel. Please try again.');
    }
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

  const getReturnStatusBadge = (status: string) => {
    switch (status) {
      case 'NO_RETURNS':
        return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">No Returns</span>;
      case 'PARTIAL_RETURN':
        return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial Return</span>;
      case 'FULLY_RETURNED':
        return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Fully Returned</span>;
      default:
        return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Unknown</span>;
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
      {/* Single Comprehensive Card */}
      <div className="card">
        {/* Purchase Banner Inside Card */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 mb-6">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-blue-100">
              Purchase #{purchase.invoice_number || purchase.invoice_no} • {purchase.vendor?.vendor_name}
            </h1>
            {purchase.return_status && (
              <div className="flex justify-center gap-2">
                {getReturnStatusBadge(purchase.return_status.status)}
                {purchase.return_status.has_returns && (
                  <span className="text-xs text-blue-200 bg-blue-800/50 px-2 py-1 rounded-full">
                    {purchase.return_status.fully_returned_items}/{purchase.return_status.total_items} items returned
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Purchase Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Items:</span>
              <span className="text-white font-medium">{purchase.items?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Invoice:</span>
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
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference:</span>
              <span className="text-white font-medium">{purchase.bill_reference || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference Date:</span>
              <span className="text-white font-medium">{(purchase as any).bill_reference_date || 'N/A'}</span>
            </div>
          </div>

          {/* Column 2: Vendor & Staff Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Vendor:</span>
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
            <div className="flex justify-between">
              <span className="text-slate-400">Staff:</span>
              <span className="text-white font-medium">{purchase.staff?.name || 'N/A'}</span>
            </div>
          </div>

          {/* Column 3: Financial Summary */}
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
              <span className="text-white font-bold">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹{purchase.total_cgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹{purchase.total_sgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹{purchase.total_igst?.toLocaleString('en-IN') || '0'}</span>
            </div>
          </div>

          {/* Column 4: Transport & Additional */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Transport:</span>
              <span className="text-white font-medium">{purchase.transport_name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Vehicle:</span>
              <span className="text-white font-medium">{purchase.vehicle_number || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Qty:</span>
              <span className="text-white font-medium">{purchase.packing_forwarding_qty || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Rate:</span>
              <span className="text-white font-medium">₹{purchase.packing_forwarding_rate?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Total:</span>
              <span className="text-white font-medium">₹{purchase.packing_forwarding_total?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Notes:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {purchase.notes || 'No notes available'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Descriptions:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {purchase.descriptions || 'No descriptions available'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Row - Separate from columns */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <ExportMenu
              data={[purchase]}
              columns={[
                { key: 'invoice_number', label: 'Invoice Number', enabled: true },
                { key: 'vendor_name', label: 'Vendor Name', enabled: true },
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
                { key: 'transport_name', label: 'Transport', enabled: true },
                { key: 'notes', label: 'Notes', enabled: true },
              ]}
              config={{
                title: 'Purchase Details',
                fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}_${new Date().toISOString().split('T')[0]}`
              }}
              onExport={(exportType) => {
                if (exportType === 'excel') {
                  handleExportPageAsExcel();
                } else if (exportType === 'pdf') {
                  handlePrintOrPDF('pdf');
                }
              }}
            />
            {purchase.return_status?.is_fully_returned ? (
              <button
                disabled
                className="btn-secondary flex items-center gap-2 opacity-50 cursor-not-allowed"
                title="Cannot edit purchase - fully returned"
              >
                <Edit className="w-4 h-4" />
                Edit Disabled (Fully Returned)
              </button>
            ) : (
              <Link
                href={`/purchases/create?edit=${id}`}
                onClick={handleEditPurchase}
                className="btn-primary flex items-center gap-2"
                title="Edit Purchase"
              >
                <Edit className="w-4 h-4" />
                Edit Purchase
              </Link>
            )}
          </div>
        </div>

        {/* Purchase Items Table - Enhanced with return information */}
        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>Bought</th>
                  <th>Returned</th>
                  <th>Available</th>
                  <th>Rate</th>
                  <th>Total (Avail × Rate)</th>
                  <th>Tax %</th>
                  <th>Tax Amount</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {purchase.items?.map((item, index) => {
                  const boughtQty = item.original_qty || item.qty || 0;
                  const returnedQty = item.returned_qty || 0;
                  const availableQty = item.available_qty !== undefined ? item.available_qty : boughtQty;
                  const isFullyReturned = item.is_fully_returned || false;

                  // Calculate based on AVAILABLE quantity
                  const qtyRateTotal = availableQty * (item.rate || 0);
                  const taxAmount = (qtyRateTotal * (item.gst_percentage || 0)) / 100;
                  const subtotal = qtyRateTotal + taxAmount;

                  return (
                    <tr key={item.id} className={isFullyReturned ? 'bg-red-900/20' : returnedQty > 0 ? 'bg-orange-900/20' : ''}>
                      <td>{index + 1}</td>
                      <td className="font-medium text-white">{item.display_name || item.product_name}</td>
                      <td className="text-slate-300">{item.part || 'N/A'}</td>
                      <td className="text-slate-300 font-medium">{boughtQty}</td>
                      <td className="text-red-400 font-medium">{returnedQty > 0 ? returnedQty : '-'}</td>
                      <td className="text-green-400 font-medium">{availableQty}</td>
                      <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300">₹{qtyRateTotal?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300">{item.gst_percentage || 0}%</td>
                      <td className="text-slate-300">₹{taxAmount?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300 font-semibold">₹{subtotal?.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                }) || (
                  <tr>
                    <td colSpan={11} className="text-center text-slate-400 py-4">
                      No items found for this purchase
                    </td>
                  </tr>
                )}
              </tbody>
              {purchase.items && purchase.items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">
                      {purchase.items?.reduce((sum, item) => sum + (item.original_qty || item.qty || 0), 0)}
                    </td>
                    <td className="text-red-400 font-bold text-left px-1 py-3 bg-slate-700/20">
                      {purchase.items?.reduce((sum, item) => sum + (item.returned_qty || 0), 0)}
                    </td>
                    <td className="text-green-400 font-bold text-left px-1 py-3 bg-slate-700/20">
                      {purchase.items?.reduce((sum, item) => sum + (item.available_qty !== undefined ? item.available_qty : (item.original_qty || item.qty || 0)), 0)}
                    </td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">
                      ₹{purchase.items?.reduce((sum, item) => {
                        const availQty = item.available_qty !== undefined ? item.available_qty : (item.original_qty || item.qty || 0);
                        return sum + (availQty * (item.rate || 0));
                      }, 0).toLocaleString('en-IN')}
                    </td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-blue-600/10 border-l border-blue-500/30">₹{purchase.items_total?.toLocaleString('en-IN')}</td>
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
