import { useEffect, useState } from 'react'
import { X, DollarSign } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '../SnackbarProvider'
import { getLocalDateString } from '../../lib/date-utils'
import { money } from '../../lib/line-math'
import { readJson } from '../../hooks/readJson'
import { BILL, type Bill } from '../../hooks/useBills'

/**
 * "Mark as Paid" on a bill (BILLS_PLAN B4): one payment allocated to this bill.
 * Replaces QuickPaymentModal (vendor) and QuickCustomerPaymentModal (customer).
 * The amount starts at what is outstanding NOW each time it opens - it kept the
 * figure from when the page first loaded, so a second part payment was offered
 * the old outstanding and refused. Notes name the printed bill number, not its
 * database id.
 */
export function BillPaymentModal({ bill, open, onClose }: { bill: Bill; open: boolean; onClose: () => void }) {
  const B = BILL[bill.kind]
  const qc = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const outstanding = Math.max(0, Math.round((bill.payment_summary?.remaining_amount || 0) * 100) / 100)
  const paid = bill.payment_summary?.total_paid || 0
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(getLocalDateString())
  const [mode, setMode] = useState(1) // 0 = Cash, 1 = Bank
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAmount(String(outstanding))
    setDate(getLocalDateString())
    setMode(1)
    setNotes('')
  }, [open, outstanding])

  if (!open) return null

  const submit = async () => {
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return showSnackbar('error', 'Please enter a valid payment amount')
    if (value > outstanding + 0.001) return showSnackbar('error', 'Payment amount cannot exceed outstanding amount')
    const what = bill.kind === 'purchase' ? 'purchase' : bill.kind === 'salex' ? 'Invoice C' : 'invoice'
    const note = notes || `Payment for ${what} ${bill.invoice_no}`
    const allocation = bill.kind === 'purchase' ? { purchase_id: bill.id }
      : bill.kind === 'salex' ? { invoicex_id: bill.id } : { invoice_id: bill.id }
    const body = bill.kind === 'purchase'
      ? { vendor_id: bill.party.id, payment_date: date, payment_amount: value, payment_mode: mode, notes: note,
          allocations: [{ ...allocation, allocated_amount: value, notes: notes || null }] }
      : { customer_id: bill.party.id, payment_date: date, payment_amount: value, payment_mode: mode, payment_type: 'BILL_SPECIFIC',
          fy: bill.fy, notes: note, allocations: [{ ...allocation, allocated_amount: value, notes: notes || null }] }
    setSaving(true)
    try {
      await readJson(await fetch(bill.kind === 'purchase' ? '/api/vendor-payments' : '/api/customer-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }), 'Failed to record payment')
      showSnackbar('success', `Payment of ₹${money(value)} recorded successfully!`)
      // The bill, its party's ledger and outstanding, the payment screens.
      await qc.invalidateQueries()
      onClose()
    } catch (e: any) {
      showSnackbar('error', e.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2"><DollarSign className="w-5 h-5" />Record Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors" disabled={saving} title="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-slate-400">{B.partyLabel}</p>
            <p className="text-white font-medium">{bill.party.name} · {B.title} {bill.invoice_no}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 p-4 bg-slate-700/50 rounded-lg">
            <div><p className="text-xs text-slate-400 mb-1">Total Bill</p><p className="text-white font-semibold">₹{money(bill.payment_summary?.total_bill ?? bill.total)}</p></div>
            <div><p className="text-xs text-slate-400 mb-1">Paid</p><p className="text-green-400 font-semibold">₹{money(paid)}</p></div>
            <div><p className="text-xs text-slate-400 mb-1">Outstanding</p><p className="text-orange-400 font-semibold">₹{money(outstanding)}</p></div>
          </div>
          {bill.payment_history.length > 0 && (
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm font-medium text-slate-300 mb-3">Previous Payments</p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {bill.payment_history.map((p: any) => (
                  <div key={p.allocation_id} className="flex justify-between items-center text-sm">
                    <div>
                      <span className="text-slate-400">{new Date(p.payment_date * 1000).toLocaleDateString('en-IN')}</span>
                      <span className="mx-2 text-slate-500">•</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${p.payment_mode === 0 ? 'bg-green-900/30 text-green-400' : 'bg-blue-900/30 text-blue-400'}`}>{p.payment_mode_text}</span>
                    </div>
                    <span className="text-green-400 font-medium">₹{money(p.allocated_amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Payment Amount *</label>
            <input type="number" step="0.01" min="0" max={outstanding} value={amount} onChange={e => setAmount(e.target.value)} className="input w-full" placeholder="Enter amount" disabled={saving} />
            <p className="text-xs text-slate-400 mt-1">Enter full amount for complete payment, or partial amount</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Payment Date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input w-full" disabled={saving} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode *</label>
            <select value={mode} onChange={e => setMode(parseInt(e.target.value))} className="input w-full" disabled={saving}>
              <option value={0}>Cash</option>
              <option value={1}>Bank</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Notes (Optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="input w-full" placeholder="Add any notes about this payment..." disabled={saving} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors" disabled={saving}>Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2">
            {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Recording...</> : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
