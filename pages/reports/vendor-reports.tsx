import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, FileText, DollarSign } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ClearableInput, ExportMenu, SearchableSelect } from '../../components/common';

interface OutstandingVendor {
  id: number;
  vendor_id: number;
  vendor_name: string;
  transaction_date: number;
  balance: number;
  last_transaction_type: string;
  reference_display: string;
  reference_url: string | null;
  reference_type: string;
  formattedDate: string;
  vendor: {
    vendor_name: string;
    contact_no: string;
    email: string;
    address: string;
    city: string;
    state: string;
    tax_id: string;
  } | null;
}

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

type ViewType = 'outstanding' | 'debit-notes';

export default function VendorLedgerPage() {
  const [activeView, setActiveView] = useState<ViewType>('outstanding');

  // Shared state for both views
  const [outstandingVendors, setOutstandingVendors] = useState<OutstandingVendor[]>([]);
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

  // Sorting states - different for each view since APIs have different capabilities
  const [sortBy, setSortBy] = useState<string>('balance');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Vendor options for dropdown
  const [vendorOptions, setVendorOptions] = useState<{ id: string; name: string }[]>([]);

  // Fetch vendor options on mount
  useEffect(() => {
    fetchVendorOptions();
  }, []);

  useEffect(() => {
    fetchData();
  }, [pagination.page, searchTerm, filters, sortBy, sortOrder, activeView]);

  const fetchVendorOptions = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendorOptions([
          { id: '', name: 'All Vendors' },
          ...data.vendors.map((vendor: any) => ({
            id: vendor.id.toString(),
            name: vendor.vendor_name || vendor.name || ''
          }))
        ]);
      }
    } catch (error) {
      console.error('Error fetching vendor options:', error);
    }
  };

  const fetchData = async () => {
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
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      if (activeView === 'debit-notes') {
        params.set('paymentStatus', filters.paymentStatus);
      }

      const endpoint = activeView === 'outstanding'
        ? '/api/reports/vendor-outstanding'
        : '/api/reports/debit-notes';

      const response = await fetch(`${endpoint}?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (activeView === 'outstanding') {
          setOutstandingVendors(data.outstandingVendors || []);
        } else {
          setDebitNotes(data.debitNotes || []);
        }
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
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
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
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
     

      <div className="card">
        {/* Button Group */}
        <div className="flex space-x-1 mb-6 bg-slate-800 p-1 rounded-lg">
          <button
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${
              activeView === 'outstanding'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setActiveView('outstanding')}
          >
            Outstanding Balances
          </button>
          <button
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${
              activeView === 'debit-notes'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setActiveView('debit-notes')}
          >
            Debit Notes
          </button>
        </div>

        {/* Export Menu */}
        <div className="flex items-center justify-end gap-2 mb-4">
          <ExportMenu
            data={activeView === 'outstanding' ? outstandingVendors : debitNotes}
            columns={
              activeView === 'outstanding'
                ? [
                    { key: 'vendor_name', label: 'Vendor Name', enabled: true },
                    { key: 'balance', label: 'Outstanding Amount', enabled: true },
                    { key: 'formattedDate', label: 'Last Transaction', enabled: true },
                    { key: 'last_transaction_type', label: 'Transaction Type', enabled: true },
                    { key: 'reference_display', label: 'Last Transaction Ref', enabled: true }
                  ]
                : [
                    { key: 'debit_note_no', label: 'Debit Note No', enabled: true },
                    { key: 'vendor_name', label: 'Vendor Name', enabled: true },
                    { key: 'refund_amount', label: 'Refund Amount', enabled: true },
                    { key: 'formattedDate', label: 'Date', enabled: true },
                    { key: 'payment_status', label: 'Payment Status', enabled: true },
                    { key: 'item_count', label: 'Items', enabled: true }
                  ]
            }
            config={{
              title: activeView === 'outstanding' ? 'Vendor Outstanding Report' : 'Debit Notes Report',
              fileName: `${activeView === 'outstanding' ? 'Vendor_Outstanding' : 'Debit_Notes'}_Report_${(() => {
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              })()}`
            }}
          />
        </div>

        {/* Filters Section */}
        <div className="grid grid-cols-6 gap-4 mb-4">
          {/* Search */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {activeView === 'outstanding' ? 'Search Vendors' : 'Search Debit Notes'}
            </label>
            <ClearableInput
              type="text"
              placeholder={activeView === 'outstanding' ? 'Search vendors...' : 'Search debit notes...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Vendor Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
            <SearchableSelect
              options={vendorOptions}
              selectedValue={filters.vendorFilter}
              onSelectionChange={(value) => {
                setFilters(prev => ({ ...prev, vendorFilter: value || '' }));
              }}
              placeholder="Select vendor..."
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
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} {activeView === 'outstanding' ? 'outstanding vendors' : 'debit notes'}
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

          {activeView === 'outstanding' ? (
            <table className="table">
              <thead>
                <tr>
                  <th>S.N</th>
                  <th>Vendor Name</th>
                  <th>Outstanding Amount</th>
                  <th>Last Transaction</th>
                  <th>Transaction Type</th>
                  <th>Last Transaction Ref</th>
                </tr>
              </thead>
              <tbody>
                {outstandingVendors.map((vendor, idx) => (
                  <tr key={vendor.id}>
                    <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                    <td className="font-medium text-white">{vendor.vendor_name}</td>
                    <td className="text-slate-300 font-semibold">₹{vendor.balance?.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300">{vendor.formattedDate}</td>
                    <td className="text-slate-300">{vendor.last_transaction_type}</td>
                    <td className="text-slate-300">
                      {vendor.reference_type === 'purchase' && vendor.reference_url ? (
                        <Link
                          href={vendor.reference_url}
                          className="text-blue-400 hover:text-blue-300 underline font-medium"
                        >
                          {vendor.reference_display}
                        </Link>
                      ) : vendor.reference_type === 'debit_note' && vendor.reference_url ? (
                        <Link
                          href={vendor.reference_url}
                          className="text-blue-400 hover:text-blue-300 underline font-medium"
                        >
                          {vendor.reference_display}
                        </Link>
                      ) : (
                        <span className="text-green-400 font-medium">
                          {vendor.reference_display}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>S.N</th>
                  <th>Debit Note No</th>
                  <th>Vendor Name</th>
                  <th>Refund Amount</th>
                  <th>Date</th>
                  <th>Payment Status</th>
                  <th>Items</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {debitNotes.map((note, idx) => (
                  <tr key={note.id}>
                    <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                    <td className="font-medium text-white">{note.debit_note_no}</td>
                    <td className="text-slate-300">{note.vendor_name}</td>
                    <td className="text-slate-300 font-semibold">₹{note.refund_amount?.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300">{note.formattedDate}</td>
                    <td>{getPaymentStatusBadge(note.payment_status)}</td>
                    <td className="text-slate-300">
                      <div className="flex items-center gap-1">
                        <span>{note.item_count}</span>
                        <span className="text-xs text-slate-400">items</span>
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/entry/purchasereturn-vendor/${note.id}`}
                        title="View Debit Note Details"
                        className="btn-icon text-slate-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(activeView === 'outstanding' ? outstandingVendors : debitNotes).length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm || filters.vendorFilter || filters.dateFrom || filters.dateTo
                ? `No ${activeView === 'outstanding' ? 'outstanding vendors' : 'debit notes'} found with the current filters.`
                : `No ${activeView === 'outstanding' ? 'outstanding vendors' : 'debit notes'} found.`
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
