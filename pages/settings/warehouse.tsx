import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface Warehouse {
  id: number;
  name: string;
  location: string;
  status: string;
  index: number;
}

interface WarehouseResponse {
  warehouses: Warehouse[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Warehouse() {
  const { showSnackbar } = useSnackbar();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState({ id: 0, name: '', location: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showToggleConfirmModal, setShowToggleConfirmModal] = useState(false);
  const [toggleConfirmLoading, setToggleConfirmLoading] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchWarehouses();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        includeInactive: 'true',
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/warehouses?${params}`);
      if (response.ok) {
        const data = await response.json();
        // Add index to each warehouse for display
        const warehousesWithIndex = data.warehouses.map((warehouse: Warehouse, index: number) => ({
          ...warehouse,
          index: (pagination.page - 1) * pagination.limit + index + 1
        }));

        setWarehouses(warehousesWithIndex);
        setPagination(data.pagination);
      } else {
        console.error('Failed to fetch warehouses');
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error);
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
      return <ArrowUpDown className="inline w-4 h-4 ml-1" />;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleAdd = () => {
    setEditingWarehouse(null);
    setFormData({ id: 0, name: '', location: '' });
    setShowModal(true);
  };

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    setFormData({
      id: warehouse.id,
      name: warehouse.name,
      location: warehouse.location
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Show confirmation modal before saving
    setPendingData(formData);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingData) return;

    setIsSaving(true);  // Start loading state while modal is still open

    try {
      const method = editingWarehouse ? 'PUT' : 'POST';
      const url = '/api/warehouses';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pendingData),
      });

      if (response.ok) {
        // Success - close modals and refresh
        setShowConfirmModal(false);
        setShowModal(false);
        setFormData({ id: 0, name: '', location: '' });
        setPendingData(null);
        fetchWarehouses(); // Refresh the list
        showSnackbar('success', `Warehouse ${editingWarehouse ? 'updated' : 'created'} successfully!`);
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error saving warehouse:', error);
        showSnackbar('error', error.message || 'Failed to save warehouse');
        setShowConfirmModal(false); // Close confirmation modal, keep form modal open
      }
    } catch (error) {
      console.error('Error saving warehouse:', error);
      showSnackbar('error', `Failed to ${editingWarehouse ? 'update' : 'create'} warehouse: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowConfirmModal(false); // Close confirmation modal on network error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmModal(false);
    setPendingData(null);
  };

  const handleToggleActive = (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    setShowToggleConfirmModal(true);
  };

  const handleConfirmToggle = async () => {
    if (!selectedWarehouse) return;

    setToggleConfirmLoading(true);

    try {
      const newStatus = selectedWarehouse.status === 'Active' ? 'Inactive' : 'Active';
      const response = await fetch(`/api/warehouses?id=${selectedWarehouse.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setShowToggleConfirmModal(false);
        setSelectedWarehouse(null);
        fetchWarehouses();
        showSnackbar('success', `Warehouse ${selectedWarehouse.status === 'Active' ? 'deactivated' : 'activated'} successfully!`);
      } else {
        const errorData = await response.json();
        console.error('Error toggling warehouse status:', errorData);
        showSnackbar('error', errorData.message || 'Failed to toggle warehouse status');
      }
    } catch (error) {
      console.error('Error toggling warehouse status:', error);
      showSnackbar('error', `Failed to toggle warehouse status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setToggleConfirmLoading(false);
    }
  };

  const handleCancelToggle = () => {
    if (!toggleConfirmLoading) {
      setShowToggleConfirmModal(false);
      setSelectedWarehouse(null);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Warehouse</button>
      </div>

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Warehouses</label>
              <input
                type="text"
                placeholder="Search warehouses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input w-full"
              />
            </div>
            <div className="w-40">
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="w-24">
            <button onClick={() => setSearchTerm('')} className="btn-secondary w-full">Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {warehouses.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} warehouses</div>
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
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('name')}>
                      Name {getSortIcon('name')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('location')}>
                      Location {getSortIcon('location')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((warehouse) => (
                    <tr key={warehouse.id}>
                      <td>{warehouse.index}</td>
                      <td>{warehouse.id}</td>
                      <td className="font-medium text-white">{warehouse.name}</td>
                      <td className="text-white">{warehouse.location}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          warehouse.status === 'Active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {warehouse.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(warehouse)}>Edit</button>
                        <button
                          className={warehouse.status === 'Active' ? 'btn-danger' : 'btn-primary px-6'}
                          onClick={() => handleToggleActive(warehouse)}
                          title={warehouse.status === 'Active' ? 'Deactivate Warehouse' : 'Activate Warehouse'}
                        >
                          {warehouse.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingWarehouse ? 'Edit Warehouse' : 'Add Warehouse'}</h2>
            <form onSubmit={handleSubmit}>
              {editingWarehouse && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Warehouse ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Warehouse Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={`${editingWarehouse ? 'Update' : 'Create'} Warehouse?`}
        message={`Are you sure you want to ${editingWarehouse ? 'update' : 'create'} this warehouse?`}
        confirmText={editingWarehouse ? 'Update Warehouse' : 'Create Warehouse'}
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText={editingWarehouse ? 'Updating Warehouse...' : 'Creating Warehouse...'}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

      {/* Toggle Status Confirmation Modal */}
      <ConfirmationModal
        isOpen={showToggleConfirmModal}
        title={selectedWarehouse ? `${selectedWarehouse.status === 'Active' ? 'Deactivate' : 'Activate'} Warehouse?` : ''}
        message={selectedWarehouse ? `Are you sure you want to ${selectedWarehouse.status === 'Active' ? 'deactivate' : 'activate'} "${selectedWarehouse.name}"?` : ''}
        confirmText={selectedWarehouse?.status === 'Active' ? 'Deactivate Warehouse' : 'Activate Warehouse'}
        cancelText="Cancel"
        showLoading={toggleConfirmLoading}
        onConfirm={handleConfirmToggle}
        onCancel={handleCancelToggle}
      />
    </div>
  );
}
