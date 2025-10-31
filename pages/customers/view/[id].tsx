import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ConfirmationModal } from '../../../components/ConfirmationModal';

interface Customer {
  id: string;
  billing_name: string;
  billing_address: string;
  billing_address_2: string | null;
  billing_city: string | null;
  billing_pin_code: string | null;
  billing_state: string | null;
  billing_state_code: number | null;
  billing_gstin: string | null;
  contact_no: string | null;
  contact_no_2: string | null;
  contact_no_3: string | null;
  email: string | null;
  status: string;
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_address_2: string | null;
  shipping_city: string | null;
  shipping_pin_code: string | null;
  shipping_state: string | null;
  shipping_state_code: number | null;
  shipping_gstin: string | null;
}

export default function CustomerView() {
  const router = useRouter();
  const { id } = router.query;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusModalData, setStatusModalData] = useState<{
    newStatus: string;
    customerId: string;
    customerName: string;
  } | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

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

  const handleStatusToggle = (customerId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    setStatusModalData({
      newStatus,
      customerId,
      customerName: customer?.billing_name || ''
    });
    setShowStatusModal(true);
  };

  const confirmStatusChange = async () => {
    if (!statusModalData) return;

    setStatusUpdating(true);
    try {
      const response = await fetch(`/api/customers/${statusModalData.customerId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: statusModalData.newStatus,
          confirmed: true
        }),
      });

      if (response.ok) {
        // Update local state
        if (customer) {
          setCustomer({
            ...customer,
            status: statusModalData.newStatus
          });
        }
        setShowStatusModal(false);
        setStatusModalData(null);
      } else {
        const error = await response.json();
        console.error('Status update failed:', error);
      }
    } catch (error) {
      console.error('Status update error:', error);
    } finally {
      setStatusUpdating(false);
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
    <div className="space-y-4">
      <div className="card p-4">
        {/* Customer Overview Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Left: Customer Info */}
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-40 h-24 bg-blue-600/20 rounded-xl flex items-center justify-center mb-3">
              <div className="text-3xl">👤</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">{customer.billing_name}</h3>
            <p className="text-slate-400 mb-1">{customer.contact_no || 'No phone'}</p>
          </div>

          {/* Right: Basic Information + Actions */}
          <div className="space-y-3">
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{customer.billing_gstin || 'Not provided'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">State:</span>
              <span className="text-white font-medium">{customer.billing_state || 'Not provided'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Status:</span>
              <span className={`px-2 py-1 rounded-full text-xs ${
                customer.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {customer.status}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">
                {customer.contact_no}
                {customer.contact_no_2 && `, ${customer.contact_no_2}`}
                {customer.contact_no_3 && `, ${customer.contact_no_3}`}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-1">
              <span className="text-slate-400">Email:</span>
              <span className="text-white font-medium">
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="text-blue-400 hover:text-blue-300">
                    {customer.email}
                  </a>
                ) : 'Not provided'}
              </span>
            </div>

            <div className="flex justify-end pt-3">
              <button
                className={`px-4 py-2 rounded text-white font-medium ${
                  customer.status === 'Active'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
                onClick={() => handleStatusToggle(customer.id, customer.status)}
              >
                {customer.status === 'Active' ? 'Deactivate' : 'Activate'} Customer
              </button>
              <Link
                href={`/customers/create?id=${customer.id}`}
                className="btn-primary px-4 py-2 ml-2"
              >
                ✏️ Edit Customer
              </Link>
            </div>
          </div>
        </div>

        {/* Billing Information Section */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white mb-4">📄 Billing Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex justify-between">
              <span className="text-slate-400">Name:</span>
              <span className="text-white font-medium">{customer.billing_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium font-mono">{customer.billing_gstin || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Phone:</span>
              <span className="text-white font-medium">{customer.contact_no || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">City:</span>
              <span className="text-white font-medium">{customer.billing_city || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Address:</span>
              <span className="text-white font-medium">{customer.billing_address}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Address 2:</span>
              <span className="text-white font-medium">{customer.billing_address_2 || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pin Code:</span>
              <span className="text-white font-medium">{customer.billing_pin_code || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">State:</span>
              <span className="text-white font-medium">{customer.billing_state}</span>
            </div>
          </div>
        </div>

        {/* Shipping Information Section (if different) */}
        {(customer.shipping_name || customer.shipping_address) && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-4 mt-6 pt-4 border-t border-slate-700">🚚 Shipping Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex justify-between">
                <span className="text-slate-400">Name:</span>
                <span className="text-white font-medium">{customer.shipping_name || customer.billing_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">GSTIN:</span>
                <span className="text-white font-medium font-mono">{customer.shipping_gstin || customer.billing_gstin || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">City:</span>
                <span className="text-white font-medium">{customer.shipping_city || customer.billing_city || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">State:</span>
                <span className="text-white font-medium">{customer.shipping_state || customer.billing_state}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Address:</span>
                <span className="text-white font-medium">{customer.shipping_address || customer.billing_address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Address 2:</span>
                <span className="text-white font-medium">{customer.shipping_address_2 || customer.billing_address_2 || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pin Code:</span>
                <span className="text-white font-medium">{customer.shipping_pin_code || customer.billing_pin_code || 'N/A'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Commented out tables that were removed during layout consolidation */}
      {/*
      // RECENT SALES, RECENT PAYMENTS, ACCOUNT SUMMARY tables would go here
      // These were removed to simplify the customer view interface
      */}

      {/* Status Change Confirmation Modal */}
      <ConfirmationModal
        isOpen={showStatusModal}
        title={`${statusModalData?.newStatus === 'Active' ? 'Activate' : 'Deactivate'} Customer`}
        message={`Are you sure you want to ${statusModalData?.newStatus === 'Active' ? 'activate' : 'deactivate'} customer "${statusModalData?.customerName}"? This will affect their availability in transaction selections.`}
        showLoading={statusUpdating}
        onConfirm={confirmStatusChange}
        onCancel={() => {
          setShowStatusModal(false);
          setStatusModalData(null);
        }}
      />
    </div>
  );
}
