import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { SearchableSelect } from '../common/SearchableSelect'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { ExportMenu } from '../common/ExportMenu'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { TransactionTotals } from './TransactionTotals'
import { useSessionStorage } from '../../lib/sessionStorage'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'
import { PARTY, usePartyTransactionList, useDeletePartyTransaction, usePartyOptions, type Party, type Direction } from '../../hooks/usePartyTransactions'

/**
 * Customer Transactions and Vendor Transactions lists (one component; the two
 * pages were copies). A party must be picked first; then date / mode / type /
 * direction filters, period totals, the table, export, view and delete.
 */
const TYPE_LABEL: Record<string, string> = { BILL_SPECIFIC: 'Bill Specific', RETURN_SPECIFIC: 'Return Specific', MIXED: 'Mixed', DIRECT: 'Direct' }
const TYPE_COLOR: Record<string, string> = { BILL_SPECIFIC: 'bg-blue-600', RETURN_SPECIFIC: 'bg-blue-600', MIXED: 'bg-purple-600', DIRECT: 'bg-green-600' }
const thisMonth = () => {
  const now = new Date()
  return [formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)), formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0))]
}

export function PartyTransactionList({ party }: { party: Party }) {
  const P = PARTY[party]
  const { showSnackbar } = useSnackbar()
  const limit = 50
  const nameKey = `${party}_name`
  const [page, setPage] = useState(1)
  const [partyId, setPartyId] = useSessionStorage<string>(`${party}-transactions-${party}`, '')
  const [dateFrom, setDateFrom] = useSessionStorage<string>(`${party}-transactions-dateFrom`, '')
  const [dateTo, setDateTo] = useSessionStorage<string>(`${party}-transactions-dateTo`, '')
  const [mode, setMode] = useState('')
  const [payType, setPayType] = useState('')
  const [direction, setDirection] = useState<'all' | Direction>('all')
  const [sortBy, setSortBy] = useState('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [toDelete, setToDelete] = useState<{ id: number; direction: Direction } | null>(null)

  const { data: parties = [] } = usePartyOptions(party)
  const { data, isLoading } = usePartyTransactionList(party, {
    partyId, page, limit, sortBy, sortOrder, type: direction, dateFrom, dateTo, payment_mode: mode, payment_type: payType
  })
  const del = useDeletePartyTransaction(party)
  const rows = data?.rows || []
  const total = data?.pagination?.total || 0
  const totalPages = data?.pagination?.totalPages || 1
  const shown = !!partyId

  // Default to this month unless the tab already has a range; forget the filters on leaving.
  useEffect(() => {
    if (!sessionStorage.getItem(`${party}-transactions-dateFrom`) && !sessionStorage.getItem(`${party}-transactions-dateTo`)) {
      const [f, t] = thisMonth(); setDateFrom(f); setDateTo(t)
    }
    return () => {
      for (const k of [party, 'dateFrom', 'dateTo']) sessionStorage.removeItem(`${party}-transactions-${k}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    setPartyId('')
    const [f, t] = thisMonth(); setDateFrom(f); setDateTo(t)
    setMode(''); setPayType(''); setDirection('all'); setPage(1)
  }
  const sort = (field: string) => {
    if (sortBy === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('asc') }
  }
  const icon = (field: string) => (sortBy !== field ? null : sortOrder === 'asc' ? <ArrowUp className="inline w-4 h-4 ml-1" /> : <ArrowDown className="inline w-4 h-4 ml-1" />)
  const dirBadge = (t: 'INCOME' | 'EXPENSE') =>
    <span className={`px-2 py-1 ${t === 'INCOME' ? 'bg-green-600' : 'bg-red-600'} text-white text-xs rounded-full font-medium`}>{t}</span>
  const numbers = (list: string[]) => {
    if (!list || list.length === 0) return <span className="text-slate-500">Direct</span>
    if (list.length <= 3) return <span className="text-slate-300">{list.join(', ')}</span>
    return <span className="text-slate-300">{list.slice(0, 3).join(', ')}<span className="text-blue-400 ml-1">+{list.length - 3} more</span></span>
  }
  const pages = () => { const out: number[] = []; for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) out.push(i); return out }

  const confirmDelete = () => {
    if (!toDelete) return
    del.mutate(toDelete, {
      onSuccess: () => { showSnackbar('success', 'Transaction deleted successfully', 3000); setToDelete(null) },
      onError: (e: any) => showSnackbar('error', e.message || 'Failed to delete transaction', 5000)
    })
  }

  const directions = party === 'customer'
    ? [{ id: 'all', name: 'All Transactions' }, { id: 'income', name: 'Income Only' }, { id: 'expense', name: 'Expense Only' }]
    : [{ id: 'all', name: 'All Transactions' }, { id: 'expense', name: 'Expense Only' }, { id: 'income', name: 'Income Only' }]
  const totalsLabels = party === 'customer'
    ? { income: 'Received (income)', expense: 'Refunded (expense)' }
    : { income: 'Refunds received (income)', expense: 'Paid (expense)' }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-slate-200">{P.label} Transactions</h1>
            <div className="flex items-center gap-2">
              {shown && (
                <ExportMenu
                  data={rows.map(t => ({
                    id: t.id,
                    invoice_numbers: t.invoice_numbers.length > 0 ? t.invoice_numbers.join(', ') : 'Direct',
                    date: new Date(t.date * 1000).toLocaleDateString('en-IN'),
                    [nameKey]: t[nameKey],
                    amount: t.amount,
                    transaction_type: t.transaction_type,
                    payment_mode: t.payment_mode === 0 ? 'Cash' : 'Bank',
                    payment_type: TYPE_LABEL[t.payment_type] || t.payment_type
                  }))}
                  columns={[
                    { key: 'id', label: 'ID', enabled: true }, { key: 'invoice_numbers', label: 'Invoice No.', enabled: true },
                    { key: 'date', label: 'Date', enabled: true }, { key: nameKey, label: P.label, enabled: true },
                    { key: 'amount', label: 'Amount', enabled: true }, { key: 'transaction_type', label: 'Type', enabled: true },
                    { key: 'payment_mode', label: 'Payment Mode', enabled: true }, { key: 'payment_type', label: 'Payment Type', enabled: true }
                  ]}
                  config={{ title: `${P.label} Transactions`, fileName: `${party}-transactions-${getLocalDateString()}` }}
                />
              )}
              <Link href={P.formUrl} className="btn-primary">Create Transaction</Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{P.label} <span className="text-red-400">*</span></label>
              <SearchableSelect
                options={[{ id: '', name: `Select ${party}...` }, ...parties]}
                selectedValue={partyId}
                onSelectionChange={(v) => { setPartyId(v || ''); setPage(1) }}
                placeholder={`Select ${party}...`}
              />
            </div>
            {shown && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
                  <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e); setPage(1) }} placeholder="Select date range..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
                  <SearchableSelect options={[{ id: '', name: 'All Modes' }, { id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
                    selectedValue={mode} onSelectionChange={(v) => { setMode(v || ''); setPage(1) }} placeholder="Select mode..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Payment Type</label>
                  <SearchableSelect
                    options={[{ id: '', name: 'All Types' }, { id: 'BILL_SPECIFIC', name: 'Bill Specific' }, { id: 'RETURN_SPECIFIC', name: 'Return Specific' }, { id: 'MIXED', name: 'Mixed' }, { id: 'DIRECT', name: 'Direct' }]}
                    selectedValue={payType} onSelectionChange={(v) => { setPayType(v || ''); setPage(1) }} placeholder="Select type..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
                  <SearchableSelect options={directions} selectedValue={direction}
                    onSelectionChange={(v) => { setDirection(((v || 'all') as any)); setPage(1) }} placeholder="Select type..." />
                </div>
                <div className="flex items-end">
                  <button onClick={clear} className="btn-secondary w-full">Clear All Filters</button>
                </div>
              </>
            )}
          </div>

          {!shown ? (
            <div className="text-center py-16">
              <h3 className="text-lg font-medium text-slate-300 mb-2">Select a {P.label} to View Transactions</h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Choose a {party} from the dropdown above to view their payment and refund transactions for the current month.
              </p>
            </div>
          ) : (
            <>
              <TransactionTotals totals={data?.totals} incomeLabel={totalsLabels.income} expenseLabel={totalsLabels.expense} />
              <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
                <div>Showing {rows.length > 0 ? (page - 1) * limit + 1 : 0} to {Math.min(page * limit, total)} of {total} transactions</div>
                <div>Page {page} of {totalPages}</div>
              </div>
              <div className="overflow-x-auto relative">
                {isLoading && (
                  <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                  </div>
                )}
                <table className="table">
                  <thead>
                    <tr>
                      <th>S.N</th>
                      <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('id')}>ID {icon('id')}</th>
                      <th>Invoice No.</th>
                      <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('date')}>Date {icon('date')}</th>
                      <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort(nameKey)}>{P.label} {icon(nameKey)}</th>
                      <th className="text-right cursor-pointer hover:bg-slate-700/50" onClick={() => sort('amount')}>Amount {icon('amount')}</th>
                      <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('type')}>Type {icon('type')}</th>
                      <th>Payment Mode</th>
                      <th>Payment Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t, i) => {
                      const d: Direction = t.transaction_type === 'INCOME' ? 'income' : 'expense'
                      return (
                        <tr key={`${t.transaction_type}-${t.id}`}>
                          <td>{(page - 1) * limit + i + 1}</td>
                          <td className="font-mono text-slate-300">{t.id}</td>
                          <td className="text-slate-300 text-sm">{numbers(t.invoice_numbers)}</td>
                          <td className="text-slate-300">{new Date(t.date * 1000).toLocaleDateString('en-IN')}</td>
                          <td className="text-slate-300"><div className="font-medium">{t[nameKey]}</div></td>
                          <td className="text-right text-slate-300 font-semibold">₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td>{dirBadge(t.transaction_type)}</td>
                          <td className="text-slate-300">{t.payment_mode === 0 ? 'Cash' : 'Bank'}</td>
                          <td><span className={`px-2 py-1 ${TYPE_COLOR[t.payment_type] || 'bg-slate-600'} text-white text-xs rounded-full`}>{TYPE_LABEL[t.payment_type] || t.payment_type}</span></td>
                          <td>
                            <div className="flex items-center space-x-2">
                              <Link href={P.viewUrl(t.id, d)} title="View Transaction Details" className="btn-icon text-slate-300 hover:text-blue-400"><Eye className="w-4 h-4" /></Link>
                              <button onClick={() => setToDelete({ id: t.id, direction: d })} title="Delete Transaction" className="btn-icon text-red-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {rows.length === 0 && !isLoading && <div className="text-center py-8 text-slate-400">No transactions found with the current filters.</div>}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                  <button onClick={() => setPage(page - 1)} disabled={page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
                  <div className="flex space-x-2">
                    {page > 3 && <><button onClick={() => setPage(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button><span className="text-slate-400">...</span></>}
                    {pages().map(p => (
                      <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-300'}`}>{p}</button>
                    ))}
                    {page < totalPages - 2 && <><span className="text-slate-400">...</span><button onClick={() => setPage(totalPages)} className="px-3 py-1 rounded hover:bg-slate-700 text-slate-300">{totalPages}</button></>}
                  </div>
                  <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className="btn-secondary disabled:opacity-50">Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete Transaction?"
        message={`This action is irreversible. The transaction will be permanently deleted and all allocations will be removed. Payment/refund statuses for affected ${party === 'customer' ? 'invoices' : 'bills'}/returns will be recalculated.`}
        confirmText="Delete Transaction"
        cancelText="Cancel"
        showLoading={del.isPending}
        loadingText="Deleting..."
      />
    </div>
  )
}
