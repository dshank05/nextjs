import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * On the refund side of the transaction screens: the party's returns still
 * waiting for their money. A refund entered here is on account; a return is
 * refunded by opening it and marking it complete (owner decision 2026-10-03),
 * so this lists them with a link instead of offering to allocate to them.
 */
interface PendingReturn {
  key: string
  label: string
  amount: number
  href: string
}

export function PendingReturnsHint({ party, partyId }: { party: 'customer' | 'vendor'; partyId: number }) {
  const [rows, setRows] = useState<PendingReturn[] | null>(null)

  useEffect(() => {
    if (!partyId) { setRows(null); return }
    const ctrl = new AbortController()
    const url = party === 'customer'
      ? `/api/sale-returns?customer=${partyId}&limit=1000&sortBy=return_date&sortOrder=asc`
      : `/api/purchase-returns?vendor=${partyId}&status=0&limit=1000&sortBy=return_date&sortOrder=asc`
    fetch(url, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : { returns: [] }))
      .then(data => {
        const list = (data.returns || [])
          .filter((r: any) => (r.payment_status ?? 0) !== 1)
          .map((r: any) => ({
            key: `${r.invoice_type || 'purchase'}-${r.id}`,
            label: r.debit_note_no ? `${r.return_no} (${r.debit_note_no})` : r.return_no,
            amount: Number(r.refund_amount) || 0,
            href: party === 'customer'
              ? `/entry/salereturn/${r.id}?type=${r.invoice_type}`
              : `/entry/purchasereturn-vendor/${r.id}`
          }))
        setRows(list)
      })
      .catch(() => setRows(null))
    return () => ctrl.abort()
  }, [party, partyId])

  return (
    <div className="mt-4 rounded border border-blue-700/40 bg-blue-900/10 p-4 text-sm">
      <p className="text-slate-300">
        This refund is recorded <span className="font-semibold">on account</span>. To refund a particular return,
        open the return and mark it <span className="font-semibold">complete</span>: that issues the
        {party === 'customer' ? ' credit' : ' debit'} note and settles the balance.
      </p>
      {rows && rows.length > 0 && (
        <div className="mt-3">
          <div className="text-slate-400 mb-1">Returns waiting for their refund:</div>
          <ul className="space-y-1">
            {rows.map(r => (
              <li key={r.key} className="flex justify-between gap-4">
                <Link href={r.href} className="text-blue-400 hover:underline">{r.label}</Link>
                <span className="text-slate-300">₹{r.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
