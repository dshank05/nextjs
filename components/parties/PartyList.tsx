import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { ClearableInput, ExportMenu } from '../common'
import { getLocalDateString } from '../../lib/date-utils'
import { subscribeBroadcast } from '../../lib/broadcast'
import { useDebounce } from '../../hooks/useDebounce'
import { PARTY_UI, usePartyList, type PartyKind } from '../../hooks/useParties'

/**
 * Customer Details and Vendor Details lists (one component; DETAILS_PLAN D3).
 * Sorting runs on the server so it covers every page; S.No continues across
 * pages; both lists show State.
 */
export function PartyList({ kind }: { kind: PartyKind }) {
  const P = PARTY_UI[kind]
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortBy, setSortBy] = useState('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const debounced = useDebounce(search, 300)
  useEffect(() => setPage(1), [debounced])

  const { data, isLoading, isFetching, error } = usePartyList(kind, { page, limit, search: debounced, sortBy, sortOrder })
  const rows = data?.rows || []
  const pagination = data?.pagination || { page: 1, limit, total: 0, totalPages: 1 }

  // Another tab created or edited one: refresh.
  useEffect(() => subscribeBroadcast(msg => {
    if (msg.resource === P.plural && ['created', 'updated', 'deleted'].includes(msg.type)) qc.invalidateQueries({ queryKey: [`${kind}Details`] })
  }), [P.plural, kind, qc])

  const sort = (field: string) => {
    setSortOrder(sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc')
    setSortBy(field)
    setPage(1)
  }
  const arrow = (field: string) => (sortBy === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')
  const pages = () => {
    const out: number[] = []
    for (let i = Math.max(1, pagination.page - 2); i <= Math.min(pagination.totalPages, pagination.page + 2); i++) out.push(i)
    return out
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="text-red-400 text-lg">⚠️</span>
            <div>
              <div className="text-red-400 font-medium">Error loading {P.plural}</div>
              <div className="text-red-300 text-sm">{(error as Error).message}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
              <ClearableInput type="text" placeholder="Search by name, phone, email..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select value={limit} onChange={e => { setLimit(parseInt(e.target.value)); setPage(1) }} className="select w-full min-w-24">
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={rows}
              columns={[
                { key: 'id', label: 'ID', enabled: true },
                { key: P.nameField, label: `${P.label} Name`, enabled: true },
                { key: 'contact_no', label: 'Contact Number', enabled: true },
                { key: 'email', label: 'Email', enabled: true },
                { key: P.gstField, label: P.gstLabel, enabled: true },
                { key: P.cityField, label: 'City', enabled: true },
                { key: P.stateField, label: 'State', enabled: true },
                { key: 'status', label: 'Status', enabled: true }
              ]}
              config={{ title: `${P.label} Details Report`, fileName: `${P.label}_Details_${getLocalDateString()}` }}
            />
            <a href={P.formUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">Add {P.label}</a>
          </div>
        </div>

        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {rows.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} {P.plural}</div>
          <div>Page {pagination.page} of {pagination.totalPages || 1}</div>
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
                <th>S.No</th>
                <th>UID</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('name')}>{P.label} Name{arrow('name')}</th>
                <th>Contact Number</th>
                <th>Email Address</th>
                <th>{P.gstLabel}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('city')}>City{arrow('city')}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('state')}>State{arrow('state')}</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort('status')}>Status{arrow('status')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const state = r[P.stateField]
                const code = r[P.stateCodeField]
                return (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="text-center font-semibold text-slate-400">{(pagination.page - 1) * pagination.limit + i + 1}</td>
                    <td className="text-sm">{r.id}</td>
                    <td className="font-medium text-white">{r[P.nameField]}</td>
                    <td className="text-slate-300">
                      {r.contact_no ? <a href={`tel:${r.contact_no}`} className="hover:text-blue-400 transition-colors">{r.contact_no}</a> : '-'}
                    </td>
                    <td className="text-slate-300">
                      {r.email ? <a href={`mailto:${r.email}`} className="hover:text-blue-400 transition-colors text-ellipsis max-w-40 block">{r.email}</a> : '-'}
                    </td>
                    <td className="text-slate-300 font-mono text-sm">{r[P.gstField] || '-'}</td>
                    <td className="text-slate-300">{r[P.cityField] || '-'}</td>
                    <td className="text-slate-300">{state ? `${state}${code ? ` (${code})` : ''}` : '-'}</td>
                    <td>
                      <span className={`px-2 py-1 rounded-full text-xs ${r.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{r.status || ''}</span>
                    </td>
                    <td>
                      <Link href={P.viewUrl(r.id)} className="text-slate-300 hover:text-blue-400 transition-colors text-xs py-1 px-3" title="View Details">
                        <Eye className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">{P.emptyIcon}</div>
              <h3 className="text-lg font-semibold text-white mb-2">No {P.plural} found</h3>
              <p className="text-slate-400">{search ? 'Nothing matches the search.' : `Start by adding your first ${kind} to the database.`}</p>
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
    </div>
  )
}
