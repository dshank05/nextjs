import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Calculator, Loader, Trash2, Edit2 } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';

interface Vendor {
  id: string;
  vendor_name: string;
  contact_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  state_code?: number;
  tax_id?: string;
}

interface StaffDetails {
  id: string;
  staff_name: string;
}

interface Product {
  id: number;
  product_name: string;
  display_name?: string;
  hsn?: string;
  product_category?: string;
  product_subcategory?: string;
  product_category_id?: number;
  product_subcategory_id?: number;
  car_model_ids?: string;
  company?: string;
  pic?: string;
  part_no?: string;
  min_stock?: number;
  stock?: number;
  rate?: number;
  notes?: string;
  category_name?: string;
  subcategory_name?: string;
  gst_rate?: number;
  selling_price?: number;
  gst_rate_percentage?: number;
}

interface PurchaseItem {
  id: string;
  product_id: number;
  product_name: string;
  car_model: string;
  category: string;
  sub_category: string;
  company: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

interface ReturnReasons {
  id: number;
  reason_name: string;
  type: string;
}

interface PurchaseFormData {
  invoice_number: string;
  bill_reference: string;
  staff_id?: number | null;
  date: string;
  vendor_name: string;
  contact_number: string;
  email_id: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  gst_number: string;
  transport_name: string;
  vehicle_number: string;
  transport_cost: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  notes: string;
  payment_status: number;
  payment_mode: number;
}

// Return-specific interface
interface ReturnItem extends PurchaseItem {
  return_reason_id?: number;
  return_qty: number;
  return_notes?: string;
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function PurchaseReturnCreatePage() {
  const router = useRouter();
  const { purchase: purchaseIdParam } = router.query;
  const { showSnackbar } = useSnackbar();

  // Business state hardcoded to Uttar Pradesh (assuming state code 9)
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [staffList, setStaffList] = useState<StaffDetails[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ReturnItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [vendorIdToSave, setVendorIdToSave] = useState<number | null>(null);
  const [vendorStateForTax, setVendorStateForTax] = useState<string>('');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Edit mode state - we're using edit mode to load original transaction
  const [isEditMode, setIsEditMode] = useState(true);
  const [editPurchaseId, setEditPurchaseId] = useState<number>(0);

  // Raw invoice data for re-conversion when filters load
  const [rawInvoiceItems, setRawInvoiceItems] = useState<any[]>([]);

  // Return-specific state
  const [returnReasons, setReturnReasons] = useState<ReturnReasons[]>([]);
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [returnStatus, setReturnStatus] = useState<string>('Pending');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // State for product selection panel
  const [isProductPanelOpen, setIsProductPanelOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);

  // Filter car models for filtering the product selection panel
  const [selectedPanelCarModels, setSelectedPanelCarModels] = useState<string[]>([]);

  // Function to generate dynamic product name based on car model selection
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[]): string => {
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name;
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name;
    const companyName = filterOptions.companies.find(comp => comp.id.toString() === product.company)?.name || product.company;

    // If no specific car model is selected, show base product name
    if (selectedCarModelIds.length === 0) {
      return `${categoryName}-${subcategoryName}-ALL-${companyName}`;
    }

    // Use the first selected car model for the product name
    const firstCarModelId = selectedCarModelIds[0];
    const selectedCarModel = filterOptions.models.find(model => model.id.toString() === firstCarModelId);
    const carModelName = selectedCarModel?.name || firstCarModelId;

    return `${categoryName}-${subcategoryName}-${carModelName}-${companyName}`;
  };

  // Function to filter car models based on product compatibility
  const getFilteredCarModelsForProduct = (product: Product): any[] => {
    if (!product.car_model_ids || !product.car_model_ids.trim()) {
      return filterOptions.models; // If no specific models, allow all
    }

    const compatibleModelIds = product.car_model_ids.split(',').map(id => id.trim());
    return filterOptions.models.filter(model =>
      compatibleModelIds.includes(model.id.toString())
    );
  };

  // Function to calculate GST breakdown based on state comparison
  const calculateGSTBreakdown = (taxAmount: number, vendorStateCode: number | null) => {
    const isIntraState = vendorStateCode === BUSINESS_STATE_CODE;

    if (isIntraState) {
      // Intra-state: CGST + SGST (50-50 split)
      return {
        cgst: taxAmount / 2,
        sgst: taxAmount / 2,
        igst: 0
      };
    } else {
      // Inter-state: IGST only
      return {
        cgst: 0,
        sgst: 0,
        igst: taxAmount
      };
    }
  };

  // State declarations moved above useEffect hooks
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  const [formData, setFormData] = useState<PurchaseFormData>({
    invoice_number: '',
    bill_reference: '',
    staff_id: null,
    date: new Date().toISOString().split('T')[0],
    vendor_name: '',
    contact_number: '',
    email_id: '',
    address: '',
    address_2: '',
    city: '',
    state: '',
    gst_number: '',
    transport_name: '',
    vehicle_number: '',
    transport_cost: '',
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    total_cgst: '',
    total_sgst: '',
    total_igst: '',
    notes: '',
    payment_status: 0,
    payment_mode: 1
  });

  // State for selected vendor details (fetched on-demand, not stored in formData)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  const handleInputChange = (field: keyof PurchaseFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Load original purchase data - Always load from API first for reliability
  useEffect(() => {
    const loadPurchaseData = async () => {
      if (!purchaseIdParam) return;

      const purchaseId = parseInt(purchaseIdParam as string);
      setEditPurchaseId(purchaseId);
      setInvoiceNumberLoading(true);

      try {
        // Try API first (more reliable than sessionStorage)
        await fetchPurchaseForEdit(purchaseId);
        console.log('✅ Purchase data loaded from API');
      } catch (error) {
        console.error('❌ Failed to load purchase from API:', error);

        // Fallback to sessionStorage if API fails
        const cachedData = SessionStorageService.get('purchases', purchaseId.toString());
        if (cachedData) {
          console.log('🔄 Fallback: Using cached purchase data from sessionStorage');
          populateFormWithPurchaseData(cachedData);
          // Keep cached data for potential future use
        } else {
          console.error('❌ No cached data available - purchase loading failed completely');
          showSnackbar('error', 'Failed to load purchase data. Please check if the purchase exists and try again.');
        }
      } finally {
        // Load return reasons regardless of success/failure
        loadReturnReasons();

        // Stop loading regardless of outcome
        if (invoiceNumberLoading) {
          setInvoiceNumberLoading(false);
        }
      }
    };

    loadPurchaseData();
  }, [purchaseIdParam, showSnackbar]);

  // Fetch customers, staff, and products on mount
  useEffect(() => {
    fetchVendors();
    fetchStaff();
    fetchProducts();
    fetchFilterOptions();
  }, []);

  // Clear validation errors when side panel closes
  useEffect(() => {
    if (!isProductPanelOpen) {
      setErrors({});
    }
  }, [isProductPanelOpen]);

  // Convert raw purchase items when filterOptions are loaded - More reliable conversion
  useEffect(() => {
    if (rawInvoiceItems.length > 0 && filterOptions.categories.length > 0) {
      console.log('🔄 Converting raw purchase items to formatted items now that filters are available');
      const convertedItems: ReturnItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: ReturnItem = {
          id: (index + 1).toString(),
          product_id: item.product_id || item.name_of_product || 1,
          product_name: item.product_name || item.name_of_product || '',
          car_model: item.model_id?.toString() || '',
          category: item.category_id?.toString() || '',
          sub_category: item.subcategory_id?.toString() || '',
          company: item.company_id?.toString() || '',
          part_number: item.part_number || item.part || '',
          qty: item.qty || 1,
          rate: item.rate || 0,
          gst_percentage: item.gst_percentage || item.gst_rate || 0,
          tax: item.tax || 0,
          total: item.total || 0,
          cgst: item.cgst || 0,
          sgst: item.sgst || 0,
          igst: item.igst || 0,
          // Return-specific fields
          return_reason_id: 1, // Default reason
          return_qty: 0, // Start with 0 (not returning)
          return_notes: ''
        };
        return itemObj;
      });

      console.log('✅ Setting converted purchase items:', convertedItems);
      setSelectedProducts(convertedItems);

      // Clear raw items after successful conversion
      setRawInvoiceItems([]);
    }
  }, [rawInvoiceItems, filterOptions.categories, filterOptions.subcategories, filterOptions.companies, filterOptions.models, products]);

  function populateFormWithPurchaseData(cachedData: any) {
    const purchase = cachedData.purchase || cachedData;

    setFormData({
      invoice_number: purchase.invoice_no?.toString() || '',
      bill_reference: purchase.bill_reference || '',
      staff_id: purchase.staff_id || null,
      date: new Date(purchase.invoice_date * 1000).toISOString().split('T')[0],
      vendor_name: purchase.vendor_name || '',
      contact_number: purchase.contact_number || '',
      email_id: purchase.email_id || '',
      address: purchase.vendor_address || '',
      address_2: '',
      city: '',
      state: purchase.vendor_gstin ? 'Uttar Pradesh' : '',
      gst_number: purchase.vendor_gstin || '',
      transport_name: purchase.transport || '',
      vehicle_number: purchase.vehicle_number || '',
          transport_cost: purchase.freight?.toString() || '',
      descriptions: purchase.descriptions || '',
      packing_forwarding_qty: purchase.packing_forwarding_qty?.toString() || '',
      packing_forwarding_rate: purchase.packing_forwarding_rate?.toString() || '',
      packing_forwarding_total: purchase.packing_forwarding_total?.toString() || '',
      total_cgst: purchase.total_cgst?.toString() || '',
      total_sgst: purchase.total_sgst?.toString() || '',
      total_igst: purchase.total_igst?.toString() || '',
      notes: purchase.notes || '',
      payment_status: purchase.status || 0,
      payment_mode: purchase.payment_mode || 1,
    });

    // Set vendor data from purchase
    if (purchase.vendor_id) {
      setSelectedVendorId(purchase.vendor_id.toString());
      setVendorIdToSave(purchase.vendor_id);

      // Find vendor in loaded vendors list, or create from cached data
      let vendor = vendors.find(v => parseInt(v.id) === purchase.vendor_id);

      // If not found in loaded vendors, create vendor object from purchase data
      if (!vendor && purchase.vendor_name) {
        vendor = {
          id: purchase.vendor_id.toString(),
          vendor_name: purchase.vendor_name,
          contact_no: purchase.contact_number || '',
          email: purchase.email_id || '',
          address: purchase.vendor_address || '',
          address_2: '',
          city: '',
          state: purchase.vendor_gstin ? 'Uttar Pradesh' : '',
          state_code: 0,
          tax_id: purchase.vendor_gstin || ''
        };
      }

      if (vendor) {
        setSelectedVendor(vendor);
        setVendorStateForTax(vendor.state || '');
      }
    }

    // Set raw items to convert later
    if (purchase.items && purchase.items.length > 0) {
      console.log('Storing cached raw purchase items for conversion:', purchase.items);
      setRawInvoiceItems(purchase.items);
    }

    // Set loading to false
    setInvoiceNumberLoading(false);
  }

  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  // Load return reasons
  const loadReturnReasons = () => {
    setReturnReasons([
      { id: 1, reason_name: 'Manufacturing Defect', type: 'purchase' },
      { id: 2, reason_name: 'Wrong Item Shipped', type: 'purchase' },
      { id: 3, reason_name: 'Poor Quality', type: 'purchase' },
      { id: 4, reason_name: 'Damaged in Transit', type: 'purchase' },
      { id: 5, reason_name: 'Expired Product', type: 'purchase' }
    ]);
  };

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendors(data.vendors || []);
      } else {
        showSnackbar('error', 'Failed to load vendors. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
      showSnackbar('error', 'Failed to load vendors. Please try again.');
    }
  };

  const fetchStaff = async () => {
    try {
      const response = await fetch('/api/staff');
      if (response.ok) {
        const data = await response.json();
        setStaffList(data.staff || []);
      } else {
        showSnackbar('error', 'Failed to load staff. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
      showSnackbar('error', 'Failed to load staff. Please try again.');
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products');
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      } else {
        showSnackbar('error', 'Failed to load products. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      showSnackbar('error', 'Failed to load products. Please try again.');
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };



  const handleVendorSelect = (vendorId: string) => {
    const vendor = vendors.find(v => v.id === vendorId);
    if (vendor) {
      setVendorIdToSave(parseInt(vendor.id));
      setSelectedVendor(vendor);
      setSelectedProducts([]);
      setFormData(prev => ({
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
      setVendorStateForTax(vendor.state || '');
    } else {
      setVendorIdToSave(null);
      setSelectedVendor(null);
      setVendorStateForTax('');
    }
  };

  const fetchPurchaseForEdit = async (purchaseId: number) => {
    try {
      const response = await fetch(`/api/purchases/${purchaseId}`);
      if (response.ok) {
        const data = await response.json();
        const purchase = data.purchase || data;

        const formatDateForInput = (dateValue: number | string) => {
          if (typeof dateValue === 'string') {
            if (/^\d+$/.test(dateValue)) {
              const timestamp = parseInt(dateValue);
              if (timestamp > 1000000000) {
                return new Date(timestamp * 1000).toISOString().split('T')[0];
              }
            }
            return new Date(dateValue).toISOString().split('T')[0];
          }
          return new Date(dateValue * 1000).toISOString().split('T')[0];
        };

        setFormData({
          invoice_number: purchase.invoice_no?.toString() || '',
          bill_reference: purchase.bill_reference || '',
          staff_id: purchase.staff_id || null,
          date: formatDateForInput(purchase.invoice_date),
          vendor_name: purchase.vendor_name || '',
          contact_number: purchase.contact_number || '',
          email_id: purchase.email_id || '',
          address: purchase.vendor_address || '',
          address_2: '',
          city: '',
          state: purchase.vendor_gstin ? 'Uttar Pradesh' : '',
          gst_number: purchase.vendor_gstin || '',
          transport_name: purchase.transport || '',
          vehicle_number: purchase.vehicle_number || '',
          transport_cost: purchase.freight?.toString() || '',
      descriptions: purchase.descriptions || '',
      packing_forwarding_qty: purchase.packing_forwarding_qty?.toString() || '',
      packing_forwarding_rate: purchase.packing_forwarding_rate?.toString() || '',
      packing_forwarding_total: purchase.packing_forwarding_total?.toString() || '',
          total_cgst: purchase.total_cgst?.toString() || '',
          total_sgst: purchase.total_sgst?.toString() || '',
          total_igst: purchase.total_igst?.toString() || '',
          notes: purchase.notes || '',
          payment_status: purchase.status || 0,
          payment_mode: purchase.payment_mode || 1,
        });

        if (purchase.vendor_id) {
          setSelectedVendorId(purchase.vendor_id.toString());
          setVendorIdToSave(purchase.vendor_id);

          let vendor = vendors.find(v => parseInt(v.id) === purchase.vendor_id);

          if (!vendor && purchase.vendor_name) {
            vendor = {
              id: purchase.vendor_id.toString(),
              vendor_name: purchase.vendor_name,
              contact_no: purchase.contact_number || '',
              email: purchase.email_id || '',
              address: purchase.vendor_address || '',
              address_2: '',
              city: '',
              state: purchase.vendor_gstin ? 'Uttar Pradesh' : '',
              state_code: 0,
              tax_id: purchase.vendor_gstin || ''
            };
          }

          if (vendor) {
            setSelectedVendor(vendor);
            setVendorStateForTax(vendor.state || '');
          }
        }

        if (purchase.items && purchase.items.length > 0) {
          console.log('Storing raw purchase items for conversion:', purchase.items);
          setRawInvoiceItems(purchase.items);
        }
      } else {
        showSnackbar('error', 'Failed to load purchase data. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching purchase for edit:', error);
      showSnackbar('error', 'Failed to load purchase data. Please try again.');
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  // Update return quantity
  const updateReturnQuantity = (id: string, quantity: number) => {
    setSelectedProducts(prev =>
      prev.map(item =>
        item.id === id ? {
          ...item,
          return_qty: Math.min(Math.max(quantity, 0), item.qty),
          cgst: (item.cgst / item.qty) * Math.min(Math.max(quantity, 0), item.qty),
          sgst: (item.sgst / item.qty) * Math.min(Math.max(quantity, 0), item.qty),
          igst: (item.igst / item.qty) * Math.min(Math.max(quantity, 0), item.qty),
          tax: (item.tax / item.qty) * Math.min(Math.max(quantity, 0), item.qty),
          total: (item.total / item.qty) * Math.min(Math.max(quantity, 0), item.qty)
        } : item
      )
    );
  };

  // Update return reason
  const updateReturnReason = (id: string, reasonId: number) => {
    setSelectedProducts(prev =>
      prev.map(item =>
        item.id === id ? { ...item, return_reason_id: reasonId } : item
      )
    );
  };

  // Calculate totals - only for items being returned (return_qty > 0)
  const itemsBeingReturned = useMemo(() => {
    return selectedProducts.filter(item => item.return_qty > 0);
  }, [selectedProducts]);

  const totalReturnAmount = useMemo(() => {
    return itemsBeingReturned.reduce((sum, item) => sum + item.total, 0);
  }, [itemsBeingReturned]);

  const totalReturnTax = useMemo(() => {
    return itemsBeingReturned.reduce((sum, item) => sum + item.tax, 0);
  }, [itemsBeingReturned]);

  const totalReturnQuantity = useMemo(() => {
    return itemsBeingReturned.reduce((sum, item) => sum + item.return_qty, 0);
  }, [itemsBeingReturned]);

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Check if any items are being returned
    if (itemsBeingReturned.length === 0) {
      setErrors({ noReturns: 'Please specify return quantities for at least one item' });
      return;
    }

    // Validate return quantities
    const invalidItems = itemsBeingReturned.filter(item => item.return_qty <= 0 || item.return_qty > item.qty);
    if (invalidItems.length > 0) {
      setErrors({ invalidQty: 'Some return quantities are invalid' });
      return;
    }

    setErrors({});
    setShowConfirmationModal(true);
  };

  const handleConfirmSubmit = async () => {
    setLoading(true);

    try {
      const submitData = {
        purchase_id: editPurchaseId,
        return_date: Math.floor(new Date(returnDate).getTime() / 1000),
        total_amount: totalReturnAmount,
        total_tax: totalReturnTax,
        status: returnStatus,
        notes: returnNotes,
        fy: new Date().getFullYear(),

        // Return items data
        returnItems: itemsBeingReturned.map(item => ({
          purchase_item_id: parseInt(item.id),
          return_qty: item.return_qty,
          return_reason_id: item.return_reason_id || 1,
          unit_price: item.rate,
          gst_percentage: item.gst_percentage,
          tax_amount: item.tax,
          cgst: item.cgst,
          sgst: item.sgst,
          igst: item.igst,
          notes: item.return_notes || ''
        }))
      };

      const response = await fetch('/api/purchase-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        setShowConfirmationModal(false);
        router.push('/entry/purchasereturn');
        showSnackbar('success', 'Purchase return created successfully!');
      } else {
        const error = await response.json();
        setErrors({ submit: error.message || 'Failed to create return' });
        showSnackbar('error', error.message || 'Failed to create return');
      }
    } catch (error) {
      console.error('Error creating return:', error);
      setErrors({ submit: 'Network error occurred' });
      showSnackbar('error', 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmationModal(false);
  };

  if (invoiceNumberLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Return Information */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-slate-200 mb-6">Return Information</h2>

            {/* Return Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">RETURN DATE *</label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">STATUS</label>
                <select
                  value={returnStatus}
                  onChange={(e) => setReturnStatus(e.target.value)}
                  className="select w-full"
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Processed">Processed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">RETURN REASON</label>
                <select
                  value="" // Not storing at header level
                  className="select w-full"
                >
                  <option value="" disabled>Select reason per item below</option>
                  {returnReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.reason_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Set reason for each item individually</p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">RETURN NOTES</label>
              <textarea
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="Additional notes for the return"
              />
            </div>
          </div>
        </div>

        {/* Original Purchase Details */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-slate-200 mb-6">Original Purchase Details</h2>

            {/* Purchase Information */}
            <div className="mb-5">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Purchase Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">INVOICE NUMBER</label>
                  <input
                    type="text"
                    value={formData.invoice_number}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILL REFERENCE</label>
                  <input
                    type="text"
                    value={formData.bill_reference}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STAFF MEMBER</label>
                  <input
                    type="text"
                    value={selectedStaffId ? staffList.find(s => s.id === selectedStaffId)?.staff_name || '' : ''}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">DATE</label>
                  <input
                    type="text"
                    value={formData.date}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
              </div>
            </div>

            {/* Vendor Information */}
            <div className="border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Vendor Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">VENDOR NAME</label>
                  <input
                    type="text"
                    value={selectedVendor?.vendor_name || ''}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER</label>
                  <input
                    type="text"
                    value={selectedVendor?.contact_no || ''}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={selectedVendor?.email || ''}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={selectedVendor?.tax_id || ''}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Return Item Selection */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-slate-200 mb-6">Return Item Selection</h2>

            {/* Items Table */}
            <div className="border border-slate-600 rounded mb-6">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-300">Product</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Purchase Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Unit Price</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Reason</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Tax</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.map((item) => (
                    <tr key={item.id} className="border-t border-slate-600">
                      <td className="px-4 py-3 text-sm text-white">{item.product_name}</td>
                      <td className="px-4 py-3 text-center text-sm text-slate-300">{item.qty}</td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max={item.qty}
                          value={item.return_qty}
                          onChange={(e) => updateReturnQuantity(item.id, parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-300">₹{item.rate.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <select
                          value={item.return_reason_id || 1}
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
                      <td className="px-4 py-3 text-center text-sm text-slate-300">
                        ₹{item.return_qty > 0 ? item.tax.toFixed(2) : '0.00'}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-green-400">
                        ₹{item.return_qty > 0 ? item.total.toFixed(2) : '0.00'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-700">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-medium text-slate-300">
                      TOTAL RETURN AMOUNT
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                      ₹{totalReturnTax.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                      ₹{totalReturnAmount.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {errors.noReturns && <p className="text-red-400 text-sm mt-2">{errors.noReturns}</p>}
            {errors.invalidQty && <p className="text-red-400 text-sm mt-2">{errors.invalidQty}</p>}

            {/* Return Notes */}
            {itemsBeingReturned.length > 0 && (
              <div className="border-t border-slate-600 pt-6">
                <h3 className="text-lg font-medium text-slate-200 mb-3">Return Summary</h3>
                <div className="bg-slate-700 rounded p-4 mb-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-slate-300 text-sm">Items Being Returned</p>
                      <p className="text-white font-semibold">{itemsBeingReturned.length}</p>
                    </div>
                    <div>
                      <p className="text-slate-300 text-sm">Total Return Quantity</p>
                      <p className="text-white font-semibold">{totalReturnQuantity}</p>
                    </div>
                    <div>
                      <p className="text-slate-300 text-sm">Return Amount</p>
                      <p className="text-green-400 font-semibold text-lg">₹{totalReturnAmount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Tax Breakdown Summary */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Vendor Credit (Tax Breakdown)</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-slate-300 text-sm">CGST</p>
                      <p className="text-red-400 font-semibold">-₹{itemsBeingReturned.reduce((sum, item) => sum + item.cgst, 0).toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-300 text-sm">SGST</p>
                      <p className="text-red-400 font-semibold">-₹{itemsBeingReturned.reduce((sum, item) => sum + item.sgst, 0).toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-300 text-sm">IGST</p>
                      <p className="text-red-400 font-semibold">-₹{itemsBeingReturned.reduce((sum, item) => sum + item.igst, 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {errors.submit && (
          <div className="bg-red-900 border border-red-700 rounded p-3">
            <p className="text-red-200 text-sm">{errors.submit}</p>
          </div>
        )}

        {/* Form Actions */}
        <div className="card">
          <div className="p-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/entry/purchasereturn')}
              className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Return...' : 'Create Return'}
            </button>
          </div>
        </div>
      </form>

      {/* Product Selection Side Panel */}
      <ProductSelectionPanel
        isOpen={isProductPanelOpen}
        onClose={() => setIsProductPanelOpen(false)}
        title="Select Product"
        showCarModelFilter={true}
        filterOptions={filterOptions}
        selectedCarModels={selectedPanelCarModels}
        onCarModelSelection={setSelectedPanelCarModels}
        searchedProducts={searchedProducts}
        productSearchTerm={productSearchTerm}
        onSearchTermChange={setProductSearchTerm}
        onProductSelect={(product) => {
          // For return creation, we don't add products - we modify existing ones
          return;
        }}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Create Purchase Return"
        message={`Are you sure you want to create a return for ${itemsBeingReturned.length} items totaling ₹${totalReturnAmount.toFixed(2)}? This will credit the vendor account.`}
        confirmText="Create Return"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Creating Return..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div>
  );
}
