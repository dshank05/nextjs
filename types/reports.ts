// Report types

export interface SalesReportFilters {
  dateFrom: string;
  dateTo: string;
  reportType: string;
}

export interface SalexReportFilters {
  dateFrom: string;
  dateTo: string;
}

export interface SalesSummary {
  totalSales: number;
  totalRevenue: number;
  totalItems: number;
  totalCustomers: number;
  avgOrderValue: number;
  cashSales: number;
  bankSales: number;
  paidSales: number;
  unpaidSales: number;
  partiallyPaidSales: number;
}

export interface TopCustomer {
  customer_name: string;
  total_sales: number;
  total_revenue: number;
}

export interface TopProduct {
  product_name: string;
  total_qty: number;
  total_revenue: number;
}

export interface DailySale {
  date: string;
  total_sales: number;
  total_revenue: number;
}

export interface SalesReportResponse {
  summary: SalesSummary;
  topCustomers: TopCustomer[];
  topProducts: TopProduct[];
  dailySales: DailySale[];
}
