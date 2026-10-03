import React, { useState } from 'react';
import Link from 'next/link';
import { Eye, Trash2 } from 'lucide-react';
import { DateRangeFilter } from '../common/DateRangeFilter';
import { SearchableSelect } from '../common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';
import { ListPagination, ListSummary, SortIcon } from '../common/ListPagination';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';
import { useCustomers } from '../../hooks/useCustomers';
import { getLocalDateString } from '../../lib/date-utils';
import type { SaleBillRow, SaleKind } from '../../types/sales';
import type { PaginationState } from '../../hooks/useListQuery';

/**
 * The sale and Invoice C list - one table for both kinds (PurchaseTable's shape).
 *
 * Controlled: the page owns and persists the filters; this reports a change as a
 * patch. The two tables it replaces each kept a private copy of the filters and
 * resent subsets of it, so changing the status dropped every other filter, a
 * delete refresh dropped most of them (PU-37 twin), and on Invoice C four filters
 * were sent under names nothing read and then wiped themselves (SA-20, SA-25).
 */

export interface SaleListFilterState {
  customerFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  uidFilter: string;
  billReference: string;
  itemCount: string;
  paymentMode: string;
  total: string;
  totalTax: string;
  packingForwardingTotal: string;
  notes: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export const EMPTY_SALE_FILTERS: SaleListFilterState = {
  customerFilter: '',
  statusFilter: 'all',
  dateFrom: '',
  dateTo: '',
  uidFilter: '',
  billReference: '',
  itemCount: '',
  paymentMode: '',
  total: '',
  totalTax: '',
  packingForwardingTotal: '',
  notes: '',
  sortBy: 'invoice_date',
  sortOrder: 'desc'
};

const KIND = {
  sale: { noun: 'sales', title: 'Sale', view: '/sale/view', api: '/api/sales', report: 'Sales_Report' },
  salex: { noun: 'Invoice C bills', title: 'Invoice C', view: '/salex/view', api: '/api/salex', report: 'Invoice_C_Report' }
} as const;

interface Props {
  kind: SaleKind;
  rows: SaleBillRow[];
  pagination: PaginationState;
  loading: boolean;
  filters: SaleListFilterState;
  onFiltersChange: (patch: Partial<SaleListFilterState>) => void;
  onPageChange: (page: number) => void;
  onDeleted: (row: SaleBillRow) => void;
  fetchAllForExport?: () => Promise<SaleBillRow[]>;
  actionButton?: React.ReactNode;
}

const formatDate = (value: number | string) => {
  const n = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? parseInt(String(value), 10) : NaN;
  const d = Number.isFinite(n) ? new Date(n * 1000) : new Date(String(value));
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN');
};

const statusBadge = (status?: number) =>
  status === 1 ? <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>
    : status === 2 ? <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>
      : <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;

const modeText = (mode?: number) => (mode === 0 ? 'Cash' : mode === 1 ? 'Bank' : 'N/A');
const rupees = (n?: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

type SortField = 'invoice_no' | 'bill_reference' | 'customer_name' | 'item_count' | 'total' | 'total_tax'
  | 'packing_forwarding_total' | 'invoice_date' | 'payment_mode' | 'payment_status' | 'notes';

export const SaleBillTable: React.FC<Props> = ({
  kind, rows, pagination, loading, filters, onFiltersChange, onPageChange, onDeleted, fetchAllForExport, actionButton
}) => {
  const K = KIND[kind];
  const taxFree = kind === 'salex';
  const { showSnackbar } = useSnackbar();
  // Every customer (useCustomers asks with dropdown=true), not the first fifty.
  const { data: customers = [] } = useCustomers();
  const [toDelete, setToDelete] = useState<SaleBillRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sort = (field: SortField) => onFiltersChange({
    sortBy: field,
    sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : 'asc'
  });

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`${K.api}/${toDelete.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        showSnackbar('success', `${K.title} ${toDelete.invoice_no} deleted successfully`);
        onDeleted(toDelete);
      } else {
        showSnackbar('error', body.message || `Failed to delete ${K.title}`);
      }
    } catch {
      showSnackbar('error', `Failed to delete ${K.title}`);
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const th = (field: SortField, label: string) => (
    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => sort(field)}>
      {label} <SortIcon field={field} sortBy={filters.sortBy} sortOrder={filters.sortOrder} />
    </th>
  );
  const labelCls = 'block text-sm font-medium text-slate-300 mb-2';
  const exportRows = (list: SaleBillRow[], offset: number) =>
    list.map((r, i) => ({ ...r, serialNumber: offset + i + 1, invoice_date: formatDate(r.invoice_date) }));

  return (
    <div className="card">
      <div className="flex items-center justify-end gap-2 mb-4">
        <ExportMenu
          data={exportRows(rows, (pagination.page - 1) * pagination.limit)}
          fetchAll={fetchAllForExport ? async () => exportRows(await fetchAllForExport(), 0) : undefined}
          columns={[
            { key: 'serialNumber', label: 'S.N', enabled: true },
            { key: 'invoice_no', label: 'Invoice No', enabled: true },
            { key: 'bill_reference', label: 'Bill Reference', enabled: true },
            { key: 'customer_name', label: 'Customer', enabled: true },
            { key: 'item_count', label: 'Items', enabled: true },
            { key: 'total', label: 'Total', enabled: true },
            ...(taxFree ? [] : [{ key: 'total_tax', label: 'Tax', enabled: true }]),
            { key: 'packing_forwarding_total', label: 'P/F', enabled: true },
            { key: 'invoice_date', label: 'Date', enabled: true },
            { key: 'payment_mode', label: 'Payment Mode', enabled: true },
            { key: 'payment_status', label: 'Payment Status', enabled: true },
            { key: 'notes', label: 'Notes', enabled: true }
          ]}
          config={{ title: `${K.title} Report`, fileName: `${K.report}_${getLocalDateString()}` }}
        />
        {actionButton && <div className="flex-shrink-0">{actionButton}</div>}
      </div>

      <div className="grid grid-cols-11 gap-4 mb-4">
        <div className="flex-1">
          <label className={labelCls}>Invoice No</label>
          <ClearableInput type="number" placeholder="Enter invoice no" min="1" value={filters.uidFilter} onChange={(e) => onFiltersChange({ uidFilter: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Bill Reference</label>
          <ClearableInput type="text" placeholder="Enter bill reference" value={filters.billReference} onChange={(e) => onFiltersChange({ billReference: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Customer</label>
          <SearchableSelect
            options={[{ id: '', name: 'All Customers' }, { id: '0', name: 'Other' }, ...customers.map((c: any) => ({ id: String(c.id), name: c.billing_name }))]}
            selectedValue={filters.customerFilter}
            onSelectionChange={(v) => onFiltersChange({ customerFilter: v || '' })}
            placeholder="Select customer..."
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Items</label>
          <ClearableInput type="number" placeholder="Item count" min="0" value={filters.itemCount} onChange={(e) => onFiltersChange({ itemCount: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Total</label>
          <ClearableInput type="number" placeholder="Total amount" min="0" value={filters.total} onChange={(e) => onFiltersChange({ total: e.target.value })} />
        </div>
        {taxFree ? (
          <div className="flex-1">
            <label className={labelCls}>Notes</label>
            <ClearableInput type="text" placeholder="Notes" value={filters.notes} onChange={(e) => onFiltersChange({ notes: e.target.value })} />
          </div>
        ) : (
          <div className="flex-1">
            <label className={labelCls}>Tax Amount</label>
            <ClearableInput type="number" placeholder="Tax amount" min="0" value={filters.totalTax} onChange={(e) => onFiltersChange({ totalTax: e.target.value })} />
          </div>
        )}
        <div className="flex-1">
          <label className={labelCls}>Date</label>
          <DateRangeFilter startDate={filters.dateFrom} endDate={filters.dateTo} onDateChange={(start, end) => onFiltersChange({ dateFrom: start, dateTo: end })} placeholder="Select date range..." />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Payment Mode</label>
          <SearchableSelect
            options={[{ id: '', name: 'All Modes' }, { id: '0', name: 'Cash' }, { id: '1', name: 'Bank' }]}
            selectedValue={filters.paymentMode}
            onSelectionChange={(v) => onFiltersChange({ paymentMode: v || '' })}
            placeholder="Select payment mode..."
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Payment Status</label>
          <SearchableSelect
            // One value, stored and sent: the API's own status codes.
            options={[{ id: 'all', name: 'All Status' }, { id: '1', name: 'Paid' }, { id: '2', name: 'Partial Paid' }, { id: '0', name: 'Unpaid' }]}
            selectedValue={filters.statusFilter || 'all'}
            onSelectionChange={(v) => onFiltersChange({ statusFilter: v || 'all' })}
            placeholder="Select status..."
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>P/F</label>
          <ClearableInput type="number" placeholder="P/F total" min="0" value={filters.packingForwardingTotal} onChange={(e) => onFiltersChange({ packingForwardingTotal: e.target.value })} />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => onFiltersChange({ ...EMPTY_SALE_FILTERS, sortBy: filters.sortBy, sortOrder: filters.sortOrder })}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <ListSummary pagination={pagination} shown={rows.length} noun={K.noun} />

      <div className="overflow-x-auto relative">
        {loading && (
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
              {th('customer_name', 'Customer')}
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
              const hasReturns = (row.return_status || 0) > 0;
              return (
                <tr key={row.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{row.invoice_no}</td>
                  <td className="text-slate-300">{row.bill_reference || 'N/A'}</td>
                  <td className="text-slate-300"><div className="font-medium">{row.customer_name || 'N/A'}</div></td>
                  <td className="text-slate-300">
                    <div className="flex items-center gap-1">
                      <span>{row.item_count || 0}</span>
                      <span className="text-xs text-slate-400">items</span>
                    </div>
                  </td>
                  <td className="text-slate-300 font-semibold">{rupees(row.total)}</td>
                  {!taxFree && <td className="text-slate-300">{rupees(row.total_tax)}</td>}
                  <td className="text-slate-300">{rupees(row.packing_forwarding_total)}</td>
                  <td className="text-slate-300">{formatDate(row.invoice_date)}</td>
                  <td className="text-slate-300">{modeText(row.payment_mode)}</td>
                  <td>{statusBadge(row.payment_status)}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Link href={`${K.view}/${row.id}`} title={`View ${K.title}`} className="btn-icon text-slate-300">
                        <Eye className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => setToDelete(row)}
                        disabled={hasReturns}
                        title={hasReturns ? 'Cannot delete - this bill has returns' : `Delete ${K.title}`}
                        className={`btn-icon text-red-400 hover:text-red-500 ${hasReturns ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No {K.noun} found with the current filters.</div>
        )}
      </div>

      <ListPagination pagination={pagination} onPageChange={onPageChange} />

      <ConfirmationModal
        isOpen={toDelete !== null}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={`Delete ${K.title}`}
        message={toDelete
          ? `Are you sure you want to delete ${K.title.toLowerCase()} ${toDelete.invoice_no}? Its quantities go back into stock, and its ledger entries and payment allocations are removed with it. This cannot be undone.`
          : ''}
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={deleting}
        loadingText="Deleting..."
      />
    </div>
  );
};
