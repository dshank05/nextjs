import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Eye, DollarSign } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { ExportMenu } from '../../../components/common';
import PaymentHistoryModal from '../../../components/PaymentHistoryModal';
import QuickPaymentModal from '../../../components/QuickPaymentModal';
import { getLocalDateString } from '../../../lib/date-utils';
import { usePurchase } from '../../../hooks/usePurchases';

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

  // Return transactions
  returns?: Array<{
    id: number;
    return_no: string;
    return_date: number;
    total_amount: number;
    refund_amount: number;
    payment_status: number;
    payment_mode: number;
    payment_date: number | null;
    notes: string;
    items_count: number;
  }>;

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
  const queryClient = useQueryClient();
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);
  const [enableTax, setEnableTax] = useState(false);

  // Use React Query hook
  const { data: rawData, isLoading: loading, refetch } = usePurchase(id as string);

  // Transform data
  const purchase = rawData?.purchase || rawData || null;

  // Set tax display flag based on whether purchase has taxes
  useEffect(() => {
    if (purchase) {
      setEnableTax((purchase.total_tax || 0) > 0);
    }
  }, [purchase]);

  // Listen for broadcast messages to refresh data when this purchase is updated in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && msg.type === 'updated' && msg.id && msg.id.toString() === id?.toString()) {
        console.log(`🔄 Purchase ${msg.id} updated in another tab, refreshing view page...`);
        queryClient.invalidateQueries({ queryKey: ['purchase', id] });
      }
    });

    return unsubscribe;
  }, [id, queryClient]);

  const handleEditPurchase = () => {
    if (purchase) {
      SessionStorageService.set('purchases', id.toString(), purchase);
    }
    router.push(`/purchases/create?edit=${id}`);
  };

  // Enhanced PDF export using new layout system
  const handlePrintOrPDF = async (output: 'print' | 'pdf' = 'print') => {
    try {
      if (output === 'pdf') {
        // Use new enhanced PDF export
        const { exportToPDFWithLayout } = await import('../../../lib/export-utils-enhanced');
        const { purchaseViewExportLayout, preparePurchaseDataForExport } = await import('../../../lib/export-layouts/purchase-view-layout');

        // Fetch business details
        const businessResponse = await fetch('/api/business-details');
        const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

        // Prepare data for export
        const preparedData = preparePurchaseDataForExport(purchase);

        await exportToPDFWithLayout(
          preparedData,
          {
            title: 'Purchase Details',
            fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}`,
            layout: purchaseViewExportLayout
          },
          businessDetails
        );
      } else {
        // Keep print functionality using existing system
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
      }
    } catch (error) {
      console.error('Print/PDF error:', error);
      alert(`Error generating ${output === 'pdf' ? 'PDF' : 'print'}. Please try again.`);
    }
  };

  // Enhanced Excel export using new layout system
  const handleExportPageAsExcel = async () => {
    try {
      const { exportToExcelWithLayout } = await import('../../../lib/export-utils-enhanced');
      const { purchaseViewExportLayout, preparePurchaseDataForExport } = await import('../../../lib/export-layouts/purchase-view-layout');

      // Fetch business details
      const businessResponse = await fetch('/api/business-details');
      const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

      // Prepare data for export
      const preparedData = preparePurchaseDataForExport(purchase);

      await exportToExcelWithLayout(
        preparedData,
        {
          title: 'Purchase Details',
          fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}`,
          layout: purchaseViewExportLayout
        },
        businessDetails
      );
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
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
    }
  };

  const getReturnStatusBadge = (status: string) => {
    switch (status) {
      case 'NO_RETURNS':
        return null; // Don't show anything for no returns
      case 'PARTIAL_RETURN':
        return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial Return</span>;
      case 'FULLY_RETURNED':
        return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Return</span>;
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
              Purchase {purchase.invoice_number || purchase.invoice_no} • {purchase.vendor?.vendor_name}
            </h1>
            {purchase.return_status && purchase.return_status.has_returns && (
              <div className="flex justify-center gap-2">
                {getReturnStatusBadge(purchase.return_status.status)}
                <span className="text-xs text-blue-200 bg-blue-800/50 px-2 py-1 rounded-full">
                  {purchase.return_status.fully_returned_items}/{purchase.return_status.total_items} items returned
                </span>
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
            {(purchase as any).payment_summary && (
              <div 
                className="flex justify-between items-center "
                
              >
                <span className="text-slate-400">
                  Payment History:
                </span>
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  {(purchase as any).payment_summary.payment_count} payment{(purchase as any).payment_summary.payment_count !== 1 ? 's' : ''}
                  <div className='cursor-pointer'>
                     <Eye className="w-4 h-4"  onClick={() => setShowPaymentHistoryModal(true)}/>
                  </div>
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Mode:</span>
              <span className="text-white font-medium">{getPaymentModeText(purchase.payment_mode)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference:</span>
              <span className="text-white font-medium">{purchase.bill_reference || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference Date:</span>
              <span className="text-white font-medium">{(purchase as any).bill_reference_date || ''}</span>
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
              <span className="text-white font-medium">{purchase.vendor?.contact_no || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email:</span>
              <span className="text-white font-medium">{purchase.vendor?.email || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{purchase.vendor?.tax_id || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Staff:</span>
              <span className="text-white font-medium">{purchase.staff?.name || ''}</span>
            </div>
          </div>

          {/* Column 3: Financial Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{purchase.items_total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Total:</span>
              <span className="text-white font-medium">₹{purchase.packing_forwarding_total?.toLocaleString('en-IN') || '0'}</span>
            </div>
           
            {enableTax && (
              <div className="flex justify-between">
                <span className="text-slate-400">Taxable Value:</span>
                <span className="text-white font-medium">₹{purchase.total_taxable_value?.toLocaleString('en-IN')}</span>
              </div>
            )}
            {enableTax && (
              <div className="flex justify-between">
                <span className="text-slate-400">Total Tax:</span>
                <span className="text-white font-medium">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span className="text-slate-400">Grand Total:</span>
              <span className="text-white font-bold">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>
            {enableTax && (
              <>
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
              </>
            )}
          </div>

          {/* Column 4: Transport & Additional */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Transport:</span>
              <span className="text-white font-medium">{purchase.transport_name || ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Box Quantity:</span>
              <span className="text-white font-medium">{purchase.vehicle_number || ''}</span>
            </div>
             <div className="flex justify-between">
              <span className="text-slate-400">Freight:</span>
              <span className="text-white font-medium">₹{purchase.freight?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Qty:</span>
              <span className="text-white font-medium">{purchase.packing_forwarding_qty || '0'}</span>
            </div>
            {/* <div className="flex justify-between">
              <span className="text-slate-400">P&F Rate:</span>
              <span className="text-white font-medium">₹{purchase.packing_forwarding_rate?.toLocaleString('en-IN') || '0'}</span>
            </div> */}
            
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
                fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}_${getLocalDateString()}`
              }}
              onExport={(exportType) => {
                if (exportType === 'excel') {
                  handleExportPageAsExcel();
                } else if (exportType === 'pdf') {
                  handlePrintOrPDF('pdf');
                }
              }}
            />
            {(purchase as any).payment_summary && 
             (purchase as any).payment_summary.remaining_amount > 0 && 
             purchase.payment_status !== 1 && (
              <button
                onClick={() => setShowQuickPaymentModal(true)}
                className="btn-secondary flex items-center gap-2"
                title="Mark as Paid"
              >
                <DollarSign className="w-4 h-4" />
                Mark as Paid
              </button>
            )}
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

        {/* Purchase Items Table - Showing original purchase only */}
        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  {enableTax && <th>Taxable Value</th>}
                  {enableTax && <th>Tax %</th>}
                  {enableTax && <th>Tax Amount</th>}
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchase.items?.map((item, index) => {
                  const isFullyReturned = item.is_fully_returned || false;
                  const hasReturns = item.returned_qty && item.returned_qty > 0;

                  // Calculate based on ORIGINAL quantity
                  const taxableValue = item.qty * (item.rate || 0); // Qty × Rate
                  const taxAmount = (taxableValue * (item.gst_percentage || 0)) / 100;
                  const totalAmount = taxableValue + taxAmount;

                  return (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td className="font-medium text-white">{item.display_name || item.product_name}</td>
                      <td className="text-slate-300">{item.part || ''}</td>
                      <td className="text-slate-300 font-medium">{item.qty}</td>
                      <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                      {enableTax && <td className="text-slate-300">₹{taxableValue?.toLocaleString('en-IN')}</td>}
                      {enableTax && <td className="text-slate-300">{item.gst_percentage || 0}%</td>}
                      {enableTax && <td className="text-slate-300">₹{taxAmount?.toLocaleString('en-IN')}</td>}
                      <td className="text-slate-300 font-semibold">₹{totalAmount?.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                }) || (
                  <tr>
                    <td colSpan={enableTax ? 8 : 7} className="text-center text-slate-400 py-4">
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
                      {purchase.items?.reduce((sum, item) => sum + (item.qty || 0), 0)}
                    </td>
                    <td></td>
                    {enableTax && <td></td>}
                    {enableTax && <td></td>}
                    {enableTax && <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</td>}
                    <td className="text-white font-bold text-left px-1 py-3 bg-blue-600/10 border-l border-blue-500/30">₹{purchase.items_total?.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>


        {/* Purchase Returns Section */}
        {purchase.returns && purchase.returns.length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              📦 Purchase Returns
            </h3>
            <div className="space-y-6">
              {purchase.returns.map((ret: any) => {
                // Use items from API response (already filtered to this bill)
                const returnItems = ret.items || [];

                return (
                  <div key={ret.id} className="bg-slate-800 border border-slate-700 rounded p-4">
                    {/* Multi-Bill Indicator */}
                    {ret.is_multi_bill_return && (
                      <div className="bg-blue-50/10 border border-blue-500/30 rounded p-2 mb-4">
                        <span className="text-blue-300 text-sm">
                          ℹ️ This return includes items from {ret.total_bills_count} bills
                        </span>
                      </div>
                    )}

                    {/* Return Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div>
                        <span className="text-slate-400 text-sm">Return Number:</span>
                        <div className="text-white font-medium">{ret.return_no}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Date:</span>
                        <div className="text-white font-medium">{formatDate(ret.return_date)}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">
                          {ret.is_multi_bill_return ? 'This Bill:' : 'Total Amount:'}
                        </span>
                        <div className="text-white font-medium">₹{ret.this_bill_total?.toLocaleString('en-IN')}</div>
                        {ret.is_multi_bill_return && (
                          <div className="text-slate-400 text-xs mt-1">
                            Total: ₹{ret.refund_amount?.toLocaleString('en-IN')} ({ret.total_bills_count} bills)
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Refund Amount:</span>
                        <div className="text-white font-medium">₹{ret.refund_amount?.toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Payment Status:</span>
                        <div>{getStatusBadge(ret.payment_status)}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Payment Mode:</span>
                        <div className="text-white font-medium">{getPaymentModeText(ret.payment_mode)}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Payment Date:</span>
                        <div className="text-white font-medium">{ret.payment_date ? formatDate(ret.payment_date) : ''}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-sm">Items:</span>
                        <div className="text-white font-medium">
                          {ret.this_bill_items_count} item(s)
                          {ret.is_multi_bill_return && (
                            <span className="text-slate-400 text-xs ml-1">
                              (Total: {ret.total_items_count})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Return Items Table - Tax columns hidden */}
                    {returnItems.length > 0 && (
                      <div className="mt-4 overflow-x-auto border-t border-slate-700 pt-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-2">Returned Items:</h4>
                        <table className="table text-sm">
                          <thead>
                            <tr>
                              <th className="w-12">SN</th>
                              <th>Product Name</th>
                              <th>Part No</th>
                              <th>Qty</th>
                              <th>Rate</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {returnItems.map((item: any, index: number) => (
                              <tr key={index} className="bg-red-900/10">
                                <td>{index + 1}</td>
                                <td className="font-medium text-white">{item.display_name || item.product_name}</td>
                                <td className="text-slate-300">{item.part_number || ''}</td>
                                <td className="text-slate-300 font-medium">{item.qty}</td>
                                <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                                <td className="text-slate-300 font-semibold">₹{item.total?.toLocaleString('en-IN')}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-slate-700 bg-slate-800/50">
                              <td></td>
                              <td></td>
                              <td></td>
                              <td className="text-white font-bold">
                                {returnItems.reduce((sum: number, item: any) => sum + (item.qty || 0), 0)}
                              </td>
                              <td></td>
                              <td className="text-white font-bold">₹{ret.this_bill_total?.toLocaleString('en-IN')}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {ret.notes && (
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <span className="text-slate-400 text-sm">Notes:</span>
                        <div className="text-white text-sm mt-1">{ret.notes}</div>
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-slate-700 flex justify-end">
                      <Link
                        href={`/entry/purchasereturn-vendor/${ret.id}`}
                        className="btn-secondary text-sm"
                      >
                        Edit Return
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {(purchase as any).payment_summary && (
        <>
          <PaymentHistoryModal
            isOpen={showPaymentHistoryModal}
            onClose={() => setShowPaymentHistoryModal(false)}
            summary={(purchase as any).payment_summary}
            history={(purchase as any).payment_history || []}
          />
          <QuickPaymentModal
            isOpen={showQuickPaymentModal}
            onClose={() => setShowQuickPaymentModal(false)}
            onSuccess={() => {
              refetch();
              setShowQuickPaymentModal(false);
            }}
            purchaseId={purchase.id}
            vendorId={purchase.vendor_id || 0}
            vendorName={purchase.vendor?.vendor_name || ''}
            outstandingAmount={(purchase as any).payment_summary.remaining_amount}
            totalBill={(purchase as any).payment_summary.total_bill}
            totalPaid={(purchase as any).payment_summary.total_paid}
            paymentHistory={(purchase as any).payment_history || []}
          />
        </>
      )}
    </div>
  );
}
