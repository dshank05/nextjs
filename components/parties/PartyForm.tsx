import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { SearchableSelect, ClearableInput } from '../common'
import { broadcast } from '../../lib/broadcast'
import { PARTY_UI, useParty, useSaveParty, type PartyKind } from '../../hooks/useParties'
import { useStates } from '../../hooks/useStates'

/**
 * Create / edit a customer or vendor (one component; DETAILS_PLAN D3).
 * Customer: billing, shipping (or "Copy from Billing"), contact. Vendor: one card.
 * Same checks as before, now with the snackbar listing this attempt's errors,
 * the button disabled while saving and the confirm closing on a refusal.
 * Status is not sent, so an edit keeps it.
 */
type Kind = 'text' | 'tel' | 'email' | 'pin' | 'gstin' | 'state'
interface Field { key: string; label: string; kind?: Kind; required?: boolean; placeholder?: string }

const PHONE = /^[6-9]\d{9}$/
const PIN = /^\d{6}$/

const BILLING: Field[] = [
  { key: 'billing_name', label: 'BILLING NAME', required: true, placeholder: 'Enter billing name' },
  { key: 'billing_address', label: 'BILLING ADDRESS LINE 1', required: true, placeholder: 'Street address, building, etc.' },
  { key: 'billing_address_2', label: 'BILLING ADDRESS LINE 2', placeholder: 'Area, locality, landmark (optional)' },
  { key: 'billing_city', label: 'BILLING CITY', placeholder: 'Enter city name' },
  { key: 'billing_pin_code', label: 'BILLING PIN CODE', kind: 'pin', placeholder: '6-digit pin code' },
  { key: 'billing_state', label: 'BILLING STATE', kind: 'state', required: true },
  { key: 'billing_gstin', label: 'BILLING GSTIN', kind: 'gstin', placeholder: '15-digit GST number' }
]
const SHIPPING: Field[] = BILLING.map(f => ({ ...f, key: f.key.replace('billing_', 'shipping_'), label: f.label.replace('BILLING', 'SHIPPING'), required: f.key === 'billing_name' || f.key === 'billing_address' || f.key === 'billing_state' }))
const CONTACT: Field[] = [
  { key: 'contact_no', label: 'CONTACT NUMBER', kind: 'tel', required: true, placeholder: 'Enter phone number' },
  { key: 'contact_no_2', label: 'PHONE 2', kind: 'tel', placeholder: 'Additional phone' },
  { key: 'contact_no_3', label: 'PHONE 3', kind: 'tel', placeholder: 'Additional phone' },
  { key: 'email', label: 'EMAIL ADDRESS', kind: 'email', placeholder: 'Enter email address' }
]
const VENDOR: Field[] = [
  { key: 'vendor_name', label: 'Vendor Name', required: true, placeholder: 'Enter vendor name' },
  { key: 'address', label: 'Address', placeholder: 'Primary address' },
  { key: 'address_2', label: 'Address 2', placeholder: 'Additional address information' },
  { key: 'city', label: 'City', placeholder: 'City name' },
  { key: 'pin_code', label: 'Pin Code', kind: 'pin', placeholder: '6-digit pin code' },
  { key: 'contact_no', label: 'Contact No', kind: 'tel', required: true, placeholder: '+91-XXXXXXXXXX' },
  { key: 'contact_no_2', label: 'Phone 2', kind: 'tel', placeholder: 'Additional phone number' },
  { key: 'contact_no_3', label: 'Phone 3', kind: 'tel', placeholder: 'Additional phone number' },
  { key: 'email', label: 'Email', kind: 'email', placeholder: 'vendor@example.com' },
  { key: 'tax_id', label: 'GST No', kind: 'gstin', placeholder: '22AAAAA0000A1Z5' },
  { key: 'state', label: 'State', kind: 'state', required: true }
]
const SHIP_FROM_BILL = SHIPPING.map(f => [f.key, f.key.replace('shipping_', 'billing_')] as const)

const REQUIRED_MSG: Record<string, string> = {
  billing_name: 'Billing name is required', billing_address: 'Billing address is required', billing_state: 'Billing state is required',
  shipping_name: 'Shipping name is required', shipping_address: 'Shipping address is required', shipping_state: 'Shipping state is required',
  contact_no: 'Contact number is required', vendor_name: 'Vendor name is required', state: 'State is required'
}
const PHONE_MSG: Record<string, string> = {
  contact_no: 'Phone number must be 10 digits and start with 6-9',
  contact_no_2: 'Phone 2 must be 10 digits and start with 6-9',
  contact_no_3: 'Phone 3 must be 10 digits and start with 6-9'
}

function check(fields: Field[], v: Record<string, string>, isCustomer: boolean) {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    const value = (v[f.key] || '').trim()
    if (f.required && !value) { errors[f.key] = REQUIRED_MSG[f.key] || `${f.label} is required`; continue }
    if (!value) continue
    if (f.kind === 'tel' && !PHONE.test(value)) errors[f.key] = PHONE_MSG[f.key]
    if (f.kind === 'pin' && !PIN.test(value)) errors[f.key] = 'Pin code must be exactly 6 digits'
    if (f.kind === 'email' && !/\S+@\S+\.\S+/.test(value)) errors[f.key] = 'Please enter a valid email address'
    if (f.kind === 'gstin' && value.length !== 15) errors[f.key] = isCustomer ? 'GSTIN must be 15 characters' : 'GSTIN must be exactly 15 characters'
  }
  return errors
}

const blank = (kind: PartyKind) => {
  const keys = kind === 'customer' ? [...BILLING, ...SHIPPING, ...CONTACT].map(f => f.key).concat('billing_state_code', 'shipping_state_code') : VENDOR.map(f => f.key).concat('state_code')
  return Object.fromEntries(keys.map(k => [k, ''])) as Record<string, string>
}

export function PartyForm({ kind }: { kind: PartyKind }) {
  const P = PARTY_UI[kind]
  const isCustomer = kind === 'customer'
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const isEditing = !!id
  const { data: existing, isLoading } = useParty(kind, id)
  const save = useSaveParty(kind)
  // The shared states query (['states'] is also used by the bill forms, same shape).
  const { data: states = [] } = useStates()

  const [form, setForm] = useState<Record<string, string>>(() => blank(kind))
  const [copy, setCopy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState(false)
  const loaded = useRef(false)

  // Fill once from the saved record; later refetches must not wipe edits in progress.
  useEffect(() => {
    if (!existing || loaded.current) return
    loaded.current = true
    const next = blank(kind)
    for (const k of Object.keys(next)) next[k] = existing[k] == null ? '' : String(existing[k])
    if (isCustomer) {
      // E-01: "Copy from Billing" is ticked only when there is no shipping
      // address or EVERY shipping field equals its billing twin - not when
      // the names alone match (a firm shipping to its own godown under its own
      // name lost the godown address on any save). There is no stored flag;
      // the fields are the record of it.
      const noCode = (c: string) => !c || c === '0'
      const sameAsBilling = SHIP_FROM_BILL.every(([s, b]) => next[s].trim() === next[b].trim())
        && (noCode(next.shipping_state_code) || next.shipping_state_code === next.billing_state_code)
      setCopy(!next.shipping_name.trim() || sameAsBilling)
      // E-02: a separate shipping address loads as stored - its blank fields
      // stay blank (filling them from billing saved billing's line 2 / city /
      // pin / GSTIN into it). Only a missing state code follows billing, and
      // only when it is the billing state.
      if (noCode(next.shipping_state_code) && next.shipping_state === next.billing_state) next.shipping_state_code = next.billing_state_code
    }
    setForm(next)
  }, [existing, kind, isCustomer])

  // While copying, shipping shows (and saves) billing.
  const values = copy ? { ...form, ...Object.fromEntries(SHIP_FROM_BILL.map(([s, b]) => [s, form[b]])), shipping_state_code: form.billing_state_code } : form

  const set = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }
  const setState = (key: string, name: string | null) => {
    const code = name ? String(states.find(s => s.name === name)?.code ?? '') : ''
    setForm(prev => ({ ...prev, [key]: name || '', [`${key}_code`]: code }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }
  const toggleCopy = (on: boolean) => {
    setCopy(on)
    // Unticking starts the shipping address empty, as before.
    if (!on) setForm(prev => ({ ...prev, ...Object.fromEntries(SHIPPING.map(f => [f.key, ''])), shipping_state_code: '' }))
  }

  const fieldsToCheck = isCustomer ? [...BILLING, ...(copy ? [] : SHIPPING), ...CONTACT] : VENDOR
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const found = check(fieldsToCheck, values, isCustomer)
    setErrors(found)
    const list = Object.values(found).filter(Boolean)
    if (list.length) { showSnackbar('error', `Please fix the following errors: ${list.join(', ')}`); return }
    setAsking(true)
  }

  const body = () => {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(values)) out[k] = typeof v === 'string' ? v.trim() : v
    for (const k of ['billing_state_code', 'shipping_state_code', 'state_code']) if (k in out) out[k] = parseInt(out[k]) || 0
    for (const k of ['contact_no_2', 'contact_no_3']) out[k] = out[k] || null
    return out
  }

  const confirm = () => save.mutate({ id, data: body() }, {
    onSuccess: () => {
      setAsking(false)
      broadcast(isEditing
        ? { type: 'updated', resource: P.plural, id: parseInt(id as string) }
        : { type: 'created', resource: P.plural, data: { name: values[P.nameField] } })
      if (isEditing) router.push(P.viewUrl(id as string))
      else if (typeof window !== 'undefined' && window.opener) {
        // Opened from a bill form in a new tab: close it, the form there refreshes on the broadcast.
        router.push(P.listUrl)
        setTimeout(() => window.close(), 100)
      } else router.push(P.listUrl)
    },
    onError: (err: Error) => {
      setAsking(false)
      setErrors({ submit: err.message })
      showSnackbar('error', err.message)
    }
  })

  const cancel = () => {
    const from = router.query.from
    if (isCustomer && from === 'sale') router.push('/sale/create')
    else if (isCustomer && from === 'salex') router.push('/salex/create')
    else router.push(P.listUrl)
  }

  if (isEditing && (isLoading || !router.isReady)) {
    return <div className="card h-96 flex items-center justify-center"><div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div></div>
  }

  const stateOptions = [{ id: '', name: 'Select State' }, ...states.map(s => ({ id: s.name, name: s.name }))]
  const input = (f: Field, locked = false) => {
    const value = values[f.key] || ''
    const err = errors[f.key]
    let control: React.ReactNode
    if (f.kind === 'state') {
      control = <SearchableSelect options={stateOptions} selectedValue={value} onSelectionChange={(v: string | null) => setState(f.key, v)} placeholder="Select State" disabled={locked} />
    } else if (f.kind === 'pin' || f.kind === 'gstin') {
      control = (
        <input
          type="text" name={f.key} value={value} className="input w-full" placeholder={f.placeholder}
          maxLength={f.kind === 'pin' ? 6 : 15} disabled={locked} readOnly={locked}
          onChange={e => set(f.key, f.kind === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value.toUpperCase())}
        />
      )
    } else {
      control = (
        <ClearableInput
          type={f.kind === 'tel' ? 'tel' : f.kind === 'email' ? 'email' : 'text'} name={f.key} value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(f.key, e.target.value)} placeholder={f.placeholder}
          maxLength={f.kind === 'tel' ? 10 : undefined} disabled={locked} readOnly={locked}
        />
      )
    }
    return (
      <div key={f.key}>
        <label className="block text-sm font-medium text-slate-300 mb-2">{f.label}{f.required ? ' *' : ''}</label>
        {control}
        {err && <p className="text-red-400 text-xs mt-1">{err}</p>}
      </div>
    )
  }
  const grid = (fields: Field[], locked = false) => <div className="grid grid-cols-1 md:grid-cols-4 gap-4">{fields.map(f => input(f, locked))}</div>
  const heading = (text: string) => <h3 className="text-lg font-medium text-white border-b border-slate-600 pb-2">{text}</h3>

  return (
    <div className="space-y-6">
      <div className="card">
        <form onSubmit={submit} className="p-6 space-y-6">
          {isCustomer ? (
            <>
              <div className="space-y-4">{heading('🏢 Billing Information')}{grid(BILLING)}</div>
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-600 pb-2">
                  <h3 className="text-lg font-medium text-white">🚚 Shipping Information</h3>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={copy} onChange={e => toggleCopy(e.target.checked)} className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500 focus:ring-2" />
                    Copy from Billing
                  </label>
                </div>
                {grid(SHIPPING, copy)}
              </div>
              <div className="space-y-4">{heading('📞 Contact Information')}{grid(CONTACT)}</div>
            </>
          ) : (
            <div className="space-y-4">{heading(isEditing ? 'Edit Vendor' : 'Vendor Information')}{grid(VENDOR)}</div>
          )}

          {errors.submit && (
            <div className="bg-red-900 border border-red-700 rounded p-3"><p className="text-red-200 text-sm">{errors.submit}</p></div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700">
            <button type="button" onClick={cancel} disabled={save.isPending} className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors">Cancel</button>
            <button type="submit" disabled={save.isPending} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {save.isPending ? (isEditing ? 'Updating...' : 'Creating...') : `${isEditing ? 'Update' : 'Create'} ${P.label}`}
            </button>
          </div>
        </form>
      </div>

      <ConfirmationModal
        isOpen={asking}
        title={`${isEditing ? 'Update' : 'Create'} ${P.label}`}
        message={`Are you sure you want to ${isEditing ? 'update' : 'create'} ${kind} "${values[P.nameField]}"${isCustomer ? (copy ? ' with shipping address copied from billing?' : ' with separate shipping address?') : '?'}`}
        showLoading={save.isPending}
        onConfirm={confirm}
        onCancel={() => setAsking(false)}
      />
    </div>
  )
}
