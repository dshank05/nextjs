import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ClearableInput, ExportMenu } from '../../components/common';

interface DebitNote {
  id: number;
  debit_note_no: string;
  return_date: number;
  vendor_id: number;
  vendor_name: string;
  purchase_id: number;
  total_amount: number;
  total_tax: number;
  packing_forwarding_amount: number;
  freight_amount: number;
  refund_amount: number;
  payment_status: number;
  payment_mode: number;
  payment_date?: number;
  notes?: string;
  fy: number;
  item_count: number;
  formattedDate: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type SortField = 'debit_note_no' | 'vendor_name' | 'refund_amount' | 'return_date' | 'payment_status';
type SortOrder = 'asc' | 'desc';

export default function DebitNotesReport() {
  const router = useRouter();
  const [debitNotes, setDebitNotes] = useState<DebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    vendorFilter: '',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    paymentStatus: 'all'
  });

  // Sorting states
  const [sortBy, setSortBy] = useState<SortField>('return_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  useEffect(() => {
    fetchDebitNotes();
  }, [pagination.page, searchTerm, filters, sortBy, sortOrder]);

  const fetchDebitNotes = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        vendorFilter: filters.vendorFilter,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        paymentStatus: filters.paymentStatus,
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      const response = await fetch(`/api/reports/debit-notes?${params}`);
      if (response.ok) {
        const data = await response.json();
        setDebitNotes(data.debitNotes || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching debit notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    const newSortOrder = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';
    setSortBy(field);
    setSortOrder(newSortOrder);
  };

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilters({
      vendorFilter: '',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      paymentStatus: 'all'
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getPaymentStatusBadge = (status: number) => {
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
    } else {
      return <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Unpaid</span>;
    }
  };

  const getPaymentModeText = (mode: number) => {
    return mode === 0 ? 'Cash' : 'Bank';
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card bg-blue-900/20 border-blue-700/50">
          <div className="text-center">
            <div className="text-3xl mb-2">📄</div>
            <div className="text-2xl font-bold text-white">{pagination.total}</div>
            <div className="text-sm text-slate-400">Total Debit Notes</div>
          </div>
        </div>
        <div className="card bg-green-900/20 border-green-700/50">
          <div className="text-center">
            <div className="text-3xl mb-2">💰</div>
            <div className="text-2xl font-bold text-white">
              ₹{debitNotes.reduce((sum, dn) => sum + dn.refund_amount, 0).toLocaleString('en-IN')}
            </div>
            <div className="text-sm text-slate-400">Total Refund Amount</div>
          </div>
        </div>
        <div className="card bg-orange-900/20 border-orange-700/50">
          <div className="text-center">
            <div className="text-3xl mb-2">⏳</div>
            <div className="text-2xl font-bold text-white">
              {debitNotes.filter(dn => dn.payment_status === 0).length}
            </div>
            <div className="text-sm text-slate-400">Pending Payments</div>
          </div>
        </div>
        <div className="card bg-purple-900/20 border-purple-700/50">
          <div className="text-center">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-2xl font-bold text-white">
              {debitNotes.filter(dn => dn.payment_status === 1).length}
            </div>
            <div className="text-sm text-slate-400">Completed Payments</div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="card">
        {/* Export Menu */}
        <div className="flex items-center justify-end gap-2 mb-4">
          <ExportMenu
            data={debitNotes}
            columns={[
              { key: 'id', label: 'ID', enabled: true },
              { key: 'debit_note_no', label: 'Debit Note No', enabled: true },
              { key: 'vendor_name', label: 'Vendor Name', enabled: true },
              { key: 'item_count', label: 'Items Count', enabled: true },
              { key: 'total_amount', label: 'Total Amount', enabled: true },
              { key: 'total_tax', label: 'Tax Amount', enabled: true },
              { key: 'refund_amount', label: 'Refund Amount', enabled: true },
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'payment_status', label: 'Payment Status', enabled: true },
              { key: 'notes', label: 'Notes', enabled: true }
            ]}
            config={{
              title: 'Debit Notes Report',
              fileName: `Debit_Notes_Report_${new Date().toISOString().split('T')[0]}`
            }}
          />
        </div>

        {/* Filters Section */}
        <div className="grid grid-cols-6 gap-4 mb-4">
          {/* Debit Note No Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Debit Note No</label>
            <ClearableInput
              type="text"
              placeholder="Enter debit note no"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Vendor Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
            <ClearableInput
              type="text"
              placeholder="Filter by vendor"
              value={filters.vendorFilter}
              onChange={(e) => setFilters(prev => ({ ...prev, vendorFilter: e.target.value }))}
            />
          </div>

          {/* Amount Min Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Min Amount</label>
            <ClearableInput
              type="number"
              placeholder="Min amount"
              value={filters.amountMin}
              onChange={(e) => setFilters(prev => ({ ...prev, amountMin: e.target.value }))}
              min="0"
            />
          </div>

          {/* Amount Max Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount</label>
            <ClearableInput
              type="number"
              placeholder="Max amount"
              value={filters.amountMax}
              onChange={(e) => setFilters(prev => ({ ...prev, amountMax: e.target.value }))}
              min="0"
            />
          </div>

          {/* Date Range Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onDateChange={(start, end) => setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }))}
              placeholder="Select date range..."
            />
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn-secondary px-4 py-2"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Pagination Info */}
        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {debitNotes.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} debit notes
            </div>
            <div>Page {pagination.page} of {pagination.totalPages}</div>
          </div>
        )}

        {/* Table Section */}
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
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('debit_note_no')}>
                  Debit Note No {getSortIcon('debit_note_no')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('vendor_name')}>
                  Vendor {getSortIcon('vendor_name')}
                </th>
                <th>Items</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('refund_amount')}>
                  Refund Amount {getSortIcon('refund_amount')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('return_date')}>
                  Date {getSortIcon('return_date')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_status')}>
                  Payment {getSortIcon('payment_status')}
                </th>
                <th>Mode</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {debitNotes.map((note, idx) => (
                <tr key={note.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{note.debit_note_no}</td>
                  <td className="text-slate-300">{note.vendor_name}</td>
                  <td className="text-slate-300">
                    <div className="flex items-center gap-1">
                      <span>{note.item_count}</span>
                      <span className="text-xs text-slate-400">items</span>
                    </div>
                  </td>
                  <td className="text-slate-300 font-semibold">₹{note.refund_amount.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{note.formattedDate}</td>
                  <td>{getPaymentStatusBadge(note.payment_status)}</td>
                  <td className="text-slate-300">{getPaymentModeText(note.payment_mode)}</td>
                  <td>
                    <Link
                      href={`/entry/purchasereturn-vendor/${note.id}`}
                      title="View Debit Note Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {debitNotes.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm || filters.vendorFilter || filters.dateFrom || filters.dateTo
                ? 'No debit notes found with the current filters.'
                : 'No debit notes found'
              }
            </div>
          )}
        </div>

        {/* Pagination */}
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
