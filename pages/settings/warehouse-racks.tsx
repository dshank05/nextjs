import { useState, useEffect } from 'react';
import { useUrlState } from '../../hooks/useUrlState';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ClearableInput } from '../../components/common';
import { SearchableSelect } from '../../components/common/SearchableSelect';

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
  // Mirrored in the URL so search and sort survive a refresh and a return
  // from an edit, and so a filtered list can be linked (F-49).
  const [searchTerm, setSearchTerm] = useUrlState<string>('search', '');
  const [showModal, setShowModal] = useState(false);
  const [editingRack, setEditingRack] = useState<WarehouseRack | null>(null);
  const [formData, setFormData] = useState({ id: '', warehouse_id: '', rack_number: '', description: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showToggleConfirmModal, setShowToggleConfirmModal] = useState(false);
  const [toggleConfirmLoading, setToggleConfirmLoading] = useState(false);
  const [selectedRack, setSelectedRack] = useState<WarehouseRack | null>(null);
  const [sortBy, setSortBy] = useUrlState<string>('sortBy', 'rack_number');
  const [sortOrder, setSortOrder] = useUrlState<'asc' | 'desc'>('sortOrder', 'asc');
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
      setPagination(prev => ({ ...prev, page: 1 })); // a result on page 3 of the old order means nothing in the new one (S-13)
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
      // S-38: without dropdown=true this took the default first page, so racks
      // in the 51st warehouse onward could never be listed - the loop below only
      // iterates what this returns. F-58's fix, finally applied here.
      const response = await fetch('/api/warehouses?dropdown=true');
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
            // The debounced term, not the raw one (S-12).
            search: debouncedSearchTerm.trim()
          });

          const response = await fetch(`/api/warehouses/${warehouse.id}/racks?${params}`);
          // Note (S-37/S-77): one request per warehouse, because the racks API
          // has no cross-warehouse list and no sort support. Fixing that
          // properly means a /api/racks endpoint; recorded, not done here.
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

      // S-62: on edit this addressed `pendingData.warehouse_id` - the warehouse
      // the user is moving the rack TO. But the handler scopes its lookup to the
      // warehouse in the URL, which must be the one that currently OWNS the rack
      // (that scoping is F-32's fix, and it is correct). Addressing the
      // destination meant a move could never find the rack it was moving. The
      // URL is the source; the body carries the destination.
      //
      // S-61: the two branches this replaces assigned the same value, after an
      // initial `'/api/warehouse-racks'` that is not a route in this app; and
      // `requestBody` was a ternary whose branches were equivalent.
      const url = editingRack
        ? `/api/warehouses/${editingRack.warehouse_id}/racks`
        : `/api/warehouses/${pendingData.warehouse_id}/racks`;

      const requestBody = pendingData;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
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
        // rack_number is NOT required - the handler treats every field as
        // optional and only validates rack_number when it is present. The
        // comment claiming otherwise was wrong, and resending an unrelated field
        // to change a status is how a transition gets corrupted (S-63).
        body: JSON.stringify({
          id: selectedRack.id,
          status: newStatus
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
                    {/* S-65: this sorted by warehouse_id while displaying the
                        name, so the order had nothing to do with the column. */}
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('warehouse_name')}>
                      Warehouse {getSortIcon('warehouse_name')}
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
                    racks.map((rack: any) => {
                      // S-64: the warehouse name is attached to every row by
                      // fetchRacks. This used to ignore it and re-derive the name
                      // from the `warehouses` list instead - while the EXPORT used
                      // the attached field. When that list truncates at 50 (S-38)
                      // the two disagreed: the table said "Unknown Warehouse" and
                      // the export printed the real name, for the same row.
                      const warehouseLabel = rack.warehouse_name
                        ? `${rack.warehouse_name}${rack.warehouse_location ? ' - ' + rack.warehouse_location : ''}`
                        : 'Unknown Warehouse';
                      return (
                        <tr key={rack.id}>
                          <td>{rack.index}</td>
                          <td>{rack.id}</td>
                          <td className="font-medium text-white">
                            {warehouseLabel}
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingRack ? 'Edit Warehouse Rack' : 'Add Warehouse Rack'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Warehouse *</label>
                <SearchableSelect
                  options={[
                    { id: '', name: 'Select Warehouse' },
                    ...warehouses.map((warehouse) => ({
                      id: warehouse.id.toString(),
                      name: `${warehouse.name} - ${warehouse.location}`
                    }))
                  ]}
                  selectedValue={formData.warehouse_id || null}
                  onSelectionChange={(value) => handleWarehouseChange(value || '')}
                  placeholder="Select Warehouse"
                />
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
