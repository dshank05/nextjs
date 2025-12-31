import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Eye, DollarSign } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { ExportMenu } from '../../../components/common/ExportMenu';
import PaymentHistoryModal from '../../../components/PaymentHistoryModal';
import QuickPaymentModal from '../../../components/QuickPaymentModal';

interface InvoiceItem {
  product_id: number;
  name_of_product: string;
  display_name?: string;
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
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);

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

  // Enhanced Excel export using new layout system
  const handleExportPageAsExcel = async () => {
    try {
      const { exportToExcelWithLayout } = await import('../../../lib/export-utils-enhanced');
      const { saleViewExportLayout, prepareSaleDataForExport } = await import('../../../lib/export-layouts/sale-view-layout');

      // Fetch business details
      const businessResponse = await fetch('/api/business-details');
      const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

      // Prepare data for export
      const preparedData = prepareSaleDataForExport(invoice);

      await exportToExcelWithLayout(
        preparedData,
        {
          title: 'Sales Invoice Details',
          fileName: `Sale_Invoice_${invoice.invoice_no}`,
          layout: saleViewExportLayout
        },
        businessDetails
      );
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Error exporting Excel. Please try again.');
    }
  };

  // Enhanced PDF export using new layout system
  const handlePrintOrPDF = async (output: 'print' | 'pdf' = 'pdf') => {
    try {
      const { exportToPDFWithLayout } = await import('../../../lib/export-utils-enhanced');
      const { saleViewExportLayout, prepareSaleDataForExport } = await import('../../../lib/export-layouts/sale-view-layout');

      // Fetch business details
      const businessResponse = await fetch('/api/business-details');
      const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

      // Prepare data for export
      const preparedData = prepareSaleDataForExport(invoice);

      await exportToPDFWithLayout(
        preparedData,
        {
          title: 'Sales Invoice Details',
          fileName: `Sale_Invoice_${invoice.invoice_no}`,
          layout: saleViewExportLayout
        },
        businessDetails
      );
    } catch (error) {
      console.error('PDF error:', error);
      alert('Error generating PDF. Please try again.');
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
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
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
        {/* Sales Banner Inside Card */}
        <div className="bg-green-900/20 border border-green-700/50 rounded p-4 mb-6">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-green-100">
              Sales Invoice #{invoice.invoice_no} • {invoice.customer?.billing_name}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Sale Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{invoice.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Items:</span>
              <span className="text-white font-medium">{invoice.invoiceItems?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Invoice:</span>
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
            {(invoice as any).payment_summary && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">
                  Payment History:
                </span>
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  {(invoice as any).payment_summary.payment_count} payment{(invoice as any).payment_summary.payment_count !== 1 ? 's' : ''}
                  <div className='cursor-pointer'>
                    <Eye className="w-4 h-4" onClick={() => setShowPaymentHistoryModal(true)} />
                  </div>
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Mode:</span>
              <span className="text-white font-medium">{getPaymentModeText(invoice.payment_mode)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference:</span>
              <span className="text-white font-medium">{invoice.bill_reference || 'N/A'}</span>
            </div>
          </div>

          {/* Column 2: Customer Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Customer:</span>
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
            <div className="flex justify-between">
              <span className="text-slate-400">Staff:</span>
              <span className="text-white font-medium">{invoice.staff?.name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mechanic:</span>
              <span className="text-white font-medium">{invoice.mechanic?.name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Commission:</span>
              <span className="text-white font-medium">₹{invoice.commission?.toLocaleString('en-IN') || '0'}</span>
            </div>
          </div>

          {/* Column 3: Financial Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{invoice.items_total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Total:</span>
              <span className="text-white font-medium">₹{invoice.packing_forwarding_total?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Taxable Value:</span>
              <span className="text-white font-medium">₹{invoice.total_taxable_value?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Tax:</span>
              <span className="text-white font-medium">₹{invoice.total_tax?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-slate-400">Grand Total:</span>
              <span className="text-white font-bold">₹{invoice.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹{invoice.total_cgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹{invoice.total_sgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹{invoice.total_igst?.toLocaleString('en-IN') || '0'}</span>
            </div>
          </div>

          {/* Column 4: Transport & Additional */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Transport:</span>
              <span className="text-white font-medium">{invoice.transport_name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Vehicle:</span>
              <span className="text-white font-medium">{invoice.vehicle_number || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Freight:</span>
              <span className="text-white font-medium">₹{invoice.freight?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Qty:</span>
              <span className="text-white font-medium">{invoice.packing_forwarding_qty || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">P&F Rate:</span>
              <span className="text-white font-medium">₹{invoice.packing_forwarding_rate?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Notes:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {invoice.notes || 'No notes available'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Descriptions:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {invoice.descriptions || 'No descriptions available'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Row - Separate from columns */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <ExportMenu
              data={[invoice]}
              columns={[
                { key: 'invoice_no', label: 'Invoice Number', enabled: true },
                { key: 'customer_name', label: 'Customer Name', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
              ]}
              config={{
                title: 'Sales Invoice Details',
                fileName: `Sale_Invoice_${invoice.invoice_no}_${new Date().toISOString().split('T')[0]}`
              }}
              onExport={(exportType) => {
                if (exportType === 'excel') {
                  handleExportPageAsExcel();
                } else if (exportType === 'pdf') {
                  handlePrintOrPDF('pdf');
                }
              }}
            />
            {(invoice as any).payment_summary && (invoice as any).payment_summary.remaining_amount > 0 && (
              <button
                onClick={() => setShowQuickPaymentModal(true)}
                className="btn-secondary flex items-center gap-2"
                title="Mark as Paid"
              >
                <DollarSign className="w-4 h-4" />
                Mark as Paid
              </button>
            )}
            <Link
              href={`/sale/create?edit=${id}`}
              onClick={handleEditInvoice}
              className="btn-primary flex items-center gap-2"
              title="Edit Invoice"
            >
              <Edit className="w-4 h-4" />
              Edit Invoice
            </Link>
          </div>
        </div>

        {/* Invoice Items Table */}
        <div className="border-t border-slate-700 mt-6 pt-6">
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
                  <th>Taxable Value</th>
                  <th>Tax %</th>
                  <th>Tax Amount</th>
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((item, index) => {
                  const taxableValue = item.qty * (item.rate || 0);
                  const taxAmount = (taxableValue * (item.gst_percentage || 0)) / 100;
                  const totalAmount = taxableValue + taxAmount;

                  return (
                    <tr key={item.product_id}>
                      <td>{index + 1}</td>
                      <td className="font-medium text-white">{item.display_name || item.name_of_product}</td>
                      <td className="text-slate-300">{item.part || 'N/A'}</td>
                      <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                      <td className="text-slate-300 font-medium">{item.qty}</td>
                      <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300">₹{taxableValue?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300">{item.gst_percentage || 0}%</td>
                      <td className="text-slate-300">₹{taxAmount?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300 font-semibold">₹{totalAmount?.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
                {invoiceItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center text-slate-400 py-4">
                      No items found for this invoice
                    </td>
                  </tr>
                )}
              </tbody>
              {invoiceItems.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">
                      {invoiceItems.reduce((sum, item) => sum + (item.qty || 0), 0)}
                    </td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">
                      ₹{invoiceItems.reduce((sum, item) => sum + (item.qty * (item.rate || 0)), 0)?.toLocaleString('en-IN')}
                    </td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">₹{invoice.total_tax?.toLocaleString('en-IN') || '0'}</td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-blue-600/10 border-l border-blue-500/30">₹{invoice.items_total?.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Modals */}
      {(invoice as any).payment_summary && (
        <>
          <PaymentHistoryModal
            isOpen={showPaymentHistoryModal}
            onClose={() => setShowPaymentHistoryModal(false)}
            summary={(invoice as any).payment_summary}
            history={(invoice as any).payment_history || []}
          />
          <QuickPaymentModal
            isOpen={showQuickPaymentModal}
            onClose={() => setShowQuickPaymentModal(false)}
            onSuccess={() => {
              fetchInvoice();
              setShowQuickPaymentModal(false);
            }}
            purchaseId={invoice.invoice_no}
            vendorId={invoice.customer_id || 0}
            vendorName={invoice.customer?.billing_name || ''}
            outstandingAmount={(invoice as any).payment_summary.remaining_amount}
            totalBill={(invoice as any).payment_summary.total_bill}
            totalPaid={(invoice as any).payment_summary.total_paid}
            paymentHistory={(invoice as any).payment_history || []}
          />
        </>
      )}
    </div>
  );
}
