import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';
import { useSaleReturn } from '../../../hooks/useSales';
import type { SaleReturnItem } from '../../../types/sales';

export default function SaleReturnDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  // Query hook
  const { data: apiData, isLoading, error } = useSaleReturn(id as string);

  // Transform data
  const returnData = apiData?.data?.return ? {
    id: apiData.data.return.id,
    return_no: apiData.data.return.return_no,
    return_date: apiData.data.return.return_date,
    customer_id: apiData.data.customer.id,
    customer_name: apiData.data.customer.customer_name || apiData.data.customer.billing_name || 'Other',
    customer_address: apiData.data.customer.address || '',
    customer_gstin: apiData.data.customer.gstin || '',
    total_amount: apiData.data.return.total_amount,
    total_tax: apiData.data.return.total_tax || 0,
    status: apiData.data.return.payment_status || 0,
    fy: apiData.data.return.fy,
    notes: apiData.data.return.notes,
    formattedDate: apiData.data.return.return_date ? new Date(apiData.data.return.return_date).toLocaleDateString('en-IN') : '',
    statusText: apiData.data.return.payment_status === 1 ? 'Complete' : 'Incomplete',
    invoice_type: apiData.data.return.invoice_type
  } : null;

  // Transform return items
  const returnItems: SaleReturnItem[] = apiData?.data?.bills ? apiData.data.bills.flatMap((bill: any) =>
    bill.items.map((item: any, index: number) => ({
      id: item.id || (bill.id + index),
      product_name: item.product_name || item.display_name,
      part_number: item.part_number,
      return_qty: item.return_qty,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate || 0,
      tax_amount: item.tax_amount || 0,
      subtotal: item.return_qty * item.unit_price,
      total: (item.return_qty * item.unit_price) + (item.tax_amount || 0),
      return_reason: item.return_reason || 'Unknown Reason',
      notes: item.notes || '',
      bill_reference: bill.invoice_no,
      bill_date: bill.invoice_date,
      invoice_no: bill.invoice_no
    }))
  ).filter((item: SaleReturnItem) => item.return_qty > 0 || (item.return_reason && item.return_reason !== 'Unknown Reason')) : [];

  const handleEditReturn = () => {
    if (apiData?.data && id) {
      // Cache the full return data to session storage
      SessionStorageService.set('sale-returns', id.toString(), apiData.data);
      router.push(`/entry/salereturn-create?id=${id}`);
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
              <div className="text-slate-400 text-sm mt-2">{error?.message || 'Return not found'}</div>
              <Link
                href="/entry/salereturn"
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
      {/* Single Comprehensive Card */}
      <div className="card">
        {/* Return Banner Inside Card */}
        <div className="bg-green-900/20 border border-green-700/50 rounded p-4 mb-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-green-100">
              Return #{returnData.return_no} • {returnData.customer_name}
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
          </div>

          {/* Column 2: Customer Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Customer:</span>
              <span className="text-white font-medium">{returnData.customer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{returnData.customer_gstin || 'N/A'}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Address:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {returnData.customer_address || 'N/A'}
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

        {/* Actions Row */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
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

        {/* Return Items Table */}
        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Invoice No</th>
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
    </div>
  );
}
