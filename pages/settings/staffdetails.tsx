import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ClearableInput } from '../../components/common';

interface Staff {
  id: number;
  name: string;
  email?: string;
  phone: string;
  status: string;
  created_at: string;
  updated_at: string;
  index: number;
}

export default function StaffDetails() {
  const { showSnackbar } = useSnackbar?.() || { showSnackbar: () => {} };
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    // status: 'Active' as 'Active' | 'Inactive'
  });
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState('')
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Confirmation modal states
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [changingStaff, setChangingStaff] = useState<{
    id: number;
    name: string;
    currentStatus: 'Active' | 'Inactive';
    newStatus: 'Active' | 'Inactive';
  } | null>(null);
  const [changingLoading, setChangingLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Column definitions for export
  const exportColumns = [
    { key: 'name', label: 'Name', enabled: true },
    { key: 'phone', label: 'Phone', enabled: true },
    { key: 'email', label: 'Email', enabled: true },
    { key: 'status', label: 'Status', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Staff Members Report',
        fileName: `Staff_Members_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, staff, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = staff.map(member => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'name':
            row.Name = member.name;
            break;
          case 'phone':
            row.Phone = member.phone;
            break;
          case 'email':
            row.Email = member.email || '';
            break;
          case 'status':
            row.Status = member.status;
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Staff Members Report',
      fileName: `Staff_Members_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm, sortBy, sortOrder]);

  useEffect(() => {
    fetchStaff();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm.trim(),
        sortBy: sortBy,
        sortOrder: sortOrder,
      });
      const response = await fetch(`/api/staff?includeInactive=true&${params}`);
      if (response.ok) {
        const data = await response.json();
        const staffWithIndex = data.staff.map((member: Staff, index: number) => ({
          ...member,
          index: (pagination.page - 1) * pagination.limit + index + 1
        }));
        setStaff(staffWithIndex);
        setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load staff members');
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
      showSnackbar('error', 'Network error while loading staff');
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
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page on sorting
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const handleAdd = () => {
    setEditingStaff(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      // status: 'Active'
    });
    setShowModal(true);
  };

  const handleEdit = (staffMember: Staff) => {
    setEditingStaff(staffMember);
    setFormData({
      name: staffMember.name,
      email: staffMember.email || '',
      phone: staffMember.phone,
      // status: staffMember.status as 'Active' | 'Inactive'
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.phone.trim()) {
      showSnackbar('warning', 'Name and phone are required');
      return;
    }

    // Show confirmation modal before saving
    setShowSaveModal(true);
  };

  const confirmSave = async () => {
    setSaving(true);

    try {
      const url = editingStaff ? `/api/staff/${editingStaff.id}` : '/api/staff';
      const method = editingStaff ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setShowModal(false);
        setShowSaveModal(false);
        fetchStaff();
        showSnackbar('success', `Staff member ${editingStaff ? 'updated' : 'created'} successfully`);
      } else {
        const errorData = await response.json();
        showSnackbar('error', errorData.message || 'Failed to save staff member');
        setShowSaveModal(false);
      }
    } catch (error) {
      console.error('Error saving staff:', error);
      showSnackbar('error', 'Network error while saving staff member');
      setShowSaveModal(false);
    } finally {
      setSaving(false);
    }
  };

  const cancelSave = () => {
    setShowSaveModal(false);
  };

  const handleStatusChange = (staffId: number, staffName: string, currentStatus: 'Active' | 'Inactive') => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    const actionText = newStatus === 'Active' ? 'activate' : 'deactivate';

    setChangingStaff({
      id: staffId,
      name: staffName,
      currentStatus,
      newStatus
    });
    setShowStatusChangeModal(true);
  };

  const confirmStatusChange = async () => {
    if (!changingStaff) return;

    setChangingLoading(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const statusValue = changingStaff.newStatus;
      const response = await fetch(`/api/staff/${changingStaff.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusValue }),
        signal: controller.signal
      });

      if (response.ok) {
        fetchStaff();
        showSnackbar('success', `Staff member ${changingStaff.newStatus === 'Active' ? 'activated' : 'deactivated'} successfully`);
      } else {
        const errorData = await response.json();
        showSnackbar('error', errorData.message || `Failed to ${changingStaff.newStatus === 'Active' ? 'activate' : 'deactivate'} staff member`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        showSnackbar('info', 'Operation cancelled');
      } else {
        console.error('Error changing staff status:', error);
        showSnackbar('error', 'Network error while changing staff status');
      }
    } finally {
      setChangingLoading(false);
      setShowStatusChangeModal(false);
      setChangingStaff(null);
      setAbortController(null);
    }
  };

  const cancelStatusChange = () => {
    // Cancel any pending API call
    if (abortController) {
      abortController.abort();
    }

    setShowStatusChangeModal(false);
    setChangingStaff(null);
    setChangingLoading(false);
    setAbortController(null);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Staff</label>
              <ClearableInput
                type="text"
                placeholder="Search staff..."
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
            <button className="btn-primary" onClick={handleAdd}>Add Staff Member</button>
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>
                Showing {staff.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} staff members
              </div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('name')}>
                      Name {getSortIcon('name')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('phone')}>
                      Phone {getSortIcon('phone')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('email')}>
                      Email {getSortIcon('email')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-8">
                        No staff members found. Click "Add Staff Member" to get started.
                      </td>
                    </tr>
                  ) : (
                    staff.map((member) => (
                      <tr key={member.id}>
                        <td>{member.index}</td>
                        <td className="font-medium text-white">{member.name}</td>
                        <td className="text-slate-300">{member.phone}</td>
                        <td className="text-slate-300">{member.email || '-'}</td>
                        <td>
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            member.status === 'Active'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {member.status}
                          </span>
                        </td>
                        <td className="text-right">
                          <button
                            className="btn-secondary mr-2"
                            onClick={() => handleEdit(member)}
                          >
                            Edit
                          </button>
                          <button
                            className={member.status === 'Active' ? 'btn-danger' : 'btn-primary px-6'}
                            onClick={() => handleStatusChange(member.id, member.name, member.status as 'Active' | 'Inactive')}
                          >
                            {member.status === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {staff.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No staff members found.</div>
              )}
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
                <span className="text-sm text-slate-400 px-4">Page {pagination.page} of {pagination.totalPages}</span>
                <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))} disabled={!pagination.hasMore} className="btn-secondary disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-6 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-4 border-b border-slate-600 pb-4">
              {editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Full Name *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="Enter staff member's full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Phone Number *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  required
                  maxLength={10}
                  placeholder="Enter phone number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                </label>
                <ClearableInput
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter email address (optional)"
                />
              </div>

              {/* <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as 'Active' | 'Inactive' }))}
                  className="select w-full"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div> */}

              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={showStatusChangeModal}
        title={`${changingStaff?.newStatus === 'Active' ? 'Activate' : 'Deactivate'} Staff Member`}
        message={`Are you sure you want to ${changingStaff?.newStatus === 'Active' ? 'activate' : 'deactivate'} ${changingStaff?.name}?`}
        confirmText={changingStaff?.newStatus === 'Active' ? 'Activate' : 'Deactivate'}
        cancelText="Cancel"
        showLoading={changingLoading}
        loadingText={`${changingStaff?.newStatus === 'Active' ? 'Activating' : 'Deactivating'}...`}
        cancelLoadingText="Canceling..."
        onConfirm={confirmStatusChange}
        onCancel={cancelStatusChange}
      />

      <ConfirmationModal
        isOpen={showSaveModal}
        title={editingStaff ? "Update Staff Member" : "Add Staff Member"}
        message={editingStaff ?
          `Are you sure you want to update ${formData.name}'s information?` :
          `Are you sure you want to add ${formData.name} as a new staff member?`
        }
        confirmText={editingStaff ? "Update" : "Add"}
        cancelText="Cancel"
        showLoading={saving}
        loadingText="Saving..."
        onConfirm={confirmSave}
        onCancel={cancelSave}
      />

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />
    </div>
  );
}
