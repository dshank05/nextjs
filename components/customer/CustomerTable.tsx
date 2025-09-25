import React, { useState, useEffect } from 'react';
import { Eye, Edit, Trash2 } from 'lucide-react';

interface Customer {
  id: number;
  billing_name: string;
  billing_address?: string;
  billing_gstin?: string;
  contact_no?: string;
  email?: string;
  shipping_name?: string;
  shipping_address?: string;
}

interface CustomerTableProps {
  customers: Customer[];
  loading?: boolean;
}

export const CustomerTable: React.FC<CustomerTableProps> = ({ customers, loading = false }) => {
  const [sortBy, setSortBy] = useState<string>('billing_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedCustomers = [...customers].sort((a, b) => {
    let aValue: any = a[sortBy as keyof Customer];
    let bValue: any = b[sortBy as keyof Customer];

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  if (loading) {
    return (
      <div className="card h-[400px] flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>S.No</th>
              <th>UID</th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('billing_name')}>
                Customer Name {sortBy === 'billing_name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th>Contact Number</th>
              <th>Email Address</th>
              <th>GSTIN</th>
              <th>Billing Address</th>
              <th>Shipping Address</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedCustomers.map((customer, idx) => (
              <tr key={customer.id} className="hover:bg-slate-800/30">
                <td className="text-center font-semibold text-slate-400">{idx + 1}</td>
                <td className="text-slate-500 text-sm font-mono">{customer.id}</td>
                <td className="font-medium text-white">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center">
                      <span className="text-blue-300 text-sm font-semibold">
                        {customer.billing_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span>{customer.billing_name}</span>
                  </div>
                </td>
                <td className="text-slate-300">
                  {customer.contact_no ? (
                    <a href={`tel:${customer.contact_no}`} className="hover:text-blue-400 transition-colors">
                      {customer.contact_no}
                    </a>
                  ) : '-'}
                </td>
                <td className="text-slate-300">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="hover:text-blue-400 transition-colors text-ellipsis max-w-40 block">
                      {customer.email}
                    </a>
                  ) : '-'}
                </td>
                <td className="text-slate-300 font-mono text-sm">
                  {customer.billing_gstin || '-'}
                </td>
                <td className="text-slate-300 max-w-48 truncate" title={customer.billing_address}>
                  {customer.billing_address || '-'}
                </td>
                <td className="text-slate-300 max-w-48 truncate" title={customer.shipping_address}>
                  {customer.shipping_address || '-'}
                </td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn-primary text-xs py-1 px-3" title="View Details">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="btn-secondary text-xs py-1 px-3" title="Edit Customer">
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {customers.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">👥</div>
            <h3 className="text-lg font-semibold text-white mb-2">No customers found</h3>
            <p className="text-slate-400">Start by adding your first customer to the database.</p>
          </div>
        )}
      </div>
    </div>
  );
};
