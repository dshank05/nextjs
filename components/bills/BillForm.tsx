import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { Loader, Calculator } from 'lucide-react'
import { SearchableSelect } from '../common/SearchableSelect'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { BillLines, type BillLine } from './BillLines'
import { broadcast, subscribeBroadcast } from '../../lib/broadcast'
import { getLocalDateString } from '../../lib/date-utils'
import { getBusinessStateCode, resolveSupplyType } from '../../lib/gst'
import { computeBill, packingAmount, parseNum, money } from '../../lib/line-math'
import { BILL, useBill, useNextBillNumber, useSaveBill, type BillKind } from '../../hooks/useBills'
import { useCustomers } from '../../hooks/useCustomers'
import { useVendors } from '../../hooks/useVendors'
import { useStaff } from '../../hooks/useStaff'
import { useMechanics } from '../../hooks/useMechanics'
import { useFilterOptions } from '../../hooks/useProducts'
import { useStates } from '../../hooks/useStates'
import { useBusinessDetails } from '../../hooks/useBusinessDetails'
import type { Product } from '../../types/products'

/**
 * Create and edit a purchase, sale or Invoice C - one form (BILLS_PLAN B5).
 * Replaces SaleForm and the 639-line purchase form.
 *
 * The browser sends what the user decided; the server computes and stores every
 * amount, and the figures here are a preview made by the same function
 * (lib/line-math computeBill). Per kind: the party (customer / vendor), the
 * extra header fields (reference date; mechanic and commission), discount
 * (sale, Invoice C), tax (not on Invoice C) and the default line rate.
 *
 * Changed on the way (owner, 2026-10-03): the purchase number is assigned by the
 * server like a sale's; freight is in the purchase total; changing the vendor
 * on a new purchase keeps the lines; "+ Add New" opens a tab that can close
 * itself after saving.
 */
const OTHER = '0'

const emptyParty = {
  name: '', contact_number: '', email_id: '', gst_number: '', address: '', address_2: '', city: '', state: '',
  state_code: null as number | null, pin_code: ''
}

/** A unix timestamp as the <input type="date"> value, in the browser's own day. */
const toDateInput = (ts: number | null | undefined) => (ts ? getLocalDateString(new Date(ts * 1000)) : '')

/** A new line starts at the product's selling price (sale) or last purchase rate (purchase). */
const sellingRate = (p: Product) => p.latest_selling_price || p.selling_price || p.rate || 0
const purchaseRate = (p: Product) => p.latest_purchase_rate || p.opening_rate || p.rate || 0

export function BillForm({ kind }: { kind: BillKind }) {
  const B = BILL[kind]
  const isPurchase = kind === 'purchase'
  const taxFree = B.taxFree
  const router = useRouter()
  const { showSnackbar } = useSnackbar()
  const save = useSaveBill(kind)

  const editParam = router.isReady && typeof router.query.edit === 'string' ? router.query.edit : null
  const editId = editParam ? parseInt(editParam, 10) : null
  const isEditMode = editId !== null && !isNaN(editId)

  const { data: customers = [], refetch: refetchCustomers } = useCustomers()
  const { data: vendors = [], refetch: refetchVendors } = useVendors()
  const { data: staff = [] } = useStaff()
  const { data: mechanics = [] } = useMechanics()
  const { data: filterOptions = { categories: [], subcategories: [], companies: [], models: [] } } = useFilterOptions()
  const { data: states = [] } = useStates()
  const { data: business } = useBusinessDetails()
  const { data: nextNumber, isLoading: numberLoading } = useNextBillNumber(kind, router.isReady && !isEditMode)
  // Always the server's copy - never a SessionStorage snapshot.
  const { data: loaded, isLoading: loadingBill } = useBill(kind, isEditMode ? String(editId) : undefined)
  const masters: any[] = (isPurchase ? vendors : customers).filter((p: any) => String(p.id) !== OTHER)

  // ---- form state
  const [header, setHeader] = useState({
    invoice_no: '', bill_reference: '', bill_reference_date: '', staff_id: '', mechanic_id: '', commission: '', date: '',
    transport_name: '', vehicle_number: '', freight: '', descriptions: '', notes: ''
  })
  const [partyId, setPartyId] = useState('')
  const [party, setParty] = useState(emptyParty)
  const [lines, setLines] = useState<BillLine[]>([])
  const [enableTax, setEnableTax] = useState(!taxFree && !isPurchase)
  const [enableDiscount, setEnableDiscount] = useState(false)
  const [packing, setPacking] = useState({ qty: '', rate: '', total: '' })
  const [paymentStatus, setPaymentStatus] = useState(0)
  const [statusTouched, setStatusTouched] = useState(false)
  const [paymentMode, setPaymentMode] = useState(0)
  const [lineEditing, setLineEditing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [populated, setPopulated] = useState(false)
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const isOther = partyId === OTHER
  const setH = (field: keyof typeof header, value: string) => {
    setHeader(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }
  const setP = (field: keyof typeof emptyParty, value: any) => {
    setParty(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  // ---- create: today's (local) date and the number the server will give
  useEffect(() => {
    if (router.isReady && !isEditMode) setHeader(prev => ({ ...prev, date: prev.date || getLocalDateString() }))
  }, [router.isReady, isEditMode])
  useEffect(() => {
    if (!isEditMode && nextNumber) setHeader(prev => ({ ...prev, invoice_no: String(nextNumber) }))
  }, [nextNumber, isEditMode])

  // ---- edit: fill the form ONCE from the loaded bill (nothing here clears lines)
  useEffect(() => {
    if (!isEditMode || !loaded || populated) return
    const b = loaded
    setHeader({
      invoice_no: String(b.invoice_no || ''),
      bill_reference: b.bill_reference,
      bill_reference_date: b.bill_reference_date,
      staff_id: b.staff_id ? String(b.staff_id) : '',
      mechanic_id: b.mechanic_id ? String(b.mechanic_id) : '',
      commission: b.commission ? String(b.commission) : '',
      date: toDateInput(b.invoice_date),
      transport_name: b.transport_name,
      vehicle_number: b.vehicle_number,
      freight: b.freight ? String(b.freight) : '',
      descriptions: b.descriptions,
      notes: b.notes
    })
    setPartyId(String(b.party.id ?? 0))
    setParty({
      name: b.party.name, contact_number: b.party.contact, email_id: b.party.email, gst_number: b.party.gstin,
      address: b.party.address, address_2: b.party.address_2, city: b.party.city, state: b.party.state,
      state_code: b.party.state_code, pin_code: b.party.pin_code
    })
    const loadedLines: BillLine[] = b.items.map(i => ({
      key: `line-${i.line_id}`,
      line_id: i.line_id,
      product_id: i.product_id,
      product_name: i.product_name,
      display_name: i.display_name,
      car_model: i.car_model,
      model_id: i.model_id,
      company_id: i.company_id,
      part: i.part,
      qty: i.qty,
      rate: i.rate,
      discount: i.discount,
      gst_percentage: i.gst_percentage,
      original_qty: i.original_qty,
      returned_qty: i.returned_qty,
      is_fully_returned: i.is_fully_returned
    }))
    setLines(loadedLines)
    // A taxed bill opens with tax on (PU-06); a discounted one with discount on.
    if (!taxFree) setEnableTax(loadedLines.some(l => l.gst_percentage > 0) || b.total_tax > 0)
    if (B.discount) setEnableDiscount(loadedLines.some(l => l.discount > 0) || b.discount > 0)
    // Older bills stored a total with no rate; derive it so a save keeps the total.
    const pfRate = b.packing_rate || (b.packing_qty > 0 ? b.packing_total / b.packing_qty : 0)
    setPacking({ qty: b.packing_qty ? String(b.packing_qty) : '', rate: pfRate ? String(pfRate) : '', total: b.packing_total ? String(b.packing_total) : '' })
    setPaymentStatus(b.payment_status ?? 0)
    setPaymentMode(b.payment_mode ?? 0)
    setPopulated(true)
  }, [isEditMode, loaded, populated, taxFree, B.discount])

  // ---- a party created in another tab ("+ Add New")
  useEffect(() => subscribeBroadcast((message) => {
    if (message.type !== 'created') return
    if (message.resource === 'customers' && !isPurchase) refetchCustomers()
    if (message.resource === 'vendors' && isPurchase) refetchVendors()
  }), [refetchCustomers, refetchVendors, isPurchase])

  const selectParty = (id: string) => {
    setPartyId(id)
    setErrors(prev => ({ ...prev, party: '', name: '', contact_number: '' }))
    if (id === OTHER || id === '') { setParty(emptyParty); return }
    const m: any = masters.find((x: any) => String(x.id) === id)
    if (!m) { setParty(emptyParty); return }
    setParty(isPurchase
      ? {
          name: m.vendor_name || '', contact_number: m.contact_no || '', email_id: m.email || '', gst_number: m.tax_id || '',
          address: m.address || '', address_2: m.address_2 || '', city: m.city || '', state: m.state || '',
          state_code: m.state_code ?? null, pin_code: m.pin_code || ''
        }
      : {
          name: m.billing_name || '', contact_number: m.contact_no || '', email_id: m.email || '', gst_number: m.billing_gstin || '',
          address: m.billing_address || '', address_2: m.billing_address_2 || '', city: m.billing_city || '', state: m.billing_state || '',
          state_code: m.billing_state_code ?? null, pin_code: ''
        })
  }

  // ---- preview of the server's arithmetic
  const businessState = getBusinessStateCode(business?.gstin)
  const supplyType = taxFree ? 'INTRA_STATE' : resolveSupplyType(party.state_code, businessState, party.state_code != null)
  const gstSent = (l: BillLine) => (enableTax && !taxFree ? l.gst_percentage : 0)
  const discountSent = (l: BillLine) => (B.discount && enableDiscount ? l.discount : 0)
  const packingOut = useMemo(() => packingAmount(packing.qty, packing.rate, packing.total), [packing])
  const bill = useMemo(() => computeBill(
    lines.map(l => ({ qty: l.qty, rate: l.rate, gst_percentage: gstSent(l), discount: discountSent(l) })),
    { supplyType: supplyType as any, taxFree, packingTotal: packingOut.total, freight: parseNum(header.freight) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [lines, enableTax, enableDiscount, supplyType, packingOut, header.freight, taxFree])

  // ---- what gets sent: decisions only, never totals
  const buildPayload = () => {
    const common: any = {
      date: header.date,
      bill_reference: header.bill_reference,
      staff_id: header.staff_id ? parseInt(header.staff_id, 10) : null,
      transport_name: header.transport_name,
      vehicle_number: header.vehicle_number,
      transport_cost: parseNum(header.freight),
      descriptions: header.descriptions,
      notes: header.notes,
      packing_forwarding_qty: packingOut.qty,
      packing_forwarding_rate: packingOut.rate,
      payment_mode: paymentMode,
      contact_number: party.contact_number,
      email_id: party.email_id,
      gst_number: party.gst_number,
      address: party.address,
      address_2: party.address_2,
      city: party.city,
      state: party.state,
      state_code: party.state_code
    }
    const lineOut = (l: BillLine) => ({
      ...(l.line_id ? { line_id: l.line_id } : {}),
      product_id: l.product_id,
      model_id: l.model_id,
      company_id: l.company_id,
      part: l.part,
      qty: l.qty,
      rate: l.rate,
      // Tax off means the bill carries no GST - what the user sees is what is saved.
      gst_percentage: gstSent(l)
    })
    const payload: any = isPurchase
      ? {
          ...common,
          bill_reference_date: header.bill_reference_date,
          vendor_name: party.name,
          pin_code: party.pin_code,
          items: lines.map(l => ({ ...lineOut(l), car_model: l.car_model }))
        }
      : {
          ...common,
          customer_name: party.name,
          mechanic_id: header.mechanic_id ? parseInt(header.mechanic_id, 10) : null,
          commission: parseNum(header.commission),
          invoiceItems: lines.map(l => ({ ...lineOut(l), discount: discountSent(l) }))
        }
    // The party cannot change on a saved bill; the server refuses it.
    if (!isEditMode) payload[isPurchase ? 'vendor_id' : 'select_customer'] = partyId === '' ? null : parseInt(partyId, 10)
    // A loaded status is the server's to keep; only a status the user picked is sent.
    if (!isEditMode || statusTouched) payload.payment_status = paymentStatus
    return payload
  }

  // Snapshot of the loaded bill, once the form shows it, for "no changes".
  useEffect(() => {
    if (populated && snapshot === null) setSnapshot(JSON.stringify(buildPayload()))
  })
  const hasChanges = !isEditMode || snapshot === null || JSON.stringify(buildPayload()) !== snapshot

  // ---- submit
  const validate = () => {
    const e: Record<string, string> = {}
    if (lineEditing) e.products = 'Save or cancel the line being edited first'
    if (partyId === '') e.party = `Please select a ${B.party}`
    if (isOther && !party.name.trim()) e.name = `${B.partyLabel} name is required`
    if (isOther && !party.contact_number.trim()) e.contact_number = 'Phone number is required'
    if (lines.length === 0) e.products = e.products || 'At least one product is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = () => {
    setConfirmOpen(false)
    save.mutate({ id: isEditMode ? (editId as number) : undefined, payload: buildPayload() }, {
      onSuccess: (id) => {
        broadcast({ type: isEditMode ? 'updated' : 'created', resource: B.resource as any, data: { id } })
        showSnackbar('success', `${B.title} ${isEditMode ? 'updated' : 'created'} successfully!`)
        router.push(id ? `${B.viewUrl}/${id}` : B.listUrl)
      },
      onError: (error: Error) => showSnackbar('error', error.message || `Failed to ${isEditMode ? 'update' : 'create'} ${B.title}`)
    })
  }

  const fullyReturned = !!loaded?.return_status.is_fully_returned
  const returnStatus = loaded?.return_status
  const readOnly = (ro: boolean) => `input w-full ${ro ? 'bg-slate-700 cursor-not-allowed' : ''}`
  const label = 'block text-sm font-medium text-slate-300 mb-2'
  const statusOptions = [
    { id: '0', name: 'Unpaid' },
    { id: '1', name: 'Paid' },
    // Derived by the server from allocations; shown, not offered.
    ...(paymentStatus === 2 ? [{ id: '2', name: 'Partially Paid' }] : [])
  ]
  const stateId = states.find((s: any) => party.state_code != null && s.code === party.state_code)?.id
    ?? states.find((s: any) => s.name === party.state)?.id ?? ''
  const nameOf = (m: any) => (isPurchase ? m.vendor_name : m.billing_name)
  const totalsShown: [string, number][] = [
    [B.discount ? 'ITEMS (AFTER DISCOUNT)' : 'ITEMS TOTAL', bill.itemsTotal],
    ...(B.discount ? [['DISCOUNT', bill.discountTotal] as [string, number]] : []),
    ...(taxFree ? [] : [['CGST', bill.totalCgst], ['SGST', bill.totalSgst], ['IGST', bill.totalIgst], ['TOTAL TAX', bill.totalTax]] as [string, number][])
  ]

  return (
    <div className="space-y-3">
      {isEditMode && loadingBill && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center !mt-0">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-slate-200 font-medium">Loading {B.title}</p>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (validate()) setConfirmOpen(true) }} className="space-y-3">
        {isEditMode && returnStatus?.has_returns && (
          <div className={`card ${fullyReturned ? 'bg-red-900/20 border-red-700' : 'bg-orange-900/20 border-orange-700'}`}>
            <div className="p-4 flex items-start space-x-3">
              <span className="text-3xl">{fullyReturned ? '🔒' : '⚠️'}</span>
              <div>
                <h3 className={`text-lg font-bold ${fullyReturned ? 'text-red-300' : 'text-orange-300'}`}>
                  {B.title} {fullyReturned ? 'Fully Returned' : 'Partially Returned'}
                </h3>
                <p className="text-slate-300 mt-1">
                  {returnStatus.fully_returned_items} of {returnStatus.total_items} items have been returned.
                  {fullyReturned ? ' This bill cannot be edited.' : ' Lines with returns cannot be removed or reduced below the returned quantity.'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="p-3">
            {/* Number and header */}
            <div className="mb-5">
              <div className={`grid grid-cols-1 gap-4 ${isPurchase ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
                <div>
                  <label className={label}>{B.numberLabel}</label>
                  {numberLoading && !isEditMode ? (
                    <div className="input w-full flex items-center justify-center bg-slate-700 border border-slate-600 rounded">
                      <Loader className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                      <span className="text-sm text-slate-400">Loading...</span>
                    </div>
                  ) : (
                    // Allocated by the server's counter; shown, not chosen.
                    <input type="text" name="invoice_no" value={header.invoice_no} readOnly className={readOnly(true)} title={isEditMode ? '' : 'The next number in this financial year. The server assigns it on save.'} />
                  )}
                </div>
                <div>
                  <label className={label}>BILL REFERENCE</label>
                  <input type="text" name="bill_reference" value={header.bill_reference} onChange={e => setH('bill_reference', e.target.value)} className="input w-full" placeholder="Enter bill reference" />
                </div>
                {isPurchase && (
                  <div>
                    <label className={label}>BILL REFERENCE DATE</label>
                    <input type="date" name="bill_reference_date" value={header.bill_reference_date} onChange={e => setH('bill_reference_date', e.target.value)} className="input w-full" />
                  </div>
                )}
                <div>
                  <label className={label}>STAFF MEMBER</label>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Staff' }, ...staff.map((m: any) => ({ id: String(m.id), name: m.phone ? `${m.name} - ${m.phone}` : m.name }))]}
                    selectedValue={header.staff_id}
                    onSelectionChange={v => setH('staff_id', v || '')}
                    placeholder="Select Staff"
                  />
                </div>
                <div>
                  <label className={label}>DATE</label>
                  <input type="date" name="date" value={header.date} onChange={e => setH('date', e.target.value)} className="input w-full" />
                </div>
              </div>
            </div>

            {/* Party */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">{B.partyLabel.toUpperCase()} NAME *</label>
                    {!isEditMode && (
                      // rel="opener": the new tab closes itself after saving and this form refreshes on the broadcast.
                      <a href={isPurchase ? '/vendors/create?from=purchase' : `/customers/create?from=${kind}`} target="_blank" rel="opener" className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors">
                        + Add New {B.partyLabel}
                      </a>
                    )}
                  </div>
                  <SearchableSelect
                    options={[{ id: '', name: `Select ${B.partyLabel}` }, { id: OTHER, name: 'Other' }, ...masters.map((m: any) => ({ id: String(m.id), name: nameOf(m) }))]}
                    selectedValue={partyId}
                    onSelectionChange={v => selectParty(v || '')}
                    placeholder={`Select ${B.partyLabel}`}
                    // The server refuses a party change on a saved bill.
                    disabled={isEditMode}
                  />
                  {errors.party && <p className="text-red-400 text-xs mt-1">{errors.party}</p>}
                </div>
                <div>
                  <label className={label}>CONTACT NUMBER{isOther ? ' *' : ''}</label>
                  <input type="text" name="contact_number" value={party.contact_number} onChange={e => setP('contact_number', e.target.value)} className={readOnly(!isOther)} placeholder="Enter contact number" maxLength={10} readOnly={!isOther} />
                  {errors.contact_number && <p className="text-red-400 text-xs mt-1">{errors.contact_number}</p>}
                </div>
                <div>
                  <label className={label}>EMAIL ID</label>
                  <input type="email" name="email_id" value={party.email_id} onChange={e => setP('email_id', e.target.value)} className={readOnly(!isOther)} placeholder="Enter email address" readOnly={!isOther} />
                </div>
                <div>
                  <label className={label}>GST NUMBER</label>
                  <input type="text" name="gst_number" value={party.gst_number} onChange={e => setP('gst_number', e.target.value)} className={readOnly(!isOther)} placeholder="Enter GST number" readOnly={!isOther} />
                </div>
              </div>
              <div className={`grid grid-cols-1 ${isOther ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                {isOther && (
                  <div>
                    <label className={label}>MANUAL {B.partyLabel.toUpperCase()} NAME *</label>
                    <input type="text" name="party_name" value={party.name} onChange={e => setP('name', e.target.value)} className="input w-full" placeholder={`Enter ${B.party} name`} />
                    {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                  </div>
                )}
                <div>
                  <label className={label}>LINE 1</label>
                  <input type="text" name="address" value={party.address} onChange={e => setP('address', e.target.value)} className={readOnly(!isOther)} placeholder="Enter address line 1" readOnly={!isOther} />
                </div>
                <div>
                  <label className={label}>LINE 2</label>
                  <input type="text" name="address_2" value={party.address_2} onChange={e => setP('address_2', e.target.value)} className={readOnly(!isOther)} placeholder="Enter address line 2" readOnly={!isOther} />
                </div>
                <div>
                  <label className={label}>CITY</label>
                  <input type="text" name="city" value={party.city} onChange={e => setP('city', e.target.value)} className={readOnly(!isOther)} placeholder="Enter city" readOnly={!isOther} />
                </div>
                <div>
                  <label className={label}>STATE</label>
                  <SearchableSelect
                    options={states.map((s: any) => ({ id: s.id, name: s.name }))}
                    selectedValue={stateId}
                    // The state decides CGST+SGST vs IGST; the lines keep their GST % and the preview follows.
                    onSelectionChange={(sid) => {
                      const s: any = states.find((x: any) => x.id === sid)
                      setParty(prev => ({ ...prev, state: s?.name || '', state_code: s ? s.code : null }))
                    }}
                    placeholder="Select State"
                    disabled={!isOther}
                  />
                </div>
              </div>
            </div>

            {/* Transport (and, on a sale, the mechanic) */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className={`grid grid-cols-1 gap-4 ${isPurchase ? 'md:grid-cols-3' : 'md:grid-cols-5'}`}>
                {isPurchase ? (
                  <>
                    <div>
                      <label className={label}>TRANSPORT NAME</label>
                      <input type="text" name="transport_name" value={header.transport_name} onChange={e => setH('transport_name', e.target.value)} className="input w-full" placeholder="Enter transport name" />
                    </div>
                    <div>
                      <label className={label}>BOX QUANTITY</label>
                      <input type="text" name="vehicle_number" value={header.vehicle_number} onChange={e => setH('vehicle_number', e.target.value)} className="input w-full" placeholder="Enter box quantity" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={label}>VEHICLE NUMBER</label>
                      <input type="text" name="vehicle_number" value={header.vehicle_number} onChange={e => setH('vehicle_number', e.target.value)} className="input w-full" placeholder="Enter vehicle number" />
                    </div>
                    <div>
                      <label className={label}>TRANSPORT NAME</label>
                      <input type="text" name="transport_name" value={header.transport_name} onChange={e => setH('transport_name', e.target.value)} className="input w-full" placeholder="Enter transport name" />
                    </div>
                  </>
                )}
                <div>
                  <label className={label}>FREIGHT</label>
                  <input type="number" step="0.01" min="0" name="freight" value={header.freight} onChange={e => setH('freight', e.target.value)} className="input w-full" placeholder="0" onWheel={e => (e.target as HTMLInputElement).blur()} />
                </div>
                {!isPurchase && (
                  <>
                    <div>
                      <label className={label}>MECHANIC NAME</label>
                      <SearchableSelect
                        options={[{ id: '', name: 'Select Mechanic' }, ...mechanics.map((m: any) => ({ id: String(m.id), name: m.name }))]}
                        selectedValue={header.mechanic_id}
                        onSelectionChange={v => setH('mechanic_id', v || '')}
                        placeholder="Select Mechanic"
                      />
                    </div>
                    <div>
                      <label className={label}>COMMISSION</label>
                      <input type="number" step="0.01" min="0" name="commission" value={header.commission} onChange={e => setH('commission', e.target.value)} className="input w-full" placeholder="0" onWheel={e => (e.target as HTMLInputElement).blur()} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Toggles */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex flex-row-reverse mb-3 space-x-6">
                {!taxFree && (
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox" name="enable_tax" checked={enableTax} onChange={e => setEnableTax(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded" />
                    <span className="text-sm text-slate-300 pr-4">Enable Tax</span>
                  </label>
                )}
                {B.discount && (
                  <label className="flex items-center space-x-2 cursor-pointer pr-4">
                    <input type="checkbox" name="enable_discount" checked={enableDiscount} onChange={e => setEnableDiscount(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded" />
                    <span className="text-sm text-slate-300">Enable Discount (fixed amount per line)</span>
                  </label>
                )}
              </div>
            </div>

            {/* Lines */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <BillLines
                lines={lines}
                onChange={next => { setLines(next); if (errors.products) setErrors(prev => ({ ...prev, products: '' })) }}
                enableTax={enableTax && !taxFree}
                enableDiscount={B.discount && enableDiscount}
                filterOptions={filterOptions}
                disabled={partyId === ''}
                disabledHint={`Select ${B.party} first`}
                isEditMode={isEditMode}
                onEditingChange={setLineEditing}
                defaultRate={isPurchase ? purchaseRate : sellingRate}
                showStock={!isPurchase}
                noun={B.title === 'Invoice C' ? 'Invoice C' : B.title.toLowerCase()}
              />
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
            </div>

            {/* Descriptions / notes */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-2">
                  <label className={label}>DESCRIPTIONS</label>
                  <textarea name="descriptions" value={header.descriptions} onChange={e => setH('descriptions', e.target.value)} rows={3} className="input w-full" placeholder="Enter descriptions" />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>NOTES</label>
                  <textarea name="notes" value={header.notes} onChange={e => setH('notes', e.target.value)} rows={3} className="input w-full" placeholder="Enter notes" />
                </div>
              </div>
            </div>

            {/* Packing & forwarding: qty and total; the rate is derived */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={label}>P&F QTY</label>
                  <input
                    type="number" step="1" name="pf_qty" className="input w-full" placeholder="0" value={packing.qty}
                    onChange={e => {
                      const qty = e.target.value
                      setPacking(prev => {
                        const rate = parseNum(prev.rate)
                        return { ...prev, qty, total: rate > 0 && parseNum(qty) > 0 ? String(parseNum(qty) * rate) : prev.total }
                      })
                    }}
                  />
                </div>
                <div>
                  <label className={label}>P&F TOTAL</label>
                  <input
                    type="number" step="0.01" name="pf_total" className="input w-full" placeholder="0" value={packing.total}
                    onChange={e => {
                      const total = e.target.value
                      setPacking(prev => {
                        const qty = parseNum(prev.qty)
                        return { ...prev, total, rate: qty > 0 ? String(parseNum(total) / qty) : total }
                      })
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Totals & payment */}
            <div className="border-t border-slate-600 pt-4">
              <div className="space-y-4">
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${totalsShown.length}, minmax(0, 1fr))` }}>
                  {totalsShown.map(([name, value]) => (
                    <div key={name}>
                      <label className={label}>{name}</label>
                      <input type="text" value={money(value)} readOnly disabled className="input w-full bg-slate-700 cursor-not-allowed" />
                    </div>
                  ))}
                </div>
                {!taxFree && enableTax && supplyType === null && (
                  <p className="text-xs text-amber-400">The tax type cannot be worked out — check the {B.party}&apos;s state and the business GSTIN in Settings. Saving will be refused.</p>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={label}>PAYMENT STATUS *</label>
                    <SearchableSelect
                      options={statusOptions}
                      selectedValue={String(paymentStatus)}
                      onSelectionChange={v => { setPaymentStatus(parseInt(v || '0', 10)); setStatusTouched(true) }}
                      placeholder="Select Payment Status"
                    />
                  </div>
                  <div>
                    <label className={label}>PAYMENT MODE *</label>
                    <SearchableSelect
                      options={[{ id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
                      selectedValue={String(paymentMode)}
                      onSelectionChange={v => setPaymentMode(parseInt(v || '0', 10))}
                      placeholder="Select Payment Mode"
                    />
                  </div>
                  <div className="bg-slate-700 rounded p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-medium">GRAND TOTAL</span>
                      <div className="flex items-center space-x-2">
                        <Calculator className="w-4 h-4 text-slate-400" />
                        <span className="text-white font-semibold text-lg" data-testid="grand-total">₹{money(bill.grandTotal)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Items + P&F ₹{money(bill.packingTotal)} + freight ₹{money(bill.freight)}{taxFree ? '' : ` + tax ₹${money(bill.totalTax)}`}, rounded to the rupee</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-600 pt-2">
            <div className="p-6 flex justify-end space-x-3">
              <button type="button" onClick={() => router.push(B.listUrl)} className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors">Cancel</button>
              <button
                type="submit"
                disabled={save.isPending || fullyReturned || (isEditMode && !hasChanges)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={isEditMode && !hasChanges ? 'No changes to save' : ''}
              >
                {save.isPending ? (isEditMode ? 'Updating...' : 'Creating...') : `${isEditMode ? 'Update' : 'Create'} ${B.title}`}
              </button>
            </div>
          </div>
        </div>
      </form>

      <ConfirmationModal
        isOpen={confirmOpen}
        title={`${isEditMode ? 'Update' : 'Create'} ${B.title}?`}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this ${B.title === 'Invoice C' ? 'Invoice C' : B.title.toLowerCase()} for ₹${money(bill.grandTotal)}? ${isEditMode ? 'This will update the existing bill.' : 'This action cannot be undone.'}`}
        confirmText={`${isEditMode ? 'Update' : 'Create'} ${B.title}`}
        cancelText="Cancel"
        showLoading={save.isPending}
        loadingText={isEditMode ? 'Updating...' : 'Creating...'}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
