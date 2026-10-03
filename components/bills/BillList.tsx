import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useStorageState from 'use-storage-state'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, Trash2 } from 'lucide-react'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { SearchableSelect } from '../common/SearchableSelect'
import { ClearableInput, ExportMenu } from '../common'
import { ListPagination, ListSummary, SortIcon } from '../common/ListPagination'
import { ConfirmationModal } from '../ConfirmationModal'
import { useSnackbar } from '../SnackbarProvider'
import { broadcast, subscribeBroadcast } from '../../lib/broadcast'
import { getLocalDateString } from '../../lib/date-utils'
import { money } from '../../lib/line-math'
import { useDebounce } from '../../hooks/useDebounce'
import { usePartyOptions } from '../../hooks/usePartyTransactions'
import {
  BILL, EMPTY_BILL_FILTERS, fetchBills, useBillList, useDeleteBill,
  type BillKind, type BillListFilterState, type BillRow
} from '../../hooks/useBills'

/**
 * Purchase, Sale and Invoice C lists - one component (BILLS_PLAN B3). Filters and
 * page persist together per tab; every list opens newest first; the party
 * filter offers "Other" on all three; a delete refreshes every screen.
 */
const LIMIT = 50

const STORE: Record<BillKind, string> = { purchase: 'purchases', sale: 'sale', salex: 'salex' }

const day = (value: number | string) => {
  const v = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? parseInt(String(value), 10) : NaN
  const d = Number.isFinite(v) ? new Date(v * 1000) : new Date(String(value))
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN')
}
const statusBadge = (s?: number | null) =>
  s === 1 ? <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>
    : s === 2 ? <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>
      : <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>
const modeText = (m?: number | null) => (m === 0 ? 'Cash' : m === 1 ? 'Bank' : 'N/A')
const rupees = (v?: number) => `₹${money(Number(v) || 0)}`

export function BillList({ kind }: { kind: BillKind }) {
  const B = BILL[kind]
  const taxFree = B.taxFree
  const qc = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [stored, setStored] = useStorageState<BillListFilterState>(`${STORE[kind]}-page-filters`, { defaultValue: EMPTY_BILL_FILTERS, storage: 'session' })
  // Older tabs saved another shape (vendorFilter / customerFilter); the defaults fill the gaps.
  const filters: BillListFilterState = { ...EMPTY_BILL_FILTERS, ...(stored || {}) }
  const [page, setPage] = useStorageState<number>(`${STORE[kind]}-page-number`, { defaultValue: 1, storage: 'session' })
  const settled = useDebounce(filters, 300)
  const query = useMemo(() => ({ ...settled, page, limit: LIMIT }), [settled, page])
  const { data, isLoading, error, refetch } = useBillList(kind, query)
  const rows = data?.rows || []
  const pagination = data?.pagination ? { hasMore: false, ...data.pagination } : { page: 1, limit: LIMIT, total: 0, totalPages: 1, hasMore: false }

  // Every party of this kind, not the first page of fifty.
  const { data: parties = [] } = usePartyOptions(B.party)

  const remove = useDeleteBill(kind)
  const [toDelete, setToDelete] = useState<BillRow | null>(null)

  // Another tab saved or deleted one: refresh.
  useEffect(() => subscribeBroadcast((msg) => {
    if (msg.resource === B.resource && ['created', 'updated', 'deleted'].includes(msg.type)) qc.invalidateQueries({ queryKey: [B.listKey] })
  }), [qc, B.resource, B.listKey])

  // A remembered page past the end of the current results goes back to 1.
  useEffect(() => {
    if (!isLoading && pagination.totalPages > 0 && page > pagination.totalPages) setPage(1)
  }, [isLoading, pagination.totalPages, page, setPage])

  const change = (patch: Partial<BillListFilterState>) => { setStored({ ...filters, ...patch }); setPage(1) }
  const sort = (field: string) => change({ sortBy: field, sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : 'asc' })
  const th = (field: string, label: string) => (
    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort(field)}>
      {label} <SortIcon field={field} sortBy={filters.sortBy} sortOrder={filters.sortOrder} />
    </th>
  )
  const confirmDelete = () => toDelete && remove.mutate(toDelete.id, {
    onSuccess: () => {
      showSnackbar('success', `${B.title} ${toDelete.invoice_no} deleted successfully`)
      broadcast({ type: 'deleted', resource: B.resource as any, data: { id: toDelete.id } })
      setToDelete(null)
    },
    onError: (e: Error) => { showSnackbar('error', e.message); setToDelete(null) }
  })
  const exportRows = (list: BillRow[], offset: number) =>
    list.map((r, i) => ({ ...r, serialNumber: offset + i + 1, invoice_date: day(r.invoice_date) }))
  const label = 'block text-sm font-medium text-slate-300 mb-2'

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading {B.noun}</div>
                <div className="text-red-300 text-sm">{(error as Error).message}</div>
              </div>
            </div>
            <button onClick={() => refetch()} className="btn-secondary text-red-400 text-sm py-1 px-3">Retry</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-end gap-2 mb-4">
          <ExportMenu
            data={exportRows(rows, (pagination.page - 1) * pagination.limit)}
            fetchAll={async () => exportRows((await fetchBills(kind, { ...settled, page: 1, limit: 1000 })).rows, 0)}
            columns={[
              { key: 'serialNumber', label: 'S.N', enabled: true },
              { key: 'invoice_no', label: 'Invoice No', enabled: true },
              { key: 'bill_reference', label: 'Bill Reference', enabled: true },
              { key: 'party_name', label: B.partyLabel, enabled: true },
              { key: 'item_count', label: 'Items', enabled: true },
              { key: 'total', label: 'Total', enabled: true },
              ...(taxFree ? [] : [{ key: 'total_tax', label: 'Tax', enabled: true }]),
              { key: 'packing_forwarding_total', label: 'P/F', enabled: true },
              { key: 'invoice_date', label: 'Date', enabled: true },
              { key: 'payment_mode', label: 'Payment Mode', enabled: true },
              { key: 'payment_status', label: 'Payment Status', enabled: true },
              { key: 'notes', label: 'Notes', enabled: true }
            ]}
            config={{ title: `${B.title} Report`, fileName: `${B.reportFile}_${getLocalDateString()}` }}
          />
          <Link href={B.formUrl} className="btn-primary">{B.addLabel}</Link>
        </div>

        <div className="grid grid-cols-11 gap-4 mb-4">
          <div>
            <label className={label}>Invoice No</label>
            <ClearableInput type="number" placeholder="Enter invoice no" min="1" value={filters.uidFilter} onChange={e => change({ uidFilter: e.target.value })} />
          </div>
          <div>
            <label className={label}>Bill Reference</label>
            <ClearableInput type="text" placeholder="Enter bill reference" value={filters.billReference} onChange={e => change({ billReference: e.target.value })} />
          </div>
          <div>
            <label className={label}>{B.partyLabel}</label>
            <SearchableSelect
              options={[{ id: '', name: `All ${B.partyLabel}s` }, { id: '0', name: 'Other' }, ...parties.filter(p => p.id !== '0')]}
              selectedValue={filters.partyFilter}
              onSelectionChange={v => change({ partyFilter: v || '' })}
              placeholder={`Select ${B.partyLabel.toLowerCase()}...`}
            />
          </div>
          <div>
            <label className={label}>Items</label>
            <ClearableInput type="number" placeholder="Item count" min="0" value={filters.itemCount} onChange={e => change({ itemCount: e.target.value })} />
          </div>
          <div>
            <label className={label}>Total</label>
            <ClearableInput type="number" placeholder="Total amount" min="0" value={filters.total} onChange={e => change({ total: e.target.value })} />
          </div>
          {taxFree ? (
            <div>
              <label className={label}>Notes</label>
              <ClearableInput type="text" placeholder="Notes" value={filters.notes} onChange={e => change({ notes: e.target.value })} />
            </div>
          ) : (
            <div>
              <label className={label}>Tax Amount</label>
              <ClearableInput type="number" placeholder="Tax amount" min="0" value={filters.totalTax} onChange={e => change({ totalTax: e.target.value })} />
            </div>
          )}
          <div>
            <label className={label}>Date</label>
            <DateRangeFilter startDate={filters.dateFrom} endDate={filters.dateTo} onDateChange={(start, end) => change({ dateFrom: start, dateTo: end })} placeholder="Select date range..." />
          </div>
          <div>
            <label className={label}>Payment Mode</label>
            <SearchableSelect
              options={[{ id: '', name: 'All Modes' }, { id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
              selectedValue={filters.paymentMode}
              onSelectionChange={v => change({ paymentMode: v || '' })}
              placeholder="Select payment mode..."
            />
          </div>
          <div>
            <label className={label}>Payment Status</label>
            <SearchableSelect
              options={[{ id: 'all', name: 'All Status' }, { id: '1', name: 'Paid' }, { id: '2', name: 'Partial Paid' }, { id: '0', name: 'Unpaid' }]}
              selectedValue={filters.statusFilter || 'all'}
              onSelectionChange={v => change({ statusFilter: v || 'all' })}
              placeholder="Select status..."
            />
          </div>
          <div>
            <label className={label}>P/F</label>
            <ClearableInput type="number" placeholder="P/F total" min="0" value={filters.packingForwardingTotal} onChange={e => change({ packingForwardingTotal: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button onClick={() => change({ ...EMPTY_BILL_FILTERS, sortBy: filters.sortBy, sortOrder: filters.sortOrder })} className="btn-secondary px-4 py-2">Clear Filters</button>
          </div>
        </div>

        <ListSummary pagination={pagination} shown={rows.length} noun={B.noun} />

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
                {th('invoice_no', 'Invoice No')}
                {th('bill_reference', 'Bill Ref')}
                {th(B.party === 'vendor' ? 'vendor_name' : 'customer_name', B.partyLabel)}
                {th('item_count', 'Items')}
                {th('total', 'Total')}
                {!taxFree && th('total_tax', 'Tax')}
                {th('packing_forwarding_total', 'P/F')}
                {th('invoice_date', 'Date')}
                {th('payment_mode', 'Payment Mode')}
                {th('payment_status', 'Payment Status')}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                // The server refuses a delete while any return exists, partial or full.
                const hasReturns = row.return_status > 0
                return (
                  <tr key={row.id}>
                    <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                    <td className="font-medium text-white">{row.invoice_no}</td>
                    <td className="text-slate-300">
                      <div className="flex flex-col">
                        <span>{row.bill_reference || 'N/A'}</span>
                        {row.bill_reference_date && <span className="text-slate-400 text-xs">{row.bill_reference_date}</span>}
                      </div>
                    </td>
                    <td className="text-slate-300"><div className="font-medium">{row.party_name || 'N/A'}</div></td>
                    <td className="text-slate-300"><span>{row.item_count}</span> <span className="text-xs text-slate-400">items</span></td>
                    <td className="text-slate-300 font-semibold">{rupees(row.total)}</td>
                    {!taxFree && <td className="text-slate-300">{rupees(row.total_tax)}</td>}
                    <td className="text-slate-300">{rupees(row.packing_forwarding_total)}</td>
                    <td className="text-slate-300">{day(row.invoice_date)}</td>
                    <td className="text-slate-300">{modeText(row.payment_mode)}</td>
                    <td>{statusBadge(row.payment_status)}</td>
                    <td>
                      <div className="flex items-center space-x-2">
                        <Link href={`${B.viewUrl}/${row.id}`} title={`View ${B.title}`} className="btn-icon text-slate-300"><Eye className="w-4 h-4" /></Link>
                        <button
                          onClick={() => setToDelete(row)}
                          disabled={hasReturns}
                          title={hasReturns ? 'Cannot delete - this bill has returns' : `Delete ${B.title}`}
                          className={`btn-icon text-red-400 hover:text-red-500 ${hasReturns ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && !isLoading && <div className="text-center py-8 text-slate-400">No {B.noun} found with the current filters.</div>}
        </div>

        <ListPagination pagination={pagination} onPageChange={next => { if (next > 0 && next <= pagination.totalPages) setPage(next) }} />
      </div>

      <ConfirmationModal
        isOpen={toDelete !== null}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={`Delete ${B.title}`}
        message={toDelete
          ? kind === 'purchase'
            ? `Are you sure you want to delete purchase ${toDelete.invoice_no}? This will take its quantities back out of stock, remove its ledger entries and payment allocations, and update the vendor balance. This cannot be undone.`
            : `Are you sure you want to delete ${B.title.toLowerCase()} ${toDelete.invoice_no}? Its quantities go back into stock, and its ledger entries and payment allocations are removed with it. This cannot be undone.`
          : ''}
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={remove.isPending}
        loadingText="Deleting..."
      />
    </div>
  )
}
