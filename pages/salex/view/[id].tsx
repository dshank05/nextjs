import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Eye, DollarSign } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { ExportMenu } from '../../../components/common/ExportMenu';
import PaymentHistoryModal from '../../../components/PaymentHistoryModal';
import QuickPaymentModal from '../../../components/QuickPaymentModal';
import { useSalexItem } from '../../../hooks/useSalex';

interface InvoiceItem {
  id: number;
  invoice_no?: number;
  product_id?: number;
  product_name?: string;
  display_name?: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  rate: number;
  subtotal?: number;
  total?: number;
  gst_percentage?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  tax?: number;
  discount?: number;
  discountrate?: number;
  invoice_date?: number;
  fy?: number;
  car_model?: string;
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

interface Invoice {
  id: number;
  invoice_no?: string;
  customer_id?: number;
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
  items_total?: number;
  freight?: number;
  total_taxable_value?: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  total?: number;
  notes?: string;
  descriptions?: string;
  date?: number;
  payment_status?: number;
  payment_mode?: number;
  fy?: number;
  bill_reference?: string;
  staff_details?: string;
  staff_id?: number;
  commission?: number;
  mechanic_id?: number;
  formattedDate?: string;
  customer?: Customer;
  staff?: Staff;
  mechanic?: Mechanic;
  vehicle_number?: string;
  transport_name?: string;
  packing_forwarding_qty?: number;
  packing_forwarding_rate?: number;
  packing_forwarding_total?: number;
  item_count?: number;
  items?: InvoiceItem[];
}

export default function InvoiceCView() {
  const router = useRouter();
  const { id } = router.query;
  const queryClient = useQueryClient();
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);

  // Use React Query hook
  const { data: invoice, isLoading: loading, refetch } = useSalexItem(id as string);

  const invoiceItems = invoice?.items || [];

  // Listen for broadcast messages to refresh data when salex are updated in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'salex' && msg.type === 'updated' && msg.data?.id === parseInt(id as string)) {
        console.log(`🔄 Salex ${msg.data.id} updated in another tab, refreshing data...`);
        queryClient.invalidateQueries({ queryKey: ['salex-item', id] });
      }
    });

    return unsubscribe;
  }, [id, queryClient]);

  const handleEditInvoice = () => {
    if (invoice) {
      SessionStorageService.set('salex', id.toString(), {
        invoice,
        invoiceItems
      });
    }
  };

  // Enhanced Excel export - placeholder for future implementation
  const handleExportPageAsExcel = async () => {
    try {
      alert('Excel export for Invoice C is coming soon!');
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Error exporting Excel. Please try again.');
    }
  };

  // Enhanced PDF export - placeholder for future implementation
  const handlePrintOrPDF = async () => {
    try {
      alert('PDF export for Invoice C is coming soon!');
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

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
    }
  };

  const getPaymentStatusText = (status?: number) => {
    switch (status) {
      case 0: return 'Unpaid';
      case 1: return 'Paid';
      case 2: return 'Partially Paid';
      default: return 'N/A';
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
        {/* Invoice C Banner Inside Card */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 mb-6">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-blue-100">
              Invoice C #{invoice.invoice_no} • {invoice.customer?.billing_name || invoice.customer_name}
            </h1>
            <div className="flex justify-center gap-2">
              <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">Tax-Free</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Invoice C Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{invoice.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Items:</span>
              <span className="text-white font-medium">{invoice.items?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Invoice C:</span>
              <span className="text-white font-medium">{invoice.invoice_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Date:</span>
              <span className="text-white font-medium">{formatDate(invoice.date)}</span>
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
              <span className="text-white font-medium">{invoice.customer?.billing_name || invoice.customer_name || 'N/A'}</span>
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
              <span className="text-white font-medium">{invoice.customer?.billing_gstin || invoice.customer_gstin || 'N/A'}</span>
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
              <span className="text-white font-medium">₹0</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-slate-400">Grand Total:</span>
              <span className="text-white font-bold">₹{invoice.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹0</span>
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
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
              ]}
              config={{
                title: 'Invoice C Details',
                fileName: `Invoice_C_${invoice.invoice_no}_${new Date().toISOString().split('T')[0]}`
              }}
              onExport={(exportType) => {
                if (exportType === 'excel') {
                  handleExportPageAsExcel();
                } else if (exportType === 'pdf') {
                  handlePrintOrPDF();
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
              href={`/salex/create?edit=${id}`}
              onClick={handleEditInvoice}
              className="btn-primary flex items-center gap-2"
              title="Edit Invoice C"
            >
              <Edit className="w-4 h-4" />
              Edit Invoice C
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
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((item, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">{item.display_name || item.product_name}</td>
                    <td className="text-slate-300">{item.part || 'N/A'}</td>
                    <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                    <td className="text-slate-300 font-medium">{item.qty}</td>
                    <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300 font-semibold">₹{item.subtotal?.toLocaleString('en-IN')}</td>
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
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="text-white font-bold text-left px-1 py-3 bg-slate-700/20">
                      {invoiceItems.reduce((sum, item) => sum + (item.qty || 0), 0)}
                    </td>
                    <td></td>
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
              refetch();
              setShowQuickPaymentModal(false);
            }}
            purchaseId={invoice.id}
            vendorId={invoice.customer_id || 0}
            vendorName={invoice.customer?.billing_name || invoice.customer_name || ''}
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
