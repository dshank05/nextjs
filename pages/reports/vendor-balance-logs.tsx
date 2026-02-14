import { useState, useEffect } from 'react';
import { FileText, TrendingUp, TrendingDown } from 'lucide-react';
import { SearchableSelect } from '../../components/common';

interface BalanceLog {
  id: number;
  vendor_name: string;
  column_name: string;
  change_amount: number;
  old_value: number;
  new_value: number;
  source_type: string;
  reference_no: string;
  created_at: string;
  notes: string;
}

export default function VendorBalanceLogsPage() {
  const [logs, setLogs] = useState<BalanceLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [currentBalance, setCurrentBalance] = useState<any>(null);

  // Fetch vendors on mount
  useEffect(() => {
    fetchVendors();
  }, []);

  // Fetch logs when filters change
  useEffect(() => {
    if (selectedVendor) {
      fetchLogs();
    }
  }, [selectedVendor, selectedColumn]);

  // Calculate balance whenever logs change
  useEffect(() => {
    fetchCurrentBalance();
  }, [logs]);

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

  const fetchCurrentBalance = async () => {
    // Fetch ACTUAL balance from vendor_details table in database
    if (!selectedVendor) {
      setCurrentBalance(null);
      return;
    }

    try {
      const response = await fetch(`/api/reports/vendor-balance-logs?vendor_id=${selectedVendor}&get_balance=true`);
      if (response.ok) {
        const data = await response.json();
        if (data.balance) {
          setCurrentBalance(data.balance);
        }
      }
    } catch (error) {
      console.error('Error fetching balance from DB:', error);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        vendor_id: selectedVendor,
        ...(selectedColumn && { column_name: selectedColumn })
      });

      const response = await fetch(`/api/reports/vendor-balance-logs?${params}`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.data);
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getColumnLabel = (column: string) => {
    const labels: Record<string, string> = {
      'total_paid': 'Total Paid',
      'total_allocated': 'Total Allocated',
      'total_refunded': 'Total Refunded',
      'total_refund_allocated': 'Refund Allocated'
    };
    return labels[column] || column;
  };

  const getSourceLabel = (source: string) => {
    return source.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Calculate checksum from logs and compare with DB
  const getChecksumComparison = () => {
    if (!currentBalance || logs.length === 0) return null;

    // Calculate sum of all changes for each column
    const logTotals = {
      total_paid: 0,
      total_allocated: 0,
      total_refunded: 0,
      total_refund_allocated: 0
    };

    logs.forEach(log => {
      if (log.column_name in logTotals) {
        // Sum up all changes to get final value
        logTotals[log.column_name as keyof typeof logTotals] += log.change_amount;
      }
    });

    // Compare with DB values
    const discrepancies = [];
    const columns = ['total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated'] as const;
    
    for (const col of columns) {
      const logValue = Math.abs(logTotals[col]);
      const dbValue = Math.abs(Number(currentBalance[col] || 0));
      const diff = Math.abs(logValue - dbValue);
      
      if (diff > 0.01) { // Allow for small rounding errors
        discrepancies.push({
          column: col,
          logValue,
          dbValue,
          diff
        });
      }
    }

    return discrepancies.length > 0 ? discrepancies : null;
  };

  const discrepancies = getChecksumComparison();

  return (
      <div className="space-y-6">
        <div className="card">
          {/* <h1 className="text-2xl font-bold mb-6">Vendor Balance Audit Log</h1> */}

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                onSelectionChange={(value) => setSelectedVendor(value || '')}
                placeholder="Select vendor..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Column (Optional)
              </label>
              <SearchableSelect
                options={[
                  { id: '', name: 'All Columns' },
                  { id: 'total_paid', name: 'Total Paid' },
                  { id: 'total_allocated', name: 'Total Allocated' },
                  { id: 'total_refunded', name: 'Total Refunded' },
                  { id: 'total_refund_allocated', name: 'Refund Allocated' }
                ]}
                selectedValue={selectedColumn}
                onSelectionChange={(value) => setSelectedColumn(value || '')}
                placeholder="All Columns"
              />
            </div>
          </div>

          {/* Current Balance Summary */}
          {selectedVendor && currentBalance && (
            <div className="mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
              <h3 className="text-sm font-medium text-slate-300 mb-3">MASTER TABLE VALUES (Real-Time)</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Total Paid</div>
                  <div className="text-lg font-bold text-white">₹{Number(currentBalance.total_paid || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Total Allocated</div>
                  <div className="text-lg font-bold text-white">₹{Number(currentBalance.total_allocated || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Total Refunded</div>
                  <div className="text-lg font-bold text-white">₹{Number(currentBalance.total_refunded || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Refund Allocated</div>
                  <div className="text-lg font-bold text-white">₹{Number(currentBalance.total_refund_allocated || 0).toFixed(2)}</div>
                </div>
              </div>

              {/* Discrepancy Warning */}
              {discrepancies && discrepancies.length > 0 && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-600 rounded-lg">
                  <div className="text-red-400 font-semibold mb-2">⚠️ DISCREPANCY DETECTED</div>
                  <div className="text-xs text-red-300 space-y-1">
                    {discrepancies.map((disc, idx) => (
                      <div key={idx}>
                        <span className="font-medium">{getColumnLabel(disc.column)}:</span> Log sum = ₹{disc.logValue.toFixed(2)}, DB value = ₹{disc.dbValue.toFixed(2)} (diff: ₹{disc.diff.toFixed(2)})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Table - All 4 Columns Together */}
          {selectedVendor && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th className="text-right">Total Paid</th>
                    <th className="text-right">Total Allocated</th>
                    <th className="text-right">Total Refunded</th>
                    <th className="text-right">Refund Allocated</th>
                    <th>Source</th>
                    <th>Reference</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Group logs by timestamp + source + reference
                    const grouped = logs.reduce((acc, log) => {
                      const key = `${log.created_at}-${log.source_type}-${log.reference_no}`;
                      if (!acc[key]) {
                        acc[key] = {
                          created_at: log.created_at,
                          source_type: log.source_type,
                          reference_no: log.reference_no,
                          notes: log.notes,
                          columns: {
                            total_paid: null,
                            total_allocated: null,
                            total_refunded: null,
                            total_refund_allocated: null
                          }
                        };
                      }
                      acc[key].columns[log.column_name as keyof typeof acc[string]['columns']] = {
                        change: log.change_amount,
                        old: log.old_value,
                        new: log.new_value
                      };
                      return acc;
                    }, {} as Record<string, any>);

                    return Object.values(grouped).map((group: any, idx) => (
                      <tr key={idx}>
                        <td className="text-slate-300">
                          {new Date(group.created_at).toLocaleString('en-IN')}
                        </td>
                        
                        {/* Total Paid - Simplified */}
                        <td className="text-right">
                          {group.columns.total_paid ? (
                            <span className={group.columns.total_paid.change > 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                              {group.columns.total_paid.change > 0 ? '+' : '-'}₹{Math.abs(group.columns.total_paid.change).toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>

                        {/* Total Allocated - Simplified */}
                        <td className="text-right">
                          {group.columns.total_allocated ? (
                            <span className={group.columns.total_allocated.change > 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                              {group.columns.total_allocated.change > 0 ? '+' : '-'}₹{Math.abs(group.columns.total_allocated.change).toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>

                        {/* Total Refunded - Simplified */}
                        <td className="text-right">
                          {group.columns.total_refunded ? (
                            <span className={group.columns.total_refunded.change > 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                              {group.columns.total_refunded.change > 0 ? '+' : '-'}₹{Math.abs(group.columns.total_refunded.change).toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>

                        {/* Refund Allocated - Simplified */}
                        <td className="text-right">
                          {group.columns.total_refund_allocated ? (
                            <span className={group.columns.total_refund_allocated.change > 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                              {group.columns.total_refund_allocated.change > 0 ? '+' : '-'}₹{Math.abs(group.columns.total_refund_allocated.change).toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>

                        <td className="text-slate-300">
                          {getSourceLabel(group.source_type)}
                        </td>
                        <td className="font-medium text-white">
                          {group.reference_no || '-'}
                        </td>
                        <td className="text-slate-400 text-sm">
                          {group.notes || '-'}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>

              {logs.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">
                  No balance changes found for this vendor.
                </div>
              )}
            </div>
          )}

          {!selectedVendor && (
            <div className="text-center py-12 text-slate-400">
              <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Please select a vendor to view balance audit log</p>
            </div>
          )}
        </div>
      </div>
  );
}
