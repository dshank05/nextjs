import React, { useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';

interface Vendor {
  id: number;
  vendor_name: string;
  address?: string;
  address_2?: string;
  city?: string;
  pin_code?: string;
  state?: string;
  contact_no?: string;
  email?: string;
  tax_id?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface VendorTableProps {
  vendors: Vendor[];
  pagination?: Pagination;
  loading?: boolean;
  onPageChange?: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
}

export const VendorTable: React.FC<VendorTableProps> = ({ vendors, pagination, loading = false, onPageChange, searchTerm, onSearchChange, itemsPerPage, onItemsPerPageChange }) => {
  const getPageNumbers = () => {
    if (!pagination) return [];
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };
  const [sortBy, setSortBy] = useState<string>('vendor_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedVendors = [...vendors].sort((a, b) => {
    let aValue: any = a[sortBy as keyof Vendor];
    let bValue: any = b[sortBy as keyof Vendor];

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="card">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
            <input
              type="text"
              placeholder="Search by name, phone, email..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
            <select
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(parseInt(e.target.value))}
              className="select w-full min-w-24"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {vendors.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} vendors</div>
          <div>Page {pagination.page} of {pagination.totalPages}</div>
        </div>
      )}
      <div className="overflow-x-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>S.No</th>
              <th>UID</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('vendor_name')}>
                Vendor Name {sortBy === 'vendor_name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th>Contact Number</th>
              <th>Email Address</th>
              <th>GST ID</th>
              <th>City</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedVendors.map((vendor, idx) => (
              <tr key={vendor.id} className="hover:bg-slate-800/30">
                <td className="text-center font-semibold text-slate-400">{idx + 1}</td>
                <td className="text-slate-500 text-sm font-mono">{vendor.id}</td>
                <td className="font-medium text-white">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-600/20 rounded-full flex items-center justify-center">
                      <span className="text-emerald-300 text-sm font-semibold">
                        {vendor.vendor_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span>{vendor.vendor_name}</span>
                  </div>
                </td>
                <td className="text-slate-300">
                  {vendor.contact_no ? (
                    <a href={`tel:${vendor.contact_no}`} className="hover:text-blue-400 transition-colors">
                      {vendor.contact_no}
                    </a>
                  ) : '-'}
                </td>
                <td className="text-slate-300">
                  {vendor.email ? (
                    <a href={`mailto:${vendor.email}`} className="hover:text-blue-400 transition-colors text-ellipsis max-w-40 block">
                      {vendor.email}
                    </a>
                  ) : '-'}
                </td>
                <td className="text-slate-300 font-mono text-sm">
                  {vendor.tax_id || '-'}
                </td>
                <td className="text-slate-300">
                  {vendor.city || '-'}
                </td>
                <td>
                  <Link
                    href={`/vendors/view/${vendor.id}`}
                    className="text-slate-400 hover:text-blue-400 transition-colors p-2 rounded hover:bg-slate-700/50"
                    title="View Details"
                  >
                    <Eye className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {vendors.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">🏢</div>
            <h3 className="text-lg font-semibold text-white mb-2">No vendors found</h3>
            <p className="text-slate-400">Start by adding your first vendor to the database.</p>
          </div>
        )}
      </div>

      {(pagination && pagination.totalPages > 1 && onPageChange) && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
          <button onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
          <div className="flex space-x-2">
            {pagination.page > 3 && <> <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
            {getPageNumbers().map(p => <button key={p} onClick={() => onPageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
            {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
          </div>
          <button onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
};
