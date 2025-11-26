import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronRight, Search, Calendar, Calculator, Package, FileText, Target } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

interface Vendor {
  id: string;
  vendor_name: string;
  state?: string;
  state_code?: number;
}

interface PurchaseBill {
  id: string;
  invoice_no: string;
  bill_reference: string;
  invoice_date: string;
  total_amount: number;
  has_tax: boolean;
  items: PurchaseItem[];
  available_items: number;
  total_items: number;
}

interface PurchaseItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string;
  part_number?: string;
  available_qty: number;
  unit_price: number;
  tax_rate: number;
  bill_reference: string;
  invoice_date: string;
}

interface ReturnReasons {
  id: number;
  reason_name: string;
  type: string;
}

interface SelectedReturnItem extends PurchaseItem {
  return_qty: number;
  return_reason_id: number;
  return_notes?: string;
  // Calculated fields
  subtotal: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export default function PurchaseReturnVendorCreatePage() {
  const router = useRouter();
  const { vendor: vendorIdParam, id: returnIdParam } = router.query;
  const { showSnackbar } = useSnackbar();

  const [isEditMode, setIsEditMode] = useState(false);

  // Business state for tax calculations
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [returnReasons, setReturnReasons] = useState<ReturnReasons[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingReturn, setProcessingReturn] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);

  // Pagination and filtering state
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  });
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    from_date: '',
    to_date: ''
  });

  // UI state
  const [expandedBills, setExpandedBills] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);

  // Selected items for return
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedReturnItem>>(new Map());

  // Debounced search effect
  useEffect(() => {
    if (!vendor?.id) return;

    const timer = setTimeout(() => {
      loadVendorBills(vendor.id, 1, searchTerm, dateFrom, dateTo);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, dateFrom, dateTo, vendor?.id]);

  // Load data on mount
  useEffect(() => {
    loadReturnReasons();
    loadVendors();
  }, []);

  const loadVendors = async () => {
    setLoadingVendors(true);
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendors(data.vendors || []);
      } else {
        throw new Error('Failed to load vendors');
      }
    } catch (error) {
      console.error('Error loading vendors:', error);
      showSnackbar('error', 'Failed to load vendors');
      setVendors([]);
    } finally {
      setLoadingVendors(false);
    }
  };

  const loadVendorBills = async (vendorId: string, page = 1, search = '', fromDate = '', toDate = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        vendor_id: vendorId,
        page: page.toString(),
        limit: '10',
        ...(search && { search }),
        ...(fromDate && { from_date: fromDate }),
        ...(toDate && { to_date: toDate })
      });

      const billsResponse = await fetch(`/api/purchase-returns/vendor-items?${params}`);
      if (billsResponse.ok) {
        const billsData = await billsResponse.json();
        const data = billsData.data;

        setBills(data?.bills || []);
        setPagination({
          page: data?.pagination?.page || 1,
          limit: data?.pagination?.limit || 10,
          total: data?.pagination?.total || 0,
          totalPages: data?.pagination?.totalPages || 0,
          hasNext: data?.pagination?.hasNext || false,
          hasPrev: data?.pagination?.hasPrev || false
        });
        setAppliedFilters({
          search: data?.filters?.applied?.search || '',
          from_date: data?.filters?.applied?.from_date || '',
          to_date: data?.filters?.applied?.to_date || ''
        });
      } else {
        throw new Error('Failed to load vendor bills');
      }
    } catch (error) {
      console.error('Error loading vendor data:', error);
      showSnackbar('error', 'Failed to load vendor data');
      setBills([]);
    } finally {
      setLoading(false);
    }
  };

  const handleVendorSelect = async (vendorId: string | null) => {
    if (!vendorId) {
      setVendor(null);
      setBills([]);
      setSelectedItems(new Map());
      setPagination({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false
      });
      setAppliedFilters({
        search: '',
        from_date: '',
        to_date: ''
      });
      return;
    }

    const selectedVendor = vendors.find(v => v.id === vendorId);
    if (selectedVendor) {
      setVendor(selectedVendor);
      // Reset search and date filters when selecting new vendor
      setSearchTerm('');
      setDateFrom('');
      setDateTo('');
      await loadVendorBills(vendorId, 1, '', '', '');
    }
  };

  const loadReturnReasons = async () => {
    try {
      const response = await fetch('/api/return-reasons?type=purchase');
      if (response.ok) {
        const data = await response.json();
        setReturnReasons(data.data || []);
      } else {
        throw new Error('Failed to load return reasons');
      }
    } catch (error) {
      console.error('Error loading return reasons:', error);
      showSnackbar('error', 'Failed to load return reasons');
      setReturnReasons([]);
    }
  };

  // Toggle bill expansion
  const toggleBillExpansion = (billId: string) => {
    const newExpanded = new Set(expandedBills);
    if (newExpanded.has(billId)) {
      newExpanded.delete(billId);
    } else {
      newExpanded.add(billId);
    }
    setExpandedBills(newExpanded);
  };

  // Update return quantity for an item
  const updateReturnQuantity = (itemId: string, quantity: number, item: PurchaseItem) => {
    const validatedQty = Math.max(0, Math.min(quantity, item.available_qty));

    if (validatedQty === 0) {
      // Remove item from selection
      setSelectedItems(prev => {
        const newMap = new Map(prev);
        newMap.delete(itemId);
        return newMap;
      });
    } else {
      // Calculate tax and totals
      const subtotal = validatedQty * item.unit_price;
      const taxAmount = (subtotal * item.tax_rate) / 100;

      // Determine CGST/SGST vs IGST
      const vendorState = vendor?.state || '';
      const isIntraState = vendorState === 'Uttar Pradesh';

      let cgst = 0, sgst = 0, igst = 0;
      if (isIntraState) {
        cgst = taxAmount / 2;
        sgst = taxAmount / 2;
      } else {
        igst = taxAmount;
      }

      const returnItem: SelectedReturnItem = {
        ...item,
        return_qty: validatedQty,
        return_reason_id: 1, // Default reason
        subtotal,
        tax_amount: taxAmount,
        cgst,
        sgst,
        igst,
        total: subtotal + taxAmount
      };

      setSelectedItems(prev => new Map(prev.set(itemId, returnItem)));
    }
  };

  // Update return reason for an item
  const updateReturnReason = (itemId: string, reasonId: number) => {
    setSelectedItems(prev => {
      const newMap = new Map(prev);
      const item = newMap.get(itemId);
      if (item) {
        newMap.set(itemId, { ...item, return_reason_id: reasonId });
      }
      return newMap;
    });
  };

  // Filter bills based on search and date
  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      // Date filter
      if (dateFrom && new Date(bill.invoice_date) < new Date(dateFrom)) return false;
      if (dateTo && new Date(bill.invoice_date) > new Date(dateTo)) return false;

      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesBill = bill.invoice_no.toLowerCase().includes(searchLower) ||
                           bill.bill_reference.toLowerCase().includes(searchLower);
        const matchesItems = bill.items.some(item =>
          item.product_name.toLowerCase().includes(searchLower) ||
          (item.part_number && item.part_number.toLowerCase().includes(searchLower))
        );
        if (!matchesBill && !matchesItems) return false;
      }

      return true;
    });
  }, [bills, searchTerm, dateFrom, dateTo]);

  // Calculate return summary
  const returnSummary = useMemo(() => {
    const items = Array.from(selectedItems.values());
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, item) => sum + item.return_qty, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
    const totalTax = items.reduce((sum, item) => sum + item.tax_amount, 0);

    return { totalItems, totalQuantity, totalAmount, totalTax };
  }, [selectedItems]);

  // Handle return processing
  const handleProcessReturn = () => {
    if (selectedItems.size === 0) {
      showSnackbar('warning', 'Please select at least one item to return');
      return;
    }
    setShowConfirmationModal(true);
  };

  const confirmProcessReturn = async () => {
    setProcessingReturn(true);
    try {
      const returnData = {
        vendor_id: vendorIdParam,
        return_date: returnDate,
        return_notes: returnNotes,
        items: Array.from(selectedItems.values()).map(item => ({
          purchase_item_id: parseInt(item.id),
          return_qty: item.return_qty,
          return_reason_id: item.return_reason_id,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          notes: item.return_notes || ''
        }))
      };

      const response = await fetch('/api/purchase-returns/vendor-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(returnData)
      });

      if (response.ok) {
        const result = await response.json();
        showSnackbar('success', `Return processed successfully! Return #${result.data.return.id} created.`);
        router.push('/entry/purchasereturn');
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to process return');
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred');
    } finally {
      setProcessingReturn(false);
      setShowConfirmationModal(false);
    }
  };

  if (loadingVendors) {
    return (
      <div className="space-y-6">
        <div className="card">
          <div className="p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-slate-700 rounded mb-4"></div>
              <div className="h-4 bg-slate-700 rounded mb-2"></div>
              <div className="h-4 bg-slate-700 rounded mb-6"></div>
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-slate-700 rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Single Mega Card with Everything */}
      <div className="card">
        <div className="p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
              <Package className="w-6 h-6" />
              {isEditMode ? 'Edit' : 'Create'} Purchase Return {vendor?.vendor_name ? `from ${vendor.vendor_name}` : ''}
            </h1>
            {isEditMode && returnIdParam && (
              <p className="text-slate-400 text-sm">Return ID: {returnIdParam}</p>
            )}
          </div>

          {/* Return Information */}
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Vendor *</label>
                <SearchableSelect
                  options={vendors.map(v => ({
                    id: v.id,
                    name: `${v.vendor_name} (${v.state || 'N/A'})`
                  }))}
                  selectedValue={vendor?.id || null}
                  onSelectionChange={handleVendorSelect}
                  placeholder="Select vendor..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Return Date *</label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Bill Search</label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search bills..."
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>
          </div>

          {/* Loading state for vendor data */}
          {loading && vendor && (
            <div className="animate-pulse">
              <div className="h-8 bg-slate-700 rounded mb-4"></div>
              <div className="h-4 bg-slate-700 rounded mb-2"></div>
              <div className="h-4 bg-slate-700 rounded mb-6"></div>
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-slate-700 rounded"></div>
                ))}
              </div>
            </div>
          )}

          {/* Bills and Items Selection */}
          {vendor && !loading && (
            <>
              <div className="border-t border-slate-600 pt-6 mb-6">
                <h3 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Select Items for Return
                </h3>

                <div className="space-y-3">
                  {filteredBills.map((bill) => (
                    <div key={bill.id} className="border border-slate-600 rounded-lg overflow-hidden">
                      {/* Bill Header */}
                      <div
                        className="p-4 bg-slate-700 hover:bg-slate-650 cursor-pointer transition-colors"
                        onClick={() => toggleBillExpansion(bill.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {expandedBills.has(bill.id) ? (
                              <ChevronDown className="w-5 h-5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-slate-400" />
                            )}
                            <div>
                              <h4 className="text-base font-medium text-slate-200 flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Bill #{bill.invoice_no}
                              </h4>
                              <p className="text-sm text-slate-400">
                                {bill.bill_reference} • {new Date(bill.invoice_date).toLocaleDateString()} • ₹{bill.total_amount.toLocaleString()}
                                {bill.has_tax && <span className="ml-2 px-2 py-0.5 bg-green-900 text-green-300 text-xs rounded">Tax</span>}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-slate-400">
                              {bill.available_items}/{bill.total_items} items available
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Bill Items */}
                      {expandedBills.has(bill.id) && (
                        <div className="p-4 bg-slate-800">
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-slate-700">
                                <tr>
                                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Product</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Available</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Return Qty</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Price</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Tax %</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-32">Reason</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bill.items.map((item) => {
                                  const selectedItem = selectedItems.get(item.id);
                                  return (
                                    <tr key={item.id} className="border-t border-slate-600">
                                      <td className="px-4 py-3 text-sm text-white">
                                        <div>
                                          <div className="font-medium">{item.product_name}</div>
                                          {item.part_number && (
                                            <div className="text-slate-400 text-xs">Part: {item.part_number}</div>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-center text-sm text-slate-300">
                                        {item.available_qty}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <input
                                          type="number"
                                          min="0"
                                          max={item.available_qty}
                                          value={selectedItem?.return_qty || ''}
                                          onChange={(e) => updateReturnQuantity(item.id, parseInt(e.target.value) || 0, item)}
                                          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm"
                                          placeholder="0"
                                        />
                                      </td>
                                      <td className="px-4 py-3 text-center text-sm text-slate-300">
                                        ₹{item.unit_price.toFixed(0)}
                                      </td>
                                      <td className="px-4 py-3 text-center text-sm text-slate-300">
                                        {item.tax_rate}%
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <select
                                          value={selectedItem?.return_reason_id || 1}
                                          onChange={(e) => updateReturnReason(item.id, parseInt(e.target.value))}
                                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm"
                                        >
                                          {returnReasons.map((reason) => (
                                            <option key={reason.id} value={reason.id}>
                                              {reason.reason_name}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td className="px-4 py-3 text-center text-sm font-medium text-green-400">
                                        ₹{selectedItem?.total.toFixed(0) || '0'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {filteredBills.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    No bills found for the selected vendor and filters
                  </div>
                )}

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-600">
                    <div className="text-sm text-slate-400">
                      Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} bills
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => loadVendorBills(vendor!.id, pagination.page - 1, appliedFilters.search, appliedFilters.from_date, appliedFilters.to_date)}
                        disabled={!pagination.hasPrev}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-slate-300">
                        Page {pagination.page} of {pagination.totalPages}
                      </span>
                      <button
                        onClick={() => loadVendorBills(vendor!.id, pagination.page + 1, appliedFilters.search, appliedFilters.from_date, appliedFilters.to_date)}
                        disabled={!pagination.hasNext}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Return Summary */}
              <div className="border-t border-slate-600 pt-6 mb-6">
                <h3 className="text-lg font-medium text-slate-200 mb-4">Return Summary</h3>

                {selectedItems.size > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                    <div className="bg-slate-700 rounded-lg p-4 text-center">
                      <p className="text-slate-400 text-sm mb-1">Items</p>
                      <p className="text-white text-xl font-semibold">{returnSummary.totalItems}</p>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-4 text-center">
                      <p className="text-slate-400 text-sm mb-1">Quantity</p>
                      <p className="text-white text-xl font-semibold">{returnSummary.totalQuantity}</p>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-4 text-center">
                      <p className="text-slate-400 text-sm mb-1">Value</p>
                      <p className="text-green-400 text-xl font-semibold">₹{returnSummary.totalAmount.toFixed(0)}</p>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-4 text-center">
                      <p className="text-slate-400 text-sm mb-1">Tax Credit</p>
                      <p className="text-yellow-400 text-xl font-semibold">₹{returnSummary.totalTax.toFixed(0)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    No items selected for return
                  </div>
                )}

                {/* Tax Breakdown */}
                {selectedItems.size > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-slate-400 mb-3">Tax Breakdown</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-center">
                        <p className="text-red-400 text-sm mb-1">CGST Credit</p>
                        <p className="text-red-300 text-lg font-semibold">
                          -₹{Array.from(selectedItems.values()).reduce((sum, item) => sum + item.cgst, 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-center">
                        <p className="text-red-400 text-sm mb-1">SGST Credit</p>
                        <p className="text-red-300 text-lg font-semibold">
                          -₹{Array.from(selectedItems.values()).reduce((sum, item) => sum + item.sgst, 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 text-center">
                        <p className="text-red-400 text-sm mb-1">IGST Credit</p>
                        <p className="text-red-300 text-lg font-semibold">
                          -₹{Array.from(selectedItems.values()).reduce((sum, item) => sum + item.igst, 0).toFixed(0)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Return Notes */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Return Notes
                  </label>
                  <textarea
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Optional notes about the return..."
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-4">
                <button
                  type="button"
                  onClick={() => router.push('/entry/purchasereturn')}
                  className="px-6 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleProcessReturn}
                  disabled={selectedItems.size === 0}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                >
                  Process Return
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Confirm Return Processing"
        message={`Process return for ${selectedItems.size} items totaling ₹${returnSummary.totalAmount.toFixed(2)}?`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmProcessReturn}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  );
}
