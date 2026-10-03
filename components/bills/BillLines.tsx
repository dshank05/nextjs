import { useMemo, useState } from 'react';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { SearchableMultiSelect } from '../common/SearchableMultiSelect';
import { ProductSelectionPanel } from '../common/ProductSelectionPanel';
import { ConfirmationModal } from '../ConfirmationModal';
import { useProducts } from '../../hooks/useProducts';
import { lineAmounts, rateFromTotal, parseNum, wholeQty, money, round2 } from '../../lib/line-math';
import type { Product, FilterOptions } from '../../types/products';

/**
 * The line table every bill form uses - purchase, sale and Invoice C: a
 * template row to add a product, the added lines with one inline editor, and
 * the product panel.
 *
 * Purchase Block A built it as PurchaseLines; Phase 5 Block A generalised it
 * so the sale forms (2,694 + 2,368 lines, the editor written out several times
 * in each) use the same code. Lines hold only what the user decides - product,
 * model, part, qty, rate, discount, GST %. Tax and totals are derived on render
 * by lib/line-math, the function the server stores with.
 */

export interface BillLine {
  key: string;
  /** Database row, for a line loaded from a saved bill; sent back so the save reconciles by row. */
  line_id?: number;
  product_id: number;
  product_name: string;
  display_name?: string;
  car_model: string;
  model_id: number | null;
  company_id: number | null;
  part: string;
  qty: number;
  rate: number;
  /** Fixed amount off the line, before tax. */
  discount: number;
  gst_percentage: number;
  original_qty?: number;
  returned_qty: number;
  is_fully_returned: boolean;
}

interface Props {
  lines: BillLine[];
  onChange: (lines: BillLine[]) => void;
  enableTax: boolean;
  enableDiscount?: boolean;
  filterOptions: FilterOptions;
  /** No party yet: products cannot be added. */
  disabled: boolean;
  disabledHint?: string;
  isEditMode: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** The rate a newly picked product starts at. */
  defaultRate: (p: Product) => number;
  /** Sale: show the shelf stock and warn when a line asks for more. */
  showStock?: boolean;
  /** "purchase", "sale", "Invoice C" - for messages. */
  noun?: string;
}

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyTemplate = { qty: '', rate: '', gst: '0', discount: '', total: '', modelId: '', part: '' };

/** Car models a product fits; all models when it lists none or is not loaded. */
function modelsFor(product: Product | undefined, filterOptions: FilterOptions) {
  const ids = (product?.car_model_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length ? filterOptions.models.filter(m => ids.includes(m.id.toString())) : filterOptions.models;
}

const defaultGst = (p: Product) => p.gst_rate_percentage ?? p.gst_rate ?? 0;

export function BillLines({
  lines, onChange, enableTax, enableDiscount = false, filterOptions, disabled, disabledHint = 'Select a party first',
  isEditMode, onEditingChange, defaultRate, showStock = false, noun = 'bill'
}: Props) {
  // ---- product panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panelModel, setPanelModel] = useState('');
  const [panelCategory, setPanelCategory] = useState('');
  const [panelSubcategory, setPanelSubcategory] = useState('');
  const [panelCompany, setPanelCompany] = useState('');
  const { data: productsData, isLoading: productsLoading } = useProducts({
    modelFilter: panelModel,
    search,
    categoryFilter: panelCategory,
    subcategoryFilter: panelSubcategory,
    companyFilter: panelCompany,
    fetchAll: true
  });
  const products: Product[] = productsData?.products || [];
  const [knownProducts, setKnownProducts] = useState<Record<number, Product>>({});

  // ---- template row
  const [picked, setPicked] = useState<Product | null>(null);
  const [tpl, setTpl] = useState(emptyTemplate);
  const [error, setError] = useState('');

  // ---- inline edit
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [edit, setEdit] = useState({ qty: '', rate: '', gst: '', discount: '', total: '', modelId: '' });
  const [toDelete, setToDelete] = useState<BillLine | null>(null);

  const gstOf = (gst: number) => (enableTax ? gst : 0);
  const discOf = (d: number) => (enableDiscount ? d : 0);
  const modelName = (id: string | number | null) =>
    filterOptions.models.find(m => m.id.toString() === String(id))?.name || '';
  const productOf = (id: number) => knownProducts[id] || products.find(p => p.id === id);
  /** Stock left for a product once this bill's other lines are counted. */
  const stockLeft = (productId: number, exceptKey?: string) => {
    const p = productOf(productId);
    if (!p || p.stock === undefined || p.stock === null) return null;
    const onBill = lines.filter(l => l.product_id === productId && l.key !== exceptKey && !l.line_id).reduce((s, l) => s + l.qty, 0);
    return p.stock - onBill;
  };

  const resetTemplate = () => {
    setPicked(null);
    setTpl(emptyTemplate);
    setError('');
  };

  const remember = (list: Product[]) =>
    setKnownProducts(prev => ({ ...prev, ...Object.fromEntries(list.map(p => [p.id, p])) }));

  const lineFromProduct = (p: Product, overrides: Partial<BillLine> = {}): BillLine => {
    const modelId = modelsFor(p, filterOptions)[0]?.id ?? null;
    return {
      key: newKey(),
      product_id: p.id,
      product_name: p.product_name,
      display_name: p.display_name || p.product_name,
      car_model: modelId !== null ? modelName(modelId) : '',
      model_id: modelId,
      company_id: p.company_id ?? null,
      part: p.part_no || '',
      qty: 1,
      rate: defaultRate(p),
      discount: 0,
      gst_percentage: defaultGst(p),
      returned_qty: 0,
      is_fully_returned: false,
      ...overrides
    };
  };

  const totalFor = (qty: number, rate: number, gst: number, discount: number) =>
    String(round2(lineAmounts(qty, rate, gstOf(gst), discOf(discount)).total));

  // ---- panel selection: one product fills the template, several are added as they are
  const onProductSelect = (chosen: Product[]) => {
    remember(chosen);
    const fresh = chosen.filter(p => !lines.some(l => l.product_id === p.id));
    if (chosen.length === 1) {
      const p = fresh[0];
      if (!p) {
        setError(`${chosen[0].product_name} is already on this ${noun}`);
        return;
      }
      const rate = defaultRate(p);
      const gst = defaultGst(p);
      setPicked(p);
      setTpl({
        qty: '1',
        rate: rate ? String(rate) : '',
        gst: String(gst),
        discount: '',
        total: rate ? totalFor(1, rate, gst, 0) : '',
        modelId: String(modelsFor(p, filterOptions)[0]?.id ?? ''),
        part: p.part_no || ''
      });
      setError('');
      setPanelOpen(false);
      setSearch('');
      setPanelModel(''); setPanelCategory(''); setPanelSubcategory(''); setPanelCompany('');
      return;
    }
    if (fresh.length) onChange([...lines, ...fresh.map(p => lineFromProduct(p))]);
  };

  // ---- whichever of qty / rate / discount / total was typed last drives the others
  const recalc = <T extends { qty: string; rate: string; gst: string; discount: string; total: string }>(prev: T, field: string, value: string): T => {
    const next = { ...prev, [field]: value };
    const qty = wholeQty(next.qty);
    const gst = gstOf(parseNum(next.gst));
    const discount = discOf(parseNum(next.discount));
    if (field === 'total') {
      if (qty > 0 && value !== '') next.rate = String(rateFromTotal(parseNum(value), qty, gst, discount));
    } else if (next.rate !== '' && qty > 0) {
      next.total = String(round2(lineAmounts(qty, parseNum(next.rate), gst, discount).total));
    }
    return next;
  };
  const setTplField = (field: 'qty' | 'rate' | 'gst' | 'discount' | 'total', value: string) => setTpl(prev => recalc(prev, field, value));
  const setEditField = (field: 'qty' | 'rate' | 'gst' | 'discount' | 'total', value: string) => setEdit(prev => recalc(prev, field, value));

  const lineProblems = (qty: number, rate: string, discount: number) => {
    const problems: string[] = [];
    if (qty < 1) problems.push('quantity must be at least 1');
    // A blank rate is an error, not a default (PU-07). 0 must be typed.
    if (rate.trim() === '') problems.push('enter a rate');
    else if (parseNum(rate) < 0) problems.push('rate cannot be negative');
    if (discount < 0) problems.push('discount cannot be negative');
    else if (discount > qty * parseNum(rate) + 0.005) problems.push('discount is more than the line amount');
    return problems;
  };

  const addFromTemplate = () => {
    if (!picked) return;
    const qty = wholeQty(tpl.qty);
    const discount = discOf(parseNum(tpl.discount));
    const problems = lineProblems(qty, tpl.rate, discount);
    if (!tpl.modelId) problems.unshift('car model is required');
    if (problems.length) {
      setError(problems.join(', '));
      return;
    }
    onChange([
      ...lines,
      lineFromProduct(picked, {
        model_id: parseInt(tpl.modelId, 10),
        car_model: modelName(tpl.modelId),
        part: tpl.part,
        qty,
        rate: parseNum(tpl.rate),
        discount,
        gst_percentage: parseNum(tpl.gst)
      })
    ]);
    resetTemplate();
  };

  // ---- inline edit
  const startEdit = (line: BillLine) => {
    setEditingKey(line.key);
    setEdit({
      qty: String(line.qty),
      rate: String(line.rate),
      gst: String(line.gst_percentage),
      discount: line.discount ? String(line.discount) : '',
      total: totalFor(line.qty, line.rate, line.gst_percentage, line.discount),
      modelId: line.model_id !== null ? String(line.model_id) : ''
    });
    setError('');
    onEditingChange?.(true);
  };

  const stopEdit = () => {
    setEditingKey(null);
    onEditingChange?.(false);
  };

  const saveEdit = (line: BillLine) => {
    const qty = wholeQty(edit.qty);
    const discount = discOf(parseNum(edit.discount));
    const problems = lineProblems(qty, edit.rate, discount);
    if (problems.length) return setError(problems.join(', '));
    if (line.returned_qty > 0 && qty < line.returned_qty) {
      return setError(`${line.returned_qty} of "${line.display_name || line.product_name}" have been returned; quantity cannot go below that`);
    }
    onChange(lines.map(l => (l.key === line.key
      ? {
          ...l,
          qty,
          rate: parseNum(edit.rate),
          discount,
          gst_percentage: parseNum(edit.gst),
          model_id: edit.modelId ? parseInt(edit.modelId, 10) : null,
          car_model: edit.modelId ? modelName(edit.modelId) : ''
        }
      : l)));
    setError('');
    stopEdit();
  };

  const remove = (line: BillLine) => {
    if (editingKey === line.key) stopEdit();
    onChange(lines.filter(l => l.key !== line.key));
  };

  const totals = useMemo(() => lines.reduce(
    (acc, l) => ({ qty: acc.qty + l.qty, taxable: acc.taxable + l.qty * l.rate - discOf(l.discount) }),
    { qty: 0, taxable: 0 }
  ), [lines, enableDiscount]);

  const numInput = 'w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center';
  const noWheel = {
    onWheel: (e: React.WheelEvent<HTMLInputElement>) => (e.target as HTMLInputElement).blur(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
    }
  };
  const th = 'px-2 py-2 text-xs font-medium text-slate-300 uppercase tracking-wider';
  const cell = 'px-2 py-2 text-center text-xs text-slate-200';
  const tplLeft = picked && showStock ? stockLeft(picked.id) : null;

  return (
    <>
      <div className="border border-slate-600 rounded mb-3">
        <table className="w-full">
          <thead className="bg-slate-700">
            <tr>
              <th className={`${th} text-center w-16`}>SN</th>
              <th className={`${th} text-left`}>PRODUCT NAME</th>
              <th className={`${th} text-left`}>CAR MODELS</th>
              <th className={`${th} text-left`}>PART NO</th>
              <th className={`${th} text-center w-24`}>QTY</th>
              <th className={`${th} text-center w-24`}>RATE</th>
              {enableDiscount && <th className={`${th} text-center w-24`}>DISC (₹)</th>}
              {enableTax && <th className={`${th} text-center w-20`}>TAX (%)</th>}
              <th className={`${th} text-center w-24`}>TOTAL</th>
              <th className={`${th} text-center w-20`}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {/* Template row */}
            <tr className="bg-slate-800 border-b-2 border-slate-600">
              <td className="px-2 py-2 w-16" />
              <td className="px-2 py-2">
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    value={picked ? (picked.display_name || picked.product_name) : ''}
                    onClick={() => { if (!picked && !disabled) { setError(''); setSearch(''); setPanelOpen(true); } }}
                    disabled={disabled}
                    className={`w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    placeholder={disabled ? disabledHint : 'Click to search products...'}
                  />
                  {picked && (
                    <button type="button" onClick={resetTemplate} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white" title="Clear selection">✕</button>
                  )}
                </div>
                {tplLeft !== null && (
                  <div className={`text-[11px] mt-1 ${wholeQty(tpl.qty) > tplLeft ? 'text-red-400' : 'text-slate-400'}`}>In stock: {tplLeft}</div>
                )}
              </td>
              <td className="px-2 py-2">
                <SearchableMultiSelect
                  mode="single"
                  options={modelsFor(picked || undefined, filterOptions).map(m => ({ id: m.id.toString(), name: m.name }))}
                  selectedValue={tpl.modelId || null}
                  onSelectionChange={(v) => setTpl(prev => ({ ...prev, modelId: v || '' }))}
                  placeholder="Select car model..."
                />
              </td>
              <td className="px-2 py-2">
                <input type="text" className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-400" placeholder="Part number..." value={tpl.part} onChange={(e) => setTpl(prev => ({ ...prev, part: e.target.value }))} />
              </td>
              <td className="px-2 py-2 w-24">
                <input type="number" step="1" min="1" className={numInput} value={tpl.qty} onChange={(e) => setTplField('qty', e.target.value)} {...noWheel} />
              </td>
              <td className="px-2 py-2 w-24">
                <input type="number" step="0.01" min="0" className={numInput} placeholder="0" value={tpl.rate} onChange={(e) => setTplField('rate', e.target.value)} {...noWheel} />
              </td>
              {enableDiscount && (
                <td className="px-2 py-2 w-24">
                  <input type="number" step="0.01" min="0" className={numInput} placeholder="0" value={tpl.discount} onChange={(e) => setTplField('discount', e.target.value)} {...noWheel} />
                </td>
              )}
              {enableTax && (
                <td className="px-2 py-2 w-20">
                  <input type="number" className={numInput} placeholder="0%" value={tpl.gst} onChange={(e) => setTplField('gst', e.target.value)} {...noWheel} />
                </td>
              )}
              <td className="px-2 py-2 w-24">
                <input type="number" step="0.01" className={numInput} placeholder="0" value={tpl.total} onChange={(e) => setTplField('total', e.target.value)} {...noWheel} />
              </td>
              <td className="px-2 py-2 text-center w-20">
                <div className="flex items-center justify-center space-x-1">
                  <button
                    type="button"
                    onClick={addFromTemplate}
                    disabled={!picked}
                    className={`px-2 py-1 text-xs rounded transition-colors ${picked ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-600 text-slate-400 cursor-not-allowed'}`}
                    title="Add product"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </td>
            </tr>

            {lines.map((line, index) => {
              const editing = editingKey === line.key;
              const hasReturns = line.returned_qty > 0;
              const amounts = lineAmounts(line.qty, line.rate, gstOf(line.gst_percentage), discOf(line.discount));
              const product = productOf(line.product_id);
              return (
                <tr key={line.key} className={`${editing ? 'bg-yellow-900' : line.is_fully_returned ? 'bg-red-900/20' : hasReturns ? 'bg-orange-900/20' : 'bg-slate-800 hover:bg-slate-750'} border-t border-slate-600`}>
                  <td className="px-2 py-2 text-center text-xs text-slate-300">
                    {index + 1}
                    {line.is_fully_returned && (
                      <div className="text-red-400 text-xs font-bold" title={`Fully returned: ${line.returned_qty} of ${line.original_qty}`}>🔒</div>
                    )}
                    {hasReturns && !line.is_fully_returned && (
                      <div className="text-orange-400 text-xs text-center" title={`Returned ${line.returned_qty} of ${line.original_qty}`}>
                        <div>⚠️</div>
                        <div className="text-[10px] leading-none">R:{line.returned_qty}/{line.original_qty}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-200">{line.display_name || line.product_name}</td>
                  <td className="px-2 py-2 text-xs text-slate-200">
                    {editing ? (
                      <SearchableMultiSelect
                        mode="single"
                        options={modelsFor(product, filterOptions).map(m => ({ id: m.id.toString(), name: m.name }))}
                        selectedValue={edit.modelId || null}
                        onSelectionChange={(v) => setEdit(prev => ({ ...prev, modelId: v || '' }))}
                        placeholder="Select car model..."
                      />
                    ) : (line.car_model || modelName(line.model_id))}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-200">{line.part || 'N/A'}</td>
                  {editing ? (
                    <>
                      <td className="px-2 py-2 w-24"><input type="number" step="1" min="1" className={numInput} value={edit.qty} onChange={(e) => setEditField('qty', e.target.value)} {...noWheel} /></td>
                      <td className="px-2 py-2 w-24"><input type="number" step="0.01" min="0" className={numInput} value={edit.rate} onChange={(e) => setEditField('rate', e.target.value)} {...noWheel} /></td>
                      {enableDiscount && <td className="px-2 py-2 w-24"><input type="number" step="0.01" min="0" className={numInput} value={edit.discount} onChange={(e) => setEditField('discount', e.target.value)} {...noWheel} /></td>}
                      {enableTax && <td className="px-2 py-2 w-20"><input type="number" className={numInput} value={edit.gst} onChange={(e) => setEditField('gst', e.target.value)} {...noWheel} /></td>}
                      <td className="px-2 py-2 w-24"><input type="number" step="0.01" className={numInput} value={edit.total} onChange={(e) => setEditField('total', e.target.value)} {...noWheel} /></td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button type="button" onClick={() => saveEdit(line)} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded" title="Save changes"><Check className="w-3 h-3" /></button>
                          <button type="button" onClick={stopEdit} className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded" title="Cancel edit"><X className="w-3 h-3" /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={cell}>{line.qty}</td>
                      <td className={cell}>₹{money(line.rate)}</td>
                      {enableDiscount && <td className={cell}>{line.discount ? `₹${money(line.discount)}` : '-'}</td>}
                      {enableTax && <td className={cell}>{line.gst_percentage}% · ₹{money(amounts.tax)}</td>}
                      <td className={`${cell} font-medium`}>₹{money(amounts.total)}</td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            onClick={() => startEdit(line)}
                            disabled={line.is_fully_returned || editingKey !== null}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                            title={line.is_fully_returned ? 'Cannot edit - item fully returned' : 'Edit product'}
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => (isEditMode ? setToDelete(line) : remove(line))}
                            disabled={hasReturns}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                            title={hasReturns ? 'Cannot remove - item has returns' : 'Remove product'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="bg-slate-700 border-t-2 border-slate-500">
                <td colSpan={4} />
                <td className="px-2 py-2 text-center text-xs font-semibold text-white">{totals.qty}</td>
                <td />
                {enableDiscount && <td />}
                {enableTax && <td />}
                <td className="px-2 py-2 text-center text-xs font-semibold text-white" title="After discount, before tax">₹{money(totals.taxable)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}

      <ProductSelectionPanel
        isOpen={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          setPanelModel(''); setPanelCategory(''); setPanelSubcategory(''); setPanelCompany('');
        }}
        title="Select Product"
        showCarModelFilter={true}
        filterOptions={filterOptions}
        selectedCarModel={panelModel}
        onCarModelSelection={setPanelModel}
        selectedCategory={panelCategory}
        onCategorySelection={setPanelCategory}
        selectedSubcategory={panelSubcategory}
        onSubcategorySelection={setPanelSubcategory}
        selectedCompany={panelCompany}
        onCompanySelection={setPanelCompany}
        searchedProducts={products}
        productSearchTerm={search}
        onSearchTermChange={setSearch}
        isLoading={productsLoading}
        onProductSelect={onProductSelect}
      />

      <ConfirmationModal
        isOpen={toDelete !== null}
        title="Delete Product?"
        message={`Are you sure you want to delete "${toDelete?.display_name || toDelete?.product_name}" from this ${noun}?`}
        confirmText="Delete Product"
        cancelText="Cancel"
        showLoading={false}
        onConfirm={() => { if (toDelete) remove(toDelete); setToDelete(null); }}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
