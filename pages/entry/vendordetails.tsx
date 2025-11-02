import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useDebounce } from '../../hooks/useDebounce';
import { VendorTable } from '../../components/vendor/VendorTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';

interface Vendor {
  id: number;
  vendor_name: string;
  status?: string;
  address?: string;
  address_2?: string;
  city?: string;
  contact_no?: string;
  email?: string;
  tax_id?: string;
}

interface VendorResponse {
  vendors: Omit<Vendor, 'id'> & { id: string }[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export default function VendorDetailsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'vendor_name', label: 'Vendor Name', enabled: true },
    { key: 'contact_no', label: 'Contact Number', enabled: true },
    { key: 'email', label: 'Email', enabled: true },
    { key: 'tax_id', label: 'GST ID', enabled: true },
    { key: 'city', label: 'City', enabled: true },
    { key: 'status', label: 'Status', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Vendor Details Report',
        fileName: `Vendor_Details_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, vendors, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = vendors.map(vendor => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = vendor.id;
            break;
          case 'vendor_name':
            row['Vendor Name'] = vendor.vendor_name;
            break;
          case 'contact_no':
            row['Contact Number'] = vendor.contact_no || '';
            break;
          case 'email':
            row.Email = vendor.email || '';
            break;
          case 'tax_id':
            row['GST ID'] = vendor.tax_id || '';
            break;
          case 'city':
            row.City = vendor.city || '';
            break;
          case 'status':
            row.Status = vendor.status || 'Active';
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Vendor Details Report',
      fileName: `Vendor_Details_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  // Reset to page 1 when search changes
  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  // Fetch vendors when pagination or search changes
  useEffect(() => {
    fetchVendors();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  // Listen for broadcast messages to refresh data when vendors are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'vendors' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Vendor ${msg.type} in another tab, refreshing data...`);
        fetchVendors();
      }
    });

    return unsubscribe;
  }, []);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm
      });

      const response = await fetch(`/api/vendors?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch vendors');
      }

      const data: VendorResponse = await response.json();

      // Transform API data to match our interface
      const transformedVendors: Vendor[] = data.vendors?.map((vendor: any) => ({
        id: parseInt(vendor.id),
        vendor_name: vendor.vendor_name,
        status: vendor.status,
        address: vendor.address,
        address_2: vendor.address_2,
        tax_id: vendor.tax_id,
        contact_no: vendor.contact_no,
        city:vendor.city,
        email: vendor.email
      })) || [];

      setVendors(transformedVendors);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch vendors:', err);
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

      <VendorTable
        vendors={vendors}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={handleExport}
        actionButton={
          <a
            href="/vendors/create"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Add Vendor
          </a>
        }
      />

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />

      {/*
      {vendors.length > 0 && !loading && (
        <div className="text-center text-sm text-slate-400 py-2">
          Total vendors: <span className="font-semibold text-white">{vendors.length}</span>
        </div>
      )} */}
    </div>
  );
}
