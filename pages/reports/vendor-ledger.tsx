import { useState, useEffect } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ExportMenu, SearchableSelect } from '../../components/common';
import { mergeLedgerEntries, recalculateBalance } from '../../lib/ledger-merge-utils';

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
  const [accountingEntries, setAccountingEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  // Filters
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // Set default dates to current month on mount
  useEffect(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    setDateFrom(firstDay.toISOString().split('T')[0]);
    setDateTo(lastDay.toISOString().split('T')[0]);
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

        {/* Export Menu */}
        {selectedVendor && (
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-slate-400">
              {selectedVendorName && (
                <span className="font-medium text-white">Ledger for: {selectedVendorName}</span>
              )}
            </div>
            <ExportMenu
              data={accountingEntries}
              columns={[
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'particulars', label: 'Particulars', enabled: true },
                { key: 'voucherType', label: 'Voucher Type', enabled: true },
                { key: 'voucherNo', label: 'Voucher No', enabled: true },
                { key: 'debit', label: 'Debit (₹)', enabled: true },
                { key: 'credit', label: 'Credit (₹)', enabled: true },
                { key: 'balance', label: 'Balance (₹)', enabled: true }
              ]}
              config={{
                title: `Vendor Ledger - ${selectedVendorName}`,
                fileName: `Vendor_Ledger_${selectedVendorName}_${new Date().toISOString().split('T')[0]}`
              }}
            />
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
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Voucher Type</th>
                  <th>Voucher No</th>
                  <th className="text-right">Debit (₹)</th>
                  <th className="text-right">Credit (₹)</th>
                  <th className="text-right">Balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {accountingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-slate-300">{entry.formattedDate}</td>
                    <td className="text-slate-300">{entry.particulars}</td>
                    <td className="text-slate-300">{entry.voucherType}</td>
                    <td className="font-medium text-white">{entry.voucherNo}</td>
                    <td className="text-right text-slate-300 font-semibold">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="text-right text-slate-300 font-semibold">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="text-right font-semibold text-slate-300">
                      ₹{entry.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                  <span className="font-bold text-lg text-white">
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
