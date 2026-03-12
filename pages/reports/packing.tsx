import { useState, useEffect } from 'react';
import { DateRangeFilter, ClearableInput, ExportMenu, SearchableSelect } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';

interface PackingForwardingRecord {
  type: string;
  reference_no: string;
  date: number;
  party_name: string;
  qty: number;
  rate: number;
  pf_amount: number;
  total_amount: number;
  formattedDate: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function PackingForwardingReport() {
  const [data, setData] = useState<PackingForwardingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
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
    customerId: '',
    vendorId: ''
  });
  const [customers, setCustomers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  useEffect(() => {
    fetchCustomers();
    fetchVendors();
  }, []);

  useEffect(() => {
    fetchData();
  }, [pagination.page, filters]);

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers([
          { id: '', name: 'All Customers' },
          ...data.customers.map((c: any) => ({
            id: c.id.toString(),
            name: c.billing_name || c.name
          }))
        ]);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendors([
          { id: '', name: 'All Vendors' },
          ...data.vendors.map((v: any) => ({
            id: v.id.toString(),
            name: v.vendor_name
          }))
        ]);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
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

      const response = await fetch(`/api/reports/packing-forwarding?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result.data);
        setSummary(result.summary);
        setPagination(result.pagination);
      }
    } catch (error) {
      console.error('Error fetching packing/forwarding report:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      transactionType: 'all',
      customerId: '',
      vendorId: ''
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Packing & Forwarding Report</h2>
          <ExportMenu
            data={data}
            columns={[
              { key: 'type', label: 'Type', enabled: true },
              { key: 'reference_no', label: 'Reference', enabled: true },
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'party_name', label: 'Party Name', enabled: true },
              { key: 'qty', label: 'Quantity', enabled: true },
              { key: 'rate', label: 'Rate', enabled: true },
              { key: 'pf_amount', label: 'P/F Amount', enabled: true },
              { key: 'total_amount', label: 'Total Amount', enabled: true }
            ]}
            config={{
              title: 'Packing & Forwarding Report',
              fileName: `Packing_Forwarding_Report_${getLocalDateString()}`
            }}
          />
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Total P/F Charges</div>
              <div className="text-2xl font-bold text-white">₹{summary.total_pf.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Total Transactions</div>
              <div className="text-2xl font-bold text-white">{summary.total_transactions}</div>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="text-sm text-slate-400 mb-1">Average P/F</div>
              <div className="text-2xl font-bold text-white">₹{summary.avg_pf.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-4 mb-4">
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
            <label className="block text-sm font-medium text-slate-300 mb-2">Customer</label>
            <SearchableSelect
              options={customers}
              selectedValue={filters.customerId}
              onSelectionChange={(value) => setFilters(prev => ({ ...prev, customerId: value || '' }))}
              placeholder="Select customer..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
            <SearchableSelect
              options={vendors}
              selectedValue={filters.vendorId}
              onSelectionChange={(value) => setFilters(prev => ({ ...prev, vendorId: value || '' }))}
              placeholder="Select vendor..."
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
                <th>Party Name</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Rate</th>
                <th className="text-right">P/F Amount</th>
                <th className="text-right">Total Amount</th>
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
                  <td className="text-slate-300">{record.party_name}</td>
                  <td className="text-right text-slate-300">{record.qty.toFixed(2)}</td>
                  <td className="text-right text-slate-300">₹{record.rate.toFixed(2)}</td>
                  <td className="text-right font-semibold text-white">₹{record.pf_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right text-slate-300">₹{record.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              No packing/forwarding charges found with the current filters.
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
