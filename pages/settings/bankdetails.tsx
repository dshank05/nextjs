import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  bank_address: string | null;
  ifsc: string | null;
  index: number;
}

interface BankResponse {
  bankAccounts: BankAccount[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function BankDetails() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [formData, setFormData] = useState({ id: 0, bank_name: '', account_number: '', bank_address: '', ifsc: '' });

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchBankAccounts();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  const fetchBankAccounts = async () => {
    setLoading(true);
    try {
      // For now, we'll use mock data since we don't have the API endpoint yet
      const mockData: BankResponse = {
        bankAccounts: [
          { id: 1, bank_name: 'State Bank of India', account_number: '123456789', bank_address: 'Main Branch, Delhi', ifsc: 'SBIN0001234', index: 1 },
          { id: 2, bank_name: 'HDFC Bank', account_number: '987654321', bank_address: 'Branch Office, Mumbai', ifsc: 'HDFC0004321', index: 2 },
        ],
        pagination: { page: 1, limit: 50, total: 2, totalPages: 1, hasMore: false }
      };

      setBankAccounts(mockData.bankAccounts);
      setPagination(mockData.pagination);
    } catch (error) {
      console.error('Error fetching bank accounts:', error);
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
    setEditingBank(null);
    setFormData({ id: 0, bank_name: '', account_number: '', bank_address: '', ifsc: '' });
    setShowModal(true);
  };

  const handleEdit = (bank: BankAccount) => {
    setEditingBank(bank);
    setFormData({
      id: bank.id,
      bank_name: bank.bank_name,
      account_number: bank.account_number,
      bank_address: bank.bank_address || '',
      ifsc: bank.ifsc || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // This will be replaced with actual API call when the endpoint is ready
      console.log('Saving bank account:', formData);
      setShowModal(false);
      fetchBankAccounts(); // Refresh the list
    } catch (error) {
      console.error('Error saving bank account:', error);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Bank Account</button>
      </div>

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Bank Accounts</label>
              <input
                type="text"
                placeholder="Search bank accounts..."
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
              <div>Showing {bankAccounts.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} bank accounts</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th>ID</th>
                    <th>Bank Name</th>
                    <th>Account Number</th>
                    <th>Bank Address</th>
                    <th>IFSC</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((account, index) => (
                    <tr key={account.id}>
                      <td>{index + 1}</td>
                      <td>{account.id}</td>
                      <td className="font-medium text-white">{account.bank_name}</td>
                      <td className="text-slate-300 font-mono">{account.account_number}</td>
                      <td className="text-slate-300">{account.bank_address || '-'}</td>
                      <td className="text-slate-300 font-mono">{account.ifsc || '-'}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(account)}>Edit</button>
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingBank ? 'Edit Bank Account' : 'Add Bank Account'}</h2>
            <form onSubmit={handleSubmit}>
              {editingBank && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Account ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Bank Name</label>
                <input
                  type="text"
                  value={formData.bank_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_name: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Account Number</label>
                <input
                  type="text"
                  value={formData.account_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, account_number: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Bank Address</label>
                <input
                  type="text"
                  value={formData.bank_address}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_address: e.target.value }))}
                  className="input w-full"
                  placeholder="Optional"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">IFSC Code</label>
                <input
                  type="text"
                  value={formData.ifsc}
                  onChange={(e) => setFormData(prev => ({ ...prev, ifsc: e.target.value }))}
                  className="input w-full"
                  placeholder="Optional"
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
