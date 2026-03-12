import { useQuery } from '@tanstack/react-query';
import type { SalesReportFilters, SalexReportFilters, SalesReportResponse } from '../types/reports';

async function fetchSalesReport(filters: SalesReportFilters, signal?: AbortSignal): Promise<SalesReportResponse> {
  const params = new URLSearchParams({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    reportType: filters.reportType
  });

  const response = await fetch(`/api/reports/sales?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch sales report');
  }

  return response.json();
}

export function useSalesReport(filters: SalesReportFilters) {
  return useQuery({
    queryKey: ['sales-report', filters],
    queryFn: ({ signal }) => fetchSalesReport(filters, signal),
    enabled: !!filters.dateFrom && !!filters.dateTo,
    staleTime: 60000, // 1 minute
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

async function fetchSalexReport(filters: SalexReportFilters, signal?: AbortSignal): Promise<SalesReportResponse> {
  const params = new URLSearchParams({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  });

  const response = await fetch(`/api/reports/salex-report?${params}`, { signal });

  if (!response.ok) {
    throw new Error('Failed to fetch salex report');
  }

  return response.json();
}

export function useSalexReport(filters: SalexReportFilters) {
  return useQuery({
    queryKey: ['salex-report', filters],
    queryFn: ({ signal }) => fetchSalexReport(filters, signal),
    enabled: !!filters.dateFrom && !!filters.dateTo,
    staleTime: 60000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
