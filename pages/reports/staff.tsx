import { useState, useEffect } from 'react';
import { DateRangeFilter, ExportMenu, SearchableSelect } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';

interface StaffSaleRecord {
  type: string;
  reference_no: string;
  date: number;
  customer_name: string;
  staff_name: string;
  total_amount: number;
  commission: number;
  formattedDate: string;
}

export default function StaffSalesReport() {
  const [data, setData] = useState<StaffSaleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [summary, setSummary] = useState<any>(null);
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    transactionType: 'all',
    staffId: ''
  });
  const [staff, setStaff] = useState<any[]>([]);

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    fetchData();
  }, [pagination.page, filters]);

  const fetchStaff = async () => {
    try {
      const response = await fetch('/api/staff');
      if (response.ok) {
        const data = await response.json();
        setStaff([
          { id: '', name: 'All Staff' },
          ...data.staff.map((s: any) => ({
            id: s.id.toString(),
            name: s.name
          }))
        ]);
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };



  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...filters
      });

      const response = await fetch(`/api/reports/staff-sales?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result.data);
        setSummary(result.summary);
        setPagination(result.pagination);
      }
    } catch (error) {
      console.error('Error fetching staff sales report:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      transactionType: 'all',
      staffId: ''
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Staff Sales Report</h2>
          <ExportMenu
            data={data}
            columns={[
              { key: 'type', label: 'Type', enabled: true },
              { key: 'reference_no', label: 'Reference', enabled: true },
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'customer_name', label: 'Customer', enabled: true },
              { key: 'staff_name', label: 'Staff', enabled: true },
              { key: 'total_amount', label: 'Total Amount', enabled: true },
              { key: 'commission', label: 'Commission', enabled: true }
            ]}
            config={{
              title: 'Staff Sales Report',
              fileName: `Staff_Sales_Report_${getLocalDateString()}`
            }}
          />
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Total Sales</div>
              <div className="text-2xl font-bold text-white">₹{summary.total_sales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Total Transactions</div>
              <div className="text-2xl font-bold text-white">{summary.total_transactions}</div>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Total Commission</div>
              <div className="text-2xl font-bold text-white">₹{summary.total_commission.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
            <DateRangeFilter
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onDateChange={(start, end) => setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }))}
              placeholder="Select date range..."
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
              selectedValue={filters.transactionType}
              onSelectionChange={(value) => setFilters(prev => ({ ...prev, transactionType: value || 'all' }))}
              placeholder="Select type..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Staff</label>
            <SearchableSelect
              options={staff}
              selectedValue={filters.staffId}
              onSelectionChange={(value) => setFilters(prev => ({ ...prev, staffId: value || '' }))}
              placeholder="Select staff..."
            />
          </div>

          <div className="flex items-end">
            <button onClick={clearFilters} className="btn-secondary px-4 py-2">
              Clear Filters
            </button>
          </div>
        </div>

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
                <th>Type</th>
                <th>Reference</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Staff</th>
                <th className="text-right">Total Amount</th>
                <th className="text-right">Commission</th>
              </tr>
            </thead>
            <tbody>
              {data.map((record, idx) => (
                <tr key={idx}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td>
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      record.type === 'Sale' ? 'bg-green-600' :
                      record.type === 'Salex' ? 'bg-blue-600' :
                      'bg-purple-600'
                    } text-white`}>
                      {record.type}
                    </span>
                  </td>
                  <td className="font-medium text-white">{record.reference_no}</td>
                  <td className="text-slate-300">{record.formattedDate}</td>
                  <td className="text-slate-300">{record.customer_name}</td>
                  <td className="text-slate-300">{record.staff_name}</td>
                  <td className="text-right font-semibold text-white">₹{record.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right text-green-400">₹{record.commission.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              No staff sales found with the current filters.
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
            <div className="text-sm text-slate-400">
              Page {pagination.page} of {pagination.totalPages}
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
