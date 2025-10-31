import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { TransactionTable } from '../../components/transactions/TransactionTable';
import { TransactionFilters } from '../../components/transactions/TransactionFilters';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { FileText, Download, RotateCcw, RefreshCw } from 'lucide-react';
import { exportToPDF, exportToExcel, getTableForExport } from '../../lib/export-utils';
import { useSnackbar } from '../../components/SnackbarProvider';

// Define types for purchase data (matching the Purchase table)
interface Purchase {
  id: number;
  invoice_no: number;
  vendor_id: number;
  vendor_name?: string;
  customer_vendor_name?: string; // For TransactionTable compatibility
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
  total: number;
  items_total?: number;
  total_taxable_value?: number;
  invoice_date: string;
  status: number;
  fy: number;
  type?: string; // Always 'purchase' for table-based identification
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function PurchaseReturnPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [customerFilter, setCustomerFilter] = useState(''); // Actually vendor filter
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [limit, setLimit] = useState(25);

  // Data states
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Purchase | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  // Custom actions for return buttons
  const customActions = [
    {
      label: 'Process Return',
      icon: <RotateCcw className="w-4 h-4" />,
      onClick: (transaction: any) => handleProcessReturn(transaction as Purchase),
      className: 'text-blue-400 hover:text-blue-300',
      title: 'Create partial return for selected items'
    },
    {
      label: 'Return Whole Order',
      icon: <RefreshCw className="w-4 h-4" />,
      onClick: (transaction: any) => handleReturnWholeOrder(transaction as Purchase),
      className: 'text-green-400 hover:text-green-300',
      title: 'Create return for entire purchase invoice'
    }
  ];

  // Fetch purchases data from API based on transaction type
  const fetchPurchases = async (page: number = 1) => {
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

      // Add amount filters if provided (send even if empty for consistency)
      if (amountMin !== undefined && amountMin !== null && amountMin !== '') {
        params.append('amountMin', amountMin);
      }
      if (amountMax !== undefined && amountMax !== null && amountMax !== '') {
        params.append('amountMax', amountMax);
      }

      // Add vendor filter (for client-side filtering but send to API anyway)
      if (customerFilter && customerFilter !== '') {
        params.append('vendor', customerFilter);
      }

      const response = await fetch(`/api/purchases?${params}`);
      const data = response.ok ? await response.json() : { purchases: [], pagination: { total: 0 } };

      // Add type field to all purchases
      const purchasesWithType = (data.purchases || []).map((purchase: any) => ({
        ...purchase,
        type: 'purchase'
      }));

      setPurchases(purchasesWithType);
      setPagination(data.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      });

    } catch (error) {
      console.error('Error fetching purchases:', error);
      setPurchases([]);
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
    fetchPurchases(newPage);
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
      default: return '';
    }
  };

  // Handle view details - route to purchases view
  const handleViewDetails = (transaction: any) => {
    console.log('View details for purchase:', transaction);
    router.push(`/purchases/view/${transaction.id}`);
  };

  // Handle Process Return - navigate to return creation form
  const handleProcessReturn = (transaction: Purchase) => {
    console.log('Process return for purchase:', transaction);
    // Store purchase ID in sessionStorage for the return form
    sessionStorage.setItem('returnPurchase', JSON.stringify({
      id: transaction.id,
      invoice_no: transaction.invoice_no,
      vendor_name: transaction.vendor_name,
      total: transaction.total,
      invoice_date: transaction.invoice_date
    }));
    router.push(`/entry/purchasereturn-create?purchase=${transaction.id}`);
  };

  // Handle Return Whole Order - show confirmation modal
  const handleReturnWholeOrder = (transaction: Purchase) => {
    console.log('Return whole order for purchase:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  // Confirm and process the full return
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
        fetchPurchases(pagination.page);
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
    fetchPurchases(1);
  }, [searchTerm, customerFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit]);

  // Convert purchases data to transaction format for the table component
  const purchasesAsTransactions = purchases.map(purchase => ({
    ...purchase,
    type: 'purchase' as const, // TransactionTable expects specific string literals
    customer_vendor_name: purchase.vendor_name || '',
    customer_vendor_address: '',
    customer_vendor_gstin: '',
    items_total: purchase.items_total || 0,
    total_taxable_value: purchase.total_taxable_value || 0,
    invoice_date: purchase.invoice_date
  })) as any;

  // Export functions
  const handleExportPDF = async () => {
    console.log('Exporting purchases to PDF...');
    const tableElement = getTableForExport();
    if (tableElement && purchasesAsTransactions.length > 0) {
      try {
        await exportToPDF(tableElement, purchasesAsTransactions, {
          title: 'Purchase Report',
          fileName: 'purchase_report'
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
    console.log('Exporting purchases to Excel...');
    if (purchasesAsTransactions.length > 0) {
      try {
        exportToExcel(purchasesAsTransactions, {
          title: 'Purchase Report',
          fileName: 'purchase_report'
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
          transactionType={'all'} // Fixed to 'all' since we only show purchases
          setTransactionType={() => {}} // No-op since we don't allow changing type
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
          allowedTransactionTypes={['purchase']} // Only allow purchase filtering
        />
      </div>

      {/* Purchase Table with Return Actions */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
       
        <TransactionTable
          transactions={purchasesAsTransactions}
          pagination={pagination}
          loading={loading}
          onPageChange={handlePageChange}
          onViewDetails={handleViewDetails}
          customActions={customActions}
          hideTypeColumn={true}
        />
      </div>

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
    </div>
  );
}
