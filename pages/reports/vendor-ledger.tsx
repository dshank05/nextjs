import { useState, useEffect } from 'react';
import { FileText, DollarSign, Loader2 } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ExportMenu, SearchableSelect } from '../../components/common';

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
  transactionType: string;
}

interface DetailEntry {
  date: number;
  formattedDate: string;
  type: string;
  refNo: string;
  billRef: string;
  amount: number;
  allocated: number;
  balance: number;
  paymentStatus?: number;
  paymentMode?: number;
  paymentType?: string;
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

type ViewType = 'accounting' | 'details';

export default function VendorLedgerPage() {
  const [activeView, setActiveView] = useState<ViewType>('accounting');
  const [accountingEntries, setAccountingEntries] = useState<LedgerEntry[]>([]);
  const [detailEntries, setDetailEntries] = useState<DetailEntry[]>([]);
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

  // Fetch vendors on mount
  useEffect(() => {
    fetchVendors();
  }, []);

  // Fetch data when filters change
  useEffect(() => {
    if (selectedVendor) {
      fetchData();
    }
  }, [selectedVendor, dateFrom, dateTo, pagination.page, activeView]);

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

      const endpoint = activeView === 'accounting'
        ? '/api/reports/vendor-ledger-accounting'
        : '/api/reports/vendor-ledger-details';

      const response = await fetch(`${endpoint}?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (activeView === 'accounting') {
          setAccountingEntries(data.entries || []);
        } else {
          setDetailEntries(data.entries || []);
        }
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

  const getPaymentStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial</span>;
      default: return null;
    }
  };

  const selectedVendorName = vendors.find(v => v.id.toString() === selectedVendor)?.vendor_name || '';

  return (
    <div className="space-y-6">
      <div className="card">
        {/* Button Group */}
        <div className="flex space-x-1 mb-6 bg-slate-800 p-1 rounded-lg">
          <button
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${
              activeView === 'accounting'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setActiveView('accounting')}
          >
            <div className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" />
              Accounting Ledger
            </div>
          </button>
          <button
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${
              activeView === 'details'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setActiveView('details')}
          >
            <div className="flex items-center justify-center gap-2">
              <DollarSign className="w-4 h-4" />
              Payment Details
            </div>
          </button>
        </div>

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
          <div className="md:col-span-2">
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
              data={activeView === 'accounting' ? accountingEntries : detailEntries}
              columns={
                activeView === 'accounting'
                  ? [
                      { key: 'formattedDate', label: 'Date', enabled: true },
                      { key: 'particulars', label: 'Particulars', enabled: true },
                      { key: 'voucherType', label: 'Voucher Type', enabled: true },
                      { key: 'voucherNo', label: 'Voucher No', enabled: true },
                      { key: 'debit', label: 'Debit (₹)', enabled: true },
                      { key: 'credit', label: 'Credit (₹)', enabled: true },
                      { key: 'balance', label: 'Balance (₹)', enabled: true },
                      { key: 'remarks', label: 'Remarks', enabled: true }
                    ]
                  : [
                      { key: 'formattedDate', label: 'Date', enabled: true },
                      { key: 'type', label: 'Type', enabled: true },
                      { key: 'refNo', label: 'Ref No', enabled: true },
                      { key: 'billRef', label: 'Bill Ref', enabled: true },
                      { key: 'amount', label: 'Amount (₹)', enabled: true },
                      { key: 'allocated', label: 'Allocated (₹)', enabled: true },
                      { key: 'balance', label: 'Balance (₹)', enabled: true }
                    ]
              }
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
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} entries
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
          ) : activeView === 'accounting' ? (
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
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {accountingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-slate-300">{entry.formattedDate}</td>
                    <td className="text-slate-300">{entry.particulars}</td>
                    <td className="text-slate-300">{entry.voucherType}</td>
                    <td className="font-medium text-white">{entry.voucherNo}</td>
                    <td className="text-right text-red-400 font-semibold">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="text-right text-green-400 font-semibold">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className={`text-right font-semibold ${entry.balance < 0 ? 'text-red-400' : entry.balance > 0 ? 'text-green-400' : 'text-slate-300'}`}>
                      ₹{Math.abs(entry.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-slate-400 text-sm">{entry.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Ref No</th>
                  <th>Bill Ref</th>
                  <th className="text-right">Amount (₹)</th>
                  <th className="text-right">Allocated (₹)</th>
                  <th className="text-right">Balance (₹)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detailEntries.map((entry, idx) => (
                  <tr key={idx}>
                    <td className="text-slate-300">{entry.formattedDate}</td>
                    <td className="text-slate-300">{entry.type}</td>
                    <td className="font-medium text-white">{entry.refNo}</td>
                    <td className="text-slate-300">{entry.billRef}</td>
                    <td className="text-right font-semibold text-white">
                      ₹{entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-right text-blue-400 font-semibold">
                      ₹{entry.allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`text-right font-semibold ${entry.balance > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                      ₹{entry.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td>
                      {entry.paymentStatus !== undefined && getPaymentStatusBadge(entry.paymentStatus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedVendor && (activeView === 'accounting' ? accountingEntries : detailEntries).length === 0 && !loading && (
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
      </div>
    </div>
  );
}
