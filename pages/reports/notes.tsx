import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, Search } from 'lucide-react';
import { ClearableInput, ExportMenu, SearchableSelect } from '../../components/common';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { getLocalDateString } from '../../lib/date-utils';

interface Transaction {
  id: number;
  invoice_no: number;
  type: 'sale' | 'salex' | 'purchase';
  customer_vendor_name: string;
  total: number;
  invoice_date: number;
  notes: string;
  formattedDate: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function NotesMentioned() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  const [notesSearch, setNotesSearch] = useState('');
  const [transactionType, setTransactionType] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (notesSearch) {
      fetchTransactions();
    }
  }, [pagination.page, notesSearch, transactionType, dateFrom, dateTo]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        notesSearch,
        transactionType,
        dateFrom,
        dateTo
      });

      const response = await fetch(`/api/reports/notes-mentioned?${params}`);
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setNotesSearch('');
    setTransactionType('all');
    setDateFrom('');
    setDateTo('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-6">Notes Mentioned Report</h1>

        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Search in Notes <span className="text-red-400">*</span>
            </label>
            <ClearableInput
              type="text"
              placeholder="Enter text to search in notes..."
              value={notesSearch}
              onChange={(e) => setNotesSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Transaction Type</label>
            <SearchableSelect
              options={[
                { id: 'all', name: 'All Types' },
                { id: 'sale', name: 'Sale' },
                { id: 'salex', name: 'Salex' },
                { id: 'purchase', name: 'Purchase' }
              ]}
              selectedValue={transactionType}
              onSelectionChange={(value) => setTransactionType(value || 'all')}
              placeholder="Select type..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={dateFrom}
              endDate={dateTo}
              onDateChange={(start, end) => {
                setDateFrom(start);
                setDateTo(end);
              }}
              placeholder="Select date range..."
            />
          </div>

          <div className="flex items-end gap-2">
            <button onClick={clearFilters} className="btn-secondary px-4 py-2">
              Clear
            </button>
            <ExportMenu
              data={transactions}
              columns={[
                { key: 'invoice_no', label: 'Invoice No', enabled: true },
                { key: 'type', label: 'Type', enabled: true },
                { key: 'customer_vendor_name', label: 'Customer/Vendor', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'notes', label: 'Notes', enabled: true }
              ]}
              config={{
                title: 'Notes Mentioned Report',
                fileName: `Notes_Mentioned_${getLocalDateString()}`
              }}
            />
          </div>
        </div>

        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {transactions.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} transactions
            </div>
            <div>Page {pagination.page} of {pagination.totalPages}</div>
          </div>
        )}

        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                <th>Invoice No</th>
                <th>Type</th>
                <th>Customer/Vendor</th>
                <th>Total Amount</th>
                <th>Date</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn, idx) => (
                <tr key={`${txn.type}-${txn.id}`}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{txn.invoice_no}</td>
                  <td>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      txn.type === 'sale' ? 'bg-blue-600 text-white' :
                      txn.type === 'salex' ? 'bg-purple-600 text-white' :
                      'bg-green-600 text-white'
                    }`}>
                      {txn.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-slate-300">{txn.customer_vendor_name}</td>
                  <td className="text-slate-300 font-semibold">₹{txn.total?.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{txn.formattedDate}</td>
                  <td className="text-slate-300 max-w-xs truncate" title={txn.notes}>
                    {txn.notes || 'N/A'}
                  </td>
                  <td>
                    <Link
                      href={`/${txn.type === 'purchase' ? 'purchases' : txn.type}/view/${txn.id}`}
                      title="View Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {transactions.length === 0 && !loading && (
            <div className="text-center py-12 text-slate-400">
              <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">
                {notesSearch
                  ? 'No transactions found with the specified notes.'
                  : 'Enter text to search in transaction notes.'
                }
              </p>
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page === 1}
              className="btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <div className="flex space-x-2">
              {pagination.page > 3 && (
                <>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: 1 }))}
                    className="px-3 py-1 rounded hover:bg-slate-700"
                  >
                    1
                  </button>
                  <span>...</span>
                </>
              )}
              {getPageNumbers().map(p => (
                <button
                  key={p}
                  onClick={() => setPagination(prev => ({ ...prev, page: p }))}
                  className={`px-3 py-1 rounded ${
                    p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
              {pagination.page < pagination.totalPages - 2 && (
                <>
                  <span>...</span>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: pagination.totalPages }))}
                    className="px-3 py-1 rounded hover:bg-slate-700"
                  >
                    {pagination.totalPages}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page === pagination.totalPages}
              className="btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
