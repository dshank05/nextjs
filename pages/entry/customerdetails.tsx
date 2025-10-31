import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useDebounce } from '../../hooks/useDebounce';
import { CustomerTable } from '../../components/customer/CustomerTable';
import { subscribeBroadcast } from '../../lib/broadcast';

interface Customer {
  id: number;
  billing_name: string;
  billing_address?: string;
  billing_address_2?: string;
  billing_city?: string;
  billing_pin_code?: string;
  billing_state?: string;
  billing_state_code?: number;
  billing_gstin?: string;
  contact_no?: string;
  email?: string;
  shipping_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pin_code?: string;
  shipping_state?: string;
  shipping_state_code?: number;
  shipping_gstin?: string;
}

interface CustomerResponse {
  customers: Omit<Customer, 'id'> & { id: string }[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export default function CustomerDetailsPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Reset to page 1 when search changes
  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  // Fetch customers when pagination or search changes
  useEffect(() => {
    fetchCustomers();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  // Listen for broadcast messages to refresh data when customers are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'customers' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Customer ${msg.type} in another tab, refreshing data...`);
        fetchCustomers();
      }
    });

    return unsubscribe;
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm
      });

      const response = await fetch(`/api/customers?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch customers');
      }

      const data: CustomerResponse = await response.json();

      // Transform API data to match our interface
      const transformedCustomers: Customer[] = data.customers?.map((customer: any) => ({
        id: parseInt(customer.id),
        billing_name: customer.billing_name,
        billing_address: customer.billing_address,
        billing_address_2: customer.billing_address_2,
        billing_city: customer.billing_city,
        billing_state: customer.billing_state,
        billing_state_code: customer.billing_state_code,
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        shipping_address: customer.shipping_address,
        shipping_address_2: customer.shipping_address_2,
        shipping_city: customer.shipping_city,
        shipping_state: customer.shipping_state,
        shipping_state_code: customer.shipping_state_code,
        shipping_gstin: customer.shipping_gstin
      })) || [];

      setCustomers(transformedCustomers);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  return (
    <div className="space-y-6">
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

      <CustomerTable
        customers={customers}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        actionButton={
          <a
            href="/customers/create"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Add Customer
          </a>
        }
      />
      {/* 
      {customers.length > 0 && !loading && (
        <div className="text-center text-sm text-slate-400 py-2">
          Total customers: <span className="font-semibold text-white">{customers.length}</span>
        </div>
      )} */}
    </div>
  );
}
