import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Printer, Edit, Trash2, Building2, FileText, Package, ClipboardList } from 'lucide-react';
import { useSnackbar } from '../../../components/SnackbarProvider';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchReturnDetails(id as string);
    }
  }, [id]);

  const fetchReturnDetails = async (returnId: string) => {
    setLoading(true);
    try {
      // For now, use mock data since API endpoints don't exist yet
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API delay

      // Mock return data
      const mockReturn: PurchaseReturn = {
        id: parseInt(returnId),
        return_no: 'PR-001',
        return_date: '2025-01-15',
        vendor_id: 1,
        vendor_name: 'ABC Auto Parts',
        vendor_address: '123 Industrial Area, Delhi',
        vendor_gstin: '07AABCU9603R1ZN',
        total_amount: 25000,
        total_tax: 2250,
        status: 1,
        fy: 2025,
        notes: 'Damaged parts return - brake pads were defective',
        formattedDate: '15 Jan 2025',
        statusText: 'Completed'
      };

      // Mock return items - grouped by bill
      const mockItems: ReturnItem[] = [
        // Bill INV-001 items
        {
          id: 1,
          product_name: 'Brake Pads Front',
          part_number: 'BP-001-FRONT',
          return_qty: 4,
          unit_price: 500,
          tax_rate: 18,
          tax_amount: 360,
          subtotal: 2000,
          total: 2360,
          return_reason: 'Manufacturing Defect',
          notes: 'Pads were cracking after installation',
          bill_reference: 'BILL-001',
          bill_date: '2025-01-15',
          invoice_no: 'INV-001'
        },
        {
          id: 2,
          product_name: 'Brake Pads Rear',
          part_number: 'BP-001-REAR',
          return_qty: 4,
          unit_price: 400,
          tax_rate: 18,
          tax_amount: 288,
          subtotal: 1600,
          total: 1888,
          return_reason: 'Manufacturing Defect',
          notes: 'Poor quality material',
          bill_reference: 'BILL-001',
          bill_date: '2025-01-15',
          invoice_no: 'INV-001'
        },
        // Bill INV-002 items
        {
          id: 3,
          product_name: 'Brake Discs',
          part_number: 'BD-001',
          return_qty: 2,
          unit_price: 1500,
          tax_rate: 18,
          tax_amount: 540,
          subtotal: 3000,
          total: 3540,
          return_reason: 'Wrong Item Shipped',
          notes: 'Received wrong size discs',
          bill_reference: 'BILL-002',
          bill_date: '2025-02-10',
          invoice_no: 'INV-002'
        },
        // Bill INV-003 items
        {
          id: 4,
          product_name: 'Oil Filter',
          part_number: 'OF-001',
          return_qty: 5,
          unit_price: 200,
          tax_rate: 0,
          tax_amount: 0,
          subtotal: 1000,
          total: 1000,
          return_reason: 'Expired Product',
          notes: 'Product past expiry date',
          bill_reference: 'BILL-003',
          bill_date: '2025-03-05',
          invoice_no: 'INV-003'
        }
      ];

      setReturnData(mockReturn);
      setReturnItems(mockItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load return details');
      console.error('Error fetching return details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditReturn = () => {
    if (returnData) {
      router.push(`/entry/purchasereturn-vendor-create?id=${returnData.id}`);
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
              <span className="text-white font-bold text-lg">₹{returnData.total_amount.toLocaleString()}</span>
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
              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                returnData.status === 1 ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'
              }`}>
                {returnData.statusText}
              </span>
            </div>
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
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Tax:</span>
              <span className="text-white font-medium">₹{returnData.total_tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-slate-400">Grand Total:</span>
              <span className="text-white font-bold">₹{returnData.total_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).cgst || 0, 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).sgst || 0, 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹{returnItems.reduce((sum, item) => sum + (item as any).igst || 0, 0).toFixed(2)}</span>
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
                  <th>Bill</th>
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
                    <td className="text-slate-300">
                      <div className="font-medium">{item.invoice_no}</div>
                      <div className="text-xs text-slate-400">{item.bill_reference}</div>
                    </td>
                    <td className="text-slate-300 font-medium">{item.return_qty}</td>
                    <td className="text-slate-300">₹{item.unit_price.toFixed(2)}</td>
                    <td className="text-slate-300">{item.tax_rate}%</td>
                    <td className="text-slate-300">₹{item.tax_amount.toFixed(2)}</td>
                    <td className="text-slate-300 font-semibold">₹{item.subtotal.toFixed(2)}</td>
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
                  <td className="text-white font-bold text-center py-3 bg-slate-700/20">
                    {returnItems.reduce((sum, item) => sum + item.return_qty, 0)}
                  </td>
                  <td></td>
                  <td></td>
                  <td className="text-white font-bold text-center py-3 bg-slate-700/20">
                    ₹{returnItems.reduce((sum, item) => sum + item.tax_amount, 0).toFixed(2)}
                  </td>
                  <td className="text-white font-bold text-center py-3 bg-blue-600/10 border-l border-blue-500/30">
                    ₹{returnItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)}
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
