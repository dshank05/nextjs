import { useRouter } from 'next/router'
import Link from 'next/link'
import { Edit } from 'lucide-react'
import SessionStorageService from '../../lib/sessionStorage'
import { PARTY, usePartyTransaction, type Party, type Direction } from '../../hooks/usePartyTransactions'

/**
 * One payment or refund (customer or vendor): banner, details, allocation
 * summary, notes, Edit, and the bills or returns it was put against.
 * `?type=income|expense` says which: a customer payment is income, a vendor
 * payment is expense.
 */
const TYPE_LABEL: Record<string, string> = { BILL_SPECIFIC: 'Bill Specific', RETURN_SPECIFIC: 'Return Specific', MIXED: 'Mixed', DIRECT: 'Direct' }
const TYPE_COLOR: Record<string, string> = { BILL_SPECIFIC: 'bg-blue-600', RETURN_SPECIFIC: 'bg-blue-600', MIXED: 'bg-purple-600', DIRECT: 'bg-green-600' }
const STATUS: Record<number, [string, string]> = { 0: ['Unpaid', 'bg-yellow-600'], 1: ['Paid', 'bg-green-600'], 2: ['Partially Paid', 'bg-orange-600'] }
const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const day = (ts: number | null | undefined) => new Date((ts || 0) * 1000).toLocaleDateString('en-IN')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}:</span>
      {children}
    </div>
  )
}

export function PartyTransactionView({ party }: { party: Party }) {
  const P = PARTY[party]
  const router = useRouter()
  const id = router.query.id as string | undefined
  const direction = (router.query.type === 'income' || router.query.type === 'expense' ? router.query.type : undefined) as Direction | undefined
  const { data: tx, isLoading, error } = usePartyTransaction(party, id, direction)

  if (isLoading || !router.isReady) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    )
  }
  if (error || !tx) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">{(error as Error | null)?.message || 'Transaction not found'}</p>
      </div>
    )
  }

  const isIncome = tx.direction === 'income'
  const banner = tx.isPayment ? P.paymentBanner : P.refundBanner
  const itemsWord = tx.isPayment ? (party === 'customer' ? 'invoice(s)' : 'bill(s)') : 'return(s)'
  const showReference = party === 'vendor' && tx.isPayment
  const diff = tx.summary.difference

  const edit = () => {
    // The edit screen reads this instead of fetching again.
    SessionStorageService.set(P.sessionModule(tx.isPayment), String(tx.id), tx)
    router.push(`${P.formUrl}?edit=${tx.id}&type=${tx.direction}`)
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className={`border rounded p-4 mb-6 ${isIncome ? 'bg-green-900/20 border-green-700/50' : 'bg-blue-900/20 border-blue-700/50'}`}>
          <div className="text-center space-y-2">
            <h1 className={`text-xl font-bold ${isIncome ? 'text-green-100' : 'text-blue-100'}`}>
              {banner} Transaction #{tx.id} • {tx.partyRef.name}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-3">
            <Row label="Total"><span className="text-white font-bold text-lg">{money(tx.amount)}</span></Row>
            <Row label="Transaction ID"><span className="text-white font-medium">{tx.id}</span></Row>
            <Row label="Date"><span className="text-white font-medium">{day(tx.date)}</span></Row>
            <Row label="Payment Mode"><span className="text-white font-medium">{tx.mode === 0 ? 'Cash' : 'Bank'}</span></Row>
            <Row label="Type">
              <span className={`px-2 py-1 ${TYPE_COLOR[tx.type] || 'bg-slate-600'} text-white text-xs rounded-full font-medium`}>{TYPE_LABEL[tx.type] || tx.type}</span>
            </Row>
            <Row label="Financial Year"><span className="text-white font-medium">{tx.fy}</span></Row>
          </div>

          <div className="space-y-3">
            <Row label={P.label}><span className="text-white font-medium">{tx.partyRef.name}</span></Row>
            <Row label="Contact"><span className="text-white font-medium">{tx.partyRef.contact || 'N/A'}</span></Row>
            <Row label="Email"><span className="text-white font-medium">{tx.partyRef.email || 'N/A'}</span></Row>
          </div>

          <div className="space-y-3">
            <Row label="Total Allocated"><span className="text-white font-medium">{money(tx.summary.total_allocated)}</span></Row>
            <Row label="Allocations"><span className="text-white font-medium">{tx.summary.allocation_count} {itemsWord}</span></Row>
            <Row label="Difference">
              <span className={`font-medium ${Math.abs(diff) < 0.01 ? 'text-green-400' : 'text-yellow-400'}`}>
                {Math.abs(diff) < 0.01 ? '✓ Fully Allocated' : `${money(diff)} ${tx.isPayment ? 'Advance' : 'On account'}`}
              </span>
            </Row>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-400">Notes:</span></div>
            <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{tx.notes || 'No notes available'}</div>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <button onClick={edit} className="btn-primary flex items-center gap-2" title="Edit Transaction">
              <Edit className="w-4 h-4" />
              Edit Transaction
            </button>
          </div>
        </div>

        {tx.allocations.length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4 px-6">
              {tx.isPayment ? `${party === 'customer' ? 'Invoice' : 'Bill'} Allocations` : 'Return Allocations'}
            </h3>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">SN</th>
                    <th>{tx.isPayment ? 'Invoice No' : party === 'customer' ? 'Credit Note' : 'Debit Note'}</th>
                    {showReference && <th>Bill Reference</th>}
                    <th>Date</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Allocated</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.allocations.map((a, i) => (
                    <tr key={a.key}>
                      <td>{i + 1}</td>
                      <td className="font-mono text-white">
                        {a.href ? <Link href={a.href} className="text-blue-400 hover:underline">{a.label}</Link> : a.label}
                        {a.kindLabel && <span className="ml-2 text-xs text-slate-400">({a.kindLabel})</span>}
                      </td>
                      {showReference && <td className="text-slate-300">{a.reference || 'N/A'}</td>}
                      <td className="text-slate-300">{day(a.date)}</td>
                      <td className="text-right text-slate-300">{money(a.total)}</td>
                      <td className="text-right font-semibold text-green-400">{money(a.allocated)}</td>
                      <td>
                        {a.status !== undefined && STATUS[a.status] && (
                          <span className={`px-2 py-1 ${STATUS[a.status][1]} text-white text-xs rounded-full`}>{STATUS[a.status][0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td></td>
                    <td></td>
                    {showReference && <td></td>}
                    <td className="text-white font-bold">Total:</td>
                    <td></td>
                    <td className="text-right text-white font-bold bg-blue-600/10 border-l border-blue-500/30">{money(tx.summary.total_allocated)}</td>
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
