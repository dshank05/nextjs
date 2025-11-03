import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ClearableInput } from '../../components/common';

interface Mechanic {
  id: number;
  name: string;
  phone: string;
  city?: string;
  status: string;
  created_at: string;
  updated_at: string;
  index: number;
}

export default function MechanicDetails() {
  const { showSnackbar } = useSnackbar?.() || { showSnackbar: () => { } };
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMechanic, setEditingMechanic] = useState<Mechanic | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    city: '',
    status: 'Active' as 'Active' | 'Inactive'
  });
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState("")

  // Confirmation modal states
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [changingMechanic, setChangingMechanic] = useState<{
    id: number;
    name: string;
    currentStatus: 'Active' | 'Inactive';
    newStatus: 'Active' | 'Inactive';
  } | null>(null);
  const [changingLoading, setChangingLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  // Column definitions for export
  const exportColumns = [
    { key: 'name', label: 'Name', enabled: true },
    { key: 'phone', label: 'Phone', enabled: true },
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
        title: 'Mechanics Report',
        fileName: `Mechanics_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, mechanics, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = mechanics.map(mechanic => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'name':
            row.Name = mechanic.name;
            break;
          case 'phone':
            row.Phone = mechanic.phone;
            break;
          case 'city':
            row.City = mechanic.city || '';
            break;
          case 'status':
            row.Status = mechanic.status;
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Mechanics Report',
      fileName: `Mechanics_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };


  useEffect(() => {
    fetchMechanics();
  }, [sortBy, sortOrder, pagination.page, pagination.limit, debouncedSearchTerm]);

  const fetchMechanics = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/mechanics?includeInactive=true&sortBy=${sortBy}&sortOrder=${sortOrder}&page=${pagination.page}&limit=${pagination.limit}&search=${encodeURIComponent(debouncedSearchTerm)}`);
      if (response.ok) {
        const data = await response.json();
        const mechanicsWithIndex = data.mechanics.map((mechanic: Mechanic, index: number) => ({
          ...mechanic,
          index: (pagination.page - 1) * pagination.limit + index + 1
        }));
        setMechanics(mechanicsWithIndex);
        setPagination(prev => ({ ...prev, ...data.pagination }));
      } else {
        showSnackbar('error', 'Failed to load mechanics');
      }
    } catch (error) {
      console.error('Error fetching mechanics:', error);
      showSnackbar('error', 'Network error while loading mechanics');
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
    setPagination(prev => ({ ...prev, page: 1 }));
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
    setEditingMechanic(null);
    setFormData({
      name: '',
      phone: '',
      city: '',
      status: 'Active'
    });
    setShowModal(true);
  };

  const handleEdit = (mechanic: Mechanic) => {
    setEditingMechanic(mechanic);
    setFormData({
      name: mechanic.name,
      phone: mechanic.phone,
      city: mechanic.city || '',
      status: mechanic.status as 'Active' | 'Inactive'
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
      const url = editingMechanic ? `/api/mechanics/${editingMechanic.id}` : '/api/mechanics';
      const method = editingMechanic ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setShowModal(false);
        setShowSaveModal(false);
        fetchMechanics();
        showSnackbar('success', `Mechanic ${editingMechanic ? 'updated' : 'created'} successfully`);
      } else {
        const errorData = await response.json();
        showSnackbar('error', errorData.message || 'Failed to save mechanic');
        setShowSaveModal(false);
      }
    } catch (error) {
      console.error('Error saving mechanic:', error);
      showSnackbar('error', 'Network error while saving mechanic');
      setShowSaveModal(false);
    } finally {
      setSaving(false);
    }
  };

  const cancelSave = () => {
    setShowSaveModal(false);
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleStatusChange = (mechanicId: number, mechanicName: string, currentStatus: 'Active' | 'Inactive') => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    const actionText = newStatus === 'Active' ? 'activate' : 'deactivate';

    setChangingMechanic({
      id: mechanicId,
      name: mechanicName,
      currentStatus,
      newStatus
    });
    setShowStatusChangeModal(true);
  };

  const confirmStatusChange = async () => {
    if (!changingMechanic) return;

    setChangingLoading(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const statusValue = changingMechanic.newStatus;
      const response = await fetch(`/api/mechanics/${changingMechanic.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusValue }),
        signal: controller.signal
      });

      if (response.ok) {
        fetchMechanics();
        showSnackbar('success', `Mechanic ${changingMechanic.newStatus === 'Active' ? 'activated' : 'deactivated'} successfully`);
      } else {
        const errorData = await response.json();
        showSnackbar('error', errorData.message || `Failed to ${changingMechanic.newStatus === 'Active' ? 'activate' : 'deactivate'} mechanic`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        showSnackbar('info', 'Operation cancelled');
      } else {
        console.error('Error changing mechanic status:', error);
        showSnackbar('error', 'Network error while changing mechanic status');
      }
    } finally {
      setChangingLoading(false);
      setShowStatusChangeModal(false);
      setChangingMechanic(null);
      setAbortController(null);
    }
  };

  const cancelStatusChange = () => {
    // Cancel any pending API call
    if (abortController) {
      abortController.abort();
    }

    setShowStatusChangeModal(false);
    setChangingMechanic(null);
    setChangingLoading(false);
    setAbortController(null);
  };

  return (

    <div>



      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Mechanics</label>
              <ClearableInput
                type="text"
                placeholder="Search mechanics..."
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
            <button className="btn-primary" onClick={handleAdd}>Add Mechanic</button>
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
                Showing {mechanics.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} mechanics
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
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('city')}>
                      City {getSortIcon('city')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mechanics.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-8">
                        No mechanics found. Click "Add Mechanic" to get started.
                      </td>
                    </tr>
                  ) : (
                    mechanics.map((mechanic) => (
                      <tr key={mechanic.id}>
                        <td>{mechanic.index}</td>
                        <td className="font-medium text-white">{mechanic.name}</td>
                        <td className="text-slate-300">{mechanic.phone}</td>
                        <td className="text-slate-300">{mechanic.city || '-'}</td>
                        <td>
                          <span className={`px-2 py-1 rounded-full text-xs ${mechanic.status === 'Active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                            }`}>
                            {mechanic.status}
                          </span>
                        </td>
                        <td className="text-right">
                          <button
                            className="btn-secondary mr-2"
                            onClick={() => handleEdit(mechanic)}
                          >
                            Edit
                          </button>
                          <button
                            className={mechanic.status === 'Active' ? 'btn-danger' : 'btn-primary px-6'}
                            onClick={() => handleStatusChange(mechanic.id, mechanic.name, mechanic.status as 'Active' | 'Inactive')}
                          >
                            {mechanic.status === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {mechanics.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No mechanics found.</div>
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
              {editingMechanic ? 'Edit Mechanic' : 'Add Mechanic'}
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
                  placeholder="Enter mechanic's full name"
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
                  City
                </label>
                <ClearableInput
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  placeholder="Enter city (optional)"
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
        title={`${changingMechanic?.newStatus === 'Active' ? 'Activate' : 'Deactivate'} Mechanic`}
        message={`Are you sure you want to ${changingMechanic?.newStatus === 'Active' ? 'activate' : 'deactivate'} ${changingMechanic?.name}?`}
        confirmText={changingMechanic?.newStatus === 'Active' ? 'Activate' : 'Deactivate'}
        cancelText="Cancel"
        showLoading={changingLoading}
        loadingText={`${changingMechanic?.newStatus === 'Active' ? 'Activating' : 'Deactivating'}...`}
        cancelLoadingText="Canceling..."
        onConfirm={confirmStatusChange}
        onCancel={cancelStatusChange}
      />

      <ConfirmationModal
        isOpen={showSaveModal}
        title={editingMechanic ? "Update Mechanic" : "Add Mechanic"}
        message={editingMechanic ?
          `Are you sure you want to update ${formData.name}'s information?` :
          `Are you sure you want to add ${formData.name} as a new mechanic?`
        }
        confirmText={editingMechanic ? "Update" : "Add"}
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
};
