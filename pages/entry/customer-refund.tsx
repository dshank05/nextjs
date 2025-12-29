import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Receipt, Calculator, CheckCircle, AlertCircle, Plus, Minus } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

interface Customer {
  id: string;
  billing_name: string;
  total_pending_refund?: number;
}

interface PendingReturn {
  id: number;
  return_no: string;
  type: 'sale' | 'salex';
  refund_amount: number;
  outstanding_refund: number;
}

interface RefundAllocation {
  return_id: number;
  sale_return_id?: number;
  salex_return_id?: number;
  return_no: string;
  type: 'sale' | 'salex';
  total_refund: number;
  outstanding_refund: number;
  allocated_amount: number;
  notes?: string;
}

export default function CustomerRefundPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // State management
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [allocations, setAllocations] = useState<RefundAllocation[]>([]);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMode, setRefundMode] = useState(1); // 0=Cash, 1=Bank
  const [refundDate, setRefundDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load customers on mount
  useEffect(() => {
    loadCustomers();
  }, []);

  // Load pending returns when customer changes
  useEffect(() => {
    if (selectedCustomer) {
      loadPendingReturns(selectedCustomer.id);
    } else {
      setPendingReturns([]);
      setAllocations([]);
    }
  }, [selectedCustomer]);

  const loadCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      } else {
        throw new Error('Failed to load customers');
      }
    } catch (error) {
      console.error('Error loading customers:', error);
      showSnackbar('error', 'Failed to load customers');
    }
  };

  const loadPendingReturns = async (customerId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/pending-refunds`);
      if (response.ok) {
        const data = await response.json();
        setPendingReturns(data.pending_returns || []);

        // Initialize allocations with zero amounts
        const initialAllocations = (data.pending_returns || []).map(pendingReturn => ({
          return_id: pendingReturn.id,
          sale_return_id: pendingReturn.type === 'sale' ? pendingReturn.id : undefined,
          salex_return_id: pendingReturn.type === 'salex' ? pendingReturn.id : undefined,
          return_no: pendingReturn.return_no,
          type: pendingReturn.type,
          total_refund: pendingReturn.refund_amount,
          outstanding_refund: pendingReturn.outstanding_refund,
          allocated_amount: 0,
          notes: ''
        }));
        setAllocations(initialAllocations);
      } else {
        throw new Error('Failed to load pending returns');
      }
    } catch (error) {
      console.error('Error loading pending returns:', error);
      showSnackbar('error', 'Failed to load pending returns');
      setPendingReturns([]);
      setAllocations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerSelect = (customerId: string | null) => {
    if (!customerId) {
      setSelectedCustomer(null);
      return;
    }

    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setSelectedCustomer(customer);
    }
  };

  const updateAllocation = (index: number, amount: number) => {
    const validatedAmount = Math.max(0, Math.min(amount, allocations[index].outstanding_refund));

    setAllocations(prev => {
      const newAllocations = [...prev];
      newAllocations[index] = {
        ...newAllocations[index],
        allocated_amount: validatedAmount
      };
      return newAllocations;
    });
  };

  const autoAllocate = () => {
    const amount = parseFloat(refundAmount) || 0;
    if (amount <= 0) {
      showSnackbar('warning', 'Please enter a refund amount first');
      return;
    }

    let remainingAmount = amount;

    setAllocations(prev => {
      const newAllocations = [...prev];

      // Sort by outstanding refund amount (highest first)
      const sortedIndices = newAllocations
        .map((alloc, index) => ({ alloc, index }))
        .sort((a, b) => b.alloc.outstanding_refund - a.alloc.outstanding_refund)
        .map(item => item.index);

      // Allocate amount starting from highest outstanding refund
      for (const index of sortedIndices) {
        if (remainingAmount <= 0) break;

        const outstanding = newAllocations[index].outstanding_refund;
        const allocateAmount = Math.min(remainingAmount, outstanding);

        newAllocations[index] = {
          ...newAllocations[index],
          allocated_amount: allocateAmount
        };

        remainingAmount -= allocateAmount;
      }

      return newAllocations;
    });
  };

  const clearAllocations = () => {
    setAllocations(prev => prev.map(alloc => ({
      ...alloc,
      allocated_amount: 0
    })));
  };

  // Calculate totals
  const allocationSummary = useMemo(() => {
    const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.allocated_amount, 0);
    const refundAmountNum = parseFloat(refundAmount) || 0;
    const remainingToAllocate = Math.max(0, refundAmountNum - totalAllocated);
    const totalPendingRefund = pendingReturns.reduce((sum, ret) => sum + ret.outstanding_refund, 0);

    return {
      totalAllocated,
      refundAmount: refundAmountNum,
      remainingToAllocate,
      totalPendingRefund,
      isOverAllocated: totalAllocated > refundAmountNum,
      isUnderAllocated: totalAllocated < refundAmountNum && totalAllocated > 0
    };
  }, [allocations, refundAmount]);

  const handleProcessRefund = () => {
    if (!selectedCustomer) {
      showSnackbar('warning', 'Please select a customer');
      return;
    }

    if (allocationSummary.totalAllocated === 0) {
      showSnackbar('warning', 'Please allocate refund amounts to returns');
      return;
    }

    if (allocationSummary.isOverAllocated) {
      showSnackbar('error', 'Total allocated amount exceeds refund amount');
      return;
    }

    setShowConfirmModal(true);
  };

  const confirmProcessRefund = async () => {
    setProcessing(true);
    try {
      // Prepare allocation data for API
      const allocationData = allocations
        .filter(alloc => alloc.allocated_amount > 0)
        .map(alloc => ({
          return_id: alloc.return_id,
          allocated_amount: alloc.allocated_amount,
          notes: alloc.notes || undefined
        }));

      const refundData = {
        customer_id: selectedCustomer.id,
        refund_amount: parseFloat(refundAmount),
        refund_mode: refundMode,
        refund_date: Math.floor(new Date(refundDate).getTime() / 1000),
        notes: notes || undefined,
        allocations: allocationData
      };

      const response = await fetch('/api/customer-refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(refundData)
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Refund processed successfully! Refund #${result.data.refund.id}`);

        // Reset form
        setSelectedCustomer(null);
        setRefundAmount('');
        setNotes('');
        setAllocations([]);
        setPendingReturns([]);
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to process refund');
      }
    } catch (error) {
      console.error('Error processing refund:', error);
      showSnackbar('error', 'Network error occurred while processing refund');
    } finally {
      setProcessing(false);
      setShowConfirmModal(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
            <Receipt className="w-6 h-6" />
            Customer Refund Processing
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Process customer refunds and allocate across multiple returns
          </p>
        </div>
      </div>

      {/* Main Card */}
      <div className="card">
        <div className="p-6">
          {/* Customer Selection */}
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Select Customer *
                </label>
                <SearchableSelect
                  options={customers.map(c => ({
                    id: c.id,
                    name: `${c.billing_name}${c.total_pending_refund ? ` (Pending Refund: ₹${c.total_pending_refund.toLocaleString()})` : ''}`
                  }))}
                  selectedValue={selectedCustomer?.id || null}
                  onSelectionChange={handleCustomerSelect}
                  placeholder="Select customer..."
                  className="w-full"
                />
              </div>

              {selectedCustomer && (
                <div className="bg-slate-700 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-2">Customer Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400">Name</p>
                      <p className="text-white font-medium">{selectedCustomer.billing_name}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Pending Refund</p>
                      <p className="text-green-400 font-medium">
                        ₹{pendingReturns.reduce((sum, ret) => sum + ret.outstanding_refund, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Refund Details */}
          {selectedCustomer && (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Refund Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Refund Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Refund Mode
                  </label>
                  <SearchableSelect
                    options={[
                      { id: '0', name: 'Cash' },
                      { id: '1', name: 'Bank' }
                    ]}
                    selectedValue={refundMode.toString()}
                    onSelectionChange={(value) => setRefundMode(parseInt(value || '1'))}
                    placeholder="Select mode..."
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Refund Date
                  </label>
                  <input
                    type="date"
                    value={refundDate}
                    onChange={(e) => setRefundDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={autoAllocate}
                    disabled={!refundAmount || parseFloat(refundAmount) <= 0}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    <Calculator className="w-4 h-4" />
                    Auto Allocate
                  </button>
                </div>
              </div>

              {/* Allocation Summary */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-700 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Refund Amount</p>
                  <p className="text-white font-medium">₹{allocationSummary.refundAmount.toLocaleString()}</p>
                </div>
                <div className="bg-slate-700 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Total Allocated</p>
                  <p className={`font-medium ${allocationSummary.isOverAllocated ? 'text-red-400' : 'text-green-400'}`}>
                    ₹{allocationSummary.totalAllocated.toLocaleString()}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Remaining</p>
                  <p className={`font-medium ${allocationSummary.remainingToAllocate > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    ₹{allocationSummary.remainingToAllocate.toLocaleString()}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-3 text-center">
                  <p className="text-slate-400 text-xs">Status</p>
                  <div className="flex items-center justify-center gap-1">
                    {allocationSummary.isOverAllocated ? (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-400" />
                        <span className="text-red-400 text-xs">Over-allocated</span>
                      </>
                    ) : allocationSummary.totalAllocated === allocationSummary.refundAmount ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-green-400 text-xs">Fully allocated</span>
                      </>
                    ) : (
                      <>
                        <Minus className="w-4 h-4 text-yellow-400" />
                        <span className="text-yellow-400 text-xs">Partial</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pending Returns & Allocation */}
          {selectedCustomer && pendingReturns.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-slate-200">
                  Pending Returns ({pendingReturns.length})
                </h3>
                <button
                  onClick={clearAllocations}
                  className="text-sm text-slate-400 hover:text-slate-300"
                >
                  Clear All Allocations
                </button>
              </div>

              <div className="space-y-3">
                {allocations.map((allocation, index) => (
                  <div key={index} className="border border-slate-600 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h4 className="font-medium text-slate-200">
                            Return #{allocation.return_no}
                          </h4>
                          <span className={`px-2 py-1 text-xs rounded ${
                            allocation.type === 'sale'
                              ? 'bg-blue-900 text-blue-300'
                              : 'bg-purple-900 text-purple-300'
                          }`}>
                            {allocation.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-slate-400">Total Refund</p>
                            <p className="text-white">₹{allocation.total_refund.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-slate-400">Outstanding</p>
                            <p className="text-green-400">₹{allocation.outstanding_refund.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-slate-400">Allocated</p>
                            <p className="text-blue-400 font-medium">₹{allocation.allocated_amount.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>

                      <div className="ml-4">
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Allocate Amount
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={allocation.outstanding_refund}
                          value={allocation.allocated_amount || ''}
                          onChange={(e) => updateAllocation(index, parseFloat(e.target.value) || 0)}
                          className="input w-32 text-center"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {selectedCustomer && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Refund Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="Optional notes about this refund..."
              />
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center py-8">
              <div className="animate-pulse">
                <div className="h-4 bg-slate-700 rounded mb-2"></div>
                <div className="h-4 bg-slate-700 rounded w-3/4 mx-auto"></div>
              </div>
            </div>
          )}

          {/* No Data State */}
          {selectedCustomer && !loading && pendingReturns.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              No pending refunds found for this customer
            </div>
          )}

          {/* Action Buttons */}
          {selectedCustomer && pendingReturns.length > 0 && (
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => router.push('/entry')}
                className="px-6 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProcessRefund}
                disabled={allocationSummary.totalAllocated === 0 || allocationSummary.isOverAllocated}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors flex items-center gap-2"
              >
                <Receipt className="w-4 h-4" />
                Process Refund
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Confirm Refund Processing"
        message={`Process refund of ₹${allocationSummary.refundAmount.toLocaleString()} allocated across ${allocations.filter(a => a.allocated_amount > 0).length} return(s)?`}
        confirmText="Process Refund"
        cancelText="Cancel"
        showLoading={processing}
        loadingText="Processing Refund..."
        onConfirm={confirmProcessRefund}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
