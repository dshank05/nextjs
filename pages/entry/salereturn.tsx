import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { TransactionTable } from '../../components/transactions/TransactionTable';
import { TransactionFilters } from '../../components/transactions/TransactionFilters';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { FileText, Download, RotateCcw, RefreshCw } from 'lucide-react';
import { exportToPDF, exportToExcel, getTableForExport } from '../../lib/export-utils';
import { useSnackbar } from '../../components/SnackbarProvider';

// Define types for sales data (matching the Invoice and Invoiceitems tables)
interface SaleItem {
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

interface Sale {
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
  type?: string; // Changed from number to string to match actual usage ('invoice'/'invoicex')
  items?: SaleItem[];
  item_count?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function SaleReturnPage() {
  // Router for navigation
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // Modal states for return confirmation
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Sale | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [transactionType, setTransactionType] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [limit, setLimit] = useState(25);

  // Data states
  const [sales, setSales] = useState<Sale[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);

  // Custom actions for return buttons
  const customActions = [
    {
      label: 'Process Return',
      icon: <RotateCcw className="w-4 h-4" />,
      onClick: (transaction: any) => handleProcessReturn(transaction as Sale),
      className: 'text-blue-400 hover:text-blue-300',
      title: 'Create partial return for selected items'
    },
    {
      label: 'Return Whole Order',
      icon: <RefreshCw className="w-4 h-4" />,
      onClick: (transaction: any) => handleReturnWholeOrder(transaction as Sale),
      className: 'text-green-400 hover:text-green-300',
      title: 'Create return for entire invoice'
    }
  ];

  // Fetch sales data from API based on transaction type
  const fetchSales = async (page: number = 1) => {
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

      // Add customer filter (for client-side filtering but send to API anyway)
      if (customerFilter && customerFilter !== '') {
        params.append('customer', customerFilter);
      }

      // Determine which API(s) to call based on transaction type
      let allSales: Sale[] = [];
      let totalCount = 0;

      if (transactionType === 'all') {
        // Call both APIs and combine results
        const [invoiceResponse, invoicexResponse] = await Promise.all([
          fetch(`/api/sales?${params}`),
          fetch(`/api/salex?${params}`)
        ]);

        const invoiceData = invoiceResponse.ok ? await invoiceResponse.json() : { sales: [], pagination: { total: 0 } };
        const invoicexData = invoicexResponse.ok ? await invoicexResponse.json() : { salex: [], pagination: { total: 0 } };

        // Combine results (invoice first, then invoicex)
        allSales = [
          ...(invoiceData.sales || []).map((sale: any) => ({ ...sale, type: 'invoice' })),
          ...(invoicexData.salex || []).map((salex: any) => ({ ...salex, type: 'invoicex' }))
        ];
        totalCount = (invoiceData.pagination?.total || 0) + (invoicexData.pagination?.total || 0);

        // Apply pagination to combined results
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        allSales = allSales.slice(startIndex, endIndex);

      } else if (transactionType === 'invoice') {
        // Call invoice API only
        const response = await fetch(`/api/sales?${params}`);
        const data = response.ok ? await response.json() : { sales: [], pagination: { total: 0 } };

        allSales = (data.sales || []).map((sale: any) => ({ ...sale, type: 'invoice' }));
        totalCount = data.pagination?.total || 0;

      } else if (transactionType === 'invoicex') {
        // Call invoicex API only
        const response = await fetch(`/api/salex?${params}`);
        const data = response.ok ? await response.json() : { salex: [], pagination: { total: 0 } };

        allSales = (data.salex || []).map((salex: any) => ({ ...salex, type: 'invoicex' }));
        totalCount = data.pagination?.total || 0;
      }

      setSales(allSales);
      setPagination({
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      });

    } catch (error) {
      console.error('Error fetching sales:', error);
      setSales([]);
      setPagination({
        page: 1,
        limit: 25,
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
    fetchSales(newPage);
  };

  // Handle limit changes
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setTransactionType('all');
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
      case 'unknown': return 'unknown';
      default: return '';
    }
  };

  // Handle view details
  const handleViewDetails = (transaction: any) => {
    console.log('View details for sale:', transaction);
    // Route to correct view page based on transaction type
    const viewPath = transaction.type === 'salex' ? '/salex/view/' : '/sale/view/';
    router.push(`${viewPath}${transaction.id}`);
  };

  // Handle Process Return - navigate to return creation form
  const handleProcessReturn = (transaction: Sale) => {
    console.log('Process return for sale:', transaction);
    // Store invoice ID in sessionStorage for the return form
    sessionStorage.setItem('returnInvoice', JSON.stringify({
      id: transaction.id,
      invoice_no: transaction.invoice_no,
      customer_name: transaction.customer_name,
      total: transaction.total,
      invoice_date: transaction.invoice_date
    }));
    router.push(`/entry/salereturn-create?invoice=${transaction.id}`);
  };

  // Handle Return Whole Order - show confirmation modal
  const handleReturnWholeOrder = (transaction: Sale) => {
    console.log('Return whole order for sale:', transaction);
    setSelectedTransaction(transaction);
    setShowReturnModal(true);
  };

  // Confirm and process the full return
  const confirmReturnWholeOrder = async () => {
    if (!selectedTransaction) return;

    setProcessingReturn(true);
    try {
      // Call the sale returns API to create a full return
      const response = await fetch('/api/sale-returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_id: selectedTransaction.id,
          return_type: String(selectedTransaction.type) === 'invoice' ? 'sale' : 'salex',
          full_return: true, // Flag for full return
          return_date: Math.floor(Date.now() / 1000), // Current timestamp
          notes: 'Full order return processed automatically'
        })
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Successfully processed full return for invoice #${selectedTransaction.invoice_no}`);
        // Refresh the data to update the table
        fetchSales(pagination.page);
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
    fetchSales(1);
  }, [searchTerm, transactionType, customerFilter, statusFilter, dateFrom, dateTo, amountMin, amountMax, limit]);

  // Convert sales data to transaction format for the table component
  const salesAsTransactions = sales.map(sale => ({
    ...sale,
    type: sale.type === 'invoicex' ? 'salex' : 'sale', // Map table names to TransactionTable types
    customer_vendor_name: sale.customer_name,
    customer_vendor_address: sale.customer_address,
    customer_vendor_gstin: sale.customer_gstin,
    invoice_date: sale.invoice_date
  })) as any;

  // Export functions
  const handleExportPDF = async () => {
    console.log('Exporting sales to PDF...');
    const tableElement = getTableForExport();
    if (tableElement && salesAsTransactions.length > 0) {
      try {
        await exportToPDF(tableElement, salesAsTransactions, {
          title: 'Sales Report',
          fileName: 'sales_report'
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
    console.log('Exporting sales to Excel...');
    if (salesAsTransactions.length > 0) {
      try {
        exportToExcel(salesAsTransactions, {
          title: 'Sales Report',
          fileName: 'sales_report'
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
          allowedTransactionTypes={['invoice', 'invoicex']}
        />
      </div>

      {/* Sales Table with Return Actions */}
      <TransactionTable
        transactions={salesAsTransactions}
        pagination={pagination}
        loading={loading}
        onPageChange={handlePageChange}
        onViewDetails={handleViewDetails}
        customActions={customActions}
        hideTypeColumn={false}
      />

      {/* Confirmation Modal for Full Order Return */}
      <ConfirmationModal
        isOpen={showReturnModal}
        title="Confirm Full Order Return"
        message={`Are you sure you want to process a full return for invoice #${selectedTransaction?.invoice_no} (${selectedTransaction?.customer_name})?

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
