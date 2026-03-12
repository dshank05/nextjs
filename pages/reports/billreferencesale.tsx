import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { ClearableInput, ExportMenu } from '../../components/common';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { getLocalDateString } from '../../lib/date-utils';

interface Sale {
  id: number;
  invoice_no: number;
  bill_reference: string;
  customer_name: string;
  total: number;
  invoice_date: number;
  payment_status: number;
  formattedDate: string;
  type: 'sale' | 'salex';
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function BillReferenceSale() {
  const [sales, setSales] = useState<Sale[]>([]);
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
    fetchSales();
  }, [pagination.page, billRefSearch, dateFrom, dateTo]);

  const fetchSales = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        billReference: billRefSearch,
        dateFrom,
        dateTo
      });

      const response = await fetch(`/api/reports/bill-reference-sale?${params}`);
      if (response.ok) {
        const data = await response.json();
        setSales(data.sales || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching sales:', error);
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
        <h1 className="text-2xl font-bold text-white mb-6">Sale Bill Reference Report</h1>

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
              data={sales}
              columns={[
                { key: 'invoice_no', label: 'Invoice No', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
                { key: 'customer_name', label: 'Customer Name', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'type', label: 'Type', enabled: true }
              ]}
              config={{
                title: 'Sale Bill Reference Report',
                fileName: `Sale_Bill_Reference_${getLocalDateString()}`
              }}
            />
          </div>
        </div>

        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>
              Showing {sales.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} sales
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
                <th>Customer Name</th>
                <th>Total Amount</th>
                <th>Date</th>
                <th>Type</th>
                <th>Payment Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale, idx) => (
                <tr key={`${sale.type}-${sale.id}`}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{sale.invoice_no}</td>
                  <td className="text-blue-400 font-medium">{sale.bill_reference || 'N/A'}</td>
                  <td className="text-slate-300">{sale.customer_name}</td>
                  <td className="text-slate-300 font-semibold">₹{sale.total?.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{sale.formattedDate}</td>
                  <td>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      sale.type === 'sale' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                    }`}>
                      {sale.type.toUpperCase()}
                    </span>
                  </td>
                  <td>{getPaymentStatusBadge(sale.payment_status)}</td>
                  <td>
                    <Link
                      href={`/${sale.type}/view/${sale.id}`}
                      title="View Sale Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sales.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {billRefSearch || dateFrom || dateTo
                ? 'No sales found with the current filters.'
                : 'Enter a bill reference to search sales.'
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
