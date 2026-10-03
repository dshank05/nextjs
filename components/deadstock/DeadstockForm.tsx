import { useEffect, useState } from 'react'
import { X, Package } from 'lucide-react'
import { useSnackbar } from '../SnackbarProvider'
import { SearchableSelect, ClearableInput } from '../common'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSaveDeadstock, useStockProducts, type Deadstock } from '../../hooks/useDeadstock'

/**
 * Add to / edit dead stock (DETAILS_PLAN D4). Whole units only; the product's
 * stock comes fresh from the server each time the form opens, and the stock
 * summary is shown before saving.
 */
export function DeadstockForm({ open, editing, onClose }: { open: boolean; editing: Deadstock | null; onClose: () => void }) {
  const { showSnackbar } = useSnackbar()
  const { data: products = [] } = useStockProducts(open)
  const save = useSaveDeadstock()
  const [productId, setProductId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!open) return
    setProductId(editing ? editing.product_id : null)
    setQuantity(editing ? String(editing.quantity) : '')
    setReason(editing ? editing.reason : '')
    setAsking(false)
  }, [open, editing])

  if (!open) return null

  // Stock on hand already excludes this entry's units.
  const available = Number(products.find(p => p.id === productId)?.stock) || 0
  const held = editing ? Number(editing.quantity) : 0
  const qty = Number(quantity)

  const submit = () => {
    if (!productId) return showSnackbar('error', 'Please select a product')
    if (!quantity || !Number.isFinite(qty) || qty <= 0) return showSnackbar('error', 'Please enter a valid quantity greater than 0')
    if (!Number.isInteger(qty)) return showSnackbar('error', 'Quantity must be a whole number of units')
    if (!reason.trim()) return showSnackbar('error', 'Please enter a reason')
    if (editing && qty === held && reason.trim() === editing.reason.trim()) {
      return showSnackbar('error', 'No changes detected. Please modify quantity or reason before updating.')
    }
    if (!editing && qty > available) return showSnackbar('error', `Insufficient stock. Available: ${available}, Requested: ${qty}`)
    if (editing && qty - held > available) return showSnackbar('error', `Insufficient stock for increase. Available: ${available + held}, Requested: ${qty}`)
    setAsking(true)
  }

  const confirm = () => save.mutate({ id: editing?.id, data: { product_id: productId as number, quantity: qty, reason: reason.trim() } }, {
    onSuccess: (data: any) => {
      setAsking(false)
      showSnackbar('success', data?.message || `Deadstock ${editing ? 'updated' : 'created'} successfully!`)
      onClose()
    },
    onError: (e: Error) => {
      setAsking(false)
      showSnackbar('error', e.message)
    }
  })

  const busy = save.isPending
  const original = available + held
  const summary = `Stock Summary:\n• Original Stock: ${original} units\n• Existing Deadstock: ${held} units\n• Current Available: ${available} units\n• New Deadstock: ${quantity} units\n• Final Stock: ${original - qty} units\n\n` +
    `Are you sure you want to ${editing ? 'update' : 'add'} this deadstock entry?`

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
            <Package className="w-5 h-5" />
            {editing ? 'Edit Deadstock' : 'Add to Deadstock'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors" disabled={busy} title="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Product *</label>
            <SearchableSelect
              options={[
                { id: '', name: 'Select a product...' },
                ...products.map(p => ({ id: String(p.id), name: `${p.product_name} ${p.part_no ? `(${p.part_no})` : ''} - Stock: ${p.stock || 0}` }))
              ]}
              selectedValue={productId ? String(productId) : ''}
              onSelectionChange={v => setProductId(v ? parseInt(v) : null)}
              placeholder="Select a product..."
              disabled={busy || !!editing}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Quantity *</label>
            <ClearableInput
              type="number" step="1" min="1" value={quantity} disabled={busy} placeholder="Enter quantity"
              onChange={e => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="input w-full" placeholder="Enter reason for marking as deadstock..." disabled={busy} required />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors" disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2">
            {busy ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>{editing ? 'Updating...' : 'Adding...'}</>
            ) : (editing ? 'Update Deadstock' : 'Add to Deadstock')}
          </button>
        </div>
      </div>

      <ConfirmationModal
        isOpen={asking}
        title={editing ? 'Update Deadstock Entry' : 'Add to Deadstock'}
        message={summary}
        confirmText={editing ? 'Update Entry' : 'Add to Deadstock'}
        cancelText="Cancel"
        showLoading={busy}
        loadingText={editing ? 'Updating...' : 'Adding...'}
        onConfirm={confirm}
        onCancel={() => setAsking(false)}
      />
    </div>
  )
}
