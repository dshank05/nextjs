import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { PurchaseTable } from '../../components/transactions/PurchaseTable';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';

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
  total: number;
  notes?: string;
  invoice_date: number | string;
  status?: number;
  payment_status?: number;
  payment_mode?: number;
  fy: number;
  transport?: string;
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

export default function PurchasesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // AbortController ref for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'invoice_no', label: 'Invoice No', enabled: true },
    { key: 'vendor_name', label: 'Vendor Name', enabled: true },
    { key: 'total', label: 'Total Amount', enabled: true },
    { key: 'invoice_date', label: 'Invoice Date', enabled: true },
    { key: 'payment_status', label: 'Payment Status', enabled: true },
    { key: 'bill_reference', label: 'Bill Reference', enabled: true },
  ];

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  // Data states
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentFilters, setCurrentFilters] = useState<{
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
  }>({
    vendorFilter: '',
    statusFilter: 'all',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    uidFilter: ''
  });

  // Fetch purchases when pagination, search, or filters change
  useEffect(() => {
    fetchPurchases();
  }, [pagination.page, pagination.limit, searchTerm, currentFilters]);

  // Listen for broadcast messages to refresh data when purchases are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Purchase ${msg.type} in another tab, refreshing data...`);
        fetchPurchases();
      }
    });

    return unsubscribe;
  }, []);

  // Cleanup: Cancel any pending requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchPurchases = async () => {
    try {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        // Add filter parameters
        vendor: currentFilters.vendorFilter,
        status: currentFilters.statusFilter,
        startDate: currentFilters.dateFrom,
        endDate: currentFilters.dateTo,
        amountMin: currentFilters.amountMin,
        amountMax: currentFilters.amountMax,
        uid: currentFilters.uidFilter
      });

      const response = await fetch(`/api/purchases?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch purchases');
      }

      const data = await response.json();

      // Transform API data to match our interface
      const transformedPurchases: Purchase[] = (data.purchases || []).map((purchase: any) => ({
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        select_vendor: purchase.select_vendor,
        vendor_name: purchase.vendor_name,
        vendor_address: purchase.vendor_address,
        vendor_gstin: purchase.vendor_gstin,
        items_total: purchase.items_total,
        freight: purchase.freight,
        total_taxable_value: purchase.total_taxable_value,
        taxrate: purchase.taxrate,
        total_cgst: purchase.total_cgst,
        total_sgst: purchase.total_sgst,
        total_igst: purchase.total_igst,
        total_tax: purchase.total_tax,
        total: purchase.total,
        notes: purchase.notes,
        invoice_date: purchase.invoice_date,
        status: purchase.status,
        payment_status: purchase.payment_status,
        payment_mode: purchase.payment_mode,
        fy: purchase.fy,
        transport: purchase.transport,
        item_count: purchase.item_count,
        formattedDate: purchase.formattedDate,
        bill_reference: purchase.bill_reference,
        return_status: purchase.return_status,
        type: 'purchase',
        customer_vendor_name: purchase.vendor_name,
        customer_vendor_address: purchase.vendor_address,
        customer_vendor_gstin: purchase.vendor_gstin
      }));

      setPurchases(transformedPurchases);
      setPagination(data.pagination);
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Purchase fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch purchases:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Purchase Report',
        fileName: `Purchase_Report_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, purchases, config);
    } else {
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    const exportData = purchases.map(purchase => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = purchase.id;
            break;
          case 'invoice_no':
            row['Invoice No'] = purchase.invoice_no;
            break;
          case 'vendor_name':
            row['Vendor Name'] = purchase.vendor_name || '';
            break;
          case 'total':
            row['Total Amount'] = purchase.total;
            break;
          case 'invoice_date':
            row['Invoice Date'] = purchase.formattedDate || purchase.invoice_date || '';
            break;
          case 'payment_status':
            row['Payment Status'] = purchase.payment_status === 1 ? 'Paid' : 'Unpaid';
            break;
          case 'bill_reference':
            row['Bill Reference'] = purchase.bill_reference || '';
            break;
        }
      });
      return row;
    });

    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Purchase Report',
      fileName: `Purchase_Report_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  // Handle return actions
  const handlePartialReturn = (transaction: Purchase) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0 || returnStatus === 1) {
      console.log('Starting partial return for purchase:', transaction.id);
      router.push(`/entry/purchasereturn-create?purchase=${transaction.id}&type=partial`);
    } else {
      alert('Full returns cannot be modified with partial returns. Use full return for fully returned purchases.');
    }
  };

  const handleReturnWholeOrder = (transaction: Purchase) => {
    console.log('Return whole order for purchase:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return;

    setProcessingReturn(true);
    try {
      // Call the purchase returns API to create a full return
      const response = await fetch('/api/purchase-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          purchase_id: selectedTransaction.id,
          return_type: 'purchase',
          full_return: true, // Flag for full return
          return_date: Math.floor(Date.now() / 1000), // Current timestamp
          notes: 'Full order return processed automatically'
        })
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`);
        // Refresh the data to update the table
        fetchPurchases();
      } else {
        const error = await response.json();
        showSnackbar('error', `Failed to process return: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred while processing return');
    } finally {
      setProcessingReturn(false);
      setShowReturnModal(false);
      setSelectedTransaction(null);
    }
  };

  const cancelReturnWholeOrder = () => {
    setShowReturnModal(false);
    setSelectedTransaction(null);
  };

  const handleFullReturn = (transaction: Purchase) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0) {
      handleReturnWholeOrder(transaction);
    } else {
      alert('Full returns are only available for purchases with no previous returns.');
    }
  };

  // Print individual purchase
  const handlePrintPurchase = (transaction: Purchase) => {
    console.log('Printing purchase:', transaction.id);
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for purchase ${transaction.invoice_no} will be implemented`);
  };

  // Handle filter application
  const handleApplyFilters = (filters: {
    vendorFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
  }) => {
    setCurrentFilters(filters);
    // Reset to first page when applying filters
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading purchases</div>
                <div className="text-red-300 text-sm">{error}</div>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <PurchaseTable
        purchases={purchases}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={handleExport}
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}} // Handled by Link in component
        onPrintDetails={handlePrintPurchase}
        onPartialReturn={handlePartialReturn}
        onFullReturn={handleFullReturn}
        actionButton={
          <a
            href="/purchases/create"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Add Purchase
          </a>
        }
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_vendor_name})?

This will return all items in the purchase order and cannot be undone.`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmReturnWholeOrder}
        onCancel={cancelReturnWholeOrder}
      />

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />
    </div>
  );
}
