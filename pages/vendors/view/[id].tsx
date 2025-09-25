import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface Vendor {
  id: string;
  vendor_name: string;
  address: string;
  address_2: string | null;
  state: string | null;
  state_code: number | null;
  contact_no: string | null;
  email: string | null;
  tax_id: string | null;
}

interface TransactionItem {
  id: number;
  invoice_no: number;
  name_of_product: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  rate: number;
  subtotal: number;
}

interface Transaction {
  id: number;
  invoice_no: number;
  vendor_name?: string;
  vendor_address?: string;
  vendor_gstin?: string;
  items_total: number;
  total_taxable_value: number;
  total: number;
  invoice_date: number;
  fy: number;
  items?: TransactionItem[];
  item_count?: number;
}

export default function VendorView() {
  const router = useRouter();
  const { id } = router.query;
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentPurchases, setRecentPurchases] = useState<Transaction[]>([]);
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [accountSummary, setAccountSummary] = useState({
    totalOutstanding: 0,
    lastTransaction: null,
    creditLimit: 0
  });

  useEffect(() => {
    if (id) {
      fetchVendor();
      fetchTransactions();
    }
  }, [id]);

  const fetchVendor = async () => {
    try {
      const response = await fetch(`/api/vendors/${id}`);
      if (response.ok) {
        const data = await response.json();
        setVendor(data);
      }
    } catch (error) {
      console.error('Error fetching vendor:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      // Simulate API calls for transaction data
      // In real implementation, these would call actual APIs
      setRecentPurchases([]);
      setRecentPayments([]);
      setAccountSummary({
        totalOutstanding: 0,
        lastTransaction: null,
        creditLimit: 0
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Vendor not found</p>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-IN');
  };

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      default: return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Unknown</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Vendor Overview Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Vendor Info */}
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-48 h-32 bg-green-600/20 rounded-xl flex items-center justify-center mb-4">
              <div className="text-4xl">🏭</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{vendor.vendor_name}</h3>
            <p className="text-slate-400 text-sm mb-1">{vendor.contact_no || 'No phone'}</p>
            {vendor.email && (
              <a href={`mailto:${vendor.email}`} className="text-blue-400 hover:text-blue-300 text-sm">
                {vendor.email}
              </a>
            )}
          </div>

          {/* Right: Basic Information + Actions */}
          <div className="space-y-4">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">TAX ID:</span>
              <span className="text-white font-medium">{vendor.tax_id || 'Not provided'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">State:</span>
              <span className="text-white font-medium">{vendor.state || 'Not provided'} ({vendor.state_code})</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{vendor.contact_no || 'Not provided'}</span>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button className="btn-primary">✏️ Edit Vendor</button>
              <button className="btn-danger">🗑️ Delete Vendor</button>
            </div>
          </div>
        </div>
      </div>

      {/* Vendor Information Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">🏢 Vendor Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 pt-0">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📍 Address Details</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Vendor Name:</span>
                <span className="text-white font-medium">{vendor.vendor_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">TAX ID:</span>
                <span className="text-white font-medium font-mono">{vendor.tax_id || 'N/A'}</span>
              </div>
              <div className="space-y-2">
                <span className="text-slate-400">Address:</span>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  <div>{vendor.address}</div>
                  {vendor.address_2 && <div>{vendor.address_2}</div>}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">State:</span>
                <span className="text-white font-medium">{vendor.state} ({vendor.state_code})</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📞 Contact Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Phone:</span>
                <span className="text-white font-medium">{vendor.contact_no || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="text-white font-medium">
                  {vendor.email ? (
                    <a href={`mailto:${vendor.email}`} className="text-blue-400 hover:text-blue-300">
                      {vendor.email}
                    </a>
                  ) : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction History Section - Using Purchase Table Style */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Purchases */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">RECENT PURCHASES</h3>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPurchases.length > 0 ? (
                    recentPurchases.map((purchase, i) => (
                      <tr key={purchase.id}>
                        <td>{i + 1}</td>
                        <td className="text-white font-medium">{purchase.invoice_no}</td>
                        <td className="text-slate-300 font-semibold">₹{purchase.total.toLocaleString('en-IN')}</td>
                        <td>-</td>
                      </tr>
                    ))
                  ) : (
                    // Placeholder rows
                    Array.from({ length: 3 }, (_, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="text-slate-400">-</td>
                        <td className="text-slate-400">-</td>
                        <td className="text-slate-400">-</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Recent Payments */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">RECENT PAYMENTS</h3>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.length > 0 ? (
                    recentPayments.map((payment, i) => (
                      <tr key={payment.id}>
                        <td>{i + 1}</td>
                        <td className="text-white font-medium">{payment.invoice}</td>
                        <td className="text-slate-300 font-semibold">₹{payment.amount?.toLocaleString('en-IN')}</td>
                        <td>{getStatusBadge(payment.status)}</td>
                      </tr>
                    ))
                  ) : (
                    // Placeholder rows
                    Array.from({ length: 3 }, (_, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="text-slate-400">-</td>
                        <td className="text-slate-400">-</td>
                        <td className="text-slate-400">-</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Account Summary */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">ACCOUNT SUMMARY</h3>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Total Outstanding:</span>
                <span className="text-red-400 font-semibold">₹{accountSummary.totalOutstanding.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Last Transaction:</span>
                <span className="text-white font-medium">
                  {accountSummary.lastTransaction ? formatDate(accountSummary.lastTransaction) : 'No transactions'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Credit Limit:</span>
                <span className="text-white font-medium">
                  ₹{accountSummary.creditLimit?.toLocaleString('en-IN') || 'Not set'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase Returns Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Purchase Returns */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">PURCHASE RETURNS</h3>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>Voucher</th>
                    <th>Amount</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Placeholder rows */}
                  {Array.from({ length: 3 }, (_, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="text-slate-400">-</td>
                      <td className="text-slate-400">-</td>
                      <td className="text-slate-400">-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Purchase Return Payments */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">PURCHASE RETURN PAYMENTS</h3>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>Voucher</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Placeholder rows */}
                  {Array.from({ length: 3 }, (_, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="text-slate-400">-</td>
                      <td className="text-slate-400">-</td>
                      <td className="text-slate-400">-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
