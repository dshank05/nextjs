import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { ClearableInput, ExportMenu } from '../../components/common';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { getLocalDateString } from '../../lib/date-utils';

interface Purchase {
  id: number;
  invoice_no: number;
  bill_reference: string;
  vendor_name: string;
  total: number;
  invoice_date: number;
  payment_status: number;
  formattedDate: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function BillReferencePurchase() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  const [billRefSearch, setBillRefSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    fetchPurchases();
  }, [pagination.page, billRefSearch, dateFrom, dateTo]);

  const fetchPurchases = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        billReference: billRefSearch,
        dateFrom,
        dateTo
      });

      const response = await fetch(`/api/reports/bill-reference-purchase?${params}`);
      if (response.ok) {
        const data = await response.json();
        setPurchases(data.purchases || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching purchases:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setBillRefSearch('');
    setDateFrom('');
    setDateTo('');
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
        <h1 className="text-2xl font-bold text-white mb-6">Purchase Bill Reference Report</h1>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Bill Reference</label>
            <ClearableInput
              type="text"
              placeholder="Search by bill reference..."
              value={billRefSearch}
              onChange={(e) => setBillRefSearch(e.target.value)}
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
              Clear Filters
            </button>
            <ExportMenu
              data={purchases}
              columns={[
                { key: 'invoice_no', label: 'Invoice No', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
                { key: 'vendor_name', label: 'Vendor Name', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true }
              ]}
              config={{
                title: 'Purchase Bill Reference Report',
                fileName: `Purchase_Bill_Reference_${getLocalDateString()}`
              }}
            />
          </div>
        </div>

        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {purchases.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} purchases
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
                <th>Bill Reference</th>
                <th>Vendor Name</th>
                <th>Total Amount</th>
                <th>Date</th>
                <th>Payment Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase, idx) => (
                <tr key={purchase.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{purchase.invoice_no}</td>
                  <td className="text-blue-400 font-medium">{purchase.bill_reference || 'N/A'}</td>
                  <td className="text-slate-300">{purchase.vendor_name}</td>
                  <td className="text-slate-300 font-semibold">₹{purchase.total?.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{purchase.formattedDate}</td>
                  <td>{getPaymentStatusBadge(purchase.payment_status)}</td>
                  <td>
                    <Link
                      href={`/purchases/view/${purchase.id}`}
                      title="View Purchase Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {purchases.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {billRefSearch || dateFrom || dateTo
                ? 'No purchases found with the current filters.'
                : 'Enter a bill reference to search purchases.'
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
