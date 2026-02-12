import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Edit } from 'lucide-react'
import SessionStorageService from '../../../lib/sessionStorage'

interface TransactionData {
  id: number
  vendor: {
    id: number
    name: string
    contact: string | null
    email: string | null
  }
  payment_date?: number
  refund_date?: number
  payment_amount?: number
  refund_amount?: number
  payment_mode?: number
  refund_mode?: number
  payment_mode_text?: string
  refund_mode_text?: string
  payment_type?: string
  refund_type?: string
  notes: string | null
  fy: number
  allocations: Array<{
    allocation_id: number
    purchase_id?: number
    return_id?: number
    invoice_no?: number
    debit_note_no?: string
    invoice_date?: number
    return_date?: number
    bill_reference?: string
    allocated_amount: number
    purchase_total?: number
    return_total?: number
    payment_status?: number
    payment_status_text?: string
  }>
  summary: {
    payment_amount?: number
    refund_amount?: number
    total_allocated: number
    allocation_count: number
    difference: number
  }
}

export default function ViewVendorTransactionPage() {
  const router = useRouter()
  const { id, type } = router.query
  const [transaction, setTransaction] = useState<TransactionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const isExpense = type === 'expense'

  useEffect(() => {
    if (id && type) {
      fetchTransaction()
    }
  }, [id, type])

  const fetchTransaction = async () => {
    setLoading(true)
    setError('')
    try {
      const endpoint = isExpense
        ? `/api/vendor-payments/${id}`
        : `/api/vendor-refunds/${id}`

      const response = await fetch(endpoint)
      const data = await response.json()

      if (data.success) {
        setTransaction(data.data)
      } else {
        setError(data.error || 'Failed to fetch transaction')
      }
    } catch (error) {
      console.error('Error fetching transaction:', error)
      setError('Failed to fetch transaction details')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateValue: number | string) => {
    if (typeof dateValue === 'string') {
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue)
        if (timestamp > 1000000000) {
          return new Date(timestamp * 1000).toLocaleDateString('en-IN')
        }
      }
      const parsed = new Date(dateValue)
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN')
      }
      return 'Invalid Date'
    }
    return new Date(dateValue * 1000).toLocaleDateString('en-IN')
  }

  const formatType = (type: string): string => {
    switch (type) {
      case 'BILL_SPECIFIC': return 'Bill Specific'
      case 'RETURN_SPECIFIC': return 'Return Specific'
      case 'MIXED': return 'Mixed'
      case 'DIRECT': return 'Direct'
      default: return type
    }
  }

  const getTypeBadgeColor = (type: string): string => {
    switch (type) {
      case 'BILL_SPECIFIC':
      case 'RETURN_SPECIFIC':
        return 'bg-blue-600'
      case 'MIXED':
        return 'bg-purple-600'
      case 'DIRECT':
        return 'bg-green-600'
      default:
        return 'bg-slate-600'
    }
  }

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>
      case 2: return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>
    }
  }

  const handleEditTransaction = () => {
    if (transaction) {
      // Cache transaction data to avoid unnecessary API call
      const module = isExpense ? 'vendor-payments' : 'vendor-refunds'
      SessionStorageService.set(module, id as string, transaction)
    }
    router.push(`/entry/vendor-transaction?edit=${id}&type=${type}`)
  }

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    )
  }

  if (error || !transaction) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">{error || 'Transaction not found'}</p>
      </div>
    )
  }

  const amount = isExpense ? transaction.payment_amount : transaction.refund_amount
  const date = isExpense ? transaction.payment_date : transaction.refund_date
  const mode = isExpense ? transaction.payment_mode : transaction.refund_mode
  const modeText = isExpense ? transaction.payment_mode_text : transaction.refund_mode_text
  const transactionType = isExpense ? transaction.payment_type : transaction.refund_type

  return (
    <div className="space-y-6">
      {/* Single Comprehensive Card */}
      <div className="card">
        {/* Transaction Banner Inside Card */}
        <div className={`border rounded p-4 mb-6 ${
          isExpense
            ? 'bg-blue-900/20 border-blue-700/50'
            : 'bg-green-900/20 border-green-700/50'
        }`}>
          <div className="text-center space-y-2">
            <h1 className={`text-xl font-bold ${
              isExpense ? 'text-blue-100' : 'text-green-100'
            }`}>
              {isExpense ? 'PAYMENT' : 'RECEIPT'} Transaction #{transaction.id} • {transaction.vendor.name}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Transaction Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Transaction ID:</span>
              <span className="text-white font-medium">{transaction.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Date:</span>
              <span className="text-white font-medium">{formatDate(date || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Mode:</span>
              <span className="text-white font-medium">{modeText}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Type:</span>
              <span className={`px-2 py-1 ${getTypeBadgeColor(transactionType || '')} text-white text-xs rounded-full font-medium`}>
                {formatType(transactionType || '')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Financial Year:</span>
              <span className="text-white font-medium">{transaction.fy}</span>
            </div>
          </div>

          {/* Column 2: Vendor Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Vendor:</span>
              <span className="text-white font-medium">{transaction.vendor.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{transaction.vendor.contact || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email:</span>
              <span className="text-white font-medium">{transaction.vendor.email || 'N/A'}</span>
            </div>
          </div>

          {/* Column 3: Allocation Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Allocated:</span>
              <span className="text-white font-medium">₹{transaction.summary.total_allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Allocations:</span>
              <span className="text-white font-medium">{transaction.summary.allocation_count} {isExpense ? 'bill(s)' : 'return(s)'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Difference:</span>
              <span className={`font-medium ${
                Math.abs(transaction.summary.difference) < 0.01 
                  ? 'text-green-400' 
                  : 'text-yellow-400'
              }`}>
                {Math.abs(transaction.summary.difference) < 0.01 
                  ? '✓ Fully Allocated'
                  : `₹${transaction.summary.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Advance`
                }
              </span>
            </div>
          </div>

          {/* Column 4: Notes */}
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Notes:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {transaction.notes || 'No notes available'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Row - Separate from columns */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <button
              onClick={handleEditTransaction}
              className="btn-primary flex items-center gap-2"
              title="Edit Transaction"
            >
              <Edit className="w-4 h-4" />
              Edit Transaction
            </button>
          </div>
        </div>

        {/* Allocation Details Table */}
        {transaction.allocations.length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4 px-6">
              {isExpense ? 'Bill Allocations' : 'Return Allocations'}
            </h3>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>{isExpense ? 'Invoice No' : 'Debit Note'}</th>
                    {isExpense && <th>Bill Reference</th>}
                    <th>Date</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Allocated</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transaction.allocations.map((alloc, index) => (
                    <tr key={alloc.allocation_id}>
                      <td>{index + 1}</td>
                      <td className="font-mono text-white">
                        {isExpense ? `INV-${alloc.invoice_no}` : alloc.debit_note_no}
                      </td>
                      {isExpense && (
                        <td className="text-slate-300">{alloc.bill_reference || 'N/A'}</td>
                      )}
                      <td className="text-slate-300">
                        {formatDate((isExpense ? alloc.invoice_date : alloc.return_date) || 0)}
                      </td>
                      <td className="text-right text-slate-300">
                        ₹{((isExpense ? alloc.purchase_total : alloc.return_total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="text-right font-semibold text-green-400">
                        ₹{alloc.allocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>{getStatusBadge(alloc.payment_status)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td></td>
                    <td></td>
                    {isExpense && <td></td>}
                    <td className="text-white font-bold">Total:</td>
                    <td></td>
                    <td className="text-right text-white font-bold bg-blue-600/10 border-l border-blue-500/30">
                      ₹{transaction.summary.total_allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
