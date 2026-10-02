import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Loader, Calculator } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { PurchaseLines, type PurchaseLine } from '../../components/purchases/PurchaseLines';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import { getLocalDateString } from '../../lib/date-utils';
import { getBusinessStateCode, resolveSupplyType, splitGst } from '../../lib/gst';
import { lineAmounts, parseNum, money } from '../../lib/line-math';
import { useCreatePurchase, useUpdatePurchase, usePurchase, useLastInvoiceNumber } from '../../hooks/usePurchases';
import { useVendors } from '../../hooks/useVendors';
import { useStaff } from '../../hooks/useStaff';
import { useFilterOptions } from '../../hooks/useProducts';
import { useStates } from '../../hooks/useStates';
import { useBusinessDetails } from '../../hooks/useBusinessDetails';
import type { PurchaseReturnStatus } from '../../types/purchases';

/**
 * Create and edit a purchase.
 *
 * The browser sends what the user decided - header fields, the vendor snapshot,
 * and per line product / model / part / qty / rate / GST % (with `line_id` for
 * a loaded line). Every amount is computed and stored by the server; the
 * figures here are a preview (lib/line-math.ts). Rebuilt in Block A of
 * PURCHASE_PASS2_AUDIT.md: PU-05..PU-13, PU-32, PU-35.
 */

const OTHER_VENDOR = '0';

const emptyVendor = {
  vendor_name: '', contact_number: '', email_id: '', address: '', address_2: '',
  city: '', state: '', state_code: null as number | null, gst_number: '', pin_code: ''
};

/** A unix timestamp as the <input type="date"> value, in the browser's day (PU-36). */
const toDateInput = (ts: number | string | null | undefined): string => {
  if (ts === null || ts === undefined || ts === '') return '';
  const n = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts)) ? parseInt(String(ts), 10) : NaN;
  const d = Number.isFinite(n) ? new Date(n * 1000) : new Date(String(ts));
  return isNaN(d.getTime()) ? '' : getLocalDateString(d);
};

export default function PurchaseCreate() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const createPurchase = useCreatePurchase();
  const updatePurchase = useUpdatePurchase();

  const editParam = router.isReady && typeof router.query.edit === 'string' ? router.query.edit : null;
  const editId = editParam ? parseInt(editParam, 10) : null;
  const isEditMode = editId !== null && !isNaN(editId);

  const { data: vendors = [], refetch: refetchVendors } = useVendors();
  const { data: staff = [] } = useStaff();
  const { data: filterOptions = { categories: [], subcategories: [], companies: [], models: [] } } = useFilterOptions();
  const { data: states = [] } = useStates();
  const { data: business } = useBusinessDetails();
  const { data: nextInvoiceNumber, isLoading: invoiceNumberLoading } = useLastInvoiceNumber(router.isReady && !isEditMode);
  // Always the server's copy - never a SessionStorage snapshot (PU-32).
  const { data: loaded, isLoading: loadingBill } = usePurchase(isEditMode ? String(editId) : undefined);

  // ---- form state
  const [header, setHeader] = useState({
    invoice_number: '', bill_reference: '', bill_reference_date: '', staff_id: '', date: '',
    transport_name: '', vehicle_number: '', transport_cost: '', descriptions: '', notes: ''
  });
  const [vendorId, setVendorId] = useState('');
  const [vendor, setVendor] = useState(emptyVendor);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [enableTax, setEnableTax] = useState(false);
  const [packing, setPacking] = useState({ qty: '', rate: '', total: '' });
  const [paymentStatus, setPaymentStatus] = useState(0);
  const [statusTouched, setStatusTouched] = useState(false);
  const [paymentMode, setPaymentMode] = useState(0);
  const [returnStatus, setReturnStatus] = useState<PurchaseReturnStatus | null>(null);
  const [lineEditing, setLineEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [populated, setPopulated] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const isOtherVendor = vendorId === OTHER_VENDOR;
  const setH = (field: keyof typeof header, value: string) => {
    setHeader(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };
  const setV = (field: keyof typeof emptyVendor, value: any) => setVendor(prev => ({ ...prev, [field]: value }));

  // ---- create: today's date and the next number
  useEffect(() => {
    if (router.isReady && !isEditMode) setHeader(prev => ({ ...prev, date: prev.date || getLocalDateString() }));
  }, [router.isReady, isEditMode]);
  useEffect(() => {
    if (!isEditMode && nextInvoiceNumber) setHeader(prev => ({ ...prev, invoice_number: String(nextInvoiceNumber) }));
  }, [nextInvoiceNumber, isEditMode]);

  // ---- edit: fill the form once from the loaded bill
  useEffect(() => {
    if (!isEditMode || !loaded || populated) return;
    const p = loaded.purchase || loaded;
    const v = p.bill_to || {};
    const master = p.vendor || {};
    setHeader({
      invoice_number: p.invoice_number || String(p.invoice_no ?? ''),
      bill_reference: p.bill_reference || '',
      bill_reference_date: p.bill_reference_date || '',
      staff_id: p.staff_id ? String(p.staff_id) : '',
      date: toDateInput(p.date ?? p.invoice_date),
      transport_name: p.transport_name || '',
      vehicle_number: p.vehicle_number || '',
      transport_cost: p.transport_cost ? String(p.transport_cost) : '',
      descriptions: p.descriptions || '',
      notes: p.notes || ''
    });
    setVendorId(p.vendor_id !== null && p.vendor_id !== undefined ? String(p.vendor_id) : '');
    setVendor({
      vendor_name: v.vendor_name ?? master.vendor_name ?? '',
      contact_number: v.contact_no ?? master.contact_no ?? '',
      email_id: v.email ?? master.email ?? '',
      address: v.address ?? master.address ?? '',
      address_2: v.address2 ?? master.address_2 ?? '',
      city: v.city ?? master.city ?? '',
      state: v.state ?? master.state ?? '',
      state_code: v.state_code ?? master.state_code ?? null,
      gst_number: v.gstin ?? master.tax_id ?? '',
      pin_code: v.pin_code ?? ''
    });
    const loadedLines: PurchaseLine[] = (p.items || []).map((item: any) => ({
      key: `line-${item.line_id ?? item.id}`,
      line_id: item.line_id ?? item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      display_name: item.display_name,
      car_model: item.car_model || '',
      model_id: item.model_id ?? null,
      company_id: item.company_id ?? null,
      part: item.part || '',
      qty: Number(item.qty) || 0,
      rate: Number(item.rate) || 0,
      gst_percentage: Number(item.gst_percentage) || 0,
      original_qty: item.original_qty,
      returned_qty: Number(item.returned_qty) || 0,
      is_fully_returned: !!item.is_fully_returned
    }));
    setLines(loadedLines);
    // A taxed bill opens with tax on (PU-06).
    setEnableTax(loadedLines.some(l => l.gst_percentage > 0) || (p.total_tax || 0) > 0);
    const pfQty = Number(p.packing_forwarding_qty) || 0;
    const pfTotal = Number(p.packing_forwarding_total) || 0;
    // Older bills stored a total with no rate; derive it so a save keeps the total.
    const pfRate = Number(p.packing_forwarding_rate) || (pfQty > 0 ? pfTotal / pfQty : 0);
    setPacking({ qty: pfQty ? String(pfQty) : '', rate: pfRate ? String(pfRate) : '', total: pfTotal ? String(pfTotal) : '' });
    setPaymentStatus(p.payment_status ?? 0);
    setPaymentMode(p.payment_mode ?? 0);
    setReturnStatus(p.return_status || null);
    setPopulated(true);
  }, [isEditMode, loaded, populated]);

  // ---- vendors created in another tab
  useEffect(() => subscribeBroadcast((message) => {
    if (message.type === 'created' && message.resource === 'vendors') refetchVendors();
  }), [refetchVendors]);

  const selectVendor = (id: string) => {
    setVendorId(id);
    setErrors(prev => ({ ...prev, vendor_name: '' }));
    if (id === OTHER_VENDOR) {
      setVendor(emptyVendor);
      return;
    }
    const v = vendors.find(x => x.id === id);
    setVendor(v ? {
      vendor_name: v.vendor_name, contact_number: v.contact_no || '', email_id: v.email || '',
      address: v.address || '', address_2: v.address_2 || '', city: v.city || '', state: v.state || '',
      state_code: v.state_code ?? null, gst_number: v.tax_id || '', pin_code: ''
    } : emptyVendor);
  };

  // ---- preview of the server's arithmetic
  const businessState = getBusinessStateCode(business?.gstin);
  const supplyType = resolveSupplyType(vendor.state_code, businessState, vendor.state_code != null);
  const effectiveGst = (l: PurchaseLine) => (enableTax ? l.gst_percentage : 0);

  const packingOut = useMemo(() => {
    const qty = parseNum(packing.qty);
    const total = parseNum(packing.total);
    // A total with no quantity is one unit at that price - it was saved as 0.
    if (qty <= 0) return total > 0 ? { qty: 1, rate: total, total } : { qty: 0, rate: 0, total: 0 };
    const rate = parseNum(packing.rate);
    return { qty, rate, total: qty * rate };
  }, [packing]);

  const summary = useMemo(() => {
    let taxable = 0, tax = 0;
    for (const l of lines) {
      const a = lineAmounts(l.qty, l.rate, effectiveGst(l));
      taxable += a.taxable;
      tax += a.tax;
    }
    const split = supplyType ? splitGst(tax, supplyType) : { cgst: 0, sgst: 0, igst: 0 };
    return { taxable, tax, ...split, grand: taxable + packingOut.total + tax };
  }, [lines, enableTax, supplyType, packingOut]);

  // ---- what gets sent
  const buildPayload = () => {
    const payload: any = {
      bill_reference: header.bill_reference,
      bill_reference_date: header.bill_reference_date,
      staff_id: header.staff_id ? parseInt(header.staff_id, 10) : null,
      date: header.date,
      vendor_id: vendorId === '' ? null : parseInt(vendorId, 10),
      vendor_name: vendor.vendor_name,
      contact_number: vendor.contact_number,
      email_id: vendor.email_id,
      address: vendor.address,
      address_2: vendor.address_2,
      city: vendor.city,
      state: vendor.state,
      state_code: vendor.state_code,
      gst_number: vendor.gst_number,
      pin_code: vendor.pin_code,
      transport_name: header.transport_name,
      vehicle_number: header.vehicle_number,
      transport_cost: parseNum(header.transport_cost),
      descriptions: header.descriptions,
      notes: header.notes,
      packing_forwarding_qty: packingOut.qty,
      packing_forwarding_rate: packingOut.rate,
      payment_mode: paymentMode,
      items: lines.map(l => ({
        ...(l.line_id ? { line_id: l.line_id } : {}),
        product_id: l.product_id,
        model_id: l.model_id,
        company_id: l.company_id,
        car_model: l.car_model,
        part: l.part,
        qty: l.qty,
        rate: l.rate,
        // Tax off means the bill carries no GST - what the user sees is what is saved.
        gst_percentage: effectiveGst(l)
      }))
    };
    // A loaded status is the server's to keep (PU-35); only a status the user picked is sent.
    if (!isEditMode || statusTouched) payload.payment_status = paymentStatus;
    if (!isEditMode) payload.invoice_number = header.invoice_number;
    return payload;
  };

  // Snapshot of the loaded bill, taken once the form has rendered it, for "no changes".
  useEffect(() => {
    if (populated && snapshot === null) setSnapshot(JSON.stringify(buildPayload()));
  });
  const hasChanges = !isEditMode || snapshot === null || JSON.stringify(buildPayload()) !== snapshot;

  // ---- submit
  const validate = () => {
    const e: Record<string, string> = {};
    if (lineEditing) e.products = 'Save or cancel the line being edited first';
    if (!isEditMode && !header.invoice_number.trim()) e.invoice_number = 'Invoice number is required';
    if (vendorId === '') e.vendor_name = 'Please select a vendor';
    if (isOtherVendor && !vendor.vendor_name.trim()) e.vendor_name = 'Vendor name is required';
    if (isOtherVendor && !vendor.contact_number.trim()) e.contact_number = 'Phone number is required';
    if (lines.length === 0) e.products = e.products || 'At least one product is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    setConfirmOpen(false);
    const payload = buildPayload();
    if (isEditMode && editId !== null) {
      updatePurchase.mutate({ id: editId, payload }, {
        onSuccess: () => {
          broadcast({ type: 'updated', resource: 'purchases', data: { id: editId } });
          showSnackbar('success', 'Purchase updated successfully!');
          router.push(`/purchases/view/${editId}`);
        },
        onError: (error: any) => showSnackbar('error', error.message || 'Failed to update purchase')
      });
    } else {
      createPurchase.mutate(payload, {
        onSuccess: (data: any) => {
          const id = data?.purchase?.id ?? data?.id;
          broadcast({ type: 'created', resource: 'purchases', data: { id } });
          showSnackbar('success', 'Purchase created successfully!');
          router.push(id ? `/purchases/view/${id}` : '/purchases');
        },
        onError: (error: any) => showSnackbar('error', error.message || 'Failed to create purchase')
      });
    }
  };

  const saving = createPurchase.isPending || updatePurchase.isPending;
  const fullyReturned = !!returnStatus?.is_fully_returned;
  const readOnly = (field: boolean) => `input w-full ${field ? 'bg-slate-700 cursor-not-allowed' : ''}`;
  const label = 'block text-sm font-medium text-slate-300 mb-2';

  const statusOptions = [
    { id: '0', name: 'Unpaid' },
    { id: '1', name: 'Paid' },
    // Derived by the server from allocations; shown, not offered (PU-11).
    ...(paymentStatus === 2 ? [{ id: '2', name: 'Partially Paid' }] : [])
  ];

  return (
    <div className="space-y-3">
      {isEditMode && loadingBill && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center !mt-0">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-slate-200 font-medium">Loading Purchase Data</p>
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
                  {fullyReturned ? 'Purchase Fully Returned' : 'Purchase Partially Returned'}
                </h3>
                <p className="text-slate-300 mt-1">
                  {returnStatus.fully_returned_items} of {returnStatus.total_items} items have been returned.
                  {fullyReturned ? ' This purchase cannot be edited.' : ' Lines with returns cannot be removed or reduced below the returned quantity.'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="p-3">
            {/* Invoice */}
            <div className="mb-5">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className={label}>INVOICE NUMBER *</label>
                  {invoiceNumberLoading && !isEditMode ? (
                    <div className="input w-full flex items-center justify-center bg-slate-700 border border-slate-600 rounded">
                      <Loader className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                      <span className="text-sm text-slate-400">Loading...</span>
                    </div>
                  ) : (
                    <input type="text" value={header.invoice_number} onChange={(e) => setH('invoice_number', e.target.value)} className={readOnly(isEditMode)} placeholder="Enter invoice number" readOnly={isEditMode} />
                  )}
                  {errors.invoice_number && <p className="text-red-400 text-xs mt-1">{errors.invoice_number}</p>}
                </div>
                <div>
                  <label className={label}>BILL REFERENCE</label>
                  <input type="text" value={header.bill_reference} onChange={(e) => setH('bill_reference', e.target.value)} className="input w-full" placeholder="Enter bill reference" />
                </div>
                <div>
                  <label className={label}>BILL REFERENCE DATE</label>
                  <input type="date" value={header.bill_reference_date} onChange={(e) => setH('bill_reference_date', e.target.value)} className="input w-full" />
                </div>
                <div>
                  <label className={label}>STAFF MEMBER</label>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Staff' }, ...staff.map((m: any) => ({ id: m.id.toString(), name: `${m.name} - ${m.phone}` }))]}
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

            {/* Vendor */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">VENDOR NAME *</label>
                    {!isEditMode && (
                      <a href="/vendors/create?from=purchase" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors">+ Add New Vendor</a>
                    )}
                  </div>
                  <SearchableSelect
                    options={[{ id: '', name: 'Select Vendor' }, { id: OTHER_VENDOR, name: 'Other' }, ...vendors.map(v => ({ id: v.id.toString(), name: v.vendor_name }))]}
                    selectedValue={vendorId}
                    onSelectionChange={(v) => {
                      const next = v || '';
                      if (next !== vendorId && lines.length) setLines([]);
                      selectVendor(next);
                    }}
                    placeholder="Select Vendor"
                    // The server refuses a vendor change on a saved bill.
                    disabled={isEditMode}
                  />
                  {errors.vendor_name && <p className="text-red-400 text-xs mt-1">{errors.vendor_name}</p>}
                </div>
                <div>
                  <label className={label}>CONTACT NUMBER{isOtherVendor ? ' *' : ''}</label>
                  <input type="text" value={vendor.contact_number} onChange={(e) => setV('contact_number', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter contact number" maxLength={10} readOnly={!isOtherVendor} />
                  {errors.contact_number && <p className="text-red-400 text-xs mt-1">{errors.contact_number}</p>}
                </div>
                <div>
                  <label className={label}>EMAIL ID</label>
                  <input type="email" value={vendor.email_id} onChange={(e) => setV('email_id', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter email address" readOnly={!isOtherVendor} />
                </div>
                <div>
                  <label className={label}>GST NUMBER</label>
                  <input type="text" value={vendor.gst_number} onChange={(e) => setV('gst_number', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter GST number" readOnly={!isOtherVendor} />
                </div>
              </div>
              <div className={`grid grid-cols-1 ${isOtherVendor ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                {isOtherVendor && (
                  <div>
                    <label className={label}>MANUAL VENDOR NAME *</label>
                    <input type="text" value={vendor.vendor_name} onChange={(e) => setV('vendor_name', e.target.value)} className="input w-full" placeholder="Enter vendor name" />
                  </div>
                )}
                <div>
                  <label className={label}>LINE 1</label>
                  <input type="text" value={vendor.address} onChange={(e) => setV('address', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter address line 1" readOnly={!isOtherVendor} />
                </div>
                <div>
                  <label className={label}>LINE 2</label>
                  <input type="text" value={vendor.address_2} onChange={(e) => setV('address_2', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter address line 2" readOnly={!isOtherVendor} />
                </div>
                <div>
                  <label className={label}>CITY</label>
                  <input type="text" value={vendor.city} onChange={(e) => setV('city', e.target.value)} className={readOnly(!isOtherVendor)} placeholder="Enter city" readOnly={!isOtherVendor} />
                </div>
                <div>
                  <label className={label}>STATE</label>
                  <SearchableSelect
                    options={states.map(s => ({ id: s.id, name: s.name }))}
                    selectedValue={
                      states.find(s => vendor.state_code != null && s.code === vendor.state_code)?.id
                      ?? states.find(s => s.name === vendor.state)?.id
                      ?? ''
                    }
                    onSelectionChange={(id) => {
                      const s = states.find(x => x.id === id);
                      setVendor(prev => ({ ...prev, state: s?.name || '', state_code: s ? s.code : null }));
                    }}
                    placeholder="Select State"
                    disabled={!isOtherVendor}
                  />
                </div>
              </div>
            </div>

            {/* Transport */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={label}>TRANSPORT NAME</label>
                  <input type="text" value={header.transport_name} onChange={(e) => setH('transport_name', e.target.value)} className="input w-full" placeholder="Enter transport name" />
                </div>
                <div>
                  <label className={label}>BOX QUANTITY</label>
                  <input type="text" value={header.vehicle_number} onChange={(e) => setH('vehicle_number', e.target.value)} className="input w-full" placeholder="Enter box quantity" />
                </div>
                <div>
                  <label className={label}>TRANSPORT COST</label>
                  <input type="number" step="1" value={header.transport_cost} onChange={(e) => setH('transport_cost', e.target.value)} className="input w-full" placeholder="0" />
                </div>
              </div>
            </div>

            {/* Tax toggle */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex flex-row-reverse mb-3 space-x-6">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input type="checkbox" checked={enableTax} onChange={(e) => setEnableTax(e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded" />
                  <span className="text-sm text-slate-300 pr-4">Enable Tax</span>
                </label>
              </div>
            </div>

            {/* Lines */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <PurchaseLines
                lines={lines}
                onChange={(next) => { setLines(next); if (errors.products) setErrors(prev => ({ ...prev, products: '' })); }}
                enableTax={enableTax}
                filterOptions={filterOptions}
                disabled={vendorId === ''}
                isEditMode={isEditMode}
                onEditingChange={setLineEditing}
              />
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
              {vendorId === '' && <p className="text-xs text-amber-400 mt-1">Select a vendor first</p>}
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
                    type="number" step="1" className="input w-full" placeholder="0" value={packing.total}
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

            {/* Tax & payment */}
            <div className="border-t border-slate-600 pt-4">
              <div className="space-y-4">
                {enableTax && (
                  <>
                    <div className="grid grid-cols-4 gap-4">
                      {[['TAX', summary.tax], ['CGST', summary.cgst], ['SGST', summary.sgst], ['IGST', summary.igst]].map(([name, value]) => (
                        <div key={name as string}>
                          <label className={label}>{name}</label>
                          <input type="text" value={money(value as number)} readOnly disabled className="input w-full bg-slate-700 cursor-not-allowed" />
                        </div>
                      ))}
                    </div>
                    {supplyType === null && (
                      <p className="text-xs text-amber-400">The tax type cannot be worked out — check this bill&apos;s state and the business GSTIN in Settings. Saving will be refused.</p>
                    )}
                  </>
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
                        <span className="text-white font-semibold text-lg">₹{money(summary.grand)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-600 pt-2">
            <div className="p-6 flex justify-end space-x-3">
              <button type="button" onClick={() => router.push('/purchases')} className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || fullyReturned || (isEditMode && !hasChanges)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={isEditMode && !hasChanges ? 'No changes to save' : ''}
              >
                {saving ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Purchase' : 'Create Purchase')}
              </button>
            </div>
          </div>
        </div>
      </form>

      <ConfirmationModal
        isOpen={confirmOpen}
        title={isEditMode ? 'Update Purchase?' : 'Create Purchase?'}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this purchase for ₹${money(summary.grand)}? ${isEditMode ? 'This will update the existing purchase.' : 'This action cannot be undone.'}`}
        confirmText={isEditMode ? 'Update Purchase' : 'Create Purchase'}
        cancelText="Cancel"
        showLoading={saving}
        loadingText={isEditMode ? 'Updating Purchase...' : 'Creating Purchase...'}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
