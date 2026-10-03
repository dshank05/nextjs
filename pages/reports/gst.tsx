import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DateRangeFilter } from '../../components/common/DateRangeFilter'
import { ExportMenu } from '../../components/common'
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils'

/** GST summary (server: lib/gst-report.ts) - output, credit notes, input, debit notes, net. */
const money = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function HeadRow({ label, h, sign = '' }: { label: string; h: any; sign?: string }) {
  return (
    <tr>
      <td className="text-slate-300">{label}{h?.count !== undefined && <span className="text-xs text-slate-500"> ({h.count})</span>}</td>
      <td className="text-right">{h?.taxable !== undefined ? `${sign}${money(h.taxable)}` : ''}</td>
      <td className="text-right">{sign}{money(h?.cgst)}</td>
      <td className="text-right">{sign}{money(h?.sgst)}</td>
      <td className="text-right">{sign}{money(h?.igst)}</td>
      <td className="text-right font-semibold text-white">{sign}{money((h?.cgst || 0) + (h?.sgst || 0) + (h?.igst || 0))}</td>
    </tr>
  )
}

function RateTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      <table className="table">
        <thead><tr><th>Rate</th><th className="text-right">Lines</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.rate}><td>{r.rate}%</td><td className="text-right">{r.count}</td><td className="text-right">{money(r.taxable)}</td><td className="text-right">{money(r.cgst)}</td><td className="text-right">{money(r.sgst)}</td><td className="text-right">{money(r.igst)}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-3">None</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function GstSummaryPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  useEffect(() => {
    const now = new Date()
    setDateFrom(formatStartDateForAPI(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTo(formatEndDateForAPI(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  }, [])

  const { data: d, isLoading, error } = useQuery({
    queryKey: ['gst-summary', dateFrom, dateTo],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/reports/gst?${new URLSearchParams({ dateFrom, dateTo })}`, { signal })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.message || 'Failed to load the GST summary')
      return body
    },
    enabled: !!dateFrom && !!dateTo,
    refetchOnWindowFocus: false
  })

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-white mb-2">GST Summary</h1>
        <p className="text-sm text-slate-400 mb-6">Output tax on sales less credit notes, against input tax on purchases less debit notes. Pick a month to match a return period.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Period</label>
            <DateRangeFilter startDate={dateFrom} endDate={dateTo} onDateChange={(s, e) => { setDateFrom(s); setDateTo(e) }} placeholder="Select period..." />
          </div>
          <div className="flex items-end">
            {d && (
              <ExportMenu
                data={d.hsn}
                columns={[
                  { key: 'hsn', label: 'HSN', enabled: true }, { key: 'rate', label: 'Rate %', enabled: true },
                  { key: 'qty', label: 'Qty', enabled: true }, { key: 'taxable', label: 'Taxable', enabled: true },
                  { key: 'cgst', label: 'CGST', enabled: true }, { key: 'sgst', label: 'SGST', enabled: true },
                  { key: 'igst', label: 'IGST', enabled: true }, { key: 'tax', label: 'Total Tax', enabled: true }
                ]}
                config={{ title: 'HSN Summary', fileName: `HSN_Summary_${getLocalDateString()}` }}
              />
            )}
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}
        {error && <div className="text-red-400 py-6 text-center">{(error as Error).message}</div>}

        {d && !isLoading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Output tax (net of credit notes)</div><div className="text-2xl font-bold text-white">{money(d.output.tax - d.creditNotes.tax)}</div></div>
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700"><div className="text-slate-400 text-sm">Input tax (net of debit notes)</div><div className="text-2xl font-bold text-white">{money(d.input.tax - d.debitNotes.tax)}</div></div>
              <div className={`rounded-lg p-4 border ${d.net.total >= 0 ? 'bg-red-900/20 border-red-700/40' : 'bg-green-900/20 border-green-700/40'}`}>
                <div className="text-slate-400 text-sm">{d.net.total >= 0 ? 'Net payable' : 'Net credit carried forward'}</div>
                <div className="text-2xl font-bold text-white">{money(Math.abs(d.net.total))}</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6 overflow-x-auto">
              <table className="table">
                <thead><tr><th></th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total tax</th></tr></thead>
                <tbody>
                  <HeadRow label="Sales (output)" h={d.output} />
                  <HeadRow label="  of which B2B (buyer GSTIN)" h={d.output.b2b} />
                  <HeadRow label="  of which B2C" h={d.output.b2c} />
                  <HeadRow label="Less credit notes (sale returns)" h={d.creditNotes} sign="−" />
                  <HeadRow label="Purchases (input)" h={d.input} />
                  <HeadRow label="Less debit notes (purchase returns)" h={d.debitNotes} sign="−" />
                  <tr className="border-t border-slate-600">
                    <td className="font-semibold text-white">Net (output − input)</td><td></td>
                    <td className="text-right font-semibold">{money(d.net.cgst)}</td><td className="text-right font-semibold">{money(d.net.sgst)}</td>
                    <td className="text-right font-semibold">{money(d.net.igst)}</td><td className="text-right font-bold text-white">{money(d.net.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-slate-500 mt-3">
                Heads are the bills&apos; own rounded totals. The rate and HSN tables add up lines, so they can differ by the rounding
                {d.output.roundingDifference ? ` (this period: ${money(d.output.roundingDifference)})` : ''}.
                Invoice C (no GST): {d.nonGst.count} bill(s), {money(d.nonGst.total)}.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <RateTable title="Sales by rate" rows={d.output.byRate} />
              <RateTable title="Purchases by rate" rows={d.input.byRate} />
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 overflow-x-auto">
              <h3 className="text-lg font-semibold text-white mb-3">HSN summary (sales)</h3>
              <table className="table">
                <thead><tr><th>HSN</th><th>Rate</th><th className="text-right">Qty</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total tax</th></tr></thead>
                <tbody>
                  {d.hsn.map((h: any) => (
                    <tr key={`${h.hsn}-${h.rate}`}><td>{h.hsn}</td><td>{h.rate}%</td><td className="text-right">{h.qty}</td><td className="text-right">{money(h.taxable)}</td><td className="text-right">{money(h.cgst)}</td><td className="text-right">{money(h.sgst)}</td><td className="text-right">{money(h.igst)}</td><td className="text-right text-white">{money(h.tax)}</td></tr>
                  ))}
                  {d.hsn.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-3">No sales</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
