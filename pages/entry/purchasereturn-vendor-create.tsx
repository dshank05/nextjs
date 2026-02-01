import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronRight, Search, Calendar, Package, FileText, Target, Loader } from 'lucide-react';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput } from '../../components/common/ClearableInput';
import { DateRangeFilter } from '../../components/common/DateRangeFilter';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';
import { formatStartDateForAPI, formatEndDateForAPI } from '../../lib/date-utils';

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
  purchase_item_id?: number; // ID of the purchase item in purchaseitems table
  product_id: number;
  product_name: string;
  display_name?: string;
  part_number?: string;
  original_qty?: number; // Original purchase quantity
  already_returned?: number; // ✅ How much was already returned
  available_qty: number;
  is_fully_returned?: boolean; // ✅ Flag for UI
  unit_price: number;
  tax_rate: number;
  bill_reference: string;
  invoice_date: string;
  return_qty?: number; // Added for edit mode
  return_reason_id?: number; // Added for edit mode
  current_stock: number; // Current stock from product table
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
  const [isLoadingEditData, setIsLoadingEditData] = useState(false);

  // Ref to track if we're initializing vendor (to prevent multiple API calls)
  const isInitializingVendor = useRef(false);

  // Ref to track current abort controller for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Business state for tax calculations
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<PurchaseBill[]>([]);

  // Enable tax display if ANY bill has tax
  const enableTax = useMemo(() => {
    return bills.some(bill => bill.has_tax);
  }, [bills]);
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
  const [billSearchTerm, setBillSearchTerm] = useState('');
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);

  // Payment tracking state
  const [paymentStatus, setPaymentStatus] = useState<number>(0); // 0=Unpaid, 1=Paid
  const [paymentMode, setPaymentMode] = useState<number>(1); // 0=Cash, 1=Bank
  const [paymentDate, setPaymentDate] = useState('');

  // P&F state (will be in summary section)
  const [packingForwardingAmount, setPackingForwardingAmount] = useState<number>(0);

  // New state for enhanced features
  const [loadedDateRange, setLoadedDateRange] = useState({ from: '', to: '' });
  const [allLoadedBills, setAllLoadedBills] = useState<PurchaseBill[]>([]);
  const [focusViewEnabled, setFocusViewEnabled] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Selected items for return
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedReturnItem>>(new Map());

  // Consolidated search and filter effect (API call)
  useEffect(() => {
    // Skip if no vendor selected
    if (!vendor?.id) return;

    // Skip if currently loading edit data
    if (isLoadingEditData) return;

    // Skip if in edit mode and bills already loaded from session storage
    if (isEditMode && bills.length > 0) return;

    // Skip if we're initializing vendor (prevents duplicate calls)
    if (isInitializingVendor.current) return;

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    const timer = setTimeout(() => {
      loadVendorBills(vendor.id, 1, billSearchTerm, dateFrom, dateTo);
    }, 300);

    return () => {
      clearTimeout(timer);
      // Cancel request if component unmounts or effect runs again
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [billSearchTerm, itemSearchTerm, dateFrom, dateTo, vendor?.id, isLoadingEditData, isEditMode]);

  // Load data on mount
  useEffect(() => {
    loadReturnReasons();
    loadVendors();

    // Check if we're in edit mode
    if (returnIdParam) {
      setIsEditMode(true);
      loadReturnForEdit(returnIdParam as string);
    }
  }, [returnIdParam]);

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

  const loadVendorBills = async (vendorId: string, page = 1, search = '', fromDate = '', toDate = '', isLoadMore = false) => {
    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        vendor_id: vendorId,
        page: page.toString(),
        limit: '50', // Increased for bulk returns
        ...(search && { search }),
        ...(itemSearchTerm && { item_search: itemSearchTerm }), // NEW: Item search parameter
        ...(fromDate && { from_date: fromDate }),
        ...(toDate && { to_date: toDate })
      });

      const billsResponse = await fetch(`/api/purchase-returns/vendor-items?${params}`);
      if (billsResponse.ok) {
        const billsData = await billsResponse.json();
        const data = billsData.data;
        const newBills = data?.bills || [];

        if (isLoadMore) {
          // Append new bills to existing ones
          setAllLoadedBills(prev => {
            const combined = [...prev, ...newBills];
            // Remove duplicates based on bill id
            const unique = combined.filter((bill, index, self) =>
              index === self.findIndex(b => b.id === bill.id)
            );
            setBills(unique); // Update display bills
            return unique;
          });

          // Update loaded date range
          if (fromDate && (!loadedDateRange.from || fromDate < loadedDateRange.from)) {
            setLoadedDateRange(prev => ({ ...prev, from: fromDate }));
          }
        } else {
          // Replace all bills
          setAllLoadedBills(newBills);
          setBills(newBills);
          setLoadedDateRange({ from: fromDate, to: toDate });
        }

        setPagination({
          page: data?.pagination?.page || 1,
          limit: data?.pagination?.limit || 50,
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
      if (!isLoadMore) {
        setBills([]);
        setAllLoadedBills([]);
      }
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleVendorSelect = async (vendorId: string | null) => {
    if (!vendorId) {
      setVendor(null);
      setBills([]);
      setAllLoadedBills([]);
      setSelectedItems(new Map());
      setLoadedDateRange({ from: '', to: '' });
      setPagination({
        page: 1,
        limit: 50,
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
      // Set flag to prevent useEffect from triggering during initialization
      isInitializingVendor.current = true;

      setVendor(selectedVendor);

      // Set default 1-month date range
      const today = new Date();
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(today.getMonth() - 1);

      const fromDate = formatStartDateForAPI(oneMonthAgo);
      const toDate = formatEndDateForAPI(today);

      setDateFrom(fromDate);
      setDateTo(toDate);
      setLoadedDateRange({ from: fromDate, to: toDate });

      // Reset search and other state
      setBillSearchTerm('');
      setItemSearchTerm('');
      setAllLoadedBills([]);
      setExpandedBills(new Set());
      setSelectedItems(new Map());

      // Load initial 3 months of data
      await loadVendorBills(vendorId, 1, '', fromDate, toDate, false);

      // Reset flag after loading completes
      isInitializingVendor.current = false;
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

  const loadReturnForEdit = async (returnId: string) => {
    setIsLoadingEditData(true);
    try {
      // Check session storage first (like purchase edit)
      let returnData = null

      // If not in session storage, fetch from API
      // if (!returnData) {
      console.log('📡 No cached data, fetching from API...');
      const response = await fetch(`/api/purchase-returns/${returnId}`);
      if (response.ok) {
        const data = await response.json();
        returnData = data.data;
      } else {
        throw new Error('Failed to load return data');
      }
      // } else {
      //   console.log('✅ Loaded return data from session storage');
      // }

      // Set return data
      setReturnDate(returnData.return.return_date);
      setReturnNotes(returnData.return.notes || '');
      setPaymentStatus(returnData.return.payment_status ?? 0);
      setPaymentMode(returnData.return.payment_mode ?? 1);
      setPaymentDate(returnData.return.payment_date ? new Date(returnData.return.payment_date * 1000).toISOString().split('T')[0] : '');
      setPackingForwardingAmount(returnData.return.packing_forwarding_amount || 0);

      // Set vendor
      const vendorData = returnData.vendor;
      setVendor({
        id: vendorData.id.toString(),
        vendor_name: vendorData.vendor_name,
        state: vendorData.state,
        state_code: vendorData.state_code
      });

      // Set bills and items
      // ✅ FIX BUG #1: Use fresh available_qty from API, don't override with cached original_qty
      // The API already calculates correct available_qty based on current purchase quantities
      setBills(returnData.bills);
      setAllLoadedBills(returnData.bills);

      // Pre-select the returned items with calculated fields
      const selectedItemsMap = new Map<string, SelectedReturnItem>();
      returnData.bills.forEach((bill: PurchaseBill) => {
        bill.items.forEach((item: PurchaseItem) => {
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
        if (bill.items.some((item: PurchaseItem) => selectedItemsMap.has(item.id))) {
          billsToExpand.add(bill.id);
        }
      });
      setExpandedBills(billsToExpand);

    } catch (error) {
      console.error('Error loading return for edit:', error);
      showSnackbar('error', 'Failed to load return data for editing');
    } finally {
      setIsLoadingEditData(false);
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

  // Update return price for an item
  const updateReturnPrice = (itemId: string, newPrice: number, item: PurchaseItem) => {
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

    // Date filter (only if explicitly set by user, not auto-loaded range)
    if (dateFrom && dateFrom !== loadedDateRange.from) {
      filtered = filtered.filter(bill => new Date(bill.invoice_date) >= new Date(dateFrom));
    }
    if (dateTo && dateTo !== loadedDateRange.to) {
      filtered = filtered.filter(bill => new Date(bill.invoice_date) <= new Date(dateTo));
    }

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
  }, [bills, itemSearchTerm, dateFrom, dateTo, loadedDateRange, focusViewEnabled, selectedItems]);

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

  const confirmProcessReturn = async () => {
    setProcessingReturn(true);
    try {
      const returnData = {
        return_date: returnDate,
        return_notes: returnNotes,
        payment_status: paymentStatus, // 0=Incomplete, 1=Complete
        payment_mode: paymentMode, // 0=Cash, 1=Bank
        payment_date: paymentStatus === 1 && paymentDate ? Math.floor(new Date(paymentDate).getTime() / 1000) : undefined,
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

      let response;
      if (isEditMode && returnIdParam) {
        // Edit mode - update existing return
        response = await fetch(`/api/purchase-returns/${returnIdParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(returnData)
        });
      } else {
        // Create mode - create new return
        const createData = {
          vendor_id: vendor?.id,
          ...returnData
        };
        response = await fetch('/api/purchase-returns/vendor-return', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createData)
        });
      }

      if (response.ok) {
        const result = await response.json();
        const action = isEditMode ? 'updated' : 'created';
        const returnId = isEditMode ? returnIdParam : result.data.return.id;
        showSnackbar('success', `Return ${action} successfully! Return #${returnId}`);
        router.push(`/entry/purchasereturn-vendor/${returnId}`);
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || `Failed to ${isEditMode ? 'update' : 'create'} return`);
      }
    } catch (error) {
      console.error('Error processing return:', error);
      showSnackbar('error', 'Network error occurred');
    } finally {
      setProcessingReturn(false);
      setShowConfirmationModal(false);
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
                      setPaymentDate(new Date().toISOString().split('T')[0]);
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
        showLoading={processingReturn}
        loadingText="Processing Return..."
        onConfirm={confirmProcessReturn}
        onCancel={() => setShowConfirmationModal(false)}
      />
    </div>
  );
}
