import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';

interface FinancialYear {
  id: number;
  fy: string;
  index: number;
}

interface FinancialYearResponse {
  financialYears: FinancialYear[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function FinancialYear() {
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingYear, setEditingYear] = useState<FinancialYear | null>(null);
  const [formData, setFormData] = useState({ id: 0, fy: '' });

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchFinancialYears();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  const fetchFinancialYears = async () => {
    setLoading(true);
    try {
      // For now, we'll use mock data since we don't have the API endpoint yet
      const mockData: FinancialYearResponse = {
        financialYears: [
          { id: 1, fy: '2023-2024', index: 1 },
          { id: 2, fy: '2024-2025', index: 2 },
          { id: 3, fy: '2025-2026', index: 3 },
        ],
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1, hasMore: false }
      };

      setFinancialYears(mockData.financialYears);
      setPagination(mockData.pagination);
    } catch (error) {
      console.error('Error fetching financial years:', error);
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
    setEditingYear(null);
    setFormData({ id: 0, fy: '' });
    setShowModal(true);
  };

  const handleEdit = (year: FinancialYear) => {
    setEditingYear(year);
    setFormData({
      id: year.id,
      fy: year.fy
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // This will be replaced with actual API call when the endpoint is ready
      console.log('Saving financial year:', formData);
      setShowModal(false);
      fetchFinancialYears(); // Refresh the list
    } catch (error) {
      console.error('Error saving financial year:', error);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Financial Year</button>
      </div>

      <div className="card">
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
      </div>

      <div className="card">
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
                    <th>ID</th>
                    <th>Financial Year</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {financialYears.map((year, index) => (
                    <tr key={year.id}>
                      <td>{index + 1}</td>
                      <td>{year.id}</td>
                      <td className="font-medium text-white">{year.fy}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(year)}>Edit</button>
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

      <div className="card">
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-2">Current Financial Year: 2024-2025</h3>
          <p className="text-slate-400 text-sm">
            The current financial year runs from April 1, 2024, to March 31, 2025.
            This period is used for all financial reports, tax calculations, and accounting purposes.
          </p>
        </div>
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
                <label className="block text-sm font-medium text-slate-300 mb-2">Financial Year</label>
                <input
                  type="text"
                  value={formData.fy}
                  onChange={(e) => setFormData(prev => ({ ...prev, fy: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. 2024-2025"
                  required
                />
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
