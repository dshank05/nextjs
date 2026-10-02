import React, { useState } from 'react';
import Link from 'next/link';
import { Eye, Trash2 } from 'lucide-react';
import { DateRangeFilter } from '../common/DateRangeFilter';
import { SearchableSelect } from '../common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';
import { ListPagination, ListSummary, SortIcon } from '../common/ListPagination';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';
import { useVendors } from '../../hooks/useVendors';
import { getLocalDateString } from '../../lib/date-utils';
import type { Purchase } from '../../types/purchases';
import type { PaginationState } from '../../hooks/useListQuery';

/**
 * The purchase list: filters, table, paging, delete.
 *
 * Controlled - the page owns the filters (and persists them); this component
 * reports a change as a patch. It used to keep its own copy of the filters
 * and resend the whole set on every change, with the status select storing one
 * value ('paid') and sending another ('1'), so a restored status showed blank.
 */

export interface PurchaseListFilters {
  vendorFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  uidFilter: string;
  billReference: string;
  itemCount: string;
  paymentMode: string;
  total: string;
  packingForwardingTotal: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export const EMPTY_PURCHASE_FILTERS: PurchaseListFilters = {
  vendorFilter: '',
  statusFilter: 'all',
  dateFrom: '',
  dateTo: '',
  uidFilter: '',
  billReference: '',
  itemCount: '',
  paymentMode: '',
  total: '',
  packingForwardingTotal: '',
  sortBy: 'invoice_no',
  sortOrder: 'asc'
};

interface Props {
  purchases: Purchase[];
  pagination: PaginationState;
  loading: boolean;
  filters: PurchaseListFilters;
  onFiltersChange: (patch: Partial<PurchaseListFilters>) => void;
  onPageChange: (page: number) => void;
  /** After a delete succeeds, so the page can refetch. */
  onDeleted: (purchase: Purchase) => void;
  /** Every matching row, for export (S-89 class). */
  fetchAllForExport?: () => Promise<Purchase[]>;
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

type SortField = 'invoice_no' | 'bill_reference' | 'vendor_name' | 'item_count' | 'total' | 'invoice_date' | 'payment_mode' | 'payment_status';

export const PurchaseTable: React.FC<Props> = ({
  purchases, pagination, loading, filters, onFiltersChange, onPageChange, onDeleted, fetchAllForExport, actionButton
}) => {
  const { showSnackbar } = useSnackbar();
  // Every vendor, not the first page of fifty.
  const { data: vendors = [] } = useVendors();
  const [toDelete, setToDelete] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sort = (field: SortField) => onFiltersChange({
    sortBy: field,
    sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : 'asc'
  });

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/purchases/${toDelete.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        showSnackbar('success', `Purchase ${toDelete.invoice_no} deleted successfully`);
        onDeleted(toDelete);
      } else {
        showSnackbar('error', body.message || 'Failed to delete purchase');
      }
    } catch {
      showSnackbar('error', 'Failed to delete purchase');
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
  const exportRows = (rows: Purchase[], offset: number) =>
    rows.map((p, i) => ({ ...p, serialNumber: offset + i + 1, invoice_date: formatDate(p.invoice_date) }));

  return (
    <div className="card">
      <div className="flex items-center justify-end gap-2 mb-4">
        <ExportMenu
          data={exportRows(purchases, (pagination.page - 1) * pagination.limit)}
          fetchAll={fetchAllForExport ? async () => exportRows(await fetchAllForExport(), 0) : undefined}
          columns={[
            { key: 'serialNumber', label: 'S.N', enabled: true },
            { key: 'invoice_no', label: 'Invoice No', enabled: true },
            { key: 'bill_reference', label: 'Bill Reference', enabled: true },
            { key: 'customer_vendor_name', label: 'Vendor Name', enabled: true },
            { key: 'item_count', label: 'Items Qty', enabled: true },
            { key: 'total', label: 'Total', enabled: true },
            { key: 'invoice_date', label: 'Date', enabled: true },
            { key: 'payment_mode', label: 'Payment Mode', enabled: true },
            { key: 'payment_status', label: 'Payment Status', enabled: true },
            { key: 'packing_forwarding_total', label: 'P/F', enabled: true },
            { key: 'notes', label: 'Notes', enabled: true }
          ]}
          config={{ title: 'Purchase Report', fileName: `Purchase_Report_${getLocalDateString()}` }}
        />
        {actionButton && <div className="flex-shrink-0">{actionButton}</div>}
      </div>

      <div className="grid grid-cols-10 gap-4 mb-4">
        <div className="flex-1">
          <label className={labelCls}>Invoice No</label>
          <ClearableInput type="number" placeholder="Enter invoice no" min="1" value={filters.uidFilter} onChange={(e) => onFiltersChange({ uidFilter: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Bill Reference</label>
          <ClearableInput type="text" placeholder="Enter bill reference" value={filters.billReference} onChange={(e) => onFiltersChange({ billReference: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Vendor</label>
          <SearchableSelect
            options={[{ id: '', name: 'All Vendors' }, ...vendors.map(v => ({ id: String(v.id), name: v.vendor_name }))]}
            selectedValue={filters.vendorFilter}
            onSelectionChange={(v) => onFiltersChange({ vendorFilter: v || '' })}
            placeholder="Select vendor..."
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Items Qty</label>
          <ClearableInput type="number" placeholder="Enter item count" min="0" value={filters.itemCount} onChange={(e) => onFiltersChange({ itemCount: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Total</label>
          <ClearableInput type="number" placeholder="Enter total amount" min="0" value={filters.total} onChange={(e) => onFiltersChange({ total: e.target.value })} />
        </div>
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
          <ClearableInput type="number" placeholder="Enter P/F total" min="0" value={filters.packingForwardingTotal} onChange={(e) => onFiltersChange({ packingForwardingTotal: e.target.value })} />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => onFiltersChange({ ...EMPTY_PURCHASE_FILTERS, sortBy: filters.sortBy, sortOrder: filters.sortOrder })}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <ListSummary pagination={pagination} shown={purchases.length} noun="purchases" />

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
              {th('bill_reference', 'Bill Reference')}
              {th('vendor_name', 'Vendor')}
              {th('item_count', 'Items Qty')}
              {th('total', 'Total')}
              {th('invoice_date', 'Date')}
              {th('payment_mode', 'Payment Mode')}
              {th('payment_status', 'Payment Status')}
              <th>P/F</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase, idx) => {
              const hasReturns = (purchase.return_status || 0) > 0;
              return (
                <tr key={purchase.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="font-medium text-white">{purchase.invoice_no}</td>
                  <td className="text-slate-300">
                    <div className="flex flex-col">
                      <span className="text-white font-medium">{purchase.bill_reference || 'N/A'}</span>
                      {purchase.bill_reference_date && <span className="text-slate-400 text-xs">{purchase.bill_reference_date}</span>}
                    </div>
                  </td>
                  <td className="text-slate-300"><div className="font-medium">{purchase.vendor_name || 'N/A'}</div></td>
                  <td className="text-slate-300">
                    <div className="flex items-center gap-1">
                      <span>{purchase.item_count || 0}</span>
                      <span className="text-xs text-slate-400">items</span>
                    </div>
                  </td>
                  <td className="text-slate-300 font-semibold">₹{purchase.total?.toLocaleString('en-IN')}</td>
                  <td className="text-slate-300">{formatDate(purchase.invoice_date)}</td>
                  <td className="text-slate-300">{modeText(purchase.payment_mode)}</td>
                  <td>{statusBadge(purchase.payment_status)}</td>
                  <td className="text-slate-300">₹{(purchase.packing_forwarding_total || 0).toLocaleString('en-IN')}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <Link href={`/purchases/view/${purchase.id}`} title="View Purchase Details" className="btn-icon text-slate-300">
                        <Eye className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => setToDelete(purchase)}
                        disabled={hasReturns}
                        // The server refuses while any return exists (PU-02).
                        title={hasReturns ? 'Cannot delete - this purchase has returns' : 'Delete Purchase'}
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
        {purchases.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No purchases found with the current filters.</div>
        )}
      </div>

      <ListPagination pagination={pagination} onPageChange={onPageChange} />

      <ConfirmationModal
        isOpen={toDelete !== null}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete Purchase"
        message={toDelete
          ? `Are you sure you want to delete purchase ${toDelete.invoice_no}? This will take its quantities back out of stock, remove its ledger entries and payment allocations, and update the vendor balance. This cannot be undone.`
          : ''}
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={deleting}
        loadingText="Deleting..."
      />
    </div>
  );
};
