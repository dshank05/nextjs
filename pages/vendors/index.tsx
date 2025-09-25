import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { VendorTable } from '../../components/vendor/VendorTable';

interface Vendor {
  id: number;
  vendor_name: string;
  address?: string;
  address_2?: string;
  contact_no?: string;
  email?: string;
  tax_id?: string;
}

export default function Vendors() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/vendors');
      if (!response.ok) {
        throw new Error('Failed to fetch vendors');
      }

      const data = await response.json();

      // Transform API data to match our interface
      const transformedVendors: Vendor[] = data.vendors?.map((vendor: any) => ({
        id: parseInt(vendor.id),
        vendor_name: vendor.vendor_name,
        address: vendor.address,
        address_2: vendor.address_2,
        tax_id: vendor.tax_id,
        contact_no: vendor.contact_no,
        email: vendor.email
      })) || [];

      setVendors(transformedVendors);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch vendors:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your vendor database</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchVendors}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => router.push('/vendors/create')}
            className="btn-primary">
            Add Vendor
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading vendors</div>
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

      <VendorTable vendors={vendors} loading={loading} />

      {vendors.length > 0 && !loading && (
        <div className="text-center text-sm text-slate-400 py-2">
          Total vendors: <span className="font-semibold text-white">{vendors.length}</span>
        </div>
      )}
    </div>
  );
}
