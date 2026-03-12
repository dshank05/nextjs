import { useState, useEffect, useMemo } from 'react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect, ExportMenu } from '../../components/common';
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils';
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Users, Package } from 'lucide-react';
import { useSalesReport } from '../../hooks/useReports';

export default function SaleReportPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportType, setReportType] = useState('sale');

  // Set default to current month
  useEffect(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    setDateFrom(formatStartDateForAPI(firstDay));
    setDateTo(formatEndDateForAPI(lastDay));
  }, []);

  // Use React Query hook
  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    reportType
  }), [dateFrom, dateTo, reportType]);

  const { data, isLoading: loading } = useSalesReport(filters);

  const summary = data?.summary || null;
  const topCustomers = data?.topCustomers || [];
  const topProducts = data?.topProducts || [];
  const dailySales = data?.dailySales || [];

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-6">Sales Report</h1>

        {/* Filters */}
        <div className="grid grid-cols-3 gap-4 mb-6">
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

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Report Type</label>
            <SearchableSelect
              options={[
                { id: 'both', name: 'All Sales (Sale + Salex)' },
                { id: 'sale', name: 'Sale Only' },
                { id: 'salex', name: 'Salex Only' }
              ]}
              selectedValue={reportType}
              onSelectionChange={(value) => setReportType(value || 'both')}
              placeholder="Select type..."
            />
          </div>

          <div className="flex items-end">
            <ExportMenu
              data={dailySales}
              columns={[
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total_sales', label: 'Total Sales', enabled: true },
                { key: 'total_revenue', label: 'Total Revenue', enabled: true }
              ]}
              config={{
                title: 'Sales Report',
                fileName: `Sales_Report_${getLocalDateString()}`
              }}
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Total Sales</span>
                  <ShoppingCart className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-white">{summary.totalSales}</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Total Revenue</span>
                  <DollarSign className="w-4 h-4 text-green-400" />
                </div>
                <div className="text-2xl font-bold text-white">₹{summary.totalRevenue.toLocaleString('en-IN')}</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Avg Order Value</span>
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold text-white">₹{summary.avgOrderValue.toLocaleString('en-IN')}</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Total Items</span>
                  <Package className="w-4 h-4 text-orange-400" />
                </div>
                <div className="text-2xl font-bold text-white">{summary.totalItems}</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Customers</span>
                  <Users className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-bold text-white">{summary.totalCustomers}</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-sm">Cash vs Bank</span>
                  <DollarSign className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="text-sm text-white">
                  <div>Cash: ₹{summary.cashSales.toLocaleString('en-IN')}</div>
                  <div>Bank: ₹{summary.bankSales.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            {/* Top Customers and Products */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="text-lg font-semibold text-white mb-4">Top 10 Customers</h3>
                <div className="space-y-2">
                  {topCustomers.slice(0, 10).map((customer, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">{idx + 1}. {customer.customer_name}</span>
                      <span className="text-white font-medium">₹{customer.total_revenue.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="text-lg font-semibold text-white mb-4">Top 10 Products</h3>
                <div className="space-y-2">
                  {topProducts.slice(0, 10).map((product, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">{idx + 1}. {product.product_name}</span>
                      <span className="text-white font-medium">{product.total_qty} units</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
