import { useState, useEffect } from 'react';
import { ClearableInput, SearchableSelect } from '../common';
import { DateRangeFilter } from '../common/DateRangeFilter';

// Define the types for the props this component will receive
interface TransactionFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  transactionType: string;
  setTransactionType: (value: string) => void;
  customerVendorFilter: string;
  setCustomerVendorFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  amountMin: string;
  setAmountMin: (value: string) => void;
  amountMax: string;
  setAmountMax: (value: string) => void;
  limit: number;
  handleLimitChange: (value: number) => void;
  clearFilters: () => void;
  hideTransactionType?: boolean; // Optional prop to hide transaction type filter
  allowedTransactionTypes?: string[]; // Optional prop to limit transaction types shown
}

interface CustomerVendor {
  id: string;
  name?: string;
  vendor_name?: string;
  billing_name?: string;
  gstin?: string;
  contact?: string;
  email?: string;
}

// Helper function to get display name (prioritizes name, falls back to vendor_name or billing_name)
const getDisplayName = (cv: CustomerVendor): string => {
  return cv.name || cv.vendor_name || cv.billing_name || 'Unknown';
};

export const TransactionFilters = ({
  searchTerm, setSearchTerm,
  transactionType, setTransactionType,
  customerVendorFilter, setCustomerVendorFilter,
  statusFilter, setStatusFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  amountMin, setAmountMin,
  amountMax, setAmountMax,
  limit, handleLimitChange,
  clearFilters,
  hideTransactionType = false,
  allowedTransactionTypes = ['sale', 'salex', 'purchase']
}: TransactionFiltersProps) => {
  const [customerVendors, setCustomerVendors] = useState<CustomerVendor[]>([]);
  const [loadingCustomerVendors, setLoadingCustomerVendors] = useState(false);

  // Determine if we need customers or vendors based on transaction type
  const isPurchase = transactionType === 'purchase';

  // Fetch customer/vendor data on component mount and when transaction type changes
  useEffect(() => {
    fetchCustomerVendors();
  }, [isPurchase]);

  const fetchCustomerVendors = async () => {
    setLoadingCustomerVendors(true);
    try {
      const endpoint = isPurchase ? '/api/vendors' : '/api/customers';
      const response = await fetch(endpoint);
      const data = await response.json();

      if (response.ok) {
        const entities = isPurchase ? data.vendors : data.customers;
        setCustomerVendors(entities || []);
      } else {
        console.error('Failed to fetch customer/vendor data:', data.message);
        setCustomerVendors([]);
      }
    } catch (error) {
      console.error('Error fetching customer/vendor data:', error);
      setCustomerVendors([]);
    } finally {
      setLoadingCustomerVendors(false);
    }
  };

  const handleClear = () => {
    clearFilters();
  };

  return (
    <div>
      <div className="grid grid-cols-6 gap-4 mb-4">
        {/* Search */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Search Invoice/Customer</label>
          <ClearableInput
            type="text"
            placeholder="Search transactions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Transaction Type Filter - Only show if not hidden */}
        {!hideTransactionType && (
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Transaction Type</label>
            <SearchableSelect
              options={[
                { id: 'all', name: 'All Types' },
                ...allowedTransactionTypes.map(type => ({
                  id: type,
                  name: type === 'sale' ? 'Invoice' :
                        type === 'salex' ? 'Invoicex' :
                        type === 'purchase' ? 'Purchase' :
                        type === 'invoice' ? 'Invoice' :
                        type === 'invoicex' ? 'Invoicex' :
                        type.charAt(0).toUpperCase() + type.slice(1)
                }))
              ]}
              selectedValue={transactionType}
              onSelectionChange={(value) => setTransactionType(value || 'all')}
              placeholder="Select Type"
            />
          </div>
        )}

        {/* Customer/Vendor Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Customer/Vendor</label>
          <SearchableSelect
            options={[
              { id: '', name: 'All Customers/Vendors' },
              ...customerVendors.map(cv => ({
                id: cv.id,
                name: getDisplayName(cv)
              }))
            ]}
            selectedValue={customerVendorFilter}
            onSelectionChange={(value) => setCustomerVendorFilter(value || '')}
            placeholder="Select Customer/Vendor"
          />
        </div>

        {/* Date Range Filter */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Date</label>
          <DateRangeFilter
            startDate={dateFrom}
            endDate={dateTo}
            onDateChange={(start, end) => {
              setDateFrom(start);
              setDateTo(end);
            }}
            placeholder="Select date range..."
          />
        </div>

        {/* Status Filter - Moved to last */}
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
          <SearchableSelect
            options={[
              { id: 'all', name: 'All Status' },
              { id: '0', name: 'Unpaid' },
              { id: '1', name: 'Paid' }
            ]}
            selectedValue={statusFilter}
            onSelectionChange={(value) => setStatusFilter(value || 'all')}
            placeholder="Select Status"
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button onClick={handleClear} className="btn-secondary w-full">
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
};
