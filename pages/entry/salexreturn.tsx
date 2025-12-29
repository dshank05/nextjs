import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { TransactionTable } from '../../components/transactions/TransactionTable';
import { TransactionFilters } from '../../components/transactions/TransactionFilters';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { FileText, Download, RotateCcw, RefreshCw } from 'lucide-react';
import { exportToPDF, exportToExcelGeneric, getTableForExport } from '../../lib/export-utils';
import { useSnackbar } from '../../components/SnackbarProvider';

// Define types for salex data (matching the Invoicex and invoice_itemsx tables)
interface SalexItem {
  id: number;
  invoice_no: number;
  name_of_product: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string;
  qty: number;
  rate: number;
  subtotal: number;
  fy: number;
  invoice_date: number | string;
}

interface Salex {
  id: number;
  invoice_no: number;
  select_customer?: number;
  customer_name?: string;
  customer_address?: string;
  customer_gstin?: string;
  items_total: number;
  total_taxable_value: number;
  total: number;
  invoice_date: number | string;
  fy: number;
  mode?: number;
  type?: string; // Always 'salex' for this page
  items?: SalexItem[];
  item_count?: number;
  payment_status?: number;
  outstanding_amount?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function SalexReturnPage() {
  // Router for navigation
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Salex | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [transactionType, setTransactionType] = useState('salex');
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [limit, setLimit] = useState(25);

  // Data states
  const [salex, setSalex] = useState<Salex[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);

  // Custom actions for return buttons
  const customActions = [
    {
      label: 'Process Return',
      icon: <RotateCcw className="w-4 h-4" />,
      onClick: (transaction: any) => handleProcessReturn(transaction as Salex),
      className: 'text-blue-400 hover:text-blue-300',
      title: 'Create partial return for selected items'
    },
    {
      label: 'Return Whole Order',
      icon: <RefreshCw className="w-4 h-4" />,
      onClick: (transaction: any) => handleReturnWholeOrder(transaction as Salex),
      className: 'text-green-400 hover:text-green-300',
      title: 'Create return for entire salex invoice'
    }
  ];

  // Fetch salex data from API
  const fetchSalex = async (page: number = 1) => {
    setLoading(true);

    try {
      // Build query parameters
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        search: searchTerm,
        startDate: dateFrom,
        endDate: dateTo,
        fy: '' // Add financial year if needed
      });

      // Add status filter if provided
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', getApiStatusFilter());
      }

      // Add amount filters if provided
      if (amountMin !== undefined && amountMin !== null && amountMin !== '') {
        params.append('amountMin', amountMin);
      }
      if (amountMax !== undefined && amountMax !== null && amountMax !== '') {
        params.append('amountMax', amountMax);
      }

      // Add customer filter
      if (customerFilter && customerFilter !== '') {
        params.append('customer', customerFilter);
      }

      // Call salex API
      const response = await fetch(`/api/salex?${params}`);
      const data = response.ok ? await response.json() : { salex: [], pagination: { total: 0 } };

      // Map data to expected format
      const salexData = (data.salex || []).map((salex: any) => ({
        ...salex,
        type: 'salex'
      }));

      setSalex(salexData);
      setPagination({
        page,
        limit,
        total: data.pagination?.total || 0,
        totalPages: Math.ceil((data.pagination?.total || 0) / limit)
      });

    } catch (error) {
      console.error('Error fetching salex:', error);
      setSalex([]);
      setPagination({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle page changes
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
    fetchSalex(newPage);
  };

  // Handle limit changes
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setCustomerFilter('');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setAmountMin('');
    setAmountMax('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Get API status values based on UI filter values
  const getApiStatusFilter = () => {
    switch (statusFilter) {
      case 'paid': return '1';
      case 'unpaid': return '0';
      case 'partial': return '2';
      case 'unknown': return 'unknown';
      default: return '';
    }
  };

  // Handle view details
  const handleViewDetails = (transaction: any) => {
    console.log('View details for salex:', transaction);
    router.push(`/salex/view/${transaction.id}`);
  };

  // Handle Process Return - navigate to return creation form
  const handleProcessReturn = (transaction: Salex) => {
    console.log('Process return for salex:', transaction);
    // Store salex ID in sessionStorage for the return form
    sessionStorage.setItem('returnSalex', JSON.stringify({
      id: transaction.id,
      invoice_no: transaction.invoice_no,
      customer_name: transaction.customer_name,
      total: transaction.total,
      invoice_date: transaction.invoice_date
    }));
    router.push(`/entry/salexreturn-create?salex=${transaction.id}`);
  };

  // Handle Return Whole Order - show confirmation modal
  const handleReturnWholeOrder = (transaction: Salex) => {
    console.log('Return whole order for salex:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  // Confirm and process the full return
  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return;

    setProcessingReturn(true);
    try {
      // Call the salex returns API to create a full return
      const response = await fetch('/api/salex-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoicex_id: selectedTransaction.id,
          return_type: 'salex',
          full_return: true, // Flag for full return
          return_date: Math.floor(Date.now() / 1000), // Current timestamp
          notes: 'Full order return processed automatically'
        })
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Successfully processed full return for salex invoice #${selectedTransaction.invoice_no}`);
        // Refresh the data to update the table
        fetchSalex(pagination.page);
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

  // Cancel the return operation
  const cancelReturnWholeOrder = () => {
    setShowReturnModal(false);
    setSelectedTransaction(null);
  };

  // Initial load and when filters change
  useEffect(() => {
    fetchSalex(1);
  }, [searchTerm, customerFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit]);

  // Convert salex data to transaction format for the table component
  const salexAsTransactions = salex.map(salex => ({
    ...salex,
    type: 'salex',
    customer_vendor_name: salex.customer_name,
    customer_vendor_address: salex.customer_address,
    customer_vendor_gstin: salex.customer_gstin,
    invoice_date: salex.invoice_date,
    payment_status: salex.payment_status,
    outstanding_amount: salex.outstanding_amount
  })) as any;

  // Export functions
  const handleExportPDF = async () => {
    console.log('Exporting salex to PDF...');
    const tableElement = getTableForExport();
    if (tableElement && salexAsTransactions.length > 0) {
      try {
        await exportToPDF(tableElement, salexAsTransactions, {
          title: 'Salex Report',
          fileName: 'salex_report'
        });
        showSnackbar('success', 'PDF report exported successfully');
      } catch (error) {
        console.error('PDF export error:', error);
        showSnackbar('error', 'Failed to export PDF report');
      }
    } else {
      showSnackbar('warning', 'No data to export. Please ensure there are records visible.');
    }
  };

  const handleExportExcel = () => {
    console.log('Exporting salex to Excel...');
    if (salexAsTransactions.length > 0) {
      try {
        exportToExcelGeneric(salexAsTransactions, {
          title: 'Salex Report',
          fileName: 'salex_report'
        });
        showSnackbar('success', 'Excel report exported successfully');
      } catch (error) {
        console.error('Excel export error:', error);
        showSnackbar('error', 'Failed to export Excel report');
      }
    } else {
      showSnackbar('warning', 'No data to export. Please ensure there are records visible.');
    }
  };

  return (
    <div className="space-y-2">

      {/* Header with Export Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={handleExportPDF}
            className="btn-secondary flex items-center space-x-2"
          >
            <FileText className="w-4 h-4" />
            <span>Export as PDF</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="btn-secondary flex items-center space-x-2"
          >
            <Download className="w-4 h-4" />
            <span>Export as Excel</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div>
        <TransactionFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          transactionType={transactionType}
          setTransactionType={setTransactionType}
          customerVendorFilter={customerFilter}
          setCustomerVendorFilter={setCustomerFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          amountMin={amountMin}
          setAmountMin={setAmountMin}
          amountMax={amountMax}
          setAmountMax={setAmountMax}
          limit={limit}
          handleLimitChange={handleLimitChange}
          clearFilters={clearFilters}
          allowedTransactionTypes={['salex']}
        />
      </div>

      {/* Salex Table with Return Actions */}
      <TransactionTable
        transactions={salexAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        customActions={customActions}
        hideTypeColumn={true} // Hide type column since all are salex
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for salex invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_name})?

This will return all items in the order and cannot be undone.`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmReturnWholeOrder}
        onCancel={cancelReturnWholeOrder}
      />
    </div>
  );
}
