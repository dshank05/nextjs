import { useState, useEffect, useRef, useCallback } from 'react';
import { DeadstockTable } from '../../components/transactions/DeadstockTable';
import { useSnackbar } from '../../components/SnackbarProvider';

interface Deadstock {
  id: number;
  product_id: number;
  product_name: string;
  part_no: string;
  quantity: number;
  reason: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  formatted_created_at: string;
  formatted_updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function DeadstockPage() {
  const { showSnackbar } = useSnackbar();

  // AbortController ref for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Debounce timeout ref
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Data states
  const [deadstock, setDeadstock] = useState<Deadstock[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Debounced fetch function with abort controller
  const debouncedFetchDeadstock = useCallback(() => {
    // Clear previous timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Set new timeout for debounced execution
    debounceTimeoutRef.current = setTimeout(() => {
      fetchDeadstock(abortControllerRef.current?.signal);
    }, 300); // 300ms debounce delay
  }, []); // Empty dependency array since we don't need external deps

  // Fetch deadstock when pagination or search change
  useEffect(() => {
    debouncedFetchDeadstock();
  }, [pagination.page, pagination.limit, searchTerm, debouncedFetchDeadstock]);

  // Cleanup: Cancel any pending requests and timeouts when component unmounts
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchDeadstock = async (signal?: AbortSignal) => {
    try {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      // Build API query parameters
      const queryParams = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        sortBy: 'created_at',
        sortOrder: 'desc'
      });

      const response = await fetch(`/api/deadstock?${queryParams}`, {
        signal: abortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      setDeadstock(data.deadstock || []);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages
      }));

    } catch (err) {
      // Don't show error if request was cancelled
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Deadstock fetch request was cancelled');
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to load deadstock');
      console.error('Failed to fetch deadstock:', err);
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

  const handleRefresh = () => {
    fetchDeadstock();
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-red-400 text-lg">⚠️</span>
            <div>
              <div className="text-red-400 font-medium">Error loading deadstock</div>
              <div className="text-red-300 text-sm">{error}</div>
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

      <DeadstockTable
        deadstock={deadstock}
        pagination={pagination}
        loading={loading}
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
