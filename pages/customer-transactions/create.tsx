import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle, Loader2 } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'
import SessionStorageService from '../../lib/sessionStorage'
import { getLocalDateString, convertDateToTimestamp } from '../../lib/date-utils'

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

interface OutstandingInvoice {
  invoice_id: number
  invoice_no: number
  invoice_date: number
  total_bill: number
  total_paid: number
  outstanding_amount: number
  payment_status: number
  allocated?: number
  isInCurrentPayment?: boolean  // Track if invoice is part of current payment being edited
}

interface OutstandingReturn {
  return_id: number
  credit_note_no: string
  return_date: number
  total_return: number
  total_refunded: number
  outstanding_refund: number
  payment_status: number
  allocated?: number
  isInCurrentPayment?: boolean  // Track if return is part of current refund being edited
}

interface Customer {
  id: number
  billing_name: string
}

type OperationType = 'INCOME' | 'EXPENSE' | ''
type PaymentType = 'BILL_SPECIFIC' | 'MIXED' | 'DIRECT'

export default function CustomerTransactionEntry() {
  const router = useRouter()
  const { edit, type } = router.query
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useSessionStorage<string>('customer-transaction-customer', '')
  const [operationType, setOperationType] = useState<OperationType>('')
  const [paymentType, setPaymentType] = useState<PaymentType>('BILL_SPECIFIC') // Default for INCOME
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoice[]>([])
  const [outstandingReturns, setOutstandingReturns] = useState<OutstandingReturn[]>([])
  const [date, setDate] = useSessionStorage<string>('customer-transaction-date', getLocalDateString())
  const [mode, setMode] = useState<number>(1)
  const [amount, setAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [currentFY, setCurrentFY] = useState<number>(2024)
  const [error, setError] = useState<string>('')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  
  // Edit mode
  const isEditMode = !!edit
  const [transactionId, setTransactionId] = useState<number>(0)
  const [isInitializing, setIsInitializing] = useState(false)

  // Initialize with current month date range (only if no stored dates)
  useEffect(() => {
    // ✅ Check sessionStorage directly to avoid overwriting saved values
    const storedDate = sessionStorage.getItem('customer-transaction-date');
    
    // ✅ Only set defaults if no values exist in sessionStorage
    if (!storedDate && !date) {
      setDate(getLocalDateString())
    }

    fetchCustomers()
    fetchCurrentFY()
    if (isEditMode && edit && type) {
      fetchTransactionForEdit(edit as string, type as string)
    }
  }, [edit, type, isEditMode]);
  
  // ✅ Cleanup sessionStorage on component unmount
  useEffect(() => {
    return () => {
      // Clear all customer-transaction sessionStorage keys when leaving page
      sessionStorage.removeItem('customer-transaction-customer');
      sessionStorage.removeItem('customer-transaction-date');
    };
  }, []);

  useEffect(() => {
    // Skip if initializing (during edit load)
    if (isInitializing) return
    
    const customerId = parseInt(selectedCustomer)
    if (customerId > 0 && operationType) {
      if (operationType === 'INCOME') {
        fetchOutstandingInvoices(customerId)
        setOutstandingReturns([])
      } else if (operationType === 'EXPENSE') {
        // ✅ Auto-set DIRECT for EXPENSE
        setPaymentType('DIRECT')
        setOutstandingReturns([])
        setOutstandingInvoices([])
      }
    } else {
      setOutstandingInvoices([])
      setOutstandingReturns([])
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

  const fetchOutstandingInvoices = async (customerId: number, skipStateUpdate = false) => {
    if (!skipStateUpdate) {
      setLoading(true)
    }
    try {
      const res = await fetch(`/api/sales?customer=${customerId}&limit=1000&sortOrder=asc`)
      const data = await res.json()
      
      if (data.sales) {
        const invoices: OutstandingInvoice[] = data.sales
          .filter((s: any) => {
            // In create mode, only show invoices with outstanding amounts
            // In edit mode with skipStateUpdate, return ALL invoices (will be filtered later)
            if (isEditMode && skipStateUpdate) {
              return true
            }
            if (isEditMode) {
              return true
            }
            return s.remaining_amount > 0
          })
          .map((s: any) => ({
            invoice_id: s.id,
            invoice_no: s.invoice_no,
            invoice_date: s.invoice_date,
            total_bill: s.total,
            total_paid: s.total_paid || 0,
            outstanding_amount: s.remaining_amount,
            payment_status: s.payment_status,
            allocated: 0,
            isInCurrentPayment: false
          }))
        
        if (!skipStateUpdate) {
          setOutstandingInvoices(invoices)
        }
        return invoices
      }
      return []
    } catch (error) {
      console.error('Error fetching outstanding invoices:', error)
      setError('Failed to load outstanding invoices')
      return []
    } finally {
      if (!skipStateUpdate) {
        setLoading(false)
      }
    }
  }

  const fetchOutstandingReturns = async (customerId: number, skipStateUpdate = false) => {
    if (!skipStateUpdate) {
      setLoading(true)
    }
    try {
      const res = await fetch(`/api/sale-returns?customer=${customerId}&limit=1000&sortOrder=asc`)
      const data = await res.json()
      
      if (data.returns) {
        const returns: OutstandingReturn[] = data.returns
          .filter((r: any) => {
            // In edit mode with skipStateUpdate, return ALL returns (will be filtered later)
            if (isEditMode && skipStateUpdate) {
              return true
            }
            return r.remaining_refund > 0
          })
          .map((r: any) => ({
            return_id: r.id,
            credit_note_no: r.credit_note_no || `CR-${r.id}`,
            return_date: r.return_date,
            total_return: r.refund_amount,
            total_refunded: r.total_refunded || 0,
            outstanding_refund: r.remaining_refund,
            payment_status: r.payment_status,
            allocated: 0,
            isInCurrentPayment: false
          }))
        
        if (!skipStateUpdate) {
          setOutstandingReturns(returns)
        }
        return returns
      }
      return []
    } catch (error) {
      console.error('Error fetching outstanding returns:', error)
      setError('Failed to load outstanding returns')
      return []
    } finally {
      if (!skipStateUpdate) {
        setLoading(false)
      }
    }
  }

  const fetchTransactionForEdit = async (id: string, transactionType: string) => {
    setIsInitializing(true)  // Prevent useEffect from refetching
    setLoading(true)
    try {
      const isIncome = transactionType === 'income'
      const module = isIncome ? 'customer-payments' : 'customer-refunds'
      
      // Check sessionStorage first (optimization to avoid API call)
      const cachedData = SessionStorageService.get(module, id)
      let transaction = cachedData
      
      // If no cached data, fetch from API
      if (!cachedData) {
        const endpoint = isIncome 
          ? `/api/customer-payments/${id}`
          : `/api/customer-refunds/${id}`
        
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
        
        // Set customer
        setSelectedCustomer(transaction.customer.id.toString())
        
        // Set operation type
        setOperationType(isIncome ? 'INCOME' : 'EXPENSE')
        
        // Set payment type
        const pType = isIncome ? transaction.payment_type : transaction.refund_type
        setPaymentType(pType as PaymentType)
        
        // Set amount
        const amt = isIncome ? transaction.payment_amount : transaction.refund_amount
        setAmount(amt.toString())
        
        // Set mode
        const payMode = isIncome ? transaction.payment_mode : transaction.refund_mode
        setMode(payMode)
        
        // Set date - ✅ FIX: Use the same pattern as customer-transactions/index.tsx
        const dateTimestamp = isIncome ? transaction.payment_date : transaction.refund_date
        const dateObj = new Date(dateTimestamp * 1000)
        const formattedDate = dateObj.toLocaleDateString('en-IN')
        const [day, month, year] = formattedDate.split('/').map(n => n.padStart(2, '0'))
        setDate(`${year}-${month}-${day}`)
        
        // Set notes
        setNotes(transaction.notes || '')
        
        // Set FY
        setCurrentFY(transaction.fy)
        
        // ✅ FIX: Load allocated invoices/returns for edit mode with proper merging
        if (isIncome && transaction.allocations && transaction.allocations.length > 0) {
          // Build list of allocated invoices with their data
          const allocatedInvoices: OutstandingInvoice[] = transaction.allocations.map((alloc: any) => ({
            invoice_id: alloc.invoice_id,
            invoice_no: alloc.invoice_no,
            invoice_date: alloc.invoice_date,
            total_bill: alloc.invoice_total,
            total_paid: alloc.allocated_amount,
            // ✅ FIX 1: Cap outstanding at 0 to prevent showing negative amounts
            outstanding_amount: Math.max(0, alloc.invoice_total - alloc.allocated_amount),
            payment_status: alloc.payment_status,
            allocated: alloc.allocated_amount,
            isInCurrentPayment: true  // Mark as part of current payment
          }))
          
          // Fetch fresh invoices WITHOUT overwriting state
          const freshInvoices = await fetchOutstandingInvoices(transaction.customer.id, true)
          
          // Merge: Keep allocated invoices, add fresh invoices not in allocations
          const allocatedIds = new Set(allocatedInvoices.map(i => i.invoice_id))
          const otherInvoices = freshInvoices.filter(i => !allocatedIds.has(i.invoice_id))
          
          // ✅ FIX 3: Filter to only show invoices that are either:
          // 1. In current payment, OR
          // 2. Have outstanding amount > 0
          const invoicesToShow = [...allocatedInvoices, ...otherInvoices].filter(invoice =>
            invoice.isInCurrentPayment || invoice.outstanding_amount > 0
          )
          
          setOutstandingInvoices(invoicesToShow)
        } else if (!isIncome && transaction.allocations && transaction.allocations.length > 0) {
          // Build list of allocated returns with their data
          const allocatedReturns: OutstandingReturn[] = transaction.allocations.map((alloc: any) => ({
            return_id: alloc.return_id,
            credit_note_no: alloc.credit_note_no || `CR-${alloc.return_id}`,
            return_date: alloc.allocation_date,
            total_return: alloc.return_total || 0,
            total_refunded: alloc.allocated_amount,
            outstanding_refund: Math.max(0, (alloc.return_total || 0) - alloc.allocated_amount),
            payment_status: alloc.payment_status || 0,
            allocated: alloc.allocated_amount,
            isInCurrentPayment: true  // Mark as part of current refund
          }))
          
          // Fetch fresh returns WITHOUT overwriting state
          const freshReturns = await fetchOutstandingReturns(transaction.customer.id, true)
          
          // Merge: Keep allocated returns, add fresh returns not in allocations
          const allocatedIds = new Set(allocatedReturns.map(r => r.return_id))
          const otherReturns = freshReturns.filter(r => !allocatedIds.has(r.return_id))
          
          // Filter to only show returns with outstanding > 0 or in current payment
          const returnsToShow = [...allocatedReturns, ...otherReturns].filter(ret =>
            ret.isInCurrentPayment || ret.outstanding_refund > 0
          )
          
          setOutstandingReturns(returnsToShow)
        }
        
        // Clean up sessionStorage after use
        SessionStorageService.remove(module, id)
      }
    } catch (error) {
      console.error('Error fetching transaction for edit:', error)
      setError('Failed to load transaction for editing')
    } finally {
      setLoading(false)
      setIsInitializing(false)  // Allow useEffect to run normally after edit load completes
    }
  }

  const handleInvoiceAllocationChange = (invoiceId: number, value: string) => {
    const allocAmount = parseFloat(value) || 0
    setOutstandingInvoices(prev => prev.map(invoice => 
      invoice.invoice_id === invoiceId 
        ? { ...invoice, allocated: allocAmount }
        : invoice
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
    
    if (operationType === 'INCOME') {
      const updated = outstandingInvoices.map(invoice => {
        if (remaining <= 0) return { ...invoice, allocated: 0 }
        
        // ✅ FIX: In edit mode, invoices in current payment can accept up to total_bill
        // Other invoices can only accept up to outstanding_amount
        const maxAllocation = invoice.isInCurrentPayment 
          ? invoice.total_bill 
          : invoice.outstanding_amount
        
        const toAllocate = Math.min(remaining, maxAllocation)
        remaining -= toAllocate
        return { ...invoice, allocated: toAllocate }
      })
      setOutstandingInvoices(updated)
      
      // ✅ Show snackbar feedback
      const totalAllocated = updated.reduce((sum, i) => sum + (i.allocated || 0), 0)
      if (totalAllocated === 0) {
        showSnackbar('warning', 'No invoices available for allocation. All invoices are fully paid.')
      } else {
        showSnackbar('success', `Allocated ₹${totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })} to invoices`)
      }
    } else if (operationType === 'EXPENSE') {
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
    if (operationType === 'INCOME') {
      setOutstandingInvoices(prev => prev.map(invoice => ({ ...invoice, allocated: 0 })))
    } else if (operationType === 'EXPENSE') {
      setOutstandingReturns(prev => prev.map(ret => ({ ...ret, allocated: 0 })))
    }
  }

  const getTotalAllocated = () => {
    if (operationType === 'INCOME') {
      return outstandingInvoices.reduce((sum, invoice) => sum + (invoice.allocated || 0), 0)
    } else if (operationType === 'EXPENSE') {
      return outstandingReturns.reduce((sum, ret) => sum + (ret.allocated || 0), 0)
    }
    return 0
  }

  const isRecordDisabled = (): boolean => {
    if (loading) return true
    if (!selectedCustomer) return true
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
      // ✅ FIX: Check allocation against appropriate max per invoice
      const hasOverAllocation = outstandingInvoices.some(invoice => {
        const maxAllowedAllocation = invoice.isInCurrentPayment 
          ? invoice.total_bill           // Invoices in current payment can reallocate up to full amount
          : invoice.outstanding_amount   // Other invoices limited to outstanding
        return (invoice.allocated || 0) > maxAllowedAllocation
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
    
    // DIRECT: No validation needed for allocations
    if (paymentType === 'DIRECT') {
      setShowConfirmationModal(true)
      return
    }
    
    const totalAllocated = getTotalAllocated()
    const amountNum = parseFloat(amount)
    
    // BILL_SPECIFIC: Must allocate ALL
    if (paymentType === 'BILL_SPECIFIC') {
      // ✅ FIX: Check for over-allocation against appropriate max per invoice
      const overAllocatedInvoices = outstandingInvoices.filter(invoice => {
        const maxAllowedAllocation = invoice.isInCurrentPayment 
          ? invoice.total_bill           // Invoices in current payment can reallocate up to full amount
          : invoice.outstanding_amount   // Other invoices limited to outstanding
        return (invoice.allocated || 0) > maxAllowedAllocation
      })
      
      if (overAllocatedInvoices.length > 0) {
        const invoicesList = overAllocatedInvoices.map(i => {
          const maxAllowed = i.isInCurrentPayment ? i.total_bill : i.outstanding_amount
          const limitType = i.isInCurrentPayment ? 'Total Bill' : 'Outstanding'
          return `Invoice #${i.invoice_no} (${limitType}: ₹${maxAllowed.toLocaleString('en-IN')}, Trying to allocate: ₹${(i.allocated || 0).toLocaleString('en-IN')})`
        }).join(', ')
        setError(
          `Cannot allocate more than allowed amount. Over-allocated invoices: ${invoicesList}. Options: 1) Reduce allocation, or 2) Switch to MIXED payment type.`
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
        setError('Please allocate at least some amount to invoices')
        return
      }
      if (totalAllocated > amountNum) {
        setError(`Cannot allocate more (₹${totalAllocated.toFixed(2)}) than payment amount (₹${amountNum.toFixed(2)})`)
        return
      }
    }
    
    // Check if allocations exist (only for BILL_SPECIFIC and MIXED types)
    if (paymentType === 'BILL_SPECIFIC' || paymentType === 'MIXED') {
      const hasAllocations = operationType === 'INCOME' 
        ? outstandingInvoices.some(i => i.allocated && i.allocated > 0)
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
      const timestamp = convertDateToTimestamp(date)
      
      let endpoint = ''
      let payload: any = {}
      const method = isEditMode ? 'PUT' : 'POST'
      
      if (operationType === 'INCOME') {
        endpoint = isEditMode ? `/api/customer-payments/${transactionId}` : '/api/customer-payments'
        const allocations = paymentType === 'DIRECT' ? [] : outstandingInvoices
          .filter(invoice => invoice.allocated && invoice.allocated > 0)
          .map(invoice => ({
            invoice_id: invoice.invoice_id,
            allocated_amount: invoice.allocated,
            notes: `Payment for Invoice ${invoice.invoice_no}`
          }))
        
        payload = {
          customer_id: selectedCustomer,
          payment_amount: amountNum,
          payment_mode: mode,
          payment_date: timestamp,
          payment_type: paymentType,
          notes,
          allocations,
          fy: currentFY
        }
      } else {
        endpoint = isEditMode ? `/api/customer-refunds/${transactionId}` : '/api/customer-refunds'
        const allocations = paymentType === 'DIRECT' ? [] : outstandingReturns
          .filter(ret => ret.allocated && ret.allocated > 0)
          .map(ret => ({
            return_id: ret.return_id,
            allocated_amount: ret.allocated,
            notes: `Refund for ${ret.credit_note_no}`
          }))
        
        payload = {
          customer_id: selectedCustomer,
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
        const transactionType = operationType === 'INCOME' ? 'Payment' : 'Refund'
        const action = isEditMode ? 'updated' : 'recorded'
        showSnackbar('success', `${transactionType} ${action} successfully!`)
        
        // Extract transaction ID from response
        const createdId = isEditMode ? transactionId : (data.data?.payment?.id || data.data?.refund?.id)
        
        // Redirect to transaction detail view after creation/edit
        if (createdId) {
          router.push(`/customer-transactions/view/${createdId}?type=${operationType === 'INCOME' ? 'income' : 'expense'}`)
        } else {
          // Fallback: Reset form if ID not found (shouldn't happen)
          setSelectedCustomer('')
          setOperationType('')
          setOutstandingInvoices([])
          setOutstandingReturns([])
          setAmount('')
          setMode(1)
          setDate(getLocalDateString())
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
  const outstandingItems = operationType === 'INCOME' ? outstandingInvoices : outstandingReturns

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
                  Customer <span className="text-red-400">*</span>
                </label>
                <SearchableSelect
                  options={customers.map(c => ({
                    id: c.id.toString(),
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
                    <span className="text-slate-300">RECEIPT (Receive from Customer)</span>
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
                    <span className="text-slate-300">PAYMENT (Pay Customer)</span>
                  </label>
                </div>
              </div>

              {/* Payment Type Selection - Only show for INCOME */}
              {operationType === 'INCOME' && (
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
                        <span className="text-slate-300 font-medium">Invoice Specific</span>
                        <p className="text-xs text-slate-400">Allocate entire amount to invoices</p>
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
          {parseInt(selectedCustomer) > 0 && operationType && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              {paymentType === 'DIRECT' ? (
                <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-6 text-center">
                  <DollarSign className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-blue-300 mb-2">On Account {operationType === 'INCOME' ? 'Receipt' : 'Payment'}</h3>
                  <p className="text-slate-300">
                    {operationType === 'INCOME' 
                      ? `₹${amountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })} will be added as advance payment from customer`
                      : `₹${amountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })} will be recorded as refund to customer`
                    }
                  </p>
                  <p className="text-sm text-slate-400 mt-2">
                    {operationType === 'INCOME'
                      ? 'This creates a credit balance with the customer that can be used for future sales.'
                      : 'You owe the customer this amount, which can offset future sales.'
                    }
                  </p>
                </div>
              ) : (
                <>
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
                          <th>{operationType === 'INCOME' ? 'Invoice No' : 'Credit Note No'}</th>
                          <th>Date</th>
                          <th className="text-right">{operationType === 'INCOME' ? 'Total Bill' : 'Total Return'}</th>
                          <th className="text-right">{operationType === 'INCOME' ? 'Paid' : 'Refunded'}</th>
                          <th className="text-right">Outstanding</th>
                          <th className="text-right">Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operationType === 'INCOME' ? (
                          outstandingInvoices.map(invoice => (
                            <tr key={invoice.invoice_id}>
                              <td>SINV-{invoice.invoice_no}</td>
                              <td>{new Date(invoice.invoice_date * 1000).toLocaleDateString()}</td>
                              <td className="text-right">₹{invoice.total_bill?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right">₹{invoice.total_paid?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="text-right font-semibold text-green-400">
                                ₹{invoice.outstanding_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={invoice.allocated || ''}
                                  onChange={(e) => handleInvoiceAllocationChange(invoice.invoice_id, e.target.value)}
                                  max={invoice.isInCurrentPayment ? invoice.total_bill : invoice.outstanding_amount}
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
                              <td>{ret.credit_note_no}</td>
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
          {parseInt(selectedCustomer) > 0 && operationType && (paymentType !== 'DIRECT' && outstandingItems.length > 0) && (
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
            ? `Record on account ${operationType === 'INCOME' ? 'receipt' : 'payment'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}? This will be added to customer's advance balance.`
            : paymentType === 'MIXED'
            ? `Record ${operationType === 'INCOME' ? 'receipt' : 'payment'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} with ₹${totalAllocated?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${
                operationType === 'INCOME' 
                  ? outstandingInvoices.filter(i => i.allocated && i.allocated > 0).length 
                  : outstandingReturns.filter(r => r.allocated && r.allocated > 0).length
              } ${operationType === 'INCOME' ? 'invoice(s)' : 'return(s)'} and ₹${difference?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} as advance?`
            : `Record ${operationType === 'INCOME' ? 'receipt' : 'payment'} of ₹${amountNum?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${
                operationType === 'INCOME' 
                  ? outstandingInvoices.filter(i => i.allocated && i.allocated > 0).length 
                  : outstandingReturns.filter(r => r.allocated && r.allocated > 0).length
              } ${operationType === 'INCOME' ? 'invoice(s)' : 'return(s)'}?`
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
