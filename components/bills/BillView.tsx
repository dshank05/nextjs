import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Edit, Eye, DollarSign, RotateCcw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribeBroadcast } from '../../lib/broadcast'
import { ExportMenu } from '../common/ExportMenu'
import PaymentHistoryModal from '../PaymentHistoryModal'
import { useSnackbar } from '../SnackbarProvider'
import { getLocalDateString } from '../../lib/date-utils'
import { money } from '../../lib/line-math'
import { BILL, useBill, type BillKind } from '../../hooks/useBills'
import { BillPaymentModal } from './BillPaymentModal'

/**
 * One purchase, sale or Invoice C (BILLS_PLAN B4). Replaces SaleBillView and the
 * 817-line purchase view. Lines show what the server stored (the purchase view
 * re-derived tax in the browser, paise off the bill's own rounded totals);
 * returns say "Pending refund" / "Refunded" and link to the return; Mark as Paid
 * is offered only to a registered party (an "Other" purchase offered it and the
 * payment API refused); money always shows paise.
 */
const statusBadge = (s?: number | null) =>
  s === 1 ? <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>
    : s === 2 ? <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>
      : s === 0 ? <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>
        : <span className="text-slate-400">N/A</span>
const refundBadge = (s?: number | null) =>
  s === 1 ? <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Refunded</span>
    : s === 2 ? <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partly refunded</span>
      : <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Pending refund</span>
const modeText = (m?: number | null) => (m === 0 ? 'Cash' : m === 1 ? 'Bank' : 'N/A')
const rupees = (v?: number | null) => `₹${money(Number(v) || 0)}`
const day = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString('en-IN') : '-')

export function BillView({ kind }: { kind: BillKind }) {
  const B = BILL[kind]
  const isPurchase = kind === 'purchase'
  const taxFree = B.taxFree
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const qc = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [showHistory, setShowHistory] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const { data: bill, isLoading, error } = useBill(kind, id)

  // Edited in another tab: refresh.
  useEffect(() => subscribeBroadcast((msg) => {
    if (msg.resource === B.resource && msg.type === 'updated' && String(msg.data?.id) === String(id)) {
      qc.invalidateQueries({ queryKey: [B.docKey, String(id)] })
    }
  }), [id, qc, B.resource, B.docKey])

  if (isLoading || !router.isReady) {
    return <div className="card h-96 flex items-center justify-center"><div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div></div>
  }
  if (error || !bill) {
    return <div className="card"><p className="text-center text-slate-400">{isPurchase ? 'Purchase not found' : 'Bill not found'}</p></div>
  }

  const exportAs = async (type: 'excel' | 'pdf') => {
    try {
      const utils = await import('../../lib/export-utils-enhanced')
      const businessResponse = await fetch('/api/business-details')
      const business = businessResponse.ok ? await businessResponse.json() : null
      if (isPurchase) {
        const { purchaseViewExportLayout, preparePurchaseDataForExport } = await import('../../lib/export-layouts/purchase-view-layout')
        const options = { title: 'Purchase Details', fileName: `Purchase_${bill.invoice_no}`, layout: purchaseViewExportLayout }
        if (type === 'excel') await utils.exportToExcelWithLayout(preparePurchaseDataForExport(bill.raw), options, business)
        else await utils.exportToPDFWithLayout(preparePurchaseDataForExport(bill.raw), options, business)
      } else {
        const { saleViewExportLayout, prepareSaleDataForExport } = await import('../../lib/export-layouts/sale-view-layout')
        const layout = {
          ...saleViewExportLayout,
          sections: saleViewExportLayout.sections.map((s: any) =>
            s.type === 'banner' ? { ...s, template: `${B.viewTitle} #{{invoice_no}} • {{customer.billing_name}}` } : s)
        }
        const options = { title: `${B.viewTitle} Details`, fileName: `${B.title.replace(' ', '_')}_${bill.invoice_no}`, layout }
        if (type === 'excel') await utils.exportToExcelWithLayout(prepareSaleDataForExport(bill.raw), options, business)
        else await utils.exportToPDFWithLayout(prepareSaleDataForExport(bill.raw), options, business)
      }
    } catch (e) {
      console.error('export:', e)
      showSnackbar('error', 'Export failed. Please try again.')
    }
  }

  const rs = bill.return_status
  const pay = bill.payment_summary
  const p = bill.party
  const items = bill.items
  const sum = (pick: (i: (typeof items)[number]) => number) => items.reduce((s, i) => s + pick(i), 0)
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <span className="text-slate-400">{label}:</span>
      <span className={`text-white ${strong ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  )
  // "Other" has no account to post a payment to, and nothing to return against.
  const registered = p.id > 0
  const canPay = !!pay && pay.remaining_amount > 0.005 && registered

  return (
    <div className="space-y-6">
      <div className="card">
        <div className={`${B.banner} border rounded p-4 mb-6`}>
          <div className="text-center space-y-2">
            <h1 className={`text-xl font-bold ${B.bannerText}`}>{B.viewTitle} #{bill.invoice_no} • {p.name}</h1>
            <div className="flex justify-center gap-2">
              {taxFree && <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">Tax-Free</span>}
              {rs.has_returns && (
                <>
                  {rs.status === 'PARTIAL_RETURN' && <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial Return</span>}
                  {rs.status === 'FULLY_RETURNED' && <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Fully Returned</span>}
                  <span className="text-xs text-slate-200 bg-slate-800/50 px-2 py-1 rounded-full">{rs.fully_returned_items}/{rs.total_items} items returned</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-3">
            {row('Total', <span className="text-lg">{rupees(bill.total)}</span>, true)}
            {row('Items', items.length)}
            {row('Invoice', bill.invoice_no)}
            {row('Date', day(bill.invoice_date))}
            {row('Status', statusBadge(bill.payment_status))}
            {pay && pay.payment_count > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Payment History:</span>
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  {pay.payment_count} payment{pay.payment_count !== 1 ? 's' : ''}
                  <button type="button" onClick={() => setShowHistory(true)} title="Show payments"><Eye className="w-4 h-4" /></button>
                </span>
              </div>
            )}
            {row('Payment Mode', modeText(bill.payment_mode))}
            {row('Bill Reference', bill.bill_reference || 'N/A')}
            {isPurchase && row('Bill Reference Date', bill.bill_reference_date || 'N/A')}
          </div>

          <div className="space-y-3">
            {row(B.partyLabel, p.name || 'N/A')}
            {row('Contact', p.contact || 'N/A')}
            {row('Email', p.email || 'N/A')}
            {row('GSTIN', p.gstin || 'N/A')}
            {row('Address', [p.address, p.address_2, p.city, p.state].filter(Boolean).join(', ') || 'N/A')}
            {row('Staff', bill.staff_name || 'N/A')}
            {!isPurchase && row('Mechanic', bill.mechanic_name || 'N/A')}
            {!isPurchase && row('Commission', rupees(bill.commission))}
          </div>

          <div className="space-y-3">
            {row(B.discount ? 'Items (after discount)' : 'Items Total', rupees(bill.items_total))}
            {B.discount && row('Discount', rupees(bill.discount))}
            {row('P&F', rupees(bill.packing_total))}
            {row('Freight', rupees(bill.freight))}
            {!taxFree && row('CGST', rupees(bill.total_cgst))}
            {!taxFree && row('SGST', rupees(bill.total_sgst))}
            {!taxFree && row('IGST', rupees(bill.total_igst))}
            {!taxFree && row('Total Tax', rupees(bill.total_tax))}
            {row('Grand Total', rupees(bill.total), true)}
            {pay && row('Paid / Outstanding', `${rupees(pay.total_paid)} / ${rupees(pay.remaining_amount)}`)}
          </div>

          <div className="space-y-3">
            {row('Transport', bill.transport_name || 'N/A')}
            {row(isPurchase ? 'Box Quantity' : 'Vehicle', bill.vehicle_number || 'N/A')}
            {row('P&F Qty', bill.packing_qty || 0)}
            {row('P&F Rate', rupees(bill.packing_rate))}
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Notes:</div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{bill.notes || 'No notes available'}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Descriptions:</div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{bill.descriptions || 'No descriptions available'}</div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <ExportMenu
              data={[{ invoice_no: bill.invoice_no, party_name: p.name, date: day(bill.invoice_date), total: bill.total,
                payment_status: bill.payment_status, payment_mode: bill.payment_mode, bill_reference: bill.bill_reference,
                transport_name: bill.transport_name, notes: bill.notes }]}
              columns={[
                { key: 'invoice_no', label: 'Invoice Number', enabled: true },
                { key: 'party_name', label: `${B.partyLabel} Name`, enabled: true },
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
                { key: 'transport_name', label: 'Transport', enabled: true },
                { key: 'notes', label: 'Notes', enabled: true }
              ]}
              config={{ title: `${B.viewTitle} Details`, fileName: `${B.title.replace(' ', '_')}_${bill.invoice_no}_${getLocalDateString()}` }}
              onExport={(type) => { if (type === 'excel' || type === 'pdf') exportAs(type) }}
            />
            {canPay && (
              <button onClick={() => setShowPay(true)} className="btn-secondary flex items-center gap-2" title="Record a payment against this bill">
                <DollarSign className="w-4 h-4" /> Mark as Paid
              </button>
            )}
            {!rs.is_fully_returned && registered && (
              <Link href={B.returnCreate(bill.id)} className="btn-secondary flex items-center gap-2" title="Return items from this bill">
                <RotateCcw className="w-4 h-4" /> Create Return
              </Link>
            )}
            {rs.is_fully_returned ? (
              <button disabled className="btn-secondary flex items-center gap-2 opacity-50 cursor-not-allowed" title="Fully returned bills cannot be edited">
                <Edit className="w-4 h-4" /> Edit Disabled (Fully Returned)
              </button>
            ) : (
              <Link href={`${B.formUrl}?edit=${bill.id}`} className="btn-primary flex items-center gap-2" title="Edit">
                <Edit className="w-4 h-4" /> Edit {B.title}
              </Link>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>HSN</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  {B.discount && <th>Discount</th>}
                  <th>Taxable Value</th>
                  {!taxFree && <th>Tax %</th>}
                  {!taxFree && <th>Tax</th>}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className={item.is_fully_returned ? 'bg-red-900/10' : ''}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">
                      {item.display_name}
                      {item.returned_qty > 0 && <div className="text-xs text-orange-400 mt-1">Returned: {item.returned_qty}/{item.original_qty}</div>}
                    </td>
                    <td className="text-slate-300">{item.part || 'N/A'}</td>
                    <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                    <td className="text-slate-300 font-medium">{item.qty}</td>
                    <td className="text-slate-300">{rupees(item.rate)}</td>
                    {B.discount && <td className="text-slate-300">{item.discount ? rupees(item.discount) : '-'}</td>}
                    <td className="text-slate-300">{rupees(item.subtotal)}</td>
                    {!taxFree && <td className="text-slate-300">{item.gst_percentage || 0}%</td>}
                    {!taxFree && <td className="text-slate-300">{rupees(item.tax)}</td>}
                    <td className="text-slate-300 font-semibold">{rupees(item.total)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-slate-400 py-4">No items on this bill</td></tr>
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td colSpan={4} />
                    <td className="text-white font-bold">{sum(i => i.qty)}</td>
                    <td />
                    {B.discount && <td className="text-white font-bold">{rupees(sum(i => i.discount))}</td>}
                    <td className="text-white font-bold">{rupees(sum(i => i.subtotal))}</td>
                    {!taxFree && <td />}
                    {!taxFree && <td className="text-white font-bold" title="Per line, before the bill's rounding">{rupees(sum(i => i.tax))}</td>}
                    <td className="text-white font-bold">{rupees(sum(i => i.total))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {bill.returns.length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4">📦 Returns</h3>
            <div className="space-y-6">
              {bill.returns.map((ret) => (
                <div key={ret.id} className="bg-slate-800 border border-slate-700 rounded p-4">
                  {ret.multi_bill && (
                    <div className="bg-blue-50/10 border border-blue-500/30 rounded p-2 mb-4">
                      <span className="text-blue-300 text-sm">ℹ️ This return includes items from {ret.multi_bill.bills} bills</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div><span className="text-slate-400 text-sm">Return Number:</span><div className="text-white font-medium">{ret.return_no}</div></div>
                    <div><span className="text-slate-400 text-sm">Date:</span><div className="text-white font-medium">{day(ret.return_date)}</div></div>
                    <div>
                      <span className="text-slate-400 text-sm">{ret.multi_bill ? 'This Bill:' : 'Total Amount:'}</span>
                      <div className="text-white font-medium">{rupees(ret.amount)}</div>
                    </div>
                    <div><span className="text-slate-400 text-sm">Refund Amount:</span><div className="text-white font-medium">{rupees(ret.refund_amount)}</div></div>
                    <div><span className="text-slate-400 text-sm">Refund:</span><div>{refundBadge(ret.payment_status)}</div></div>
                    <div><span className="text-slate-400 text-sm">Payment Mode:</span><div className="text-white font-medium">{modeText(ret.payment_mode)}</div></div>
                    {ret.notes && <div className="col-span-full"><span className="text-slate-400 text-sm">Notes:</span><div className="text-white">{ret.notes}</div></div>}
                  </div>
                  {ret.items.length > 0 && (
                    <div className="overflow-x-auto mt-4">
                      <table className="table text-sm">
                        <thead>
                          <tr><th>Product</th><th>Qty</th><th>Unit Price</th>{!taxFree && <th>Tax</th>}<th>Total</th></tr>
                        </thead>
                        <tbody>
                          {ret.items.map((it, i) => (
                            <tr key={i}>
                              <td className="text-white">{it.name}{it.part ? <span className="text-slate-400 text-xs ml-2">{it.part}</span> : null}</td>
                              <td className="text-slate-300">{it.qty}</td>
                              <td className="text-slate-300">{rupees(it.unit_price)}</td>
                              {!taxFree && <td className="text-slate-300">{rupees(it.tax)}</td>}
                              <td className="text-white font-medium">{rupees(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-slate-700 flex justify-end">
                    <Link href={B.returnView(ret.id)} className="btn-secondary text-sm">View Return</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pay && <PaymentHistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} summary={pay as any} history={bill.payment_history} />}
      {canPay && <BillPaymentModal bill={bill} open={showPay} onClose={() => setShowPay(false)} />}
    </div>
  )
}
