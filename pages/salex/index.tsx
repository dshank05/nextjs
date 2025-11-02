import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { SalexTable } from '../../components/transactions/SalexTable';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';

interface Salex {
  id: number;
  invoice_no: number;
  select_customer?: number;
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
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
  bill_reference?: string;
  invoice_date: number | string;
  status?: number;
  payment_status?: number;
  payment_mode?: number;
  fy: number;
  mode?: number;
  type?: 'salex';
  item_count?: number;
  formattedDate?: string;
  return_status?: number;
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

export default function SalexPage() {
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
    { key: 'customer_name', label: 'Customer Name', enabled: true },
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
  const [salex, setSalex] = useState<Salex[]>([]);
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
    customerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    uidFilter: string;
  }>({
    customerFilter: '',
    statusFilter: 'all',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    uidFilter: ''
  });

  // Fetch salex when pagination, search, or filters change
  useEffect(() => {
    fetchSalex();
  }, [pagination.page, pagination.limit, searchTerm, currentFilters]);

  // Listen for broadcast messages to refresh data when salex are created/updated/deleted in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'salex' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Salex ${msg.type} in another tab, refreshing data...`);
        fetchSalex();
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

  const fetchSalex = async () => {
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
        customer: currentFilters.customerFilter,
        status: currentFilters.statusFilter,
        startDate: currentFilters.dateFrom,
        endDate: currentFilters.dateTo,
        amountMin: currentFilters.amountMin,
        amountMax: currentFilters.amountMax,
        uid: currentFilters.uidFilter
      });

      const response = await fetch(`/api/salex?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch salex');
      }

      const data = await response.json();

      // Transform API data to match our interface
      const transformedSalex: Salex[] = (data.salex || []).map((salexItem: any) => ({
        id: salexItem.id,
        invoice_no: salexItem.invoice_no,
        select_customer: salexItem.select_customer,
        customer_name: salexItem.customer_name,
        customer_address: salexItem.customer_address,
        customer_gstin: salexItem.customer_gstin,
        items_total: salexItem.items_total,
        freight: salexItem.freight,
        total_taxable_value: salexItem.total_taxable_value,
        taxrate: salexItem.taxrate,
        total_cgst: salexItem.total_cgst,
        total_sgst: salexItem.total_sgst,
        total_igst: salexItem.total_igst,
        total_tax: salexItem.total_tax,
        total: salexItem.total,
        notes: salexItem.notes,
        bill_reference: salexItem.bill_reference,
        invoice_date: salexItem.invoice_date,
        status: salexItem.status,
        payment_status: salexItem.payment_status,
        payment_mode: salexItem.payment_mode,
        fy: salexItem.fy,
        mode: salexItem.mode,
        type: salexItem.type,
        item_count: salexItem.item_count,
        formattedDate: salexItem.formattedDate,
        return_status: salexItem.return_status,
        customer_vendor_name: salexItem.customer_name,
        customer_vendor_address: salexItem.customer_address,
        customer_vendor_gstin: salexItem.customer_gstin
      }));

      setSalex(transformedSalex);
      setPagination(data.pagination);
    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Salex fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Failed to fetch salex:', err);
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
        title: 'Salex Report',
        fileName: `Salex_Report_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, salex, config);
    } else {
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    const exportData = salex.map(salexItem => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = salexItem.id;
            break;
          case 'invoice_no':
            row['Invoice No'] = salexItem.invoice_no;
            break;
          case 'customer_name':
            row['Customer Name'] = salexItem.customer_name || '';
            break;
          case 'total':
            row['Total Amount'] = salexItem.total;
            break;
          case 'invoice_date':
            row['Invoice Date'] = salexItem.formattedDate || salexItem.invoice_date || '';
            break;
          case 'payment_status':
            row['Payment Status'] = salexItem.payment_status === 1 ? 'Paid' : 'Unpaid';
            break;
          case 'bill_reference':
            row['Bill Reference'] = salexItem.bill_reference || '';
            break;
        }
      });
      return row;
    });

    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Salex Report',
      fileName: `Salex_Report_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

  // Handle return actions
  const handlePartialReturn = (transaction: Salex) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0 || returnStatus === 1) {
      console.log('Starting partial return for salex:', transaction.id);
      router.push(`/entry/salexreturn-create?invoice=${transaction.id}&type=partial`);
    } else {
      alert('Full returns cannot be modified with partial returns.');
    }
  };

  const handleReturnWholeOrder = (transaction: Salex) => {
    console.log('Return whole order for salex:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return;

    setProcessingReturn(true);
    try {
      const response = await fetch('/api/salex-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoicex_id: selectedTransaction.id,
          return_type: 'salex',
          full_return: true,
          return_date: Math.floor(Date.now() / 1000),
          notes: 'Full order return processed automatically'
        })
      });

      if (response.ok) {
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`);
        fetchSalex();
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

  const handleFullReturn = (transaction: Salex) => {
    const returnStatus = transaction.return_status || 0;
    if (returnStatus === 0) {
      handleReturnWholeOrder(transaction);
    } else {
      alert('Full returns are only available for salex with no previous returns.');
    }
  };

  // Print individual salex
  const handlePrintSalex = (transaction: Salex) => {
    console.log('Printing salex:', transaction.id);
    // TODO: Implement print functionality (will print view page)
    alert(`Print functionality for salex ${transaction.invoice_no} will be implemented`);
  };

  // Handle filter application
  const handleApplyFilters = (filters: {
    customerFilter: string;
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
                <div className="text-red-400 font-medium">Error loading salex</div>
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

      <SalexTable
        salexs={salex}
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
        onPrintDetails={handlePrintSalex}
        onPartialReturn={handlePartialReturn}
        onFullReturn={handleFullReturn}
        actionButton={
          <a
            href="/salex/create"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Add New Invoice
          </a>
        }
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_vendor_name})?

This will return all items in the salex order and cannot be undone.`}
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
