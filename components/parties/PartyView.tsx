import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { PARTY_UI, useParty, usePartyStatus, type PartyKind } from '../../hooks/useParties'

/**
 * One customer or vendor (one component; DETAILS_PLAN D3): overview, contacts,
 * activate / deactivate (failures shown now), Edit, what they owe or are owed
 * with links to their ledger and transactions, then the address sections.
 */
const money = (v: number) => `₹${Math.abs(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Line({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}:</span>
      <span className={`text-white font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function PartyView({ kind }: { kind: PartyKind }) {
  const P = PARTY_UI[kind]
  const isCustomer = kind === 'customer'
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const { data: p, isLoading, error } = useParty(kind, id)
  const status = usePartyStatus(kind)
  const [asking, setAsking] = useState(false)

  if (isLoading || !router.isReady) {
    return <div className="card h-96 flex items-center justify-center"><div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div></div>
  }
  if (error || !p) {
    return <div className="card"><p className="text-center text-slate-400">{(error as Error | null)?.message || `${P.label} not found`}</p></div>
  }

  const name = p[P.nameField]
  const next = p.status === 'Active' ? 'Inactive' : 'Active'
  const confirmStatus = () => status.mutate({ id: p.id, status: next }, {
    onSuccess: () => { setAsking(false); showSnackbar('success', `${P.label} ${next === 'Active' ? 'activated' : 'deactivated'}`) },
    onError: (e: Error) => { setAsking(false); showSnackbar('error', e.message || `Failed to update ${kind} status`) }
  })
  const openWith = (key: string, url: string) => {
    try { sessionStorage.setItem(key, JSON.stringify(p.id)) } catch { /* the page still opens */ }
    router.push(url)
  }
  const owed = Number(p.outstanding) || 0
  // Customer ledger: debit = they owe us. Vendor ledger: debit = we owe them.
  const owedText = Math.abs(owed) < 0.01 ? 'Settled'
    : isCustomer ? (owed > 0 ? `${money(owed)} receivable` : `${money(owed)} in advance`)
      : (owed > 0 ? `${money(owed)} payable` : `${money(owed)} in advance`)
  const contacts = [p.contact_no, p.contact_no_2, p.contact_no_3].filter(Boolean).join(', ')
  const pick = (k: string) => p[k] || 'N/A'

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="flex flex-col items-center justify-center text-center">
            <div className={`w-40 h-24 ${isCustomer ? 'bg-blue-600/20' : 'bg-green-600/20'} rounded-xl flex items-center justify-center mb-3`}>
              <div className="text-3xl">{P.icon}</div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">{name}</h3>
            <p className="text-slate-400 mb-1">{p.contact_no || 'No phone'}</p>
          </div>

          <div className="space-y-3">
            <div className="border-b border-slate-700 pb-1"><Line label={P.gstLabel} value={p[P.gstField] || 'Not provided'} /></div>
            {!isCustomer && <div className="border-b border-slate-700 pb-1"><Line label="City" value={p.city || 'Not provided'} /></div>}
            {!isCustomer && <div className="border-b border-slate-700 pb-1"><Line label="Pin Code" value={p.pin_code || 'Not provided'} /></div>}
            <div className="border-b border-slate-700 pb-1"><Line label="State" value={p[P.stateField] || 'Not provided'} /></div>
            <div className="border-b border-slate-700 pb-1">
              <Line label="Status" value={<span className={`px-2 py-1 rounded-full text-xs ${p.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{p.status}</span>} />
            </div>
            <div className="border-b border-slate-700 pb-1"><Line label="Contact" value={contacts || 'Not provided'} /></div>
            <div className="border-b border-slate-700 pb-1">
              <Line label="Email" value={p.email ? <a href={`mailto:${p.email}`} className="text-blue-400 hover:text-blue-300">{p.email}</a> : 'Not provided'} />
            </div>
            <div className="border-b border-slate-700 pb-1">
              <Line label="Account" value={
                <span className="flex items-center gap-3">
                  <span className={Math.abs(owed) < 0.01 ? 'text-green-400' : owed > 0 ? 'text-yellow-400' : 'text-blue-300'}>{owedText}</span>
                  <button className="text-blue-400 hover:underline text-sm" onClick={() => openWith(P.ledgerKey, P.ledgerUrl)}>Ledger</button>
                  <button className="text-blue-400 hover:underline text-sm" onClick={() => openWith(P.txKey, P.txUrl)}>Transactions</button>
                </span>
              } />
            </div>
            <div className="flex justify-end pt-3">
              <button
                className={`px-4 py-2 rounded text-white font-medium ${p.status === 'Active' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                onClick={() => setAsking(true)}
              >
                {p.status === 'Active' ? 'Deactivate' : 'Activate'} {P.label}
              </button>
              <Link href={`${P.formUrl}?id=${p.id}`} className="btn-primary px-4 py-2 ml-2">✏️ Edit {P.label}</Link>
            </div>
          </div>
        </div>

        {isCustomer ? (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white mb-4">📄 Billing Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Line label="Name" value={p.billing_name} />
                <Line label="GSTIN" value={pick('billing_gstin')} mono />
                <Line label="Phone" value={pick('contact_no')} />
                <Line label="City" value={pick('billing_city')} />
                <Line label="Address" value={p.billing_address} />
                <Line label="Address 2" value={pick('billing_address_2')} />
                <Line label="Pin Code" value={pick('billing_pin_code')} />
                <Line label="State" value={p.billing_state} />
              </div>
            </div>
            {(p.shipping_name || p.shipping_address) && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4 mt-6 pt-4 border-t border-slate-700">🚚 Shipping Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Line label="Name" value={p.shipping_name || p.billing_name} />
                  <Line label="GSTIN" value={p.shipping_gstin || p.billing_gstin || 'N/A'} mono />
                  <Line label="City" value={p.shipping_city || p.billing_city || 'N/A'} />
                  <Line label="State" value={p.shipping_state || p.billing_state} />
                  <Line label="Address" value={p.shipping_address || p.billing_address} />
                  <Line label="Address 2" value={p.shipping_address_2 || p.billing_address_2 || 'N/A'} />
                  <Line label="Pin Code" value={p.shipping_pin_code || p.billing_pin_code || 'N/A'} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">🏢 Vendor Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Line label="Name" value={p.vendor_name} />
              <Line label="GST ID" value={pick('tax_id')} mono />
              <Line label="Phone" value={pick('contact_no')} />
              <Line label="City" value={pick('city')} />
              <Line label="Address" value={pick('address')} />
              <Line label="Address 2" value={pick('address_2')} />
              <Line label="Pin Code" value={pick('pin_code')} />
              <Line label="State" value={pick('state')} />
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={asking}
        title={`${next === 'Active' ? 'Activate' : 'Deactivate'} ${P.label}`}
        message={`Are you sure you want to ${next === 'Active' ? 'activate' : 'deactivate'} ${kind} "${name}"? This will affect their availability in transaction selections.`}
        showLoading={status.isPending}
        onConfirm={confirmStatus}
        onCancel={() => setAsking(false)}
      />
    </div>
  )
}
