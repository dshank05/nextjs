import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUp, ArrowDown, Eye, Printer, FileMinus, Undo2, Trash2 } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ExportMenu } from '../common';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';

interface PurchaseItem {
  id: number;
  invoice_no: number;
  name_of_product: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  unit?: number;
  rate: number;
  subtotal: number;
  fy: number;
  invoice_date: number | string;
}

interface Purchase {
  id: number;
  invoice_no: number;
  select_vendor?: number;
  vendor_name?: string;
  vendor_address?: string;
  vendor_gstin?: string;
  items_total: number;
  freight?: number;
  total_taxable_value: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  packing_forwarding_total?: number;
  total: number;
  notes?: string;
  invoice_date: number | string;
  status?: number;
  payment_status?: number;
  payment_mode?: number;
  fy: number;
  transport?: string;
  items?: PurchaseItem[];
  item_count?: number;
  formattedDate?: string;
  bill_reference?: string;
  return_status?: number;
  type?: 'purchase';
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  vendors: { id: string; name?: string; vendor_name?: string; gstin?: string; contact?: string; email?: string }[];
}

interface PurchaseTableProps {
  purchases: Purchase[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
  actionButton?: React.ReactNode;
  onExport?: (exportType: 'excel' | 'pdf') => void;
  onApplyFilters?: (filters: {
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    billReference: string;
    itemCount: string;
    paymentMode: string;
    total: string;
    totalTax: string;
    packingForwardingTotal: string;
    sortBy: string;
    sortOrder: string;
  }) => void;
  onViewDetails?: (purchase: Purchase) => void;
  onPrintDetails?: (purchase: Purchase) => void;
  onPartialReturn?: (purchase: Purchase) => void;
  onFullReturn?: (purchase: Purchase) => void;
  // Add sort state props to make this a controlled component
  sortBy?: SortField;
  sortOrder?: SortOrder;
  initialFilters?: {
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
    billReference: string;
    itemCount: string;
    paymentMode: string;
    total: string;
    totalTax: string;
    packingForwardingTotal?: string;
  };
}

type SortField = 'invoice_no' | 'vendor_name' | 'total' | 'invoice_date' | 'payment_status' | 'bill_reference' | 'item_count' | 'payment_mode' | 'total_tax';
type SortOrder = 'asc' | 'desc';

export const PurchaseTable: React.FC<PurchaseTableProps> = ({
  purchases,
  pagination,
  loading,
  onPageChange,
  searchTerm,
  onSearchChange,
  itemsPerPage,
  onItemsPerPageChange,
  actionButton,
  onExport,
  onApplyFilters,
  onViewDetails,
  onPrintDetails,
  onPartialReturn,
  onFullReturn,
  sortBy: propSortBy = 'invoice_no',
  sortOrder: propSortOrder = 'desc',
  initialFilters
}) => {
  // Filter states - consolidated into single object - initialize with initialFilters if provided
  const [filters, setFilters] = useState({
    vendorFilter: initialFilters?.vendorFilter || '',
    statusFilter: initialFilters?.statusFilter || 'all',
    dateFrom: initialFilters?.dateFrom || '',
    dateTo: initialFilters?.dateTo || '',
    amountMin: initialFilters?.amountMin || '',
    amountMax: initialFilters?.amountMax || '',
    uidFilter: initialFilters?.uidFilter || '',
    billReference: initialFilters?.billReference || '',
    itemCount: initialFilters?.itemCount || '',
    paymentMode: initialFilters?.paymentMode || '',
    total: initialFilters?.total || '',
    totalTax: initialFilters?.totalTax || '',
    packingForwardingTotal: initialFilters?.packingForwardingTotal || ''
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ vendors: [] });

  // Delete functionality
  const { showSnackbar } = useSnackbar();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Use props for sorting state (controlled component)
  const sortBy = propSortBy;
  const sortOrder = propSortOrder;

  const handleDeleteClick = (purchase: Purchase) => {
    setPurchaseToDelete(purchase);
    setDeleteModalOpen(true);
  };

  const handleCancelDelete = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setDeleteModalOpen(false);
    setPurchaseToDelete(null);
    setDeleting(false);
  };

  const handleConfirmDelete = async () => {
    if (!purchaseToDelete) return;

    setDeleting(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/purchases/${purchaseToDelete.id}`, {
        method: 'DELETE',
        signal: abortControllerRef.current.signal
      });

      if (response.ok) {
        showSnackbar('success', `Purchase ${purchaseToDelete.invoice_no} deleted successfully`);
        setDeleteModalOpen(false);
        setPurchaseToDelete(null);
        
        // Refresh the table
        if (onApplyFilters) {
          onApplyFilters({
            ...filters,
            sortBy,
            sortOrder
          });
        }
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to delete purchase');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        showSnackbar('error', 'Failed to delete purchase');
        console.error('Delete error:', error);
      }
    } finally {
      setDeleting(false);
      abortControllerRef.current = null;
    }
  };

  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Update filters when initialFilters change
  useEffect(() => {
    if (initialFilters) {
      setFilters({
        vendorFilter: initialFilters.vendorFilter || '',
        statusFilter: initialFilters.statusFilter || 'all',
        dateFrom: initialFilters.dateFrom || '',
        dateTo: initialFilters.dateTo || '',
        amountMin: initialFilters.amountMin || '',
        amountMax: initialFilters.amountMax || '',
        uidFilter: initialFilters.uidFilter || '',
        billReference: initialFilters.billReference || '',
        itemCount: initialFilters.itemCount || '',
        paymentMode: initialFilters.paymentMode || '',
        total: initialFilters.total || '',
        totalTax: initialFilters.totalTax || '',
        packingForwardingTotal: initialFilters.packingForwardingTotal || ''
      });
    }
  }, [initialFilters]);

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setFilterOptions({ vendors: data.vendors || [] });
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const clearFilters = () => {
    onSearchChange('');
    setFilters({
      vendorFilter: '',
      statusFilter: 'all',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
      uidFilter: '',
      billReference: '',
      itemCount: '',
      paymentMode: '',
      total: '',
      totalTax: '',
      packingForwardingTotal: ''
    });
  };

  // Sorting logic - now uses backend sorting
  const handleSort = (field: SortField) => {
    const newSortOrder = sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc';

    console.log('🔄 PurchaseTable handleSort - Before:', { sortBy, sortOrder });
    console.log('🔄 PurchaseTable handleSort - After:', { newSortBy: field, newSortOrder });

    // Apply filters with new sort parameters (parent will update props)
    if (onApplyFilters) {
      const filterParams = {
        vendorFilter: filters.vendorFilter,
        statusFilter: filters.statusFilter,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        uidFilter: filters.uidFilter,
        billReference: filters.billReference,
        itemCount: filters.itemCount,
        paymentMode: filters.paymentMode,
        total: filters.total,
        totalTax: filters.totalTax,
        packingForwardingTotal: filters.packingForwardingTotal,
        sortBy: field,
        sortOrder: newSortOrder
      };
      console.log('📤 PurchaseTable calling onApplyFilters with:', filterParams);
      onApplyFilters(filterParams);
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const formatDate = (dateValue: number | string) => {
    if (typeof dateValue === 'string') {
      if (/^\d+$/.test(dateValue)) {
        const timestamp = parseInt(dateValue);
        if (timestamp > 1000000000) {
          return new Date(timestamp * 1000).toLocaleDateString('en-IN');
        }
      }
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN');
      }
      return 'Invalid Date';
    }
    return new Date(dateValue * 1000).toLocaleDateString('en-IN');
  };

  const getStatusBadge = (status?: number) => {
    // Handle all three payment statuses: 0 (Unpaid), 1 (Paid), 2 (Partially Paid)
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
    } else if (status === 2) {
      return <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>;
    } else {
      return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
    }
  };

  const getPaymentModeText = (mode?: number) => {
    switch (mode) {
      case 0: return 'Cash';
      case 1: return 'Bank';
      default: return 'N/A';
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-end gap-2 mb-4">
        <div className="flex items-center gap-2">
          <ExportMenu
            data={purchases}
            columns={[
              { key: 'id', label: 'ID', enabled: true },
              { key: 'invoice_no', label: 'Invoice No', enabled: true },
              { key: 'bill_reference', label: 'Bill Reference', enabled: true },
              { key: 'customer_vendor_name', label: 'Vendor Name', enabled: true },
              { key: 'item_count', label: 'Items Qty', enabled: true },
              { key: 'total', label: 'Total', enabled: true },
              { key: 'invoice_date', label: 'Date', enabled: true },
              { key: 'payment_mode', label: 'Payment Mode', enabled: true },
              { key: 'payment_status', label: 'Payment Status', enabled: true },
              { key: 'packing_forwarding_total', label: 'P/F', enabled: true },
              { key: 'notes', label: 'Notes', enabled: true },
            ]}
            config={{
              title: 'Purchase Report',
              fileName: `Purchase_Report_${new Date().toISOString().split('T')[0]}`
            }}
          />
          {actionButton && (
            <div className="flex-shrink-0">
              {actionButton}
            </div>
          )}
        </div>
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-10 gap-4 mb-4">
        {/* Invoice No Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Invoice No</label>
          <ClearableInput
            type="number"
            placeholder="Enter invoice no"
            value={filters.uidFilter}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, uidFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  uidFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="1"
          />
        </div>

        {/* Bill Reference Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Bill Reference</label>
          <ClearableInput
            type="text"
            placeholder="Enter bill reference"
            value={filters.billReference}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, billReference: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  billReference: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
          />
        </div>

        {/* Vendor Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Vendor</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Vendors' },
              ...filterOptions.vendors.map(vendor => ({
                id: vendor.id,
                name: vendor.name || vendor.vendor_name || ''
              }))
            ]}
            selectedValue={filters.vendorFilter}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setFilters(prev => ({ ...prev, vendorFilter: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  vendorFilter: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select vendor..."
          />
        </div>

        {/* Item Count Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Items Qty</label>
          <ClearableInput
            type="number"
            placeholder="Enter item count"
            value={filters.itemCount}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, itemCount: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  itemCount: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* Total Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Total</label>
          <ClearableInput
            type="number"
            placeholder="Enter total amount"
            value={filters.total}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, total: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  total: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div>

        {/* <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Tax Amount</label>
          <ClearableInput
            type="number"
            placeholder="Enter total tax"
            value={filters.totalTax}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, totalTax: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  totalTax: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
          />
        </div> */}

        {/* Date Range Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
          <DateRangeFilter
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onDateChange={(start, end) => {
              setFilters(prev => ({ ...prev, dateFrom: start, dateTo: end }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  dateFrom: start,
                  dateTo: end,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Payment Mode Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Modes' },
              { id: '0', name: 'Cash' },
              { id: '1', name: 'Bank' }
            ]}
            selectedValue={filters.paymentMode}
            onSelectionChange={(value) => {
              const newValue = value || '';
              setFilters(prev => ({ ...prev, paymentMode: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  paymentMode: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select payment mode..."
          />
        </div>

        {/* Status Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Payment Status</label>
          <SearchableSelect
            key={`status-${filters.statusFilter}`}
            options={[
              { id: 'all', name: 'All Status' },
              { id: 'paid', name: 'Paid' },
              { id: 'partial', name: 'Partial Paid' },
              { id: 'unpaid', name: 'Unpaid' }
            ]}
            selectedValue={filters.statusFilter}
            onSelectionChange={(value) => {
              const newValue = value || 'all';
              setFilters(prev => ({ ...prev, statusFilter: newValue }));
              // Auto-apply filter - convert frontend values to API values
              if (onApplyFilters) {
                let apiStatusValue = '';
                if (newValue === 'paid') {
                  apiStatusValue = '1';
                } else if (newValue === 'partial') {
                  apiStatusValue = '2';
                } else if (newValue === 'unpaid') {
                  apiStatusValue = '0';
                } else if (newValue === 'all') {
                  apiStatusValue = '';
                }
                onApplyFilters({
                  ...filters,
                  statusFilter: apiStatusValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            placeholder="Select status..."
          />
        </div>

        {/* Packing/Forwarding Total Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">P/F</label>
          <ClearableInput
            type="number"
            placeholder="Enter P/F total"
            value={filters.packingForwardingTotal}
            onChange={(e) => {
              const newValue = e.target.value;
              setFilters(prev => ({ ...prev, packingForwardingTotal: newValue }));
              // Auto-apply filter
              if (onApplyFilters) {
                onApplyFilters({
                  ...filters,
                  packingForwardingTotal: newValue,
                  sortBy,
                  sortOrder
                });
              }
            }}
            min="0"
            
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() => {
              clearFilters();
              // Apply cleared filters
              if (onApplyFilters) {
                onApplyFilters({
                  vendorFilter: '',
                  statusFilter: 'all',
                  dateFrom: '',
                  dateTo: '',
                  amountMin: '',
                  amountMax: '',
                  uidFilter: '',
                  billReference: '',
                  itemCount: '',
                  paymentMode: '',
                  total: '',
                  totalTax: '',
                  packingForwardingTotal: '',
                  sortBy,
                  sortOrder
                });
              }
            }}
            className="btn-secondary px-4 py-2"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table Section */}
      {pagination && (
        <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
          <div>Showing {purchases.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} purchases</div>
          <div>Page {pagination.page} of {pagination.totalPages}</div>
        </div>
      )}

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
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_no')}>
                Invoice No {getSortIcon('invoice_no')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('bill_reference')}>
                Bill Reference {getSortIcon('bill_reference')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('vendor_name')}>
                Vendor {getSortIcon('vendor_name')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('item_count')}>
                Items Qty {getSortIcon('item_count')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total')}>
                Total {getSortIcon('total')}
              </th>
              {/* <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('total_tax')}>
                Tax Amount {getSortIcon('total_tax')}
              </th> */}
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('invoice_date')}>
                Date {getSortIcon('invoice_date')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_mode')}>
                Payment Mode {getSortIcon('payment_mode')}
              </th>
              <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('payment_status')}>
                Payment Status {getSortIcon('payment_status')}
              </th>
              {/* <th>Return Status</th> */}
              <th>P/F</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase, idx) => (
              <tr key={purchase.id}>
                <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                <td className="font-medium text-white">
                  {purchase.invoice_no}
                </td>
                <td className="text-slate-300">
                  <div className="flex flex-col">
                    <span className="text-white font-medium">{purchase.bill_reference || 'N/A'}</span>
                    {(purchase as any).bill_reference_date && (purchase as any).bill_reference_date !== '-' && (
                      <span className="text-slate-400 text-xs">{(purchase as any).bill_reference_date}</span>
                    )}
                  </div>
                </td>
                <td className="text-slate-300">
                  <div className="font-medium">{purchase.customer_vendor_name || purchase.vendor_name || 'N/A'}</div>
                </td>
                <td className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <span>{purchase.item_count || purchase.items?.length || 0}</span>
                    <span className="text-xs text-slate-400">items</span>
                  </div>
                </td>
                <td className="text-slate-300 font-semibold">₹{purchase.total?.toLocaleString('en-IN')}</td>
                {/* <td className="text-slate-300">₹{(purchase.total_tax || 0)?.toLocaleString('en-IN')}</td> */}
                <td className="text-slate-300">{formatDate(purchase.invoice_date)}</td>
                <td className="text-slate-300">{getPaymentModeText(purchase.payment_mode)}</td>
                <td>{getStatusBadge(purchase.payment_status)}</td>
                {/* <td>
                  {purchase.return_status === 2 ? (
                    <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Fully Returned</span>
                  ) : purchase.return_status === 1 ? (
                    <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial Return</span>
                  ) : (
                    <span className="px-2 py-1 bg-slate-600 text-white text-xs rounded-full">No Returns</span>
                  )}
                </td> */}
                <td className="text-slate-300">₹{(purchase.packing_forwarding_total)?.toLocaleString('en-IN') || '0'}</td>
                <td>
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/purchases/view/${purchase.id}`}
                      title="View Purchase Details"
                      className="btn-icon text-slate-300"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                    {onPrintDetails && (
                      <button
                        onClick={() => onPrintDetails(purchase)}
                        title="Print Purchase Details"
                        className="btn-icon text-slate-300 hover:text-blue-400"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {onPartialReturn && (
                      <button
                        onClick={() => onPartialReturn(purchase)}
                        title="Create Partial Return"
                        className={`btn-icon text-blue-400 hover:text-blue-300 ${(purchase.return_status || 0) > 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(purchase.return_status || 0) > 1}
                      >
                        <FileMinus className="w-4 h-4" />
                      </button>
                    )}
                    {onFullReturn && (
                      <button
                        onClick={() => onFullReturn(purchase)}
                        title="Create Full Return"
                        className={`btn-icon text-green-400 hover:text-green-300 ${(purchase.return_status || 0) !== 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={(purchase.return_status || 0) !== 0}
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteClick(purchase)}
                      title="Delete Purchase"
                      className="btn-icon text-red-400 hover:text-red-500"
                      disabled={(purchase.return_status || 0) > 0}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {purchases.length === 0 && !loading && (
          <div className="text-center py-8 text-slate-400">No purchases found with the current filters.</div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
          <button onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
          <div className="flex space-x-2">
            {pagination.page > 3 && <> <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
            {getPageNumbers().map(p => <button key={p} onClick={() => onPageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
            {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
          </div>
          <button onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Purchase"
        message={
          purchaseToDelete
            ? `Are you sure you want to delete purchase ${purchaseToDelete.invoice_no}? This action is irreversible and will restore stock quantities, create reversal entries in the ledger, remove all related allocations, and update vendor balance. This operation cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        showLoading={deleting}
        loadingText="Deleting..."
      />
    </div>
  );
};
