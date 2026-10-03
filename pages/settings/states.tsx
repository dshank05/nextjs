import { useState, useEffect } from 'react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ClearableInput } from '../../components/common';
import { useSnackbar } from '../../components/SnackbarProvider';

import type { StateRow } from '../../types/settings';

/**
 * S-31: two interfaces used to sit here describing a row that does not exist -
 * `name`, `code: string`, `gstStateCode`, `capital`, `region`, `status` - while
 * the real shape, `{id, state_name, code: number}`, was re-declared inline four
 * times in this file. Neither interface was referenced. `StateRow` is derived
 * from Prisma, so it cannot drift from the table again.
 */

export default function States() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'state_name' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [states, setStates] = useState<StateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [editingState, setEditingState] = useState<StateRow | null>(null);
  const [formData, setFormData] = useState({ id: 0, state_name: '', code: '' });
  const [pendingFormData, setPendingFormData] = useState<{ id: number, state_name: string, code: string } | null>(null);
  // S-33: a state could be created and edited but never removed, although
  // DELETE /api/states/[id] has existed all along - guarded, so a state in use
  // by a customer, a vendor or an existing document is refused.
  const [deletingState, setDeletingState] = useState<StateRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const query = list.params.toString();
  useEffect(() => {
    fetchStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchStates = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/states?${query}`);
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (!isCurrent()) return;
      setStates(data.states);
      list.setPagination(data.pagination);
    } catch (error) {
      console.error('Error fetching states:', error);
      showSnackbar('error', 'Could not load states');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingState(null);
    setFormData({ id: 0, state_name: '', code: '' });
    setShowModal(true);
  };

  const handleEdit = (state: StateRow) => {
    setEditingState(state);
    setFormData({
      id: state.id,
      state_name: state.state_name,
      // Code 0 means "never configured" (F-29) - show it as empty so the field
      // reads as something to fill in rather than a real value.
      code: state.code ? state.code.toString() : ''
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPendingFormData(formData);
    setShowModal(false);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingFormData) return;

    setConfirmLoading(true);

    try {
      const apiUrl = editingState
        ? `/api/states/${editingState.id}`
        : '/api/states';

      const method = editingState ? 'PUT' : 'POST';

      const response = await fetch(apiUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state_name: pendingFormData.state_name,
          code: pendingFormData.code
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save state');
      }

      // Refresh the states list
      await fetchStates();

      setShowConfirmModal(false);
      setPendingFormData(null);
      showSnackbar('success', editingState ? 'State updated successfully' : 'State created successfully');
    } catch (error) {
      console.error('Error saving state:', error);
      // Every other settings page reports through the snackbar; this was the
      // only one still using a blocking window.alert (S-15).
      showSnackbar('error', error instanceof Error ? error.message : 'Could not save the state');
      // Back to the form with what was typed, so it can be corrected rather
      // than retyped (the form used to stay closed).
      setShowConfirmModal(false);
      setFormData(pendingFormData);
      setShowModal(true);
      setConfirmLoading(false);
    } finally {
      setConfirmLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingState) return;
    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/states/${deletingState.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        showSnackbar('success', 'State deleted');
        await fetchStates();
      } else {
        // The 409 here is the useful case: it names why the state cannot go.
        showSnackbar('error', body.message || 'Could not delete the state');
      }
    } catch (error) {
      console.error('Error deleting state:', error);
      showSnackbar('error', 'Network error while deleting the state');
    } finally {
      setDeleteLoading(false);
      setDeletingState(null);
    }
  };

  return (
    <div className="space-y-6">

      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">State Name</label>
              <ClearableInput
                type="text"
                placeholder="Search states..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={states}
              // S-89: export every matching row, not just the page on screen.
              fetchAll={async () => {
                const r = await fetch('/api/states?dropdown=true');
                if (!r.ok) throw new Error('Could not load the full list');
                const d = await r.json();
                return d.data || d.states || [];
              }}
              columns={[
                { key: 'code', label: 'Code', enabled: true },
                { key: 'state_name', label: 'State Name', enabled: true },
              ]}
              config={{
                title: 'States Report',
                fileName: 'States'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add State</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={states.length} noun="states" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('code')}>
                      Code <SortIcon field="code" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('state_name')}>
                      State Name <SortIcon field="state_name" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((state, index) => (
                    <tr key={state.id}>
                      <td>{list.serialNumber(index)}</td>
                      <td>{state.code}</td>
                      <td className="font-medium text-white">{state.state_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(state)}>Edit</button>
                        <button className="btn-danger" onClick={() => setDeletingState(state)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {states.length === 0 && !loading && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🏛️</div>
                  <h3 className="text-lg font-semibold text-white mb-2">No states found</h3>
                  <p className="text-slate-400">Start by adding your first state to the database.</p>
                </div>
              )}
            </div>

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingState ? 'Edit State' : 'Add State'}</h2>
            <form onSubmit={handleSubmit}>
              {editingState && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">State ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">State Name</label>
                <ClearableInput
                  type="text"
                  value={formData.state_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, state_name: e.target.value }))}
                  placeholder="Enter state name"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  GST State Code
                </label>
                <ClearableInput
                  type="number"
                  min={1}
                  max={38}
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="e.g. 9 for Uttar Pradesh"
                  required
                />
                <p className="text-xs text-slate-400 mt-2">
                  The official GST code for this state (1-38). This decides whether
                  invoices to this state are charged CGST+SGST or IGST, so it must
                  be correct.
                </p>
              </div>
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={deletingState !== null}
        title="Delete State"
        message={
          deletingState
            ? `Delete "${deletingState.state_name}"? This cannot be undone. It will be refused if the state is in use.`
            : ''
        }
        confirmText="Delete State"
        cancelText="Cancel"
        showLoading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleteLoading) setDeletingState(null); }}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={editingState ? 'Confirm Edit' : 'Confirm Add'}
        message={editingState
          ? `Are you sure you want to update this state to "${pendingFormData?.state_name}"?`
          : `Are you sure you want to add "${pendingFormData?.state_name}" as a new state?`
        }
        showLoading={confirmLoading}
        onConfirm={handleConfirmSubmit}
        onCancel={() => {
          if (!confirmLoading) {
            setShowConfirmModal(false);
            setPendingFormData(null);
          }
        }}
      />

    </div>
  );
}
