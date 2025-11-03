import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ClearableInput } from '../../components/common';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface User {
  id: number;
  username: string;
  auth_key: string;
  password_hash: string;
  password_reset_token: string | null;
  email: string;
  phone: string | null;
  status: number;
  created_at: number;
  updated_at: number;
  index: number;
}

interface UserResponse {
  users: User[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ id: 0, username: '', email: '', phone: '', password: '', status: '' });
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'username', label: 'Username', enabled: true },
    { key: 'email', label: 'Email', enabled: true },
    { key: 'phone', label: 'Phone', enabled: true },
    { key: 'status', label: 'Status', enabled: true },
    { key: 'created_at', label: 'Created Date', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector: showExportColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF, ExportConfig } = require('../../lib/export-utils');
      const config = {
        title: 'Users Report',
        fileName: `Users_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, users, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = users.map(user => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = user.id;
            break;
          case 'username':
            row.Username = user.username;
            break;
          case 'email':
            row.Email = user.email;
            break;
          case 'phone':
            row.Phone = user.phone || '';
            break;
          case 'status':
            row.Status = getStatusText(user.status);
            break;
          case 'created_at':
            row['Created Date'] = formatDate(user.created_at);
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric, ExportConfig } = require('../../lib/export-utils');
    const config = {
      title: 'Users Report',
      fileName: `Users_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelExportSelection = () => {
    closeColumnSelector();
  };

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchUsers();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/users?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({ id: 0, username: '', email: '', phone: '', password: '', status: '' });
    setShowModal(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone || '',
      password: '',
      status: user.status.toString()
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const requestData = {
        username: formData.username,
        email: formData.email,
        phone: formData.phone || null,
        password: formData.password,
        status: formData.status,
        ...(editingUser && { id: formData.id })
      };

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save user');
      }

      setShowModal(false);
      fetchUsers(); // Refresh the list
    } catch (error) {
      console.error('Error saving user:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getStatusText = (status: number) => {
    return status === 10 ? 'Active' : 'Inactive';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-IN');
  };

  return (
    <div className="space-y-6">

      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Users</label>
              <ClearableInput
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full min-w-24"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => handleExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => handleExport('pdf')}>
              📄 Export PDF
            </button>
            {/* <button onClick={() => setSearchTerm('')} className="btn-secondary mr-2">Clear</button> */}
            <button className="btn-primary" onClick={handleAdd}>Add User</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {users.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} users</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('id')}>
                      ID {getSortIcon('id')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('username')}>
                      Username {getSortIcon('username')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('email')}>
                      Email {getSortIcon('email')}
                    </th>
                    <th>Phone</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('created_at')}>
                      Created {getSortIcon('created_at')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, index) => (
                    <tr key={user.id}>
                      <td>{index + 1}</td>
                      <td>{user.id}</td>
                      <td className="font-medium text-white">{user.username}</td>
                      <td className="text-slate-300">{user.email}</td>
                      <td className="text-slate-300">{user.phone || '-'}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          user.status === 10
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {getStatusText(user.status)}
                        </span>
                      </td>
                      <td className="text-slate-300 text-sm">{formatDate(user.created_at)}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(user)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                <button onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
                <div className="flex space-x-2">
                  {pagination.page > 3 && <> <button onClick={() => handlePageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
                  {getPageNumbers().map(p => <button key={p} onClick={() => handlePageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
                  {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => handlePageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
                </div>
                <button onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingUser ? 'Edit User' : 'Add User'}</h2>
            <form onSubmit={handleSubmit}>
              {editingUser && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">User ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
                <ClearableInput
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                <ClearableInput
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Phone</label>
                <ClearableInput
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Enter 10-digit phone number"
                  pattern="[0-9]{10}"
                  title="Phone number must be exactly 10 digits"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                  className="select w-full"
                  required
                >
                  <option value="">Select status</option>
                  <option value="10">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
              {!editingUser && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="input w-full"
                    required
                  />
                </div>
              )}
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ExportColumnSelector
        isOpen={showExportColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelExportSelection}
      />
    </div>
  );
}
