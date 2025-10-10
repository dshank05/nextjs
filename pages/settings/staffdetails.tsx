import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';

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

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/staff?includeInactive=true');
      if (response.ok) {
        const data = await response.json();
        const staffWithIndex = data.staff.map((member: Staff, index: number) => ({
          ...member,
          index: index + 1
        }));
        setStaff(staffWithIndex);
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
      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Staff Member</button>
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
                  <th>Email</th>
                  <th>Status</th>
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
          </div>
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
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="Enter staff member's full name"
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
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="input w-full"
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
    </div>
  );
}
