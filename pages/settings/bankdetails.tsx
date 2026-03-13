import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ExportMenu } from '../../components/common/ExportMenu';
import { ClearableInput } from '../../components/common';

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
  const { showSnackbar } = useSnackbar();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('bank_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showModal, setShowModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [formData, setFormData] = useState({ id: 0, bank_name: '', account_number: '', bank_address: '', ifsc: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  useEffect(() => {
    if (!isFetching) {
      fetchBankAccounts();
    }
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  useEffect(() => {
    // Reset to page 1 when search term changes
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [debouncedSearchTerm]);

  const fetchBankAccounts = async () => {
    if (isFetching) return; // Prevent multiple concurrent API calls

    setIsFetching(true);
    setLoading(true);

    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm.trim(),
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/bank-details?${params}`);
      if (response.ok) {
        const data = await response.json();
        // Add index to each bank account for display
        const bankAccountsWithIndex = data.bankAccounts.map((bankAccount: BankAccount, index: number) => ({
          ...bankAccount,
          index: (pagination.page - 1) * pagination.limit + index + 1
        }));

        setBankAccounts(bankAccountsWithIndex);
        setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load bank accounts');
      }
    } catch (error) {
      console.error('Error fetching bank accounts:', error);
      showSnackbar('error', 'Network error while loading bank accounts');
    } finally {
      setLoading(false);
      setIsFetching(false); // Allow new API calls
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Show confirmation modal before saving
    setPendingData(formData);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingData) return;

    setIsSaving(true);

    try {
      const method = editingBank ? 'PUT' : 'POST';
      const url = '/api/bank-details';

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
        setFormData({ id: 0, bank_name: '', account_number: '', bank_address: '', ifsc: '' });
        setPendingData(null);
        fetchBankAccounts(); // Refresh the list
        showSnackbar('success', `Bank account ${editingBank ? 'updated' : 'created'} successfully!`);
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error saving bank account:', error);
        showSnackbar('error', error.message || 'Failed to save bank account');
        setShowConfirmModal(false); // Close confirmation modal, keep form modal open
      }
    } catch (error) {
      console.error('Error saving bank account:', error);
      showSnackbar('error', `Failed to ${editingBank ? 'update' : 'create'} bank account: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Bank Accounts</label>
              <ClearableInput
                type="text"
                placeholder="Search bank accounts..."
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
              data={bankAccounts}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: 'bank_name', label: 'Account Name', enabled: true },
                { key: 'account_number', label: 'Account Number', enabled: true },
                { key: 'bank_address', label: 'Bank Name', enabled: true },
                { key: 'ifsc', label: 'IFSC Code', enabled: true },
              ]}
              config={{
                title: 'Bank Accounts Report',
                fileName: 'Bank_Accounts'
              }}
            />
            <button className="btn-primary" onClick={handleAdd}>Add Bank Account</button>
          </div>
        </div>
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
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('id')}>
                      ID {getSortIcon('id')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('bank_name')}>
                      Account Name {getSortIcon('bank_name')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('account_number')}>
                      Account Number {getSortIcon('account_number')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('bank_address')}>
                      Bank Name {getSortIcon('bank_address')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('ifsc')}>
                      IFSC {getSortIcon('ifsc')}
                    </th>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
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
                <label className="block text-sm font-medium text-slate-300 mb-2">Account Name</label>
                <ClearableInput
                  type="text"
                  value={formData.bank_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_name: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Account Number</label>
                <ClearableInput
                  type="text"
                  value={formData.account_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, account_number: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Bank Name</label>
                <ClearableInput
                  type="text"
                  value={formData.bank_address}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_address: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">IFSC Code</label>
                <ClearableInput
                  type="text"
                  value={formData.ifsc}
                  onChange={(e) => setFormData(prev => ({ ...prev, ifsc: e.target.value }))}
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

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={`${editingBank ? 'Update' : 'Create'} Bank Account?`}
        message={`Are you sure you want to ${editingBank ? 'update' : 'create'} this bank account?`}
        confirmText={editingBank ? 'Update Bank Account' : 'Create Bank Account'}
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText={editingBank ? 'Updating Bank Account...' : 'Creating Bank Account...'}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />


    </div>
  );
}
