import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ClearableInput } from '../../components/common';

interface WarehouseRack {
  id: number;
  warehouse_id: number;
  rack_number: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  index?: number; // Added for display purposes
}

interface WarehouseRackResponse {
  racks: WarehouseRack[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

interface Warehouse {
  id: number;
  name: string;
  location: string;
  status: string;
}

export default function WarehouseRacks() {
  const { showSnackbar } = useSnackbar();
  const [racks, setRacks] = useState<WarehouseRack[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRack, setEditingRack] = useState<WarehouseRack | null>(null);
  const [formData, setFormData] = useState({ id: '', warehouse_id: '', rack_number: '', description: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showToggleConfirmModal, setShowToggleConfirmModal] = useState(false);
  const [toggleConfirmLoading, setToggleConfirmLoading] = useState(false);
  const [selectedRack, setSelectedRack] = useState<WarehouseRack | null>(null);
  const [sortBy, setSortBy] = useState('rack_number');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isFetching, setIsFetching] = useState(false);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);



  useEffect(() => {
    fetchWarehouses();
  }, []);

  useEffect(() => {
    if (warehouses.length > 0 && !isFetching) {
      fetchRacks();
    } else if (warehouses.length === 0) {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, debouncedSearchTerm, warehouses, sortBy, sortOrder]);

  useEffect(() => {
    // Reset to page 1 when search term changes
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [debouncedSearchTerm]);

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

  const fetchWarehouses = async () => {
    try {
      const response = await fetch('/api/warehouses');
      if (response.ok) {
        const data = await response.json();
        setWarehouses(data.warehouses || []);
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    }
  };

  const fetchRacks = async () => {
    if (isFetching) return; // Prevent multiple concurrent API calls

    setIsFetching(true);
    setLoading(true);

    try {
      const allRacks: WarehouseRack[] = [];
      let totalRacks = 0;

      // Fetch racks for each warehouse
      for (const warehouse of warehouses) {
        try {
          const params = new URLSearchParams({
            page: '1',
            limit: '1000', // Get all racks for this warehouse
            search: searchTerm
          });

          const response = await fetch(`/api/warehouses/${warehouse.id}/racks?${params}`);
          if (response.ok) {
            const data = await response.json();
            const warehouseRacks = data.racks.map((rack: WarehouseRack) => ({
              ...rack,
              warehouse_name: warehouse.name,
              warehouse_location: warehouse.location
            }));
            allRacks.push(...warehouseRacks);
            totalRacks += data.pagination.total;
          }
        } catch (error) {
          console.error(`Error fetching racks for warehouse ${warehouse.id}:`, error);
        }
      }

      // Apply client-side sorting
      allRacks.sort((a: any, b: any) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];

        if (sortBy === 'id' || sortBy === 'warehouse_id') {
          aVal = Number(aVal);
          bVal = Number(bVal);
        } else {
          aVal = String(aVal || '').toLowerCase();
          bVal = String(bVal || '').toLowerCase();
        }

        if (sortOrder === 'asc') {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });

      // Apply client-side pagination
      const startIndex = (pagination.page - 1) * pagination.limit;
      const endIndex = startIndex + pagination.limit;
      const paginatedRacks = allRacks.slice(startIndex, endIndex);

      // Add index to each rack for display
      const racksWithIndex = paginatedRacks.map((rack: any, index: number) => ({
        ...rack,
        index: startIndex + index + 1
      }));

      setRacks(racksWithIndex);
      setPagination(prev => ({
        ...prev,
        total: totalRacks,
        totalPages: Math.ceil(totalRacks / pagination.limit)
      }));
    } catch (error) {
      console.error('Error fetching warehouse racks:', error);
    } finally {
      setLoading(false);
      setIsFetching(false); // Allow new API calls
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

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleAdd = () => {
    setEditingRack(null);
    setFormData({ id: '', warehouse_id: '', rack_number: '', description: '' });
    setShowModal(true);
  };

  const handleEdit = (rack: WarehouseRack) => {
    setEditingRack(rack);
    setFormData({
      id: rack.id.toString(),
      warehouse_id: rack.warehouse_id.toString(),
      rack_number: rack.rack_number,
      description: rack.description || ''
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
      const method = editingRack ? 'PUT' : 'POST';
      let url = '/api/warehouse-racks';

      if (editingRack) {
        url = `/api/warehouses/${pendingData.warehouse_id}/racks`;
      } else {
        url = `/api/warehouses/${pendingData.warehouse_id}/racks`;
      }

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
        setFormData({ id: '', warehouse_id: '', rack_number: '', description: '' });
        setPendingData(null);
        fetchRacks(); // Refresh the list
        showSnackbar('success', `Warehouse rack ${editingRack ? 'updated' : 'created'} successfully!`);
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error saving warehouse rack:', error);
        showSnackbar('error', error.message || 'Failed to save warehouse rack');
        setShowConfirmModal(false); // Close confirmation modal, keep form modal open
      }
    } catch (error) {
      console.error('Error saving warehouse rack:', error);
      showSnackbar('error', `Failed to ${editingRack ? 'update' : 'create'} warehouse rack: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowConfirmModal(false); // Close confirmation modal on network error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmModal(false);
    setPendingData(null);
  };

  const handleWarehouseChange = (warehouseId: string) => {
    setFormData(prev => ({ ...prev, warehouse_id: warehouseId }));
  };

  const handleToggleActive = (rack: WarehouseRack) => {
    setSelectedRack(rack);
    setShowToggleConfirmModal(true);
  };

  const handleConfirmToggle = async () => {
    if (!selectedRack) return;

    setToggleConfirmLoading(true);

    try {
      const newStatus = selectedRack.status === 'Active' ? 'Inactive' : 'Active';
      const response = await fetch(`/api/warehouses/${selectedRack.warehouse_id}/racks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: selectedRack.id,
          status: newStatus,
          rack_number: selectedRack.rack_number // Include current rack_number as required by API
        }),
      });

      if (response.ok) {
        setShowToggleConfirmModal(false);
        setSelectedRack(null);
        fetchRacks();
        showSnackbar('success', `Warehouse rack ${selectedRack.status === 'Active' ? 'deactivated' : 'activated'} successfully!`);
      } else {
        const errorData = await response.json();
        console.error('Error toggling rack status:', errorData);
        showSnackbar('error', errorData.message || 'Failed to toggle rack status');
      }
    } catch (error) {
      console.error('Error toggling rack status:', error);
      showSnackbar('error', `Failed to toggle rack status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setToggleConfirmLoading(false);
    }
  };

  const handleCancelToggle = () => {
    if (!toggleConfirmLoading) {
      setShowToggleConfirmModal(false);
      setSelectedRack(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Warehouse Racks</label>
              <ClearableInput
                type="text"
                placeholder="Search racks..."
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
            <ExportMenu
              data={racks}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'warehouse_name', label: 'Warehouse', enabled: true },
                { key: 'rack_number', label: 'Rack Number', enabled: true },
                { key: 'description', label: 'Description', enabled: true },
                { key: 'status', label: 'Status', enabled: true },
              ]}
              config={{
                title: 'Warehouse Racks Report',
                fileName: 'Warehouse_Racks'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add Warehouse Rack</button>
          </div>
        </div>
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {racks.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} warehouse racks</div>
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
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('warehouse_id')}>
                      Warehouse {getSortIcon('warehouse_id')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('rack_number')}>
                      Rack Number {getSortIcon('rack_number')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('description')}>
                      Description {getSortIcon('description')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {racks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12">
                        <div className="text-slate-400">
                          <div className="text-4xl mb-4">📦</div>
                          <div className="text-lg font-medium mb-2">No warehouse racks found</div>
                          <div className="text-sm">Create your first warehouse rack to get started with inventory tracking.</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    racks.map((rack) => {
                      const warehouse = warehouses.find(w => w.id === rack.warehouse_id);
                      return (
                        <tr key={rack.id}>
                          <td>{rack.index}</td>
                          <td>{rack.id}</td>
                          <td className="font-medium text-white">
                            {warehouse ? `${warehouse.name} - ${warehouse.location}` : 'Unknown Warehouse'}
                          </td>
                          <td className="font-mono font-medium text-blue-300">{rack.rack_number}</td>
                          <td className="text-slate-300">{rack.description || '-'}</td>
                          <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          rack.status === 'Active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {rack.status}
                        </span>
                      </td>
                          <td className="text-right">
                            <button className="btn-secondary mr-2" onClick={() => handleEdit(rack)}>Edit</button>
                            <button
                              className={rack.status === 'Active' ? 'btn-danger' : 'btn-primary px-6'}
                              onClick={() => handleToggleActive(rack)}
                              title={rack.status === 'Active' ? 'Deactivate Rack' : 'Activate Rack'}
                            >
                              {rack.status === 'Active' ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingRack ? 'Edit Warehouse Rack' : 'Add Warehouse Rack'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Warehouse *</label>
                <select
                  value={formData.warehouse_id}
                  onChange={(e) => handleWarehouseChange(e.target.value)}
                  className="select w-full"
                  style={editingRack ? { pointerEvents: 'none', opacity: 0.6 } : {}}
                  required
                >
                  <option value="">Select Warehouse</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} - {warehouse.location}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Rack Number *</label>
                <ClearableInput
                  type="text"
                  value={formData.rack_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, rack_number: e.target.value }))}
                  placeholder="Enter rack number"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <ClearableInput
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description"
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
        title={`${editingRack ? 'Update' : 'Create'} Warehouse Rack?`}
        message={`Are you sure you want to ${editingRack ? 'update' : 'create'} this warehouse rack?`}
        confirmText={editingRack ? 'Update Rack' : 'Create Rack'}
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText={editingRack ? 'Updating Rack...' : 'Creating Rack...'}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

      {/* Toggle Status Confirmation Modal */}
      <ConfirmationModal
        isOpen={showToggleConfirmModal}
        title={selectedRack ? `${selectedRack.status === 'Active' ? 'Deactivate' : 'Activate'} Warehouse Rack?` : ''}
        message={selectedRack ? `Are you sure you want to ${selectedRack.status === 'Active' ? 'deactivate' : 'activate'} rack "${selectedRack.rack_number}"?` : ''}
        confirmText={selectedRack?.status === 'Active' ? 'Deactivate Rack' : 'Activate Rack'}
        cancelText="Cancel"
        showLoading={toggleConfirmLoading}
        onConfirm={handleConfirmToggle}
        onCancel={handleCancelToggle}
      />


    </div>
  );
}
