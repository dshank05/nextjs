import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import useStorageState from 'use-storage-state';
import { useQueryClient } from '@tanstack/react-query';
import { SalexTable } from '../../components/transactions/SalexTable';
import { subscribeBroadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useSalex } from '../../hooks/useSalex';
import type { Salex } from '../../types/sales';
import { useDebounce } from '../../hooks/useDebounce';

type SalexFilterState = {
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

export default function SalexPage() {
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const [currentFilters, setCurrentFilters] = useStorageState<SalexFilterState>('salex-page-filters', {
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
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const queryFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedSearchTerm,
    ...currentFilters
  }), [page, limit, debouncedSearchTerm, currentFilters]);

  const { data, isLoading, error, refetch } = useSalex(queryFilters);

  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'salex' && (msg.type === 'created' || msg.type === 'updated' || msg.type === 'deleted')) {
        console.log(`🔄 Salex ${msg.type} in another tab, refreshing data...`);
        queryClient.invalidateQueries({ queryKey: ['salex'] });
      }
    });

    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('salex-page-filters');
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

  const handlePrintSalex = (transaction: Salex) => {
    console.log('Printing salex:', transaction.id);
    alert(`Print functionality for salex ${transaction.invoice_no} will be implemented`);
  };

  const handlePartialReturn = (salex: Salex) => {
    console.log('Process partial return for salex:', salex);
    sessionStorage.setItem('returnInvoice', JSON.stringify({
      id: salex.id,
      invoice_no: salex.invoice_no,
      customer_name: salex.customer_name,
      total: salex.total,
      invoice_date: salex.invoice_date,
      type: 'invoicex'
    }));
    window.location.href = `/entry/salereturn-create?invoicex=${salex.id}`;
  };

  const handleFullReturn = async (salex: Salex) => {
    if (!confirm(`Are you sure you want to process a full return for salex invoice #${salex.invoice_no}?\n\nThis will return all items in the order.`)) {
      return;
    }

    try {
      const response = await fetch('/api/sale-returns/customer-return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: salex.select_customer,
          invoicex_id: salex.id,
          return_type: 'full',
          return_date: new Date().toISOString().split('T')[0],
          return_notes: 'Full order return processed from salex index',
          payment_status: 0,
          payment_mode: 1
        })
      });

      if (response.ok) {
        showSnackbar('success', `Successfully processed full return for salex invoice #${salex.invoice_no}`);
        queryClient.invalidateQueries({ queryKey: ['salex'] });
      } else {
        const errorData = await response.json();
        showSnackbar('error', `Failed to process return: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred while processing return');
    }
  };

  const handleApplyFilters = (filters: SalexFilterState) => {
    console.log('📥 Salex index handleApplyFilters received:', filters);
    setCurrentFilters(filters);
    setPage(1);
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

      <SalexTable
        salexs={data?.salexs || []}
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
        onPrintDetails={handlePrintSalex}
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
            href="/salex/create"
            className="btn-primary"
          >
            Add Salex
          </Link>
        )}
      />
    </div>
  );
}
