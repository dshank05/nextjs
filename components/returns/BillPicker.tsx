import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { SearchableSelect } from '../common/SearchableSelect'
import type { ReturnParty, ReturnBill, ReturnLine } from '../../hooks/useReturns'

/** A line chosen for return, with what the form has set on it. */
export interface Picked {
  line: ReturnLine
  bill: ReturnBill
  qty: number
  price: number
  reasonId: number
  notes: string
}

const day = (ymd: string) => {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString()
}

/**
 * The expandable bill / line table of the return form, shared by sale and
 * purchase returns. Quantity is capped at what is left of the line; the price
 * at what the line was sold or bought for; a line's note is carried through
 * (edits used to blank it).
 */
export function BillPicker({ party, bills, picked, onPick, expanded, onToggle, reasons, emptyText }: {
  party: ReturnParty
  bills: ReturnBill[]
  picked: Record<string, Picked>
  onPick: (next: Record<string, Picked>) => void
  expanded: Set<string>
  onToggle: (key: string) => void
  reasons: { id: number; reason_name: string }[]
  emptyText: string
}) {
  const setQty = (bill: ReturnBill, line: ReturnLine, raw: string) => {
    const qty = Math.max(0, Math.min(parseInt(raw) || 0, line.available))
    const next = { ...picked }
    if (qty === 0) delete next[line.key]
    else next[line.key] = { line, bill, qty, price: picked[line.key]?.price ?? line.unitPrice, reasonId: picked[line.key]?.reasonId ?? line.reasonId ?? 1, notes: picked[line.key]?.notes ?? line.notes }
    onPick(next)
  }
  const setPrice = (line: ReturnLine, raw: string) => {
    const p = picked[line.key]
    if (!p) return
    const price = Math.min(Math.max(0, parseFloat(raw) || 0), line.ceiling || line.unitPrice)
    onPick({ ...picked, [line.key]: { ...p, price } })
  }
  const setReason = (line: ReturnLine, id: number) => {
    const p = picked[line.key]
    if (!p) return
    onPick({ ...picked, [line.key]: { ...p, reasonId: id } })
  }

  return (
    <div className="border-t border-slate-600 pt-6">
      <h3 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
        <FileText className="w-5 h-5" />
        Select Items for Return
      </h3>
      <div className="space-y-3">
        {bills.map(bill => {
          const open = expanded.has(bill.key)
          return (
            <div key={bill.key} className="border border-slate-600 rounded-lg">
              <div className="p-2 bg-slate-700 cursor-pointer transition-colors" onClick={() => onToggle(bill.key)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {open ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                    <div>
                      <h4 className="text-base font-medium text-slate-200 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Bill #{bill.type === 'invoicex' ? `C-${bill.invoiceNo}` : bill.invoiceNo}
                        {bill.type === 'invoicex' && <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-600 text-white">Invoice C</span>}
                      </h4>
                      <p className="text-sm text-slate-400">
                        {bill.reference ? `${bill.reference} • ` : ''}{day(bill.date)} • ₹{bill.total.toLocaleString('en-IN')}
                        {bill.hasTax && <span className="ml-2 px-2 py-0.5 bg-green-900 text-green-300 text-xs rounded">Tax</span>}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400">{bill.availableItems}/{bill.totalItems} items available</p>
                </div>
              </div>

              {open && (
                <div className="p-4 bg-slate-800">
                  <table className="w-full">
                    <thead className="bg-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Product</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Available</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Return Qty</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-28">Price</th>
                        {bill.hasTax && <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-20">Tax %</th>}
                        <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-40">Reason</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-28">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bill.lines.map(line => {
                        const p = picked[line.key]
                        const sub = p ? Math.round(p.qty * p.price * 100) / 100 : 0
                        const tax = p && bill.hasTax ? Math.round(sub * line.taxRate) / 100 : 0
                        const blocked = line.fullyReturned && !p
                        return (
                          <tr key={line.key} className={`border-t border-slate-600 ${blocked ? 'opacity-50 bg-slate-800/50' : ''}`}>
                            <td className="px-4 py-3 text-sm text-white">
                              <div className="font-medium">
                                {line.name}
                                {blocked && <span className="ml-2 px-2 py-0.5 bg-red-900 text-red-300 text-xs rounded">Fully Returned</span>}
                              </div>
                              {line.part && <div className="text-slate-400 text-xs">Part: {line.part}</div>}
                              {line.already > 0 && <div className="text-yellow-400 text-xs">Already returned: {line.already} / {line.originalQty}</div>}
                              {p?.notes && <div className="text-slate-400 text-xs">Note: {p.notes}</div>}
                            </td>
                            <td className="px-4 py-3 text-center text-sm text-slate-300">{line.available}</td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="number"
                                min="0"
                                max={line.available}
                                value={p?.qty || ''}
                                onChange={e => setQty(bill, line, e.target.value)}
                                disabled={blocked}
                                className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="0"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={line.ceiling || undefined}
                                value={p ? p.price : line.unitPrice}
                                onChange={e => setPrice(line, e.target.value)}
                                disabled={!p}
                                className={`w-24 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm ${!p ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                                placeholder="0"
                              />
                            </td>
                            {bill.hasTax && <td className="px-4 py-3 text-center text-sm text-slate-300">{line.taxRate}%</td>}
                            <td className="px-4 py-3 text-center">
                              <SearchableSelect
                                options={reasons.map(r => ({ id: String(r.id), name: r.reason_name }))}
                                selectedValue={String(p?.reasonId ?? line.reasonId ?? 1)}
                                onSelectionChange={v => setReason(line, parseInt(v || '1'))}
                                placeholder="Select reason..."
                                className="w-full"
                              />
                            </td>
                            <td className="px-4 py-3 text-center text-sm font-medium text-green-400">
                              ₹{(sub + tax).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {bills.length === 0 && <div className="text-center py-8 text-slate-400">{emptyText}</div>}
    </div>
  )
}
