import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Trash2, Calculator, Loader, Edit, Edit2 } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import SessionStorageService from '../../lib/sessionStorage';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';


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

interface Product {
  company_id?: number;
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
  selling_price?: number; // SP from MRP - discount + margin
  gst_rate_percentage?: number; // Actual GST percentage
  latest_purchase_rate?: number; // Latest purchase rate from database
  opening_rate?: number; // Opening rate from database
}

interface PurchaseItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string; // Add display_name field
  car_model: string;
  category: string;
  sub_category: string;
  company: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number; // GST percentage (e.g., 18)
  tax: number; // Total tax amount
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

interface Staff {
  id: number;
  name: string;
  phone: string;
  email?: string;
  status: string;
}

interface PurchaseFormData {
  invoice_number: string;
  bill_reference: string;
  bill_reference_date: string;
  staff_id?: number | null;
  date: string;
  vendor_name: string;
  contact_number: string;
  email_id: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  state_code?: number;
  gst_number: string;
  pin_code: string;
  transport_name: string;
  vehicle_number: string;
  transport_cost: string;
  // ===== LEGACY FIELDS - UNUSED (FOR REMOVAL) =====
  bill: string;         // @deprecated - legacy field, unclear purpose
  tax: string;          // @deprecated - legacy field, unclear purpose
  tax_rate: string;     // @deprecated - legacy field, unclear purpose
  basic_value: string;  // @deprecated - legacy field, unclear purpose
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  notes: string;
  total_tax: string;
  payment_status: number;
  payment_mode: number;
  // grand_total: string; // @deprecated - calculated field, removed from payload
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function PurchaseCreate() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<PurchaseItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [vendorIdToSave, setVendorIdToSave] = useState<number | null>(null);
  const [vendorStateForTax, setVendorStateForTax] = useState<string>(''); // Separate state for tax calculations
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isOtherVendorSelected, setIsOtherVendorSelected] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editPurchaseId, setEditPurchaseId] = useState<number | null>(null);
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState(false);

  // State for product selection row filters
  const [productRowFilters, setProductRowFilters] = useState({
    category: 0,
    categoryName: '',
    subcategory: 0,
    subcategoryName: '',
    carModels: [] as string[],
    company: 0,
    companyName: '',
    partNo: ''
  });

  // State for filtered subcategories based on selected category
  const [filteredSubcategories, setFilteredSubcategories] = useState<any[]>([]);

  // State for selected product in the table row
  const [selectedRowProduct, setSelectedRowProduct] = useState<Product | null>(null);

  // State for filtered car models based on selected product
  const [filteredCarModels, setFilteredCarModels] = useState<any[]>([]);

  // State for product selection side panel
  const [isProductPanelOpen, setIsProductPanelOpen] = useState(false);
  const [selectedPanelCarModel, setSelectedPanelCarModel] = useState<string>('');
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    gst: '0',
    total: ''
  });

  // State for selected vendor details (fetched on-demand, not stored in formData)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  // Tax is now always disabled
  const enableTax = false;

  // State for barcode scanning toggle
  const [enableBarcodeScanning, setEnableBarcodeScanning] = useState(false);

  // State for editing existing products
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // State for inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<PurchaseItem | null>(null);

  // State for delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<PurchaseItem | null>(null);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // State for states data
  const [states, setStates] = useState<{ id: string; name: string; code: number }[]>([]);

  // Auto-calculate total when qty, rate, or gst changes (only if total is empty)
  useEffect(() => {
    const qty = parseFloat(templateRow.qty) || 0;
    const rate = parseFloat(templateRow.rate) || 0;
    const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;

    if (qty > 0 && rate > 0) {
      const subtotal = qty * rate;
      const taxAmount = (subtotal * gstPercent) / 100;
      const total = subtotal + taxAmount;

      setTemplateRow(prev => {
        // Only auto-calculate if total field is empty (user hasn't manually entered anything)
        if (!prev.total.trim()) {
          return {
            ...prev,
            total: total.toFixed(2)
          };
        }
        // If user has entered something, leave it as-is
        return prev;
      });
    } else {
      setTemplateRow(prev => ({
        ...prev,
        total: prev.total || '' // Keep manual total if it exists
      }));
    }
  }, [templateRow.qty, templateRow.rate, templateRow.gst, enableTax]);

  const [formData, setFormData] = useState<PurchaseFormData>({
    invoice_number: '',
    bill_reference: '',
    bill_reference_date: '',
    staff_id: null,
    date: new Date().toISOString().split('T')[0],
    vendor_name: '', // Keep for backward compatibility with validation
    contact_number: '', // Remove these after validation is updated
    email_id: '',
    address: '',
    address_2: '',
    city: '',
    state: '',
    gst_number: '',
    pin_code: '',
    transport_name: '',
    vehicle_number: '',
    transport_cost: '',
    // ===== LEGACY FIELDS - UNUSED (FOR REMOVAL) =====
    bill: '',        // @deprecated - legacy field, unclear purpose
    tax: '',         // @deprecated - legacy field, unclear purpose
    tax_rate: '',    // @deprecated - legacy field, unclear purpose
    basic_value: '', // @deprecated - legacy field, unclear purpose
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    total_cgst: '',
    total_sgst: '',
    total_igst: '',
    notes: '',
    total_tax: '',
    payment_status: 0,
    payment_mode: 0
    // grand_total: '' // @deprecated - calculated field, removed from payload
  });

  // Check for edit mode and fetch data
  useEffect(() => {
    const { edit } = router.query;
    if (edit && typeof edit === 'string') {
      setIsEditMode(true);
      setEditPurchaseId(parseInt(edit));
      setInvoiceNumberLoading(false); // Not generating new invoice in edit mode

      // First try to get data from sessionStorage
      const cachedData = SessionStorageService.get('purchases', edit);
      if (cachedData) {
        console.log('🔄 Using cached purchase data from sessionStorage:', cachedData);
        populateFormWithPurchaseData(cachedData);
        // Remove the cached data after using it
        SessionStorageService.remove('purchases', edit);
      } else {
        // Fallback to API call if no cached data
        fetchPurchaseForEdit(parseInt(edit));
      }
    }
  }, [router.query]);

  // Set selected vendor when vendors are loaded in edit mode
  useEffect(() => {
    if (isEditMode && selectedVendorId && vendors.length > 0) {
      const vendor = vendors.find(v => v.id === selectedVendorId);
      if (vendor) {
        setSelectedVendor(vendor);
        setVendorStateForTax(vendor.state || '');
      }
    }
  }, [vendors, isEditMode, selectedVendorId]);

  // Fetch vendors, staff, and products on mount
  useEffect(() => {
    fetchVendors();
    fetchStaff();
    fetchProducts();
    fetchFilterOptions();
    fetchStates();
    // Only fetch last invoice number in create mode, not edit mode
    if (!isEditMode) {
      fetchLastInvoiceNumber();
    }
  }, [isEditMode]);

  // Broadcast listener for vendor creation
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((message) => {
      if (message.type === 'created' && message.resource === 'vendors') {
        console.log('📡 Received broadcast: New vendor created, refetching vendors...');
        fetchVendors();
      }
    });

    return unsubscribe;
  }, []);

  // Clear validation errors when side panel closes
  useEffect(() => {
    if (!isProductPanelOpen) {
      setErrors({});
    }
  }, [isProductPanelOpen]);

  // Passive barcode scanning for purchase items
  useBarcodeScanner({
    context: 'purchase',
    vendorState: vendorStateForTax,
    enabled: enableBarcodeScanning,
    onProductFound: (productData) => {
      const purchaseItem: PurchaseItem = {
        id: Date.now().toString(),
        ...productData
      };

      setSelectedProducts(prev => [...prev, purchaseItem]);
      showSnackbar('success', `${productData.product_name} added via barcode scan!`);
    },
    onError: (error) => {
      showSnackbar('warning', `Barcode scan error: ${error}`);
    }
  });

  // Function to generate dynamic product name in new format: UID CAR MODEL CATEGORY [SUBCATEGORY] COMPANY [PARTNUMBER]
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[], partNumber?: string): string => {
    const uid = product.id.toString();
    const carModelName = selectedCarModelIds.length > 0
      ? filterOptions.models.find(model => model.id.toString() === selectedCarModelIds[0])?.name || ''
      : '';
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name || '';
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name || '';
    const companyName = filterOptions.companies.find(comp => comp.id.toString() === (product.company_id || product.company)?.toString())?.name || product.company || '';

    // Build parts array - omit empty optional fields
    const parts = [uid, carModelName, categoryName];
    if (subcategoryName) parts.push(subcategoryName);
    parts.push(companyName);
    if (partNumber) parts.push(partNumber);

    return parts.join(' ');
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

  // useEffect to filter subcategories when category changes
  useEffect(() => {
    if (productRowFilters.category > 0) {
      const filtered = filterOptions.subcategories.filter(sub => sub.category_id === productRowFilters.category);
      setFilteredSubcategories(filtered);

      // Only clear subcategory if it's not valid for the new category
      const isCurrentSubcategoryValid = filtered.some(sub => sub.id === productRowFilters.subcategory);
      if (!isCurrentSubcategoryValid && productRowFilters.subcategory > 0) {
        setProductRowFilters(prev => ({
          ...prev,
          subcategory: null,
          subcategoryName: ''
        }));
      }
    } else {
      setFilteredSubcategories(filterOptions.subcategories);
    }
  }, [productRowFilters.category, productRowFilters.subcategory, filterOptions.subcategories]);

  // Helper functions to map IDs to display names

  // Function to handle product selection and update filters
  const handleProductSelection = (product: Product) => {
    setSelectedRowProduct(product);

    // Filter car models for this product
    const compatibleModels = getFilteredCarModelsForProduct(product);
    setFilteredCarModels(compatibleModels);

    // Look up names for category, subcategory, and company
    const categoryName = product.product_category_id
      ? filterOptions.categories.find(cat => cat.id === product.product_category_id)?.name || ''
      : '';

    const subcategoryName = product.product_subcategory_id
      ? filterOptions.subcategories.find(sub => sub.id === product.product_subcategory_id)?.name || ''
      : '';

    const companyId = product.company_id || 0;
    const companyName = companyId > 0
      ? filterOptions.companies.find(comp => comp.id === companyId)?.name || ''
      : '';

    // Initially set car models to unselected
    setProductRowFilters(prev => ({
      ...prev,
      category: product.product_category_id || 0,
      categoryName: categoryName,
      subcategory: product.product_subcategory_id || null,
      subcategoryName: subcategoryName,
      carModels: [product.car_model_ids.split(",")[0]],
      company: companyId,
      companyName: companyName,
      partNo: product.part_no || ''
    }));

    console.log('🔄 PRODUCT SELECTED:', {
      product: product.product_name,
      compatibleCarModels: compatibleModels.map(m => m.name),
      initialFilters: {
        category: product.product_category_id,
        categoryName: categoryName,
        subcategory: product.product_subcategory_id,
        subcategoryName: subcategoryName,
        carModels: [product.car_model_ids.split(",")[0]],
        company: companyId,
        companyName: companyName
      }
    });
  };

  // Handle product search and car model filtering via API calls
  useEffect(() => {
    fetchProducts(selectedPanelCarModel, productSearchTerm);
  }, [productSearchTerm, selectedPanelCarModel]);

  // Auto-product selection (simplified version - removed as per user request)
  // The user wanted to remove complex auto-selection logic, so this effect is now simplified
  useEffect(() => {
    // Removed complex auto-selection logic - now only side panel autofills filters
    // Manual filter selection doesn't auto-select products anymore
  }, []);

  // Auto-calculate tax totals when products change or vendor state changes
  useEffect(() => {
    if (selectedProducts.length === 0) return;

    // Only recalculate if vendor state actually changed due to vendor selection
    // Check if we need to update tax breakdowns
    const businessState = 'Uttar Pradesh';
    const isIntraState = vendorStateForTax === businessState;

    const needsUpdate = selectedProducts.some(item => {
      if (!enableTax) {
        // If tax is disabled, all tax values should be 0
        return item.cgst !== 0 || item.sgst !== 0 || item.igst !== 0 || item.tax !== 0;
      }

      const subtotal = item.qty * item.rate;
      const taxAmount = (subtotal * item.gst_percentage) / 100;

      if (isIntraState) {
        // Should have CGST + SGST, no IGST
        return item.cgst !== taxAmount / 2 || item.sgst !== taxAmount / 2 || item.igst !== 0;
      } else {
        // Should have IGST, no CGST + SGST
        return item.igst !== taxAmount || item.cgst !== 0 || item.sgst !== 0;
      }
    });

    if (!needsUpdate) return;

    // Recalculate tax breakdowns for ALL products based on current vendor state
    const updatedProducts = selectedProducts.map(item => {
      if (!enableTax) {
        // If tax is disabled, set all tax values to 0
        return { ...item, cgst: 0, sgst: 0, igst: 0, tax: 0 };
      }

      const subtotal = item.qty * item.rate;
      const taxAmount = (subtotal * item.gst_percentage) / 100;

      // Reset tax breakdown values
      let cgst = 0, sgst = 0, igst = 0;

      // Apply correct tax split based on current vendor state
      if (isIntraState) {
        cgst = taxAmount / 2;
        sgst = taxAmount / 2;
      } else {
        igst = taxAmount;
      }

      // Return updated item with correct tax breakdown
      return { ...item, cgst, sgst, igst, tax: taxAmount };
    });

    // Update products with corrected tax breakdowns
    setSelectedProducts(updatedProducts);
  }, [selectedProducts, vendorStateForTax, enableTax]);

  // Separate effect to update tax fields from product changes
  // Important: Only runs when products change AND not during initial data loading in edit mode
  useEffect(() => {
    // In edit mode, don't recalculate tax from products during initial load - preserve database values
    if (isEditMode && !isInitialDataLoaded) {
      return;
    }

    // If no products, reset tax fields to empty
    if (selectedProducts.length === 0) {
      setFormData(prev => ({
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
      return;
    }

    // Calculate totals from current products
    const totalCgst = selectedProducts.reduce((sum, item) => sum + item.cgst, 0);
    const totalSgst = selectedProducts.reduce((sum, item) => sum + item.sgst, 0);
    const totalIgst = selectedProducts.reduce((sum, item) => sum + item.igst, 0);

    // Auto-populate tax fields - ensure they always get updated
    setFormData(prev => ({
      ...prev,
      total_cgst: totalCgst.toFixed(2),
      total_sgst: totalSgst.toFixed(2),
      total_igst: totalIgst.toFixed(2)
    }));
  }, [selectedProducts, isEditMode, isInitialDataLoaded]);

  // Auto-calculate packing and forwarding total - DISABLED
  // Calculations are now done directly in onChange handlers to prevent cursor jumping
  // useEffect(() => {
  //   const qty = parseFloat(formData.packing_forwarding_qty) || 0;
  //   const rate = parseFloat(formData.packing_forwarding_rate) || 0;
  //   const total = qty * rate;

  //   if (total !== parseFloat(formData.packing_forwarding_total)) {
  //     setFormData(prev => ({
  //       ...prev,
  //       packing_forwarding_total: total.toFixed(2)
  //     }));
  //   }
  // }, [formData.packing_forwarding_qty, formData.packing_forwarding_rate]);

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/vendors?dropdown=true');
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

  const fetchProducts = async (modelFilter: string = '', searchTerm: string = '') => {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams();
      if (modelFilter) params.append('modelFilter', modelFilter);
      if (searchTerm) params.append('search', searchTerm);
      const url = `/api/products?${params.toString()}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      } else {
        showSnackbar('error', 'Failed to load products. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      showSnackbar('error', 'Failed to load products. Please try again.');
    } finally {
      setProductsLoading(false);
    }
  };
  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) {
        setFilterOptions(await response.json());
      } else {
        showSnackbar('error', 'Failed to load filter options. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
      showSnackbar('error', 'Failed to load filter options. Please try again.');
    }
  };

  const fetchStaff = async () => {
    try {
      const response = await fetch('/api/staff');
      if (response.ok) {
        const data = await response.json();
        setStaff(data.staff || []);
      } else {
        showSnackbar('error', 'Failed to load staff. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
      showSnackbar('error', 'Failed to load staff. Please try again.');
    }
  };

  const fetchStates = async () => {
    try {
      const response = await fetch('/api/states');
      if (response.ok) {
        const data = await response.json();
        // Transform states data to match SearchableSelect format
        const formattedStates = data.states.map((state: any) => ({
          id: state.id.toString(),
          name: state.state_name || state.name,
          code: state.code
        }));
        setStates(formattedStates);
      } else {
        showSnackbar('error', 'Failed to load states. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching states:', error);
      showSnackbar('error', 'Failed to load states. Please try again.');
    }
  };

  const fetchLastInvoiceNumber = async () => {
    if (isEditMode) return;

    try {
      const response = await fetch('/api/purchases/last-invoice');
      if (response.ok) {
        const data = await response.json();
        const lastInvoiceNum = data.lastInvoiceNumber || 0;
        const nextInvoiceNum = lastInvoiceNum + 1;
        setFormData(prev => ({ ...prev, invoice_number: nextInvoiceNum.toString() }));
      } else {
        showSnackbar('error', 'Failed to generate invoice number. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching last invoice number:', error);
      showSnackbar('error', 'Failed to generate invoice number. Please try again.');
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  // Extract form population logic to reusable function for cached data
  const populateFormWithPurchaseData = (cachedData: any) => {
    const purchase = cachedData.purchase || cachedData;

    // Format date for input fields
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

    // Prefill form data - preserve tax values from database
    setFormData({
      invoice_number: purchase.invoice_number || purchase.invoice_no?.toString() || '',
      bill_reference: purchase.bill_reference || '',
      bill_reference_date: purchase.bill_reference_date ? new Date(purchase.bill_reference_date).toISOString().split('T')[0] : '',
      staff_id: purchase.staff_id || null,
      date: formatDateForInput(purchase.date || purchase.invoice_date),
      vendor_name: purchase.vendor?.vendor_name || purchase.bill_reference,
      contact_number: purchase.vendor?.contact_no || '',
      email_id: purchase.vendor?.email || '',
      address: purchase.vendor?.address || '',
      address_2: purchase.vendor?.address_2 || '',
      city: purchase.vendor?.city || '',
      state: purchase.vendor?.state || '',
      gst_number: purchase.vendor?.tax_id || '',
      pin_code: '',
      transport_name: purchase.transport_name || purchase.transport || '',
      vehicle_number: purchase.vehicle_number || '',
      transport_cost: purchase.transport_cost?.toString() || purchase.freight?.toString() || '0',
      bill: '',
      tax: purchase.total_tax?.toString() || '0',
      descriptions: purchase.descriptions || '',
      packing_forwarding_qty: purchase.packing_forwarding_qty?.toString() || '0',
      packing_forwarding_rate: purchase.packing_forwarding_rate?.toString() || '0',
      packing_forwarding_total: purchase.packing_forwarding_total?.toString() || '0',
      tax_rate: purchase.taxrate?.toString() || '0',
      basic_value: purchase.total_taxable_value?.toString() || '0',
      total_cgst: purchase.total_cgst?.toString() || '0',
      total_sgst: purchase.total_sgst?.toString() || '0',
      total_igst: purchase.total_igst?.toString() || '0',
      notes: purchase.notes || '',
      total_tax: purchase.total_tax?.toString() || '0',
      payment_status: purchase.payment_status || purchase.status || 0,
      payment_mode: purchase.payment_mode || 1,
    });

    // Override with bill_to data if available (for inline editing)
    if (purchase.bill_to) {
      setFormData(prev => ({
        ...prev,
        vendor_name: purchase.bill_to.vendor_name || prev.vendor_name,
        contact_number: purchase.bill_to.contact_no || prev.contact_number,
        email_id: purchase.bill_to.email || prev.email_id,
        address: purchase.bill_to.address || prev.address,
        address_2: purchase.bill_to.address2 || prev.address_2,
        city: purchase.bill_to.city || prev.city,
        state: purchase.bill_to.state || prev.state,
        state_code: purchase.bill_to.state_code || prev.state_code,
        gst_number: purchase.bill_to.gstin || prev.gst_number,
        pin_code: purchase.bill_to.pin_code || prev.pin_code,
      }));
    }

    // Set vendor data - handle both regular vendors and "Other" vendor (vendor_id = 0)
    if (purchase.vendor_id !== undefined && purchase.vendor_id !== null) {
      if (purchase.vendor_id === 0) {
        // "Other" vendor selected
        setSelectedVendorId('0');
        setVendorIdToSave(0);
        setIsOtherVendorSelected(true);
      } else {
        // Regular vendor
        setSelectedVendorId(purchase.vendor_id.toString());
        setVendorIdToSave(purchase.vendor_id);
        setIsOtherVendorSelected(false);
      }
    }

    // Convert purchase items to local format
    if (purchase.items && purchase.items.length > 0) {
      const convertedItems: PurchaseItem[] = purchase.items.map((item: any, index: number) => {
        const qty = item.qty || 1;
        const rate = item.rate || 0;

        // Use existing tax breakdown from database if available, otherwise calculate
        const tax = item.tax || (item.subtotal ? (item.subtotal - (qty * rate)) : 0);
        const total = item.total || item.subtotal || (qty * rate + tax);

        // Preserve existing CGST/SGST/IGST if available, otherwise set to 0
        const cgst = item.cgst || 0;
        const sgst = item.sgst || 0;
        const igst = item.igst || 0;

        return {
          id: (index + 1).toString(),
          product_id: item.product_id || item.category_id || 1,
          product_name: item.product_name || item.name_of_product || '',
          car_model: item.car_model || '',
          category: item.category_id?.toString() || '',
          sub_category: item.subcategory_id?.toString() || '',
          company: item.company_id?.toString() || '',
          part_number: item.part_number || item.part || '',
          qty: qty,
          rate: rate,
          gst_percentage: item.gst_percentage || item.gst_rate || 0,
          tax: tax,
          cgst: cgst,
          sgst: sgst,
          igst: igst,
          total: total
        };
      });

      setSelectedProducts(convertedItems);
    }

    // Mark initial data loading as complete
    setIsInitialDataLoaded(true);
  };

  const fetchPurchaseForEdit = async (purchaseId: number) => {
    try {
      const response = await fetch(`/api/purchases/${purchaseId}`);
      if (response.ok) {
        const data = await response.json();
        const purchase = data.purchase || data;

        // Convert Unix timestamp to date string if needed
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

        // Prefill form data
        setFormData({
          invoice_number: purchase.invoice_number || purchase.invoice_no?.toString() || '',
          bill_reference: purchase.bill_reference || '',
          bill_reference_date: purchase.bill_reference_date ? new Date(purchase.bill_reference_date).toISOString().split('T')[0] : '',
          staff_id: purchase.staff_id || null,
          date: formatDateForInput(purchase.date || purchase.invoice_date),
          vendor_name: purchase.vendor?.vendor_name || purchase.bill_reference,
          contact_number: purchase.vendor?.contact_no || '',
          email_id: purchase.vendor?.email || '',
          address: purchase.vendor?.address || '',
          address_2: purchase.vendor?.address_2 || '',
          city: purchase.vendor?.city || '',
          state: purchase.vendor?.state || '',
          gst_number: purchase.vendor?.tax_id || '',
          pin_code: '',
          transport_name: purchase.transport_name || purchase.transport || '',
          vehicle_number: purchase.vehicle_number || '',
          transport_cost: purchase.transport_cost?.toString() || purchase.freight?.toString() || '0',
          bill: '',
          tax: purchase.total_tax?.toString() || '0',
          descriptions: purchase.descriptions || '',
          packing_forwarding_qty: purchase.packing_forwarding_qty?.toString() || '0',
          packing_forwarding_rate: purchase.packing_forwarding_rate?.toString() || '0',
          packing_forwarding_total: purchase.packing_forwarding_total?.toString() || '0',
          tax_rate: purchase.taxrate?.toString() || '0',
          basic_value: purchase.total_taxable_value?.toString() || '0',
          total_cgst: purchase.total_cgst?.toString() || '0',
          total_sgst: purchase.total_sgst?.toString() || '0',
          total_igst: purchase.total_igst?.toString() || '0',
          notes: purchase.notes || '',
          total_tax: purchase.total_tax?.toString() || '0',
          payment_status: purchase.payment_status || purchase.status || 0,
          payment_mode: purchase.payment_mode || 1,
        });

        // Set vendor data - only set IDs, selectedVendor will be set by useEffect when vendors load
        if (purchase.vendor_id) {
          setSelectedVendorId(purchase.vendor_id.toString());
          setVendorIdToSave(purchase.vendor_id);
        }

        // Convert purchase items to local format - preserve existing calculations
        // Wait for filter options to be loaded before converting items
        const convertItemsWithNames = async (rawItems: any[]) => {
          // Ensure filter options are loaded
          if (filterOptions.categories.length === 0) {

            // Return items with fallback names (will show as N/A if IDs don't match)
            return rawItems.map((item: any, index: number) => {
              const qty = item.qty || 1;
              const rate = item.rate || 0;
              const tax = item.tax || (item.subtotal ? (item.subtotal - (qty * rate)) : 0);
              const total = item.total || item.subtotal || (qty * rate + tax);
              const cgst = item.cgst || 0;
              const sgst = item.sgst || 0;
              const igst = item.igst || 0;

              return {
                id: (index + 1).toString(),
                product_id: item.product_id || item.category_id || 1,
                product_name: item.product_name || item.name_of_product || '',
                car_model: item.car_model || '',
                category: item.category || '',
                sub_category: item.sub_category || '',
                company: item.company || '',
                part_number: item.part_number || item.part || '',
                qty: qty,
                rate: rate,
                gst_percentage: item.gst_percentage || item.gst_rate || 0,
                tax: tax,
                cgst: cgst,
                sgst: sgst,
                igst: igst,
                total: total
              };
            });
          }

          return rawItems.map((item: any, index: number) => {
            const qty = item.qty || 1;
            const rate = item.rate || 0;

            // Use existing tax breakdown from database if available, otherwise calculate
            const tax = item.tax || (item.subtotal ? (item.subtotal - (qty * rate)) : 0);
            const total = item.total || item.subtotal || (qty * rate + tax);

            // Preserve existing CGST/SGST/IGST if available, otherwise set to 0
            const cgst = item.cgst || 0;
            const sgst = item.sgst || 0;
            const igst = item.igst || 0;

            // Map IDs to names using filter options - add debug logging
            const categoryOption = filterOptions.categories?.find(cat => cat.id === item.category_id);
            const subcategoryOption = filterOptions.subcategories?.find(sub => sub.id === item.subcategory_id);
            const companyOption = filterOptions.companies?.find(comp => comp.id === item.company_id && item.company_id !== 0);



            return {
              id: (index + 1).toString(),
              product_id: item.product_id || item.category_id || 1,
              product_name: item.product_name || item.name_of_product || '',
              car_model: item.car_model || '', // Keep as string - mapping to IDs would need complex logic
              category: item.category_id?.toString() || item.category || '', // Store category_id as string for dropdown
              sub_category: (item.subcategory_id && item.subcategory_id !== 0) ? item.subcategory_id.toString() : null, // Store subcategory_id as string for dropdown, but treat 0 as null
              company: item.company_id?.toString() || item.company || '', // Store company_id as string for dropdown
              part_number: item.part_number || item.part || '',
              qty: qty,
              rate: rate,
              gst_percentage: item.gst_percentage || item.gst_rate || 0, // Preserve existing GST percentage
              tax: tax,
              cgst: cgst,
              sgst: sgst,
              igst: igst,
              total: total
            };
          });
        };

        if (purchase.items && purchase.items.length > 0) {
          // Use converted items with proper names
          const convertedItems: PurchaseItem[] = await convertItemsWithNames(purchase.items);

          setSelectedProducts(convertedItems);
        }

        // Mark initial data loading as complete
        setIsInitialDataLoaded(true);
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

  const handleInputChange = (field: keyof PurchaseFormData, value: string) => {
    let processedValue: string | number | null = value;

    // Convert numeric fields to numbers
    if (field === 'payment_status' || field === 'payment_mode') {
      processedValue = parseInt(value) || 0;
    } else if (field === 'staff_id') {
      processedValue = value ? parseInt(value) : null;
    }

    setFormData(prev => ({ ...prev, [field]: processedValue }));

    // Update tax state if state field changes
    if (field === 'state') {
      setVendorStateForTax(value);
    }

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleVendorSelect = (vendorId: string) => {
    if (vendorId === '0') {
      // "Other" selected
      setVendorIdToSave(0);
      setSelectedVendorId('0');
      setSelectedVendor(null);
      setIsOtherVendorSelected(true);

      // Clear existing tax calculations and selected products
      setSelectedProducts([]);
      setSelectedRowProduct(null);

      setFormData(prev => ({
        ...prev,
        vendor_name: '', // Clear name for manual entry
        contact_number: '',
        email_id: '',
        address: '',
        address_2: '',
        city: '',
        state: '',
        state_code: undefined,
        gst_number: '',
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
      setVendorStateForTax('');
      return;
    }

    setIsOtherVendorSelected(false);
    const vendor = vendors.find(v => v.id === vendorId);
    if (vendor) {
      setVendorIdToSave(parseInt(vendor.id)); // Store vendor ID for API
      setSelectedVendor(vendor); // Store vendor object for UI display

      // Clear existing tax calculations and selected products when vendor changes
      setSelectedProducts([]); // Clear all selected products
      setSelectedRowProduct(null); // Clear selected product in form

      setFormData(prev => ({
        // Reset tax fields to empty so GST can be recalculated
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: '',
        // Auto-populate vendor details including state
        vendor_name: vendor.vendor_name,
        contact_number: vendor.contact_no || '',
        email_id: vendor.email || '',
        address: vendor.address || '',
        address_2: vendor.address_2 || '',
        city: vendor.city || '',
        state: vendor.state || '',
        state_code: vendor.state_code,
        gst_number: vendor.tax_id || ''
      }));
      setVendorStateForTax(vendor.state || ''); // Set separate state for tax calculations
    } else {
      // Clear vendor selection
      setVendorIdToSave(null);
      setSelectedVendor(null);
      setVendorStateForTax('');
    }
  };

  const addProductToPurchase = (product: Product) => {
    // Determine if intra-state or inter-state
    const businessState = 'Uttar Pradesh'; // TODO: Make this a configurable business setting
    const isIntraState = vendorStateForTax === businessState;

    const qty = 1;
    const rate = product.selling_price || product.rate || 0;
    const taxPercent = product.gst_rate_percentage || product.gst_rate || 0;
    const subtotal = qty * rate;
    const totalTaxAmount = (subtotal * taxPercent) / 100;

    // Split tax based on intra/inter-state
    let cgst = 0, sgst = 0, igst = 0;
    if (isIntraState) {
      cgst = totalTaxAmount / 2;
      sgst = totalTaxAmount / 2;
    } else {
      igst = totalTaxAmount;
    }

    const newItem: PurchaseItem = {
      id: Date.now().toString(),
      product_id: product.id,
      product_name: product.product_name,
      car_model: '',
      category: product.category_name || '',
      sub_category: product.subcategory_name || '',
      company: product.company || '',
      part_number: product.part_no || '',
      qty: qty,
      rate: rate,
      gst_percentage: taxPercent,
      tax: totalTaxAmount,
      cgst: cgst,
      sgst: sgst,
      igst: igst,
      total: subtotal + totalTaxAmount
    };

    setSelectedProducts(prev => [...prev, newItem]);
    setSearchTerm('');
  };

  const updateProductQuantity = (id: string, qty: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        const total = qty * item.rate;
        return { ...item, qty, total };
      }
      return item;
    }));
  };

  const handleEditProduct = (item: PurchaseItem) => {
    // Enable inline editing for this specific row
    setEditingRowId(item.id);

    // Calculate GST percentage from tax amount if not set or zero
    const gstPercentage = item.gst_percentage || (item.rate > 0 ? (item.tax / (item.qty * item.rate)) * 100 : 0);

    setEditingRowData({ ...item, gst_percentage: gstPercentage });
  };

  const saveInlineEdit = () => {
    if (editingRowId && editingRowData) {
      // Validate the editing data
      if (!editingRowData.qty || editingRowData.qty < 1) {
        setErrors({ inlineEdit: 'Quantity must be at least 1' });
        return;
      }
      if (!editingRowData.rate || editingRowData.rate <= 0) {
        setErrors({ inlineEdit: 'Rate must be greater than 0' });
        return;
      }

      // Calculate tax based on qty × rate (for tax breakdown purposes)
      const subtotal = editingRowData.qty * editingRowData.rate;
      const taxAmount = enableTax ? (subtotal * editingRowData.gst_percentage) / 100 : 0;

      // Use the manually entered total value, don't recalculate it
      const finalTotal = editingRowData.total || (subtotal + taxAmount);

      const updatedItem = {
        ...editingRowData,
        tax: taxAmount,
        total: finalTotal, // Preserve manually entered total value
        cgst: enableTax && vendorStateForTax === 'Uttar Pradesh' ? taxAmount / 2 : 0,
        sgst: enableTax && vendorStateForTax === 'Uttar Pradesh' ? taxAmount / 2 : 0,
        igst: enableTax && vendorStateForTax !== 'Uttar Pradesh' ? taxAmount : 0
      };

      // Update the item in selectedProducts
      setSelectedProducts(prev => prev.map(item =>
        item.id === editingRowId ? updatedItem : item
      ));

      // Clear editing state
      setEditingRowId(null);
      setEditingRowData(null);
      setErrors(prev => ({ ...prev, inlineEdit: '' }));
    }
  };

  const cancelInlineEdit = () => {
    setEditingRowId(null);
    setEditingRowData(null);
    setErrors(prev => ({ ...prev, inlineEdit: '' }));
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setSelectedRowProduct(null);
    setProductRowFilters({
      category: 0,
      categoryName: '',
      subcategory: null,
      subcategoryName: '',
      carModels: [],
      company: 0,
      companyName: '',
      partNo: ''
    });
    setTemplateRow({
      qty: '1',
      rate: '',
      gst: '0',
      total: ''
    });
  };

  const handleConfirmDelete = (item: PurchaseItem) => {
    if (isEditMode) {
      // Show confirmation modal only in edit mode
      setItemToDelete(item);
      setShowDeleteModal(true);
    } else {
      // Direct delete in create mode
      removeProduct(item.id);
    }
  };

  const confirmDeleteProduct = () => {
    if (itemToDelete) {
      removeProduct(itemToDelete.id);
      setShowDeleteModal(false);
      setItemToDelete(null);
    }
  };

  const removeProduct = (id: string) => {
    setSelectedProducts(prev => prev.filter(item => item.id !== id));
  };

  const subtotal = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + (item.qty * item.rate), 0);
  }, [selectedProducts]);

  const totalTax = useMemo(() => {
    // If user has manually set tax values, use those
    if (formData.total_cgst || formData.total_sgst || formData.total_igst) {
      const cgst = parseFloat(formData.total_cgst) || 0;
      const sgst = parseFloat(formData.total_sgst) || 0;
      const igst = parseFloat(formData.total_igst) || 0;
      return cgst + sgst + igst;
    }

    // Otherwise calculate from items
    return selectedProducts.reduce((sum, item) => sum + item.cgst + item.sgst + item.igst, 0);
  }, [selectedProducts, formData.total_cgst, formData.total_sgst, formData.total_igst]);

  const grandTotal = useMemo(() => {
    const packingTotal = parseFloat(formData.packing_forwarding_total) || 0;

    return subtotal + packingTotal + totalTax;
  }, [subtotal, totalTax, formData.packing_forwarding_total]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (editingRowId) {
      newErrors.inlineEdit = 'Please save or cancel the inline edit before submitting';
    }
    if (!formData.invoice_number.trim()) {
      newErrors.invoice_number = 'Invoice number is required';
    }
    if (!selectedVendorId) {
      newErrors.vendor_name = 'Please select a vendor';
    }
    if (isOtherVendorSelected && !formData.vendor_name.trim()) {
      newErrors.vendor_name = 'Vendor name is required';
    }
    // State is now optional for "Other" vendor
    if (isOtherVendorSelected && !formData.contact_number.trim()) {
      newErrors.contact_number = 'Phone number is required';
    }
    if (selectedProducts.length === 0) {
      newErrors.products = 'At least one product is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setShowConfirmationModal(true);
  };

  const handleConfirmSubmit = async () => {
    // Basic validation for purchase submission
    const validationErrors: string[] = [];

    // Check for minimum requirements
    if (selectedProducts.length === 0) {
      validationErrors.push('At least one product must be added');
    }

    if (!selectedVendorId) {
      validationErrors.push('Please select a vendor first');
    }

    if (!formData.invoice_number.trim()) {
      validationErrors.push('Invoice number is required');
    }

    if (validationErrors.length > 0) {
      setErrors({
        products: validationErrors.join('\n')
      });
      return;
    }

    // Clear any previous errors
    setErrors({});

    // For edit mode, also warn about potential stock changes
    if (isEditMode && selectedProducts.length > 0) {
      showSnackbar('info', 'Note: Editing purchase items may affect inventory stock levels');
    }

    setLoading(true);

    try {
      // ===== PAYLOAD CONSTRUCTION =====
      // For PUT requests, exclude invoice_number since API identifies by ID, not invoice number
      // For POST requests, include invoice_number as it's required for creation
      const baseSubmitData = {
        bill_reference: formData.bill_reference,
        staff_id: formData.staff_id,
        date: formData.date,
        vendor_id: vendorIdToSave,
        // ===== VENDOR DETAILS - ALWAYS INCLUDE FOR bill_to TABLE =====
        vendor_name: formData.vendor_name,
        contact_number: formData.contact_number,
        email_id: formData.email_id,
        address: formData.address,
        address_2: formData.address_2,
        city: formData.city,
        state: formData.state,
        state_code: formData.state_code,
        gst_number: formData.gst_number,
        pin_code: formData.pin_code || '',
        transport_name: formData.transport_name,
        vehicle_number: formData.vehicle_number,
        transport_cost: parseFloat(formData.transport_cost) || 0,
        items: selectedProducts.map(item => {
          // Parse the stored IDs directly (they're already strings containing the IDs)
          const categoryId = item.category ? parseInt(item.category) : null;
          const subcategoryId = item.sub_category ? parseInt(item.sub_category) : null;
          const companyId = item.company ? parseInt(item.company) : null;

          // Convert selected car model IDs to names for display
          const carModelNames = productRowFilters.carModels
            .map(id => {
              const model = filterOptions.models.find(m => m.id.toString() === id);
              return model ? model.name : '';
            })
            .filter(name => name)
            .join(', ');

          // Get model_id from the first selected car model, or look up from car_model string
          let modelId = null;
          if (productRowFilters.carModels.length > 0) {
            modelId = parseInt(productRowFilters.carModels[0]);
          } else if (item.car_model && item.car_model.trim()) {
            // Look up model_id from car_model string using filterOptions
            const carModelRecord = filterOptions.models.find(
              model => model.name.trim() === item.car_model.trim()
            );
            if (carModelRecord) {
              modelId = carModelRecord.id;
            }
          }

          return {
            product_id: item.product_id,
            product_name: item.product_name,
            category_id: categoryId,
            subcategory_id: subcategoryId,
            company_id: companyId,
            model_id: modelId,
            car_model: carModelNames || item.car_model || '',
            part: item.part_number,
            qty: item.qty,
            rate: item.rate,
            gst_percentage: item.gst_percentage || 0,
            cgst: item.cgst || 0,
            sgst: item.sgst || 0,
            igst: item.igst || 0,
            tax: item.tax || 0,
            total: item.total,
          };
        }),
        descriptions: formData.descriptions,
        packing_forwarding_qty: parseFloat(formData.packing_forwarding_qty) || 0,
        packing_forwarding_rate: parseFloat(formData.packing_forwarding_rate) || 0,
        packing_forwarding_total: parseFloat(formData.packing_forwarding_total) || 0,
        total_cgst: parseFloat(formData.total_cgst) || 0,
        total_sgst: parseFloat(formData.total_sgst) || 0,
        total_igst: parseFloat(formData.total_igst) || 0,
        notes: formData.notes,
        total_tax: totalTax,
        payment_status: formData.payment_status || 0,
        payment_mode: formData.payment_mode || 0,
      };

      // Add invoice_number only for POST (creation), exclude from PUT (update)
      const submitData = isEditMode
        ? baseSubmitData  // PUT: No invoice_number needed
        : { ...baseSubmitData, invoice_number: formData.invoice_number }; // POST: Include invoice_number

      const method = isEditMode ? 'PUT' : 'POST';
      const url = isEditMode ? `/api/purchases/${editPurchaseId}` : '/api/purchases';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      // Always close modal after API call completes
      setShowConfirmationModal(false);

      if (response.ok) {
        // Clean up sessionStorage on successful update
        if (isEditMode && editPurchaseId) {
          SessionStorageService.remove('purchases', editPurchaseId.toString());
        }

        // Broadcast the creation/update event
        const purchaseId = isEditMode ? editPurchaseId : (response as any).purchase?.id || (response as any).id;
        broadcast({
          type: isEditMode ? 'updated' : 'created',
          resource: 'purchases',
          data: { id: purchaseId }
        });

        // Navigate to purchase view page for both create and update
        if (purchaseId) {
          router.push(`/purchases/view/${purchaseId}`);
        } else {
          // Fallback to purchases list if no purchase ID
          router.push('/purchases');
        }

        // Show success snackbar after navigation
        showSnackbar('success', `Purchase ${isEditMode ? 'updated' : 'created'} successfully!`);
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || `Failed to ${isEditMode ? 'update' : 'create'} purchase`);
      }
    } catch (error) {
      // Always close modal on network error
      setShowConfirmationModal(false);
      showSnackbar('error', 'Network error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };



  const handleCancelSubmit = () => {
    setShowConfirmationModal(false);
  };

  return (
    <div className="space-y-3">

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-3">

            {/* Invoice Information */}
            <div className="mb-5">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">INVOICE NUMBER *</label>
                  {invoiceNumberLoading ? (
                    <div className="input w-full flex items-center justify-center bg-slate-700 border border-slate-600 rounded">
                      <Loader className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                      <span className="text-sm text-slate-400">Loading...</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formData.invoice_number}
                      onChange={(e) => handleInputChange('invoice_number', e.target.value)}
                      className="input w-full"
                      placeholder="Enter invoice number"
                      disabled={invoiceNumberLoading}
                    />
                  )}
                  {errors.invoice_number && <p className="text-red-400 text-xs mt-1">{errors.invoice_number}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILL REFERENCE</label>
                  <input
                    type="text"
                    value={formData.bill_reference}
                    onChange={(e) => handleInputChange('bill_reference', e.target.value)}
                    className="input w-full"
                    placeholder="Enter bill reference"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILL REFERENCE DATE</label>
                  <input
                    type="date"
                    value={formData.bill_reference_date}
                    onChange={(e) => handleInputChange('bill_reference_date', e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STAFF MEMBER</label>
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Staff' },
                      ...staff.map((member) => ({
                        id: member.id.toString(),
                        name: `${member.name} - ${member.phone}`
                      }))
                    ]}
                    selectedValue={formData.staff_id?.toString() || ''}
                    onSelectionChange={(value) => handleInputChange('staff_id', value || '')}
                    placeholder="Select Staff"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">DATE</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleInputChange('date', e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>
            </div>

            {/* Vendor Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Vendor Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">VENDOR NAME *</label>
                    <a
                      href="/vendors/create?from=purchase"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors"
                    >
                      + Add New Vendor
                    </a>
                  </div>
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Vendor' },
                      { id: '0', name: 'Other' },
                      ...vendors.map((vendor) => ({
                        id: vendor.id.toString(),
                        name: vendor.vendor_name
                      }))
                    ]}
                    selectedValue={selectedVendorId}
                    onSelectionChange={(value) => {
                      const vendorId = value || '';
                      setSelectedVendorId(vendorId);
                      handleVendorSelect(vendorId);
                    }}
                    placeholder="Select Vendor"
                  />
                  {errors.vendor_name && <p className="text-red-400 text-xs mt-1">{errors.vendor_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER{isOtherVendorSelected ? ' *' : ''}</label>
                  <input
                    type="text"
                    value={formData.contact_number || selectedVendor?.contact_no || ''}
                    onChange={(e) => handleInputChange('contact_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter contact number"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={formData.email_id || selectedVendor?.email || ''}
                    onChange={(e) => handleInputChange('email_id', e.target.value)}
                    className="input w-full"
                    placeholder="Enter email address"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={formData.gst_number || selectedVendor?.tax_id || ''}
                    onChange={(e) => handleInputChange('gst_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter GST number"
                  />
                </div>
              </div>
              <div className={`grid grid-cols-1 ${isOtherVendorSelected ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                {isOtherVendorSelected && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">MANUAL VENDOR NAME *</label>
                    <input
                      type="text"
                      value={formData.vendor_name}
                      onChange={(e) => handleInputChange('vendor_name', e.target.value)}
                      className="input w-full"
                      placeholder="Enter vendor name"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">LINE 1</label>
                  <input
                    type="text"
                    value={formData.address || selectedVendor?.address || ''}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    className="input w-full"
                    placeholder="Enter address line 1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">LINE 2</label>
                  <input
                    type="text"
                    value={formData.address_2 || selectedVendor?.address_2 || ''}
                    onChange={(e) => handleInputChange('address_2', e.target.value)}
                    className="input w-full"
                    placeholder="Enter address line 2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CITY</label>
                  <input
                    type="text"
                    value={formData.city || selectedVendor?.city || ''}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className="input w-full"
                    placeholder="Enter city"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STATE</label>
                  <SearchableSelect
                    options={states.map((state) => ({
                      id: state.id,
                      name: state.name
                    }))}
                    selectedValue={(() => {
                      // Find the state ID that matches the current state code
                      if (selectedVendor?.state_code) {
                        const matchingState = states.find(state => state.code === selectedVendor.state_code);
                        return matchingState ? matchingState.id : '';
                      }
                      // Fallback to state name matching if no state code
                      if (formData.state || selectedVendor?.state) {
                        const currentStateName = formData.state || selectedVendor?.state || '';
                        const matchingState = states.find(state => state.name === currentStateName);
                        return matchingState ? matchingState.id : '';
                      }
                      return '';
                    })()}
                    onSelectionChange={(value) => {
                      if (value) {
                        // Find the state name and code from the selected ID
                        const selectedState = states.find(state => state.id === value);
                        if (selectedState) {
                          handleInputChange('state', selectedState.name);
                          setFormData(prev => ({ ...prev, state_code: selectedState.code }));
                        }
                      } else {
                        handleInputChange('state', '');
                        setFormData(prev => ({ ...prev, state_code: undefined }));
                      }
                    }}
                    placeholder="Select State"
                  />
                </div>
              </div>
            </div>


            {/* Transport Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Transport Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">TRANSPORT NAME</label>
                  <input
                    type="text"
                    value={formData.transport_name}
                    onChange={(e) => handleInputChange('transport_name', e.target.value)}
                    className="input w-full"
                    placeholder="Enter transport name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">VEHICLE NUMBER</label>
                  <input
                    type="text"
                    value={formData.vehicle_number}
                    onChange={(e) => handleInputChange('vehicle_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter vehicle number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">TRANSPORT COST</label>
                  <input
                    type="number"
                    value={formData.transport_cost}
                    onChange={(e) => handleInputChange('transport_cost', e.target.value)}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
                <div></div> {/* Empty column for 4-column layout */}
              </div>
            </div>



            {/* Product Selection */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Product Selection</h3> */}

              {/* Barcode Scanning Toggle */}
              <div className="mb-4 space-y-3">
                <div className="flex items-center space-x-6">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableBarcodeScanning}
                      onChange={(e) => setEnableBarcodeScanning(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="text-sm font-medium text-slate-300">Enable Barcode Scanning</span>
                  </label>
                  <span className="text-xs text-slate-500">
                    {enableBarcodeScanning ? 'Barcode scanner is active - scan barcodes to add products' : 'Barcode scanner is disabled - normal typing in inputs'}
                  </span>
                </div>

                {/* Barcode Test Input */}
                <div className="flex items-center space-x-3 p-3 bg-slate-800 rounded border border-slate-600">
                  <label className="text-sm font-medium text-slate-300">Test Barcode:</label>
                  <input
                    type="text"
                    placeholder="Enter barcode to test..."
                    className="input flex-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const testBarcode = (e.target as HTMLInputElement).value.trim();
                        if (testBarcode) {
                          console.log('🧪 Manual barcode test:', testBarcode);
                          // Simulate barcode scanning by calling the same logic
                          const mockEvent = {
                            key: 'Enter',
                            preventDefault: () => {},
                            stopPropagation: () => {}
                          };

                          // Manually trigger the barcode lookup
                          (async () => {
                            try {
                              const params = new URLSearchParams({
                                code: testBarcode,
                                context: 'purchase',
                                ...(vendorStateForTax && { vendorState: vendorStateForTax })
                              });

                              console.log('🧪 Test API request:', `/api/barcode/lookup?${params}`);

                              const response = await fetch(`/api/barcode/lookup?${params}`);
                              const data = await response.json();

                              console.log('🧪 Test API response:', data);

                              if (data.success && data.product) {
                                console.log('✅ Test product found:', data.product.product_name);
                                const purchaseItem: PurchaseItem = {
                                  id: Date.now().toString(),
                                  ...data.product
                                };
                                setSelectedProducts(prev => [...prev, purchaseItem]);
                                showSnackbar('success', `${data.product.product_name} added via test barcode!`);
                              } else {
                                console.error('❌ Test product lookup failed:', data.error);
                                showSnackbar('warning', `Test barcode error: ${data.error || 'Product not found'}`);
                              }
                            } catch (error) {
                              console.error('💥 Test barcode lookup error:', error);
                              showSnackbar('error', 'Test barcode lookup failed');
                            }
                          })();

                          (e.target as HTMLInputElement).value = '';
                        }
                      }
                    }}
                  />
                  <span className="text-xs text-slate-500">Press Enter to test</span>
                </div>
              </div>

              {/* Product Selection & Display Table */}
              <div className={`border border-slate-600 rounded mb-3`}>
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-16">
                        SN
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        PRODUCT NAME
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        CATEGORY
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        SUB CATEGORY
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        CAR MODELS
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        COMPANY
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        PART NO
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">
                        QTY
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">
                        RATE
                      </th>
                      {enableTax && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                          TAX (%)
                        </th>
                      )}
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                        TOTAL
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                        ACTION
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Input Row (Template) */}
                    <tr className="bg-slate-800 border-b-2 border-slate-600">
                      <td className="px-4 py-3 text-center w-16">
                        {/* Hidden SN column to maintain alignment */}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            // Clear any existing validation errors when opening panel
                            setErrors({});
                            setProductSearchTerm(''); // Clear search when opening panel
                            setIsProductPanelOpen(true);
                          }}
                          disabled={!selectedVendorId}
                          className={`w-full px-3 py-2 border rounded text-xs text-white text-left transition-colors ${selectedVendorId
                            ? 'bg-slate-700 border-slate-600 hover:bg-slate-600'
                            : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                          title={!selectedVendorId ? 'Please select a vendor first' : ''}
                        >
                          {selectedRowProduct ? (
                            selectedRowProduct.product_name || 'Select Product'
                          ) : (
                            <span className="text-slate-400">Select Product</span>
                          )}
                        </button>

                      </td>
                      <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: 'Select Category' },
                            ...filterOptions.categories.map((cat) => ({
                              id: cat.id.toString(),
                              name: cat.name
                            }))
                          ]}
                          selectedValue={productRowFilters.category.toString()}
                          onSelectionChange={(value) => {
                            const numValue = value ? parseInt(value) : 0;
                            const selectedOption = filterOptions.categories.find(cat => cat.id === numValue);
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: numValue,
                              categoryName: selectedOption?.name || ''
                            }));
                          }}
                          placeholder="Select Category"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: 'Select Sub Category' },
                            ...filteredSubcategories.map((sub) => ({
                              id: sub.id.toString(),
                              name: sub.name
                            }))
                          ]}
                          selectedValue={productRowFilters.subcategory?.toString() || ''}
                          onSelectionChange={(value) => {
                            const numValue = value ? parseInt(value) : null;
                            const selectedOption = filteredSubcategories.find(sub => sub.id === numValue);
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: numValue,
                              subcategoryName: selectedOption?.name || ''
                            }));
                          }}
                          placeholder="Select Sub Category"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <SearchableMultiSelect
                          mode="single"
                          options={filteredCarModels.map(model => ({ id: model.id.toString(), name: model.name })) || []}
                          selectedValue={productRowFilters.carModels.length > 0 ? productRowFilters.carModels[0] : null}
                          onSelectionChange={(value) => {
                            const newSelection = value ? [value] : [];

                            // Update car models in filters
                            setProductRowFilters(prev => ({
                              ...prev,
                              carModels: newSelection
                            }));

                            // Update the product name directly when car models change
                            if (selectedRowProduct) {
                              if (value) {
                                const updatedProductName = generateDynamicProductName(selectedRowProduct, [value], productRowFilters.partNo);

                                // Update the product's name directly
                                setSelectedRowProduct(prev => prev ? {
                                  ...prev,
                                  product_name: updatedProductName
                                } : null);
                              }
                            }
                          }}
                          placeholder="Select car model..."
                        />
                      </td>
                      <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: 'Select Company' },
                            ...filterOptions.companies.map((comp) => ({
                              id: comp.id.toString(),
                              name: comp.name
                            }))
                          ]}
                          selectedValue={productRowFilters.company.toString()}
                          onSelectionChange={(value) => {
                            const numValue = value ? parseInt(value) : 0;
                            const selectedOption = filterOptions.companies.find(comp => comp.id === numValue);
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: numValue,
                              companyName: selectedOption?.name || ''
                            }));
                          }}
                          placeholder="Select Company"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-400"
                          placeholder="Part number..."
                          value={productRowFilters.partNo}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              partNo: e.target.value
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-24">
                        <input
                          type="number"
                          min="1"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="1"
                          value={templateRow.qty}
                          onChange={(e) => {
                            const newQty = e.target.value;
                            const qty = parseFloat(newQty) || 0;
                            const rate = parseFloat(templateRow.rate) || 0;
                            const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;

                            if (qty > 0 && rate > 0) {
                              // Calculate total = qty * rate
                              const subtotal = qty * rate;
                              const taxAmount = (subtotal * gstPercent) / 100;
                              const total = subtotal + taxAmount;

                              setTemplateRow(prev => ({
                                ...prev,
                                qty: newQty,
                                total: total.toFixed(2)
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                qty: newQty,
                                total: ''
                              }));
                            }
                          }}
                          onWheel={(e) => e.preventDefault()}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-24">
                        <input
                          type="number"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0.00"
                          value={templateRow.rate}
                          onChange={(e) => {
                            const newRate = e.target.value;
                            const qty = parseFloat(templateRow.qty) || 0;
                            const rate = parseFloat(newRate) || 0;
                            const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;

                            if (qty > 0 && rate > 0) {
                              // Calculate total = qty * rate
                              const subtotal = qty * rate;
                              const taxAmount = (subtotal * gstPercent) / 100;
                              const total = subtotal + taxAmount;

                              setTemplateRow(prev => ({
                                ...prev,
                                rate: newRate,
                                total: total.toFixed(2)
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                rate: newRate,
                                total: ''
                              }));
                            }
                          }}
                          onWheel={(e) => e.preventDefault()}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </td>
                      {enableTax && (
                        <td className="px-4 py-3 text-center w-20">
                          <input
                            type="number"
                            className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                            placeholder="0%"
                            value={templateRow.gst}
                            onChange={(e) => {
                              setTemplateRow(prev => ({
                                ...prev,
                                gst: e.target.value
                              }));
                            }}
                            onWheel={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                e.preventDefault();
                              }
                            }}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-center w-20">
                        <input
                          type="number"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0.00"
                          value={templateRow.total}
                          onChange={(e) => {
                            const newTotal = e.target.value;
                            const qty = parseFloat(templateRow.qty) || 0;
                            const enteredTotal = parseFloat(newTotal) || 0;

                            if (qty > 0 && enteredTotal > 0) {
                              // Calculate rate = total / qty
                              const rate = enteredTotal / qty;
                              setTemplateRow(prev => ({
                                ...prev,
                                total: newTotal,
                                rate: rate.toFixed(2)
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                total: newTotal,
                                rate: ''
                              }));
                            }
                          }}
                          onWheel={(e) => e.preventDefault()}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              // Validation: Check for required fields
                              const validationErrors: string[] = [];

                              if (productRowFilters.category <= 0) {
                                validationErrors.push('Category is required');
                              }
                              if (productRowFilters.carModels.length === 0) {
                                validationErrors.push('At least one car model is required');
                              }
                              if (productRowFilters.company <= 0) {
                                validationErrors.push('Company is required');
                              }
                              if (!templateRow.rate || parseFloat(templateRow.rate) <= 0) {
                                validationErrors.push('Valid rate is required');
                              }

                              if (validationErrors.length > 0) {
                                setErrors({ addProduct: validationErrors.join(', ') });
                                return;
                              }

                              if (selectedRowProduct !== null) {
                                const selectedProduct = selectedRowProduct;
                                if (selectedProduct) {
                                  // Use product details and template values
                                  const qty = parseFloat(templateRow.qty) || 1;
                                  const rate = parseFloat(templateRow.rate) || selectedProduct.selling_price || 0;
                                  const gstPercent = enableTax ? (templateRow.gst !== '0' ? parseFloat(templateRow.gst) : 0) : 0;
                                  const subtotal = qty * rate;
                                  const taxAmount = enableTax ? (subtotal * gstPercent) / 100 : 0;

                                  // Calculate tax breakdown (assume intra-state for now: CGST + SGST)
                                  const cgst = enableTax ? taxAmount / 2 : 0;
                                  const sgst = enableTax ? taxAmount / 2 : 0;
                                  const igst = 0;

                                  // Convert car model IDs to names for display
                                  const carModelNames = productRowFilters.carModels
                                    .map(id => {
                                      const model = filterOptions.models.find(m => m.id.toString() === id);
                                      return model ? model.name : id;
                                    })
                                    .filter(name => name)
                                    .join(', ');

                                  // Use filter data - the filters are auto-filled from product selection
                                  const categoryId = productRowFilters.category; // Already a string
                                  const subcategoryId = productRowFilters.subcategory; // Already a string
                                  const companyId = productRowFilters.company || selectedProduct.company || ''; // Use filter if set, fallback to product

                                  const itemData: PurchaseItem = {
                                    id: editingItemId || Date.now().toString(),
                                    product_id: selectedProduct.id,
                                    product_name: selectedProduct.product_name,
                                    display_name: selectedProduct.display_name,
                                    car_model: carModelNames || '',
                                    category: productRowFilters.category?.toString(),
                                    sub_category: productRowFilters.subcategory?.toString(),
                                    company: productRowFilters.company.toString(),
                                    part_number: productRowFilters.partNo,
                                    qty: qty,
                                    rate: rate,
                                    gst_percentage: gstPercent,
                                    tax: taxAmount,
                                    cgst: cgst,
                                    sgst: sgst,
                                    igst: igst,
                                    total: subtotal + taxAmount
                                  };

                                  if (editingItemId) {
                                    // Update existing item
                                    setSelectedProducts(prev =>
                                      prev.map(item =>
                                        item.id === editingItemId ? itemData : item
                                      )
                                    );
                                    setEditingItemId(null);
                                  } else {
                                    // Add new item
                                    setSelectedProducts(prev => [...prev, itemData]);
                                  }

                                  // Clear any validation errors
                                  setErrors(prev => ({ ...prev, addProduct: '' }));

                                  // Reset form
                                  setSelectedRowProduct(null);
                                  setProductRowFilters({
                                    category: 0,
                                    categoryName: '',
                                    subcategory: 0,
                                    subcategoryName: '',
                                    carModels: [],
                                    company: 0,
                                    companyName: '',
                                    partNo: ''
                                  });
                                  setTemplateRow({
                                    qty: '1',
                                    rate: '',
                                    gst: '0',
                                    total: ''
                                  });
                                }
                              }
                            }}
                            disabled={!selectedRowProduct}
                            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${selectedRowProduct
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                              }`}
                          >
                            {editingItemId ? 'Update' : 'Add'}
                          </button>

                          {selectedRowProduct && (
                            <button
                              type="button"
                              onClick={() => {
                                // Clear the template row
                                setSelectedRowProduct(null);
                                setProductRowFilters({
                                  category: 0,
                                  categoryName: '',
                                  subcategory: null,
                                  subcategoryName: '',
                                  carModels: [],
                                  company: 0,
                                  companyName: '',
                                  partNo: ''
                                });
                                setTemplateRow({
                                  qty: '1',
                                  rate: '',
                                  gst: '0',
                                  total: ''
                                });
                                setErrors(prev => ({ ...prev, addProduct: '' }));
                              }}
                              className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                              title="Clear selection"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Added Products Rows */}
                    {selectedProducts.map((product, index) => (
                      <tr key={product.id} className={`${editingRowId === product.id ? 'bg-yellow-900' : 'bg-slate-800 hover:bg-slate-750'} border-t border-slate-600`}>
                        <td className="px-4 py-3 text-center text-xs text-slate-300">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {editingRowId === product.id ? (editingRowData?.display_name || editingRowData?.product_name) : (product.display_name || product.product_name)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {(() => {
                            const catOption = filterOptions.categories.find(cat => cat.id.toString() === product.category);
                            return catOption?.name || product.category;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {(() => {
                            const subCatOption = filterOptions.subcategories.find(sub => sub.id.toString() === product.sub_category);
                            return subCatOption?.name || product.sub_category;
                          })()}
                        </td>
                        {editingRowId === product.id ? (
                          <td className="px-4 py-3">
                            {(() => {
                              // Find the product being edited
                              const editingProduct = products.find(p => p.id === product.product_id);
                              // Filter compatible models for this product
                              const compatibleModels = editingProduct ? getFilteredCarModelsForProduct(editingProduct) : [];
                              // Convert current car_model name to model_id for pre-selection
                              const currentModel = filterOptions.models.find(model => model.name.trim() === editingRowData?.car_model?.trim());
                              const selectedModelId = currentModel ? currentModel.id.toString() : '';

                              return (
                                <SearchableMultiSelect
                                  options={compatibleModels.map(model => ({ id: model.id.toString(), name: model.name })) || []}
                                  selectedValues={[selectedModelId].filter(Boolean)}
                                  onSelectionChange={(values) => {
                                    // For inline editing, only allow single car model selection
                                    let newCarModel = '';
                                    let updatedProductName = editingRowData?.product_name || '';

                                    if (values.length > 0) {
                                      const selectedModel = compatibleModels.find(model => model.id.toString() === values[0]);
                                      newCarModel = selectedModel ? selectedModel.name : '';

                                      // Update the product name directly when car model changes
                                      if (newCarModel && editingRowData?.product_name) {
                                        // Find the product being edited to get full details
                                        const editingProduct = products.find(p => p.id === product.product_id);
                                        if (editingProduct) {
                                          updatedProductName = generateDynamicProductName(editingProduct, [values[0]], editingRowData.part_number);
                                        }
                                      }
                                    }

                                    // Update editing row data with both car model and updated product name
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      car_model: newCarModel,
                                      product_name: updatedProductName
                                    } : null);
                                  }}
                                  placeholder="Select car model..."
                                />
                              );
                            })()}
                          </td>
                        ) : (
                          <td className="px-4 py-3 text-xs text-slate-200">
                            {product.car_model}
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {(() => {
                            const compOption = filterOptions.companies.find(comp => comp.id.toString() === product.company);
                            return compOption?.name || product.company;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.part_number || 'N/A'}
                        </td>
                        {editingRowId === product.id ? (
                          <>
                            {/* Editable fields when inline editing */}
                            <td className="px-4 py-3 text-center w-24">
                              <input
                                type="number"
                                min="1"
                                className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                placeholder="1"
                                value={editingRowData?.qty || ''}
                                onChange={(e) => {
                                  const newQty = e.target.value;
                                  const qty = parseFloat(newQty) || 0;
                                  const rate = editingRowData?.rate || 0;
                                  const gstPercent = enableTax ? (editingRowData?.gst_percentage || 0) : 0;

                                  if (qty > 0 && rate > 0) {
                                    const subtotal = qty * rate;
                                    const taxAmount = (subtotal * gstPercent) / 100;
                                    const total = subtotal + taxAmount;
                                    
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      qty: parseFloat(newQty) || 1,
                                      total: total
                                    } : null);
                                  } else {
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      qty: parseFloat(newQty) || 1
                                    } : null);
                                  }
                                }}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </td>
                            <td className="px-4 py-3 text-center w-24">
                              <input
                                type="number"
                                inputMode="numeric"
                                className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                placeholder="0.00"
                                value={editingRowData?.rate || ''}
                                onChange={(e) => {
                                  const newRate = e.target.value;
                                  const qty = editingRowData?.qty || 0;
                                  const rate = parseFloat(newRate) || 0;
                                  const gstPercent = enableTax ? (editingRowData?.gst_percentage || 0) : 0;

                                  if (qty > 0 && rate > 0) {
                                    const subtotal = qty * rate;
                                    const taxAmount = (subtotal * gstPercent) / 100;
                                    const total = subtotal + taxAmount;
                                    
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      rate: parseFloat(newRate) || 0,
                                      total: total
                                    } : null);
                                  } else {
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      rate: parseFloat(newRate) || 0
                                    } : null);
                                  }
                                }}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </td>
                            {enableTax && (
                              <td className="px-4 py-3 text-center w-20">
                                <input
                                  type="number"
                                  className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                  placeholder="0%"
                                  value={editingRowData?.gst_percentage || ''}
                                  onChange={(e) => {
                                    const newGst = e.target.value;
                                    const qty = editingRowData?.qty || 0;
                                    const rate = editingRowData?.rate || 0;
                                    const gstPercent = parseFloat(newGst) || 0;

                                    if (qty > 0 && rate > 0) {
                                      const subtotal = qty * rate;
                                      const taxAmount = (subtotal * gstPercent) / 100;
                                      const total = subtotal + taxAmount;
                                      
                                      setEditingRowData(prev => prev ? {
                                        ...prev,
                                        gst_percentage: parseFloat(newGst) || 0,
                                        total: total
                                      } : null);
                                    } else {
                                      setEditingRowData(prev => prev ? {
                                        ...prev,
                                        gst_percentage: parseFloat(newGst) || 0
                                      } : null);
                                    }
                                  }}
                                  onWheel={(e) => e.preventDefault()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                      e.preventDefault();
                                    }
                                  }}
                                />
                              </td>
                            )}
                            <td className="px-4 py-3 text-center w-20">
                              <input
                                type="number"
                                className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                placeholder="0.00"
                                value={editingRowData?.total || ''}
                                onChange={(e) => {
                                  const newTotal = e.target.value;
                                  const qty = editingRowData?.qty || 0;
                                  const enteredTotal = parseFloat(newTotal) || 0;

                                  if (qty > 0 && enteredTotal > 0) {
                                    const rate = enteredTotal / qty;
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      total: parseFloat(newTotal) || 0,
                                      rate: rate
                                    } : null);
                                  } else {
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      total: parseFloat(newTotal) || 0
                                    } : null);
                                  }
                                }}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </td>
                            {/* Save/Cancel buttons */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center space-x-1">
                                <button
                                  type="button"
                                  onClick={saveInlineEdit}
                                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors"
                                  title="Save changes"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelInlineEdit}
                                  className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                                  title="Cancel edit"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            {/* Read-only display */}
                            <td className="px-4 py-3 text-center text-xs text-slate-200">
                              {product.qty}
                            </td>
                            <td className="px-4 py-3 text-center text-xs text-slate-200">
                              ₹{Math.round(product.rate)}
                            </td>
                            {enableTax && (
                              <td className="px-4 py-3 text-center text-xs text-slate-200">
                                ₹{Math.round(product.tax)}
                              </td>
                            )}
                            <td className="px-4 py-3 text-center text-xs font-medium text-slate-200">
                              ₹{Math.round(product.total)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center space-x-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditProduct(product)}
                                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                                  title="Edit product"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmDelete(product)}
                                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                                  title="Remove product"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {selectedProducts.length > 0 && (
                    <tfoot className="bg-slate-700">
                      {/* <tr>
                        <td colSpan={enableTax ? 10 : 9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                          SUBTOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-slate-200">
                          ₹{subtotal.toFixed(2)}
                        </td>
                      </tr> */}
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableTax ? 10 : 9} className="px-4 py-3"></td>
                        <td colSpan={2} className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedProducts([])}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                          >
                            Clear All Products
                          </button>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
              {errors.addProduct && <p className="text-red-400 text-xs mt-1">{errors.addProduct}</p>}
              {errors.inlineEdit && <p className="text-red-400 text-xs mt-1">{errors.inlineEdit}</p>}
              {!selectedVendorId && (
                <p className="text-xs text-amber-400 mt-1">Select a vendor first</p>
              )}
            </div>

            {/* Additional Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Additional Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">DESCRIPTIONS</label>
                  <textarea
                    value={formData.descriptions}
                    onChange={(e) => handleInputChange('descriptions', e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Enter descriptions"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">NOTES</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Enter notes"
                  />
                </div>
              </div>
            </div>
            {/* Packing & Forwarding */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Packing & Forwarding</h4> */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">QTY</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={formData.packing_forwarding_qty}
                    onChange={(e) => {
                      const newQty = e.target.value;
                      const qty = parseFloat(newQty) || 0;
                      const rate = parseFloat(formData.packing_forwarding_rate) || 0;

                      if (qty > 0 && rate > 0) {
                        const total = qty * rate;
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_qty: newQty,
                          packing_forwarding_total: total.toFixed(2)
                        }));
                      } else {
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_qty: newQty,
                          packing_forwarding_total: ''
                        }));
                      }
                    }}
                    onWheel={(e) => e.preventDefault()}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                      }
                    }}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">RATE</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={formData.packing_forwarding_rate}
                    onChange={(e) => {
                      const newRate = e.target.value;
                      const qty = parseFloat(formData.packing_forwarding_qty) || 0;
                      const rate = parseFloat(newRate) || 0;

                      if (qty > 0 && rate > 0) {
                        const total = qty * rate;
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_rate: newRate,
                          packing_forwarding_total: total.toFixed(2)
                        }));
                      } else {
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_rate: newRate,
                          packing_forwarding_total: ''
                        }));
                      }
                    }}
                    onWheel={(e) => e.preventDefault()}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                      }
                    }}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL</label>
                  <input
                    type="number"
                    value={formData.packing_forwarding_total}
                    onChange={(e) => {
                      const newTotal = e.target.value;
                      const qty = parseFloat(formData.packing_forwarding_qty) || 0;
                      const enteredTotal = parseFloat(newTotal) || 0;

                      if (qty > 0 && enteredTotal > 0) {
                        const rate = enteredTotal / qty;
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_total: newTotal,
                          packing_forwarding_rate: rate.toFixed(2)
                        }));
                      } else {
                        setFormData(prev => ({
                          ...prev,
                          packing_forwarding_total: newTotal,
                          packing_forwarding_rate: ''
                        }));
                      }
                    }}
                    onWheel={(e) => e.preventDefault()}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                      }
                    }}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Tax & Payment Information */}
            <div className="border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Tax & Payment Information</h3> */}
              <div className="space-y-4">


                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TAX</label>
                    <input
                      type="number"
                      value={(parseFloat(formData.total_cgst || '0') + parseFloat(formData.total_sgst || '0') + parseFloat(formData.total_igst || '0')).toFixed(2)}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      placeholder="Auto-calculated tax"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                    <input
                      type="number"
                      value={formData.total_cgst}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      placeholder="Auto-calculated CGST"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL SGST</label>
                    <input
                      type="number"
                      value={formData.total_sgst}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      placeholder="Auto-calculated SGST"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL IGST</label>
                    <input
                      type="number"
                      value={formData.total_igst}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      placeholder="Auto-calculated IGST"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS *</label>
                    <SearchableSelect
                      options={[
                        { id: '0', name: 'Unpaid' },
                        { id: '1', name: 'Paid' }
                      ]}
                      selectedValue={formData.payment_status?.toString() || '0'}
                      onSelectionChange={(value) => handleInputChange('payment_status', value || '0')}
                      placeholder="Select Payment Status"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT MODE *</label>
                    <SearchableSelect
                      options={[
                        { id: '0', name: 'Cash' },
                        { id: '1', name: 'Bank' }
                      ]}
                      selectedValue={formData.payment_mode.toString()}
                      onSelectionChange={(value) => handleInputChange('payment_mode', value || '1')}
                      placeholder="Select Payment Mode"
                    />
                  </div>
                  <div className="bg-slate-700 rounded p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-medium">GRAND TOTAL</span>
                      <div className="flex items-center space-x-2">
                        <Calculator className="w-4 h-4 text-slate-400" />
                        <span className="text-white font-semibold text-lg">
                          ₹{Math.round(grandTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>


              </div>
            </div>
          </div>


          {/* Error Display */}
          {errors.submit && (
            <div className="bg-red-900 border border-red-700 rounded p-3">
              <p className="text-red-200 text-sm">{errors.submit}</p>
            </div>
          )}

          {/* Form Actions */}
          <div className='border-t border-slate-600 pt-2'>
            <div className="p-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => router.push('/purchases')}
                className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Purchase' : 'Create Purchase')}
              </button>
            </div>
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
        selectedCarModel={selectedPanelCarModel}
        onCarModelSelection={setSelectedPanelCarModel}
        searchedProducts={products}
        productSearchTerm={productSearchTerm}
        onSearchTermChange={setProductSearchTerm}
        isLoading={productsLoading}
        onProductSelect={(product) => {
          handleProductSelection(product);
          setTemplateRow({
            qty: '1',
            rate: product.latest_purchase_rate?.toString() || product.opening_rate?.toString() || '',
            gst: product.gst_rate_percentage?.toString() || '0',
            total: ''
          });
          setIsProductPanelOpen(false);
          setProductSearchTerm('');
        }}
      />

      {/* Confirmation Modal for Purchase Submit */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title={isEditMode ? "Update Purchase?" : "Create Purchase?"}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this purchase for ₹${Math.round(grandTotal)}? ${isEditMode ? 'This will update the existing purchase.' : 'This action cannot be undone.'}`}
        confirmText={isEditMode ? "Update Purchase" : "Create Purchase"}
        cancelText="Cancel"
        showLoading={loading}
        loadingText={isEditMode ? "Updating Purchase..." : "Creating Purchase..."}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        title="Delete Product?"
        message={`Are you sure you want to delete "${itemToDelete?.product_name}" from this purchase? This will permanently remove this product from the purchase.`}
        confirmText="Delete Product"
        cancelText="Cancel"
        showLoading={false}
        onConfirm={confirmDeleteProduct}
        onCancel={() => {
          setShowDeleteModal(false);
          setItemToDelete(null);
        }}
      />
    </div>

  );
}
