import { useState, useEffect } from 'react';
import { useUrlState } from '../../hooks/useUrlState';
import { useDebounce } from '../../hooks/useDebounce';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ClearableInput } from '../../components/common';
import { validateFinancialYear } from '../../lib/financial-year-rules';

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
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  // Mirrored in the URL so search and sort survive a refresh and a return
  // from an edit, and so a filtered list can be linked (F-49).
  const [searchTerm, setSearchTerm] = useUrlState<string>('search', '');
  const [sortBy, setSortBy] = useUrlState<string>('sortBy', 'fy');
  const [sortOrder, setSortOrder] = useUrlState<'asc' | 'desc'>('sortOrder', 'desc');
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

  const debouncedSearchTerm = useDebounce(searchTerm, 300);



  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page on sorting
  };

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm, sortBy, sortOrder]);

  useEffect(() => {
    fetchFinancialYears();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchFinancialYears = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm.trim(),
        sortBy: sortBy,
        sortOrder: sortOrder,
      });
      const response = await fetch(`/api/financial-years?${params}`);
      if (response.ok) {
        const data = await response.json();
        setFinancialYears(data.financialYears || []);
        setPagination(data.pagination);
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
      setLoading(false);
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

    const parseDate = (dateString: string): Date => {
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(year, month - 1, day);
    };

    // Check for overlaps with existing FYs
    const hasOverlap = financialYears.some(fy => {
      if (!fy.start_date || !fy.end_date) return false;

      const existingStart = parseDate(fy.start_date as string);
      const existingEnd = parseDate(fy.end_date as string);

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

    // Check if trying to create future FY while current FY is still active
    const currentDate = new Date();
    const activeFy = financialYears.find(fy => {
      if (!fy.start_date || !fy.end_date) return false;
      const fyStart = parseDate(fy.start_date as string);
      const fyEnd = parseDate(fy.end_date as string);
      return currentDate >= fyStart && currentDate <= fyEnd;
    });

    if (activeFy && startDate < parseDate(activeFy.end_date as string)) {
      const activeFyEnd = parseDate(activeFy.end_date as string).toLocaleDateString();
      showSnackbar('error', `Cannot create future financial year. Current FY ${activeFy.fy} is active until ${activeFyEnd}`);
      return;
    }

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

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  return (
    <div className="space-y-6">



      {/* S-59: the search card and the current-FY banner that used to sit here,
          commented out, are gone. The search machinery behind the card is still
          live - searchTerm, the debounce, the fetch parameter and the page-reset
          effect - so restoring the input is a one-line change if it is wanted.
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
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {financialYears.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} financial years</div>
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
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('fy')}>
                      Financial Year {getSortIcon('fy')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
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
                        <td>{(pagination.page - 1) * pagination.limit + index + 1}</td>
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
