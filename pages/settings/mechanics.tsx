import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';

interface Mechanic {
  id: number;
  name: string;
  phone: string;
  status: string;
  created_at: string;
  updated_at: string;
  index: number;
}

export default function MechanicDetails() {
  const { showSnackbar } = useSnackbar?.() || { showSnackbar: () => {} };
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMechanic, setEditingMechanic] = useState<Mechanic | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    status: 'Active' as 'Active' | 'Inactive'
  });
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    fetchMechanics();
  }, []);

  const fetchMechanics = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/mechanics?includeInactive=true');
      if (response.ok) {
        const data = await response.json();
        const mechanicsWithIndex = data.mechanics.map((mechanic: Mechanic, index: number) => ({
          ...mechanic,
          index: index + 1
        }));
        setMechanics(mechanicsWithIndex);
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

  const handleAdd = () => {
    setEditingMechanic(null);
    setFormData({
      name: '',
      phone: '',
      status: 'Active'
    });
    setShowModal(true);
  };

  const handleEdit = (mechanic: Mechanic) => {
    setEditingMechanic(mechanic);
    setFormData({
      name: mechanic.name,
      phone: mechanic.phone,
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
    <div className="space-y-6">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Mechanic</button>
      </div>

      <div className="card">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>S.N</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mechanics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-8">
                      No mechanics found. Click "Add Mechanic" to get started.
                    </td>
                  </tr>
                ) : (
                  mechanics.map((mechanic) => (
                    <tr key={mechanic.id}>
                      <td>{mechanic.index}</td>
                      <td className="font-medium text-white">{mechanic.name}</td>
                      <td className="text-slate-300">{mechanic.phone}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          mechanic.status === 'Active'
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
                          className={mechanic.status === 'Active' ? 'btn-danger' : 'btn-primary'}
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
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="Enter mechanic's full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Phone Number *
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="input w-full"
                  required
                  maxLength={10}
                  placeholder="Enter phone number"
                />
              </div>

              <div>
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
              </div>

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
}
