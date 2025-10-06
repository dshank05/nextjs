import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { CustomerTable } from '../../components/customer/CustomerTable';

interface Customer {
  id: number;
  billing_name: string;
  // ===== BILLING ADDRESS FIELDS =====
  billing_address?: string;
  billing_address_2?: string;
  billing_gstin?: string;
  contact_no?: string;
  email?: string;
  shipping_name?: string;
  // ===== SHIPPING ADDRESS FIELDS =====
  shipping_address?: string;
  shipping_address_2?: string;
}

export default function Customers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/customers');
      if (!response.ok) {
        throw new Error('Failed to fetch customers');
      }

      const data = await response.json();

      // Transform API data to match our interface (now includes _2 fields)
      const transformedCustomers: Customer[] = data.customers?.map((customer: any) => ({
        id: parseInt(customer.id),
        billing_name: customer.billing_name,
        // ===== BILLING ADDRESS FIELDS =====
        billing_address: customer.billing_address,
        billing_address_2: customer.billing_address_2,
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        // ===== SHIPPING ADDRESS FIELDS =====
        shipping_address: customer.shipping_address,
        shipping_address_2: customer.shipping_address_2
      })) || [];

      setCustomers(transformedCustomers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex flex-row-reverse">
        <button
          onClick={() => router.push('/customers/create')}
          className="btn-primary">
          Add Customer
        </button>
      </div>


      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading customers</div>
                <div className="text-red-300 text-sm">{error}</div>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <CustomerTable customers={customers} loading={loading} />

      {customers.length > 0 && !loading && (
        <div className="text-center text-sm text-slate-400 py-2">
          Total customers: <span className="font-semibold text-white">{customers.length}</span>
        </div>
      )}
    </div>
  );
}
