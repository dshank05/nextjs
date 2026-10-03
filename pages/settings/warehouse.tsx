import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ExportMenu } from '../../components/common/ExportMenu';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ClearableInput } from '../../components/common';

interface Warehouse {
  id: number;
  name: string;
  location: string;
  status: string;
}

interface WarehouseResponse {
  warehouses: Warehouse[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Warehouse() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'name', fixedParams: { includeInactive: 'true' } });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState({ id: 0, name: '', location: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showToggleConfirmModal, setShowToggleConfirmModal] = useState(false);
  const [toggleConfirmLoading, setToggleConfirmLoading] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);

  const query = list.params.toString();
  useEffect(() => {
    fetchWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchWarehouses = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/warehouses?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data = await response.json();
        if (!isCurrent()) return;
        setWarehouses(data.warehouses);
        list.setPagination(data.pagination);
      } else {
        // A failed load used to leave the table as it was, with no word why.
        const body = await response.json().catch(() => ({}));
        if (isCurrent()) showSnackbar('error', body.message || 'Could not load the warehouses');
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error);
      if (isCurrent()) showSnackbar('error', 'Could not load the warehouses');
    } finally {
      if (isCurrent()) setLoading(false);
    }
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
      // The shared status route. This used to PUT to the collection with the id
      // in the QUERY while the edit above PUTs it in the BODY - one endpoint,
      // two contracts, and the body one discarded status entirely (S-19, S-20).
      const response = await fetch(`/api/warehouses/${selectedWarehouse.id}/status`, {
        method: 'PATCH',
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
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Warehouses</label>
              <ClearableInput
                type="text"
                placeholder="Search warehouses..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={warehouses}
              // S-89: export every matching row, not just the page on screen.
              fetchAll={async () => {
                const r = await fetch('/api/warehouses?dropdown=true&includeInactive=true');
                if (!r.ok) throw new Error('Could not load the full list');
                const d = await r.json();
                return d.data || d.warehouses || [];
              }}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'name', label: 'Name', enabled: true },
                { key: 'location', label: 'Location', enabled: true },
                { key: 'status', label: 'Status', enabled: true },
              ]}
              config={{
                title: 'Warehouses Report',
                fileName: 'Warehouses'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add Warehouse</button>
          </div>
        </div>
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={warehouses.length} noun="warehouses" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('name')}>
                      Name <SortIcon field="name" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('location')}>
                      Location <SortIcon field="location" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('status')}>
                      Status <SortIcon field="status" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((warehouse, i) => (
                    <tr key={warehouse.id}>
                      <td>{list.serialNumber(i)}</td>
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

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
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
                <ClearableInput
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Location</label>
                <ClearableInput
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
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
