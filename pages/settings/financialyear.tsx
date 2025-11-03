import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ClearableInput } from '../../components/common';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('fy');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showModal, setShowModal] = useState(false);
  const [editingYear, setEditingYear] = useState<FinancialYear | null>(null);
  const [formData, setFormData] = useState({ id: 0, fy: '', start_date: '', end_date: '' });
  const [currentFyId, setCurrentFyId] = useState<number | null>(null);
  const [settingCurrent, setSettingCurrent] = useState<number | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'fy', label: 'FY', enabled: true },
    { key: 'status', label: 'Status', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Financial Years Report',
        fileName: `Financial_Years_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, financialYears, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = financialYears.map(year => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = year.id;
            break;
          case 'fy':
            row.FY = year.fy;
            break;
          case 'status':
            row.Status = year.id === currentFyId ? 'Current' : 'Inactive';
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Financial Years Report',
      fileName: `Financial_Years_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

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
      const response = await fetch('/api/financial-years', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId })
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
    setEditingYear(null);
    setFormData({ id: 0, fy: '', start_date: '', end_date: '' });
    setShowModal(true);
  };

  const handleEdit = (year: FinancialYear) => {
    setEditingYear(year);
    setFormData({
      id: year.id,
      fy: year.fy,
      start_date: year.start_date ? new Date(year.start_date).toISOString().split('T')[0] : '',
      end_date: year.end_date ? new Date(year.end_date).toISOString().split('T')[0] : ''
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate dates
    if (!formData.start_date || !formData.end_date) {
      showSnackbar('error', 'Please select both start and end dates');
      return;
    }

    // Parse date components manually to avoid timezone issues
    const parseDate = (dateString: string): Date => {
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(year, month - 1, day); // month is 0-indexed in Date constructor
    };

    const startDate = parseDate(formData.start_date);
    const endDate = parseDate(formData.end_date);

    // Validate Indian FY format: April 1 to March 31
    const startMonth = startDate.getMonth(); // 0-indexed (0 = Jan, 3 = April)
    const startDay = startDate.getDate();
    const endMonth = endDate.getMonth(); // 0-indexed (2 = March)
    const endDay = endDate.getDate();

    if (startMonth !== 3 || startDay !== 1) {
      showSnackbar('error', 'Financial year must start on April 1');
      return;
    }

    if (endMonth !== 2 || endDay !== 31) {
      showSnackbar('error', 'Financial year must end on March 31');
      return;
    }

    // Validate year span
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    if (endYear !== startYear + 1) {
      showSnackbar('error', 'Financial year must span exactly one year (e.g., April 1, 2024 → March 31, 2025)');
      return;
    }

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
        setFormData({ id: 0, fy: '', start_date: '', end_date: '' });
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

  const currentFy = financialYears.find(fy => fy.id === currentFyId);

  return (
    <div className="space-y-6">



      {/* <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Financial Years</label>
              <input
                type="text"
                placeholder="Search financial years..."
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
      </div> */}

      {/* {currentFy && (
        <div className="card">
          <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-2">Current Financial Year: {currentFy.fy}</h3>
            <p className="text-slate-400 text-sm">
              This financial year is currently active for all new transactions. Invoice numbers restart at 1 for each financial year.
            </p>
          </div>
        </div>
      )} */}

      <div className="card">
        <div className="flex justify-end space-x-2 mb-2">
          <div className="flex space-x-2">
            <button className="btn-secondary" onClick={() => handleExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => handleExport('pdf')}>
              📄 Export PDF
            </button>
          </div>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingYear ? 'Edit Financial Year' : 'Add Financial Year'}</h2>
            <form onSubmit={handleSubmit}>
              {editingYear && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Financial Year ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
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

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />
    </div>
  );
}
