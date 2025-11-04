import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { ClearableInput } from '../../components/common';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface State {
  id: number;
  name: string;
  code: string;
  gstStateCode: string;
  capital: string;
  region: string;
  status: string;
  index: number;
}

interface StateResponse {
  states: State[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function States() {
  const [states, setStates] = useState<Array<{id: number, state_name: string, code: number}>>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [editingState, setEditingState] = useState<{id: number, state_name: string} | null>(null);
  const [formData, setFormData] = useState({ id: 0, state_name: '' });
  const [pendingFormData, setPendingFormData] = useState<{ id: number, state_name: string } | null>(null);
  const [sortBy, setSortBy] = useState('state_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);



  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchStates();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchStates = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/states?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setStates(data.states);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Error fetching states:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
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
    setEditingState(null);
    setFormData({ id: 0, state_name: '' });
    setShowModal(true);
  };

  const handleEdit = (state: {id: number, state_name: string}) => {
    setEditingState(state);
    setFormData({
      id: state.id,
      state_name: state.state_name
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
        body: JSON.stringify({ state_name: pendingFormData.state_name }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save state');
      }

      // Refresh the states list
      await fetchStates();

      setShowConfirmModal(false);
      setPendingFormData(null);
    } catch (error) {
      console.error('Error saving state:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
      setConfirmLoading(false);
    } finally {
      setConfirmLoading(false);
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
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full min-w-24"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={states}
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
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {states.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} states</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('code')}>
                      Code {getSortIcon('code')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('state_name')}>
                      State Name {getSortIcon('state_name')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((state, index) => (
                    <tr key={state.id}>
                      <td>{index + 1}</td>
                      <td>{state.code}</td>
                      <td className="font-medium text-white">{state.state_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(state)}>Edit</button>
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
