import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { isTenDigitPhone } from '../../lib/validators';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useListQuery } from '../../hooks/useListQuery';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ClearableInput } from '../../components/common';

interface Mechanic {
  id: number;
  name: string;
  phone: string;
  city?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function MechanicDetails() {
  // S-17: see staffdetails - a hook called conditionally, silently stubbed.
  const { showSnackbar } = useSnackbar();
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMechanic, setEditingMechanic] = useState<Mechanic | null>(null);
  // No `status` here. The status control was commented out of this form (as it
  // was in staff), but the field stayed in formData and was transmitted on every
  // save even though nothing set it (S-43). Status is a transition now.
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    city: ''
  });
  const [saving, setSaving] = useState(false);
  // Search, sort, page and limit: the shared list hook (§7b). See staffdetails.
  const list = useListQuery({ defaultSort: 'name', fixedParams: { includeInactive: 'true' } });
  const { pagination } = list;

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
  const query = list.params.toString();
  useEffect(() => {
    fetchMechanics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };

  const fetchMechanics = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      // S-42/S-44: the query string is built by the hook, fully encoded.
      const response = await fetch(`/api/mechanics?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data = await response.json();
        if (!isCurrent()) return;
        setMechanics(data.mechanics);
        // S-45: replace, never merge.
        list.setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load mechanics');
      }
    } catch (error) {
      console.error('Error fetching mechanics:', error);
      showSnackbar('error', 'Network error while loading mechanics');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingMechanic(null);
    setFormData({
      name: '',
      phone: '',
      city: ''
    });
    setShowModal(true);
  };

  const handleEdit = (mechanic: Mechanic) => {
    setEditingMechanic(mechanic);
    setFormData({
      name: mechanic.name,
      phone: mechanic.phone,
      city: mechanic.city || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.phone.trim()) {
      showSnackbar('warning', 'Name and phone are required');
      return;
    }

    // Same rules the API applies, so the form cannot accept a value the server
    // will reject (F-59).
    if (!isTenDigitPhone(formData.phone)) {
      showSnackbar('error', 'Phone number must be exactly 10 digits');
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
      const response = await fetch(`/api/mechanics/${changingMechanic.id}/status`, {
        method: 'PATCH',
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
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={mechanics}
              // S-89: export every matching row, not just the page on screen.
              fetchAll={async () => {
                const r = await fetch('/api/mechanics?dropdown=true&includeInactive=true');
                if (!r.ok) throw new Error('Could not load the full list');
                const d = await r.json();
                return d.data || d.mechanics || [];
              }}
              columns={[
                { key: 'name', label: 'Name', enabled: true },
                { key: 'phone', label: 'Phone', enabled: true },
                { key: 'city', label: 'City', enabled: true },
                { key: 'status', label: 'Status', enabled: true },
              ]}
              config={{
                title: 'Mechanics Report',
                fileName: 'Mechanics'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add Mechanic</button>
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={mechanics.length} noun="mechanics" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('name')}>
                      Name <SortIcon field="name" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('phone')}>
                      Phone <SortIcon field="phone" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('city')}>
                      City <SortIcon field="city" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('status')}>
                      Status <SortIcon field="status" {...sortProps} />
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
                    mechanics.map((mechanic, i) => (
                      <tr key={mechanic.id}>
                        <td>{list.serialNumber(i)}</td>
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
            </div>

            {/* S-56: this page used a bare Previous / Next control while the
                other seven used a numbered one - and the two families disagreed
                about when a list ends, this one on `!hasMore` and the others on
                `page === totalPages`. One component, one rule. */}
            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
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
                  // S-67: digits only, as they are typed - the same behaviour
                  // businessdetails has always had. staff and mechanics used to
                  // accept any characters and only complain on submit, so three
                  // pages collecting one kind of value behaved three ways.
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))}
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

    </div>
  );
};
