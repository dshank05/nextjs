import { DollarSign } from 'lucide-react'

interface PaymentAllocation {
  allocation_id: number
  payment_id: number
  allocated_amount: number
  allocation_date: number
  allocation_notes: string | null
  payment_date: number
  payment_amount: number
  payment_mode: number
  payment_mode_text: string
  payment_type: string
  payment_notes: string | null
  created_at: string
}

interface PaymentSummary {
  total_bill: number
  total_paid: number
  remaining_amount: number
  payment_count: number
  is_fully_paid: boolean
  is_partially_paid: boolean
}

interface Props {
  summary: PaymentSummary
  history: PaymentAllocation[]
}

export default function PaymentHistory({ summary, history }: Props) {
  return (
    <div className="card">
      <div className="p-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Payment History
          </h3>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            summary.is_fully_paid 
              ? 'bg-green-900/30 text-green-400 border border-green-700/30' 
              : summary.is_partially_paid 
              ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30' 
              : 'bg-red-900/30 text-red-400 border border-red-700/30'
          }`}>
            {summary.is_fully_paid ? 'Fully Paid' : summary.is_partially_paid ? 'Partially Paid' : 'Unpaid'}
          </span>
        </div>

        <div>
          {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Total Bill</p>
                <p className="text-white text-xl font-semibold">
                  ₹{summary.total_bill?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Total Paid</p>
                <p className="text-green-400 text-xl font-semibold">
                  ₹{summary.total_paid?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Remaining</p>
                <p className="text-orange-400 text-xl font-semibold">
                  ₹{summary.remaining_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Payments</p>
                <p className="text-blue-400 text-xl font-semibold">
                  {summary.payment_count}
                </p>
              </div>
            </div>

            {/* Payment History Table */}
            {history.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Payment Date</th>
                      <th>Mode</th>
                      <th className="text-right">Payment Amount</th>
                      <th className="text-right">Allocated</th>
                      <th>Notes</th>
                      <th>Recorded On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((payment) => (
                      <tr key={payment.allocation_id}>
                        <td>{new Date(payment.payment_date * 1000).toLocaleDateString('en-IN')}</td>
                        <td>
                          <span className={`px-2 py-1 rounded text-xs ${
                            payment.payment_mode === 0 ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400'
                          }`}>
                            {payment.payment_mode_text}
                          </span>
                        </td>
                        <td className="text-right">
                          ₹{payment.payment_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right font-semibold text-green-400">
                          ₹{payment.allocated_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-slate-400 text-sm">
                          {payment.allocation_notes || payment.payment_notes || '-'}
                        </td>
                        <td className="text-slate-400 text-sm">
                          {new Date(payment.created_at)?.toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-700">
                    <tr>
                      <td colSpan={3} className="text-right font-semibold">
                        Total Paid:
                      </td>
                      <td className="text-right font-bold text-green-400">
                        ₹{summary.total_paid?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="mt-6 text-center py-8 bg-slate-700/30 rounded-lg">
                <p className="text-slate-400">No payments recorded yet</p>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
