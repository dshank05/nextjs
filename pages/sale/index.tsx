import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useQueryClient } from '@tanstack/react-query';
import { SaleTable } from '../../components/transactions/SaleTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useSales } from '../../hooks/useSales';
import type { Sale } from '../../types/sales';
import { useDebounce } from '../../hooks/useDebounce';

type SaleFilterState = {
  customerFilter: string;
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
};

export default function SalesPage() {
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const [currentFilters, setCurrentFilters] = useStorageState<SaleFilterState>('sales-page-filters', {
    defaultValue: {
      customerFilter: '',
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
      sortBy: 'invoice_no',
      sortOrder: 'asc'
    },
    storage: "session"
  });

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Debounce search term to avoid excessive API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Build query filters
  const queryFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedSearchTerm,
    ...currentFilters
  }), [page, limit, debouncedSearchTerm, currentFilters]);

  // Fetch sales using React Query
  const { data, isLoading, error, refetch } = useSales(queryFilters);

  // Handle broadcast messages for cross-tab updates
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'sales' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Sale ${msg.type} in another tab, refreshing data...`);
        queryClient.invalidateQueries({ queryKey: ['sales'] });
      }
    });

    return unsubscribe;
  }, [queryClient]);

  // Cleanup session storage on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('sales-page-filters');
      }
    };
  }, []);

  const handlePageChange = (newPage: number) => {
    if (data && newPage > 0 && newPage <= data.pagination.totalPages) {
      setPage(newPage);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const handlePrintSale = (transaction: Sale) => {
    console.log('Printing sale:', transaction.id);
    alert(`Print functionality for sale ${transaction.invoice_no} will be implemented`);
  };

  const handlePartialReturn = (sale: Sale) => {
    console.log('Process partial return for sale:', sale);
    sessionStorage.setItem('returnInvoice', JSON.stringify({
      id: sale.id,
      invoice_no: sale.invoice_no,
      customer_name: sale.customer_name,
      total: sale.total,
      invoice_date: sale.invoice_date,
      type: 'invoice'
    }));
    window.location.href = `/entry/salereturn-create?invoice=${sale.id}`;
  };

  const handleFullReturn = async (sale: Sale) => {
    if (!confirm(`Are you sure you want to process a full return for invoice #${sale.invoice_no}?\n\nThis will return all items in the order.`)) {
      return;
    }

    try {
      const response = await fetch('/api/sale-returns/customer-return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: sale.select_customer,
          invoice_id: sale.id,
          return_type: 'full',
          return_date: new Date().toISOString().split('T')[0],
          return_notes: 'Full order return processed from sale index',
          payment_status: 0,
          payment_mode: 1
        })
      });

      if (response.ok) {
        showSnackbar('success', `Successfully processed full return for invoice #${sale.invoice_no}`);
        // Invalidate and refetch
        queryClient.invalidateQueries({ queryKey: ['sales'] });
      } else {
        const errorData = await response.json();
        showSnackbar('error', `Failed to process return: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred while processing return');
    }
  };

  const handleApplyFilters = (filters: SaleFilterState) => {
    console.log('📥 Sales index handleApplyFilters received:', filters);
    setCurrentFilters(filters);
    setPage(1); // Reset to first page when filters change
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div>
                <div className="text-red-400 font-medium">Error loading sales</div>
                <div className="text-red-300 text-sm">{error.message}</div>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="btn-secondary text-red-400 text-sm py-1 px-3"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <SaleTable
        sales={data?.sales || []}
        pagination={data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 }}
        loading={isLoading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={limit}
        onItemsPerPageChange={handleLimitChange}
        onExport={() => {}}
        onApplyFilters={handleApplyFilters}
        onViewDetails={() => {}}
        onPrintDetails={handlePrintSale}
        onPartialReturn={handlePartialReturn}
        onFullReturn={handleFullReturn}
        sortBy={currentFilters.sortBy as 'invoice_no' | 'customer_name' | 'total' | 'invoice_date' | 'payment_status' | 'bill_reference' | 'item_count' | 'payment_mode' | 'total_tax'}
        sortOrder={currentFilters.sortOrder as 'asc' | 'desc'}
        initialFilters={{
          customerFilter: currentFilters.customerFilter,
          statusFilter: currentFilters.statusFilter,
          dateFrom: currentFilters.dateFrom,
          dateTo: currentFilters.dateTo,
          amountMin: currentFilters.amountMin,
          amountMax: currentFilters.amountMax,
          uidFilter: currentFilters.uidFilter,
          billReference: currentFilters.billReference,
          itemCount: currentFilters.itemCount,
          paymentMode: currentFilters.paymentMode,
          total: currentFilters.total,
          totalTax: currentFilters.totalTax,
          packingForwardingTotal: currentFilters.packingForwardingTotal
        }}
        actionButton={(
          <Link
            href="/sale/create"
            className="btn-primary"
          >
            Add Sale
          </Link>
        )}
      />
    </div>
  );
}
