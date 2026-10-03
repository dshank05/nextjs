import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Loader, Calculator } from 'lucide-react';
import { SearchableSelect } from '../common/SearchableSelect';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';
import { BillLines, type BillLine } from './BillLines';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import { getLocalDateString } from '../../lib/date-utils';
import { getBusinessStateCode, resolveSupplyType } from '../../lib/gst';
import { computeBill, packingAmount, parseNum, money } from '../../lib/line-math';
import { useSaleBill, useCreateSaleBill, useUpdateSaleBill, useNextSaleNumber } from '../../hooks/useSaleBills';
import { useCustomers } from '../../hooks/useCustomers';
import { useStaff } from '../../hooks/useStaff';
import { useMechanics } from '../../hooks/useMechanics';
import { useFilterOptions } from '../../hooks/useProducts';
import { useStates } from '../../hooks/useStates';
import { useBusinessDetails } from '../../hooks/useBusinessDetails';
import type { Product } from '../../types/products';
import type { SaleKind } from '../../types/sales';

/**
 * Create and edit a sale (GST invoice) or an Invoice C (tax-free) - one form.
 *
 * The two pages were 2,694 and 2,368 lines with the line editor written out
 * several times each, ~40 console.logs, a loader that could wipe the lines
 * (SA-08), UTC dates (SA-24), the calendar year sent as `fy` (SA-04), and the
 * browser acting as the tax engine (SA-09). Now the browser sends what the user
 * decided - customer, header fields, and per line product / model / part / qty /
 * rate / discount / GST % (with `line_id` for a loaded line) - and the server
 * computes and stores every amount. The figures here are a preview made by the
 * same function (lib/line-math computeBill).
 */

const OTHER = '0';

const emptyCustomer = {
  customer_name: '', contact_number: '', email_id: '', gst_number: '',
  address: '', address_2: '', city: '', state: '', state_code: null as number | null
};

/** A unix timestamp as the <input type="date"> value, in the browser's own day (SA-24). */
const toDateInput = (ts: number | string | null | undefined): string => {
  if (ts === null || ts === undefined || ts === '') return '';
  const n = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts)) ? parseInt(String(ts), 10) : NaN;
  const d = Number.isFinite(n) ? new Date(n * 1000) : new Date(String(ts));
  return isNaN(d.getTime()) ? '' : getLocalDateString(d);
};

/** A new sale line starts at the product's selling price. */
const sellingRate = (p: Product) => p.latest_selling_price || p.selling_price || p.rate || 0;

const LABELS: Record<SaleKind, { title: string; number: string; list: string; view: string; resource: string }> = {
  sale: { title: 'Sale', number: 'INVOICE NUMBER', list: '/sale', view: '/sale/view', resource: 'sales' },
  salex: { title: 'Invoice C', number: 'INVOICE C NUMBER', list: '/salex', view: '/salex/view', resource: 'salex' }
};

export function SaleForm({ kind }: { kind: SaleKind }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const L = LABELS[kind];
  const taxFree = kind === 'salex';
  const createBill = useCreateSaleBill(kind);
  const updateBill = useUpdateSaleBill(kind);

  const editParam = router.isReady && typeof router.query.edit === 'string' ? router.query.edit : null;
  const editId = editParam ? parseInt(editParam, 10) : null;
  const isEditMode = editId !== null && !isNaN(editId);

  const { data: customers = [], refetch: refetchCustomers } = useCustomers();
  const { data: staff = [] } = useStaff();
  const { data: mechanics = [] } = useMechanics();
  const { data: filterOptions = { categories: [], subcategories: [], companies: [], models: [] } } = useFilterOptions();
  const { data: states = [] } = useStates();
  const { data: business } = useBusinessDetails();
  const { data: nextNumber, isLoading: numberLoading } = useNextSaleNumber(kind, router.isReady && !isEditMode);
  // Always the server's copy - never a SessionStorage snapshot.
  const { data: loaded, isLoading: loadingBill } = useSaleBill(kind, isEditMode ? String(editId) : undefined);

  // ---- form state
  const [header, setHeader] = useState({
    invoice_no: '', bill_reference: '', staff_id: '', mechanic_id: '', commission: '', date: '',
    transport_name: '', vehicle_number: '', freight: '', descriptions: '', notes: ''
  });
  const [customerId, setCustomerId] = useState('');
  const [customer, setCustomer] = useState(emptyCustomer);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [enableTax, setEnableTax] = useState(!taxFree);
  const [enableDiscount, setEnableDiscount] = useState(false);
  const [packing, setPacking] = useState({ qty: '', rate: '', total: '' });
  const [paymentStatus, setPaymentStatus] = useState(0);
  const [statusTouched, setStatusTouched] = useState(false);
  const [paymentMode, setPaymentMode] = useState(0);
  const [returnStatus, setReturnStatus] = useState<any>(null);
  const [lineEditing, setLineEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [populated, setPopulated] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const isOther = customerId === OTHER;
  const setH = (field: keyof typeof header, value: string) => {
    setHeader(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };
  const setC = (field: keyof typeof emptyCustomer, value: any) => setCustomer(prev => ({ ...prev, [field]: value }));

  // ---- create: today's (local) date and the next number
  useEffect(() => {
    if (router.isReady && !isEditMode) setHeader(prev => ({ ...prev, date: prev.date || getLocalDateString() }));
  }, [router.isReady, isEditMode]);
  useEffect(() => {
    if (!isEditMode && nextNumber) setHeader(prev => ({ ...prev, invoice_no: String(nextNumber) }));
  }, [nextNumber, isEditMode]);

  // ---- edit: fill the form ONCE from the loaded bill. Nothing here runs the
  // customer-pick handler, which clears lines (SA-08).
  useEffect(() => {
    if (!isEditMode || !loaded || populated) return;
    const b = loaded;
    setHeader({
      invoice_no: String(b.invoice_no ?? ''),
      bill_reference: b.bill_reference || '',
      staff_id: b.staff_id ? String(b.staff_id) : '',
      mechanic_id: b.mechanic_id ? String(b.mechanic_id) : '',
      commission: b.commission ? String(b.commission) : '',
      date: toDateInput(b.invoice_date),
      transport_name: b.transport_name || b.transportDetails?.trans_mode || '',
      vehicle_number: b.vehicle_number || b.transportDetails?.vehicle_no || '',
      freight: b.freight ? String(b.freight) : '',
      descriptions: b.descriptions || '',
      notes: b.notes || ''
    });
    setCustomerId(String(b.select_customer ?? b.customer_id ?? 0));
    setCustomer({
      customer_name: b.customer_name || '',
      contact_number: b.contact_number || '',
      email_id: b.email_id || '',
      gst_number: b.gst_number || '',
      address: b.address || '',
      address_2: b.address_2 || '',
      city: b.city || '',
      state: b.state || '',
      state_code: b.state_code ?? null
    });
    const loadedLines: BillLine[] = (b.items || []).map((item: any) => ({
      key: `line-${item.line_id ?? item.id}`,
      line_id: item.line_id ?? item.id,
      product_id: item.product_id,
      product_name: item.product_name || item.name_of_product,
      display_name: item.display_name,
      car_model: '',
      model_id: item.model_id ?? null,
      company_id: item.company_id ?? null,
      part: item.part || '',
      qty: Number(item.qty) || 0,
      rate: Number(item.rate) || 0,
      discount: Number(item.discount) || 0,
      gst_percentage: Number(item.gst_percentage) || 0,
      original_qty: item.original_qty,
      returned_qty: Number(item.returned_qty) || 0,
      is_fully_returned: !!item.is_fully_returned
    }));
    setLines(loadedLines);
    // A taxed bill opens with tax on; a discounted one with discount on.
    if (!taxFree) setEnableTax(loadedLines.some(l => l.gst_percentage > 0) || (b.total_tax || 0) > 0);
    setEnableDiscount(loadedLines.some(l => l.discount > 0) || (b.discount || 0) > 0);
    const pfQty = Number(b.packing_forwarding_qty) || 0;
    const pfTotal = Number(b.packing_forwarding_total) || 0;
    const pfRate = Number(b.packing_forwarding_rate) || (pfQty > 0 ? pfTotal / pfQty : 0);
    setPacking({ qty: pfQty ? String(pfQty) : '', rate: pfRate ? String(pfRate) : '', total: pfTotal ? String(pfTotal) : '' });
    setPaymentStatus(b.payment_status ?? 0);
    setPaymentMode(b.payment_mode ?? 0);
    setReturnStatus(b.return_status || null);
    setPopulated(true);
  }, [isEditMode, loaded, populated, taxFree]);

  // ---- customers created in another tab
  useEffect(() => subscribeBroadcast((message) => {
    if (message.type === 'created' && message.resource === 'customers') refetchCustomers();
  }), [refetchCustomers]);

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    setErrors(prev => ({ ...prev, customer: '', customer_name: '', contact_number: '' }));
    if (id === OTHER || id === '') {
      setCustomer(emptyCustomer);
      return;
    }
    const c: any = customers.find((x: any) => String(x.id) === id);
    setCustomer(c ? {
      customer_name: c.billing_name || '',
      contact_number: c.contact_no || '',
      email_id: c.email || '',
      gst_number: c.billing_gstin || '',
      address: c.billing_address || '',
      address_2: c.billing_address_2 || '',
      city: c.billing_city || '',
      state: c.billing_state || '',
      state_code: c.billing_state_code ?? null
    } : emptyCustomer);
  };

  // ---- preview of the server's arithmetic
  const businessState = getBusinessStateCode(business?.gstin);
  const supplyType = taxFree ? 'INTRA_STATE' : resolveSupplyType(customer.state_code, businessState, customer.state_code != null);
  const gstSent = (l: BillLine) => (enableTax && !taxFree ? l.gst_percentage : 0);
  const discountSent = (l: BillLine) => (enableDiscount ? l.discount : 0);
  const packingOut = useMemo(() => packingAmount(packing.qty, packing.rate, packing.total), [packing]);

  const bill = useMemo(() => computeBill(
    lines.map(l => ({ qty: l.qty, rate: l.rate, gst_percentage: gstSent(l), discount: discountSent(l) })),
    { supplyType: supplyType as any, taxFree, packingTotal: packingOut.total, freight: parseNum(header.freight) }
  ), [lines, enableTax, enableDiscount, supplyType, packingOut, header.freight, taxFree]);

  // ---- what gets sent: decisions only, never totals
  const buildPayload = () => {
    const payload: any = {
      select_customer: customerId === '' ? null : parseInt(customerId, 10),
      ...customer,
      date: header.date,
      bill_reference: header.bill_reference,
      staff_id: header.staff_id ? parseInt(header.staff_id, 10) : null,
      mechanic_id: header.mechanic_id ? parseInt(header.mechanic_id, 10) : null,
      commission: parseNum(header.commission),
      transport_name: header.transport_name,
      vehicle_number: header.vehicle_number,
      transport_cost: parseNum(header.freight),
      descriptions: header.descriptions,
      notes: header.notes,
      packing_forwarding_qty: packingOut.qty,
      packing_forwarding_rate: packingOut.rate,
      payment_mode: paymentMode,
      invoiceItems: lines.map(l => ({
        ...(l.line_id ? { line_id: l.line_id } : {}),
        product_id: l.product_id,
        model_id: l.model_id,
        company_id: l.company_id,
        part: l.part,
        qty: l.qty,
        rate: l.rate,
        discount: discountSent(l),
        // Tax off means the bill carries no GST - what the user sees is what is saved.
        gst_percentage: gstSent(l)
      }))
    };
    // A loaded status is the server's to keep; only a status the user picked is sent.
    if (!isEditMode || statusTouched) payload.payment_status = paymentStatus;
    // The customer cannot change on a saved bill; the server refuses it.
    if (isEditMode) delete payload.select_customer;
    return payload;
  };

  useEffect(() => {
    if (populated && snapshot === null) setSnapshot(JSON.stringify(buildPayload()));
  });
  const hasChanges = !isEditMode || snapshot === null || JSON.stringify(buildPayload()) !== snapshot;

  // ---- submit
  const validate = () => {
    const e: Record<string, string> = {};
    if (lineEditing) e.products = 'Save or cancel the line being edited first';
    if (customerId === '') e.customer = 'Please select a customer';
    if (isOther && !customer.customer_name.trim()) e.customer_name = 'Customer name is required';
    if (isOther && !customer.contact_number.trim()) e.contact_number = 'Phone number is required';
    if (lines.length === 0) e.products = e.products || 'At least one product is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    setConfirmOpen(false);
    const payload = buildPayload();
    if (isEditMode && editId !== null) {
      updateBill.mutate({ id: editId, payload }, {
        onSuccess: () => {
          broadcast({ type: 'updated', resource: L.resource as any, data: { id: editId } });
          showSnackbar('success', `${L.title} updated successfully!`);
          router.push(`${L.view}/${editId}`);
        },
        onError: (error: any) => showSnackbar('error', error.message || `Failed to update ${L.title}`)
      });
    } else {
      createBill.mutate(payload, {
        onSuccess: (data: any) => {
          const id = data?.data?.id ?? data?.sale?.id;
          broadcast({ type: 'created', resource: L.resource as any, data: { id } });
          showSnackbar('success', `${L.title} created successfully!`);
          router.push(id ? `${L.view}/${id}` : L.list);
        },
        onError: (error: any) => showSnackbar('error', error.message || `Failed to create ${L.title}`)
      });
    }
  };

  const saving = createBill.isPending || updateBill.isPending;
  const fullyReturned = !!returnStatus?.is_fully_returned;
  const readOnly = (ro: boolean) => `input w-full ${ro ? 'bg-slate-700 cursor-not-allowed' : ''}`;
  const label = 'block text-sm font-medium text-slate-300 mb-2';
  const editable = isOther;

  const statusOptions = [
    { id: '0', name: 'Unpaid' },
    { id: '1', name: 'Paid' },
    // Derived by the server from allocations; shown, not offered.
    ...(paymentStatus === 2 ? [{ id: '2', name: 'Partially Paid' }] : [])
  ];
  const stateId = states.find((s: any) => customer.state_code != null && s.code === customer.state_code)?.id
    ?? states.find((s: any) => s.name === customer.state)?.id ?? '';

  return (
    <div className="space-y-3">
      {isEditMode && loadingBill && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center !mt-0">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-slate-200 font-medium">Loading {L.title}</p>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (validate()) setConfirmOpen(true); }} className="space-y-3">
        {isEditMode && returnStatus?.has_returns && (
          <div className={`card ${fullyReturned ? 'bg-red-900/20 border-red-700' : 'bg-orange-900/20 border-orange-700'}`}>
            <div className="p-4 flex items-start space-x-3">
              <span className="text-3xl">{fullyReturned ? '🔒' : '⚠️'}</span>
              <div>
                <h3 className={`text-lg font-bold ${fullyReturned ? 'text-red-300' : 'text-orange-300'}`}>
                  {fullyReturned ? `${L.title} Fully Returned` : `${L.title} Partially Returned`}
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
            {/* Invoice */}
            <div className="mb-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={label}>{L.number}</label>
                  {numberLoading && !isEditMode ? (
                    <div className="input w-full flex items-center justify-center bg-slate-700 border border-slate-600 rounded">
                      <Loader className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                      <span className="text-sm text-slate-400">Loading...</span>
                    </div>
                  ) : (
                    // Allocated by the server's counter; shown, not chosen.
                    <input type="text" value={header.invoice_no} readOnly className={readOnly(true)} title={isEditMode ? '' : 'The next number in this financial year. The server assigns it on save.'} />
                  )}
                </div>
                <div>
                  <label className={label}>BILL REFERENCE</label>
                  <input type="text" value={header.bill_reference} onChange={(e) => setH('bill_reference', e.target.value)} className="input w-full" placeholder="Enter bill reference" />
                </div>
                <div>
                  <label className={label}>STAFF MEMBER</label>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Staff' }, ...staff.map((m: any) => ({ id: String(m.id), name: m.phone ? `${m.name} - ${m.phone}` : m.name }))]}
                    selectedValue={header.staff_id}
                    onSelectionChange={(v) => setH('staff_id', v || '')}
                    placeholder="Select Staff"
                  />
                </div>
                <div>
                  <label className={label}>DATE</label>
                  <input type="date" value={header.date} onChange={(e) => setH('date', e.target.value)} className="input w-full" />
                </div>
              </div>
            </div>

            {/* Customer */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">CUSTOMER NAME *</label>
                    {!isEditMode && (
                      <a href={`/customers/create?from=${kind}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors">+ Add New Customer</a>
                    )}
                  </div>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Customer' }, { id: OTHER, name: 'Other' }, ...customers.map((c: any) => ({ id: String(c.id), name: c.billing_name }))]}
                    selectedValue={customerId}
                    onSelectionChange={(v) => selectCustomer(v || '')}
                    placeholder="Select Customer"
                    // The server refuses a customer change on a saved bill (SA-11).
                    disabled={isEditMode}
                  />
                  {errors.customer && <p className="text-red-400 text-xs mt-1">{errors.customer}</p>}
                </div>
                <div>
                  <label className={label}>CONTACT NUMBER{isOther ? ' *' : ''}</label>
                  <input type="text" value={customer.contact_number} onChange={(e) => setC('contact_number', e.target.value)} className={readOnly(!editable)} placeholder="Enter contact number" maxLength={10} readOnly={!editable} />
                  {errors.contact_number && <p className="text-red-400 text-xs mt-1">{errors.contact_number}</p>}
                </div>
                <div>
                  <label className={label}>EMAIL ID</label>
                  <input type="email" value={customer.email_id} onChange={(e) => setC('email_id', e.target.value)} className={readOnly(!editable)} placeholder="Enter email address" readOnly={!editable} />
                </div>
                <div>
                  <label className={label}>GST NUMBER</label>
                  <input type="text" value={customer.gst_number} onChange={(e) => setC('gst_number', e.target.value)} className={readOnly(!editable)} placeholder="Enter GST number" readOnly={!editable} />
                </div>
              </div>
              <div className={`grid grid-cols-1 ${isOther ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                {isOther && (
                  <div>
                    <label className={label}>MANUAL CUSTOMER NAME *</label>
                    <input type="text" value={customer.customer_name} onChange={(e) => setC('customer_name', e.target.value)} className="input w-full" placeholder="Enter customer name" />
                    {errors.customer_name && <p className="text-red-400 text-xs mt-1">{errors.customer_name}</p>}
                  </div>
                )}
                <div>
                  <label className={label}>LINE 1</label>
                  <input type="text" value={customer.address} onChange={(e) => setC('address', e.target.value)} className={readOnly(!editable)} placeholder="Enter address line 1" readOnly={!editable} />
                </div>
                <div>
                  <label className={label}>LINE 2</label>
                  <input type="text" value={customer.address_2} onChange={(e) => setC('address_2', e.target.value)} className={readOnly(!editable)} placeholder="Enter address line 2" readOnly={!editable} />
                </div>
                <div>
                  <label className={label}>CITY</label>
                  <input type="text" value={customer.city} onChange={(e) => setC('city', e.target.value)} className={readOnly(!editable)} placeholder="Enter city" readOnly={!editable} />
                </div>
                <div>
                  <label className={label}>STATE</label>
                  <SearchableSelect
                    options={states.map((s: any) => ({ id: s.id, name: s.name }))}
                    selectedValue={stateId}
                    // The state decides CGST+SGST vs IGST; the lines keep their GST % and the
                    // preview follows. It used to clear every line (SA-24 audit, UX).
                    onSelectionChange={(id) => {
                      const s: any = states.find((x: any) => x.id === id);
                      setCustomer(prev => ({ ...prev, state: s?.name || '', state_code: s ? s.code : null }));
                    }}
                    placeholder="Select State"
                    disabled={!editable}
                  />
                </div>
              </div>
            </div>

            {/* Transport and service */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className={label}>VEHICLE NUMBER</label>
                  <input type="text" value={header.vehicle_number} onChange={(e) => setH('vehicle_number', e.target.value)} className="input w-full" placeholder="Enter vehicle number" />
                </div>
                <div>
                  <label className={label}>TRANSPORT NAME</label>
                  <input type="text" value={header.transport_name} onChange={(e) => setH('transport_name', e.target.value)} className="input w-full" placeholder="Enter transport name" />
                </div>
                <div>
                  <label className={label}>FREIGHT</label>
                  <input type="number" step="0.01" min="0" value={header.freight} onChange={(e) => setH('freight', e.target.value)} className="input w-full" placeholder="0" onWheel={(e) => (e.target as HTMLInputElement).blur()} />
                </div>
                <div>
                  <label className={label}>MECHANIC NAME</label>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Mechanic' }, ...mechanics.map((m: any) => ({ id: String(m.id), name: m.name }))]}
                    selectedValue={header.mechanic_id}
                    onSelectionChange={(v) => setH('mechanic_id', v || '')}
                    placeholder="Select Mechanic"
                  />
                </div>
                <div>
                  <label className={label}>COMMISSION</label>
                  <input type="number" step="0.01" min="0" value={header.commission} onChange={(e) => setH('commission', e.target.value)} className="input w-full" placeholder="0" onWheel={(e) => (e.target as HTMLInputElement).blur()} />
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex flex-row-reverse mb-3 space-x-6">
                {!taxFree && (
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox" checked={enableTax} onChange={(e) => setEnableTax(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded" />
                    <span className="text-sm text-slate-300 pr-4">Enable Tax</span>
                  </label>
                )}
                <label className="flex items-center space-x-2 cursor-pointer pr-4">
                  <input type="checkbox" checked={enableDiscount} onChange={(e) => setEnableDiscount(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded" />
                  <span className="text-sm text-slate-300">Enable Discount (fixed amount per line)</span>
                </label>
              </div>
            </div>

            {/* Lines */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <BillLines
                lines={lines}
                onChange={(next) => { setLines(next); if (errors.products) setErrors(prev => ({ ...prev, products: '' })); }}
                enableTax={enableTax && !taxFree}
                enableDiscount={enableDiscount}
                filterOptions={filterOptions}
                disabled={customerId === ''}
                disabledHint="Select customer first"
                isEditMode={isEditMode}
                onEditingChange={setLineEditing}
                defaultRate={sellingRate}
                showStock
                noun={L.title.toLowerCase()}
              />
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
            </div>

            {/* Descriptions / notes */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-2">
                  <label className={label}>DESCRIPTIONS</label>
                  <textarea value={header.descriptions} onChange={(e) => setH('descriptions', e.target.value)} rows={3} className="input w-full" placeholder="Enter descriptions" />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>NOTES</label>
                  <textarea value={header.notes} onChange={(e) => setH('notes', e.target.value)} rows={3} className="input w-full" placeholder="Enter notes" />
                </div>
              </div>
            </div>

            {/* Packing & forwarding: qty and total; the rate is derived */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={label}>P&F QTY</label>
                  <input
                    type="number" step="1" className="input w-full" placeholder="0" value={packing.qty}
                    onChange={(e) => {
                      const qty = e.target.value;
                      setPacking(prev => {
                        const rate = parseNum(prev.rate);
                        return { ...prev, qty, total: rate > 0 && parseNum(qty) > 0 ? String(parseNum(qty) * rate) : prev.total };
                      });
                    }}
                  />
                </div>
                <div>
                  <label className={label}>P&F TOTAL</label>
                  <input
                    type="number" step="0.01" className="input w-full" placeholder="0" value={packing.total}
                    onChange={(e) => {
                      const total = e.target.value;
                      setPacking(prev => {
                        const qty = parseNum(prev.qty);
                        return { ...prev, total, rate: qty > 0 ? String(parseNum(total) / qty) : total };
                      });
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Totals & payment */}
            <div className="border-t border-slate-600 pt-4">
              <div className="space-y-4">
                <div className={`grid gap-4 ${taxFree ? 'grid-cols-3' : 'grid-cols-6'}`}>
                  {[
                    ['ITEMS (AFTER DISCOUNT)', bill.itemsTotal],
                    ['DISCOUNT', bill.discountTotal],
                    ...(taxFree ? [] : [['CGST', bill.totalCgst], ['SGST', bill.totalSgst], ['IGST', bill.totalIgst]]),
                    ['TOTAL TAX', bill.totalTax]
                  ].filter(([name]) => !(taxFree && name === 'TOTAL TAX')).map(([name, value]) => (
                    <div key={name as string}>
                      <label className={label}>{name}</label>
                      <input type="text" value={money(value as number)} readOnly disabled className="input w-full bg-slate-700 cursor-not-allowed" />
                    </div>
                  ))}
                </div>
                {!taxFree && enableTax && supplyType === null && (
                  <p className="text-xs text-amber-400">The tax type cannot be worked out — check the customer&apos;s state and the business GSTIN in Settings. Saving will be refused.</p>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={label}>PAYMENT STATUS *</label>
                    <SearchableSelect
                      options={statusOptions}
                      selectedValue={String(paymentStatus)}
                      onSelectionChange={(v) => { setPaymentStatus(parseInt(v || '0', 10)); setStatusTouched(true); }}
                      placeholder="Select Payment Status"
                    />
                  </div>
                  <div>
                    <label className={label}>PAYMENT MODE *</label>
                    <SearchableSelect
                      options={[{ id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
                      selectedValue={String(paymentMode)}
                      onSelectionChange={(v) => setPaymentMode(parseInt(v || '0', 10))}
                      placeholder="Select Payment Mode"
                    />
                  </div>
                  <div className="bg-slate-700 rounded p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-medium">GRAND TOTAL</span>
                      <div className="flex items-center space-x-2">
                        <Calculator className="w-4 h-4 text-slate-400" />
                        <span className="text-white font-semibold text-lg">₹{money(bill.grandTotal)}</span>
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
              <button type="button" onClick={() => router.push(L.list)} className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || fullyReturned || (isEditMode && !hasChanges)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={isEditMode && !hasChanges ? 'No changes to save' : ''}
              >
                {saving ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? `Update ${L.title}` : `Create ${L.title}`)}
              </button>
            </div>
          </div>
        </div>
      </form>

      <ConfirmationModal
        isOpen={confirmOpen}
        title={isEditMode ? `Update ${L.title}?` : `Create ${L.title}?`}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this ${L.title.toLowerCase()} for ₹${money(bill.grandTotal)}? ${isEditMode ? 'This will update the existing bill.' : 'This action cannot be undone.'}`}
        confirmText={isEditMode ? `Update ${L.title}` : `Create ${L.title}`}
        cancelText="Cancel"
        showLoading={saving}
        loadingText={isEditMode ? 'Updating...' : 'Creating...'}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
