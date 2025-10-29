import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

interface GSTTaxRate {
  id: number;
  description: string;
  rate: number;
  hsn_code: string;
  applicable_for: string;
  status: string;
  index: number;
}

interface GSTTaxRateResponse {
  gstRates: GSTTaxRate[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function GSTTaxRate() {
  const { showSnackbar } = useSnackbar();
  const [gstRates, setGstRates] = useState<GSTTaxRate[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchGSTRates();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  const fetchGSTRates = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        includeInactive: 'true'
      });

      const response = await fetch(`/api/gst-rates?${params}`);
      if (response.ok) {
        const data = await response.json();
        // Add index to each GST rate for display
        const gstRatesWithIndex = data.gstRates.map((rate: GSTTaxRate, index: number) => ({
          ...rate,
          index: (pagination.page - 1) * pagination.limit + index + 1
        }));

        setGstRates(gstRatesWithIndex);
        setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load GST rates');
      }
    } catch (error) {
      console.error('Error fetching GST rates:', error);
      showSnackbar('error', 'Network error while loading GST rates');
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

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
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
        body: JSON.stringify(pendingData),
      });

      if (response.ok) {
        // Success - close modals and refresh
        setShowConfirmModal(false);
        setShowModal(false);
        setFormData({ id: 0, description: '', rate: '', hsn_code: '', applicable_for: '', status: 'Active' });
        setPendingData(null);
        fetchGSTRates(); // Refresh the list
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
      const response = await fetch('/api/gst-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: changingRate.id, status: statusValue }),
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

      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add GST Rate</button>
      </div>

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search GST Rates</label>
              <input
                type="text"
                placeholder="Search GST rates..."
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
              <div>Showing {gstRates.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} GST rates</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th>ID</th>
                    <th>HSN Code</th>
                    <th>Rate (%)</th>
                    <th>Applicable For</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {gstRates.map((rate) => (
                    <tr key={rate.id}>
                      <td>{rate.index}</td>
                      <td>{rate.id}</td>
                      <td className="text-slate-300 font-mono">{rate.hsn_code}</td>
                      <td>
                        <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-sm font-medium">
                          {rate.rate}%
                        </span>
                      </td>
                      <td className="text-slate-300">{rate.applicable_for}</td>
                      <td className="font-medium text-white">{rate.description}</td>
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
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="input w-full"
                  placeholder="Enter rate description"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.rate}
                  onChange={(e) => setFormData(prev => ({ ...prev, rate: e.target.value }))}
                  className="input w-full"
                  placeholder="Enter GST rate"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">HSN Code</label>
                <input
                  type="text"
                  value={formData.hsn_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, hsn_code: e.target.value }))}
                  className="input w-full"
                  placeholder="Enter HSN code"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Applicable For</label>
                <textarea
                  value={formData.applicable_for}
                  onChange={(e) => setFormData(prev => ({ ...prev, applicable_for: e.target.value }))}
                  className="input w-full"
                  rows={3}
                  placeholder="Describe what this rate applies to"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
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
