import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { RefreshCw, FileText, CheckCircle } from 'lucide-react'
import { SearchableSelect } from '../../components/common/SearchableSelect'
import { ConfirmationModal } from '../../components/ConfirmationModal'
import { useSnackbar } from '../../components/SnackbarProvider'

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

export default function VendorRefundEntry() {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedVendor, setSelectedVendor] = useState<number>(0)
  const [outstandingReturns, setOutstandingReturns] = useState<OutstandingReturn[]>([])
  const [refundDate, setRefundDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [refundMode, setRefundMode] = useState<number>(1)
  const [refundAmount, setRefundAmount] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [currentFY, setCurrentFY] = useState<number>(2024)
  const [error, setError] = useState<string>('')
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false)

  useEffect(() => {
    fetchVendors()
    fetchCurrentFY()
  }, [])

  useEffect(() => {
    if (selectedVendor > 0) {
      fetchOutstandingReturns(selectedVendor)
    } else {
      setOutstandingReturns([])
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

  const fetchOutstandingReturns = async (vendorId: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/purchase-returns?vendor=${vendorId}&limit=1000`)
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

  const handleAllocationChange = (returnId: number, value: string) => {
    const amount = parseFloat(value) || 0
    setOutstandingReturns(prev => prev.map(ret => 
      ret.return_id === returnId 
        ? { ...ret, allocated: amount }
        : ret
    ))
  }

  const handleAutoAllocate = () => {
    let remaining = parseFloat(refundAmount) || 0
    const updated = outstandingReturns.map(ret => {
      if (remaining <= 0) return { ...ret, allocated: 0 }
      
      const toAllocate = Math.min(remaining, ret.outstanding_refund)
      remaining -= toAllocate
      return { ...ret, allocated: toAllocate }
    })
    
    setOutstandingReturns(updated)
  }

  const handleClearAllocations = () => {
    setOutstandingReturns(prev => prev.map(ret => ({ ...ret, allocated: 0 })))
  }

  const getTotalAllocated = () => {
    return outstandingReturns.reduce((sum, ret) => sum + (ret.allocated || 0), 0)
  }

  const handleRecordRefund = () => {
    setError('')
    
    if (!selectedVendor) {
      setError('Please select a vendor')
      return
    }
    
    if (!refundAmount || parseFloat(refundAmount) <= 0) {
      setError('Please enter a valid refund amount')
      return
    }
    
    const totalAllocated = getTotalAllocated()
    const refundAmt = parseFloat(refundAmount)
    
    if (Math.abs(totalAllocated - refundAmt) > 0.01) {
      setError(`Total allocated (₹${totalAllocated.toFixed(2)}) must equal refund amount (₹${refundAmt.toFixed(2)})`)
      return
    }
    
    const allocations = outstandingReturns
      .filter(ret => ret.allocated && ret.allocated > 0)
      .map(ret => ({
        return_id: ret.return_id,
        allocated_amount: ret.allocated,
        notes: `Refund for ${ret.return_no}`
      }))
    
    if (allocations.length === 0) {
      setError('Please allocate refund to at least one return')
      return
    }
    
    // Show confirmation modal instead of submitting directly
    setShowConfirmModal(true)
  }

  const confirmRecordRefund = async () => {
    const allocations = outstandingReturns
      .filter(ret => ret.allocated && ret.allocated > 0)
      .map(ret => ({
        return_id: ret.return_id,
        allocated_amount: ret.allocated,
        notes: `Refund for ${ret.return_no}`
      }))
    
    const refundAmt = parseFloat(refundAmount)
    
    setLoading(true)
    try {
      const res = await fetch('/api/vendor-refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: selectedVendor,
          refund_amount: refundAmt,
          refund_mode: refundMode,
          refund_date: Math.floor(new Date(refundDate).getTime() / 1000),
          refund_type: 'RETURN_SPECIFIC',
          notes,
          allocations,
          fy: currentFY
        })
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        showSnackbar('success', `Refund recorded successfully! Refund #${data.data.refund.id}`)
        setTimeout(() => {
          router.push('/entry/purchasereturn-vendor')
        }, 500)
      } else {
        setError(data.error || 'Failed to record refund')
        showSnackbar('error', data.error || 'Failed to record refund')
      }
    } catch (error) {
      console.error('Error submitting refund:', error)
      setError('Failed to record refund')
      showSnackbar('error', 'Network error occurred while recording refund')
    } finally {
      setLoading(false)
      setShowConfirmModal(false)
    }
  }

  const totalAllocated = getTotalAllocated()
  const refundAmt = parseFloat(refundAmount) || 0
  const difference = refundAmt - totalAllocated

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
              <RefreshCw className="w-6 h-6" />
              Record Vendor Refund
            </h1>
          </div>

          {error && (
            <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Refund Details */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-slate-200 mb-4">Refund Details</h3>
            
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
                  Refund Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={refundDate}
                  onChange={(e) => setRefundDate(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Refund Amount <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0.00"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Refund Mode <span className="text-red-400">*</span>
                </label>
                <SearchableSelect
                  options={[
                    { id: '1', name: 'Bank Transfer' },
                    { id: '0', name: 'Cash' }
                  ]}
                  selectedValue={refundMode.toString()}
                  onSelectionChange={(value) => setRefundMode(parseInt(value || '1'))}
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
                  placeholder="Additional refund notes..."
                />
              </div>
            </div>
          </div>

          {/* Refund Allocation */}
          {selectedVendor > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Allocate Refund to Returns
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleAutoAllocate}
                    className="btn-primary text-sm"
                    disabled={!refundAmount || loading}
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
                <div className="text-center py-8 text-slate-400">Loading outstanding returns...</div>
              ) : outstandingReturns.length === 0 ? (
                <div className="text-center py-8 text-slate-400">No outstanding returns for this vendor</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Return No</th>
                        <th>Date</th>
                        <th className="text-right">Total Return</th>
                        <th className="text-right">Refunded</th>
                        <th className="text-right">Outstanding</th>
                        <th className="text-right">Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingReturns.map(ret => (
                        <tr key={ret.return_id}>
                          <td>{ret.return_no}</td>
                          <td>{new Date(ret.return_date * 1000).toLocaleDateString()}</td>
                          <td className="text-right">₹{ret.total_return.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="text-right">₹{ret.total_refunded.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="text-right font-semibold text-green-400">
                            ₹{ret.outstanding_refund.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={ret.allocated || ''}
                              onChange={(e) => handleAllocationChange(ret.return_id, e.target.value)}
                              max={ret.outstanding_refund}
                              className={`input w-24 text-right ${!refundAmount ? 'opacity-50 cursor-not-allowed' : ''}`}
                              placeholder="0.00"
                              disabled={!refundAmount}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {selectedVendor > 0 && outstandingReturns.length > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Refund Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Refund Amount</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{refundAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Total Allocated</p>
                  <p className="text-white text-xl font-semibold">
                    ₹{totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className={`bg-slate-700 rounded-lg p-4 ${Math.abs(difference) < 0.01 ? 'border-2 border-green-500' : 'border-2 border-red-500'}`}>
                  <p className="text-slate-400 text-sm mb-1">Difference</p>
                  <p className={`text-xl font-semibold ${Math.abs(difference) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                    ₹{Math.abs(difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
              onClick={handleRecordRefund}
              className="btn-primary"
              disabled={loading || !selectedVendor || Math.abs(difference) > 0.01}
            >
              Record Refund
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Confirm Refund Recording"
        message={`Record vendor refund of ₹${refundAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated to ${outstandingReturns.filter(r => r.allocated && r.allocated > 0).length} return(s)?`}
        confirmText="Record Refund"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Recording refund..."
        onConfirm={confirmRecordRefund}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  )
}
