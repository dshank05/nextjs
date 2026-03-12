import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ClearableInput, ExportMenu, SearchableSelect } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';

interface OutstandingCustomer {
  id: number;
  customer_id: number;
  customer_name: string;
  transaction_date: number;
  balance: number;
  last_transaction_type: string;
  reference_display: string;
  reference_url: string | null;
  reference_type: string;
  formattedDate: string;
}

interface CreditNote {
  id: number;
  credit_note_no: string;
  return_date: number;
  customer_id: number;
  customer_name: string;
  invoice_no: string;
  total_amount: number;
  refund_amount: number;
  payment_status: number;
  payment_mode: number;
  item_count: number;
  formattedDate: string;
  type: 'sale' | 'salex';
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ViewType = 'outstanding' | 'credit-notes';

export default function CustomerReportsPage() {
  const [activeView, setActiveView] = useState<ViewType>('outstanding');
  const [outstandingCustomers, setOutstandingCustomers] = useState<OutstandingCustomer[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    customerFilter: '',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    paymentStatus: 'all'
  });

  const [sortBy, setSortBy] = useState<string>('balance');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetchCustomerOptions();
  }, []);

  useEffect(() => {
    fetchData();
  }, [pagination.page, searchTerm, filters, sortBy, sortOrder, activeView]);

  const fetchCustomerOptions = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomerOptions([
          { id: '', name: 'All Customers' },
          ...data.customers.map((customer: any) => ({
            id: customer.id.toString(),
            name: customer.billing_name || customer.name || ''
          }))
        ]);
      }
    } catch (error) {
      console.error('Error fetching customer options:', error);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        customerFilter: filters.customerFilter,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      if (activeView === 'credit-notes') {
        params.set('paymentStatus', filters.paymentStatus);
      }

      const endpoint = activeView === 'outstanding'
        ? '/api/reports/customer-outstanding'
        : '/api/reports/credit-notes';

      const response = await fetch(`${endpoint}?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (activeView === 'outstanding') {
          setOutstandingCustomers(data.outstandingCustomers || []);
        } else {
          setCreditNotes(data.creditNotes || []);
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
      customerFilter: '',
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
      default: return <span className="px-2 py-1 bg-slate-600 text-white text-xs rounded-full">Unknown</span>;
    }
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
              activeView === 'credit-notes'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => setActiveView('credit-notes')}
          >
            Credit Notes
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 mb-4">
          <ExportMenu
            data={activeView === 'outstanding' ? outstandingCustomers : creditNotes}
            columns={
              activeView === 'outstanding'
                ? [
                    { key: 'customer_name', label: 'Customer Name', enabled: true },
                    { key: 'balance', label: 'Outstanding Amount', enabled: true },
                    { key: 'formattedDate', label: 'Last Transaction', enabled: true },
                    { key: 'last_transaction_type', label: 'Transaction Type', enabled: true },
                    { key: 'reference_display', label: 'Last Transaction Ref', enabled: true }
                  ]
                : [
                    { key: 'credit_note_no', label: 'Credit Note No', enabled: true },
                    { key: 'customer_name', label: 'Customer Name', enabled: true },
                    { key: 'refund_amount', label: 'Refund Amount', enabled: true },
                    { key: 'formattedDate', label: 'Date', enabled: true },
                    { key: 'payment_status', label: 'Payment Status', enabled: true },
                    { key: 'item_count', label: 'Items', enabled: true }
                  ]
            }
            config={{
              title: activeView === 'outstanding' ? 'Customer Outstanding Report' : 'Credit Notes Report',
              fileName: `${activeView === 'outstanding' ? 'Customer_Outstanding' : 'Credit_Notes'}_Report_${getLocalDateString()}`
            }}
          />
        </div>

        <div className="grid grid-cols-6 gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {activeView === 'outstanding' ? 'Search Customers' : 'Search Credit Notes'}
            </label>
            <ClearableInput
              type="text"
              placeholder={activeView === 'outstanding' ? 'Search customers...' : 'Search credit notes...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Customer</label>
            <SearchableSelect
              options={customerOptions}
              selectedValue={filters.customerFilter}
              onSelectionChange={(value) => {
                setFilters(prev => ({ ...prev, customerFilter: value || '' }));
              }}
              placeholder="Select customer..."
            />
          </div>

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

          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onDateChange={(start, end) => setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }))}
              placeholder="Select date range..."
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn-secondary px-4 py-2"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} {activeView === 'outstanding' ? 'outstanding customers' : 'credit notes'}
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

          {activeView === 'outstanding' ? (
            <table className="table">
              <thead>
                <tr>
                  <th>S.N</th>
                  <th>Customer Name</th>
                  <th>Outstanding Amount</th>
                  <th>Last Transaction</th>
                  <th>Transaction Type</th>
                  <th>Last Transaction Ref</th>
                </tr>
              </thead>
              <tbody>
                {outstandingCustomers.map((customer, idx) => (
                  <tr key={customer.id}>
                    <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                    <td className="font-medium text-white">{customer.customer_name}</td>
                    <td className="text-slate-300 font-semibold">₹{customer.balance?.toLocaleString('en-IN')}</td>
                    <td className="text-slate-300">{customer.formattedDate}</td>
                    <td className="text-slate-300">{customer.last_transaction_type}</td>
                    <td className="text-slate-300">
                      {customer.reference_url ? (
                        <Link
                          href={customer.reference_url}
                          className="text-blue-400 hover:text-blue-300 underline font-medium"
                        >
                          {customer.reference_display}
                        </Link>
                      ) : (
                        <span className="text-green-400 font-medium">
                          {customer.reference_display}
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
                  <th>Credit Note No</th>
                  <th>Customer Name</th>
                  <th>Invoice No</th>
                  <th>Refund Amount</th>
                  <th>Date</th>
                  <th>Payment Status</th>
                  <th>Items</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((note, idx) => (
                  <tr key={note.id}>
                    <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                    <td className="font-medium text-white">{note.credit_note_no}</td>
                    <td className="text-slate-300">{note.customer_name}</td>
                    <td className="text-slate-300">{note.invoice_no}</td>
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
                        href={`/entry/salereturn/${note.id}`}
                        title="View Credit Note Details"
                        className="btn-icon text-slate-300"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(activeView === 'outstanding' ? outstandingCustomers : creditNotes).length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm || filters.customerFilter || filters.dateFrom || filters.dateTo
                ? `No ${activeView === 'outstanding' ? 'outstanding customers' : 'credit notes'} found with the current filters.`
                : `No ${activeView === 'outstanding' ? 'outstanding customers' : 'credit notes'} found.`
              }
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
