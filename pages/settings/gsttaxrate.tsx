import { useState, useEffect } from 'react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ClearableInput, ClearableTextarea } from '../../components/common';

interface GSTTaxRate {
  id: number;
  description: string;
  rate: number;
  hsn_code: string;
  applicable_for: string;
  status: string;
}

interface GSTTaxRateResponse {
  gstRates: GSTTaxRate[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function GSTTaxRate() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'description', fixedParams: { includeInactive: 'true' } });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [gstRates, setGstRates] = useState<GSTTaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRate, setEditingRate] = useState<GSTTaxRate | null>(null);
  const [formData, setFormData] = useState({ id: 0, description: '', rate: '', hsn_code: '', applicable_for: '', status: 'Active' as 'Active' | 'Inactive' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Confirmation modal states for status changes
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [changingRate, setChangingRate] = useState<{
    id: number;
    description: string;
    currentStatus: 'Active' | 'Inactive';
    newStatus: 'Active' | 'Inactive';
  } | null>(null);
  const [changingLoading, setChangingLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const query = list.params.toString();
  useEffect(() => {
    fetchGSTRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchGSTRates = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/gst-rates?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data: GSTTaxRateResponse = await response.json();
        if (!isCurrent()) return;
        setGstRates(data.gstRates);
        list.setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load GST rates');
      }
    } catch (error) {
      console.error('Error fetching GST rates:', error);
      showSnackbar('error', 'Network error while loading GST rates');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingRate(null);
    setFormData({ id: 0, description: '', rate: '', hsn_code: '', applicable_for: '', status: 'Active' });
    setShowModal(true);
  };

  const handleEdit = (rate: GSTTaxRate) => {
    setEditingRate(rate);
    setFormData({
      id: rate.id,
      description: rate.description,
      rate: rate.rate.toString(),
      hsn_code: rate.hsn_code,
      applicable_for: rate.applicable_for,
      status: rate.status as 'Active' | 'Inactive'
    });
    setShowModal(true);
  };

  // Removed handleToggleActive - no longer need is_active logic

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
      const method = editingRate ? 'PUT' : 'POST';
      const url = '/api/gst-rates';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        // An edit does not send status: the row's status when the form opened
        // would overwrite a change made since (the Deactivate button owns it).
        body: JSON.stringify(editingRate ? (({ status: _status, ...rest }) => rest)(pendingData) : pendingData),
      });

      if (response.ok) {
        // Success - close modals and refresh
        setShowConfirmModal(false);
        setShowModal(false);
        setFormData({ id: 0, description: '', rate: '', hsn_code: '', applicable_for: '', status: 'Active' });
        setPendingData(null);
        fetchGSTRates(); // Refresh the list
        // S-50: this was the only save in Settings that reported nothing on
        // success, while its sibling pages all confirm.
        showSnackbar('success', `GST rate ${editingRate ? 'updated' : 'created'} successfully`);
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error saving GST rate:', error);
        showSnackbar('error', error.message || 'Failed to save GST rate');
        setShowConfirmModal(false); // Close confirmation modal, keep form modal open
      }
    } catch (error) {
      console.error('Error saving GST rate:', error);
      showSnackbar('error', 'Network error occurred');
      setShowConfirmModal(false); // Close confirmation modal on network error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmModal(false);
    setPendingData(null);
  };

  const handleStatusChange = (rateId: number, rateDescription: string, currentStatus: 'Active' | 'Inactive') => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    const actionText = newStatus === 'Active' ? 'activate' : 'deactivate';

    setChangingRate({
      id: rateId,
      description: rateDescription,
      currentStatus,
      newStatus
    });
    setShowStatusChangeModal(true);
  };

  const confirmStatusChange = async () => {
    if (!changingRate) return;

    setChangingLoading(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const statusValue = changingRate.newStatus;
      // The status route, not the full-update PUT. That PUT hid a status-only
      // branch which only fired when all four other fields happened to be
      // absent - a state transition inferred from what was missing (S-66).
      const response = await fetch(`/api/gst-rates/${changingRate.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusValue }),
        signal: controller.signal
      });

      if (response.ok) {
        fetchGSTRates();
        showSnackbar('success', `GST rate ${changingRate.newStatus === 'Active' ? 'activated' : 'deactivated'} successfully`);
      } else {
        const errorData = await response.json();
        showSnackbar('error', errorData.message || `Failed to ${changingRate.newStatus === 'Active' ? 'activate' : 'deactivate'} GST rate`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        showSnackbar('info', 'Operation cancelled');
      } else {
        console.error('Error changing GST rate status:', error);
        showSnackbar('error', 'Network error while changing GST rate status');
      }
    } finally {
      setChangingLoading(false);
      setShowStatusChangeModal(false);
      setChangingRate(null);
      setAbortController(null);
    }
  };

  const cancelStatusChange = () => {
    // Cancel any pending API call
    if (abortController) {
      abortController.abort();
    }

    setShowStatusChangeModal(false);
    setChangingRate(null);
    setChangingLoading(false);
    setAbortController(null);
  };

  return (
    <div className="space-y-6">

      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
              <ClearableInput
                type="text"
                placeholder="Description, HSN code, rate"
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={gstRates}
              // S-89: export every matching row, not just the page on screen.
              fetchAll={async () => {
                const r = await fetch('/api/gst-rates?dropdown=true&includeInactive=true');
                if (!r.ok) throw new Error('Could not load the full list');
                const d = await r.json();
                return d.data || d.gstRates || [];
              }}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'hsn_code', label: 'HSN Code', enabled: true },
                { key: 'rate', label: 'Rate (%)', enabled: true },
                { key: 'description', label: 'Description', enabled: true },
                { key: 'applicable_for', label: 'Applicable For', enabled: true },
                { key: 'status', label: 'Status', enabled: true },
              ]}
              config={{
                title: 'GST Rates Report',
                fileName: 'GST_Rates'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add GST Rate</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={gstRates.length} noun="GST rates" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('hsn_code')}>
                      HSN Code <SortIcon field="hsn_code" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('rate')}>
                      Rate (%) <SortIcon field="rate" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('description')}>
                      Description <SortIcon field="description" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('applicable_for')}>
                      Applicable For <SortIcon field="applicable_for" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('status')}>
                      Status <SortIcon field="status" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {gstRates.map((rate, i) => (
                    <tr key={rate.id}>
                      <td>{list.serialNumber(i)}</td>
                      <td>{rate.id}</td>
                      <td className="text-slate-300 font-mono">{rate.hsn_code}</td>
                      <td>
                        <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-sm font-medium">
                          {rate.rate}%
                        </span>
                      </td>
                      <td className="text-white">{rate.description}</td>
                      <td className="text-slate-300">{rate.applicable_for}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          rate.status === 'Active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {rate.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(rate)}>Edit</button>
                        <button
                          className={rate.status === 'Active' ? 'btn-danger' : 'btn-primary'}
                          onClick={() => handleStatusChange(rate.id, rate.description, rate.status as 'Active' | 'Inactive')}
                        >
                          {rate.status === 'Active' ? 'Deactivate' : 'Activate'}
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingRate ? 'Edit GST Rate' : 'Add GST Rate'}</h2>
            <form onSubmit={handleSubmit}>
              {editingRate && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST Rate ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
                <ClearableInput
                  type="text"
                  name="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g. GST 18%"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Rate (%) *</label>
                <ClearableInput
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.rate}
                  onChange={(e) => setFormData(prev => ({ ...prev, rate: e.target.value }))}
                  placeholder="Enter GST rate"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">HSN Code *</label>
                <ClearableInput
                  type="text"
                  value={formData.hsn_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, hsn_code: e.target.value }))}
                  placeholder="Enter HSN code"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Applicable For</label>
                <ClearableTextarea
                  value={formData.applicable_for}
                  onChange={(e) => setFormData(prev => ({ ...prev, applicable_for: e.target.value }))}
                  rows={3}
                  placeholder="What this rate applies to (optional)"
                />
              </div>

              {/* No Status control here. A GST rate had two ways to change
                  status - this dropdown and the Deactivate button - which is
                  exactly what staff and mechanics removed (S-66). The button is
                  the one that survives, because it is a transition. */}
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
        title={`${editingRate ? 'Update' : 'Create'} GST Rate?`}
        message={`Are you sure you want to ${editingRate ? 'update' : 'create'} this GST rate?`}
        confirmText={editingRate ? 'Update GST Rate' : 'Create GST Rate'}
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText={editingRate ? 'Updating GST Rate...' : 'Creating GST Rate...'}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

      <ConfirmationModal
        isOpen={showStatusChangeModal}
        title={`${changingRate?.newStatus === 'Active' ? 'Activate' : 'Deactivate'} GST Rate`}
        message={`Are you sure you want to ${changingRate?.newStatus === 'Active' ? 'activate' : 'deactivate'} ${changingRate?.description}?`}
        confirmText={changingRate?.newStatus === 'Active' ? 'Activate' : 'Deactivate'}
        cancelText="Cancel"
        showLoading={changingLoading}
        loadingText={`${changingRate?.newStatus === 'Active' ? 'Activating' : 'Deactivating'}...`}
        cancelLoadingText="Canceling..."
        onConfirm={confirmStatusChange}
        onCancel={cancelStatusChange}
      />

    </div>
  );
}
