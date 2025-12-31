import { useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

interface RefundAllocation {
  allocation_id: number
  refund_id: number
  allocated_amount: number
  allocation_date: number
  allocation_notes: string | null
  refund_date: number
  refund_amount: number
  refund_mode: number
  refund_mode_text: string
  refund_type: string
  refund_notes: string | null
  created_at: string
}

interface RefundSummary {
  total_return: number
  total_refunded: number
  remaining_amount: number
  refund_count: number
  is_fully_refunded: boolean
  is_partially_refunded: boolean
}

interface Props {
  summary: RefundSummary
  history: RefundAllocation[]
}

export default function RefundHistory({ summary, history }: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="card">
      <div className="p-6">
        <div 
          className="flex justify-between items-center cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Refund History
          </h3>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              summary.is_fully_refunded 
                ? 'bg-green-900/30 text-green-400 border border-green-700/30' 
                : summary.is_partially_refunded 
                ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30' 
                : 'bg-red-900/30 text-red-400 border border-red-700/30'
            }`}>
              {summary.is_fully_refunded ? 'Fully Refunded' : summary.is_partially_refunded ? 'Partially Refunded' : 'Not Refunded'}
            </span>
            {expanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
          </div>
        </div>

        {expanded && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Total Return</p>
                <p className="text-white text-xl font-semibold">
                  ₹{summary.total_return?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Total Refunded</p>
                <p className="text-green-400 text-xl font-semibold">
                  ₹{summary.total_refunded?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Remaining</p>
                <p className="text-orange-400 text-xl font-semibold">
                  ₹{summary.remaining_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <p className="text-slate-400 text-sm mb-1">Refunds</p>
                <p className="text-blue-400 text-xl font-semibold">
                  {summary.refund_count}
                </p>
              </div>
            </div>

            {/* Refund History Table */}
            {history.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Refund Date</th>
                      <th>Mode</th>
                      <th className="text-right">Refund Amount</th>
                      <th className="text-right">Allocated</th>
                      <th>Notes</th>
                      <th>Recorded On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((refund) => (
                      <tr key={refund.allocation_id}>
                        <td>{new Date(refund.refund_date * 1000).toLocaleDateString('en-IN')}</td>
                        <td>
                          <span className={`px-2 py-1 rounded text-xs ${
                            refund.refund_mode === 0 ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400'
                          }`}>
                            {refund.refund_mode_text}
                          </span>
                        </td>
                        <td className="text-right">
                          ₹{refund.refund_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right font-semibold text-green-400">
                          ₹{refund.allocated_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-slate-400 text-sm">
                          {refund.allocation_notes || refund.refund_notes || '-'}
                        </td>
                        <td className="text-slate-400 text-sm">
                          {new Date(refund.created_at).toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-700">
                    <tr>
                      <td colSpan={3} className="text-right font-semibold">
                        Total Refunded:
                      </td>
                      <td className="text-right font-bold text-green-400">
                        ₹{summary.total_refunded?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="mt-6 text-center py-8 bg-slate-700/30 rounded-lg">
                <p className="text-slate-400">No refunds recorded yet</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
