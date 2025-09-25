import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';

interface GSTTaxRate {
  id: number;
  description: string;
  rate: number;
  hsnCode: string;
  applicableFor: string;
  isActive: boolean;
  index: number;
}

interface GSTTaxRateResponse {
  gstRates: GSTTaxRate[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function GSTTaxRate() {
  const [gstRates, setGstRates] = useState<GSTTaxRate[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRate, setEditingRate] = useState<GSTTaxRate | null>(null);
  const [formData, setFormData] = useState({ id: 0, description: '', rate: '', hsnCode: '', applicableFor: '' });

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
      // For now, we'll use mock data since we don't have the API endpoint yet
      const mockData: GSTTaxRateResponse = {
        gstRates: [
          {
            id: 1,
            description: 'Standard Rate - 18%',
            rate: 18,
            hsnCode: '8431',
            applicableFor: 'Most spare parts and services',
            isActive: true,
            index: 1
          },
          {
            id: 2,
            description: 'Reduced Rate - 12%',
            rate: 12,
            hsnCode: '8708',
            applicableFor: 'Certain automotive parts',
            isActive: true,
            index: 2
          },
          {
            id: 3,
            description: 'Lower Rate - 5%',
            rate: 5,
            hsnCode: '8471',
            applicableFor: 'Computer components',
            isActive: true,
            index: 3
          },
          {
            id: 4,
            description: 'Exempted - 0%',
            rate: 0,
            hsnCode: '8517',
            applicableFor: 'Exempted telecommunications equipment',
            isActive: false,
            index: 4
          },
        ],
        pagination: { page: 1, limit: 50, total: 4, totalPages: 1, hasMore: false }
      };

      setGstRates(mockData.gstRates);
      setPagination(mockData.pagination);
    } catch (error) {
      console.error('Error fetching GST rates:', error);
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
    setFormData({ id: 0, description: '', rate: '', hsnCode: '', applicableFor: '' });
    setShowModal(true);
  };

  const handleEdit = (rate: GSTTaxRate) => {
    setEditingRate(rate);
    setFormData({
      id: rate.id,
      description: rate.description,
      rate: rate.rate.toString(),
      hsnCode: rate.hsnCode,
      applicableFor: rate.applicableFor
    });
    setShowModal(true);
  };

  const handleToggleActive = (id: number) => {
    setGstRates(rates =>
      rates.map(rate =>
        rate.id === id ? { ...rate, isActive: !rate.isActive } : rate
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // This will be replaced with actual API call when the endpoint is ready
      console.log('Saving GST rate:', formData);
      setShowModal(false);
      fetchGSTRates(); // Refresh the list
    } catch (error) {
      console.error('Error saving GST rate:', error);
    }
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
                    <th>Description</th>
                    <th>Rate (%)</th>
                    <th>HSN Code</th>
                    <th>Applicable For</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {gstRates.map((rate) => (
                    <tr key={rate.id}>
                      <td>{rate.index}</td>
                      <td>{rate.id}</td>
                      <td className="font-medium text-white">{rate.description}</td>
                      <td>
                        <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-sm font-medium">
                          {rate.rate}%
                        </span>
                      </td>
                      <td className="text-slate-300 font-mono">{rate.hsnCode}</td>
                      <td className="text-slate-300">{rate.applicableFor}</td>
                      <td>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rate.isActive}
                            onChange={() => handleToggleActive(rate.id)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(rate)}>Edit</button>
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
          <h3 className="text-lg font-semibold text-white mb-2">GST Calculation Information</h3>
          <div className="text-slate-400 text-sm space-y-2">
            <p>• GST rates are applied based on HSN codes and state-specific rules</p>
            <p>• Interstate sales: CGST and SGST (0.5% each for 1% total)</p>
            <p>• Interstate sales: IGST (full rate)</p>
            <p>• Reverse charge mechanism applies to certain transactions</p>
          </div>
        </div>
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
                  value={formData.hsnCode}
                  onChange={(e) => setFormData(prev => ({ ...prev, hsnCode: e.target.value }))}
                  className="input w-full"
                  placeholder="Enter HSN code"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Applicable For</label>
                <textarea
                  value={formData.applicableFor}
                  onChange={(e) => setFormData(prev => ({ ...prev, applicableFor: e.target.value }))}
                  className="input w-full"
                  rows={3}
                  placeholder="Describe what this rate applies to"
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
