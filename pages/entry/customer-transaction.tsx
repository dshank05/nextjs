import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle, Loader2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'
import { getLocalDateString } from '../../lib/date-utils'

interface OutstandingInvoice {
  id: number
  invoice_no: string
  type: 'sale' | 'salex'
  total: number
  outstanding: number
  allocated?: number
}

interface PendingReturn {
  id: number
  return_no: string
  type: 'sale' | 'salex'
  refund_amount: number
  outstanding_refund: number
  allocated?: number
}

interface Customer {
  id: string
  billing_name: string
}

type OperationType = 'INCOME' | 'EXPENSE' | ''

export default function CustomerTransactionEntry() {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<string>('')
  const [operationType, setOperationType] = useState<OperationType>('')
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoice[]>([])
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([])
  const [date, setDate] = useState<string>(getLocalDateString())
  const [mode, setMode] = useState<number>(1)
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [currentFY, setCurrentFY] = useState<number>(2024)
  const [error, setError] = useState<string>('')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)

  useEffect(() => {
    fetchCustomers()
    fetchCurrentFY()
  }, [])

  useEffect(() => {
    if (selectedCustomer && operationType) {
      if (operationType === 'INCOME') {
        fetchOutstandingInvoices(selectedCustomer)
        setPendingReturns([])
      } else if (operationType === 'EXPENSE') {
        fetchPendingReturns(selectedCustomer)
        setOutstandingInvoices([])
      }
    } else {
      setOutstandingInvoices([])
      setPendingReturns([])
    }
  }, [selectedCustomer, operationType])

  const fetchCustomers = async () => {
    try {
      const res = await fetch('/api/customers')
      const data = await res.json()
      setCustomers(data.customers || [])
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }

  const fetchCurrentFY = async () => {
    try {
      const res = await fetch('/api/financial-years')
      const data = await res.json()
      if (data.currentFyId) {
        setCurrentFY(data.currentFyId)
      }
    } catch (error) {
      console.error('Error fetching FY:', error)
    }
  }

  const fetchOutstandingInvoices = async (customerId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/customers/${customerId}/outstanding`)
      const data = await res.json()
      
      if (data.outstanding_invoices) {
        const invoices: OutstandingInvoice[] = data.outstanding_invoices.map((inv: any) => ({
          id: inv.id,
          invoice_no: inv.invoice_no,
          type: inv.type,
          total: inv.total,
          outstanding: inv.outstanding,
          allocated: 0
        }))
        
        setOutstandingInvoices(invoices)
      }
    } catch (error) {
      console.error('Error fetching outstanding invoices:', error)
      setError('Failed to load outstanding invoices')
    } finally {
      setLoading(false)
    }
  }

  const fetchPendingReturns = async (customerId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/customers/${customerId}/pending-refunds`)
      const data = await res.json()
      
      if (data.pending_returns) {
        const returns: PendingReturn[] = data.pending_returns.map((ret: any) => ({
          id: ret.id,
          return_no: ret.return_no,
          type: ret.type,
          refund_amount: ret.refund_amount,
          outstanding_refund: ret.outstanding_refund,
          allocated: 0
        }))
        
        setPendingReturns(returns)
      }
    } catch (error) {
      console.error('Error fetching pending returns:', error)
      setError('Failed to load pending returns')
    } finally {
      setLoading(false)
    }
  }

  const handleInvoiceAllocationChange = (id: number, value: string) => {
    const allocAmount = parseFloat(value) || 0
    setOutstandingInvoices(prev => prev.map(inv => 
      inv.id === id 
        ? { ...inv, allocated: allocAmount }
        : inv
    ))
  }

  const handleReturnAllocationChange = (id: number, value: string) => {
    const allocAmount = parseFloat(value) || 0
    setPendingReturns(prev => prev.map(ret => 
      ret.id === id 
        ? { ...ret, allocated: allocAmount }
        : ret
    ))
  }

  const handleAutoAllocate = () => {
    let remaining = parseFloat(amount) || 0
    
    if (operationType === 'INCOME') {
      const updated = outstandingInvoices.map(inv => {
        if (remaining <= 0) return { ...inv, allocated: 0 }
        const toAllocate = Math.min(remaining, inv.outstanding)
        remaining -= toAllocate
        return { ...inv, allocated: toAllocate }
      })
      setOutstandingInvoices(updated)
    } else if (operationType === 'EXPENSE') {
      const updated = pendingReturns.map(ret => {
        if (remaining <= 0) return { ...ret, allocated: 0 }
        const toAllocate = Math.min(remaining, ret.outstanding_refund)
        remaining -= toAllocate
        return { ...ret, allocated: toAllocate }
      })
      setPendingReturns(updated)
    }
  }

  const handleClearAllocations = () => {
    if (operationType === 'INCOME') {
      setOutstandingInvoices(prev => prev.map(inv => ({ ...inv, allocated: 0 })))
    } else if (operationType === 'EXPENSE') {
      setPendingReturns(prev => prev.map(ret => ({ ...ret, allocated: 0 })))
    }
  }

  const getTotalAllocated = () => {
    if (operationType === 'INCOME') {
      return outstandingInvoices.reduce((sum, inv) => sum + (inv.allocated || 0), 0)
    } else if (operationType === 'EXPENSE') {
      return pendingReturns.reduce((sum, ret) => sum + (ret.allocated || 0), 0)
    }
    return 0
  }

  const isRecordDisabled = (): boolean => {
    if (loading) return true
    if (!selectedCustomer) return true
    if (!operationType) return true
    if (!amount || parseFloat(amount) <= 0) return true
    
    const allocated = getTotalAllocated()
    if (allocated === 0) return true
    
    const amountNum = parseFloat(amount) || 0
    const difference = amountNum - allocated
    if (Math.abs(difference) > 0.01) return true
    
    return false
  }

  const handleRecordTransaction = () => {
    setError('')
    
    if (!selectedCustomer) {
      setError('Please select a customer')
      return
    }
    
    if (!operationType) {
      setError('Please select operation type')
      return
    }
    
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }
    
    const totalAllocated = getTotalAllocated()
    const amountNum = parseFloat(amount)
    
    if (Math.abs(totalAllocated - amountNum) > 0.01) {
      setError(`Total allocated (₹${totalAllocated.toFixed(2)}) must equal amount (₹${amountNum.toFixed(2)})`)
      return
    }
    
    const hasAllocations = operationType === 'INCOME' 
      ? outstandingInvoices.some(inv => inv.allocated && inv.allocated > 0)
      : pendingReturns.some(ret => ret.allocated && ret.allocated > 0)
    
    if (!hasAllocations) {
      setError('Please allocate amount to at least one item')
      return
    }

    setShowConfirmationModal(true)
  }

  const confirmRecordTransaction = async () => {
    setLoading(true)
    try {
      const amountNum = parseFloat(amount)
      // ✅ FIX: Set time to noon to avoid timezone issues with midnight UTC
      const dateObj = new Date(date)
      dateObj.setHours(12, 0, 0, 0)
      const timestamp = Math.floor(dateObj.getTime() / 1000)
      
      let endpoint = ''
      let payload: any = {}
      
      if (operationType === 'INCOME') {
        endpoint = '/api/customer-payments'
        const allocations = outstandingInvoices
          .filter(inv => inv.allocated && inv.allocated > 0)
          .map(inv => ({
            invoice_id: inv.type === 'sale' ? inv.id : undefined,
            invoicex_id: inv.type === 'salex' ? inv.id : undefined,
            allocated_amount: inv.allocated,
            notes: `Payment for Invoice ${inv.invoice_no}`
          }))
        
        payload = {
          customer_id: selectedCustomer,
          payment_amount: amountNum,
          payment_mode: mode,
          payment_date: timestamp,
          notes,
          allocations
        }
      } else {
        endpoint = '/api/customer-refunds'
        const allocations = pendingReturns
          .filter(ret => ret.allocated && ret.allocated > 0)
          .map(ret => ({
            return_id: ret.id,
            allocated_amount: ret.allocated,
            notes: `Refund for ${ret.return_no}`
          }))
        
        payload = {
          customer_id: selectedCustomer,
          refund_amount: amountNum,
          refund_mode: mode,
          refund_date: timestamp,
          notes,
          allocations
        }
      }
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        const transactionType = operationType === 'INCOME' ? 'Payment' : 'Refund'
        showSnackbar('success', `${transactionType} recorded successfully!`)
        
        // Reset form
        setSelectedCustomer('')
        setOperationType('')
        setOutstandingInvoices([])
        setPendingReturns([])
        setAmount('')
        setMode(1)
        setDate(getLocalDateString())
        setNotes('')
        setError('')
      } else {
        setError(data.error || data.message || 'Failed to record transaction')
      }
    } catch (error) {
      console.error('Error submitting transaction:', error)
      setError('Failed to record transaction')
    } finally {
      setLoading(false)
      setShowConfirmationModal(false)
    }
  }

  const totalAllocated = getTotalAllocated()
  const amountNum = parseFloat(amount) || 0
  const difference = amountNum - totalAllocated
  const outstandingItems = operationType === 'INCOME' ? outstandingInvoices : pendingReturns

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
              <DollarSign className="w-6 h-6" />
              Record Customer Transaction
            </h1>
          </div>

          {error && (
            <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Transaction Details */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-slate-200 mb-4">Transaction Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Customer <span className="text-red-400">*</span>
                </label>
                <SearchableSelect
                  options={customers.map(c => ({
                    id: c.id,
                    name: c.billing_name
                  }))}
                  selectedValue={selectedCustomer}
                  onSelectionChange={(value) => setSelectedCustomer(value || '')}
                  placeholder="Select customer..."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Operation Type <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-4 items-center h-10">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="operationType"
                      value="INCOME"
                      checked={operationType === 'INCOME'}
                      onChange={(e) => setOperationType(e.target.value as OperationType)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-slate-300">INCOME (Receive Payment)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="operationType"
                      value="EXPENSE"
                      checked={operationType === 'EXPENSE'}
                      onChange={(e) => setOperationType(e.target.value as OperationType)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-slate-300">EXPENSE (Give Refund)</span>
                  </label>
                </div>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Amount <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Mode <span className="text-red-400">*</span>
                  </label>
                  <SearchableSelect
                    options={[
                      { id: '1', name: 'Bank' },
                      { id: '0', name: 'Cash' }
                    ]}
                    selectedValue={mode.toString()}
                    onSelectionChange={(value) => setMode(parseInt(value || '1'))}
                    placeholder="Select mode..."
                    className="w-full"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input w-full"
                  placeholder="Additional notes..."
                />
              </div>
            </div>
          </div>

          {/* Allocation Section */}
          {selectedCustomer && operationType && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Allocate to {operationType === 'INCOME' ? 'Invoices' : 'Returns'}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleAutoAllocate}
                    className="btn-primary text-sm"
                    disabled={!amount || loading}
                  >
                    Auto Allocate
                  </button>
                  <button
                    onClick={handleClearAllocations}
                    className="btn-secondary text-sm"
                    disabled={loading}
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" />
                  <p>Loading outstanding {operationType === 'INCOME' ? 'invoices' : 'returns'}...</p>
                </div>
              ) : outstandingItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400">No outstanding {operationType === 'INCOME' ? 'invoices' : 'returns'} for this customer</div>
              ) : (
                <>
                  {(!amount || parseFloat(amount) <= 0) && (
                    <div className="mb-3 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3">
                      Please enter Amount above to enable allocation
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{operationType === 'INCOME' ? 'Invoice No' : 'Return No'}</th>
                          <th>Type</th>
                          <th className="text-right">{operationType === 'INCOME' ? 'Total' : 'Refund Amount'}</th>
                          <th className="text-right">Outstanding</th>
                          <th className="text-right">Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operationType === 'INCOME' ? (
                          outstandingInvoices.map(inv => (
                            <tr key={inv.id}>
                              <td>{inv.invoice_no}</td>
                              <td>
                                <span className={`px-2 py-1 text-xs rounded ${
                                  inv.type === 'sale' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'
                                }`}>
                                  {inv.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="text-right">₹{inv.total?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-green-400">
                                ₹{inv.outstanding?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={inv.allocated || ''}
                                  onChange={(e) => handleInvoiceAllocationChange(inv.id, e.target.value)}
                                  max={inv.outstanding}
                                  disabled={!amount || parseFloat(amount) <= 0}
                                  className="input w-24 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                                  placeholder="0"
                                />
                              </td>
                            </tr>
                          ))
                        ) : (
                          pendingReturns.map(ret => (
                            <tr key={ret.id}>
                              <td>{ret.return_no}</td>
                              <td>
                                <span className={`px-2 py-1 text-xs rounded ${
                                  ret.type === 'sale' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'
                                }`}>
                                  {ret.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="text-right">₹{ret.refund_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-green-400">
                                ₹{ret.outstanding_refund?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={ret.allocated || ''}
                                  onChange={(e) => handleReturnAllocationChange(ret.id, e.target.value)}
                                  max={ret.outstanding_refund}
                                  disabled={!amount || parseFloat(amount) <= 0}
                                  className="input w-24 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                                  placeholder="0"
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Summary */}
          {selectedCustomer && operationType && outstandingItems.length > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Transaction Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Amount</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Total Allocated</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{totalAllocated?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className={`bg-slate-700 rounded-lg p-4 ${Math.abs(difference) < 0.01 ? 'border-2 border-green-500' : 'border-2 border-red-500'}`}>
                  <p className="text-slate-400 text-sm mb-1">Difference</p>
                  <p className={`text-xl font-semibold ${Math.abs(difference) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                    ₹{Math.abs(difference)?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    {difference > 0.01 ? ' (Unallocated)' : difference < -0.01 ? ' (Over-allocated)' : ' '}
                    {Math.abs(difference) < 0.01 && <CheckCircle className="inline w-5 h-5 ml-2" />}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-4">
            <button
              onClick={() => router.back()}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={handleRecordTransaction}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={isRecordDisabled()}
            >
              {loading ? 'Recording...' : 'Record Transaction'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Confirm Transaction"
        message={`Record ${operationType === 'INCOME' ? 'payment' : 'refund'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${
          operationType === 'INCOME' 
            ? outstandingInvoices.filter(inv => inv.allocated && inv.allocated > 0).length 
            : pendingReturns.filter(ret => ret.allocated && ret.allocated > 0).length
        } ${operationType === 'INCOME' ? 'invoice(s)' : 'return(s)'}?`}
        confirmText="Record Transaction"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Recording Transaction..."
        onConfirm={confirmRecordTransaction}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  )
}
