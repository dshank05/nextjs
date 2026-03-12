import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronRight, Search, Calendar, Package, FileText, Target, Loader } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput } from '../../components/common/ClearableInput';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';
import { formatStartDateForAPI, formatEndDateForAPI, getLocalDateString } from '../../lib/date-utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useVendors } from '../../hooks/useVendors';
import { 
  useReturnReasons, 
  useVendorPurchaseBills, 
  usePurchaseReturn,
  useCreatePurchaseReturn,
  useUpdatePurchaseReturn 
} from '../../hooks/usePurchases';
import type { PurchaseBill, PurchaseReturnItem, ReturnReasons, SelectedReturnItem } from '../../types/purchases';
import type { Vendor } from '../../types/vendors';

export default function PurchaseReturnVendorCreatePage() {
  const router = useRouter();
  const { vendor: vendorIdParam, id: returnIdParam } = router.query;
  const { showSnackbar } = useSnackbar();

  const [isEditMode, setIsEditMode] = useState(false);

  // Business state for tax calculations
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  const [vendor, setVendor] = useState<Vendor | null>(null);
  
  // Query hooks - fetch data automatically
  const { data: vendors = [], isLoading: loadingVendors } = useVendors();
  const { data: returnReasons = [] } = useReturnReasons();
  
  // Mutation hooks
  const createReturn = useCreatePurchaseReturn();
  const updateReturn = useUpdatePurchaseReturn();

  
  // Filter states
  const [billSearchTerm, setBillSearchTerm] = useState('');
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Debounce search terms
  const debouncedBillSearch = useDebounce(billSearchTerm, 300);
  const debouncedItemSearch = useDebounce(itemSearchTerm, 300);
  
  // Fetch vendor bills using query hook
  const billsQuery = useVendorPurchaseBills({
    vendor_id: vendor?.id || '',
    page: 1,
    limit: 50,
    search: debouncedBillSearch,
    item_search: debouncedItemSearch,
    from_date: dateFrom,
    to_date: dateTo
  });
  
  const bills = billsQuery.data?.data?.bills || [];
  const pagination = billsQuery.data?.data?.pagination || {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  };
  
  // Fetch return data for edit mode
  const { data: editReturnData, isLoading: isLoadingEditData } = usePurchaseReturn(
    isEditMode ? (returnIdParam as string) : undefined
  );

  // Enable tax display if ANY bill has tax
  const enableTax = useMemo(() => {
    return bills.some((bill: PurchaseBill) => bill.has_tax);
  }, [bills]);
  
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  
  // UI state
  const [expandedBills, setExpandedBills] = useState<Set<string>>(new Set());
  const [returnNotes, setReturnNotes] = useState('');
  const [returnDate, setReturnDate] = useState(getLocalDateString());

  // Payment tracking state
  const [paymentStatus, setPaymentStatus] = useState<number>(0); // 0=Unpaid, 1=Paid
  const [paymentMode, setPaymentMode] = useState<number>(1); // 0=Cash, 1=Bank
  const [paymentDate, setPaymentDate] = useState('');

  // P&F state (will be in summary section)
  const [packingForwardingAmount, setPackingForwardingAmount] = useState<number>(0);

  // New state for enhanced features
  const [focusViewEnabled, setFocusViewEnabled] = useState(false);

  // Selected items for return
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedReturnItem>>(new Map());

  // Check if we're in edit mode
  useEffect(() => {
    if (returnIdParam) {
      setIsEditMode(true);
    }
  }, [returnIdParam]);

  // Load edit data when available
  useEffect(() => {
    if (isEditMode && editReturnData?.data) {
      const returnData = editReturnData.data;
      
      // Set return data
      setReturnDate(returnData.return.return_date);
      setReturnNotes(returnData.return.notes || '');
      setPaymentStatus(returnData.return.payment_status ?? 0);
      setPaymentMode(returnData.return.payment_mode ?? 1);
      setPaymentDate(returnData.return.payment_date ? (() => {
        const date = new Date(returnData.return.payment_date * 1000);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      })() : '');
      setPackingForwardingAmount(returnData.return.packing_forwarding_amount || 0);

      // Set vendor
      const vendorData = returnData.vendor;
      setVendor({
        id: vendorData.id.toString(),
        vendor_name: vendorData.vendor_name,
        state: vendorData.state,
        state_code: vendorData.state_code
      });

      // Pre-select the returned items with calculated fields
      const selectedItemsMap = new Map<string, SelectedReturnItem>();
      returnData.bills.forEach((bill: PurchaseBill) => {
        bill.items.forEach((item: PurchaseReturnItem) => {
          if (item.return_qty && item.return_qty > 0) {
            // Calculate tax and totals
            const subtotal = item.return_qty * item.unit_price;
            const taxAmount = (subtotal * item.tax_rate) / 100;

            // Determine CGST/SGST vs IGST based on vendor state
            const isIntraState = returnData.vendor.state === 'Uttar Pradesh';
            let cgst = 0, sgst = 0, igst = 0;
            if (isIntraState) {
              cgst = taxAmount / 2;
              sgst = taxAmount / 2;
            } else {
              igst = taxAmount;
            }

            const returnItem: SelectedReturnItem = {
              ...item,
              return_qty: item.return_qty,
              return_reason_id: item.return_reason_id || 1,
              subtotal,
              tax_amount: taxAmount,
              cgst,
              sgst,
              igst,
              total: subtotal + taxAmount
            };

            selectedItemsMap.set(item.id, returnItem);
          }
        });
      });
      setSelectedItems(selectedItemsMap);

      // Expand bills that have selected items
      const billsToExpand = new Set<string>();
      returnData.bills.forEach((bill: PurchaseBill) => {
        if (bill.items.some((item: PurchaseReturnItem) => selectedItemsMap.has(item.id))) {
          billsToExpand.add(bill.id);
        }
      });
      setExpandedBills(billsToExpand);
    }
  }, [isEditMode, editReturnData]);

  const handleVendorSelect = (vendorId: string | null) => {
    if (!vendorId) {
      setVendor(null);
      setSelectedItems(new Map());
      return;
    }

    const selectedVendor = vendors.find(v => v.id === vendorId);
    if (selectedVendor) {
      setVendor(selectedVendor);

      // Set default 1-month date range
      const today = new Date();
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(today.getMonth() - 1);

      const fromDate = formatStartDateForAPI(oneMonthAgo);
      const toDate = formatEndDateForAPI(today);

      setDateFrom(fromDate);
      setDateTo(toDate);

      // Reset search and other state
      setBillSearchTerm('');
      setItemSearchTerm('');
      setExpandedBills(new Set());
      setSelectedItems(new Map());
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
  const updateReturnQuantity = (itemId: string, quantity: number, item: PurchaseReturnItem) => {
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

  // Update return price for an item
  const updateReturnPrice = (itemId: string, newPrice: number, item: PurchaseReturnItem) => {
    const selectedItem = selectedItems.get(itemId);
    if (!selectedItem) return;

    // Use new price
    const price = Math.max(0, newPrice);

    // Recalculate with new price
    const subtotal = selectedItem.return_qty * price;
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

    const updatedItem: SelectedReturnItem = {
      ...selectedItem,
      unit_price: price,
      subtotal,
      tax_amount: taxAmount,
      cgst,
      sgst,
      igst,
      total: subtotal + taxAmount
    };

    setSelectedItems(prev => new Map(prev.set(itemId, updatedItem)));
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

  // Filter bills based on search, date, and focus view
  const filteredBills = useMemo(() => {
    let filtered = bills;

    // Item search: Show bills containing matching items
    if (itemSearchTerm) {
      const searchLower = itemSearchTerm.toLowerCase();
      filtered = filtered.filter(bill => {
        // Check if any items in the bill match
        return bill.items.some(item =>
          item.product_name.toLowerCase().includes(searchLower) ||
          (item.part_number && item.part_number.toLowerCase().includes(searchLower)) ||
          (item.display_name && item.display_name.toLowerCase().includes(searchLower))
        );
      });
    }

    // Focus view: Hide bills with no selected items
    if (focusViewEnabled) {
      const selectedItemIds = new Set(Array.from(selectedItems.keys()));
      filtered = filtered.filter(bill =>
        bill.items.some(item => selectedItemIds.has(item.id))
      );
    }

    return filtered;
  }, [bills, itemSearchTerm, focusViewEnabled, selectedItems]);

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

    // ✅ Step 1: Aggregate return quantities by product_id
    const returnQtyByProduct = new Map<number, {
      qty: number,
      name: string,
      current_stock: number
    }>();

    Array.from(selectedItems.values()).forEach(item => {
      const existing = returnQtyByProduct.get(item.product_id);

      if (existing) {
        // Product already exists, add to quantity
        existing.qty += item.return_qty;
      } else {
        // First occurrence of this product
        returnQtyByProduct.set(item.product_id, {
          qty: item.return_qty,
          name: item.product_name,
          current_stock: item.current_stock
        });
      }
    });

    // ✅ Step 2: Validate each product against current stock
    const stockIssues: Array<{ name: string, returning: number, available: number }> = [];

    returnQtyByProduct.forEach((data, productId) => {
      if (data.qty > data.current_stock) {
        stockIssues.push({
          name: data.name,
          returning: data.qty,
          available: data.current_stock
        });
      }
    });

    // ✅ Step 3: Show error if any stock issues
    if (stockIssues.length > 0) {
      const errorMsg = stockIssues.map(issue =>
        `${issue.name}: Returning ${issue.returning} but only ${issue.available} in stock`
      ).join('\n');

      showSnackbar('error', `Insufficient stock:\n${errorMsg}`);
      return;
    }

    // ✅ Step 4: Check for negative quantities
    const invalidItems = Array.from(selectedItems.values()).filter(
      item => item.return_qty < 0
    );

    if (invalidItems.length > 0) {
      const itemNames = invalidItems.map(item => item.product_name).join(', ');
      showSnackbar('error', `Invalid quantities. Must be 0 or positive for: ${itemNames}`);
      return;
    }

    // All validations passed - show confirmation modal
    setShowConfirmationModal(true);
  };

  const confirmProcessReturn = () => {
    const returnData = {
      return_date: returnDate,
      return_notes: returnNotes,
      payment_status: paymentStatus, // 0=Incomplete, 1=Complete
      payment_mode: paymentMode, // 0=Cash, 1=Bank
      payment_date: paymentStatus === 1 && paymentDate ? paymentDate : undefined,  // Send as YYYY-MM-DD string, backend handles conversion
      packing_forwarding_amount: packingForwardingAmount || 0,
      items: Array.from(selectedItems.values()).map(item => ({
        purchase_item_id: item.purchase_item_id, // Use purchase_item_id not item.id
        return_qty: item.return_qty,
        return_reason_id: item.return_reason_id,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        notes: item.return_notes || ''
      }))
    };

    if (isEditMode && returnIdParam) {
      // Edit mode - update existing return
      updateReturn.mutate({ id: returnIdParam as string, payload: returnData }, {
        onSuccess: () => {
          showSnackbar('success', `Return updated successfully! Return #${returnIdParam}`);
          router.push(`/entry/purchasereturn-vendor/${returnIdParam}`);
          setShowConfirmationModal(false);
        },
        onError: (error: Error) => {
          showSnackbar('error', error.message || 'Failed to update return');
          setShowConfirmationModal(false);
        }
      });
    } else {
      // Create mode - create new return
      const createData = {
        vendor_id: vendor?.id,
        ...returnData
      };
      createReturn.mutate(createData, {
        onSuccess: (result) => {
          const returnId = result.data.return.id;
          showSnackbar('success', `Return created successfully! Return #${returnId}`);
          router.push(`/entry/purchasereturn-vendor/${returnId}`);
          setShowConfirmationModal(false);
        },
        onError: (error: Error) => {
          showSnackbar('error', error.message || 'Failed to create return');
          setShowConfirmationModal(false);
        }
      });
    }
  };

  if (isLoadingEditData) {
    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
          <Loader className="w-8 h-8 animate-spin text-blue-400" />
          <div className="text-center">
            <p className="text-slate-200 font-medium">Loading Return Data</p>
            <p className="text-slate-400 text-sm">Please wait while we fetch the return details...</p>
          </div>
        </div>
      </div>
    );
  }

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
              {isEditMode ? 'Edit' : 'Create'} Purchase Return {vendor?.vendor_name ? `from ${vendor.vendor_name}` : ''}  {isEditMode && returnIdParam && (
                <p className="text-slate-400">| Return ID: {returnIdParam}</p>
              )}
            </h1>

          </div>

          {/* Return Information - 3 Rows x 3 Columns Layout */}
          <div className="mb-6">
            {/* Row 1: Vendor | Return Date | Return Status | Payment Mode */}
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
                <label className="block text-sm font-medium text-slate-300 mb-2">Return Status *</label>
                <SearchableSelect
                  options={[
                    { id: '0', name: 'Incomplete (Unpaid)' },
                    { id: '1', name: 'Complete (Paid)' }
                  ]}
                  selectedValue={paymentStatus.toString()}
                  onSelectionChange={(value) => {
                    const newStatus = parseInt(value || '0');
                    setPaymentStatus(newStatus);
                    // Auto-set payment date to today if marking as paid
                    if (newStatus === 1) {
                      setPaymentDate(getLocalDateString());
                    } else {
                      setPaymentDate('');
                    }
                  }}
                  placeholder="Select status..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Payment Mode</label>
                <SearchableSelect
                  options={[
                    { id: '0', name: 'Cash' },
                    { id: '1', name: 'Bank' }
                  ]}
                  selectedValue={paymentMode.toString()}
                  onSelectionChange={(value) => setPaymentMode(parseInt(value || '1'))}
                  placeholder="Select mode..."
                  className="w-full"
                />
              </div>
            </div>

            {/* Row 2: Search Invoice | Search Items | Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Search by Invoice No.</label>
                <ClearableInput
                  value={billSearchTerm}
                  onChange={(e) => setBillSearchTerm(e.target.value)}
                  placeholder="Search by invoice number..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Search by Items</label>
                <ClearableInput
                  value={itemSearchTerm}
                  onChange={(e) => setItemSearchTerm(e.target.value)}
                  placeholder="Search products, part numbers..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
                <DateRangeFilter
                  startDate={dateFrom}
                  endDate={dateTo}
                  onDateChange={(start, end) => {
                    setDateFrom(start);
                    setDateTo(end);
                  }}
                />
              </div>
            </div>


            {/* Enhanced Controls Row */}
            {vendor && (
              <div className="mt-4 flex items-center justify-end bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={focusViewEnabled}
                      onChange={(e) => setFocusViewEnabled(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500"
                    />
                    <Target className="w-4 h-4" />
                    Focus View
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Loading state for vendor data */}
          {billsQuery.isLoading && vendor && (
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
          {vendor && !billsQuery.isLoading && (
            <>
              <div className="border-t border-slate-600 pt-6 mb-6">
                <h3 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Select Items for Return
                </h3>

                <div className="space-y-3">
                  {filteredBills.map((bill) => (
                    <div key={bill.id} className="border border-slate-600 rounded-lg">
                      {/* Bill Header */}
                      <div
                        className="p-2 bg-slate-700 hover:bg-slate-650 cursor-pointer transition-colors"
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
                                {bill.bill_reference} • {new Date(bill.invoice_date).toLocaleDateString()} • ₹{bill.total_amount?.toLocaleString()}
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
                          <div>
                            <table className="w-full">
                              <thead className="bg-slate-700">
                                <tr>
                                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300 w-32">Product</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Available</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Return Qty</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Price</th>
                                  {enableTax && (
                                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Tax %</th>
                                  )}
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-32">Reason</th>
                                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-300 w-24">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bill.items.map((item) => {
                                  const selectedItem = selectedItems.get(item.id);
                                  return (
                                    <tr key={item.id} className={`border-t border-slate-600 ${item.is_fully_returned ? 'opacity-50 bg-slate-800/50' : ''}`}>
                                      <td className="px-4 py-3 text-sm text-white">
                                        <div>
                                          <div className="font-medium">
                                            {item.product_name}
                                            {item.is_fully_returned && (
                                              <span className="ml-2 px-2 py-0.5 bg-red-900 text-red-300 text-xs rounded">Fully Returned</span>
                                            )}
                                          </div>
                                          {item.part_number && (
                                            <div className="text-slate-400 text-xs">Part: {item.part_number}</div>
                                          )}
                                          {item.already_returned > 0 && (
                                            <div className="text-yellow-400 text-xs">Already returned: {item.already_returned} / {item.original_qty}</div>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-center text-sm text-slate-300">
                                        {item.available_qty}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <input
                                          type="number"
                                          max={item.available_qty}
                                          value={selectedItem?.return_qty || ''}
                                          onChange={(e) => updateReturnQuantity(item.id, parseInt(e.target.value) || 0, item)}
                                          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                          placeholder="0"
                                          disabled={item.is_fully_returned}
                                        />
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={selectedItem ? selectedItem.unit_price : item.unit_price}
                                          onChange={(e) => {
                                            const newPrice = parseFloat(e.target.value) || 0;
                                            if (selectedItem) {
                                              updateReturnPrice(item.id, newPrice, item);
                                            }
                                          }}
                                          className={`w-24 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm ${!selectedItem ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
                                            }`}
                                          placeholder="0"
                                          disabled={!selectedItem}
                                        />
                                      </td>
                                      {enableTax && (
                                        <td className="px-4 py-3 text-center text-sm text-slate-300">
                                          {item.tax_rate}%
                                        </td>
                                      )}
                                      <td className="px-4 py-3 text-center">
                                        <SearchableSelect
                                          options={returnReasons.map(reason => ({
                                            id: reason.id.toString(),
                                            name: reason.reason_name
                                          }))}
                                          selectedValue={selectedItem?.return_reason_id?.toString() || '1'}
                                          onSelectionChange={(value) => updateReturnReason(item.id, parseInt(value || '1'))}
                                          placeholder="Select reason..."
                                          className="w-full"
                                        />
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

                {/* Pagination - Note: Pagination is handled by query hook filters, not implemented in UI yet */}
              </div>

              {/* Return Notes | Summary - 2 Column Layout */}
              <div className="border-t border-slate-600 pt-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: Return Notes */}
                  <div>
                    <h3 className="text-lg font-medium text-slate-200 mb-4">Return Notes</h3>
                    <textarea
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      rows={10}
                      className="input w-full"
                      placeholder="Optional notes about the return..."
                    />
                  </div>

                  {/* Right Column: Summary */}
                  <div>
                    <h3 className="text-lg font-medium text-slate-200 mb-4">Summary</h3>
                    {selectedItems.size > 0 ? (
                      <div className="bg-slate-700 rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                          <span className="text-slate-400 text-sm">Items:</span>
                          <span className="text-white font-semibold">{returnSummary.totalItems}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                          <span className="text-slate-400 text-sm">Quantity:</span>
                          <span className="text-white font-semibold">{returnSummary.totalQuantity}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                          <span className="text-slate-400 text-sm">Subtotal:</span>
                          <span className="text-white font-semibold">₹{(returnSummary.totalAmount - returnSummary.totalTax).toFixed(2)}</span>
                        </div>
                        {enableTax && (
                          <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                            <span className="text-slate-400 text-sm">Tax:</span>
                            <span className="text-yellow-400 font-semibold">₹{returnSummary.totalTax.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center pb-2 border-b border-slate-600">
                          <span className="text-slate-400 text-sm">Packing & Forwarding:</span>
                          <input
                            type="number"
                            value={packingForwardingAmount}
                            onChange={(e) => setPackingForwardingAmount(parseFloat(e.target.value))}
                            className="w-32 px-2 py-1 bg-slate-600 border border-slate-500 rounded text-right text-sm text-white"
                            placeholder="0.00"
                          />
                        </div>
                        <div className="flex justify-between items-center pt-2">
                          <span className="text-slate-300 font-medium">Total:</span>
                          <span className="text-green-400 text-xl font-bold">₹{(returnSummary.totalAmount + (Number(packingForwardingAmount) || 0))}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-400 bg-slate-700 rounded-lg">
                        No items selected for return
                      </div>
                    )}
                  </div>
                </div>

                {/* Tax Breakdown */}
                {selectedItems.size > 0 && enableTax && (
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

              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-4">
                <button
                  type="button"
                  onClick={() => router.push('/entry/purchasereturn-vendor')}
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
                  {isEditMode ? 'Update Return' : 'Process Return'}
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
        message={`Process return for ${selectedItems.size} items totaling ₹${(returnSummary.totalAmount + (Number(packingForwardingAmount) || 0))} (including P&F: ₹${(Number(packingForwardingAmount) || 0)})?`}
        confirmText="Process Return"
        cancelText="Cancel"
        showLoading={createReturn.isPending || updateReturn.isPending}
        loadingText="Processing Return..."
        onConfirm={confirmProcessReturn}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  );
}
