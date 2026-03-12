import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit } from 'lucide-react';
import { useSnackbar } from '../../../components/SnackbarProvider';
import SessionStorageService from '../../../lib/sessionStorage';
import RefundHistoryModal from '../../../components/RefundHistoryModal';
import QuickRefundModal from '../../../components/QuickRefundModal';
import { ExportMenu } from '../../../components/common/ExportMenu';
import { getLocalDateString } from '../../../lib/date-utils';
import { usePurchaseReturn } from '../../../hooks/usePurchases';
import type { PurchaseReturn, ReturnItem } from '../../../types/purchases';

export default function PurchaseReturnDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { showSnackbar } = useSnackbar();

  const [showRefundHistoryModal, setShowRefundHistoryModal] = useState(false);
  const [showQuickRefundModal, setShowQuickRefundModal] = useState(false);

  // Fetch purchase return using query hook
  const { data: apiData, isLoading, error } = usePurchaseReturn(id as string);

  // Transform and memoize return data
  const returnData = useMemo((): PurchaseReturn | null => {
    if (!apiData?.data) return null;

    const returnInfo = apiData.data.return;
    const vendorInfo = apiData.data.vendor;
    const billsInfo = apiData.data.bills;

    const statusText = returnInfo.payment_status === 1 ? 'Complete' : 'Incomplete';

    return {
      id: returnInfo.id,
      return_no: returnInfo.return_no,
      return_date: returnInfo.return_date,
      vendor_id: vendorInfo.id,
      vendor_name: vendorInfo.vendor_name,
      vendor_address: vendorInfo.address || '',
      vendor_gstin: vendorInfo.gstin || '',
      total_amount: returnInfo.total_amount,
      total_tax: returnInfo.total_tax,
      refund_amount: returnInfo.refund_amount || 0,
      status: returnInfo.payment_status || 0,
      payment_status: returnInfo.payment_status || 0,
      payment_mode: returnInfo.payment_mode || 0,
      fy: returnInfo.fy,
      notes: returnInfo.notes,
      item_count: billsInfo.reduce((sum: number, bill: any) => sum + (bill.items?.length || 0), 0),
      formattedDate: returnInfo.return_date ? new Date(returnInfo.return_date).toLocaleDateString('en-IN') : '',
      statusText: statusText
    };
  }, [apiData]);

  // Transform and memoize return items
  const returnItems = useMemo((): ReturnItem[] => {
    if (!apiData?.data?.bills) return [];

    const billsInfo = apiData.data.bills;
    const allReturnItems: ReturnItem[] = [];

    billsInfo.forEach((bill: any) => {
      bill.items.forEach((item: any, index: number) => {
        allReturnItems.push({
          id: item.id || (bill.id + index),
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

    // Filter to show only actually returned items
    return allReturnItems.filter(item => {
      return item.return_qty > 0 || (item.return_reason && item.return_reason !== 'Unknown Reason');
    });
  }, [apiData]);

  const handleEditReturn = () => {
    if (apiData?.data && id) {
      // Cache the full return data to session storage like purchase edit
      SessionStorageService.set('purchase-returns', id.toString(), apiData.data);
      router.push(`/entry/purchasereturn-vendor-create?id=${id}`);
    }
  };

  // Enhanced Excel export using new layout system
  const handleExportPageAsExcel = async () => {
    if (!returnData) return;

    try {
      const { exportToExcelWithLayout } = await import('../../../lib/export-utils-enhanced');
      const { preparePurchaseReturnDataForExport } = await import('../../../lib/export-layouts/purchase-return-view-layout');

      // Prepare data and get dynamic layout
      const { data: preparedData, layout: dynamicLayout } = preparePurchaseReturnDataForExport(returnData, returnItems, apiData?.data);

      await exportToExcelWithLayout(
        preparedData,
        {
          title: `Purchase Return ${returnData.return_no}`,
          fileName: `Purchase_Return_${returnData.return_no}`,
          layout: dynamicLayout
        },
      );
    } catch (error) {
      console.error('Excel export error:', error);
      showSnackbar('error', 'Error exporting Excel. Please try again.');
    }
  };

  // Enhanced PDF export using new layout system
  const handlePrintOrPDF = async (output: 'print' | 'pdf' = 'print') => {
    if (!returnData) return;

    try {
      if (output === 'pdf') {
        // Use new enhanced PDF export
        const { exportToPDFWithLayout } = await import('../../../lib/export-utils-enhanced');
        const { preparePurchaseReturnDataForExport } = await import('../../../lib/export-layouts/purchase-return-view-layout');

        // Prepare data and get dynamic layout
        const { data: preparedData, layout: dynamicLayout } = preparePurchaseReturnDataForExport(returnData, returnItems, apiData?.data);

        await exportToPDFWithLayout(
          preparedData,
          {
            title: `Purchase Return ${returnData.return_no}`,
            fileName: `Purchase_Return_${returnData.return_no}`,
            layout: dynamicLayout
          },
        );
      } else {
        // Keep print functionality using existing system
        const { printPage } = await import('../../../lib/export-utils');

        // Fetch business details
        const businessResponse = await fetch('/api/business-details');
        const businessDetails = businessResponse.ok ? await businessResponse.json() : null;

        await printPage({
          title: 'Purchase Return Invoice',
          businessDetails,
          output,
          pageType: 'return-view',
          data: returnData
        });
      }
    } catch (error) {
      console.error('PDF export error:', error);
      showSnackbar('error', 'Error exporting PDF. Please try again.');
    }
  };

  if (isLoading) {
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
              <div className="text-slate-400 text-sm mt-2">{error instanceof Error ? error.message : 'Return not found'}</div>
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
            {/* {(fullApiData as any)?.refund_summary && (
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
            )} */}
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
            {returnData.total_tax > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Tax:</span>
                  <span className="text-white font-medium">₹{returnData.total_tax}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Packing & Forwarding:</span>
                  <span className="text-white font-medium">₹{(apiData?.data?.return?.packing_forwarding_amount || 0)}</span>
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
              </>
            )}
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
            <ExportMenu
              data={[returnData]}
              columns={[]}
              config={{
                title: `Purchase Return #${returnData.return_no}`,
                fileName: `purchase-return-${returnData.return_no}-${getLocalDateString()}`
              }}
              onExport={(exportType) => {
                if (exportType === 'excel') {
                  handleExportPageAsExcel();
                } else if (exportType === 'pdf') {
                  handlePrintOrPDF('pdf');
                }
              }}
            />
            {/* {(fullApiData as any)?.refund_summary && (fullApiData as any).refund_summary.remaining_amount > 0 && (
              <button
                onClick={() => setShowQuickRefundModal(true)}
                className="btn-secondary flex items-center gap-2"
                title="Mark as Refunded"
              >
                <DollarSign className="w-4 h-4" />
                Mark as Refunded
              </button>
            )} */}
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
                  {returnData.total_tax > 0 && (
                    <>
                      <th>Tax %</th>
                      <th>Tax Amount</th>
                    </>
                  )}
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
                    {returnData.total_tax > 0 && (
                      <>
                        <td className="text-slate-300">{item.tax_rate}%</td>
                        <td className="text-slate-300">₹{item.tax_amount}</td>
                      </>
                    )}
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
                  {returnData.total_tax > 0 && (
                    <>
                      <td></td>
                      <td className="text-white font-bold text-center py-3 bg-slate-700/20">
                        ₹{returnItems.reduce((sum, item) => sum + item.tax_amount, 0)}
                      </td>
                    </>
                  )}
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
      {apiData?.data?.refund_summary && (
        <>
          <RefundHistoryModal
            isOpen={showRefundHistoryModal}
            onClose={() => setShowRefundHistoryModal(false)}
            summary={apiData.data.refund_summary}
            history={apiData.data.refund_history || []}
          />
          <QuickRefundModal
            isOpen={showQuickRefundModal}
            onClose={() => setShowQuickRefundModal(false)}
            onSuccess={() => {
              // Refetch will happen automatically via query invalidation
              setShowQuickRefundModal(false);
            }}
            returnId={returnData?.id || 0}
            vendorId={returnData?.vendor_id || 0}
            vendorName={returnData?.vendor_name || ''}
            outstandingAmount={apiData.data.refund_summary.remaining_amount}
          />
        </>
      )}
    </div>
  );
}
