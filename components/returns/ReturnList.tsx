import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, ArrowDown, Eye, Trash2 } from 'lucide-react'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { SearchableSelect } from '../common/SearchableSelect'
import { ClearableInput, ExportMenu } from '../common'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { useSessionStorage } from '../../lib/sessionStorage'
import { getLocalDateString } from '../../lib/date-utils'
import { useDebounce } from '../../hooks/useDebounce'
import { RET, REFUND_STATUS, useReturnList, useDeleteReturn, useReturnParties, type ReturnParty, type ReturnListFilters } from '../../hooks/useReturns'

/**
 * Sale Returns and Purchase Returns lists (one component; RETURNS_PLAN R2).
 * Customer: Type column (Sale / Invoice C), customer name typed. Vendor:
 * vendor dropdown, P/F filter and column.
 */
const BLANK = { returnNo: '', invoiceNo: '', party: '', itemCount: '', dateFrom: '', dateTo: '', paymentMode: '', status: 'all', pf: '' }
type FilterState = typeof BLANK & { sortBy: string; sortOrder: 'asc' | 'desc' }

export function ReturnList({ party }: { party: ReturnParty }) {
  const R = RET[party]
  const isCustomer = party === 'customer'
  const { showSnackbar } = useSnackbar()
  const [saved, setSaved] = useSessionStorage<FilterState>(`${party}-returns-filters`, { ...BLANK, sortBy: 'return_date', sortOrder: 'desc' })
  const [page, setPage] = useState(1)
  const [toDelete, setToDelete] = useState<any | null>(null)
  const limit = 50

  const set = (patch: Partial<FilterState>) => { setSaved({ ...saved, ...patch }); setPage(1) }
  const returnNo = useDebounce(saved.returnNo, 300)
  const invoiceNo = useDebounce(saved.invoiceNo, 300)
  const partyText = useDebounce(saved.party, 300)
  const itemCount = useDebounce(saved.itemCount, 300)
  const pf = useDebounce(saved.pf, 300)

  const filters: ReturnListFilters = {
    page, limit, returnNo, invoiceNo, party: partyText, itemCount, pf,
    dateFrom: saved.dateFrom, dateTo: saved.dateTo, paymentMode: saved.paymentMode, status: saved.status,
    sortBy: saved.sortBy, sortOrder: saved.sortOrder
  }
  const { data, isLoading, isFetching, error } = useReturnList(party, filters)
  const del = useDeleteReturn(party)
  const { data: parties = [] } = useReturnParties(party)
  const rows = data?.rows || []
  const pagination = data?.pagination || { page: 1, limit, total: 0, totalPages: 1 }

  // A filter change can leave the page past the end.
  useEffect(() => { if (page > 1 && page > (pagination.totalPages || 1)) setPage(1) }, [page, pagination.totalPages])

  const sort = (field: string) => set({ sortBy: field, sortOrder: saved.sortBy === field && saved.sortOrder === 'asc' ? 'desc' : 'asc' })
  const sortIcon = (field: string) => saved.sortBy !== field ? null
    : saved.sortOrder === 'asc' ? <ArrowUp className="inline w-4 h-4 ml-1" /> : <ArrowDown className="inline w-4 h-4 ml-1" />
  const pages = () => {
    const out: number[] = []
    for (let i = Math.max(1, pagination.page - 2); i <= Math.min(pagination.totalPages, pagination.page + 2); i++) out.push(i)
    return out
  }

  const confirmDelete = () => {
    if (!toDelete) return
    del.mutate({ id: toDelete.id, type: toDelete.invoice_type }, {
      onSuccess: () => { showSnackbar('success', `Return ${toDelete.return_no} deleted successfully`); setToDelete(null) },
      onError: (e: Error) => showSnackbar('error', e.message || 'Failed to delete return')
    })
  }

  const filtered = saved.returnNo || saved.invoiceNo || saved.party || saved.itemCount || saved.dateFrom || saved.dateTo || saved.paymentMode || saved.status !== 'all' || saved.pf
  const th = (field: string, label: string) => (
    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort(field)}>{label} {sortIcon(field)}</th>
  )
  const exportRows = rows.map(r => ({
    ...r,
    payment_mode: r.payment_mode === 0 ? 'Cash' : r.payment_mode === 1 ? 'Bank' : 'N/A',
    status: (REFUND_STATUS[r.payment_status] || REFUND_STATUS[0]).text,
    kind: r.invoice_type === 'invoicex' ? 'Invoice C' : 'Sale'
  }))

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="text-red-400 text-lg">⚠️</span>
            <div>
              <div className="text-red-400 font-medium">Error loading returns</div>
              <div className="text-red-300 text-sm">{(error as Error).message}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-end gap-2 mb-4">
          <ExportMenu
            data={exportRows}
            columns={[
              { key: 'id', label: 'ID', enabled: true },
              { key: 'return_no', label: 'Return No', enabled: true },
              { key: 'invoice_no', label: 'Invoice No', enabled: true },
              { key: isCustomer ? 'customer_name' : 'vendor_name', label: `${R.label} Name`, enabled: true },
              ...(isCustomer ? [{ key: 'kind', label: 'Type', enabled: true }] : []),
              { key: 'item_count', label: 'Items Qty', enabled: true },
              { key: 'total_amount', label: 'Total', enabled: true },
              { key: 'formattedDate', label: 'Date', enabled: true },
              { key: 'payment_mode', label: 'Payment Mode', enabled: true },
              { key: 'status', label: 'Return Status', enabled: true },
              ...(isCustomer ? [] : [{ key: 'packing_forwarding_total', label: 'P/F', enabled: true }]),
              { key: 'notes', label: 'Notes', enabled: true }
            ]}
            config={{ title: `${R.title}s Report`, fileName: `${R.title.replace(' ', '_')}s_Report_${getLocalDateString()}` }}
          />
          <Link href={R.formUrl} className="btn-primary">Create Return</Link>
        </div>

        <div className={`grid ${isCustomer ? 'grid-cols-8' : 'grid-cols-9'} gap-4 mb-4`}>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Return No</label>
            <ClearableInput type="text" placeholder="Enter return no" value={saved.returnNo} onChange={e => set({ returnNo: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Invoice No</label>
            <ClearableInput type="text" placeholder="Enter invoice no" value={saved.invoiceNo} onChange={e => set({ invoiceNo: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{R.label}</label>
            {isCustomer ? (
              <ClearableInput type="text" placeholder="Enter customer name" value={saved.party} onChange={e => set({ party: e.target.value })} />
            ) : (
              <SearchableSelect
                options={[{ id: '', name: 'All Vendors' }, ...parties.map((p: any) => ({ id: String(p.id), name: p.vendor_name || p.name || '' }))]}
                selectedValue={saved.party}
                onSelectionChange={v => set({ party: v || '' })}
                placeholder="Select vendor..."
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Items Qty</label>
            <ClearableInput type="number" placeholder="Enter item count" value={saved.itemCount} onChange={e => set({ itemCount: e.target.value })} min="0" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
            <DateRangeFilter startDate={saved.dateFrom} endDate={saved.dateTo} onDateChange={(s, e) => set({ dateFrom: s, dateTo: e })} placeholder="Select date range..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
            <SearchableSelect
              options={[{ id: '', name: 'All Modes' }, { id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
              selectedValue={saved.paymentMode}
              onSelectionChange={v => set({ paymentMode: v || '' })}
              placeholder="Select payment mode..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Return Status</label>
            <SearchableSelect
              options={[{ id: 'all', name: 'All Status' }, { id: '0', name: REFUND_STATUS[0].text }, { id: '1', name: REFUND_STATUS[1].text }]}
              selectedValue={saved.status}
              onSelectionChange={v => set({ status: v || 'all' })}
              placeholder="Select status..."
            />
          </div>
          {!isCustomer && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">P/F</label>
              <ClearableInput type="number" placeholder="Enter P/F total" value={saved.pf} onChange={e => set({ pf: e.target.value })} min="0" />
            </div>
          )}
          <div className="flex items-end">
            <button onClick={() => set({ ...BLANK })} className="btn-secondary px-4 py-2">Clear Filters</button>
          </div>
        </div>

        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {rows.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} returns</div>
          <div>Page {pagination.page} of {pagination.totalPages}</div>
        </div>

        <div className="overflow-x-auto relative">
          {(isLoading || (isFetching && !rows.length)) && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                {th('return_no', 'Return No')}
                {th('invoice_no', 'Invoice No.')}
                {th(isCustomer ? 'customer_name' : 'vendor_name', R.label)}
                {isCustomer && <th>Type</th>}
                {th('item_count', 'Items Qty')}
                {th('total_amount', 'Total')}
                {th('return_date', 'Date')}
                {th('payment_mode', 'Payment Mode')}
                {th('status', 'Return Status')}
                {!isCustomer && th('packing_forwarding_total', 'P/F')}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = REFUND_STATUS[r.payment_status] || REFUND_STATUS[0]
                return (
                  <tr key={`${r.invoice_type || 'p'}-${r.id}`}>
                    <td>{(pagination.page - 1) * pagination.limit + i + 1}</td>
                    <td className="font-medium text-white">{r.return_no}</td>
                    <td className="text-slate-300">{r.invoice_no}</td>
                    <td className="text-slate-300"><div className="font-medium">{isCustomer ? r.customer_name : r.vendor_name}</div></td>
                    {isCustomer && (
                      <td className="text-slate-300">
                        <span className={`px-2 py-1 text-xs rounded-full text-white ${r.invoice_type === 'invoicex' ? 'bg-purple-600' : 'bg-blue-600'}`}>
                          {r.invoice_type === 'invoicex' ? 'Invoice C' : 'Sale'}
                        </span>
                      </td>
                    )}
                    <td className="text-slate-300">
                      <div className="flex items-center gap-1"><span>{r.item_count}</span><span className="text-xs text-slate-400">items</span></div>
                    </td>
                    <td className="text-slate-300 font-semibold">₹{(r.total_amount || 0).toLocaleString('en-IN')}</td>
                    <td className="text-slate-300">{r.formattedDate}</td>
                    <td className="text-slate-300">{r.payment_mode === 0 ? 'Cash' : r.payment_mode === 1 ? 'Bank' : 'N/A'}</td>
                    <td><span className={`px-2 py-1 ${st.cls} text-white text-xs rounded-full`}>{st.text}</span></td>
                    {!isCustomer && <td className="text-slate-300">₹{(r.packing_forwarding_total || 0).toLocaleString('en-IN')}</td>}
                    <td>
                      <div className="flex items-center space-x-2">
                        <Link href={R.viewUrl(r.id, r.invoice_type)} title="View Return Details" className="btn-icon text-slate-300 hover:text-blue-400">
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button onClick={() => setToDelete(r)} title="Delete Return" className="btn-icon text-red-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && !isLoading && (
            <div className="text-center py-8 text-slate-400">
              {filtered
                ? `No ${R.title.toLowerCase()}s found with the current filters.`
                : `No ${R.title.toLowerCase()}s found. Click "Create Return" to create a new return.`}
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button onClick={() => setPage(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
            <div className="flex space-x-2">
              {pagination.page > 3 && <><button onClick={() => setPage(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button><span>...</span></>}
              {pages().map(p => (
                <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>
              ))}
              {pagination.page < pagination.totalPages - 2 && <><span>...</span><button onClick={() => setPage(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button></>}
            </div>
            <button onClick={() => setPage(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={`Delete ${R.title}`}
        message={toDelete
          ? `Are you sure you want to delete return ${toDelete.return_no}? This action is irreversible: ${isCustomer ? 'the returned items are taken out of stock again' : 'the items are put back into stock'}, the ${isCustomer ? 'credit' : 'debit'} note is reversed in the ledger, and the ${isCustomer ? 'customer' : 'vendor'} balance is updated. This operation cannot be undone.`
          : ''}
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={del.isPending}
        loadingText="Deleting..."
      />
    </div>
  )
}
