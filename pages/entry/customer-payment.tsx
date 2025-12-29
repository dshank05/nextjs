import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { CreditCard, Calculator, CheckCircle, AlertCircle, Plus, Minus } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

interface Customer {
  id: string;
  billing_name: string;
  total_outstanding?: number;
}

interface OutstandingInvoice {
  id: number;
  invoice_no: string;
  type: 'sale' | 'salex';
  total: number;
  outstanding: number;
  due_date?: number;
}

interface PaymentAllocation {
  invoice_id?: number;
  invoicex_id?: number;
  invoice_no: string;
  type: 'sale' | 'salex';
  total_amount: number;
  outstanding_amount: number;
  allocated_amount: number;
  notes?: string;
}

export default function CustomerPaymentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // State management
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoice[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState(1); // 0=Cash, 1=Bank
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load customers on mount
  useEffect(() => {
    loadCustomers();
  }, []);

  // Load outstanding invoices when customer changes
  useEffect(() => {
    if (selectedCustomer) {
      loadOutstandingInvoices(selectedCustomer.id);
    } else {
      setOutstandingInvoices([]);
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

  const loadOutstandingInvoices = async (customerId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/outstanding`);
      if (response.ok) {
        const data = await response.json();
        setOutstandingInvoices(data.outstanding_invoices || []);

        // Initialize allocations with zero amounts
        const initialAllocations = (data.outstanding_invoices || []).map(invoice => ({
          invoice_id: invoice.type === 'sale' ? invoice.id : undefined,
          invoicex_id: invoice.type === 'salex' ? invoice.id : undefined,
          invoice_no: invoice.invoice_no,
          type: invoice.type,
          total_amount: invoice.total,
          outstanding_amount: invoice.outstanding,
          allocated_amount: 0,
          notes: ''
        }));
        setAllocations(initialAllocations);
      } else {
        throw new Error('Failed to load outstanding invoices');
      }
    } catch (error) {
      console.error('Error loading outstanding invoices:', error);
      showSnackbar('error', 'Failed to load outstanding invoices');
      setOutstandingInvoices([]);
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
    const validatedAmount = Math.max(0, Math.min(amount, allocations[index].outstanding_amount));

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
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      showSnackbar('warning', 'Please enter a payment amount first');
      return;
    }

    let remainingAmount = amount;

    setAllocations(prev => {
      const newAllocations = [...prev];

      // Sort by outstanding amount (oldest/highest first)
      const sortedIndices = newAllocations
        .map((alloc, index) => ({ alloc, index }))
        .sort((a, b) => b.alloc.outstanding_amount - a.alloc.outstanding_amount)
        .map(item => item.index);

      // Allocate amount starting from highest outstanding
      for (const index of sortedIndices) {
        if (remainingAmount <= 0) break;

        const outstanding = newAllocations[index].outstanding_amount;
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
    const paymentAmountNum = parseFloat(paymentAmount) || 0;
    const remainingToAllocate = Math.max(0, paymentAmountNum - totalAllocated);
    const totalOutstanding = outstandingInvoices.reduce((sum, inv) => sum + inv.outstanding, 0);

    return {
      totalAllocated,
      paymentAmount: paymentAmountNum,
      remainingToAllocate,
      totalOutstanding,
      isOverAllocated: totalAllocated > paymentAmountNum,
      isUnderAllocated: totalAllocated < paymentAmountNum && totalAllocated > 0
    };
  }, [allocations, paymentAmount]);

  const handleProcessPayment = () => {
    if (!selectedCustomer) {
      showSnackbar('warning', 'Please select a customer');
      return;
    }

    if (allocationSummary.totalAllocated === 0) {
      showSnackbar('warning', 'Please allocate payment amounts to invoices');
      return;
    }

    if (allocationSummary.isOverAllocated) {
      showSnackbar('error', 'Total allocated amount exceeds payment amount');
      return;
    }

    setShowConfirmModal(true);
  };

  const confirmProcessPayment = async () => {
    setProcessing(true);
    try {
      // Prepare allocation data for API
      const allocationData = allocations
        .filter(alloc => alloc.allocated_amount > 0)
        .map(alloc => ({
          invoice_id: alloc.invoice_id,
          invoicex_id: alloc.invoicex_id,
          allocated_amount: alloc.allocated_amount,
          notes: alloc.notes || undefined
        }));

      const paymentData = {
        customer_id: selectedCustomer.id,
        payment_amount: parseFloat(paymentAmount),
        payment_mode: paymentMode,
        payment_date: Math.floor(new Date(paymentDate).getTime() / 1000),
        notes: notes || undefined,
        allocations: allocationData
      };

      const response = await fetch('/api/customer-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData)
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Payment recorded successfully! Payment #${result.data.payment.id}`);

        // Reset form
        setSelectedCustomer(null);
        setPaymentAmount('');
        setNotes('');
        setAllocations([]);
        setOutstandingInvoices([]);
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to process payment');
      }
    } catch (error) {
      console.error('Error processing payment:', error);
      showSnackbar('error', 'Network error occurred while processing payment');
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
            <CreditCard className="w-6 h-6" />
            Customer Payment Allocation
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Record customer payments and allocate across multiple invoices
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
                    name: `${c.billing_name}${c.total_outstanding ? ` (Outstanding: ₹${c.total_outstanding.toLocaleString()})` : ''}`
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
                      <p className="text-slate-400">Total Outstanding</p>
                      <p className="text-yellow-400 font-medium">
                        ₹{outstandingInvoices.reduce((sum, inv) => sum + inv.outstanding, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Payment Details */}
          {selectedCustomer && (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Payment Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Payment Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Payment Mode
                  </label>
                  <SearchableSelect
                    options={[
                      { id: '0', name: 'Cash' },
                      { id: '1', name: 'Bank' }
                    ]}
                    selectedValue={paymentMode.toString()}
                    onSelectionChange={(value) => setPaymentMode(parseInt(value || '1'))}
                    placeholder="Select mode..."
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={autoAllocate}
                    disabled={!paymentAmount || parseFloat(paymentAmount) <= 0}
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
                  <p className="text-slate-400 text-xs">Payment Amount</p>
                  <p className="text-white font-medium">₹{allocationSummary.paymentAmount.toLocaleString()}</p>
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
                    ) : allocationSummary.totalAllocated === allocationSummary.paymentAmount ? (
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

          {/* Outstanding Invoices & Allocation */}
          {selectedCustomer && outstandingInvoices.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-slate-200">
                  Outstanding Invoices ({outstandingInvoices.length})
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
                            Invoice #{allocation.invoice_no}
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
                            <p className="text-slate-400">Total Amount</p>
                            <p className="text-white">₹{allocation.total_amount.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-slate-400">Outstanding</p>
                            <p className="text-yellow-400">₹{allocation.outstanding_amount.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-slate-400">Allocated</p>
                            <p className="text-green-400 font-medium">₹{allocation.allocated_amount.toLocaleString()}</p>
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
                          max={allocation.outstanding_amount}
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
                Payment Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="Optional notes about this payment..."
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
          {selectedCustomer && !loading && outstandingInvoices.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              No outstanding invoices found for this customer
            </div>
          )}

          {/* Action Buttons */}
          {selectedCustomer && outstandingInvoices.length > 0 && (
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
                onClick={handleProcessPayment}
                disabled={allocationSummary.totalAllocated === 0 || allocationSummary.isOverAllocated}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors flex items-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                Process Payment
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Confirm Payment Processing"
        message={`Process payment of ₹${allocationSummary.paymentAmount.toLocaleString()} allocated across ${allocations.filter(a => a.allocated_amount > 0).length} invoice(s)?`}
        confirmText="Process Payment"
        cancelText="Cancel"
        showLoading={processing}
        loadingText="Processing Payment..."
        onConfirm={confirmProcessPayment}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
