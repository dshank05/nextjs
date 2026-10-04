import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { Calendar, Package, Loader } from 'lucide-react'
import { SearchableSelect } from '../common/SearchableSelect'
import { ClearableInput } from '../common/ClearableInput'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import SessionStorageService from '../../lib/sessionStorage'
import { getLocalDateString } from '../../lib/date-utils'
import { useDebounce } from '../../hooks/useDebounce'
import { BillPicker, type Picked } from './BillPicker'
import {
  RET, REFUND_STATUS, reasonFor, cachedReturn, useReturnDetail, useReturnBills, useReturnReasons, useReturnParties, useSaveReturn,
  readJson, type ReturnParty, type ReturnBill
} from '../../hooks/useReturns'

/**
 * Create or edit a sale / Invoice C return or a purchase return (one
 * component; RETURNS_PLAN R4).
 *
 * Create: pick the party; their bills of the last 3 months load (Load More
 * goes 3 months further back, pages of 50); pick lines, quantities, prices,
 * reasons. `?invoice=<id>&type=invoice|invoicex` (customer) or
 * `?purchase=<id>` (vendor) opens with that bill found and expanded - the
 * "Create return" button on a bill's view.
 * Edit (`?id=`, plus `&type=` for a customer): the return's own bills, each
 * line's room counting everything except this return; line notes are kept.
 * The server prices, taxes and checks every line; the screen previews.
 */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const localDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return ymd ? new Date(y, m - 1, d).toLocaleDateString() : ''
}
const monthsBack = (ymd: string, months: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return getLocalDateString(new Date(y, m - 1 - months, d))
}

export function ReturnForm({ party }: { party: ReturnParty }) {
  const R = RET[party]
  const isCustomer = party === 'customer'
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const q = router.query
  const editId = typeof q.id === 'string' ? q.id : undefined
  const editType = typeof q.type === 'string' ? q.type : undefined
  const isEdit = !!editId
  const linkBillId = typeof (isCustomer ? q.invoice : q.purchase) === 'string' ? String(isCustomer ? q.invoice : q.purchase) : undefined
  const linkType = isCustomer ? (editType === 'invoicex' ? 'invoicex' : 'invoice') : undefined

  const [partyId, setPartyId] = useState('')
  const [returnDate, setReturnDate] = useState(getLocalDateString())
  const [status, setStatus] = useState(0)
  const [mode, setMode] = useState(1)
  const [paymentDate, setPaymentDate] = useState('')
  const [notes, setNotes] = useState('')
  const [pf, setPf] = useState(0)
  const [picked, setPicked] = useState<Record<string, Picked>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [focusView, setFocusView] = useState(false)
  const [billSearch, setBillSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState(false)

  const { data: parties = [], isLoading: loadingParties } = useReturnParties(party)
  const { data: reasons = [] } = useReturnReasons(party)
  const save = useSaveReturn(party)

  // ---- edit: the return, from the view's cache or the server
  const [initial] = useState(() => cachedReturn(party, editId, editType))
  const detailQuery = useReturnDetail(party, editId, editType, initial)
  const detail = detailQuery.data
  const loaded = useRef(false)
  useEffect(() => {
    if (!isEdit || !detail || loaded.current) return
    loaded.current = true
    setPartyId(String(detail.partyId))
    setReturnDate(detail.date || getLocalDateString())
    setStatus(detail.paymentStatus === 1 ? 1 : 0)
    setMode(detail.paymentMode ?? 1)
    setPaymentDate(detail.paymentDate || '')
    setNotes(detail.notes || '')
    setPf(detail.pf || 0)
    const sel: Record<string, Picked> = {}
    const open = new Set<string>()
    for (const b of detail.bills) {
      for (const l of b.lines) {
        if (l.returnQty > 0) {
          sel[l.key] = { line: l, bill: b, qty: l.returnQty, price: l.unitPrice, reasonId: l.reasonId, notes: l.notes }
          open.add(b.key)
        }
      }
    }
    setPicked(sel)
    setExpanded(open)
    SessionStorageService.remove(R.sessionModule, isCustomer ? `${detail.type}-${detail.id}` : String(detail.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, detail])

  // ---- create from a bill's view: find the bill, its party, and open it
  const linked = useRef(false)
  useEffect(() => {
    if (isEdit || !linkBillId || linked.current || !router.isReady) return
    linked.current = true
    const url = isCustomer ? `/api/${linkType === 'invoicex' ? 'salex' : 'sales'}/${linkBillId}` : `/api/purchases/${linkBillId}`
    fetch(url)
      .then(r => readJson(r, 'Failed to load the bill'))
      .then(raw => {
        const b = raw.data || raw.purchase || raw.sale || raw
        const pid = isCustomer ? (b.select_customer ?? b.customer_id ?? b.customer?.id) : (b.vendor_id ?? b.vendor?.id)
        if (!pid) throw new Error(isCustomer ? 'This bill has no customer to return to' : 'This bill has no vendor')
        setPartyId(String(pid))
        setBillSearch(String(b.invoice_no ?? ''))
        setRange({ from: '', to: '' })
        setExpanded(new Set([isCustomer ? `${linkType}-${linkBillId}` : String(linkBillId)]))
        showSnackbar('success', `Loaded ${isCustomer ? (linkType === 'invoicex' ? 'Invoice C' : 'invoice') : 'bill'} #${b.invoice_no} for return`)
      })
      .catch((e: Error) => showSnackbar('error', e.message || 'Failed to load the bill'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, linkBillId])

  // ---- the party's bills (create only)
  const search = useDebounce(billSearch, 300)
  const itemQ = useDebounce(itemSearch, 300)
  const billsQuery = useReturnBills(party, partyId, { page, search, itemSearch: itemQ, from: range.from, to: range.to }, !isEdit)
  const bills: ReturnBill[] = isEdit ? detail?.bills || [] : billsQuery.data?.bills || []
  const pagination = billsQuery.data?.pagination

  const chooseParty = (v: string | null) => {
    setPartyId(v || '')
    setPicked({})
    setExpanded(new Set())
    setBillSearch('')
    setItemSearch('')
    setPage(1)
    const to = getLocalDateString()
    setRange(v ? { from: monthsBack(to, 3), to } : { from: '', to: '' })
  }
  const loadMore = () => {
    if (!range.from) return
    setRange({ from: monthsBack(range.from, 3), to: range.to })
    setPage(1)
  }
  const changeStatus = (s: number) => {
    setStatus(s)
    setPaymentDate(s === 1 ? (paymentDate || getLocalDateString()) : '')
  }

  // ---- what is on screen
  const shownBills = useMemo(() => {
    let list = bills
    if (itemSearch) {
      const t = itemSearch.toLowerCase()
      list = list.filter(b => b.lines.some(l => l.name.toLowerCase().includes(t) || l.part.toLowerCase().includes(t)))
    }
    if (focusView) list = list.filter(b => b.lines.some(l => picked[l.key]))
    return list
  }, [bills, itemSearch, focusView, picked])

  const chosen = Object.values(picked)
  const lineTotals = chosen.map(p => {
    const sub = Math.round(p.qty * p.price * 100) / 100
    const tax = p.bill.hasTax ? Math.round(sub * p.line.taxRate) / 100 : 0
    return { sub, tax }
  })
  const subtotal = lineTotals.reduce((s, t) => s + t.sub, 0)
  const tax = lineTotals.reduce((s, t) => s + t.tax, 0)
  const qty = chosen.reduce((s, p) => s + p.qty, 0)
  const total = subtotal + tax + (isCustomer ? 0 : Number(pf) || 0)
  const anyTax = chosen.some(p => p.bill.hasTax && p.line.taxRate > 0)
  const refundedSaleEdit = isEdit && isCustomer && detail?.paymentStatus === 1
  const partyName = (parties.find((p: any) => String(p.id) === partyId) as any)?.[R.nameField] || detail?.partyName || ''

  const process = () => {
    if (chosen.length === 0) return showSnackbar('warning', 'Please select at least one item to return')
    if (!isCustomer) {
      // Stock check before asking (the server checks again). An edit gives its own quantities back first.
      const own = new Map<number, number>()
      if (isEdit) for (const b of detail?.bills || []) for (const l of b.lines) own.set(l.productId, (own.get(l.productId) || 0) + l.returnQty)
      const need = new Map<number, { qty: number; name: string; stock: number }>()
      for (const p of chosen) {
        const cur = need.get(p.line.productId) || { qty: 0, name: p.line.name, stock: (p.line.stock ?? Infinity) + (own.get(p.line.productId) || 0) }
        cur.qty += p.qty
        need.set(p.line.productId, cur)
      }
      const short = Array.from(need.values()).filter(n => n.qty > n.stock)
      if (short.length) {
        return showSnackbar('error', `Insufficient stock:\n${short.map(s => `${s.name}: Returning ${s.qty} but only ${s.stock} in stock`).join('\n')}`)
      }
    }
    setConfirming(true)
  }

  const confirm = () => {
    const common = {
      return_date: returnDate,
      return_notes: notes,
      payment_status: status,
      payment_mode: mode,
      payment_date: status === 1 && paymentDate ? paymentDate : undefined
    }
    const payload: any = isCustomer
      ? {
          ...common,
          ...(isEdit ? { invoice_type: detail?.type } : { customer_id: partyId, return_type: 'custom' }),
          items: chosen.map(p => ({
            invoice_item_id: p.line.lineId, invoice_type: p.line.type, return_qty: p.qty,
            return_reason_id: reasonFor(reasons, p.reasonId) || undefined, unit_price: p.price, notes: p.notes
          }))
        }
      : {
          ...common,
          ...(isEdit ? {} : { vendor_id: partyId }),
          packing_forwarding_amount: Number(pf) || 0,
          items: chosen.map(p => ({
            purchase_item_id: p.line.lineId, return_qty: p.qty, return_reason_id: reasonFor(reasons, p.reasonId) || undefined,
            unit_price: p.price, tax_rate: p.line.taxRate, notes: p.notes
          }))
        }
    save.mutate({ id: isEdit ? Number(editId) : undefined, type: detail?.type, payload }, {
      onSuccess: (res: any) => {
        setConfirming(false)
        if (isEdit) {
          showSnackbar('success', `Return updated successfully! Return #${detail?.returnNo || editId}`)
          router.push(R.viewUrl(Number(editId), detail?.type))
          return
        }
        if (isCustomer) {
          const made: any[] = res?.data?.returns || []
          showSnackbar('success', `Return(s) created successfully! ${made.map(r => r.return_no).join(', ')}`)
          // One return per bill: several bills make several returns, so they are listed.
          if (made.length === 1) router.push(R.viewUrl(made[0].id, made[0].kind === 'salex' ? 'invoicex' : 'invoice'))
          else router.push(R.listUrl)
        } else {
          const id = res?.data?.return?.id
          showSnackbar('success', `Return created successfully! Return #${res?.data?.return?.return_no || id}`)
          router.push(id ? R.viewUrl(id) : R.listUrl)
        }
      },
      onError: (e: Error) => {
        setConfirming(false)
        showSnackbar('error', e.message || `Failed to ${isEdit ? 'update' : 'create'} return`)
      }
    })
  }

  if (loadingParties) {
    return (
      <div className="card">
        <div className="p-6 animate-pulse">
          <div className="h-8 bg-slate-700 rounded mb-4"></div>
          <div className="h-4 bg-slate-700 rounded mb-2"></div>
          <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-700 rounded"></div>)}</div>
        </div>
      </div>
    )
  }

  const partyOptions = parties.map((p: any) => {
    const state = isCustomer ? p.billing_state : p.state
    return { id: String(p.id), name: isCustomer ? (state ? `${p.billing_name} (${state})` : p.billing_name) : `${p.vendor_name} (${state || 'N/A'})` }
  })
  const loadingBills = !isEdit && !!partyId && billsQuery.isLoading

  return (
    <div className="space-y-6">
      {isEdit && !detail && !detailQuery.error && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center !mt-0">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
            <div className="text-center">
              <p className="text-slate-200 font-medium">Loading Return Data</p>
              <p className="text-slate-400 text-sm">Please wait while we fetch the return details...</p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
              <Package className="w-6 h-6" />
              {isEdit ? 'Edit' : 'Create'} {R.title} {partyName ? `from ${partyName}` : ''}
              {isEdit && <span className="text-slate-400 text-base font-normal">| Return {detail?.returnNo || editId}</span>}
            </h1>
          </div>

          {detailQuery.error && (
            <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-red-400">{(detailQuery.error as Error).message || 'Failed to load return data for editing'}</p>
            </div>
          )}
          {refundedSaleEdit && (
            <div className="mb-6 bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-4 text-yellow-300 text-sm">
              This return is refunded, so it cannot be edited. Delete it and record it again if it was wrong.
            </div>
          )}

          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-slate-300 mb-2">{R.label} *</label>
                <SearchableSelect
                  options={partyOptions}
                  selectedValue={partyId || null}
                  onSelectionChange={chooseParty}
                  placeholder={`Select ${party}...`}
                  className="w-full"
                  disabled={isEdit}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Return Date *</label>
                <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="input w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Return Status *</label>
                <SearchableSelect
                  options={[{ id: '0', name: REFUND_STATUS[0].text }, { id: '1', name: REFUND_STATUS[1].text }]}
                  selectedValue={String(status)}
                  onSelectionChange={v => changeStatus(parseInt(v || '0'))}
                  placeholder="Select status..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
                <SearchableSelect
                  options={[{ id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
                  selectedValue={String(mode)}
                  onSelectionChange={v => setMode(parseInt(v || '1'))}
                  placeholder="Select mode..."
                  className="w-full"
                  disabled={status === 0}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Date</label>
                <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="input w-full" disabled={status === 0} />
              </div>
            </div>

            <div className={`grid grid-cols-1 ${isEdit ? 'md:grid-cols-1' : 'md:grid-cols-3'} gap-4 mt-4`}>
              {!isEdit && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Search Bills</label>
                  <ClearableInput value={billSearch} onChange={e => { setBillSearch(e.target.value); setPage(1) }} placeholder="Search by invoice number..." className="w-full" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Search Items</label>
                <ClearableInput value={itemSearch} onChange={e => { setItemSearch(e.target.value); setPage(1) }} placeholder="Search products, part numbers..." className="w-full" />
              </div>
              {!isEdit && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
                  <DateRangeFilter startDate={range.from} endDate={range.to} onDateChange={(s, e) => { setRange({ from: s, to: e }); setPage(1) }} />
                </div>
              )}
            </div>

            {partyId && (
              <div className="mt-4 flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-4">
                  {!isEdit && (
                    <>
                      <div className="text-sm text-slate-300">
                        {range.from ? `Loaded: ${localDay(range.from)} - ${localDay(range.to)}` : 'All dates'}
                        {' '}({pagination?.total ?? bills.length} bills, {bills.reduce((s, b) => s + b.lines.length, 0)} items on this page)
                      </div>
                      {range.from && (
                        <button
                          onClick={loadMore}
                          disabled={billsQuery.isFetching}
                          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded flex items-center gap-2"
                        >
                          <Calendar className="w-3 h-3" /> Load More Bills
                        </button>
                      )}
                    </>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={focusView} onChange={e => setFocusView(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500" />
                  Focus View
                </label>
              </div>
            )}
          </div>

          {loadingBills && (
            <div className="animate-pulse space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-700 rounded"></div>)}</div>
          )}

          {partyId && !loadingBills && (
            <>
              <BillPicker
                party={party}
                bills={shownBills}
                picked={picked}
                onPick={setPicked}
                expanded={expanded}
                onToggle={key => setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })}
                reasons={reasons}
                emptyText={`No bills found for the selected ${party} and filters`}
              />

              {!isEdit && pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-600">
                  <div className="text-sm text-slate-400">
                    Showing {(pagination.page - 1) * 50 + 1} to {Math.min(pagination.page * 50, pagination.total)} of {pagination.total} bills
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => setPage(page - 1)} disabled={!pagination.hasPrev} className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded">Previous</button>
                    <span className="text-sm text-slate-300">Page {pagination.page} of {pagination.totalPages}</span>
                    <button onClick={() => setPage(page + 1)} disabled={!pagination.hasNext} className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded">Next</button>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-600 pt-6 mt-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-medium text-slate-200 mb-4">Return Notes</h3>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8} className="input w-full" placeholder="Optional notes about the return..." />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-slate-200 mb-4">Summary</h3>
                    {chosen.length > 0 ? (
                      <div className="bg-slate-700 rounded-lg p-4 space-y-3">
                        <div className="flex justify-between pb-2 border-b border-slate-600"><span className="text-slate-400 text-sm">Items:</span><span className="text-white font-semibold">{chosen.length}</span></div>
                        <div className="flex justify-between pb-2 border-b border-slate-600"><span className="text-slate-400 text-sm">Quantity:</span><span className="text-white font-semibold">{qty}</span></div>
                        <div className="flex justify-between pb-2 border-b border-slate-600"><span className="text-slate-400 text-sm">Subtotal:</span><span className="text-white font-semibold">{money(subtotal)}</span></div>
                        {anyTax && (
                          <div className="flex justify-between pb-2 border-b border-slate-600"><span className="text-slate-400 text-sm">Tax:</span><span className="text-yellow-400 font-semibold">{money(tax)}</span></div>
                        )}
                        {!isCustomer && (
                          <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                            <span className="text-slate-400 text-sm">Packing & Forwarding:</span>
                            <input
                              type="number"
                              min="0"
                              value={pf}
                              onChange={e => setPf(parseFloat(e.target.value) || 0)}
                              className="w-32 px-2 py-1 bg-slate-600 border border-slate-500 rounded text-right text-sm text-white"
                              placeholder="0.00"
                            />
                          </div>
                        )}
                        <div className="flex justify-between pt-2">
                          <span className="text-slate-300 font-medium">Total:</span>
                          <span className="text-green-400 text-xl font-bold">{money(total)}</span>
                        </div>
                        <p className="text-xs text-slate-400">Tax and the refund are worked out again on saving, each tax head rounded to the rupee.</p>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-400 bg-slate-700 rounded-lg">No items selected for return</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-4">
                <button type="button" onClick={() => router.push(R.listUrl)} className="px-6 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={process}
                  disabled={chosen.length === 0 || save.isPending || refundedSaleEdit}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                >
                  {isEdit ? 'Update Return' : 'Process Return'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirming}
        title="Confirm Return Processing"
        message={`Process return for ${chosen.length} items totaling ${money(total)}${isCustomer ? '' : ` (including P&F: ${money(Number(pf) || 0)})`}?`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={save.isPending}
        loadingText="Processing Return..."
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
