import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { DollarSign, FileText, CheckCircle, Loader2 } from 'lucide-react'
import { SearchableSelect } from '../common/SearchableSelect'
import { ConfirmationModal } from '../ConfirmationModal'
import { PendingReturnsHint } from './PendingReturnsHint'
import { useSnackbar } from '../SnackbarProvider'
import SessionStorageService, { useSessionStorage } from '../../lib/sessionStorage'
import { getLocalDateString, convertDateToTimestamp } from '../../lib/date-utils'
import {
  PARTY, isPaymentDirection, cachedDetail, usePartyTransaction, usePartyOpenBills, useSavePartyTransaction,
  useCurrentFY, usePartyOptions, type Party, type Direction, type TxDetail
} from '../../hooks/usePartyTransactions'

/**
 * Record or edit a customer / vendor payment or refund (one component; the
 * two screens were copies).
 *
 * Payment direction (customer receipt, vendor payment): Bill Specific / Mixed /
 * On Account, allocated against the party's open bills - Sale and Invoice C for
 * a customer, purchases for a vendor.
 * Refund direction: always On Account (a return is refunded by completing it);
 * an old refund that was put against returns keeps those rows, which can be
 * kept or reduced.
 */
type PayType = 'BILL_SPECIFIC' | 'MIXED' | 'DIRECT' | 'RETURN_SPECIFIC'

interface AllocRow {
  key: string
  kind: string
  id: number
  label: string
  badge?: string
  name: string            // used in messages and notes
  date: number
  total: number
  paid: number
  outstanding: number     // what this transaction may put here (incl. its own share)
}

const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const toInputDate = (ts: number) => {
  const [d, m, y] = new Date(ts * 1000).toLocaleDateString('en-IN').split('/').map(n => n.padStart(2, '0'))
  return `${y}-${m}-${d}`
}

export function PartyTransactionForm({ party }: { party: Party }) {
  const P = PARTY[party]
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const editId = typeof router.query.edit === 'string' ? router.query.edit : undefined
  const editDirection = (router.query.type === 'income' || router.query.type === 'expense' ? router.query.type : undefined) as Direction | undefined
  const isEdit = !!editId

  const [partyId, setPartyId] = useSessionStorage<string>(`${party}-transaction-${party}`, '')
  const [date, setDate] = useSessionStorage<string>(`${party}-transaction-date`, getLocalDateString())
  const [direction, setDirection] = useState<Direction | ''>('')
  const [payType, setPayType] = useState<PayType>('BILL_SPECIFIC')
  const [mode, setMode] = useState(1)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  // ---- data
  const [initial] = useState(() => cachedDetail(party, editId, editDirection))
  const detailQuery = usePartyTransaction(party, editId, editDirection, initial)
  const detail: TxDetail | undefined = detailQuery.data
  const { data: parties = [] } = usePartyOptions(party)
  const { data: currentFY = 2024 } = useCurrentFY()
  const save = useSavePartyTransaction(party)

  const pid = parseInt(partyId) || 0
  const isPayment = direction !== '' && isPaymentDirection(party, direction)
  const bills = usePartyOpenBills(party, isPayment ? pid : undefined)

  // Forget the party and date on leaving, as before.
  useEffect(() => () => {
    sessionStorage.removeItem(`${party}-transaction-${party}`)
    sessionStorage.removeItem(`${party}-transaction-date`)
  }, [party])

  // ---- edit: fill the form once the transaction is in hand
  const loaded = useRef(false)
  useEffect(() => {
    if (!isEdit || !detail || loaded.current) return
    loaded.current = true
    setPartyId(String(detail.partyRef.id))
    setDirection(detail.direction)
    setPayType((detail.type || 'DIRECT') as PayType)
    setAmount(String(detail.amount))
    setMode(detail.mode)
    if (detail.date) setDate(toInputDate(detail.date))
    setNotes(detail.notes || '')
    setAlloc(Object.fromEntries(detail.allocations.map(a => [a.key, a.allocated])))
    SessionStorageService.remove(P.sessionModule(detail.isPayment), String(detail.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, detail])

  // ---- the rows to allocate against
  // What this transaction already has on a row counts as room on it: the bill's
  // remaining amount plus this payment's own share. A refund's old rows can only
  // be kept or reduced, so their room is what they hold.
  const own = isEdit && detail && detail.isPayment === isPayment && detail.partyRef.id === pid ? detail.allocations : []
  const rows: AllocRow[] = useMemo(() => {
    if (!direction || !pid) return []
    if (!isPayment) {
      return own.map(a => ({
        key: a.key, kind: a.kind, id: a.billId, label: a.label, name: a.label, date: a.date,
        total: a.total, paid: a.allocated, outstanding: a.allocated
      }))
    }
    const fresh = new Map((bills.data || []).map(b => [b.key, b]))
    const mine = own.map(a => {
      const f = fresh.get(a.key)
      return {
        key: a.key, kind: a.kind, id: a.billId,
        label: f?.label || (a.kind === 'salex' ? a.label : a.kind === 'sale' ? a.label.replace(/^INV-/, 'SINV-') : a.label.replace(/^INV-/, '')),
        badge: a.kind === 'salex' ? 'Invoice C' : undefined,
        name: billName(party, a.kind, f?.label || a.label), date: a.date, total: a.total,
        paid: f ? f.paid : a.allocated, outstanding: Math.max(0, (f ? f.outstanding : 0) + a.allocated)
      }
    })
    const mineKeys = new Set(mine.map(r => r.key))
    const others = (bills.data || []).filter(b => !mineKeys.has(b.key)).map(b => ({
      key: b.key, kind: b.kind, id: b.id, label: b.label, badge: b.badge, name: billName(party, b.kind, b.label),
      date: b.date, total: b.total, paid: b.paid, outstanding: b.outstanding
    }))
    return [...mine, ...others].filter(r => r.outstanding > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, pid, isPayment, bills.data, detail])

  // ---- user changes
  const changeParty = (v: string) => { setPartyId(v); setAlloc({}) }
  const changeDirection = (d: Direction) => {
    setDirection(d)
    setAlloc({})
    if (!isPaymentDirection(party, d)) setPayType('DIRECT')
  }

  const amountNum = parseFloat(amount) || 0
  const hasAmount = amountNum > 0
  const allocated = rows.reduce((s, r) => s + (alloc[r.key] || 0), 0)
  const difference = amountNum - allocated
  const chosen = rows.filter(r => (alloc[r.key] || 0) > 0)
  const over = rows.filter(r => (alloc[r.key] || 0) > r.outstanding + 0.005)
  const loadingRows = isPayment && bills.isLoading
  const itemsWord = isPayment ? (party === 'customer' ? 'invoices' : 'bills') : 'returns'

  const autoAllocate = () => {
    let left = amountNum
    const next: Record<string, number> = {}
    for (const r of rows) {
      const take = left > 0 ? Math.min(left, r.outstanding) : 0
      next[r.key] = take
      left -= take
    }
    setAlloc(next)
    const total = Object.values(next).reduce((s, n) => s + n, 0)
    if (total === 0) {
      showSnackbar('warning', isPayment
        ? `No ${itemsWord} available for allocation. All ${itemsWord} are fully paid.`
        : 'No returns available for allocation. All returns are fully refunded.')
    } else {
      showSnackbar('success', `Allocated ${money(total)} to ${itemsWord}`)
    }
  }

  const recordDisabled = (): boolean => {
    if (save.isPending || loadingRows) return true
    if (!partyId || !direction || !hasAmount) return true
    if (payType === 'DIRECT') return false
    if (payType === 'BILL_SPECIFIC') return over.length > 0 || allocated === 0 || Math.abs(amountNum - allocated) > 0.01
    if (payType === 'MIXED') return allocated === 0 || allocated > amountNum
    return false
  }

  const record = () => {
    setError('')
    if (!partyId) return setError(`Please select a ${party}`)
    if (!direction) return setError('Please select operation type')
    if (!hasAmount) return setError('Please enter a valid amount')
    if (payType !== 'DIRECT') {
      if (payType === 'BILL_SPECIFIC') {
        if (over.length) {
          const list = over.map(r => `${r.name} (Outstanding: ₹${r.outstanding.toLocaleString('en-IN')}, Trying to allocate: ₹${(alloc[r.key] || 0).toLocaleString('en-IN')})`).join(', ')
          return setError(`Cannot allocate more than allowed amount. Over-allocated ${itemsWord}: ${list}. Options: 1) Reduce allocation, or 2) Switch to MIXED payment type.`)
        }
        if (Math.abs(allocated - amountNum) > 0.01) {
          return setError(`Total allocated (₹${allocated.toFixed(2)}) must equal amount (₹${amountNum.toFixed(2)})`)
        }
      }
      if (payType === 'MIXED') {
        if (allocated === 0) return setError(`Please allocate at least some amount to ${itemsWord}`)
        if (allocated > amountNum) return setError(`Cannot allocate more (₹${allocated.toFixed(2)}) than payment amount (₹${amountNum.toFixed(2)})`)
      }
      if ((payType === 'BILL_SPECIFIC' || payType === 'MIXED') && chosen.length === 0) {
        return setError('Please allocate amount to at least one item')
      }
    }
    setConfirming(true)
  }

  const confirm = () => {
    const allocations = payType === 'DIRECT' ? [] : chosen.map(r => allocationPayload(party, isPayment, r, alloc[r.key]))
    const when = convertDateToTimestamp(date)
    const payload: any = { [P.idField]: partyId, notes, allocations, fy: currentFY }
    if (isPayment) Object.assign(payload, { payment_amount: amountNum, payment_mode: mode, payment_date: when, payment_type: payType })
    else Object.assign(payload, { refund_amount: amountNum, refund_mode: mode, refund_date: when, refund_type: payType === 'DIRECT' ? 'DIRECT' : 'RETURN_SPECIFIC' })

    save.mutate({ id: isEdit ? Number(editId) : undefined, isPayment, payload }, {
      onSuccess: (data: any) => {
        showSnackbar('success', `${isPayment ? 'Payment' : 'Refund'} ${isEdit ? 'updated' : 'recorded'} successfully!`)
        setConfirming(false)
        const id = isEdit ? Number(editId) : (data?.data?.payment?.id || data?.data?.refund?.id)
        if (id) router.push(P.viewUrl(id, direction as Direction))
      },
      onError: (e: any) => {
        setError(e?.message || `Failed to ${isEdit ? 'update' : 'record'} transaction`)
        setConfirming(false)
      }
    })
  }

  // ---- words that differ by party and direction
  const verb = isPayment
    ? (party === 'customer' ? 'receipt' : 'payment')
    : (party === 'customer' ? 'payment' : 'refund')
  const countWord = isPayment ? (party === 'customer' ? 'invoice(s)' : 'bill(s)') : 'return(s)'
  const confirmMessage = payType === 'DIRECT'
    ? `Record on account ${verb} of ${money(amountNum)}? This will be added to ${party}'s advance balance.`
    : payType === 'MIXED'
      ? `Record ${verb} of ${money(amountNum)} with ${money(allocated)} allocated to ${chosen.length} ${countWord} and ${money(difference)} as advance?`
      : `Record ${verb} of ${money(amountNum)} allocated to ${chosen.length} ${countWord}?`
  const onAccountTitle = `On Account ${verb.charAt(0).toUpperCase()}${verb.slice(1)}`
  const onAccountText = party === 'customer'
    ? (isPayment
      ? [`${money(amountNum)} will be added as advance payment from customer`, 'This creates a credit balance with the customer that can be used for future sales.']
      : [`${money(amountNum)} will be recorded as refund to customer`, 'Money paid back to the customer. It settles credit the customer has with you (a completed return or an overpayment).'])
    : (isPayment
      ? [`${money(amountNum)} will be added as advance payment to vendor`, 'This creates a credit balance with the vendor that can be used for future purchases.']
      : [`${money(amountNum)} will be recorded as a refund received from the vendor`, 'Money the vendor paid back. It settles credit you have with the vendor (a completed return or an overpayment).'])
  const directions: Direction[] = party === 'customer' ? ['income', 'expense'] : ['expense', 'income']
  const directionLabel = (d: Direction) => (isPaymentDirection(party, d) ? P.paymentVerb : P.refundVerb)
  const payTypes: [PayType, string, string][] = [
    ['BILL_SPECIFIC', P.paymentTypeLabel, party === 'customer' ? 'Allocate entire amount to invoices' : 'Allocate all to bills'],
    ['MIXED', 'Mixed', 'Allocate some, keep rest as advance'],
    ['DIRECT', 'On Account', 'No allocation, all advance']
  ]
  const headers = isPayment
    ? ['Invoice No', 'Total Bill', 'Paid']
    : [party === 'customer' ? 'Credit Note No' : 'Return No', 'Total Return', 'Refunded']

  return (
    <div className="space-y-6">
      {isEdit && !detail && !detailQuery.error && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center !mt-0">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            <div className="text-center">
              <p className="text-slate-200 font-medium">Loading Transaction Data</p>
              <p className="text-slate-400 text-sm">Please wait while we fetch the transaction details...</p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="p-6">
          {(error || detailQuery.error) && (
            <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-red-400">{error || 'Failed to load transaction for editing'}</p>
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-lg font-medium text-slate-200 mb-4">Transaction Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">{P.label} <span className="text-red-400">*</span></label>
                <SearchableSelect
                  options={parties}
                  selectedValue={partyId}
                  onSelectionChange={v => changeParty(v || '')}
                  placeholder={`Select ${party}...`}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Operation Type <span className="text-red-400">*</span></label>
                <div className="flex gap-4 items-center h-10">
                  {directions.map(d => (
                    <label key={d} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="operationType" value={d} checked={direction === d} onChange={() => changeDirection(d)} className="w-4 h-4 text-blue-600" />
                      <span className="text-slate-300">{directionLabel(d)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {isPayment && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Payment Type <span className="text-red-400">*</span></label>
                  <div className="flex gap-6">
                    {payTypes.map(([value, label, hint]) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="paymentType" value={value} checked={payType === value} onChange={() => setPayType(value)} className="w-4 h-4 text-blue-600" />
                        <div>
                          <span className="text-slate-300 font-medium">{label}</span>
                          <p className="text-xs text-slate-400">{hint}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Date <span className="text-red-400">*</span></label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Amount <span className="text-red-400">*</span></label>
                  <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode <span className="text-red-400">*</span></label>
                  <SearchableSelect
                    options={[{ id: '1', name: 'Bank' }, { id: '0', name: 'Cash' }]}
                    selectedValue={String(mode)}
                    onSelectionChange={v => setMode(parseInt(v || '1'))}
                    placeholder="Select mode..."
                    className="w-full"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input w-full" placeholder="Additional notes..." />
              </div>
            </div>
          </div>

          {pid > 0 && direction && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              {payType === 'DIRECT' ? (
                <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-6 text-center">
                  <DollarSign className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-blue-300 mb-2">{onAccountTitle}</h3>
                  <p className="text-slate-300">{onAccountText[0]}</p>
                  <p className="text-sm text-slate-400 mt-2">{onAccountText[1]}</p>
                  {!isPayment && <div className="text-left"><PendingReturnsHint party={party} partyId={pid} /></div>}
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Allocate to {isPayment ? P.billsWord : 'Returns'}
                    </h3>
                    <div className="flex gap-2">
                      <button onClick={autoAllocate} className="btn-primary text-sm" disabled={!amount || loadingRows}>Auto Allocate</button>
                      <button onClick={() => setAlloc({})} className="btn-secondary text-sm" disabled={loadingRows}>Clear All</button>
                    </div>
                  </div>

                  {loadingRows ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-3" />
                      <p>Loading outstanding {itemsWord}...</p>
                    </div>
                  ) : rows.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">No outstanding {itemsWord} for this {party}</div>
                  ) : (
                    <>
                      {!hasAmount && (
                        <div className="mb-3 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3">
                          Please enter Amount above to enable allocation
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>{headers[0]}</th>
                              <th>Date</th>
                              <th className="text-right">{headers[1]}</th>
                              <th className="text-right">{headers[2]}</th>
                              <th className="text-right">Outstanding</th>
                              <th className="text-right">Allocate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(r => (
                              <tr key={r.key}>
                                <td>
                                  {r.label}
                                  {r.badge && <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-purple-600 text-white">{r.badge}</span>}
                                </td>
                                <td>{new Date(r.date * 1000).toLocaleDateString()}</td>
                                <td className="text-right">{money(r.total)}</td>
                                <td className="text-right">{money(r.paid)}</td>
                                <td className="text-right font-semibold text-green-400">{money(r.outstanding)}</td>
                                <td className="text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={alloc[r.key] || ''}
                                    onChange={e => setAlloc(prev => ({ ...prev, [r.key]: parseFloat(e.target.value) || 0 }))}
                                    max={r.outstanding}
                                    disabled={!hasAmount}
                                    className="input w-24 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                                    placeholder="0"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {pid > 0 && direction && payType !== 'DIRECT' && rows.length > 0 && (
            <div className="border-t border-slate-600 pt-6 mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-4">Transaction Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Amount Allocated</p>
                  <p className="text-white text-xl font-semibold">{money(allocated)}</p>
                </div>
                <div className={`bg-slate-700 rounded-lg p-4 ${Math.abs(difference) < 0.01 ? 'border-2 border-green-500' : 'border-2 border-red-500'}`}>
                  <p className="text-slate-400 text-sm mb-1">Amount Difference</p>
                  <p className={`text-xl font-semibold ${Math.abs(difference) < 0.01 ? 'text-green-400' : 'text-red-400'}`}>
                    {money(Math.abs(difference))}
                    {difference > 0.01 ? ' (Unallocated)' : difference < -0.01 ? ' (Over-allocated)' : ' '}
                    {Math.abs(difference) < 0.01 && <CheckCircle className="inline w-5 h-5 ml-2" />}
                  </p>
                </div>
                <div className="bg-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Total Balance</p>
                  <p className="text-white text-xl font-semibold">{money(amountNum)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-4">
            <button onClick={() => router.back()} className="btn-secondary" disabled={save.isPending}>Cancel</button>
            <button
              onClick={record}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={recordDisabled()}
            >
              {save.isPending ? (isEdit ? 'Updating...' : 'Recording...') : (isEdit ? 'Update Transaction' : 'Record Transaction')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirming}
        title="Confirm Transaction"
        message={confirmMessage}
        confirmText={isEdit ? 'Update Transaction' : 'Record Transaction'}
        cancelText="Cancel"
        showLoading={save.isPending}
        loadingText="Recording Transaction..."
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/** "Invoice #12", "Invoice C #4", "Bill #7" - for messages and allocation notes. */
function billName(party: Party, kind: string, label: string) {
  const no = label.replace(/^(SINV-|INV-|C-)/, '')
  if (party === 'vendor') return `Bill #${no}`
  return kind === 'salex' ? `Invoice C #${no}` : `Invoice #${no}`
}

/** The allocation as each route reads it. Sale and Invoice C ids overlap, so the kind travels with the id. */
function allocationPayload(party: Party, isPayment: boolean, r: AllocRow, amount: number) {
  const no = r.label.replace(/^(SINV-|INV-|C-)/, '')
  if (party === 'customer' && isPayment) {
    return { ...(r.kind === 'salex' ? { invoicex_id: r.id } : { invoice_id: r.id }), allocated_amount: amount, notes: `Payment for ${r.kind === 'salex' ? 'Invoice C' : 'Invoice'} ${no}` }
  }
  if (party === 'customer') {
    const type = r.kind === 'salex_return' ? 'salex' : 'sale'
    return { return_id: r.id, type, ...(type === 'salex' ? { salex_return_id: r.id } : { sale_return_id: r.id }), allocated_amount: amount, notes: `Refund for ${r.label}` }
  }
  if (isPayment) return { purchase_id: r.id, allocated_amount: amount, notes: `Payment for Invoice ${no}` }
  return { return_id: r.id, allocated_amount: amount, notes: `Refund for ${r.label}` }
}
