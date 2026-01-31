import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle, Loader2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'
import SessionStorageService from '../../lib/sessionStorage'

interface OutstandingBill {
  purchase_id: number
  invoice_no: number
  invoice_date: number
  total_bill: number
  total_paid: number
  outstanding_amount: number
  payment_status: number
  allocated?: number
}

interface OutstandingReturn {
  return_id: number
  return_no: string
  return_date: number
  total_return: number
  total_refunded: number
  outstanding_refund: number
  payment_status: number
  allocated?: number
}

interface Vendor {
  id: number
  vendor_name: string
}

type OperationType = 'EXPENSE' | 'INCOME' | ''
type PaymentType = 'BILL_SPECIFIC' | 'MIXED' | 'DIRECT'

export default function VendorTransactionEntry() {
  const router = useRouter()
  const { edit, type } = router.query
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string>('')
  const [operationType, setOperationType] = useState<OperationType>('')
  const [paymentType, setPaymentType] = useState<PaymentType>('BILL_SPECIFIC') // Default for EXPENSE
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([])
  const [outstandingReturns, setOutstandingReturns] = useState<OutstandingReturn[]>([])
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [mode, setMode] = useState<number>(1)
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [currentFY, setCurrentFY] = useState<number>(2024)
  const [error, setError] = useState<string>('')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  
  // Edit mode
  const isEditMode = !!edit
  const [transactionId, setTransactionId] = useState<number>(0)

  useEffect(() => {
    fetchVendors()
    fetchCurrentFY()
    if (isEditMode && edit && type) {
      fetchTransactionForEdit(edit as string, type as string)
    }
  }, [edit, type, isEditMode])

  useEffect(() => {
    const vendorId = parseInt(selectedVendor)
    if (vendorId > 0 && operationType) {
      if (operationType === 'EXPENSE') {
        fetchOutstandingBills(vendorId)
        setOutstandingReturns([])
      } else if (operationType === 'INCOME') {
        // ✅ Auto-set DIRECT for INCOME
        setPaymentType('DIRECT')
        fetchOutstandingReturns(vendorId)
        setOutstandingBills([])
      }
    } else {
      setOutstandingBills([])
      setOutstandingReturns([])
    }
  }, [selectedVendor, operationType])

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/vendors')
      const data = await res.json()
      setVendors(data.vendors || [])
    } catch (error) {
      console.error('Error fetching vendors:', error)
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

  const fetchOutstandingBills = async (vendorId: number) => {
    setLoading(true)
    try {
      // ✅ FIX #2: Fetch ALL bills (paid and unpaid) for edit mode flexibility
      const res = await fetch(`/api/purchases?vendor=${vendorId}&limit=1000&sortOrder=asc`)
      const data = await res.json()
      
      if (data.purchases) {
        const bills: OutstandingBill[] = data.purchases
          .filter((p: any) => p.remaining_amount > 0) // Still filter for bills with outstanding amounts
          .map((p: any) => ({
            purchase_id: p.id,
            invoice_no: p.invoice_no,
            invoice_date: p.invoice_date,
            total_bill: p.total,
            total_paid: p.total_paid || 0,
            outstanding_amount: p.remaining_amount,
            payment_status: p.payment_status,
            allocated: 0
          }))
        
        setOutstandingBills(bills)
      }
    } catch (error) {
      console.error('Error fetching outstanding bills:', error)
      setError('Failed to load outstanding bills')
    } finally {
      setLoading(false)
    }
  }

  const fetchOutstandingReturns = async (vendorId: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/purchase-returns?vendor=${vendorId}&limit=1000&sortOrder=asc`)
      const data = await res.json()
      
      if (data.returns) {
        const returns: OutstandingReturn[] = data.returns
          .filter((r: any) => r.remaining_refund > 0)
          .map((r: any) => ({
            return_id: r.id,
            return_no: r.return_no,
            return_date: r.return_date,
            total_return: r.refund_amount,
            total_refunded: r.total_refunded || 0,
            outstanding_refund: r.remaining_refund,
            payment_status: r.payment_status,
            allocated: 0
          }))
        
        setOutstandingReturns(returns)
      }
    } catch (error) {
      console.error('Error fetching outstanding returns:', error)
      setError('Failed to load outstanding returns')
    } finally {
      setLoading(false)
    }
  }

  const fetchTransactionForEdit = async (id: string, transactionType: string) => {
    setLoading(true)
    try {
      const isExpense = transactionType === 'expense'
      const module = isExpense ? 'vendor-payments' : 'vendor-refunds'
      
      // Check sessionStorage first (optimization to avoid API call)
      const cachedData = SessionStorageService.get(module, id)
      let transaction = cachedData
      
      // If no cached data, fetch from API
      if (!cachedData) {
        const endpoint = isExpense 
          ? `/api/vendor-payments/${id}`
          : `/api/vendor-refunds/${id}`
        
        const response = await fetch(endpoint)
        const data = await response.json()
        
        if (data.success && data.data) {
          transaction = data.data
        } else {
          setError('Failed to load transaction for editing')
          setLoading(false)
          return
        }
      }
      
      if (transaction) {
        
        // Set transaction ID
        setTransactionId(parseInt(id))
        
        // Set vendor
        setSelectedVendor(transaction.vendor.id.toString())
        
        // Set operation type
        setOperationType(isExpense ? 'EXPENSE' : 'INCOME')
        
        // Set payment type
        const pType = isExpense ? transaction.payment_type : transaction.refund_type
        setPaymentType(pType as PaymentType)
        
        // Set amount
        const amt = isExpense ? transaction.payment_amount : transaction.refund_amount
        setAmount(amt.toString())
        
        // Set mode
        const payMode = isExpense ? transaction.payment_mode : transaction.refund_mode
        setMode(payMode)
        
        // Set date
        const dateTimestamp = isExpense ? transaction.payment_date : transaction.refund_date
        const dateObj = new Date(dateTimestamp * 1000)
        setDate(dateObj.toISOString().split('T')[0])
        
        // Set notes
        setNotes(transaction.notes || '')
        
        // Set FY
        setCurrentFY(transaction.fy)
        
        // ✅ FIX: Load allocated bills/returns for edit mode
        if (isExpense && transaction.allocations) {
          // Build list of allocated bills with their data
          const allocatedBills: OutstandingBill[] = transaction.allocations.map((alloc: any) => ({
            purchase_id: alloc.purchase_id,
            invoice_no: alloc.invoice_no,
            invoice_date: alloc.invoice_date,
            total_bill: alloc.purchase_total,
            total_paid: alloc.allocated_amount, // This bill has this much paid
            outstanding_amount: alloc.purchase_total - alloc.allocated_amount,
            payment_status: alloc.payment_status,
            allocated: alloc.allocated_amount
          }))
          
          // Set the allocated bills immediately
          setOutstandingBills(allocatedBills)
          
          // Then fetch other outstanding bills and merge
          fetchOutstandingBills(transaction.vendor.id).then(() => {
            setOutstandingBills(prev => {
              // Keep allocated bills, add new outstanding bills not already in list
              const allocatedIds = new Set(allocatedBills.map(b => b.purchase_id))
              const newBills = prev.filter(b => !allocatedIds.has(b.purchase_id))
              return [...allocatedBills, ...newBills]
            })
          })
        } else if (!isExpense && transaction.allocations) {
          // Build list of allocated returns with their data
          const allocatedReturns: OutstandingReturn[] = transaction.allocations.map((alloc: any) => ({
            return_id: alloc.return_id,
            return_no: alloc.return_no || `PR-${alloc.return_id}`,
            return_date: alloc.allocation_date,
            total_return: alloc.return_total || 0,
            total_refunded: alloc.allocated_amount,
            outstanding_refund: 0,
            payment_status: alloc.payment_status || 0,
            allocated: alloc.allocated_amount
          }))
          
          setOutstandingReturns(allocatedReturns)
          
          fetchOutstandingReturns(transaction.vendor.id).then(() => {
            setOutstandingReturns(prev => {
              const allocatedIds = new Set(allocatedReturns.map(r => r.return_id))
              const newReturns = prev.filter(r => !allocatedIds.has(r.return_id))
              return [...allocatedReturns, ...newReturns]
            })
          })
        }
        
        // Clean up sessionStorage after use
        SessionStorageService.remove(module, id)
      }
    } catch (error) {
      console.error('Error fetching transaction for edit:', error)
      setError('Failed to load transaction for editing')
    } finally {
      setLoading(false)
    }
  }

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
        const toAllocate = Math.min(remaining, bill.outstanding_amount)
        remaining -= toAllocate
        return { ...bill, allocated: toAllocate }
      })
      setOutstandingBills(updated)
    } else if (operationType === 'INCOME') {
      const updated = outstandingReturns.map(ret => {
        if (remaining <= 0) return { ...ret, allocated: 0 }
        const toAllocate = Math.min(remaining, ret.outstanding_refund)
        remaining -= toAllocate
        return { ...ret, allocated: toAllocate }
      })
      setOutstandingReturns(updated)
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
    if (loading) return true
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
      const method = isEditMode ? 'PUT' : 'POST'
      
      if (operationType === 'EXPENSE') {
        endpoint = isEditMode ? `/api/vendor-payments/${transactionId}` : '/api/vendor-payments'
        const allocations = paymentType === 'DIRECT' ? [] : outstandingBills
          .filter(bill => bill.allocated && bill.allocated > 0)
          .map(bill => ({
            purchase_id: bill.purchase_id,
            allocated_amount: bill.allocated,
            notes: `Payment for Invoice ${bill.invoice_no}`
          }))
        
        payload = {
          vendor_id: selectedVendor,
          payment_amount: amountNum,
          payment_mode: mode,
          payment_date: timestamp,
          payment_type: paymentType,
          notes,
          allocations,
          fy: currentFY
        }
      } else {
        endpoint = isEditMode ? `/api/vendor-refunds/${transactionId}` : '/api/vendor-refunds'
        const allocations = paymentType === 'DIRECT' ? [] : outstandingReturns
          .filter(ret => ret.allocated && ret.allocated > 0)
          .map(ret => ({
            return_id: ret.return_id,
            allocated_amount: ret.allocated,
            notes: `Refund for ${ret.return_no}`
          }))
        
        payload = {
          vendor_id: selectedVendor,
          refund_amount: amountNum,
          refund_mode: mode,
          refund_date: timestamp,
          refund_type: paymentType === 'DIRECT' ? 'DIRECT' : 'RETURN_SPECIFIC',
          notes,
          allocations,
          fy: currentFY
        }
      }
      
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        const transactionType = operationType === 'EXPENSE' ? 'Payment' : 'Refund'
        const action = isEditMode ? 'updated' : 'recorded'
        showSnackbar('success', `${transactionType} ${action} successfully!`)
        
        if (isEditMode) {
          // Redirect to transactions list after edit
          router.push('/vendor-transactions')
        } else {
          // Reset form for new entry
          setSelectedVendor('')
          setOperationType('')
          setOutstandingBills([])
          setOutstandingReturns([])
          setAmount('')
          setMode(1)
          setDate(new Date().toISOString().split('T')[0])
          setNotes('')
          setError('')
        }
      } else {
        setError(data.error || 'Failed to record transaction')
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
                    <span className="text-slate-300">EXPENSE (Pay Vendor)</span>
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
                    <span className="text-slate-300">INCOME (Receive Refund)</span>
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
                        <span className="text-slate-300 font-medium">Direct Advance</span>
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
                  <h3 className="text-lg font-medium text-blue-300 mb-2">Direct Advance {operationType === 'EXPENSE' ? 'Payment' : 'Refund'}</h3>
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
                                  max={bill.outstanding_amount}
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
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={handleRecordTransaction}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={isRecordDisabled()}
            >
              {loading ? (isEditMode ? 'Updating...' : 'Recording...') : (isEditMode ? 'Update Transaction' : 'Record Transaction')}
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
            ? `Record direct advance ${operationType === 'EXPENSE' ? 'payment' : 'refund'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}? This will be added to vendor's advance balance.`
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
        showLoading={loading}
        loadingText="Recording Transaction..."
        onConfirm={confirmRecordTransaction}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  )
}
