import { useState, useEffect } from 'react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ClearableInput } from '../../components/common';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';

import type { UserRow } from '../../types/settings';
import { USER_STATUS_ACTIVE, userStatusLabel } from '../../types/settings';

/**
 * S-27: the interface here used to declare `auth_key`, `password_hash` and
 * `password_reset_token`. The API's `select` deliberately excludes all three,
 * so nothing ever leaked - but the type said otherwise, and it cost this audit a
 * wrong finding until the handler was read. `UserRow` is `Omit`-ed from the
 * Prisma model, so a credential column added later is excluded by construction
 * rather than by somebody remembering.
 */
type User = UserRow;

export default function Users() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'created_at', defaultOrder: 'desc' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ id: 0, username: '', email: '', phone: '', password: '', status: '' });
  // S-28: this page had no deactivate action at all - status could only be
  // changed by opening the edit modal, and until S-25 that silently did nothing.
  const [changingUser, setChangingUser] = useState<User | null>(null);
  const [changingLoading, setChangingLoading] = useState(false);

  const query = list.params.toString();
  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchUsers = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/users?${query}`);
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (!isCurrent()) return;
      setUsers(data.users);
      list.setPagination(data.pagination);
    } catch (error) {
      console.error('Error fetching users:', error);
      showSnackbar('error', 'Could not load users');
    } finally {
      if (isCurrent()) setLoading(false);
    }
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
      // E-18: on edit, status is sent only when it was changed in this form.
      // Re-sending the status loaded with the form re-activated a user that
      // someone else had deactivated meanwhile; the API keeps the stored
      // status when none is sent.
      const statusChanged = !editingUser || formData.status !== editingUser.status.toString();
      const requestData = {
        username: formData.username,
        email: formData.email,
        phone: formData.phone || null,
        password: formData.password,
        ...(statusChanged && { status: formData.status }),
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
      // Every other settings screen confirms a save; this one just closed.
      showSnackbar('success', editingUser ? 'User updated successfully' : 'User created successfully');
    } catch (error) {
      console.error('Error saving user:', error);
      showSnackbar('error', error instanceof Error ? error.message : 'Could not save the user');
    }
  };

  // S-30: the bare 10 used to appear in four places with nothing naming it.
  const getStatusText = userStatusLabel;

  const confirmStatusChange = async () => {
    if (!changingUser) return;
    setChangingLoading(true);

    const next = changingUser.status === USER_STATUS_ACTIVE ? 'Inactive' : 'Active';
    try {
      const response = await fetch(`/api/users/${changingUser.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });

      if (response.ok) {
        fetchUsers();
        showSnackbar('success', `User ${next === 'Active' ? 'activated' : 'deactivated'}`);
      } else {
        const body = await response.json();
        showSnackbar('error', body.message || 'Could not change the user status');
      }
    } catch (error) {
      console.error('Error changing user status:', error);
      showSnackbar('error', 'Network error while changing the user status');
    } finally {
      setChangingLoading(false);
      setChangingUser(null);
    }
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
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={users}
              // S-89: export every matching row, not just the page on screen.
              fetchAll={async () => {
                const r = await fetch('/api/users?dropdown=true');
                if (!r.ok) throw new Error('Could not load the full list');
                const d = await r.json();
                return d.data || d.users || [];
              }}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'username', label: 'Username', enabled: true },
                { key: 'email', label: 'Email', enabled: true },
                { key: 'phone', label: 'Phone', enabled: true },
                // S-08: the export used to emit the raw 10 / 0 and a Unix
                // integer, while the table beside it showed "Active" and a
                // formatted date - the same row, read two ways.
                { key: 'status', label: 'Status', enabled: true, format: (u) => getStatusText(u.status) },
                { key: 'created_at', label: 'Created Date', enabled: true, format: (u) => formatDate(u.created_at) },
              ]}
              config={{
                title: 'Users Report',
                fileName: 'Users'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add User</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={users.length} noun="users" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('username')}>
                      Username <SortIcon field="username" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('email')}>
                      Email <SortIcon field="email" {...sortProps} />
                    </th>
                    <th>Phone</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('status')}>
                      Status <SortIcon field="status" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('created_at')}>
                      Created <SortIcon field="created_at" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, index) => (
                    <tr key={user.id}>
                      <td>{list.serialNumber(index)}</td>
                      <td>{user.id}</td>
                      <td className="font-medium text-white">{user.username}</td>
                      <td className="text-slate-300">{user.email}</td>
                      <td className="text-slate-300">{user.phone || '-'}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          user.status === USER_STATUS_ACTIVE
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {getStatusText(user.status)}
                        </span>
                      </td>
                      <td className="text-slate-300 text-sm">{formatDate(user.created_at)}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(user)}>Edit</button>
                        <button
                          className={user.status === USER_STATUS_ACTIVE ? 'btn-danger' : 'btn-primary px-6'}
                          onClick={() => setChangingUser(user)}
                          title={user.status === USER_STATUS_ACTIVE ? 'Deactivate user' : 'Activate user'}
                        >
                          {user.status === USER_STATUS_ACTIVE ? 'Deactivate' : 'Activate'}
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

      <ConfirmationModal
        isOpen={changingUser !== null}
        title={changingUser?.status === USER_STATUS_ACTIVE ? 'Deactivate User' : 'Activate User'}
        message={
          changingUser
            ? `Are you sure you want to ${changingUser.status === USER_STATUS_ACTIVE ? 'deactivate' : 'activate'} "${changingUser.username}"?`
            : ''
        }
        confirmText={changingUser?.status === USER_STATUS_ACTIVE ? 'Deactivate' : 'Activate'}
        cancelText="Cancel"
        showLoading={changingLoading}
        onConfirm={confirmStatusChange}
        onCancel={() => { if (!changingLoading) setChangingUser(null); }}
      />

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
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
                  // S-67: digits only, matching the other three pages. The
                  // HTML `pattern` this relied on is a browser-side hint only.
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))}
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
              {/* Shown when editing too. It used to be hidden on edit, and the
                  update endpoint ignored the field anyway, so there was no way
                  to change anyone's password anywhere in the app (F-61).
                  Blank on edit means "leave the current password alone". */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  {editingUser ? 'New password' : 'Password'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="input w-full"
                  required={!editingUser}
                  autoComplete="new-password"
                  placeholder={editingUser ? 'Leave blank to keep the current password' : ''}
                />
                {editingUser && (
                  <p className="mt-2 text-xs text-slate-400">
                    Leave blank to keep the current password.
                  </p>
                )}
              </div>
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
