import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { isValidIfsc } from '../../lib/bank';
import { ExportMenu } from '../../components/common/ExportMenu';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';
import { ClearableInput } from '../../components/common';

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  bank_address: string | null;
  ifsc: string | null;
}

interface BankResponse {
  bankAccounts: BankAccount[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function BankDetails() {
  const { showSnackbar } = useSnackbar();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  // Search, sort, page and limit: the shared list hook (§7b).
  const list = useListQuery({ defaultSort: 'bank_name' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [showModal, setShowModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [formData, setFormData] = useState({ id: 0, bank_name: '', account_number: '', bank_address: '', ifsc: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // S-40: skipping the fetch when one was in flight silently dropped the newer
  // filter, with no retry. Requests may overlap; the newest answer wins
  // (list.beginRequest).
  const query = list.params.toString();
  useEffect(() => {
    fetchBankAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchBankAccounts = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);

    try {
      const response = await fetch(`/api/bank-details?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data: BankResponse = await response.json();
        if (!isCurrent()) return;
        setBankAccounts(data.bankAccounts);
        list.setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Failed to load bank accounts');
      }
    } catch (error) {
      console.error('Error fetching bank accounts:', error);
      showSnackbar('error', 'Network error while loading bank accounts');
    } finally {
      if (isCurrent()) setLoading(false);
    }
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

    // Same rule the API applies, so the form cannot accept a value the server
    // will then reject. IFSC is optional; only its shape is checked when given.
    if (formData.ifsc && !isValidIfsc(formData.ifsc)) {
      showSnackbar('error', 'IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.');
      return;
    }

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
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
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
            <ListSummary pagination={pagination} shown={bankAccounts.length} noun="bank accounts" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('bank_name')}>
                      Account Name <SortIcon field="bank_name" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('account_number')}>
                      Account Number <SortIcon field="account_number" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('bank_address')}>
                      Bank Name <SortIcon field="bank_address" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('ifsc')}>
                      IFSC <SortIcon field="ifsc" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((account, index) => (
                    <tr key={account.id}>
                      {/* S-14: offset by the page, not restarted at 1. */}
                      <td>{list.serialNumber(index)}</td>
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

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
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
