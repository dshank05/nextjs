import { useState, useMemo } from 'react';
import { DeadstockTable } from '../../components/transactions/DeadstockTable';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useDeadstock } from '../../hooks/useProducts';
import { useDebounce } from '../../hooks/useDebounce';
import type { DeadstockFilters } from '../../types/products';

export default function DeadstockPage() {
  const { showSnackbar } = useSnackbar();

  // State
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');

  // Debounce search
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Build query filters
  const filters: DeadstockFilters = useMemo(() => ({
    page,
    limit,
    search: debouncedSearch,
    sortBy: 'created_at',
    sortOrder: 'desc'
  }), [page, limit, debouncedSearch]);

  // Query hook
  const { data, isLoading, error, refetch } = useDeadstock(filters);

  const deadstock = data?.deadstock || [];
  const pagination = data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPage(newPage);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-red-400 text-lg">⚠️</span>
            <div>
              <div className="text-red-400 font-medium">Error loading deadstock</div>
              <div className="text-red-300 text-sm">{error.message}</div>
            </div>
          </div>
        </div>
      )}

      <DeadstockTable
        deadstock={deadstock}
        pagination={pagination}
        loading={isLoading}
        onPageChange={handlePageChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        itemsPerPage={pagination.limit}
        onItemsPerPageChange={handleLimitChange}
        onRefresh={handleRefresh}
        sortBy="created_at"
        sortOrder="desc"
      />
    </div>
  );
}
