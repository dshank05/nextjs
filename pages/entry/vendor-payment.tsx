import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'

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

interface Vendor {
  id: number
  vendor_name: string
}

export default function VendorPaymentEntry() {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedVendor, setSelectedVendor] = useState<number>(0)
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([])
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [paymentMode, setPaymentMode] = useState<number>(1)
  const [paymentAmount, setPaymentAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [currentFY, setCurrentFY] = useState<number>(2024)
  const [error, setError] = useState<string>('')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)

  useEffect(() => {
    fetchVendors()
    fetchCurrentFY()
  }, [])

  useEffect(() => {
    if (selectedVendor > 0) {
      fetchOutstandingBills(selectedVendor)
    } else {
      setOutstandingBills([])
    }
  }, [selectedVendor])

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
      const res = await fetch('/api/financial-years/current')
      const data = await res.json()
      if (data.fy) {
        setCurrentFY(data.fy)
      }
    } catch (error) {
      console.error('Error fetching FY:', error)
    }
  }

  const fetchOutstandingBills = async (vendorId: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/purchases?vendor=${vendorId}&status=0,2&limit=1000`)
      const data = await res.json()
      
      if (data.purchases) {
        const bills: OutstandingBill[] = data.purchases
          .filter((p: any) => p.remaining_amount > 0)
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

  const handleAllocationChange = (purchaseId: number, value: string) => {
    const amount = parseFloat(value) || 0
    setOutstandingBills(prev => prev.map(bill => 
      bill.purchase_id === purchaseId 
        ? { ...bill, allocated: amount }
        : bill
    ))
  }

  const handleAutoAllocate = () => {
    let remaining = parseFloat(paymentAmount) || 0
    const updated = outstandingBills.map(bill => {
      if (remaining <= 0) return { ...bill, allocated: 0 }
      
      const toAllocate = Math.min(remaining, bill.outstanding_amount)
      remaining -= toAllocate
      return { ...bill, allocated: toAllocate }
    })
    
    setOutstandingBills(updated)
  }

  const handleClearAllocations = () => {
    setOutstandingBills(prev => prev.map(bill => ({ ...bill, allocated: 0 })))
  }

  const getTotalAllocated = () => {
    return outstandingBills.reduce((sum, bill) => sum + (bill.allocated || 0), 0)
  }

  const isRecordPaymentDisabled = (): boolean => {
    // Check 1: Loading state
    if (loading) {
      console.log('❌ Disabled: Loading')
      return true
    }
    
    // Check 2: Vendor not selected
    if (!selectedVendor) {
      console.log('❌ Disabled: No vendor selected')
      return true
    }
    
    // Check 3: Payment amount empty or invalid
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      console.log('❌ Disabled: Payment amount empty or ≤ 0', { paymentAmount })
      return true
    }
    
    // Check 4: Nothing allocated
    const allocated = getTotalAllocated()
    if (allocated === 0) {
      console.log('❌ Disabled: Nothing allocated', { allocated })
      return true
    }
    
    // Check 5: Difference not zero (over/under allocated)
    const paymentAmt = parseFloat(paymentAmount) || 0
    const totalAllocated = getTotalAllocated()
    const difference = paymentAmt - totalAllocated
    if (Math.abs(difference) > 0.01) {
      console.log('❌ Disabled: Difference not zero', { paymentAmt, totalAllocated, difference })
      return true
    }
    
    // All checks passed - enable button
    console.log('✅ ENABLED: All checks passed', { loading, selectedVendor, paymentAmount, allocated, difference })
    return false
  }

  const handleRecordPayment = () => {
    setError('')
    
    if (!selectedVendor) {
      setError('Please select a vendor')
      return
    }
    
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      setError('Please enter a valid payment amount')
      return
    }
    
    const totalAllocated = getTotalAllocated()
    const paymentAmt = parseFloat(paymentAmount)
    
    if (Math.abs(totalAllocated - paymentAmt) > 0.01) {
      setError(`Total allocated (₹${totalAllocated.toFixed(2)}) must equal payment amount (₹${paymentAmt.toFixed(2)})`)
      return
    }
    
    const allocations = outstandingBills.filter(bill => bill.allocated && bill.allocated > 0)
    
    if (allocations.length === 0) {
      setError('Please allocate payment to at least one bill')
      return
    }

    // Show confirmation modal
    setShowConfirmationModal(true)
  }

  const confirmRecordPayment = async () => {
    setLoading(true)
    try {
      const totalAllocated = getTotalAllocated()
      const paymentAmt = parseFloat(paymentAmount)
      
      const allocations = outstandingBills
        .filter(bill => bill.allocated && bill.allocated > 0)
        .map(bill => ({
          purchase_id: bill.purchase_id,
          allocated_amount: bill.allocated,
          notes: `Payment for Invoice ${bill.invoice_no}`
        }))
      
      const res = await fetch('/api/vendor-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: selectedVendor,
          payment_amount: paymentAmt,
          payment_mode: paymentMode,
          payment_date: Math.floor(new Date(paymentDate).getTime() / 1000),
          payment_type: 'BILL_SPECIFIC',
          notes,
          allocations,
          fy: currentFY
        })
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        showSnackbar('success', 'Payment recorded successfully!')
        
        // Reset form to initial state
        setSelectedVendor(0)
        setOutstandingBills([])
        setPaymentAmount('')
        setPaymentMode(1)
        setPaymentDate(new Date().toISOString().split('T')[0])
        setNotes('')
        setError('')
      } else {
        setError(data.error || 'Failed to record payment')
      }
    } catch (error) {
      console.error('Error submitting payment:', error)
      setError('Failed to record payment')
    } finally {
      setLoading(false)
      setShowConfirmationModal(false)
    }
  }

  const totalAllocated = getTotalAllocated()
  const paymentAmt = parseFloat(paymentAmount) || 0
  const difference = paymentAmt - totalAllocated

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
              <DollarSign className="w-6 h-6" />
              Record Vendor Payment
            </h1>
          </div>

          {error && (
            <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Payment Details */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-slate-200 mb-4">Payment Details</h3>
            
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
                  selectedValue={selectedVendor.toString()}
                  onSelectionChange={(value) => setSelectedVendor(parseInt(value || '0'))}
                  placeholder="Select vendor..."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Amount <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Mode <span className="text-red-400">*</span>
                </label>
                <SearchableSelect
                  options={[
                    { id: '1', name: 'Bank Transfer' },
                    { id: '0', name: 'Cash' }
                  ]}
                  selectedValue={paymentMode.toString()}
                  onSelectionChange={(value) => setPaymentMode(parseInt(value || '1'))}
                  placeholder="Select mode..."
                  className="w-full"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input w-full"
                  placeholder="Additional payment notes..."
                />
              </div>
            </div>
          </div>

          {/* Payment Allocation */}
          {selectedVendor > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Allocate Payment to Bills
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleAutoAllocate}
                    className="btn-primary text-sm"
                    disabled={!paymentAmount || loading}
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
                <div className="text-center py-8 text-slate-400">Loading outstanding bills...</div>
              ) : outstandingBills.length === 0 ? (
                <div className="text-center py-8 text-slate-400">No outstanding bills for this vendor</div>
              ) : (
                <>
                  {(!paymentAmount || parseFloat(paymentAmount) <= 0) && (
                    <div className="mb-3 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3">
                      💡 Please enter Payment Amount above to enable bill allocation
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="table">
                    <thead>
                      <tr>
                        <th>Invoice No</th>
                        <th>Date</th>
                        <th className="text-right">Total Bill</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Outstanding</th>
                        <th className="text-right">Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingBills.map(bill => (
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
                              onChange={(e) => handleAllocationChange(bill.purchase_id, e.target.value)}
                              max={bill.outstanding_amount}
                              disabled={!paymentAmount || parseFloat(paymentAmount) <= 0}
                              className="input w-24 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                              placeholder="0.00"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Summary */}
          {selectedVendor > 0 && outstandingBills.length > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Payment Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Payment Amount</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{paymentAmt?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
              onClick={handleRecordPayment}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={isRecordPaymentDisabled()}
            >
              {loading ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Confirm Payment"
        message={`Record payment of ₹${paymentAmt?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${outstandingBills.filter(b => b.allocated && b.allocated > 0).length} bill(s)?`}
        confirmText="Record Payment"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Recording Payment..."
        onConfirm={confirmRecordPayment}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  )
}
