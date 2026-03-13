import { useRouter } from 'next/router'
import Link from 'next/link'
import { Edit } from 'lucide-react'
import SessionStorageService from '../../../lib/sessionStorage'
import { useCustomerPayment, useCustomerRefund } from '../../../hooks/useCustomers'
import type { TransactionData } from '../../../types/customer-transactions'

export default function ViewCustomerTransactionPage() {
  const router = useRouter()
  const { id, type } = router.query

  const isIncome = type === 'income'

  // React Query hooks - fetch based on transaction type
  const { data: paymentData, isLoading: paymentLoading, error: paymentError } = useCustomerPayment(
    isIncome ? (id as string) : undefined
  )
  const { data: refundData, isLoading: refundLoading, error: refundError } = useCustomerRefund(
    !isIncome ? (id as string) : undefined
  )

  const loading = isIncome ? paymentLoading : refundLoading
  const error = isIncome ? paymentError : refundError
  const rawTransaction = isIncome ? paymentData : refundData

  // Process transaction data
  let transaction: TransactionData | null = null
  if (rawTransaction) {
    const amount = isIncome ? rawTransaction.payment_amount : rawTransaction.refund_amount
    const totalAllocated = rawTransaction.total_allocated || 
      (rawTransaction.allocations?.reduce((sum: number, a: any) => sum + Number(a.allocated_amount), 0) || 0)
    
    transaction = {
      ...rawTransaction,
      summary: rawTransaction.summary || {
        payment_amount: rawTransaction.payment_amount,
        refund_amount: rawTransaction.refund_amount,
        total_allocated: totalAllocated,
        allocation_count: rawTransaction.allocations?.length || 0,
        difference: (amount || 0) - totalAllocated
      },
      customer: rawTransaction.customer || {
        id: rawTransaction.customer_id || 0,
        name: rawTransaction.customer_name,
        contact: rawTransaction.customer?.contact || null,
        email: rawTransaction.customer?.email || null
      }
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
      const module = isIncome ? 'customer-payments' : 'customer-refunds'
      SessionStorageService.set(module, id as string, transaction)
    }
    router.push(`/customer-transactions/create?edit=${id}&type=${type}`)
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
        <p className="text-center text-slate-400">{error?.message || 'Transaction not found'}</p>
      </div>
    )
  }

  const amount = isIncome ? transaction.payment_amount : transaction.refund_amount
  const date = isIncome ? transaction.payment_date : transaction.refund_date
  const mode = isIncome ? transaction.payment_mode : transaction.refund_mode
  const modeText = isIncome ? transaction.payment_mode_text : transaction.refund_mode_text
  const transactionType = isIncome ? transaction.payment_type : transaction.refund_type
  
  // Safe access to summary
  const summary = transaction.summary || {
    payment_amount: amount,
    refund_amount: amount,
    total_allocated: 0,
    allocation_count: 0,
    difference: amount || 0
  }

  return (
    <div className="space-y-6">
      {/* Single Comprehensive Card */}
      <div className="card">
        {/* Transaction Banner Inside Card */}
        <div className={`border rounded p-4 mb-6 ${
          isIncome
            ? 'bg-green-900/20 border-green-700/50'
            : 'bg-blue-900/20 border-blue-700/50'
        }`}>
          <div className="text-center space-y-2">
            <h1 className={`text-xl font-bold ${
              isIncome ? 'text-green-100' : 'text-blue-100'
            }`}>
              {isIncome ? 'RECEIPT' : 'PAYMENT'} Transaction #{transaction.id} • {transaction.customer?.name || 'Unknown Customer'}
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
              <span className="text-white font-medium">{modeText || (mode === 0 ? 'Cash' : 'Bank')}</span>
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

          {/* Column 2: Customer Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Customer:</span>
              <span className="text-white font-medium">{transaction.customer?.name || 'Unknown Customer'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{transaction.customer?.contact || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email:</span>
              <span className="text-white font-medium">{transaction.customer?.email || 'N/A'}</span>
            </div>
          </div>

          {/* Column 3: Allocation Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Allocated:</span>
              <span className="text-white font-medium">₹{summary.total_allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Allocations:</span>
              <span className="text-white font-medium">{summary.allocation_count} {isIncome ? 'invoice(s)' : 'return(s)'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Difference:</span>
              <span className={`font-medium ${
                Math.abs(summary.difference) < 0.01 
                  ? 'text-green-400' 
                  : 'text-yellow-400'
              }`}>
                {Math.abs(summary.difference) < 0.01 
                  ? '✓ Fully Allocated'
                  : `₹${summary.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Advance`
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

        {/* Actions Row */}
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
        {transaction.allocations && transaction.allocations.length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4 px-6">
              {isIncome ? 'Invoice Allocations' : 'Return Allocations'}
            </h3>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>{isIncome ? 'Invoice No' : 'Credit Note'}</th>
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
                        {isIncome 
                          ? `INV-${alloc.invoice_no}` 
                          : alloc.credit_note_no || `RET-${alloc.return_id}`
                        }
                        {alloc.type && (
                          <span className="ml-2 text-xs text-slate-400">
                            ({alloc.type === 'salex' ? 'Salex' : 'Sale'})
                          </span>
                        )}
                      </td>
                      <td className="text-slate-300">
                        {formatDate((isIncome ? alloc.invoice_date : alloc.return_date) || 0)}
                      </td>
                      <td className="text-right text-slate-300">
                        ₹{((isIncome ? alloc.invoice_total : alloc.return_total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                    <td className="text-white font-bold">Total:</td>
                    <td></td>
                    <td className="text-right text-white font-bold bg-blue-600/10 border-l border-blue-500/30">
                      ₹{summary.total_allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
