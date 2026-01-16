import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Printer, Edit, Trash2, Building2, FileText, Package, ClipboardList, Eye, DollarSign } from 'lucide-react';
import { useSnackbar } from '../../../components/SnackbarProvider';
import SessionStorageService from '../../../lib/sessionStorage';
import RefundHistoryModal from '../../../components/RefundHistoryModal';
import QuickRefundModal from '../../../components/QuickRefundModal';

interface PurchaseReturn {
  id: number;
  return_no: string;
  return_date: string;
  vendor_id: number;
  vendor_name: string;
  vendor_address?: string;
  vendor_gstin?: string;
  total_amount: number;
  total_tax: number;
  status: number;
  fy: number;
  notes?: string;
  formattedDate?: string;
  statusText?: string;
}

interface ReturnItem {
  id: number;
  product_name: string;
  part_number?: string;
  return_qty: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  return_reason: string;
  notes?: string;
  bill_reference?: string;
  bill_date?: string;
  invoice_no?: string;
}

export default function PurchaseReturnDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { showSnackbar } = useSnackbar();

  const [returnData, setReturnData] = useState<PurchaseReturn | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [fullApiData, setFullApiData] = useState<any>(null); // Store full API response for session storage
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRefundHistoryModal, setShowRefundHistoryModal] = useState(false);
  const [showQuickRefundModal, setShowQuickRefundModal] = useState(false);

  useEffect(() => {
    if (id) {
      fetchReturnDetails(id as string);
    }
  }, [id]);

  const fetchReturnDetails = async (returnId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/purchase-returns/${returnId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch return details: ${response.status}`);
      }

      const data = await response.json();

      // Store full API response for session storage
      setFullApiData(data.data);

      const returnInfo = data.data.return;
      const vendorInfo = data.data.vendor;
      const billsInfo = data.data.bills;

      // Transform API data to match our interface
      // Convert status number to text
      const statusText = returnInfo.payment_status === 1 ? 'Complete' : 'Incomplete'
      
      const returnData: PurchaseReturn = {
        id: returnInfo.id,
        return_no: returnInfo.return_no,
        return_date: returnInfo.return_date,
        vendor_id: vendorInfo.id,
        vendor_name: vendorInfo.vendor_name,
        vendor_address: vendorInfo.address || '',
        vendor_gstin: vendorInfo.gstin || '',
        total_amount: returnInfo.total_amount,
        total_tax: returnInfo.total_tax,
        status: returnInfo.payment_status || 0, // Use payment_status (0=Incomplete, 1=Complete)
        fy: returnInfo.fy,
        notes: returnInfo.notes,
        formattedDate: returnInfo.return_date ? new Date(returnInfo.return_date).toLocaleDateString('en-IN') : '',
        statusText: statusText
      };

      // Transform return items from bills
      const allReturnItems: ReturnItem[] = [];
      billsInfo.forEach((bill: any) => {
        bill.items.forEach((item: any, index: number) => {
          allReturnItems.push({
            id: item.id || (bill.id + index), // Fallback ID if not provided
            product_name: item.product_name,
            part_number: item.part_number,
            return_qty: item.return_qty,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            tax_amount: item.tax_amount,
            subtotal: item.return_qty * item.unit_price,
            total: item.total,
            return_reason: item.return_reason || 'Unknown Reason',
            notes: item.notes || '',
            bill_reference: bill.invoice_no,
            bill_date: bill.invoice_date,
            invoice_no: bill.invoice_no
          });
        });
      });

      // ✅ Filter to show only actually returned items
      // Hide items with return_qty=0 AND no valid reason (Unknown Reason)
      const actuallyReturnedItems = allReturnItems.filter(item => {
        return item.return_qty > 0 || (item.return_reason && item.return_reason !== 'Unknown Reason');
      });

      setReturnData(returnData);
      setReturnItems(actuallyReturnedItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load return details');
      console.error('Error fetching return details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditReturn = () => {
    if (fullApiData && id) {
      // Cache the full return data to session storage like purchase edit
      SessionStorageService.set('purchase-returns', id.toString(), fullApiData);
      router.push(`/entry/purchasereturn-vendor-create?id=${id}`);
    }
  };

  const handleDeleteReturn = () => {
    if (returnData) {
      // TODO: Implement delete functionality
      showSnackbar('info', 'Delete functionality will be implemented');
    }
  };

  const handlePrintReturn = () => {
    // TODO: Implement print functionality
    showSnackbar('info', 'Print functionality will be implemented');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="card">
          <div className="p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-slate-700 rounded mb-4"></div>
              <div className="h-4 bg-slate-700 rounded mb-2"></div>
              <div className="h-4 bg-slate-700 rounded mb-6"></div>
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-slate-700 rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !returnData) {
    return (
      <div className="space-y-6">
        <div className="card">
          <div className="p-6">
            <div className="text-center py-8">
              <div className="text-red-400 text-lg mb-2">⚠️</div>
              <div className="text-red-400 font-medium">Error loading return details</div>
              <div className="text-slate-400 text-sm mt-2">{error || 'Return not found'}</div>
              <Link
                href="/entry/purchasereturn-vendor"
                className="btn-secondary mt-4 inline-block"
              >
                Back to Returns List
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Single Comprehensive Card - Like Purchase View */}
      <div className="card">
        {/* Return Banner Inside Card */}
        <div className="bg-red-900/20 border border-red-700/50 rounded p-4 mb-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-red-100">
              Return #{returnData.return_no} • {returnData.vendor_name}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Return Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{returnData.total_amount?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Items:</span>
              <span className="text-white font-medium">{returnItems.reduce((sum, item) => sum + item.return_qty, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Return #:</span>
              <span className="text-white font-medium">{returnData.return_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Date:</span>
              <span className="text-white font-medium">{returnData.formattedDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status:</span>
              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${returnData.status === 1 ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'
                }`}>
                {returnData.statusText}
              </span>
            </div>
            {(fullApiData as any)?.refund_summary && (
              <div
                className="flex justify-between"

              >
                <span className="text-slate-400">
                  Refund History:
                </span>
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  {(fullApiData as any).refund_summary.refund_count} refund{(fullApiData as any).refund_summary.refund_count !== 1 ? 's' : ''}
                  <div className='cursor-pointer'>
                    <Eye className="w-4 h-4" onClick={() => setShowRefundHistoryModal(true)} />
                  </div>

                </span>
              </div>
            )}
          </div>

          {/* Column 2: Vendor Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Vendor:</span>
              <span className="text-white font-medium">{returnData.vendor_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{returnData.vendor_gstin || 'N/A'}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Address:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {returnData.vendor_address || 'N/A'}
              </div>
            </div>
          </div>

          {/* Column 3: Financial Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + item.subtotal, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Tax:</span>
              <span className="text-white font-medium">₹{returnData.total_tax}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Packing & Forwarding:</span>
              <span className="text-white font-medium">₹{((fullApiData as any)?.return?.packing_forwarding_amount || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).cgst || 0, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).sgst || 0, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).igst || 0, 0)}</span>
            </div>
          </div>

          {/* Column 4: Notes */}
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Return Notes:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-24">
                {returnData.notes || 'No notes available'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Row - Separate from columns */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <button
              onClick={handlePrintReturn}
              className="btn-secondary flex items-center gap-2"
              title="Print Return"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            {(fullApiData as any)?.refund_summary && (fullApiData as any).refund_summary.remaining_amount > 0 && (
              <button
                onClick={() => setShowQuickRefundModal(true)}
                className="btn-secondary flex items-center gap-2"
                title="Mark as Refunded"
              >
                <DollarSign className="w-4 h-4" />
                Mark as Refunded
              </button>
            )}
            <button
              onClick={handleEditReturn}
              className="btn-primary flex items-center gap-2"
              title="Edit Return"
            >
              <Edit className="w-4 h-4" />
              Edit Return
            </button>
          </div>
        </div>

        {/* Return Items by Bill - Compact Table */}
        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Bill No</th>
                  <th>Bill Ref</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Tax %</th>
                  <th>Tax Amount</th>
                  <th>Subtotal</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {returnItems.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">
                      <div>{item.product_name}</div>
                      {item.part_number && (
                        <div className="text-slate-400 text-xs">Part: {item.part_number}</div>
                      )}
                    </td>
                    <td className="text-slate-300 font-medium">{item.invoice_no}</td>
                    <td className="text-slate-300">{item.bill_reference}</td>
                    <td className="text-slate-300 font-medium">{item.return_qty}</td>
                    <td className="text-slate-300">₹{item.unit_price}</td>
                    <td className="text-slate-300">{item.tax_rate}%</td>
                    <td className="text-slate-300">₹{item.tax_amount}</td>
                    <td className="text-slate-300 font-semibold">₹{item.subtotal}</td>
                    <td className="text-slate-300">
                      <div className="font-medium">{item.return_reason}</div>
                      {item.notes && (
                        <div className="text-slate-400 text-xs mt-1">{item.notes}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-700 bg-slate-800/30">
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td className="text-white font-bold text-center py-3 bg-slate-700/20">
                    {returnItems.reduce((sum, item) => sum + item.return_qty, 0)}
                  </td>
                  <td></td>
                  <td></td>
                  <td className="text-white font-bold text-center py-3 bg-slate-700/20">
                    ₹{returnItems.reduce((sum, item) => sum + item.tax_amount, 0)}
                  </td>
                  <td className="text-white font-bold text-center py-3 bg-blue-600/10 border-l border-blue-500/30">
                    ₹{returnItems.reduce((sum, item) => sum + item.subtotal, 0)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      </div>

      {/* Modals */}
      {(fullApiData as any)?.refund_summary && (
        <>
          <RefundHistoryModal
            isOpen={showRefundHistoryModal}
            onClose={() => setShowRefundHistoryModal(false)}
            summary={(fullApiData as any).refund_summary}
            history={(fullApiData as any).refund_history || []}
          />
          <QuickRefundModal
            isOpen={showQuickRefundModal}
            onClose={() => setShowQuickRefundModal(false)}
            onSuccess={() => {
              fetchReturnDetails(id as string);
              setShowQuickRefundModal(false);
            }}
            returnId={returnData?.id || 0}
            vendorId={returnData?.vendor_id || 0}
            vendorName={returnData?.vendor_name || ''}
            outstandingAmount={(fullApiData as any).refund_summary.remaining_amount}
          />
        </>
      )}
    </div>
  );
}
