import { useRouter } from 'next/router'
import Link from 'next/link'
import { Edit } from 'lucide-react'
import { useSnackbar } from '../SnackbarProvider'
import { ExportMenu } from '../common/ExportMenu'
import SessionStorageService from '../../lib/sessionStorage'
import { getLocalDateString } from '../../lib/date-utils'
import { RET, REFUND_STATUS, useReturnDetail, type ReturnParty, type ReturnLine } from '../../hooks/useReturns'

/**
 * One sale / Invoice C return or purchase return (one component; RETURNS_PLAN
 * R3): banner, summary, party, money, notes, Edit, the returned lines.
 * Vendor extras: Debit Note, Bill Ref column, P&F, Excel / PDF export.
 */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (ymd: string) => {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN')
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}:</span>
      {children}
    </div>
  )
}

export function ReturnView({ party }: { party: ReturnParty }) {
  const R = RET[party]
  const isCustomer = party === 'customer'
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const type = typeof router.query.type === 'string' ? router.query.type : undefined
  const { data: ret, isLoading, error } = useReturnDetail(party, id, type)

  if (isLoading || !router.isReady) {
    return (
      <div className="card">
        <div className="p-6 animate-pulse">
          <div className="h-8 bg-slate-700 rounded mb-4"></div>
          <div className="h-4 bg-slate-700 rounded mb-2"></div>
          <div className="h-4 bg-slate-700 rounded mb-6"></div>
          <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-700 rounded"></div>)}</div>
        </div>
      </div>
    )
  }
  if (error || !ret) {
    return (
      <div className="card">
        <div className="p-6 text-center py-8">
          <div className="text-red-400 text-lg mb-2">⚠️</div>
          <div className="text-red-400 font-medium">Error loading return details</div>
          <div className="text-slate-400 text-sm mt-2">{(error as Error | null)?.message || 'Return not found'}</div>
          <Link href={R.listUrl} className="btn-secondary mt-4 inline-block">Back to Returns List</Link>
        </div>
      </div>
    )
  }

  const lines: (ReturnLine & { subtotal: number })[] = ret.bills
    .flatMap(b => b.lines)
    .filter(l => l.returnQty > 0)
    .map(l => ({ ...l, subtotal: Math.round(l.returnQty * l.unitPrice * 100) / 100 }))
  const qty = lines.reduce((s, l) => s + l.returnQty, 0)
  const itemsTotal = lines.reduce((s, l) => s + l.subtotal, 0)
  const sum = (k: 'cgst' | 'sgst' | 'igst' | 'taxAmount') => lines.reduce((s, l) => s + (l[k] || 0), 0)
  const hasTax = ret.totalTax > 0
  const status = REFUND_STATUS[ret.paymentStatus] || REFUND_STATUS[0]
  // The server refuses to edit a refunded sale return; purchase returns can be edited.
  const editBlocked = isCustomer && ret.paymentStatus === 1

  const edit = () => {
    SessionStorageService.set(R.sessionModule, isCustomer ? `${ret.type}-${ret.id}` : String(ret.id), ret)
    router.push(isCustomer ? `${R.formUrl}?id=${ret.id}&type=${ret.type}` : `${R.formUrl}?id=${ret.id}`)
  }

  // The layout export the purchase view always had.
  const exportAs = async (kind: 'excel' | 'pdf') => {
    try {
      const { exportToExcelWithLayout, exportToPDFWithLayout } = await import('../../lib/export-utils-enhanced')
      const { preparePurchaseReturnDataForExport } = await import('../../lib/export-layouts/purchase-return-view-layout')
      const header = {
        return_no: ret.returnNo, return_date: ret.date, total_amount: ret.totalAmount, total_tax: ret.totalTax,
        statusText: status.text, vendor_name: ret.partyName, vendor_gstin: ret.gstin, vendor_address: ret.address, notes: ret.notes
      }
      const items = lines.map(l => ({
        id: l.key, product_name: l.name, part_number: l.part, return_qty: l.returnQty, unit_price: l.unitPrice,
        tax_rate: l.taxRate, tax_amount: l.taxAmount, cgst: l.cgst, sgst: l.sgst, igst: l.igst, subtotal: l.subtotal,
        total: l.subtotal + l.taxAmount, return_reason: l.reason || 'Unknown Reason', notes: l.notes,
        invoice_no: l.billNo, bill_reference: l.billRef
      }))
      const { data, layout } = preparePurchaseReturnDataForExport(header, items, ret.raw)
      const opts = { title: `Purchase Return ${ret.returnNo}`, fileName: `Purchase_Return_${ret.returnNo}`, layout }
      if (kind === 'excel') await exportToExcelWithLayout(data, opts)
      else await exportToPDFWithLayout(data, opts)
    } catch (e) {
      console.error('Export error:', e)
      showSnackbar('error', `Error exporting ${kind === 'excel' ? 'Excel' : 'PDF'}. Please try again.`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className={`${isCustomer ? 'bg-green-900/20 border-green-700/50' : 'bg-red-900/20 border-red-700/50'} border rounded p-4 mb-6`}>
          <div className="text-center">
            <h1 className={`text-xl font-bold ${isCustomer ? 'text-green-100' : 'text-red-100'}`}>
              Return #{ret.returnNo} • {ret.partyName}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-3">
            <Row label="Total"><span className="text-white font-bold text-lg">{money(ret.totalAmount)}</span></Row>
            <Row label="Items"><span className="text-white font-medium">{qty}</span></Row>
            <Row label="Return #"><span className="text-white font-medium">{ret.returnNo}</span></Row>
            {ret.noteNo && <Row label={R.noteWord}><span className="text-white font-medium">{ret.noteNo}</span></Row>}
            {isCustomer && <Row label="Type"><span className="text-white font-medium">{ret.type === 'invoicex' ? 'Invoice C' : 'Sale'}</span></Row>}
            <Row label="Date"><span className="text-white font-medium">{day(ret.date)}</span></Row>
            <Row label="Status">
              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full text-white ${status.cls}`}>{status.text}</span>
            </Row>
            {ret.paymentStatus === 1 && (
              <Row label="Refunded on">
                <span className="text-white font-medium">{day(ret.paymentDate)} · {ret.paymentMode === 0 ? 'Cash' : 'Bank'}</span>
              </Row>
            )}
          </div>

          <div className="space-y-3">
            <Row label={R.label}><span className="text-white font-medium">{ret.partyName}</span></Row>
            <Row label="GSTIN"><span className="text-white font-medium">{ret.gstin || 'N/A'}</span></Row>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Address:</span></div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{ret.address || 'N/A'}</div>
            </div>
          </div>

          <div className="space-y-3">
            <Row label="Items Total"><span className="text-white font-medium">{money(itemsTotal)}</span></Row>
            {hasTax && (
              <>
                <Row label="Total Tax"><span className="text-white font-medium">{money(ret.totalTax)}</span></Row>
                <Row label="CGST"><span className="text-white font-medium">{money(sum('cgst'))}</span></Row>
                <Row label="SGST"><span className="text-white font-medium">{money(sum('sgst'))}</span></Row>
                <Row label="IGST"><span className="text-white font-medium">{money(sum('igst'))}</span></Row>
              </>
            )}
            {!isCustomer && <Row label="Packing & Forwarding"><span className="text-white font-medium">{money(ret.pf)}</span></Row>}
            <Row label="Refund"><span className="text-white font-semibold">{money(ret.refundAmount)}</span></Row>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-400">Return Notes:</span></div>
            <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-24">{ret.notes || 'No notes available'}</div>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            {!isCustomer && (
              <ExportMenu
                data={[ret]}
                columns={[]}
                config={{ title: `Purchase Return #${ret.returnNo}`, fileName: `purchase-return-${ret.returnNo}-${getLocalDateString()}` }}
                onExport={k => { if (k === 'excel' || k === 'pdf') exportAs(k) }}
              />
            )}
            <button
              onClick={edit}
              disabled={editBlocked}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={editBlocked ? 'A refunded sale return cannot be edited' : 'Edit Return'}
            >
              <Edit className="w-4 h-4" />
              Edit Return
            </button>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>{isCustomer ? 'Invoice No' : 'Bill No'}</th>
                  {!isCustomer && <th>Bill Ref</th>}
                  <th>Qty</th>
                  <th>Rate</th>
                  {hasTax && <><th>Tax %</th><th>Tax Amount</th></>}
                  <th>Subtotal</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>{i + 1}</td>
                    <td className="font-medium text-white">
                      <div>{l.name}</div>
                      {l.part && <div className="text-slate-400 text-xs">Part: {l.part}</div>}
                    </td>
                    <td className="text-slate-300 font-medium">{l.billNo}</td>
                    {!isCustomer && <td className="text-slate-300">{l.billRef || '—'}</td>}
                    <td className="text-slate-300 font-medium">{l.returnQty}</td>
                    <td className="text-slate-300">{money(l.unitPrice)}</td>
                    {hasTax && <><td className="text-slate-300">{l.taxRate}%</td><td className="text-slate-300">{money(l.taxAmount)}</td></>}
                    <td className="text-slate-300 font-semibold">{money(l.subtotal)}</td>
                    <td className="text-slate-300">
                      <div className="font-medium">{l.reason || 'Unknown Reason'}</div>
                      {l.notes && <div className="text-slate-400 text-xs mt-1">{l.notes}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-700 bg-slate-800/30">
                  <td></td>
                  <td></td>
                  <td></td>
                  {!isCustomer && <td></td>}
                  <td className="text-white font-bold text-center py-3 bg-slate-700/20">{qty}</td>
                  <td></td>
                  {hasTax && <><td></td><td className="text-white font-bold text-center py-3 bg-slate-700/20">{money(sum('taxAmount'))}</td></>}
                  <td className="text-white font-bold text-center py-3 bg-blue-600/10 border-l border-blue-500/30">{money(itemsTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
