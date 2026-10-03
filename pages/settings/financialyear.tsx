import { useState, useEffect } from 'react';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ClearableInput } from '../../components/common';
import { validateFinancialYear } from '../../lib/financial-year-rules';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';

interface FinancialYear {
  id: number;
  fy: string;
  start_date?: Date | string | null;
  end_date?: Date | string | null;
}

interface FinancialYearResponse {
  financialYears: FinancialYear[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function FinancialYear() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'fy', defaultOrder: 'desc' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // S-58: there is no `editingYear` any more. Nothing could set it - the table's
  // only action is "Set as Current" - and `handleConfirmSubmit` always POSTs, so
  // the edit branches it guarded were unreachable. The API has no update-fields
  // operation for a financial year either, so editing one is simply not a
  // feature. Adding it is an owner decision, not a silent restoration.
  const [formData, setFormData] = useState({ start_date: '', end_date: '' });
  const [currentFyId, setCurrentFyId] = useState<number | null>(null);
  const [settingCurrent, setSettingCurrent] = useState<number | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const query = list.params.toString();
  useEffect(() => {
    fetchFinancialYears();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchFinancialYears = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/financial-years?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data = await response.json();
        if (!isCurrent()) return;
        setFinancialYears(data.financialYears || []);
        list.setPagination(data.pagination);
        // Set current FY ID from the API response
        setCurrentFyId(data.currentFyId);
      } else {
        // S-48: a non-OK response used to leave the list silently stale.
        showSnackbar('error', 'Could not load financial years');
      }
    } catch (error) {
      console.error('Error fetching financial years:', error);
      showSnackbar('error', 'Failed to load financial years');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleSetAsCurrent = async (fyId: number) => {
    setSettingCurrent(fyId);
    try {
      // S-46: its own route. This used to PUT { fyId } to the collection while
      // the save path POSTed a whole record to the same URL - two unrelated
      // operations told apart by which fields were present.
      const response = await fetch(`/api/financial-years/${fyId}/current`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentFyId(fyId);
        showSnackbar('success', data.message || 'Financial year set as current');
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to set current financial year');
      }
    } catch (error) {
      console.error('Error setting current FY:', error);
      showSnackbar('error', 'Failed to set current financial year');
    } finally {
      setSettingCurrent(null);
    }
  };

  const handleAdd = () => {
    setFormData({ start_date: '', end_date: '' });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // S-74: the April-1 / March-31 / one-year rules used to be written out here
    // AND again in the API handler, each with its own date parser. One home now;
    // the server still applies the same check, because the browser's copy is the
    // one a caller can skip.
    const checked = validateFinancialYear(formData.start_date, formData.end_date);
    if (checked.ok === false) {
      showSnackbar('error', checked.message);
      return;
    }
    const { startDate, endDate } = checked.value;

    // The API returns ISO timestamps ("2026-04-01T00:00:00.000Z": a DATE column
    // read back as UTC midnight). Splitting that on "-" gave a NaN day, so every
    // comparison below was false and this check never ran. The date part is the
    // stored day.
    const parseDate = (value: Date | string): Date => {
      const text = value instanceof Date ? value.toISOString() : String(value);
      const [year, month, day] = text.slice(0, 10).split('-').map(Number);
      return new Date(year, month - 1, day);
    };

    // Check for overlaps with existing FYs
    const hasOverlap = financialYears.some(fy => {
      if (!fy.start_date || !fy.end_date) return false;

      const existingStart = parseDate(fy.start_date);
      const existingEnd = parseDate(fy.end_date);

      // Check if new FY overlaps with existing FY
      return (
        (startDate >= existingStart && startDate <= existingEnd) ||
        (endDate >= existingStart && endDate <= existingEnd) ||
        (startDate <= existingStart && endDate >= existingEnd)
      );
    });

    if (hasOverlap) {
      showSnackbar('error', 'This financial year overlaps with an existing financial year');
      return;
    }

    // A past year that overlaps nothing may be added for back-entry (owner,
    // 2026-10-03); the "Cannot create future financial year" check that refused
    // it is gone here and on the server.

    // Show confirmation modal before saving
    setPendingData({
      start_date: formData.start_date,
      end_date: formData.end_date
    });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingData) return;

    setIsSaving(true);  // Start loading state while modal is still open

    try {
      const response = await fetch('/api/financial-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingData)
      });

      if (response.ok) {
        // Success - close modals and refresh
        setShowConfirmModal(false);
        setShowModal(false);
        setFormData({ start_date: '', end_date: '' });
        setPendingData(null);
        fetchFinancialYears();
        showSnackbar('success', 'Financial year created successfully!');
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error creating financial year:', error);
        showSnackbar('error', error.message || 'Failed to create financial year');
        setShowConfirmModal(false); // Close confirmation modal, keep form modal open
      }
    } catch (error) {
      console.error('Error creating financial year:', error);
      showSnackbar('error', `Failed to create financial year: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowConfirmModal(false); // Close confirmation modal on network error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmModal(false);
    setPendingData(null);
  };

  return (
    <div className="space-y-6">

      {/* S-59: the search card and the current-FY banner that used to sit here,
          commented out, are gone. The search machinery behind the card is still
          live in useListQuery, so restoring the input is a one-line change
          (bind it to list.search / list.setSearch) if it is wanted.
          The banner said nothing the Status column does not already show. */}

      <div className="card">
        <div className="flex justify-end space-x-2 mb-2">
          <ExportMenu
            data={financialYears}
            columns={[
              // S-60: `status` is not a column on financial_year - the table
              // derives Current/Inactive from currentFyId - so exporting it
              // produced a permanently blank column.
              { key: 'id', label: 'ID', enabled: true },
              { key: 'fy', label: 'FY', enabled: true },
              { key: 'start_date', label: 'Start Date', enabled: true },
              { key: 'end_date', label: 'End Date', enabled: true },
            ]}
            config={{
              title: 'Financial Years Report',
              fileName: 'Financial_Years'
            }}
          />
          <button className="btn-primary" onClick={handleAdd}>Add Financial Year</button>
        </div>
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={financialYears.length} noun="financial years" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('fy')}>
                      Financial Year <SortIcon field="fy" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('status')}>
                      Status <SortIcon field="status" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {financialYears.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12">
                        <div className="flex flex-col items-center justify-center text-slate-400">
                          <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-lg font-medium mb-2">No Financial Years Found</p>
                          <p className="text-sm mb-4">Get started by adding your first financial year</p>
                          {/* <button onClick={handleAdd} className="btn-primary">
                            Add Financial Year
                          </button> */}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    financialYears.map((year, index) => (
                      <tr key={year.id}>
                        <td>{list.serialNumber(index)}</td>
                        <td>{year.id}</td>
                        <td className="font-medium text-white">{year.fy}</td>
                        <td>
                          {year.id === currentFyId ? (
                            <span className="px-2 py-1 bg-green-600 text-white text-xs rounded">Current</span>
                          ) : (
                            <span className="px-2 py-1 bg-slate-700 text-slate-400 text-xs rounded">Inactive</span>
                          )}
                        </td>
                        <td className="text-right">
                          {year.id !== currentFyId && (
                            <button
                              className="btn-primary mr-2 text-sm"
                              onClick={() => handleSetAsCurrent(year.id)}
                              disabled={settingCurrent === year.id}
                            >
                              {settingCurrent === year.id ? 'Setting...' : 'Set as Current'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">Add Financial Year</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              {formData.start_date && formData.end_date && (
                <div className="mb-6 p-3 bg-blue-900/30 border border-blue-700 rounded">
                  <p className="text-sm text-slate-300">
                    <span className="font-medium">Financial Year:</span> {new Date(formData.start_date).getFullYear()}-{new Date(formData.end_date).getFullYear()}
                  </p>
                </div>
              )}
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
        title="Create Financial Year?"
        message={`Are you sure you want to create financial year ${formData.start_date && formData.end_date ? `${new Date(formData.start_date).getFullYear()}-${new Date(formData.end_date).getFullYear()}` : ''}?`}
        confirmText="Create Financial Year"
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText="Creating Financial Year..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

    </div>
  );
}
