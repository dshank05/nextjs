import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle, Loader2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'
import SessionStorageService from '../../lib/sessionStorage'
import { getLocalDateString, convertDateToTimestamp } from '../../lib/date-utils'
import { useVendors } from '../../hooks/useVendors'
import {
  useVendorTransaction,
  useOutstandingBills,
  useOutstandingReturns,
  useCurrentFY,
  useCreateVendorTransaction,
  useUpdateVendorTransaction
} from '../../hooks/useVendorTransactions'
import type { 
  OutstandingBill, 
  OutstandingReturn, 
  OperationType, 
  PaymentType 
} from '../../types/vendor-transactions'
import type { Vendor } from '../../types/vendors'

// ✅ Custom sessionStorage hook: Unique per tab, persists on refresh
function useSessionStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // Hydration fix: Read from sessionStorage only after component mounts
  useEffect(() => {
    try {
      const item = window.sessionStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(error);
    }
  }, [key]);

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}

export default function VendorTransactionEntry() {
  const router = useRouter()
  const { edit, type } = router.query
  const { showSnackbar } = useSnackbar()
  
  // Query hooks
  const { data: vendors = [], isLoading: loadingVendors } = useVendors()
  const { data: currentFY = 2024 } = useCurrentFY()
  
  // Mutation hooks
  const createTransaction = useCreateVendorTransaction()
  const updateTransaction = useUpdateVendorTransaction()
  
  const [selectedVendor, setSelectedVendor] = useSessionStorage<string>('vendor-transaction-vendor', '')
  const [operationType, setOperationType] = useState<OperationType>('')
  const [paymentType, setPaymentType] = useState<PaymentType>('BILL_SPECIFIC') // Default for EXPENSE
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([])
  const [outstandingReturns, setOutstandingReturns] = useState<OutstandingReturn[]>([])
  const [date, setDate] = useSessionStorage<string>('vendor-transaction-date', getLocalDateString())
  const [mode, setMode] = useState<number>(1)
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  
  // Edit mode
  const isEditMode = !!edit
  const [transactionId, setTransactionId] = useState<number>(0)
  const [isInitializing, setIsInitializing] = useState(false)
  
  // Fetch outstanding bills/returns based on vendor and operation type
  const vendorId = parseInt(selectedVendor) || undefined
  const shouldFetchBills = vendorId && operationType === 'EXPENSE' && !isInitializing
  const shouldFetchReturns = vendorId && operationType === 'INCOME' && !isInitializing
  
  const billsQuery = useOutstandingBills(shouldFetchBills ? vendorId : undefined)
  const returnsQuery = useOutstandingReturns(shouldFetchReturns ? vendorId : undefined)
  
  // Fetch transaction for edit mode
  const { data: editTransactionData } = useVendorTransaction(
    isEditMode ? (edit as string) : undefined,
    isEditMode ? (type as 'expense' | 'income') : undefined
  )

  // Initialize with current month date range (only if no stored dates)
  useEffect(() => {
    // ✅ Check sessionStorage directly to avoid overwriting saved values
    const storedDate = sessionStorage.getItem('vendor-transaction-date');
    
    // ✅ Only set defaults if no values exist in sessionStorage
    if (!storedDate && !date) {
      setDate(getLocalDateString())
    }
  }, []);
  
  // ✅ Cleanup sessionStorage on component unmount
  useEffect(() => {
    return () => {
      // Clear all vendor-transaction sessionStorage keys when leaving page
      sessionStorage.removeItem('vendor-transaction-vendor');
      sessionStorage.removeItem('vendor-transaction-date');
    };
  }, []);

  useEffect(() => {
    // Skip if initializing (during edit load)
    if (isInitializing) return
    
    const vendorId = parseInt(selectedVendor)
    if (vendorId > 0 && operationType) {
      if (operationType === 'EXPENSE') {
        // Bills will be fetched by query hook
        setOutstandingReturns([])
      } else if (operationType === 'INCOME') {
        // ✅ Auto-set DIRECT for INCOME
        setPaymentType('DIRECT')
        setOutstandingReturns([])
        setOutstandingBills([])
      }
    } else {
      setOutstandingBills([])
      setOutstandingReturns([])
    }
  }, [selectedVendor, operationType, isInitializing])
  
  // Update outstanding bills from query
  useEffect(() => {
    if (billsQuery.data && !isInitializing) {
      setOutstandingBills(billsQuery.data)
    }
  }, [billsQuery.data, isInitializing])
  
  // Update outstanding returns from query
  useEffect(() => {
    if (returnsQuery.data && !isInitializing) {
      setOutstandingReturns(returnsQuery.data)
    }
  }, [returnsQuery.data, isInitializing])
  
  // Load edit transaction data
  useEffect(() => {
    if (!isEditMode || !editTransactionData || !edit || !type) return
    
    setIsInitializing(true)
    const transaction = editTransactionData
    const isExpense = type === 'expense'
    
    // Set transaction ID
    setTransactionId(parseInt(edit as string))
    
    // Set vendor
    setSelectedVendor(transaction.vendor.id.toString())
    
    // Set operation type
    setOperationType(isExpense ? 'EXPENSE' : 'INCOME')
    
    // Set payment type
    const pType = isExpense ? transaction.payment_type : transaction.refund_type
    setPaymentType(pType as PaymentType)
    
    // Set amount
    const amt = isExpense ? transaction.payment_amount : transaction.refund_amount
    setAmount(amt?.toString() || '')
    
    // Set mode
    const payMode = isExpense ? transaction.payment_mode : transaction.refund_mode
    setMode(payMode || 1)
    
    // Set date
    const dateTimestamp = isExpense ? transaction.payment_date : transaction.refund_date
    if (dateTimestamp) {
      const dateObj = new Date(dateTimestamp * 1000)
      const formattedDate = dateObj.toLocaleDateString('en-IN')
      const [day, month, year] = formattedDate.split('/').map(n => n.padStart(2, '0'))
      setDate(`${year}-${month}-${day}`)
    }
    
    // Set notes
    setNotes(transaction.notes || '')
    
    // Load allocated bills/returns
    if (isExpense && transaction.allocations && transaction.allocations.length > 0) {
      const allocatedBills: OutstandingBill[] = transaction.allocations.map((alloc: any) => ({
        purchase_id: alloc.purchase_id,
        invoice_no: alloc.invoice_no,
        invoice_date: alloc.invoice_date,
        total_bill: alloc.purchase_total,
        total_paid: alloc.allocated_amount,
        outstanding_amount: Math.max(0, alloc.purchase_total - alloc.allocated_amount),
        payment_status: alloc.payment_status,
        allocated: alloc.allocated_amount,
        isInCurrentPayment: true
      }))
      
      // Merge with fresh bills from query
      if (billsQuery.data) {
        const allocatedIds = new Set(allocatedBills.map(b => b.purchase_id))
        const otherBills = billsQuery.data.filter(b => !allocatedIds.has(b.purchase_id))
        const billsToShow = [...allocatedBills, ...otherBills].filter(bill =>
          bill.isInCurrentPayment || bill.outstanding_amount > 0
        )
        setOutstandingBills(billsToShow)
      } else {
        setOutstandingBills(allocatedBills)
      }
    } else if (!isExpense && transaction.allocations && transaction.allocations.length > 0) {
      const allocatedReturns: OutstandingReturn[] = transaction.allocations.map((alloc: any) => ({
        return_id: alloc.return_id,
        return_no: alloc.return_no || `PR-${alloc.return_id}`,
        return_date: alloc.allocation_date,
        total_return: alloc.return_total || 0,
        total_refunded: alloc.allocated_amount,
        outstanding_refund: Math.max(0, (alloc.return_total || 0) - alloc.allocated_amount),
        payment_status: alloc.payment_status || 0,
        allocated: alloc.allocated_amount,
        isInCurrentPayment: true
      }))
      
      // Merge with fresh returns from query
      if (returnsQuery.data) {
        const allocatedIds = new Set(allocatedReturns.map(r => r.return_id))
        const otherReturns = returnsQuery.data.filter(r => !allocatedIds.has(r.return_id))
        const returnsToShow = [...allocatedReturns, ...otherReturns].filter(ret =>
          ret.isInCurrentPayment || ret.outstanding_refund > 0
        )
        setOutstandingReturns(returnsToShow)
      } else {
        setOutstandingReturns(allocatedReturns)
      }
    }
    
    // Clean up sessionStorage after use
    const module = isExpense ? 'vendor-payments' : 'vendor-refunds'
    SessionStorageService.remove(module, edit as string)
    
    setIsInitializing(false)
  }, [isEditMode, editTransactionData, edit, type, billsQuery.data, returnsQuery.data])

  const handleBillAllocationChange = (purchaseId: number, value: string) => {
    const allocAmount = parseFloat(value) || 0
    setOutstandingBills(prev => prev.map(bill => 
      bill.purchase_id === purchaseId 
        ? { ...bill, allocated: allocAmount }
        : bill
    ))
  }

  const handleReturnAllocationChange = (returnId: number, value: string) => {
    const allocAmount = parseFloat(value) || 0
    setOutstandingReturns(prev => prev.map(ret => 
      ret.return_id === returnId 
        ? { ...ret, allocated: allocAmount }
        : ret
    ))
  }

  const handleAutoAllocate = () => {
    let remaining = parseFloat(amount) || 0
    
    if (operationType === 'EXPENSE') {
      const updated = outstandingBills.map(bill => {
        if (remaining <= 0) return { ...bill, allocated: 0 }
        
        // ✅ FIX: In edit mode, bills in current payment can accept up to total_bill
        // Other bills can only accept up to outstanding_amount
        const maxAllocation = bill.isInCurrentPayment 
          ? bill.total_bill 
          : bill.outstanding_amount
        
        const toAllocate = Math.min(remaining, maxAllocation)
        remaining -= toAllocate
        return { ...bill, allocated: toAllocate }
      })
      setOutstandingBills(updated)
      
      // ✅ Show snackbar feedback
      const totalAllocated = updated.reduce((sum, b) => sum + (b.allocated || 0), 0)
      if (totalAllocated === 0) {
        showSnackbar('warning', 'No bills available for allocation. All bills are fully paid.')
      } else {
        showSnackbar('success', `Allocated ₹${totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })} to bills`)
      }
    } else if (operationType === 'INCOME') {
      const updated = outstandingReturns.map(ret => {
        if (remaining <= 0) return { ...ret, allocated: 0 }
        
        // ✅ FIX: Same logic for returns
        const maxAllocation = ret.isInCurrentPayment 
          ? ret.total_return 
          : ret.outstanding_refund
        
        const toAllocate = Math.min(remaining, maxAllocation)
        remaining -= toAllocate
        return { ...ret, allocated: toAllocate }
      })
      setOutstandingReturns(updated)
      
      // ✅ Show snackbar feedback
      const totalAllocated = updated.reduce((sum, r) => sum + (r.allocated || 0), 0)
      if (totalAllocated === 0) {
        showSnackbar('warning', 'No returns available for allocation. All returns are fully refunded.')
      } else {
        showSnackbar('success', `Allocated ₹${totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })} to returns`)
      }
    }
  }

  const handleClearAllocations = () => {
    if (operationType === 'EXPENSE') {
      setOutstandingBills(prev => prev.map(bill => ({ ...bill, allocated: 0 })))
    } else if (operationType === 'INCOME') {
      setOutstandingReturns(prev => prev.map(ret => ({ ...ret, allocated: 0 })))
    }
  }

  const getTotalAllocated = () => {
    if (operationType === 'EXPENSE') {
      return outstandingBills.reduce((sum, bill) => sum + (bill.allocated || 0), 0)
    } else if (operationType === 'INCOME') {
      return outstandingReturns.reduce((sum, ret) => sum + (ret.allocated || 0), 0)
    }
    return 0
  }

  const isRecordDisabled = (): boolean => {
    if (createTransaction.isPending || updateTransaction.isPending) return true
    if (!selectedVendor) return true
    if (!operationType) return true
    if (!amount || parseFloat(amount) <= 0) return true
    
    const allocated = getTotalAllocated()
    const amountNum = parseFloat(amount) || 0
    
    // DIRECT: No allocation needed
    if (paymentType === 'DIRECT') {
      return false
    }
    
    // BILL_SPECIFIC: Must allocate ALL
    if (paymentType === 'BILL_SPECIFIC') {
      // ✅ FIX: Check allocation against appropriate max per bill
      const hasOverAllocation = outstandingBills.some(bill => {
        const maxAllowedAllocation = bill.isInCurrentPayment 
          ? bill.total_bill           // Bills in current payment can reallocate up to full amount
          : bill.outstanding_amount   // Other bills limited to outstanding
        return (bill.allocated || 0) > maxAllowedAllocation
      })
      if (hasOverAllocation) return true
      
      if (allocated === 0) return true
      if (Math.abs(amountNum - allocated) > 0.01) return true
      return false
    }
    
    // MIXED: Must allocate SOME (but not more than amount)
    if (paymentType === 'MIXED') {
      if (allocated === 0) return true  // Must allocate at least something
      if (allocated > amountNum) return true  // Cannot over-allocate
      return false
    }
    
    return false
  }

  const handleRecordTransaction = () => {
    setError('')
    
    if (!selectedVendor) {
      setError('Please select a vendor')
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
    
    // DIRECT: No validation needed for allocations
    if (paymentType === 'DIRECT') {
      setShowConfirmationModal(true)
      return
    }
    
    const totalAllocated = getTotalAllocated()
    const amountNum = parseFloat(amount)
    
    // BILL_SPECIFIC: Must allocate ALL
    if (paymentType === 'BILL_SPECIFIC') {
      // ✅ FIX: Check for over-allocation against appropriate max per bill
      const overAllocatedBills = outstandingBills.filter(bill => {
        const maxAllowedAllocation = bill.isInCurrentPayment 
          ? bill.total_bill           // Bills in current payment can reallocate up to full amount
          : bill.outstanding_amount   // Other bills limited to outstanding
        return (bill.allocated || 0) > maxAllowedAllocation
      })
      
      if (overAllocatedBills.length > 0) {
        const billsList = overAllocatedBills.map(b => {
          const maxAllowed = b.isInCurrentPayment ? b.total_bill : b.outstanding_amount
          const limitType = b.isInCurrentPayment ? 'Total Bill' : 'Outstanding'
          return `Bill #${b.invoice_no} (${limitType}: ₹${maxAllowed.toLocaleString('en-IN')}, Trying to allocate: ₹${(b.allocated || 0).toLocaleString('en-IN')})`
        }).join(', ')
        setError(
          `Cannot allocate more than allowed amount. Over-allocated bills: ${billsList}. Options: 1) Reduce allocation, or 2) Switch to MIXED payment type.`
        )
        return
      }
      
      if (Math.abs(totalAllocated - amountNum) > 0.01) {
        setError(`Total allocated (₹${totalAllocated.toFixed(2)}) must equal amount (₹${amountNum.toFixed(2)})`)
        return
      }
    }
    
    // MIXED: Must allocate SOME (but can have unallocated)
    if (paymentType === 'MIXED') {
      if (totalAllocated === 0) {
        setError('Please allocate at least some amount to bills')
        return
      }
      if (totalAllocated > amountNum) {
        setError(`Cannot allocate more (₹${totalAllocated.toFixed(2)}) than payment amount (₹${amountNum.toFixed(2)})`)
        return
      }
    }
    
    // Check if allocations exist (only for BILL_SPECIFIC and MIXED types)
    if (paymentType === 'BILL_SPECIFIC' || paymentType === 'MIXED') {
      const hasAllocations = operationType === 'EXPENSE' 
        ? outstandingBills.some(b => b.allocated && b.allocated > 0)
        : outstandingReturns.some(r => r.allocated && r.allocated > 0)
      
      if (!hasAllocations) {
        setError('Please allocate amount to at least one item')
        return
      }
    }

    setShowConfirmationModal(true)
  }

  const confirmRecordTransaction = () => {
    const amountNum = parseFloat(amount)
    const timestamp = convertDateToTimestamp(date)
    
    const isExpense = operationType === 'EXPENSE'
    const allocations = paymentType === 'DIRECT' ? [] : isExpense
      ? outstandingBills
          .filter(bill => bill.allocated && bill.allocated > 0)
          .map(bill => ({
            purchase_id: bill.purchase_id,
            allocated_amount: bill.allocated,
            notes: `Payment for Invoice ${bill.invoice_no}`
          }))
      : outstandingReturns
          .filter(ret => ret.allocated && ret.allocated > 0)
          .map(ret => ({
            return_id: ret.return_id,
            allocated_amount: ret.allocated,
            notes: `Refund for ${ret.return_no}`
          }))
    
    const payload: any = {
      vendor_id: selectedVendor,
      notes,
      allocations,
      fy: currentFY
    }
    
    if (isExpense) {
      payload.payment_amount = amountNum
      payload.payment_mode = mode
      payload.payment_date = timestamp
      payload.payment_type = paymentType
    } else {
      payload.refund_amount = amountNum
      payload.refund_mode = mode
      payload.refund_date = timestamp
      payload.refund_type = paymentType === 'DIRECT' ? 'DIRECT' : 'RETURN_SPECIFIC'
    }
    
    if (isEditMode) {
      updateTransaction.mutate(
        { id: transactionId, payload, isExpense },
        {
          onSuccess: () => {
            const transactionType = isExpense ? 'Payment' : 'Refund'
            showSnackbar('success', `${transactionType} updated successfully!`)
            router.push(`/vendor-transactions/view/${transactionId}?type=${isExpense ? 'expense' : 'income'}`)
            setShowConfirmationModal(false)
          },
          onError: (error: Error) => {
            setError(error.message || 'Failed to update transaction')
            setShowConfirmationModal(false)
          }
        }
      )
    } else {
      createTransaction.mutate(payload, {
        onSuccess: (data) => {
          const transactionType = isExpense ? 'Payment' : 'Refund'
          showSnackbar('success', `${transactionType} recorded successfully!`)
          const createdId = data.data?.payment?.id || data.data?.refund?.id
          if (createdId) {
            router.push(`/vendor-transactions/view/${createdId}?type=${isExpense ? 'expense' : 'income'}`)
          }
          setShowConfirmationModal(false)
        },
        onError: (error: Error) => {
          setError(error.message || 'Failed to record transaction')
          setShowConfirmationModal(false)
        }
      })
    }
  }

  const totalAllocated = getTotalAllocated()
  const amountNum = parseFloat(amount) || 0
  const difference = amountNum - totalAllocated
  const outstandingItems = operationType === 'EXPENSE' ? outstandingBills : outstandingReturns

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
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
                      value="EXPENSE"
                      checked={operationType === 'EXPENSE'}
                      onChange={(e) => setOperationType(e.target.value as OperationType)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-slate-300">PAYMENT (Pay Vendor)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="operationType"
                      value="INCOME"
                      checked={operationType === 'INCOME'}
                      onChange={(e) => setOperationType(e.target.value as OperationType)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-slate-300">RECEIPT (Receive Refund)</span>
                  </label>
                </div>
              </div>

              {/* Payment Type Selection - Only show for EXPENSE */}
              {operationType === 'EXPENSE' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Payment Type <span className="text-red-400">*</span>
                  </label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="paymentType"
                        value="BILL_SPECIFIC"
                        checked={paymentType === 'BILL_SPECIFIC'}
                        onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <span className="text-slate-300 font-medium">Bill Specific</span>
                        <p className="text-xs text-slate-400">Allocate all to bills</p>
                      </div>
                    </label>
                    
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="paymentType"
                        value="MIXED"
                        checked={paymentType === 'MIXED'}
                        onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <span className="text-slate-300 font-medium">Mixed</span>
                        <p className="text-xs text-slate-400">Allocate some, keep rest as advance</p>
                      </div>
                    </label>
                    
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="paymentType"
                        value="DIRECT"
                        checked={paymentType === 'DIRECT'}
                        onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <span className="text-slate-300 font-medium">On Account</span>
                        <p className="text-xs text-slate-400">No allocation, all advance</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

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
                    Payment Mode <span className="text-red-400">*</span>
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
          {parseInt(selectedVendor) > 0 && operationType && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              {paymentType === 'DIRECT' ? (
                <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-6 text-center">
                  <DollarSign className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-blue-300 mb-2">On Account {operationType === 'EXPENSE' ? 'Payment' : 'Refund'}</h3>
                  <p className="text-slate-300">
                    {operationType === 'EXPENSE' 
                      ? `₹${amountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })} will be added as advance payment to vendor`
                      : `₹${amountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })} will be recorded as credit from vendor`
                    }
                  </p>
                  <p className="text-sm text-slate-400 mt-2">
                    {operationType === 'EXPENSE'
                      ? 'This creates a credit balance with the vendor that can be used for future purchases.'
                      : 'The vendor owes you this amount, which can offset future purchases.'
                    }
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Allocate to {operationType === 'EXPENSE' ? 'Bills' : 'Returns'}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAutoAllocate}
                        className="btn-primary text-sm"
                        disabled={!amount || billsQuery.isLoading || returnsQuery.isLoading}
                      >
                        Auto Allocate
                      </button>
                      <button
                        onClick={handleClearAllocations}
                        className="btn-secondary text-sm"
                        disabled={billsQuery.isLoading || returnsQuery.isLoading}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {billsQuery.isLoading || returnsQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-3" />
                      <p>Loading outstanding {operationType === 'EXPENSE' ? 'bills' : 'returns'}...</p>
                    </div>
                  ) : outstandingItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">No outstanding {operationType === 'EXPENSE' ? 'bills' : 'returns'} for this vendor</div>
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
                          <th>{operationType === 'EXPENSE' ? 'Invoice No' : 'Return No'}</th>
                          <th>Date</th>
                          <th className="text-right">{operationType === 'EXPENSE' ? 'Total Bill' : 'Total Return'}</th>
                          <th className="text-right">{operationType === 'EXPENSE' ? 'Paid' : 'Refunded'}</th>
                          <th className="text-right">Outstanding</th>
                          <th className="text-right">Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operationType === 'EXPENSE' ? (
                          outstandingBills.map(bill => (
                            <tr key={bill.purchase_id}>
                              <td>{bill.invoice_no}</td>
                              <td>{new Date(bill.invoice_date * 1000).toLocaleDateString()}</td>
                              <td className="text-right">₹{bill.total_bill?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right">₹{bill.total_paid?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-green-400">
                                ₹{bill.outstanding_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={bill.allocated || ''}
                                  onChange={(e) => handleBillAllocationChange(bill.purchase_id, e.target.value)}
                                  max={bill.isInCurrentPayment ? bill.total_bill : bill.outstanding_amount}
                                  disabled={!amount || parseFloat(amount) <= 0}
                                  className="input w-24 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                                  placeholder="0"
                                />
                              </td>
                            </tr>
                          ))
                        ) : (
                          outstandingReturns.map(ret => (
                            <tr key={ret.return_id}>
                              <td>{ret.return_no}</td>
                              <td>{new Date(ret.return_date * 1000).toLocaleDateString()}</td>
                              <td className="text-right">₹{ret.total_return?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right">₹{ret.total_refunded?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-green-400">
                                ₹{ret.outstanding_refund?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={ret.allocated || ''}
                                  onChange={(e) => handleReturnAllocationChange(ret.return_id, e.target.value)}
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
                </>
              )}
            </div>
          )}

          {/* Summary */}
          {parseInt(selectedVendor) > 0 && operationType && (paymentType !== 'DIRECT' && outstandingItems.length > 0) && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Transaction Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Amount Allocated</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{totalAllocated?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className={`bg-slate-700 rounded-lg p-4 ${Math.abs(difference) < 0.01 ? 'border-2 border-green-500' : 'border-2 border-red-500'}`}>
                  <p className="text-slate-400 text-sm mb-1">Amount Difference</p>
                  <p className={`text-xl font-semibold ${Math.abs(difference) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                    ₹{Math.abs(difference)?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    {difference > 0.01 ? ' (Unallocated)' : difference < -0.01 ? ' (Over-allocated)' : ' '}
                    {Math.abs(difference) < 0.01 && <CheckCircle className="inline w-5 h-5 ml-2" />}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Total Balance</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
              disabled={createTransaction.isPending || updateTransaction.isPending}
            >
              Cancel
            </button>
            <button
              onClick={handleRecordTransaction}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={isRecordDisabled()}
            >
              {createTransaction.isPending || updateTransaction.isPending 
                ? (isEditMode ? 'Updating...' : 'Recording...') 
                : (isEditMode ? 'Update Transaction' : 'Record Transaction')}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Confirm Transaction"
        message={
          paymentType === 'DIRECT'
            ? `Record on account ${operationType === 'EXPENSE' ? 'payment' : 'refund'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}? This will be added to vendor's advance balance.`
            : paymentType === 'MIXED'
            ? `Record ${operationType === 'EXPENSE' ? 'payment' : 'refund'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} with ₹${totalAllocated?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${
                operationType === 'EXPENSE' 
                  ? outstandingBills.filter(b => b.allocated && b.allocated > 0).length 
                  : outstandingReturns.filter(r => r.allocated && r.allocated > 0).length
              } ${operationType === 'EXPENSE' ? 'bill(s)' : 'return(s)'} and ₹${difference?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} as advance?`
            : `Record ${operationType === 'EXPENSE' ? 'payment' : 'refund'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${
                operationType === 'EXPENSE' 
                  ? outstandingBills.filter(b => b.allocated && b.allocated > 0).length 
                  : outstandingReturns.filter(r => r.allocated && r.allocated > 0).length
              } ${operationType === 'EXPENSE' ? 'bill(s)' : 'return(s)'}?`
        }
        confirmText={isEditMode ? "Update Transaction" : "Record Transaction"}
        cancelText="Cancel"
        showLoading={createTransaction.isPending || updateTransaction.isPending}
        loadingText="Recording Transaction..."
        onConfirm={confirmRecordTransaction}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  )
}
