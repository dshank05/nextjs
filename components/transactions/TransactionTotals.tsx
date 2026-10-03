/**
 * Income, expense and net for the whole filtered period (all pages), as the
 * server adds them up. The lists showed only a count before.
 */
export interface TransactionTotalsData {
  income: number
  expense: number
  net: number
  count: number
}

const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function TransactionTotals({ totals, incomeLabel, expenseLabel }: {
  totals?: TransactionTotalsData
  incomeLabel: string
  expenseLabel: string
}) {
  if (!totals) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      <div className="rounded border border-green-700/40 bg-green-900/20 p-3">
        <div className="text-xs text-slate-400">{incomeLabel}</div>
        <div className="text-lg font-semibold text-green-300">{money(totals.income)}</div>
      </div>
      <div className="rounded border border-red-700/40 bg-red-900/20 p-3">
        <div className="text-xs text-slate-400">{expenseLabel}</div>
        <div className="text-lg font-semibold text-red-300">{money(totals.expense)}</div>
      </div>
      <div className="rounded border border-slate-600 bg-slate-800/40 p-3">
        <div className="text-xs text-slate-400">Net ({totals.count} transactions)</div>
        <div className={`text-lg font-semibold ${totals.net < 0 ? 'text-red-300' : 'text-white'}`}>{money(totals.net)}</div>
      </div>
    </div>
  )
}
