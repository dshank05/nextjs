import { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown, Edit, Trash2 } from 'lucide-react'
import { ClearableInput } from '../common'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { useDebounce } from '../../hooks/useDebounce'
import { useDeadstockList, useDeleteDeadstock, type Deadstock } from '../../hooks/useDeadstock'
import { DeadstockForm } from './DeadstockForm'

/**
 * Dead stock list (DETAILS_PLAN D4): search, items per page, sort headers that
 * sort (on the server, across every page), add / edit in a modal, delete with
 * the units going back to stock.
 */
export function DeadstockList() {
  const { showSnackbar } = useSnackbar()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const debounced = useDebounce(search, 300)
  useEffect(() => setPage(1), [debounced])

  const { data, isLoading, error } = useDeadstockList({ page, limit, search: debounced, sortBy, sortOrder })
  const rows = data?.rows || []
  const pagination = data?.pagination || { page: 1, limit, total: 0, totalPages: 1 }

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Deadstock | null>(null)
  const [deleting, setDeleting] = useState<Deadstock | null>(null)
  const remove = useDeleteDeadstock()

  const sort = (field: string) => {
    setSortOrder(sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : field === 'created_at' || field === 'quantity' ? 'desc' : 'asc')
    setSortBy(field)
    setPage(1)
  }
  const icon = (field: string) => sortBy !== field ? null
    : sortOrder === 'asc' ? <ArrowUp className="inline w-4 h-4 ml-1" /> : <ArrowDown className="inline w-4 h-4 ml-1" />
  const pages = () => {
    const out: number[] = []
    for (let i = Math.max(1, pagination.page - 2); i <= Math.min(pagination.totalPages, pagination.page + 2); i++) out.push(i)
    return out
  }
  const confirmDelete = () => deleting && remove.mutate(deleting.id, {
    onSuccess: (d: any) => { showSnackbar('success', d?.message || 'Deadstock entry deleted successfully!'); setDeleting(null) },
    onError: (e: Error) => showSnackbar('error', e.message)
  })

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="text-red-400 text-lg">⚠️</span>
            <div>
              <div className="text-red-400 font-medium">Error loading deadstock</div>
              <div className="text-red-300 text-sm">{(error as Error).message}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-end justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-xl">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
              <ClearableInput type="text" placeholder="Search products, reasons, or creators..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select value={limit} onChange={e => { setLimit(parseInt(e.target.value)); setPage(1) }} className="select w-full min-w-24">
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <button onClick={() => { setEditing(null); setFormOpen(true) }} className="btn-primary">Add to Deadstock</button>
        </div>

        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {rows.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} deadstock entries</div>
          <div>Page {pagination.page} of {pagination.totalPages || 1}</div>
        </div>

        <div className="overflow-x-auto relative">
          {isLoading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('product_name')}>Product {icon('product_name')}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('quantity')}>Quantity {icon('quantity')}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('reason')}>Reason {icon('reason')}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('created_at')}>Created Date {icon('created_at')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, idx) => (
                <tr key={item.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="text-slate-300">
                    <div className="font-medium">{item.product_name}</div>
                    {item.part_no && <div className="text-xs text-slate-400">Part: {item.part_no}</div>}
                  </td>
                  <td className="text-slate-300 font-semibold">{item.quantity}</td>
                  <td className="text-slate-300 max-w-xs"><div className="truncate" title={item.reason}>{item.reason}</div></td>
                  <td className="text-slate-300">{item.formatted_created_at}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => { setEditing(item); setFormOpen(true) }} title="Edit Deadstock" className="btn-icon text-blue-400 hover:text-blue-300"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => setDeleting(item)} title="Delete Deadstock" className="btn-icon text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !isLoading && (
            <div className="text-center py-8 text-slate-400">
              {search ? 'No deadstock entries found with the current search.' : 'No deadstock entries found. Click "Add to Deadstock" to create your first entry.'}
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button onClick={() => setPage(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
            <div className="flex space-x-2">
              {pagination.page > 3 && <><button onClick={() => setPage(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button><span>...</span></>}
              {pages().map(p => <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
              {pagination.page < pagination.totalPages - 2 && <><span>...</span><button onClick={() => setPage(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button></>}
            </div>
            <button onClick={() => setPage(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      <DeadstockForm open={formOpen} editing={editing} onClose={() => { setFormOpen(false); setEditing(null) }} />

      <ConfirmationModal
        isOpen={!!deleting}
        title="Delete Deadstock Entry"
        message={`Are you sure you want to delete this deadstock entry for "${deleting?.product_name}"? This will return ${deleting?.quantity} units back to inventory.`}
        confirmText="Delete & Return Stock"
        cancelText="Cancel"
        showLoading={remove.isPending}
        loadingText="Deleting..."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
