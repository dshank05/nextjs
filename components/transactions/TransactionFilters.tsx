import { useState, useEffect } from 'react';

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
  hideTransactionType?: boolean; // New optional prop to hide transaction type filter
}

interface CustomerVendor {
  id: string;
  name: string;
  gstin?: string;
  contact?: string;
  email?: string;
}

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
  hideTransactionType = false
}: TransactionFiltersProps) => {
  const [customerVendorSearch, setCustomerVendorSearch] = useState('');
  const [showCustomerVendorDropdown, setShowCustomerVendorDropdown] = useState(false);
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

  const filteredCustomerVendors = customerVendors.filter(cv =>
    cv.name.toLowerCase().includes(customerVendorSearch.toLowerCase())
  );

  const handleCustomerVendorSelect = (customerVendor: { id: string; name: string }) => {
    // Store the ID (key) for database operations, but display name for UI
    setCustomerVendorFilter(customerVendor.id); // Store ID for filtering
    setCustomerVendorSearch(customerVendor.name); // Display name for UI
    setShowCustomerVendorDropdown(false);
  };

  const handleClear = () => {
    clearFilters();
    setCustomerVendorSearch('');
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-white mb-4">Search & Filter Transactions</h3>
      <div className={`grid grid-cols-1 md:grid-cols-2 ${hideTransactionType ? 'lg:grid-cols-5' : 'lg:grid-cols-6'} gap-4`}>
        {/* Search */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search Invoice/Customer</label>
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Transaction Type Filter - Only show if not hidden */}
        {!hideTransactionType && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Transaction Type</label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="select w-full"
            >
              <option value="all">All Types</option>
              <option value="sale">Sales</option>
              <option value="salex">Sales Extended</option>
              <option value="purchase">Purchases</option>
            </select>
          </div>
        )}

        {/* Customer/Vendor Filter */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-300 mb-2">Customer/Vendor</label>
          <input
            type="text"
            placeholder="Search customers/vendors..."
            value={customerVendorSearch || customerVendorFilter || ''}
            onChange={(e) => {
              setCustomerVendorSearch(e.target.value);
              setShowCustomerVendorDropdown(true);
              if (e.target.value === '') {
                setCustomerVendorFilter('');
                setCustomerVendorSearch('');
              }
            }}
            onFocus={() => setShowCustomerVendorDropdown(true)}
            onBlur={() => setTimeout(() => setShowCustomerVendorDropdown(false), 200)}
            className="input w-full"
          />
          {showCustomerVendorDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              <div
                className="px-3 py-2 hover:bg-slate-600 cursor-pointer"
                onClick={() => handleCustomerVendorSelect({ id: '', name: 'All Customers/Vendors' })}
              >
                All Customers/Vendors
              </div>
              {filteredCustomerVendors.map((cv) => (
                <div
                  key={cv.id}
                  className="px-3 py-2 hover:bg-slate-600 cursor-pointer"
                  onClick={() => handleCustomerVendorSelect(cv)}
                >
                  {cv.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="select w-full"
          >
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        {/* Date From */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Date To */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Amount Min */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Min Amount (₹)</label>
          <input
            type="number"
            placeholder="0"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            className="input w-full"
            min="0"
          />
        </div>

        {/* Amount Max */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount (₹)</label>
          <input
            type="number"
            placeholder="No limit"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            className="input w-full"
            min="0"
          />
        </div>

        {/* Items Per Page */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Items Per Page</label>
          <select
            value={limit}
            onChange={(e) => handleLimitChange(parseInt(e.target.value))}
            className="select w-full"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        {/* Clear Filters */}
        <div className="flex items-end">
          <button onClick={handleClear} className="btn-secondary w-full">
            Clear Filters
          </button>
        </div>
      </div>

      {/* Active Filters Summary */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-slate-400">Active Filters:</span>
          {searchTerm && (
            <span className="px-2 py-1 bg-blue-600/20 text-blue-300 rounded-full text-xs">
              Search: "{searchTerm}"
            </span>
          )}
          {transactionType !== 'all' && (
            <span className="px-2 py-1 bg-green-600/20 text-green-300 rounded-full text-xs">
              Type: {transactionType.toUpperCase()}
            </span>
          )}
          {customerVendorFilter && (
            <span className="px-2 py-1 bg-purple-600/20 text-purple-300 rounded-full text-xs">
              Customer/Vendor: {customerVendorFilter}
            </span>
          )}
          {statusFilter !== 'all' && (
            <span className="px-2 py-1 bg-orange-600/20 text-orange-300 rounded-full text-xs">
              Status: {statusFilter}
            </span>
          )}
          {(dateFrom || dateTo) && (
            <span className="px-2 py-1 bg-yellow-600/20 text-yellow-300 rounded-full text-xs">
              Date: {dateFrom || 'Start'} to {dateTo || 'End'}
            </span>
          )}
          {(amountMin || amountMax) && (
            <span className="px-2 py-1 bg-red-600/20 text-red-300 rounded-full text-xs">
              Amount: ₹{amountMin || '0'} - ₹{amountMax || '∞'}
            </span>
          )}
          {(!searchTerm && transactionType === 'all' && !customerVendorFilter &&
            statusFilter === 'all' && !dateFrom && !dateTo && !amountMin && !amountMax) && (
            <span className="text-slate-500 text-xs">None</span>
          )}
        </div>
      </div>
    </div>
  );
};
