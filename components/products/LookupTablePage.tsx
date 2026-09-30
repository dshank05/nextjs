import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';
import { ClearableInput, ExportMenu } from '../common';
import { SearchableSelect } from '../common/SearchableSelect';
import { useListQuery } from '../../hooks/useListQuery';
import { useDebounce } from '../../hooks/useDebounce';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../common/ListPagination';
import { getLocalDateString } from '../../lib/date-utils';

/**
 * One page for the four product lookup tables - categories, companies, car
 * models, subcategories (PQ-25). They were four ~390-line copies that differed
 * only in names; subcategories added a parent category. The API side is one
 * factory too (lib/product-lookups.ts).
 */
export interface LookupPageConfig {
  /** `/api/products/<resource>` */
  resource: 'categories' | 'companies' | 'models' | 'subcategories';
  /** "Category", "Car Model" … */
  singular: string;
  /** "categories", "car models" … */
  plural: string;
  /** The name column, e.g. `category_name`. */
  nameField: string;
  /** Export report title and file prefix. */
  report: { title: string; fileName: string };
  /** Subcategories belong to a category: a column, a filter and a required picker. */
  parent?: {
    label: string;
    idField: string;
    nameField: string;
    /** Sort key the API accepts for the parent name. */
    sortKey: string;
    /** List filter parameter for a parent-name search. */
    searchParam: string;
    /** Every parent, for the picker. */
    optionsUrl: string;
    /** The relation the API includes on each row. */
    relation: string;
  };
}

interface Row {
  id: number;
  [key: string]: any;
}

export function LookupTablePage({ config }: { config: LookupPageConfig }) {
  const { resource, singular, plural, nameField, parent } = config;
  const { showSnackbar } = useSnackbar();

  const [parentSearch, setParentSearch] = useState('');
  const debouncedParentSearch = useDebounce(parentSearch, 300);
  const list = useListQuery({
    defaultSort: nameField,
    extraParams: parent ? { [parent.searchParam]: debouncedParentSearch.trim() } : undefined
  });
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<{ id: number; name: string }[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ name: string; parentId: string }>({ name: '', parentId: '' });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const query = list.params.toString();
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // The parent picker's options load once; they do not change with the table (PQ-52).
  useEffect(() => {
    if (!parent) return;
    fetch(parent.optionsUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setParents((d.data || []).map((p: any) => ({ id: p.id, name: p[parent.nameField] }))))
      .catch(() => showSnackbar('error', `Could not load ${parent.label.toLowerCase()} options`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/products/${resource}?${query}`);
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!isCurrent()) return;
      setRows(data.data || []);
      list.setPagination(data.pagination);
    } catch (error) {
      console.error(`Error loading ${plural}:`, error);
      if (isCurrent()) showSnackbar('error', `Could not load ${plural}`);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const openForm = (row: Row | null) => {
    setEditing(row);
    setForm({ name: row ? row[nameField] : '', parentId: row && parent ? String(row[parent.idField] ?? '') : '' });
    setShowForm(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showSnackbar('warning', `${singular} name is required`);
      return;
    }
    // The parent must be picked from the list - typed text never creates one (PQ-08).
    if (parent && !form.parentId) {
      showSnackbar('warning', `Choose a ${parent.label.toLowerCase()} from the list`);
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const body: Record<string, unknown> = { [nameField]: form.name.trim() };
    if (parent) body[parent.idField] = Number(form.parentId);
    try {
      const response = await fetch(`/api/products/${resource}${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setShowForm(false);
        showSnackbar('success', `${singular} ${editing ? 'updated' : 'created'}`);
        load();
      } else {
        // Refused saves are reported, not closed silently (PQ-05).
        showSnackbar('error', data.message || `Could not save the ${singular.toLowerCase()}`);
      }
    } catch (error) {
      console.error(`Error saving ${singular}:`, error);
      showSnackbar('error', `Network error while saving the ${singular.toLowerCase()}`);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  const columns = [
    { key: 'id', label: 'ID', enabled: true },
    ...(parent ? [{ key: parent.sortKey, label: parent.label, enabled: true, format: (row: any) => row[parent.relation]?.[parent.nameField] || '' }] : []),
    { key: nameField, label: `${singular} Name`, enabled: true }
  ];

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-2xl">
            {parent && (
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-2">Search by {parent.label}</label>
                <ClearableInput
                  type="text"
                  placeholder={`Search ${parent.label.toLowerCase()}...`}
                  value={parentSearch}
                  onChange={(e) => setParentSearch(e.target.value)}
                />
              </div>
            )}
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search {plural}</label>
              <ClearableInput
                type="text"
                placeholder={`Search ${plural}...`}
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              data={rows}
              // Every matching row, not just the page on screen (S-89).
              fetchAll={async () => {
                const params = new URLSearchParams(list.params);
                params.set('dropdown', 'true');
                const r = await fetch(`/api/products/${resource}?${params}`);
                if (!r.ok) throw new Error('Could not load the full list');
                return (await r.json()).data || [];
              }}
              columns={columns}
              config={{ title: config.report.title, fileName: `${config.report.fileName}_${getLocalDateString()}` }}
            />
            <button className="btn-primary" onClick={() => openForm(null)}>Add {singular}</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={list.pagination} shown={rows.length} noun={plural} />
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    {parent && (
                      <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort(parent.sortKey)}>
                        {parent.label} <SortIcon field={parent.sortKey} {...sortProps} />
                      </th>
                    )}
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort(nameField)}>
                      {singular} Name <SortIcon field={nameField} {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.id}>
                      <td>{list.serialNumber(i)}</td>
                      <td>{row.id}</td>
                      {parent && <td className="text-slate-300">{row[parent.relation]?.[parent.nameField] || 'N/A'}</td>}
                      <td className="font-medium text-white">{row[nameField]}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => openForm(row)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="text-center py-8 text-slate-400">No {plural} found.</div>
              )}
            </div>
            <ListPagination pagination={list.pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">
              {editing ? `Edit ${singular}` : `Add ${singular}`}
            </h2>
            <form onSubmit={submit}>
              {parent && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">{parent.label} *</label>
                  <SearchableSelect
                    options={parents.map((p) => ({ id: String(p.id), name: p.name }))}
                    selectedValue={form.parentId}
                    onSelectionChange={(value) => setForm((f) => ({ ...f, parentId: value || '' }))}
                    placeholder={`Select ${parent.label.toLowerCase()}...`}
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">{singular} Name *</label>
                <ClearableInput
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirming}
        title={editing ? `Update ${singular}` : `Add ${singular}`}
        message={editing ? `Save the changes to "${form.name.trim()}"?` : `Add the ${singular.toLowerCase()} "${form.name.trim()}"?`}
        confirmText={editing ? 'Update' : 'Add'}
        showLoading={saving}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
