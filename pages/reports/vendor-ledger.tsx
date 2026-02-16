import { useState, useEffect } from 'react';
import { FileText, Loader2, RefreshCw, Edit2, Check, X } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ExportMenu, SearchableSelect } from '../../components/common';
import { mergeLedgerEntries, recalculateBalance} from '../../lib/ledger-merge-utils';
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils';
import { useSnackbar } from '../../components/SnackbarProvider';

// ✅ Custom sessionStorage hook: Unique per tab, persists on refresh
// Fixed hydration issue by using useEffect to sync after mount
function useSessionStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [mounted, setMounted] = useState(false);

  // Hydration fix: Read from sessionStorage only after component mounts
  useEffect(() => {
    setMounted(true);
    try {
      const item = window.sessionStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(error);
    }
  }, [key]);

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}

interface LedgerEntry {
  id: number;
  date: number;
  formattedDate: string;
  particulars: string;
  voucherType: string;
  voucherNo: string;
  debit: number;
  credit: number;
  balance: number;
  remarks: string;
  paymentMode: number | null;
  transactionType: string;
  referenceType: string | null;
  referenceId: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Vendor {
  id: number;
  vendor_name: string;
}

export default function VendorLedgerPage() {
  const { showSnackbar } = useSnackbar();
  const [accountingEntries, setAccountingEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  // ✅ Filters with sessionStorage persistence (unique per tab, persists on refresh)
  const [selectedVendor, setSelectedVendor] = useSessionStorage<string>('vendor-ledger-vendor', '');
  const [dateFrom, setDateFrom] = useSessionStorage<string>('vendor-ledger-dateFrom', '');
  const [dateTo, setDateTo] = useSessionStorage<string>('vendor-ledger-dateTo', '');
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // ✅ NEW: Inline note editing state
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editedNote, setEditedNote] = useState<string>('');

  // Set default dates to current month on mount (only if no stored dates)
  useEffect(() => {
    // ✅ Only set defaults if no stored dates exist
    if (!dateFrom && !dateTo) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      setDateFrom(formatStartDateForAPI(firstDay));
      setDateTo(formatEndDateForAPI(lastDay));
    }
  }, []);

  // Fetch vendors on mount
  useEffect(() => {
    fetchVendors();
  }, []);

  // Fetch data when filters change
  useEffect(() => {
    if (selectedVendor) {
      fetchData();
    }
  }, [selectedVendor, dateFrom, dateTo, pagination.page]);

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendors(data.vendors || []);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchData = async () => {
    if (!selectedVendor) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        vendor_id: selectedVendor,
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      });

      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const response = await fetch(`/api/reports/vendor-ledger-accounting?${params}`);
      
      if (response.ok) {
        const data = await response.json();
        
        // ✅ Client-side merge: Merge adjustments, then recalculate balance (exactly like backend)
        const rawEntries = data.entries as LedgerEntry[];
        const mergedEntries = mergeLedgerEntries(rawEntries);
        const entriesWithBalance = recalculateBalance(mergedEntries);
        
        setAccountingEntries(entriesWithBalance);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching ledger data:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setSelectedVendor('');
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

  const selectedVendorName = vendors.find(v => v.id.toString() === selectedVendor)?.vendor_name || '';

  // ✅ NEW: Inline editing handlers
  const handleEditNote = (entryId: number, currentNote: string) => {
    setEditingNoteId(entryId);
    setEditedNote(currentNote || '');
  };

  const handleSaveNote = async (entryId: number) => {
    const oldNote = accountingEntries.find(e => e.id === entryId)?.remarks || '';
    
    if (editedNote === oldNote) {
      // No change, just cancel
      setEditingNoteId(null);
      return;
    }

    // ✅ OPTIMISTIC UPDATE: Save to UI immediately
    setAccountingEntries(prev =>
      prev.map(entry =>
        entry.id === entryId
          ? { ...entry, remarks: editedNote }
          : entry
      )
    );
    
    // Close edit mode immediately
    setEditingNoteId(null);

    // ✅ API call in background
    try {
      const response = await fetch(`/api/vendor-ledger/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editedNote })
      });

      if (!response.ok) throw new Error('Failed to update note');

      // Success - no snackbar needed, UI already updated
    } catch (error) {
      console.error('Failed to update note:', error);
      
      // ✅ Revert on error
      setAccountingEntries(prev =>
        prev.map(entry =>
          entry.id === entryId
            ? { ...entry, remarks: oldNote }
            : entry
        )
      );
      
      // Show error snackbar
      showSnackbar('error', 'Failed to save note. Please try again.', 3000);
    }
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditedNote('');
  };

  // Calculate summary totals
  const totalDebit = accountingEntries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredit = accountingEntries.reduce((sum, entry) => sum + entry.credit, 0);
  const openingBalance = accountingEntries.length > 0 ? accountingEntries[0].balance - accountingEntries[0].debit + accountingEntries[0].credit : 0;
  const closingBalance = accountingEntries.length > 0 ? accountingEntries[accountingEntries.length - 1].balance : 0;

  return (
    <div className="space-y-6">
      <div className="card">
        {/* Filters Section */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* Vendor Selector */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Vendor <span className="text-red-400">*</span>
            </label>
            <SearchableSelect
              options={vendors.map(v => ({
                id: v.id.toString(),
                name: v.vendor_name
              }))}
              selectedValue={selectedVendor}
              onSelectionChange={(value) => {
                setSelectedVendor(value || '');
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              placeholder="Select vendor..."
            />
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={dateFrom}
              endDate={dateTo}
              onDateChange={(start, end) => {
                setDateFrom(start);
                setDateTo(end);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              placeholder="Select date range..."
            />
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn-secondary px-4 py-2 w-full"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Export Menu and Refresh Button */}
        {selectedVendor && (
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-slate-400">
              {selectedVendorName && (
                <span className="font-medium text-white">Ledger for: {selectedVendorName}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchData()}
                disabled={loading}
                className="btn-secondary flex items-center gap-2 px-4 py-2"
                title="Refresh ledger data"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <ExportMenu
              data={accountingEntries}
              columns={[
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'particulars', label: 'Particulars', enabled: true },
                { key: 'voucherType', label: 'Voucher Type', enabled: true },
                { key: 'voucherNo', label: 'Voucher No', enabled: true },
                { key: 'debit', label: 'Debit (₹)', enabled: true },
                { key: 'credit', label: 'Credit (₹)', enabled: true },
                { key: 'balance', label: 'Balance (₹)', enabled: true },
                { key: 'remarks', label: 'Notes', enabled: true }
              ]}
              config={{
                title: `Vendor Ledger - ${selectedVendorName}`,
                fileName: `Vendor_Ledger_${selectedVendorName}_${getLocalDateString()}`
              }}
              />
            </div>
          </div>
        )}

        {/* Pagination Info */}
        {pagination && selectedVendor && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {accountingEntries.length} entries
            </div>
            <div>Page {pagination.page} of {pagination.totalPages}</div>
          </div>
        )}

        {/* Table Section */}
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <Loader2 className="w-16 h-16 animate-spin text-blue-500" />
            </div>
          )}

          {!selectedVendor ? (
            <div className="text-center py-12 text-slate-400">
              <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Please select a vendor to view ledger</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="text-center">Date</th>
                  <th className="text-center">Particulars</th>
                  <th className="text-center">Voucher Type</th>
                  <th className="text-center">Voucher No</th>
                  <th className="text-center">Debit (₹)</th>
                  <th className="text-center">Credit (₹)</th>
                  <th className="text-center">Balance (₹)</th>
                  <th className="text-center">Notes</th>
                </tr>
              </thead>
              <tbody>
                {accountingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-center text-slate-300">{entry.formattedDate}</td>
                    <td className="text-center text-slate-300">{entry.particulars}</td>
                    <td className="text-center text-slate-300">{entry.voucherType}</td>
                    <td className="text-center font-medium text-white">{entry.voucherNo}</td>
                    <td className="text-center text-slate-300 font-semibold">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="text-center text-slate-300 font-semibold">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className={`text-center font-semibold ${
                      entry.balance < 0 ? 'text-red-400' : 'text-green-400'
                    }`}>
                      ₹{Math.abs(entry.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-slate-300 text-sm">
                      {editingNoteId === entry.id ? (
                        /* Edit Mode: Input box with save/cancel */
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editedNote}
                            onChange={(e) => setEditedNote(e.target.value)}
                            className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                            placeholder="Enter notes..."
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveNote(entry.id);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <button
                            onClick={() => handleSaveNote(entry.id)}
                            className="p-1 text-green-400 hover:bg-green-900/30 rounded"
                            title="Save (Enter)"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1 text-red-400 hover:bg-red-900/30 rounded"
                            title="Cancel (Esc)"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        /* Display Mode: Show text with hover edit button */
                        <div className="flex items-center gap-2 group">
                          <span className="flex-1">
                            {entry.remarks || <span className="text-slate-500 italic">No notes</span>}
                          </span>
                          <button
                            onClick={() => handleEditNote(entry.id, entry.remarks)}
                            className="p-1 text-slate-400 hover:text-blue-400 hover:bg-blue-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit note"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedVendor && accountingEntries.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              No ledger entries found for the selected filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && selectedVendor && (
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

        {/* Summary Box - Bottom Right */}
        {selectedVendor && accountingEntries.length > 0 && (
          <div className="mt-6 flex justify-end">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 min-w-[300px]">
              <div className="text-sm space-y-2">
                <div className="flex justify-between gap-8">
                  <span className="text-slate-400">Opening Balance:</span>
                  <span className="font-semibold text-white">
                    ₹{Math.abs(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-400">Total Debit:</span>
                  <span className="font-semibold text-green-400">
                    ₹{totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-400">Total Credit:</span>
                  <span className="font-semibold text-red-400">
                    ₹{totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between gap-8 pt-2 border-t border-slate-600">
                  <span className="text-white font-medium">Closing Balance:</span>
                  <span className={`font-bold text-lg ${
                    closingBalance < 0 ? 'text-red-400' : 'text-green-400'
                  }`}>
                    ₹{Math.abs(closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
