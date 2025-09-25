import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface Customer {
  id: string;
  billing_name: string;
  billing_address: string;
  billing_state: string | null;
  billing_state_code: number | null;
  billing_gstin: string | null;
  contact_no: string | null;
  email: string | null;
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_state: string | null;
  shipping_state_code: number | null;
  shipping_gstin: string | null;
}

export default function CustomerView() {
  const router = useRouter();
  const { id } = router.query;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchCustomer();
    }
  }, [id]);

  const fetchCustomer = async () => {
    try {
      const response = await fetch(`/api/customers/${id}`);
      if (response.ok) {
        const data = await response.json();
        setCustomer(data);
      }
    } catch (error) {
      console.error('Error fetching customer:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Customer not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Customer Overview Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6">
          {/* Left: Customer Info */}
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-48 h-32 bg-blue-600/20 rounded-xl flex items-center justify-center mb-4">
              <div className="text-4xl">👤</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{customer.billing_name}</h3>
            <p className="text-slate-400 text-sm mb-2">{customer.contact_no || 'No phone'}</p>
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="text-blue-400 hover:text-blue-300 text-sm">
                {customer.email}
              </a>
            )}
          </div>

          {/* Right: Basic Information + Actions */}
          <div className="space-y-4">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{customer.billing_gstin || 'Not provided'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">State:</span>
              <span className="text-white font-medium">{customer.billing_state || 'Not provided'} ({customer.billing_state_code})</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{customer.contact_no || 'Not provided'}</span>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button className="btn-primary">✏️ Edit Customer</button>
              <button className="btn-danger">🗑️ Delete Customer</button>
            </div>
          </div>
        </div>
      </div>

      {/* Billing Information Card */}
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">📄 Billing Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 pt-0">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🏢 Billing Details</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Name:</span>
                <span className="text-white font-medium">{customer.billing_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GSTIN:</span>
                <span className="text-white font-medium font-mono">{customer.billing_gstin || 'N/A'}</span>
              </div>
              <div className="space-y-2">
                <span className="text-slate-400">Address:</span>
                <div className="bg-slate-700 rounded p-3 text-white text-sm">
                  {customer.billing_address}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">State:</span>
                <span className="text-white font-medium">{customer.billing_state} ({customer.billing_state_code})</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📞 Contact Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-400">Phone:</span>
                <span className="text-white font-medium">{customer.contact_no || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="text-white font-medium">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="text-blue-400 hover:text-blue-300">
                      {customer.email}
                    </a>
                  ) : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Shipping Information Card (if different) */}
      {(customer.shipping_name || customer.shipping_address) && (
        <div className="card">
          <h2 className="text-xl font-semibold text-white mb-6 p-6 pb-0">🚚 Shipping Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 pt-0">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">🏢 Shipping Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-slate-400">Name:</span>
                  <span className="text-white font-medium">{customer.shipping_name || customer.billing_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">GSTIN:</span>
                  <span className="text-white font-medium font-mono">{customer.shipping_gstin || customer.billing_gstin || 'N/A'}</span>
                </div>
                <div className="space-y-2">
                  <span className="text-slate-400">Address:</span>
                  <div className="bg-slate-700 rounded p-3 text-white text-sm">
                    {customer.shipping_address || customer.billing_address}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">State:</span>
                  <span className="text-white font-medium">{customer.shipping_state || customer.billing_state} ({customer.shipping_state_code || customer.billing_state_code})</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 border-b border-slate-700 pb-2">📝 Notes</h3>
              <div className="bg-slate-700 rounded p-3 text-white text-sm min-h-24">
                {customer.shipping_name && customer.shipping_address ? 'Separate shipping address provided' : 'Same as billing address'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction History Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Sales */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">RECENT SALES</h3>
          <div className="p-6">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Date</th>
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

        {/* Recent Payments */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">RECENT PAYMENTS</h3>
          <div className="p-6">
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

        {/* Outstanding Balance */}
        <div className="card">
          <h3 className="text-xl font-semibold text-white p-6 pb-4 border-b border-slate-700">ACCOUNT SUMMARY</h3>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Total Outstanding:</span>
                <span className="text-orange-400 font-semibold">₹0.00</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Last Transaction:</span>
                <span className="text-white font-medium">No transactions</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Credit Limit:</span>
                <span className="text-white font-medium">Not set</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
