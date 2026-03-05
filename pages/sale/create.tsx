import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Calculator, Loader, Trash2, Edit2, Plus, Filter } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import SessionStorageService from '../../lib/sessionStorage';
import { useSnackbar } from '../../components/SnackbarProvider';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';

interface StaffDetails {
  id: string;
  staff_name: string;
}

interface Mechanic {
  id: string;
  mechanic_name: string;
}

interface Customer {
  id: string;
  billing_name: string;
  contact_no?: string;
  email?: string;
  tax_id?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  state_code?: number;
  pin_code?: string;
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
  company?: string; // Keep for backward compatibility
  company_id?: number; // New field for company ID
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
  latest_selling_price?: number;
  gst_rate_percentage?: number;
}

interface InvoiceItem {
  id: string;
  product_id: number;
  product_name: string;
  display_name?: string; // Add display_name field
  car_model_ids: string[];
  car_model_names: string[];
  category_id: number;
  category_name: string;
  subcategory_id: number;
  subcategory_name: string;
  company_id: number;
  company_name: string;
  part_number: string;
  qty: number;
  rate: number;
  gst_percentage: number;
  discount_percentage: number;
  tax: number;
  discount_amount: number;
  total: number;
  // New pricing fields from product create
  hsn: string;
  mrp: number;
  discount: number;
  margin: number;
  // GST breakdown like purchase create
  cgst: number;
  sgst: number;
  igst: number;
}

interface InvoiceFormData {
  invoice_number: string;
  bill_reference: string;
  staff_id?: number | null;
  date: string;
  customer_name: string;
  contact_number: string;
  mechanic_name: string;
  mechanic_id?: number | null;
  vehicle_number: string;
  commission: string;
  address: string;
  address_2: string;
  transport_name: string;
  city: string;
  email_id: string;
  discount: string;
  state: string;
  state_code?: number;
  gst_number: string;
  tax: string;
  notes: string;
  payment_status: number;
  payment_mode: number;
  total_discount: string;
  subtotal: string;
  total_tax: string;
  grand_total: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  pin_code: string;
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function InvoiceCreate() {
  const router = useRouter();

  // Business state hardcoded to Uttar Pradesh (assuming state code 9)
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  const [staffList, setStaffList] = useState<StaffDetails[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<InvoiceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Customer selection state (like vendor in purchase)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerIdToSave, setCustomerIdToSave] = useState<number | null>(null);
  const [customerStateForTax, setCustomerStateForTax] = useState<string>('');
  const [isOtherCustomerSelected, setIsOtherCustomerSelected] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);

  // Raw invoice data for re-conversion when filters load
  const [rawInvoiceItems, setRawInvoiceItems] = useState<any[]>([]);

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

  // State for selected product in the table row
  const [selectedRowProduct, setSelectedRowProduct] = useState<Product | null>(null);

  // State for filtered car models based on selected product
  const [filteredCarModels, setFilteredCarModels] = useState<any[]>([]);

  // State for filtered subcategories based on selected category
  const [filteredSubcategories, setFilteredSubcategories] = useState<any[]>([]);

  // State for sidepanel car model filtering
  const [selectedPanelCarModel, setSelectedPanelCarModel] = useState<string>('');
  const [selectedPanelCategory, setSelectedPanelCategory] = useState<string>('');
  const [selectedPanelSubcategory, setSelectedPanelSubcategory] = useState<string>('');
  const [selectedPanelCompany, setSelectedPanelCompany] = useState<string>('');

  // Helper function to get consistent company info from product
  const getCompanyInfo = (product: Product) => {
    const companyId = product.company_id || (product.company ? parseInt(product.company) : null);
    const companyName = companyId ? filterOptions.companies.find(comp => comp.id.toString() === companyId.toString())?.name : null;
    return { companyId, companyName };
  };

  // Function to generate dynamic product name in new format: UID CAR MODEL CATEGORY [SUBCATEGORY] COMPANY [PARTNUMBER]
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[], partNumber?: string): string => {
    const uid = product.id.toString();
    const carModelName = selectedCarModelIds.length > 0
      ? filterOptions.models.find(model => model.id.toString() === selectedCarModelIds[0])?.name || ''
      : '';
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name || '';
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name || '';
    const { companyName } = getCompanyInfo(product);

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

  // Function to calculate GST breakdown based on state comparison
  const calculateGSTBreakdown = (taxAmount: number, customerStateCode: number | null) => {
    const isIntraState = customerStateCode === BUSINESS_STATE_CODE;

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

  // Function to handle product selection and update filters
  const handleProductSelection = (product: Product) => {
    setSelectedRowProduct(product);

    // Filter car models for this product
    const compatibleModels = getFilteredCarModelsForProduct(product);
    setFilteredCarModels(compatibleModels);

    // Initially set car models to unselected
    setProductRowFilters(prev => ({
      ...prev,
      category: product.product_category_id || 0,
      subcategory: product.product_subcategory_id || 0,
      carModels: [product.car_model_ids.split(",")[0]],
      company: product.company_id || 0,
      partNo: product.part_no || ''
    }));

    console.log('🔄 PRODUCT SELECTED:', {
      product: product.product_name,
      compatibleCarModels: compatibleModels.map(m => m.name),
      initialFilters: {
        category: product.product_category_id,
        subcategory: product.product_subcategory_id,
        carModels: [product.car_model_ids.split(",")[0]],
        company: product.company_id
      }
    });
  };

  // State for product selection side panel
  const [isProductPanelOpen, setIsProductPanelOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    gst: '0',
    discount: '0',
    total: ''
  });

  // State for discount toggle
  const [enableDiscount, setEnableDiscount] = useState(false);

  // State for tax toggle (Option A: Preserve Original Tax Setting)
  const [enableTax, setEnableTax] = useState(false);

  // State to track which field was last edited (for smart calculation)
  const [lastEditedField, setLastEditedField] = useState<'qty' | 'rate' | 'total' | null>(null);

  // Removed auto-calculate useEffect - calculations now happen in onChange handlers

  // State for inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<InvoiceItem | null>(null);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // State for states data
  const [states, setStates] = useState<{ id: string; name: string; code: number }[]>([]);

  // Initialize snackbar hook
  const { showSnackbar } = useSnackbar();

  // Helper function to get state code from state name
  const getStateCodeFromName = (stateName: string): number | undefined => {
    const state = states.find(s => s.name === stateName);
    return state?.code;
  };

  // Memoize the filterOptions to prevent unnecessary re-renders
  const memoizedFilterOptions = useMemo(() => filterOptions, [
    filterOptions.categories,
    filterOptions.subcategories,
    filterOptions.companies,
    filterOptions.models
  ]);

  const [formData, setFormData] = useState<InvoiceFormData>({
    invoice_number: '',
    bill_reference: '',
    staff_id: null,
    date: new Date().toISOString().split('T')[0],
    customer_name: '',
    contact_number: '',
    mechanic_name: '',
    vehicle_number: '',
    commission: '',
    address: '',
    address_2: '',
    transport_name: '',
    city: '',
    email_id: '',
    discount: '',
    state: '',
    gst_number: '',
    tax: '',
    notes: '',
    payment_status: 0, // Default to Unpaid (0=Unpaid, 1=Paid, 2=Partially Paid)
    payment_mode: 0, // Default to Cash (0=Cash, 1=Bank)
    total_discount: '',
    subtotal: '',
    total_tax: '',
    grand_total: '',
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    total_cgst: '',
    total_sgst: '',
    total_igst: '',
    pin_code: ''
  });

  // Check for edit mode immediately on mount
  useEffect(() => {
    const { edit } = router.query;
    if (edit && typeof edit === 'string') {
      setIsEditMode(true);
      setEditInvoiceId(parseInt(edit));
    }
  }, [router.query]);

  // Fetch data on mount and handle edit mode properly
  useEffect(() => {
    const initializeData = async () => {
      try {
        // Fetch data in parallel
        await Promise.all([
          fetchStaffList(),
          fetchMechanics(),
          fetchCustomers(),
          fetchProducts(),
          fetchFilterOptions(),
          fetchStates()
        ]);
      } catch (error) {
        console.error('Error initializing data:', error);
      }
    };

    initializeData();
  }, []);

  // Fetch last invoice number only in create mode
  useEffect(() => {
    if (!isEditMode && !router.query.edit) {
      fetchLastInvoiceNumber();
    }
  }, [isEditMode, router.query.edit]);

  // Clear validation errors when side panel closes
  useEffect(() => {
    if (!isProductPanelOpen) {
      setErrors({});
    }
  }, [isProductPanelOpen]);

  // Refetch products when panel filters change
  useEffect(() => {
    fetchProducts(selectedPanelCarModel, productSearchTerm, selectedPanelCategory, selectedPanelSubcategory, selectedPanelCompany);
  }, [selectedPanelCarModel, productSearchTerm, selectedPanelCategory, selectedPanelSubcategory, selectedPanelCompany]);

  // Convert raw invoice items when filterOptions are loaded
  useEffect(() => {
    if (rawInvoiceItems.length > 0 && filterOptions.categories.length > 0 && filterOptions.models.length > 0) {
      console.log('🔄 Converting raw invoice items to formatted items now that filters are available');
      const convertedItems: InvoiceItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: InvoiceItem = {
          id: (index + 1).toString(),
          product_id: item.product_id || item.name_of_product || 1,
          product_name: item.name_of_product,
          car_model_ids: item.model_id ? [item.model_id.toString()] : [],
          car_model_names: item.model_id ? [filterOptions.models.find(model => model.id.toString() === item.model_id?.toString())?.name || ''] : [],
          category_id: item.category_id || 0,
          category_name: filterOptions.categories.find(cat => cat.id.toString() === item.category_id?.toString())?.name || '',
          subcategory_id: item.subcategory_id || null,
          subcategory_name: (() => {
            // First try database subcategory_id
            if (item.subcategory_id && item.subcategory_id !== 0) {
              return filterOptions.subcategories.find(sub => sub.id.toString() === item.subcategory_id?.toString())?.name || '';
            }
            // Fallback to product subcategory_id with category filtering
            const product = products.find(p => p.id === item.product_id);
            if (product?.product_subcategory_id) {
              return filterOptions.subcategories.find(sub =>
                sub.id.toString() === product.product_subcategory_id?.toString() &&
                sub.category_id === product.product_category_id
              )?.name || '';
            }
            return '';
          })(),
          company_id: item.company_id || 0,
          company_name: filterOptions.companies.find(comp => comp.id.toString() === item.company_id?.toString())?.name || '',
          part_number: item.part || '',
          qty: item.qty || 1,
          rate: item.rate || 0,
          gst_percentage: item.gst_percentage || 0,
          discount_percentage: item.discountrate || 0,
          tax: item.tax || 0,
          discount_amount: item.discount || 0,
          total: item.subtotal || 0,
          hsn: item.hsn || '',
          mrp: 0,
          discount: item.discountrate || 0,
          margin: 0,
          cgst: item.cgst || 0,
          sgst: item.sgst || 0,
          igst: item.igst || 0
        };
        return itemObj;
      });

      console.log('✅ Setting converted invoice items:', convertedItems);
      setSelectedProducts(convertedItems);

      // Check if any items have discounts and enable discount checkbox
      const hasDiscounts = convertedItems.some(item => item.discount_percentage > 0);
      if (hasDiscounts) {
        setEnableDiscount(true);
      }

      // Check if any items have tax and enable tax checkbox (Option A: Preserve Original Tax Setting)
      const hasTax = convertedItems.some(item => item.gst_percentage > 0 || item.tax > 0);
      setEnableTax(hasTax);

      // Clear raw items after conversion
      setRawInvoiceItems([]);
    }
  }, [rawInvoiceItems, filterOptions.categories, filterOptions.subcategories, filterOptions.companies, filterOptions.models]);

  // Fetch invoice data when edit mode is detected
  useEffect(() => {
    if (isEditMode && editInvoiceId) {
      console.log('🔍 EDIT MODE DETECTED, FETCHING INVOICE:', editInvoiceId);

      // First try to get data from sessionStorage
      const cachedData = SessionStorageService.get('sales', editInvoiceId.toString());
      if (cachedData) {
        console.log('🔄 Using cached invoice data from sessionStorage:', cachedData);
        // Process the cached data directly inline
        const { invoice: invoiceData, billingDetails, shippingDetails, transportDetails, invoiceItems } = cachedData;


        setFormData({
          invoice_number: invoiceData.invoice_no?.toString() || '',
          bill_reference: invoiceData.bill_reference || '',
          staff_id: invoiceData.staff_id || null,
          date: new Date(invoiceData.invoice_date * 1000).toISOString().split('T')[0],
          customer_name: invoiceData.customer_name || '',
          contact_number: invoiceData.contact_number || '',
          mechanic_name: invoiceData.mechanic?.mechanic_name || '',
          mechanic_id: invoiceData.mechanic_id || null,
          vehicle_number: transportDetails?.vehicle_no || '',
          commission: invoiceData.commission ? invoiceData.commission.toString() : '',
          address: invoiceData.address || '',
          address_2: invoiceData.address_2 || '',
          transport_name: transportDetails?.trans_mode || '',
          city: invoiceData.city || '',
          email_id: invoiceData.email_id || '',
          discount: invoiceData.discount || '',
          state: invoiceData.state || '',
          gst_number: invoiceData.gst_number || '',
          tax: invoiceData.tax || '',
          notes: invoiceData.notes || '',
          payment_status: invoiceData.status !== undefined ? invoiceData.status : 0,
          payment_mode: invoiceData.payment_mode !== undefined ? invoiceData.payment_mode : 0,
          total_discount: invoiceData.total_discount ? invoiceData.total_discount.toString() : '',
          subtotal: invoiceData.subtotal ? invoiceData.subtotal.toString() : '',
          total_tax: invoiceData.total_tax ? invoiceData.total_tax.toString() : '',
          grand_total: invoiceData.total ? invoiceData.total.toString() : '',
          descriptions: invoiceData.descriptions || '',
          packing_forwarding_qty: invoiceData.packing_forwarding_qty || '0',
          packing_forwarding_rate: invoiceData.packing_forwarding_rate || '0',
          packing_forwarding_total: invoiceData.packing_forwarding_total || '0',
          total_cgst: invoiceData.total_cgst ? invoiceData.total_cgst.toString() : '0',
          total_sgst: invoiceData.total_sgst ? invoiceData.total_sgst.toString() : '0',
          total_igst: invoiceData.total_igst ? invoiceData.total_igst.toString() : '0',
          pin_code: billingDetails?.billing_pin_code || ''
        });

        // Customer data is now directly populated from the invoice data (no customer selection needed)

        // Set other IDs
        if (invoiceData.staff_id) {
          setSelectedStaffId(invoiceData.staff_id.toString());
        }
        if (invoiceData.mechanic_id) {
          setSelectedMechanicId(invoiceData.mechanic_id.toString());
        }

        // Set raw items to convert later
        if (invoiceItems && invoiceItems.length > 0) {
          setRawInvoiceItems(invoiceItems);
        }

        // Set loading to false
        setInvoiceNumberLoading(false);

        // Remove the cached data after using it
        // SessionStorageService.remove('sales', editInvoiceId.toString());
        return;
      }

      // Fallback to API call if no cached data
      fetchInvoiceForEdit(editInvoiceId);
    }

  }, [isEditMode, editInvoiceId]);

  // Customer selection function removed - no longer needed since we removed customer dropdown



  // Filter subcategories for table filters when category changes (using loaded filter data)
  useEffect(() => {
    if (productRowFilters.category > 0) {
      const filtered = filterOptions.subcategories.filter(sub => sub.category_id === productRowFilters.category);
      setFilteredSubcategories(filtered);

      // Only clear subcategory if it's not valid for the new category
      const isCurrentSubcategoryValid = filtered.some(sub => sub.id === productRowFilters.subcategory);
      if (!isCurrentSubcategoryValid && productRowFilters.subcategory > 0) {
        setProductRowFilters(prev => ({
          ...prev,
          subcategory: 0,
          subcategoryName: ''
        }));
      }
    } else {
      setFilteredSubcategories(filterOptions.subcategories);
    }
  }, [productRowFilters.category, productRowFilters.subcategory, filterOptions.subcategories]);

  // Auto-select product when filters match exactly one product
  useEffect(() => {
    if (productRowFilters.category || productRowFilters.subcategory || productRowFilters.carModels.length > 0 || productRowFilters.company || productRowFilters.partNo) {
      const matchingProducts = products.filter(product => {
        // Category filter
        if (productRowFilters.category > 0 && product.product_category_id !== productRowFilters.category) {
          return false;
        }

        // Subcategory filter
        if (productRowFilters.subcategory > 0 && product.product_subcategory_id !== productRowFilters.subcategory) {
          return false;
        }

        // Car model filter
        if (productRowFilters.carModels.length > 0) {
          const productCarModels = product.car_model_ids ? product.car_model_ids.split(',').map(id => id.trim()) : [];
          const hasMatchingModel = productRowFilters.carModels.some(filterModel =>
            productCarModels.includes(filterModel)
          );
          if (!hasMatchingModel) {
            return false;
          }
        }

        // Company filter
        const productCompanyId = product.company_id || (product.company ? parseInt(product.company) : null);
        if (productRowFilters.company > 0 && productCompanyId !== productRowFilters.company) {
          return false;
        }

        // Part number filter
        if (productRowFilters.partNo && product.part_no && !product.part_no.toLowerCase().includes(productRowFilters.partNo.toLowerCase())) {
          return false;
        }

        return true;
      });

      console.log('🔍 SALE FILTER MATCHES:', {
        filters: productRowFilters,
        matchingProducts: matchingProducts.length,
        products: matchingProducts.map(p => ({ id: p.id, name: p.product_name }))
      });

      if (matchingProducts.length === 1 && (!selectedRowProduct || selectedRowProduct.id !== matchingProducts[0].id) && selectedProducts.length === 0) {
        console.log('🎯 AUTO-SELECTING PRODUCT:', matchingProducts[0].product_name);
        handleProductSelection(matchingProducts[0]);
      } else if (matchingProducts.length === 0) {
        console.log('🧹 CLEARING PRODUCT SELECTION - no matches');
        setSelectedRowProduct(null);
      }
    }
  }, [productRowFilters, products]);






  // Calculate and update GST totals whenever selectedProducts change
  useEffect(() => {
    const totalCgst = selectedProducts.reduce((sum, item) => sum + item.cgst, 0);
    const totalSgst = selectedProducts.reduce((sum, item) => sum + item.sgst, 0);
    const totalIgst = selectedProducts.reduce((sum, item) => sum + item.igst, 0);

    setFormData(prev => ({
      ...prev,
      total_cgst: totalCgst.toFixed(2),
      total_sgst: totalSgst.toFixed(2),
      total_igst: totalIgst.toFixed(2)
    }));
  }, [selectedProducts]);

  // Auto-calculate packing and forwarding total
  useEffect(() => {
    const qty = parseFloat(formData.packing_forwarding_qty) || 0;
    const rate = parseFloat(formData.packing_forwarding_rate) || 0;
    const total = qty * rate;

    if (total !== parseFloat(formData.packing_forwarding_total)) {
      setFormData(prev => ({
        ...prev,
        packing_forwarding_total: total.toFixed(2)
      }));
    }
  }, [formData.packing_forwarding_qty, formData.packing_forwarding_rate]);


  const fetchStaffList = async () => {
    try {
      const response = await fetch('/api/staff');
      if (response.ok) {
        const data = await response.json();
        setStaffList(data.staff.map((staff: any) => ({
          id: staff.id.toString(),
          staff_name: staff.name
        })));
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchMechanics = async () => {
    try {
      const response = await fetch('/api/mechanics');
      if (response.ok) {
        const data = await response.json();
        // Transform mechanic data to match expected format
        const transformedMechanics = data.mechanics.map((mechanic: any) => ({
          id: mechanic.id.toString(),
          mechanic_name: mechanic.name
        }));
        setMechanics(transformedMechanics);
      } else {
        setMechanics([]);
      }
    } catch (error) {
      console.error('Error fetching mechanics:', error);
      setMechanics([]);
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers?dropdown=true');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchProducts = async (
    modelFilter: string = '',
    searchTerm: string = '',
    categoryFilter: string = '',
    subcategoryFilter: string = '',
    companyFilter: string = ''
  ) => {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams();
      // Always fetch all products for side panel (no pagination limit)
      params.append('fetchAll', 'true');
      if (modelFilter) params.append('modelFilter', modelFilter);
      if (searchTerm) params.append('search', searchTerm);
      if (categoryFilter) params.append('categoryFilter', categoryFilter);
      if (subcategoryFilter) params.append('subcategoryFilter', subcategoryFilter);
      if (companyFilter) params.append('companyFilter', companyFilter);
      const url = `/api/products?${params.toString()}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setProductsLoading(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
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
    try {
      // Implement similar to purchase creation - get last invoice number + 1
      const response = await fetch('/api/sales?limit=1&sort=-invoice_no');
      if (response.ok) {
        const data = await response.json();
        if (data.sales && data.sales.length > 0) {
          const lastInvoiceNum = Math.max(...data.sales.map((s: any) => s.invoice_no || 0));
          const nextInvoiceNum = lastInvoiceNum + 1;
          setFormData(prev => ({ ...prev, invoice_number: nextInvoiceNum.toString() }));
        } else {
          setFormData(prev => ({ ...prev, invoice_number: '1' }));
        }
      }
    } catch (error) {
      console.error('Error fetching last invoice number:', error);
      setFormData(prev => ({ ...prev, invoice_number: '1' })); // Fallback
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  const fetchInvoiceForEdit = async (invoiceId: number) => {
    try {
      console.log('🔍 CHECKING SESSIONSTORAGE FOR EDIT DATA:', invoiceId);

      // Check sessionStorage first to avoid redundant API call in edit mode
      const cachedData = SessionStorageService.get('sales', invoiceId.toString());
      if (cachedData) {
        console.log('✅ USING CACHED DATA FROM SESSIONSTORAGE');
        const { invoice: invoiceData, billingDetails, shippingDetails, transportDetails, invoiceItems } = cachedData;

        // Process the cached data directly inline
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

        const invoiceNo = invoiceData.invoice_no ? invoiceData.invoice_no.toString() : '';
        console.log('📋 SETTING CACHED INVOICE NUMBER:', invoiceNo);

        // Prefill form data from cached data
        const formDataToSet = {
          invoice_number: invoiceNo,
          bill_reference: invoiceData.bill_reference || '',
          staff_id: invoiceData.staff_id || null,
          date: formatDateForInput(invoiceData.invoice_date),
          customer_name: invoiceData.customer_name || '',
          contact_number: invoiceData.contact_number || '',
          mechanic_name: invoiceData.mechanic?.mechanic_name || '',
          mechanic_id: invoiceData.mechanic_id || null,
          vehicle_number: transportDetails.vehicle_no || '',
          commission: invoiceData.commission ? invoiceData.commission.toString() : '',
          address: invoiceData.address || '',
          address_2: invoiceData.address_2 || '',
          transport_name: transportDetails?.trans_mode || '',
          city: invoiceData.city || '',
          email_id: invoiceData.email_id || '',
          discount: invoiceData.discount || '',
          state: invoiceData.state || '',
          gst_number: invoiceData.gst_number || '',
          tax: invoiceData.tax || '',
          notes: invoiceData.notes || '',
          payment_status: invoiceData.status !== undefined ? invoiceData.status : 0,
          payment_mode: invoiceData.payment_mode !== undefined ? invoiceData.payment_mode : 0,
          total_discount: invoiceData.total_discount ? invoiceData.total_discount.toString() : '',
          subtotal: invoiceData.subtotal ? invoiceData.subtotal.toString() : '',
          total_tax: invoiceData.total_tax ? invoiceData.total_tax.toString() : '',
          grand_total: invoiceData.total ? invoiceData.total.toString() : '',
          descriptions: invoiceData.descriptions || '',
          packing_forwarding_qty: invoiceData.packing_forwarding_qty || '0',
          packing_forwarding_rate: invoiceData.packing_forwarding_rate || '0',
          packing_forwarding_total: invoiceData.packing_forwarding_total || '0',
          total_cgst: invoiceData.total_cgst ? invoiceData.total_cgst.toString() : '0',
          total_sgst: invoiceData.total_sgst ? invoiceData.total_sgst.toString() : '0',
          total_igst: invoiceData.total_igst ? invoiceData.total_igst.toString() : '0',
          pin_code: billingDetails?.billing_pin_code || ''
        };

        setFormData(formDataToSet);

        // Direct population of customer data from invoice (no customer selection needed)

        // Set other IDs
        if (invoiceData.staff_id) {
          setSelectedStaffId(invoiceData.staff_id.toString());
        }
        if (invoiceData.mechanic_id) {
          setSelectedMechanicId(invoiceData.mechanic_id.toString());
        }

        // Set raw items to convert later
        if (invoiceItems && invoiceItems.length > 0) {
          console.log('Storing cached raw invoice items for conversion:', invoiceItems);
          setRawInvoiceItems(invoiceItems);
        }

        // Set loading to false
        setInvoiceNumberLoading(false);

        return;
      }

      console.log('🔍 FETCHING INVOICE FOR EDIT FROM API:', invoiceId);
      const response = await fetch(`/api/invoices/${invoiceId}`);
      if (response.ok) {
        const data = await response.json();
        const invoice = data.invoice || data;
        const transportDetails = data.transportDetails;
        console.log('📄 RECEIVED INVOICE DATA:', invoice);

        // Format date
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

        // Ensure invoice number is a string
        const invoiceNo = invoice.invoice_no ? invoice.invoice_no.toString() : '';
        console.log('📋 SETTING INVOICE NUMBER:', invoiceNo);

        // Store data in sessionStorage for future edit reuse
        if (typeof invoiceId === 'number') {
          SessionStorageService.set('sales', invoiceId.toString(), {
            invoice: invoice,
            billingDetails: data.billingDetails,
            shippingDetails: data.shippingDetails,
            transportDetails: data.transportDetails,
            invoiceItems: data.invoiceItems
          });
        }

        // Prefill form data with all available fields
        const formDataToSet = {
          invoice_number: invoiceNo,
          bill_reference: invoice.bill_reference || '',
          staff_id: invoice.staff_id || null,
          date: formatDateForInput(invoice.invoice_date),
          customer_name: invoice.customer_name || '',
          contact_number: invoice.contact_number || '',
          mechanic_name: invoice.mechanic?.mechanic_name || '',
          mechanic_id: invoice.mechanic_id || null,
          vehicle_number: transportDetails.vehicle_no || '',
          commission: invoice.commission ? invoice.commission.toString() : '',
          address: invoice.address || '',
          address_2: invoice.address_2 || '',
          transport_name: transportDetails.trans_mode || '',
          city: invoice.city || '',
          email_id: invoice.email_id || '',
          discount: invoice.discount || '',
          state: invoice.state || '',
          gst_number: invoice.gst_number || '',
          tax: invoice.tax || '',
          notes: invoice.notes || '',
          payment_status: invoice.status || 1,
          payment_mode: invoice.payment_mode || 1,
          total_discount: invoice.total_discount ? invoice.total_discount.toString() : '',
          subtotal: invoice.subtotal ? invoice.subtotal.toString() : '',
          total_tax: invoice.total_tax ? invoice.total_tax.toString() : '',
          grand_total: invoice.total ? invoice.total.toString() : '',
          descriptions: invoice.descriptions || '',
          packing_forwarding_qty: invoice.packing_forwarding_qty || '0',
          packing_forwarding_rate: invoice.packing_forwarding_rate || '0',
          packing_forwarding_total: invoice.packing_forwarding_total || '0',
          total_cgst: invoice.total_cgst ? invoice.total_cgst.toString() : '0',
          total_sgst: invoice.total_sgst ? invoice.total_sgst.toString() : '0',
          total_igst: invoice.total_igst ? invoice.total_igst.toString() : '0',
          pin_code: data.billingDetails?.billing_pin_code || ''
        };

        console.log('📝 SETTING FORM DATA:', formDataToSet);
        setFormData(formDataToSet);

        // Override with bill_to data if available (for inline editing of "Other" customers)
        if (data.billingDetails) {
          setFormData(prev => ({
            ...prev,
            customer_name: data.billingDetails.customer_name || prev.customer_name,
            contact_number: data.billingDetails.contact_number || prev.contact_number,
            email_id: data.billingDetails.email_id || prev.email_id,
            address: data.billingDetails.address || prev.address,
            address_2: data.billingDetails.address_2 || prev.address_2,
            city: data.billingDetails.city || prev.city,
            state: data.billingDetails.state || prev.state,
            gst_number: data.billingDetails.gst_number || prev.gst_number,
            pin_code: data.billingDetails.pin_code || prev.pin_code,
          }));
        }


       

        // Set other related entity IDs
        if (invoice.staff_id) {
          setSelectedStaffId(invoice.staff_id.toString());
          setFormData(prev => ({ ...prev, staff_id: invoice.staff_id }));
        }
        if (invoice.mechanic_id) {
          setSelectedMechanicId(invoice.mechanic_id.toString());
          setFormData(prev => ({ ...prev, mechanic_id: invoice.mechanic_id }));
        }

        // Store raw invoice items to convert later when filters are loaded
        if (data.invoiceItems && data.invoiceItems.length > 0) {
          console.log('Storing raw invoice items for conversion:', data.invoiceItems);
          setRawInvoiceItems(data.invoiceItems);
        }
      }
    } catch (error) {
      console.error('Error fetching invoice for edit:', error);
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  const handleInputChange = (field: keyof InvoiceFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear tax calculations when state changes
    if (field === 'state') {
      setSelectedProducts([]);
      setFormData(prev => ({
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
    }

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleCustomerSelect = (customerId: string) => {
    if (customerId === '0') {
      // "Other" selected
      setSelectedCustomerId('0');
      setSelectedCustomer(null);
      setIsOtherCustomerSelected(true);
      setCustomerIdToSave(0);

      // Clear existing tax calculations and selected products
      setSelectedProducts([]);
      setFormData(prev => ({
        ...prev,
        customer_name: '',
        contact_number: '',
        email_id: '',
        gst_number: '',
        address: '',
        address_2: '',
        city: '',
        state: '',
        state_code: undefined,
        pin_code: '',
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
      setCustomerStateForTax('');
      return;
    }

    setIsOtherCustomerSelected(false);
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setSelectedCustomerId(customerId);
      setCustomerIdToSave(parseInt(customerId));
      setSelectedCustomer(customer);

      // Auto-populate customer details
      setFormData(prev => ({
        ...prev,
        customer_name: customer.billing_name || '',
        contact_number: customer.contact_no || '',
        email_id: customer.email || '',
        gst_number: customer.tax_id || '',
        address: customer.address || '',
        address_2: customer.address_2 || '',
        city: customer.city || '',
        state: customer.state || '',
        state_code: customer.state_code,
        pin_code: customer.pin_code || ''
      }));

      // Clear existing products when customer changes (tax calculations will be different)
      setSelectedProducts([]);
      setFormData(prev => ({
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));

      setCustomerStateForTax(customer.state || '');
    } else {
      // Clear customer selection
      setCustomerIdToSave(null);
      setSelectedCustomer(null);
      setCustomerStateForTax('');
    }
  };


  const handleEditProduct = (item: InvoiceItem) => {
    // Enable inline editing for this specific row
    setEditingRowId(item.id);

    // Calculate GST percentage from tax amount if not set or zero
    const gstPercentage = item.gst_percentage || (item.rate > 0 ? (item.tax / (item.qty * item.rate)) * 100 : 0);

    setEditingRowData({ ...item, gst_percentage: gstPercentage });
  };

  const saveInlineEdit = () => {
    if (editingRowId && editingRowData) {
      // Validate the editing data
      if (editingRowData.qty < 0) {
        setErrors({ inlineEdit: 'Quantity cannot be negative' });
        return;
      }
      // Rate validation removed - allow 0 rate
      if (editingRowData.gst_percentage < 0) {
        setErrors({ inlineEdit: 'GST percentage cannot be negative' });
        return;
      }

      // Recalculate tax and total based on discount and tax toggles
      const subtotal = editingRowData.qty * editingRowData.rate;
      const discountAmount = enableDiscount ? editingRowData.discount_amount : 0;
      const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
      const taxableAmount = subtotal - discountAmount;
      const taxAmount = enableTax ? (taxableAmount * editingRowData.gst_percentage) / 100 : 0;

      // Calculate GST breakdown based on customer's state (only if tax is enabled)
      const customerStateCode = getStateCodeFromName(formData.state);
      const gstBreakdown = enableTax ? calculateGSTBreakdown(taxAmount, customerStateCode || null) : { cgst: 0, sgst: 0, igst: 0 };

      const updatedItem = {
        ...editingRowData,
        tax: taxAmount,
        total: taxableAmount + taxAmount,
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
        cgst: gstBreakdown.cgst,
        sgst: gstBreakdown.sgst,
        igst: gstBreakdown.igst
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

  const removeProduct = (id: string) => {
    setSelectedProducts(prev => prev.filter(item => item.id !== id));
  };

  // Calculations
  const subtotal = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + (item.qty * item.rate - item.discount_amount), 0);
  }, [selectedProducts]);

  const totalDiscount = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + item.discount_amount, 0);
  }, [selectedProducts]);

  const totalTax = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + item.tax, 0);
  }, [selectedProducts]);

  const grandTotal = useMemo(() => {
    const productTotal = selectedProducts.reduce((sum, item) => sum + item.total, 0);
    const packingTotal = parseFloat(formData.packing_forwarding_total) || 0;
    return productTotal + packingTotal;
  }, [selectedProducts, formData.packing_forwarding_total]);

  // Tax validation functions
  const validateTaxData = (item: InvoiceItem): Record<string, string> => {
    const taxErrors: Record<string, string> = {};

    // Skip validation if GST breakdown hasn't been calculated yet
    if (item.cgst === undefined || item.sgst === undefined || item.igst === undefined) {
      return taxErrors; // Skip validation if GST breakdown not calculated
    }

    // Validate GST percentage range
    if (item.gst_percentage < 0 || item.gst_percentage > 100) {
      taxErrors.gstPercentage = 'GST percentage must be between 0 and 100';
    }

    // Ensure non-negative tax values (allow 0 for products with 0% GST)
    if (item.cgst < 0) taxErrors.cgst = 'CGST cannot be negative';
    if (item.sgst < 0) taxErrors.sgst = 'SGST cannot be negative';
    if (item.igst < 0) taxErrors.igst = 'IGST cannot be negative';
    if (item.tax < 0) taxErrors.tax = 'Total tax cannot be negative';

    // Validate tax consistency
    const expectedTotalTax = item.cgst + item.sgst + item.igst;
    if (Math.abs(expectedTotalTax - item.tax) > 0.01) {
      taxErrors.consistency = `Tax breakdown does not match total tax amount (Expected: ${expectedTotalTax.toFixed(2)}, Got: ${item.tax.toFixed(2)})`;
    }

    // NOTE: State-based tax logic (CGST/SGST vs IGST requirements) is validated at totals level only
    // Individual products can legitimately have CGST=0, SGST=0 if they have 0% GST

    return taxErrors;
  };

  const validateAllTaxData = (): Record<string, string> => {
    const taxErrors: Record<string, string> = {};

    console.log('🔍 VALIDATING TAX DATA FOR', selectedProducts.length, 'PRODUCTS');
    console.log('🏢 BUSINESS STATE CODE:', BUSINESS_STATE_CODE);
    
    const customerStateCode = getStateCodeFromName(formData.state);
    console.log('👤 CUSTOMER STATE CODE:', customerStateCode);

    // First, validate individual products for basic issues (GST percentages, calculation consistency)
    selectedProducts.forEach((item, index) => {
      console.log(`📦 PRODUCT ${index + 1}:`, {
        name: item.product_name,
        gst_percentage: item.gst_percentage,
        cgst: item.cgst,
        sgst: item.sgst,
        igst: item.igst,
        tax: item.tax,
        total: item.total
      });

      const itemErrors = validateTaxData(item);
      console.log(`❌ PRODUCT ${index + 1} ERRORS:`, itemErrors);

      Object.entries(itemErrors).forEach(([key, error]) => {
        taxErrors[`product_${index}_${key}`] = `Product ${index + 1}: ${error}`;
      });
    });

    // Then, validate overall state-based tax logic based on TOTALS, not individual products
    if (selectedProducts.length > 0 && formData.state) {
      const { totalCgst, totalSgst, totalIgst } = calculateExpectedTax();
      const isIntraState = !customerStateCode || customerStateCode === BUSINESS_STATE_CODE;

      // Check if there are any products with GST > 0
      const hasTaxableProducts = selectedProducts.some(product => product.gst_percentage > 0);

      console.log('💰 TOTAL TAX VALIDATION:', { totalCgst, totalSgst, totalIgst, isIntraState, hasTaxableProducts });

      if (isIntraState) {
        // Intra-state: Must have CGST + SGST in totals if there are taxable products, no IGST
        if (totalIgst > 0) {
          taxErrors.stateLogic = 'Intra-state transactions should not have IGST';
        }
        // Only require CGST/SGST > 0 if there are products with GST > 0
        if (hasTaxableProducts && totalCgst <= 0 && totalSgst <= 0) {
          taxErrors.stateLogic = 'Intra-state transactions with taxable products require CGST or SGST totals to be greater than 0';
        }
      } else {
        // Inter-state: Must have IGST in totals if there are taxable products, no CGST/SGST
        if (totalCgst > 0 || totalSgst > 0) {
          taxErrors.stateLogic = 'Inter-state transactions should not have CGST or SGST';
        }
        // Only require IGST > 0 if there are products with GST > 0
        if (hasTaxableProducts && totalIgst <= 0) {
          taxErrors.stateLogic = 'Inter-state transactions with taxable products require IGST total to be greater than 0';
        }
      }
    }

    console.log('📊 FINAL TAX ERRORS:', taxErrors);
    return taxErrors;
  };

  // Calculate expected tax based on current items
  const calculateExpectedTax = () => {
    const totalCgst = selectedProducts.reduce((sum, item) => sum + item.cgst, 0);
    const totalSgst = selectedProducts.reduce((sum, item) => sum + item.sgst, 0);
    const totalIgst = selectedProducts.reduce((sum, item) => sum + item.igst, 0);

    return { totalCgst, totalSgst, totalIgst };
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    console.log('🔍 STARTING FORM VALIDATION...');

    // Basic form validation
    if (!formData.invoice_number.trim()) {
      newErrors.invoice_number = 'Invoice number is required';
      console.log('❌ NO INVOICE NUMBER');
    }
    if (!selectedCustomerId) {
      newErrors.customer_name = 'Please select a customer';
      console.log('❌ NO CUSTOMER SELECTED');
    }
    if (isOtherCustomerSelected && !formData.customer_name.trim()) {
      newErrors.customer_name = 'Customer name is required';
      console.log('❌ NO CUSTOMER NAME');
    }
    if (!formData.state.trim()) {
      newErrors.state = 'State is required';
      console.log('❌ NO STATE');
    }
    if (isOtherCustomerSelected && !formData.contact_number.trim()) {
      newErrors.contact_number = 'Phone number is required';
      console.log('❌ NO CONTACT NUMBER');
    }
    if (selectedProducts.length === 0) {
      newErrors.products = 'At least one product is required';
      console.log('❌ NO PRODUCTS SELECTED');
    }

    console.log('📊 RUNNING TAX VALIDATION...');
    // Tax-specific validation
    const taxErrors = validateAllTaxData();
    console.log('📋 TAX ERRORS FROM validateAllTaxData:', taxErrors);
    Object.assign(newErrors, taxErrors);

    // Validate total tax consistency
    const { totalCgst, totalSgst, totalIgst } = calculateExpectedTax();
    const expectedFormTotalCgst = parseFloat(formData.total_cgst) || 0;
    const expectedFormTotalSgst = parseFloat(formData.total_sgst) || 0;
    const expectedFormTotalIgst = parseFloat(formData.total_igst) || 0;

    console.log('💰 TAX CONSISTENCY CHECK:', {
      calculated: { totalCgst, totalSgst, totalIgst },
      formValues: { expectedFormTotalCgst, expectedFormTotalSgst, expectedFormTotalIgst }
    });

    if (Math.abs(totalCgst - expectedFormTotalCgst) > 0.01) {
      newErrors.totalCgst = `Total CGST mismatch: calculated ${totalCgst.toFixed(2)}, form shows ${expectedFormTotalCgst.toFixed(2)}`;
      console.log('❌ CGST MISMATCH');
    }
    if (Math.abs(totalSgst - expectedFormTotalSgst) > 0.01) {
      newErrors.totalSgst = `Total SGST mismatch: calculated ${totalSgst.toFixed(2)}, form shows ${expectedFormTotalSgst.toFixed(2)}`;
      console.log('❌ SGST MISMATCH');
    }
    if (Math.abs(totalIgst - expectedFormTotalIgst) > 0.01) {
      newErrors.totalIgst = `Total IGST mismatch: calculated ${totalIgst.toFixed(2)}, form shows ${expectedFormTotalIgst.toFixed(2)}`;
      console.log('❌ IGST MISMATCH');
    }

    // Validate payment data - convert to numbers since formData stores as strings
    const paymentStatusNum = parseInt(formData.payment_status.toString());
    const paymentModeNum = parseInt(formData.payment_mode.toString());

    if (formData.payment_status === undefined || ![0, 1, 2].includes(paymentStatusNum)) {
      newErrors.payment_status = `Payment status must be Unpaid (0), Paid (1), or Partially Paid (2), got: ${formData.payment_status}`;
      console.log('❌ INVALID PAYMENT STATUS');
    }
    if (!formData.payment_mode || ![0, 1].includes(paymentModeNum)) {
      newErrors.payment_mode = `Payment mode must be either Cash (0) or Bank (1), got: ${formData.payment_mode}`;
      console.log('❌ INVALID PAYMENT MODE');
    }

    console.log('📝 FINAL ERRORS OBJECT:', newErrors);
    console.log('✅ VALIDATION RESULT:', Object.keys(newErrors).length === 0);

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };




  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault();

    console.log('🔍 VALIDATING FORM...');
        console.log('📋 FORM DATA:', {
          invoice_number: formData.invoice_number,
          customer_name: formData.customer_name,
          selectedProducts: selectedProducts.length,
          payment_status: formData.payment_status,
          payment_mode: formData.payment_mode
        });

    const isValid = validateForm();
    console.log('✅ VALIDATION RESULT:', isValid);
    console.log('❌ ERRORS:', errors);
    console.log('💰 TAX CALCULATIONS:', {
      calculated: calculateExpectedTax(),
      formValues: {
        total_cgst: formData.total_cgst,
        total_sgst: formData.total_sgst,
        total_igst: formData.total_igst
      }
    });

    if (!isValid) {
      // Show snackbar with validation error
      const errorMessages = Object.values(errors);
      const firstError = errorMessages[0] || 'Please fix the validation errors';
      showSnackbar('error', firstError);
      
      // Scroll to top to show errors
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setShowConfirmationModal(true);
  };



  const handleConfirmSubmit = async () => {
    setLoading(true);

    try {
      // ===== COMPLETE PAYLOAD FROM UI =====
      // Mapping all collected data to match invoice API expectations
      const submitData = {
        // ===== MAIN INVOICE FIELDS =====
        invoice_no: parseInt(formData.invoice_number),               // Invoice.invoice_no
        invoice_date: formData.date, // Invoice.invoice_date - backend converts to timestamp
        select_customer: customerIdToSave || 0,                      // Invoice.select_customer (customer ID or 0 for "Other")

        // ===== CUSTOMER DETAILS (Always from form data) =====
        customer_name: formData.customer_name,
        contact_number: formData.contact_number,
        email_id: formData.email_id,
        address: formData.address,
        address_2: formData.address_2,
        city: formData.city,
        state: formData.state,
        gst_number: formData.gst_number,
        pin_code: formData.pin_code,

        // ===== CALCULATED TOTALS =====
        items_total: subtotal,                                       // Invoice.items_total
        freight: 0,                                                  // Invoice.freight (not collected separately)
        total_taxable_value: subtotal,                               // Invoice.total_taxable_value
        total_cgst: parseFloat(formData.total_cgst) || 0,            // Invoice.total_cgst
        total_sgst: parseFloat(formData.total_sgst) || 0,            // Invoice.total_sgst
        total_igst: parseFloat(formData.total_igst) || 0,            // Invoice.total_igst
        total_tax: totalTax,                                         // Invoice.total_tax
        total: grandTotal,                                           // Invoice.total

        // ===== INVOICE-LEVEL FIELDS (NEWLY ADDED TO SCHEMA) =====
        bill_reference: formData.bill_reference,                     // Invoice.bill_reference
        staff_id: formData.staff_id,                                 // Invoice.staff_id (foreign key)
        staff_details: selectedStaffId ? staffList.find(s => s.id === selectedStaffId)?.staff_name || '' : '', // Invoice.staff_details (deprecated but kept for backward compatibility)
        mechanic_id: selectedMechanicId ? parseInt(selectedMechanicId) : null, // Invoice.mechanic_id (foreign key)
        commission: parseFloat(formData.commission) || 0,            // Invoice.commission
        discount: totalDiscount,                                     // Invoice.discount (calculated as sum of item discounts)
        tax: formData.tax,                                           // Invoice.tax (tax description/notes)
        packing_forwarding_qty: parseFloat(formData.packing_forwarding_qty) || 0,   // Invoice.packing_forwarding_qty
        packing_forwarding_rate: parseFloat(formData.packing_forwarding_rate) || 0, // Invoice.packing_forwarding_rate
        packing_forwarding_total: parseFloat(formData.packing_forwarding_total) || 0, // Invoice.packing_forwarding_total

        // ===== PAYMENT FIELDS =====
        payment_status: parseInt(formData.payment_status.toString()), // Invoice.status (payment_status) as integer 0=Unpaid, 1=Paid
        payment_mode: parseInt(formData.payment_mode.toString()),     // Invoice.payment_mode as integer 1=Cash, 2=Bank

        // ===== MISC FIELDS =====
        notes: formData.notes,                                       // Invoice.notes
        descriptions: formData.descriptions,                         // Invoice.descriptions
        fy: new Date().getFullYear(),                                // Invoice.fy (calculated)
        updated_at: new Date().toISOString(),                       // Invoice.updated_at

        // ===== ITEM DATA =====
        invoiceItems: selectedProducts.map(item => ({
          product_id: item.product_id,                                // Invoiceitems.product_id (foreign key)
          name_of_product: item.product_name,                         // Invoiceitems.name_of_product
          qty: item.qty,                                              // Invoiceitems.qty
          rate: item.rate,                                            // Invoiceitems.rate
          subtotal: item.total,                                       // Invoiceitems.subtotal
          gst_percentage: item.gst_percentage,                        // Invoiceitems.gst_percentage (NEW)
          cgst: item.cgst,                                            // Invoiceitems.cgst (NEW)
          sgst: item.sgst,                                            // Invoiceitems.sgst (NEW)
          igst: item.igst,                                            // Invoiceitems.igst (NEW)
          tax: item.tax,                                              // Invoiceitems.tax (NEW)
          discount: item.discount_amount,                             // Invoiceitems.discount (item-level discount amount)
          discountrate: item.discount_percentage,                     // Invoiceitems.discountrate (item-level discount percentage)
          hsn: item.hsn || '',                                        // Invoiceitems.hsn
          part: item.part_number,                                     // Invoiceitems.part
          category_id: item.category_id,                              // Invoiceitems.category_id
          subcategory_id: item.subcategory_id,
          model_id: item.car_model_ids && item.car_model_ids.length > 0 ? parseInt(item.car_model_ids[0]) : null, // Invoiceitems.model_id (first car model)
          company_id: item.company_id,                                // Invoiceitems.company_id
          invoice_date: formData.date, // Invoiceitems.invoice_date - backend converts to timestamp
          fy: new Date().getFullYear()                                // Invoiceitems.fy
        })),

        // ===== TRANSPORT DETAILS =====
        transportDetails: {
          trans_mode: formData.transport_name,                        // transport_details.trans_mode
          vehicle_no: formData.vehicle_number                         // transport_details.vehicle_no
        }
      };

      console.log('📤 UI SENDING COMPLETE PAYLOAD:', submitData);

      const method = isEditMode ? 'PUT' : 'POST';
      const url = isEditMode ? `/api/invoices/${editInvoiceId}` : '/api/invoices';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        if (editInvoiceId) {
          SessionStorageService.remove('sales', editInvoiceId.toString());
        }
        setShowConfirmationModal(false);


        // Broadcast the creation/update event
        broadcast({
          type: isEditMode ? 'updated' : 'created',
          resource: 'sales',
          data: { id: isEditMode ? editInvoiceId : (response as any).sale?.id || (response as any).id }
        });


        // Navigate to sale view page for both create and update
        const saleId = isEditMode ? editInvoiceId : (response as any).sale?.id;
        if (saleId) {
          router.push(`/sale/view/${saleId}`);
        } else {
          // Fallback to sales list if no sale ID
          router.push('/sale');
        }

        // Show snackbar after navigation
        showSnackbar('success', `Invoice ${isEditMode ? 'updated' : 'created'} successfully!`);
      } else {
        const error = await response.json();
        console.error('❌ API Error:', error);
        showSnackbar('error', error.message || `Failed to ${isEditMode ? 'update' : 'create'} invoice`);
        setErrors({ submit: error.message || `Failed to ${isEditMode ? 'update' : 'create'} invoice` });
      }
      // Always close modal after API completes (regardless of success/failure)
      setShowConfirmationModal(false);
    } catch (error) {
      console.error('❌ Network Error:', error);
      setErrors({ submit: 'Network error occurred' });
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
          <div className="p-6">

            {/* Invoice Information */}
            <div className="mb-3">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                      placeholder="Auto-generated"
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">STAFF MEMBER</label>
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Staff' },
                      ...staffList.map((staff) => ({
                        id: staff.id.toString(),
                        name: staff.staff_name
                      }))
                    ]}
                    selectedValue={selectedStaffId || formData.staff_id?.toString() || ''}
                    onSelectionChange={(value) => {
                      const staffId = value || '';
                      setSelectedStaffId(staffId);
                      handleInputChange('staff_id', staffId ? parseInt(staffId) : null);
                    }}
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

            {/* Customer Information */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">CUSTOMER NAME *</label>
                    <a
                      href="/customers/create?from=sale"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors"
                    >
                      + Add New Customer
                    </a>
                  </div>
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Customer' },
                      { id: '0', name: 'Other' },
                      ...customers.map((customer) => ({
                        id: customer.id.toString(),
                        name: customer.billing_name
                      }))
                    ]}
                    selectedValue={selectedCustomerId}
                    onSelectionChange={(value) => {
                      const customerId = value || '';
                      setSelectedCustomerId(customerId);
                      handleCustomerSelect(customerId);
                    }}
                    placeholder="Select Customer"
                  />
                  {errors.customer_name && <p className="text-red-400 text-xs mt-1">{errors.customer_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER{isOtherCustomerSelected ? ' *' : ''}</label>
                  <input
                    type="text"
                    value={formData.contact_number || selectedCustomer?.contact_no || ''}
                    onChange={(e) => handleInputChange('contact_number', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter contact number"
                    maxLength={10}
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={formData.email_id || selectedCustomer?.email || ''}
                    onChange={(e) => handleInputChange('email_id', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter email address"
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={formData.gst_number || selectedCustomer?.tax_id || ''}
                    onChange={(e) => handleInputChange('gst_number', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter GST number"
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
              </div>
              <div className={`grid grid-cols-1 ${isOtherCustomerSelected ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
                {isOtherCustomerSelected && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">MANUAL CUSTOMER NAME *</label>
                    <input
                      type="text"
                      value={formData.customer_name}
                      onChange={(e) => handleInputChange('customer_name', e.target.value)}
                      className="input w-full"
                      placeholder="Enter customer name"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">LINE 1</label>
                  <input
                    type="text"
                    value={formData.address || selectedCustomer?.address || ''}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter address line 1"
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">LINE 2</label>
                  <input
                    type="text"
                    value={formData.address_2 || selectedCustomer?.address_2 || ''}
                    onChange={(e) => handleInputChange('address_2', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter address line 2"
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CITY</label>
                  <input
                    type="text"
                    value={formData.city || selectedCustomer?.city || ''}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className={`input w-full ${!isOtherCustomerSelected ? 'bg-slate-700 cursor-not-allowed' : ''}`}
                    placeholder="Enter city"
                    readOnly={!isOtherCustomerSelected}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STATE *</label>
                  <SearchableSelect
                    options={states.map((state) => ({
                      id: state.id,
                      name: state.name
                    }))}
                    selectedValue={(() => {
                      // Find the state ID that matches the current state code
                      if (selectedCustomer?.state_code) {
                        const matchingState = states.find(state => state.code === selectedCustomer.state_code);
                        return matchingState ? matchingState.id : '';
                      }
                      // Fallback to state name matching if no state code
                      if (formData.state || selectedCustomer?.state) {
                        const currentStateName = formData.state || selectedCustomer?.state || '';
                        const matchingState = states.find(state => state.name === currentStateName);
                        return matchingState ? matchingState.id : '';
                      }
                      return '';
                    })()}
                    onSelectionChange={(value) => {
                      if (isOtherCustomerSelected) {
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
                      }
                    }}
                    placeholder="Select State"
                    disabled={!isOtherCustomerSelected}
                  />
                  {errors.state && <p className="text-red-400 text-xs mt-1">{errors.state}</p>}
                </div>
              </div>
            </div>


            {/* Customer Service Details */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Service Details</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">MECHANIC NAME</label>
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Mechanic' },
                      ...mechanics.map((mechanic) => ({
                        id: mechanic.id,
                        name: mechanic.mechanic_name
                      }))
                    ]}
                    selectedValue={selectedMechanicId || formData.mechanic_id?.toString() || ''}
                    onSelectionChange={(value) => {
                      const mechanicId = value || '';
                      setSelectedMechanicId(mechanicId);
                      setFormData(prev => ({ ...prev, mechanic_id: mechanicId ? parseInt(mechanicId) : null }));
                    }}
                    placeholder="Select Mechanic"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">COMMISSION</label>
                  <input
                    type="number"

                    value={formData.commission}
                    onChange={(e) => handleInputChange('commission', e.target.value)}
                    className="input w-full"
                    placeholder="0"
                    onWheel={(e) => e.preventDefault()}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Discount & Tax Section */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex flex-row-reverse mb-3 space-x-6">
                {/* <h3 className="text-lg font-medium text-slate-200">Discount & Tax</h3> */}
                {enableDiscount && (
                  <div className="text-xs text-slate-400 mt-1">
                    Fixed amount discount enabled
                  </div>
                )}
                <label className="flex items-center space-x-2 cursor-pointer pr-4">
                  <input
                    type="checkbox"
                    checked={enableDiscount}
                    onChange={(e) => setEnableDiscount(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-sm text-slate-300">Enable Discount</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableTax}
                    onChange={(e) => setEnableTax(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-sm text-slate-300 pr-4">Enable Tax</span>
                </label>
              </div>

            </div>

            {/* Product Selection */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Product Selection</h3> */}

              {/* Product Selection & Display Table */}
              <div className="border border-slate-600 rounded mb-3">
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-12">
                        SN
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        PRODUCT NAME
                      </th>
                      {/* <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        CATEGORY
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        SUB CATEGORY
                      </th> */}
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        CAR MODELS
                      </th>
                      {/* <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        COMPANY
                      </th> */}
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        PART NO
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">
                        QTY
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-32">
                        RATE
                      </th>
                      {enableTax && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-32">
                          GST (%)
                        </th>
                      )}
                      {enableDiscount && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                          DISCOUNT (₹)
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
                      <td className="px-4 py-3 text-center text-xs text-slate-300 w-12">
                        {selectedProducts.length > 0 ? selectedProducts.length + 1 : 1}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedCustomerId) {
                              setErrors({ customer_name: 'Please select customer first' });
                              return;
                            }
                            setErrors({});
                            setProductSearchTerm('');
                            setIsProductPanelOpen(true);
                          }}
                          disabled={!selectedCustomerId}
                          className={`w-full px-3 py-2 border rounded text-xs text-white text-left transition-colors ${selectedCustomerId
                            ? 'bg-slate-700 border-slate-600 hover:bg-slate-600'
                            : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                          title={!selectedCustomerId ? 'Please select customer first' : ''}
                        >
                          {selectedRowProduct ? (
                            productRowFilters.carModels.length > 0
                              ? generateDynamicProductName(selectedRowProduct, productRowFilters.carModels)
                              : (selectedRowProduct.product_name || 'Select Product')
                          ) : (
                            <span className="text-slate-400">Select Product</span>
                          )}
                        </button>

                      </td>
                      {/* <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: 'Select Category' },
                            ...filterOptions.categories.map((cat) => ({
                              id: cat.id.toString(),
                              name: cat.name
                            }))
                          ]}
                          selectedValue={productRowFilters.category?.toString() || ''}
                          onSelectionChange={(value) => {
                            const categoryId = parseInt(value) || 0;
                            const categoryName = filterOptions.categories.find(cat => cat.id.toString() === value)?.name || '';
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: categoryId,
                              categoryName: categoryName
                            }));
                          }}
                          placeholder="Select Category"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: !productRowFilters.category ? "Please select a category first" : "Select Sub Category" },
                            ...filteredSubcategories.map((sub) => ({
                              id: sub.id.toString(),
                              name: sub.name
                            }))
                          ]}
                          selectedValue={productRowFilters.subcategory?.toString() || ''}
                          onSelectionChange={(value) => {
                            const subcategoryId = parseInt(value) || 0;
                            const subcategoryName = filteredSubcategories.find(sub => sub.id.toString() === value)?.name || '';
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: subcategoryId,
                              subcategoryName: subcategoryName
                            }));
                          }}
                          placeholder={!productRowFilters.category ? "Please select a category first" : "Select Sub Category"}
                          disabled={!productRowFilters.category}
                        />
                      </td> */}
                      <td className="px-4 py-3">
                        <SearchableMultiSelect
                          options={filteredCarModels.map(model => ({ id: model.id.toString(), name: model.name })) || []}
                          selectedValues={productRowFilters.carModels}
                          onSelectionChange={(values) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              carModels: values
                            }));
                          }}
                          placeholder="Select car models..."
                        />
                      </td>
                      {/* <td className="px-4 py-3">
                        <SearchableSelect
                          options={[
                            { id: '', name: 'Select Company' },
                            ...filterOptions.companies.map((comp) => ({
                              id: comp.id.toString(),
                              name: comp.name
                            }))
                          ]}
                          selectedValue={productRowFilters.company?.toString() || ''}
                          onSelectionChange={(value) => {
                            const companyId = parseInt(value) || 0;
                            const companyName = filterOptions.companies.find(comp => comp.id.toString() === value)?.name || '';
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: companyId,
                              companyName: companyName
                            }));
                          }}
                          placeholder="Select Company"
                        />
                      </td> */}
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
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="1"
                          value={templateRow.qty}
                          onChange={(e) => {
                            const newQty = e.target.value;
                            setLastEditedField('qty');
                            
                            if (newQty === '') {
                              setTemplateRow(prev => ({ ...prev, qty: '', total: '' }));
                              return;
                            }
                            
                            const qty = parseInt(newQty);
                            if (isNaN(qty) || qty < 0) return;
                            
                            // If user already entered total manually, calculate rate from it
                            if (lastEditedField === 'total' && templateRow.total) {
                              const total = parseInt(templateRow.total);
                              const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;
                              const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;
                              const taxableAmount = total - discountAmount;
                              const rate = qty > 0 ? taxableAmount / (qty * (1 + gstPercent / 100)) : 0;
                              setTemplateRow(prev => ({
                                ...prev,
                                qty: qty.toString(),
                                rate: rate.toFixed(2)
                              }));
                            } else {
                              // Calculate total from qty × rate
                              const rate = parseFloat(templateRow.rate) || 0;
                              const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;
                              const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;
                              const subtotal = qty * rate;
                              const taxableAmount = subtotal - discountAmount;
                              const taxAmount = (taxableAmount * gstPercent) / 100;
                              const total = Math.round(taxableAmount + taxAmount);
                              
                              setTemplateRow(prev => ({
                                ...prev,
                                qty: qty.toString(),
                                total: total.toString()
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
                      <td className="px-4 py-3 text-center w-32">
                        <input
                          type="number"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0"
                          value={templateRow.rate}
                          onChange={(e) => {
                            const newRate = e.target.value;
                            setLastEditedField('rate');
                            
                            if (newRate === '') {
                              setTemplateRow(prev => ({ ...prev, rate: '', total: '' }));
                              return;
                            }
                            
                            const rate = parseFloat(newRate);
                            if (isNaN(rate) || rate < 0) return;
                            
                            const qty = parseInt(templateRow.qty) || 0;
                            const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;
                            const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;

                            if (qty > 0) {
                              const subtotal = qty * rate;
                              const taxableAmount = subtotal - discountAmount;
                              const taxAmount = (taxableAmount * gstPercent) / 100;
                              const total = Math.round(taxableAmount + taxAmount);

                              setTemplateRow(prev => ({
                                ...prev,
                                rate: newRate,
                                total: total.toString()
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                rate: newRate
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
                        <td className="px-4 py-3 text-center w-32">
                          <input
                            type="number"

                            className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                            placeholder="0"
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
                      {enableDiscount && (
                        <td className="px-4 py-3 text-center w-20">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                            placeholder="0"
                            value={templateRow.discount}
                            onChange={(e) => {
                              setTemplateRow(prev => ({
                                ...prev,
                                discount: e.target.value
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
                          placeholder="0"
                          value={templateRow.total}
                          onChange={(e) => {
                            const newTotal = e.target.value;
                            setLastEditedField('total');
                            
                            if (newTotal === '') {
                              setTemplateRow(prev => ({ ...prev, total: '', rate: '' }));
                              return;
                            }
                            
                            const enteredTotal = parseInt(newTotal);
                            if (isNaN(enteredTotal) || enteredTotal < 0) return;
                            
                            const qty = parseInt(templateRow.qty) || 0;
                            const gstPercent = enableTax ? (parseFloat(templateRow.gst) || 0) : 0;
                            const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;

                            if (qty > 0) {
                              // Calculate rate from total considering tax and discount - allow decimals
                              // total = (qty * rate - discount) * (1 + gst/100)
                              // rate = (total / (1 + gst/100) + discount) / qty
                              const totalBeforeTax = enteredTotal / (1 + gstPercent / 100);
                              const rate = (totalBeforeTax + discountAmount) / qty;
                              setTemplateRow(prev => ({
                                ...prev,
                                total: enteredTotal.toString(),
                                rate: rate.toFixed(2)
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                total: enteredTotal.toString()
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
                      <td className="px-4 py-3 text-center w-20 flex flex-row mt-2 mr-4">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedRowProduct !== null) {
                              const selectedProduct = selectedRowProduct;
                              if (selectedProduct) {
                                // Convert car model IDs to names for display
                                const carModelNames = productRowFilters.carModels
                                  .map(id => {
                                    const model = filterOptions.models.find(m => m.id.toString() === id);
                                    return model ? model.name : id;
                                  })
                                  .filter(name => name)
                                  .join(', ');

                                // Use product details and template values
                                const qty = parseFloat(templateRow.qty) || 1;
                                const rate = parseFloat(templateRow.rate) || selectedProduct.selling_price || 0;
                                const gstPercent = enableTax ? parseFloat(templateRow.gst) || 0 : 0;
                                const discountAmount = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;

                                // Calculate amounts
                                const subtotal = qty * rate;
                                const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
                                const taxableAmount = subtotal - discountAmount;
                                const tax = enableTax ? (taxableAmount * gstPercent) / 100 : 0; // Tax on discounted price, or 0 if tax disabled

                                // Calculate tax breakdown based on customer's state (only if tax is enabled)
                                const customerStateCode = getStateCodeFromName(formData.state);
                                const gstBreakdown = enableTax ? calculateGSTBreakdown(tax, customerStateCode || null) : { cgst: 0, sgst: 0, igst: 0 };
                                const cgst = gstBreakdown.cgst;
                                const sgst = gstBreakdown.sgst;
                                const igst = gstBreakdown.igst;

                                const { companyId, companyName } = getCompanyInfo(selectedProduct);

                                const newItem: InvoiceItem = {
                                  id: Date.now().toString(),
                                  product_id: selectedProduct.id,
                                  product_name: selectedProduct.product_name,
                                  car_model_ids: selectedProduct.car_model_ids ? selectedProduct.car_model_ids.split(',').map(id => id.trim()) : [],
                                  car_model_names: carModelNames ? carModelNames.split(', ') : [],
                                  category_id: selectedProduct.product_category_id || 0,
                                  category_name: selectedProduct.category_name || filterOptions.categories.find(c => c.id.toString() === selectedProduct.product_category_id?.toString())?.name || '',
                                  subcategory_id: selectedProduct.product_subcategory_id || null,
                                  subcategory_name: selectedProduct.subcategory_name || filterOptions.subcategories.find(s => s.id.toString() === selectedProduct.product_subcategory_id?.toString() && s.category_id === selectedProduct.product_category_id)?.name || '',
                                  company_id: companyId,
                                  company_name: companyName,
                                  part_number: productRowFilters.partNo,
                                  qty: qty,
                                  rate: rate,
                                  gst_percentage: gstPercent, // Store GST percentage
                                  discount_percentage: discountPercentage,
                                  tax: tax,
                                  discount_amount: discountAmount,
                                  total: taxableAmount + tax,
                                  // New pricing fields
                                  hsn: selectedProduct.hsn || '',
                                  mrp: 0, // Default MRP
                                  discount: discountPercentage, // Store discount percentage
                                  margin: 0, // Default margin
                                  // GST breakdown
                                  cgst: cgst,
                                  sgst: sgst,
                                  igst: igst
                                };
                                console.log("newItem", newItem)
                                setSelectedProducts(prev => [...prev, newItem]);

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
                                  rate: '0',
                                  gst: '0',
                                  discount: '0',
                                  total: ''
                                });
                              }
                            }
                          }}
                          disabled={!selectedRowProduct}
                          className={`px-3 py-1 text-xs mr-2 rounded font-medium transition-colors ${selectedRowProduct
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                          Add
                        </button>
                        <div className="flex items-center justify-center space-x-1">
                          {selectedRowProduct && (
                            <button
                              type="button"
                              onClick={() => {
                                // Clear selected product and reset template row
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
                                setFilteredCarModels([]);
                                setFilteredSubcategories([]);
                                setTemplateRow({
                                  qty: '1',
                                  rate: '',
                                  gst: '0',
                                  discount: '0',
                                  total: ''
                                });
                              }}
                              className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                              title="Clear selected product"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Added Products Rows */}
                    {selectedProducts.map((product, index) => (
                      <tr key={product.id} className={`${editingRowId === product.id ? 'bg-yellow-900' : 'bg-slate-800 hover:bg-slate-750'} border-t border-slate-600`}>
                        <td className="px-3 py-2 text-center text-xs text-slate-300">
                          {index + 1}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-200">
                          {product.display_name || product.product_name}
                        </td>
                        {/* <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.category_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.subcategory_name || '-'}
                        </td> */}
                        {editingRowId === product.id ? (
                          <td className="px-3 py-2">
                            {(() => {
                              // Find the product being edited to filter compatible car models
                              const editingProduct = products.find(p => p.id === product.product_id);
                              // Filter compatible models for this product
                              const compatibleModels = editingProduct ? getFilteredCarModelsForProduct(editingProduct) : [];
                              // Get current car model names - use editingRowData if available, otherwise product data
                              const currentCarModels = editingRowData?.car_model_names || product.car_model_names || [];
                              // Find the first car model for pre-selection (single selection)
                              const currentModel = filterOptions.models.find(model =>
                                currentCarModels.includes(model.name)
                              );
                              const selectedModelId = currentModel ? currentModel.id.toString() : '';

                              return (
                                <SearchableMultiSelect
                                  options={compatibleModels.map(model => ({ id: model.id.toString(), name: model.name })) || []}
                                  selectedValues={[selectedModelId].filter(Boolean)}
                                  onSelectionChange={(values) => {
                                    // For inline editing, only allow single car model selection
                                    let newCarModelNames: string[] = [];
                                    let updatedProductName = editingRowData?.product_name || product.product_name || '';

                                    if (values.length > 0) {
                                      const selectedModel = compatibleModels.find(model => model.id.toString() === values[0]);
                                      const newCarModel = selectedModel ? selectedModel.name : '';
                                      newCarModelNames = [newCarModel];

                                      // Update the product name directly when car model changes
                                      if (newCarModel) {
                                        // Find the product being edited to get full details
                                        const editingProduct = products.find(p => p.id === product.product_id);
                                        if (editingProduct) {
                                          updatedProductName = generateDynamicProductName(editingProduct, [values[0]], editingRowData.part_number);
                                        }
                                      }
                                    }

                                    // Update editing row data with both car model changes and updated product name
                                    setEditingRowData(prev => prev ? {
                                      ...prev,
                                      car_model_names: newCarModelNames,
                                      product_name: updatedProductName
                                    } : null);

                                    // Recalculate totals based on changes
                                    if (editingRowData) {
                                      const subtotal = editingRowData.qty * editingRowData.rate;
                                      const discountAmount = enableDiscount ? (subtotal * editingRowData.discount_percentage) / 100 : 0;
                                      const taxableAmount = subtotal - discountAmount;
                                      const taxAmount = (taxableAmount * editingRowData.gst_percentage) / 100;

                                      // Recalculate GST breakdown based on customer's state
                                      const customerStateCode = getStateCodeFromName(formData.state);
                                      const gstBreakdown = calculateGSTBreakdown(taxAmount, customerStateCode || null);
                                      const updatedItem = {
                                        ...editingRowData,
                                        car_model_names: newCarModelNames,
                                        product_name: updatedProductName,
                                        tax: taxAmount,
                                        total: taxableAmount + taxAmount,
                                        cgst: gstBreakdown.cgst,
                                        sgst: gstBreakdown.sgst,
                                        igst: gstBreakdown.igst
                                      };

                                      setEditingRowData(updatedItem);
                                    }
                                  }}
                                  placeholder="Select car model..."
                                />
                              );
                            })()}
                          </td>
                        ) : (
                          <td className="px-3 py-2 text-center text-xs text-slate-200">
                            {product.car_model_names.join(', ') || '-'}
                          </td>
                        )}
                        {/* <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.company_name || '-'}
                        </td> */}
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.part_number || '-'}
                        </td>
                        {editingRowId === product.id ? (
                          <>
                            {/* Editable fields when inline editing */}
                            <td className="px-3 py-2 text-center w-24">
                              <input
                                type="number"
                                value={editingRowData?.qty || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, qty: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-center w-32">
                              <input
                                type="number"
                                value={editingRowData?.rate || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, rate: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </td>
                            {enableTax && (
                              <td className="px-3 py-2 text-center w-32">
                                <input
                                  type="number"

                                  value={editingRowData?.gst_percentage || ''}
                                  onChange={(e) => setEditingRowData(prev => prev ? { ...prev, gst_percentage: parseFloat(e.target.value) || 0 } : null)}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                  onWheel={(e) => e.preventDefault()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                      e.preventDefault();
                                    }
                                  }}
                                />
                              </td>
                            )}
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center w-20">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={editingRowData?.discount_amount || ''}
                                  onChange={(e) => {
                                    const discountAmount = parseFloat(e.target.value) || 0;
                                    setEditingRowData(prev => {
                                      if (!prev) return null;
                                      const subtotal = prev.qty * prev.rate;
                                      const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
                                      return { ...prev, discount_amount: discountAmount, discount_percentage: discountPercentage };
                                    });
                                  }}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                  onWheel={(e) => e.preventDefault()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                      e.preventDefault();
                                    }
                                  }}
                                />
                              </td>
                            )}
                            <td className="px-3 py-2 text-center text-green-400">
                              ₹{editingRowData ? (() => {
                                const subtotal = editingRowData.qty * editingRowData.rate;
                                const discountAmount = enableDiscount ? (subtotal * editingRowData.discount_percentage) / 100 : 0;
                                const taxableAmount = subtotal - discountAmount;
                                const tax = (taxableAmount * editingRowData.gst_percentage) / 100;
                                return (taxableAmount + tax).toFixed(2);
                              })() : product.total.toFixed(2)}
                            </td>
                            {/* Save/Cancel buttons */}
                            <td className="px-3 py-2 text-center">
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
                            <td className="px-3 py-2 text-center text-xs text-slate-200">
                              {product.qty}
                            </td>
                            <td className="px-3 py-2 text-center text-xs text-slate-200">
                              ₹{Math.round(product.rate)}
                            </td>
                            {enableTax && (
                              <td className="px-3 py-2 text-center text-xs text-slate-200">
                                {product.gst_percentage}%
                              </td>
                            )}
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center text-xs text-slate-200">
                                ₹{Math.round(product.discount_amount)}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center text-sm font-medium text-slate-200">
                              ₹{Math.round(product.total)}
                            </td>
                            <td className="px-3 py-2 text-center">
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
                                  onClick={() => removeProduct(product.id)}
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
                      {totalDiscount > 0 && (
                        <tr>
                          <td colSpan={enableDiscount && enableTax ? 8 : enableDiscount || enableTax ? 7 : 6} className="px-4 py-3"></td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                            TOTAL DISCOUNT
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                            -₹{totalDiscount.toFixed(2)}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount && enableTax ? 8 : enableDiscount || enableTax ? 7 : 6} className="px-4 py-3"></td>
                        <td colSpan={2} className="px-4 py-3 text-center">
                          {/* Display Subtotal */}
                          <div className="text-sm font-semibold text-slate-200">
                            Subtotal: ₹{subtotal.toFixed(2)}
                          </div>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
              {!selectedCustomerId && (
                <p className="text-xs text-amber-400 mt-1">Select customer first</p>
              )}
            </div>

            {/* Additional Information */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Additional Information</h3> */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">DESCRIPTIONS</label>
                  <textarea
                    value={formData.descriptions}
                    onChange={(e) => handleInputChange('descriptions', e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Enter additional descriptions or comments"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">NOTES</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Enter additional notes"
                  />
                </div>
              </div>
            </div>

            {/* Summary & Payment */}
            <div className="border-t border-slate-600 pt-4">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Summary & Payment</h3> */}
              <div className="space-y-6">

                {/* Tax Breakdown */}
                {enableTax && (
                  <div>
                    {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Tax Breakdown</h4> */}
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                        <input
                          type="number"

                          value={formData.total_cgst}
                          readOnly
                          disabled
                          className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                          placeholder="0"
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
                          placeholder="0"
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
                          placeholder="0"
                        />
                      </div>
                      <div className="grid gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">DISCOUNT</label>
                          <input
                            type="number"

                            value={totalDiscount.toFixed(2)}
                            readOnly
                            disabled
                            className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Calculations */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">SUBTOTAL</label>
                    <input
                      type="number"

                      value={subtotal.toFixed(2)}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    />
                  </div>
                  {enableTax && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL TAX</label>
                      <input
                        type="number"

                        value={totalTax.toFixed(2)}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      />
                    </div>
                  )}
                </div>

                {/* Packing & Forwarding */}
                <div>
                  {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Packing & Forwarding</h4> */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">QTY</label>
                      <input
                        type="number"

                        value={formData.packing_forwarding_qty}
                        onChange={(e) => handleInputChange('packing_forwarding_qty', e.target.value)}
                        className="input w-full"
                        placeholder="0"
                      />
                    </div>
                    {/* RATE FIELD HIDDEN - Auto-calculated */}
                    {/* <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">RATE</label>
                      <input
                        type="number"

                        value={formData.packing_forwarding_rate}
                        onChange={(e) => handleInputChange('packing_forwarding_rate', e.target.value)}
                        className="input w-full"
                        placeholder="0"
                      />
                    </div> */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL</label>
                      <input
                        type="number"

                        value={formData.packing_forwarding_total}
                        onChange={(e) => handleInputChange('packing_forwarding_total', e.target.value)}
                        onWheel={(e) => e.preventDefault()}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault();
                          }
                        }}
                        className="input w-full"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                {/* Additional Calculations */}


                {/* Payment Details */}
                <div className="border-t border-slate-600 pt-4">
                  {/* <h4 className="text-sm font-medium text-slate-300 mb-4">Payment Details</h4> */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS *</label>
                      <SearchableSelect
                        options={[
                          { id: '0', name: 'Unpaid' },
                          { id: '1', name: 'Paid' }
                        ]}
                        selectedValue={formData.payment_status.toString()}
                        onSelectionChange={(value) => handleInputChange('payment_status', Number(value))}
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
                        onSelectionChange={(value) => handleInputChange('payment_mode', Number(value))}
                        placeholder="Select Payment Mode"
                      />
                    </div>
                    {/* Grand Total */}
                    <div className="bg-slate-700 rounded p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-medium">GRAND TOTAL</span>
                        <div className="flex items-center space-x-2">
                          <Calculator className="w-4 h-4 text-slate-400" />
                          <span className="text-white font-semibold text-lg">
                            ₹{grandTotal.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>


              </div>
            </div>

          </div>

          {/* Form Actions */}
          <div className="border-t border-slate-600 pt-6 mt-6 px-6">
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  SessionStorageService.remove('sales', editInvoiceId.toString());
                  router.push('/sale')
                }}
                className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Invoice' : 'Create Invoice')}
              </button>
            </div>
          </div>
        </div>
      </form >

      {/* Product Selection Side Panel */}
      < ProductSelectionPanel
        isOpen={isProductPanelOpen}
        onClose={() => {
          setIsProductPanelOpen(false);
          // Clear filters when closing
          setSelectedPanelCarModel('');
          setSelectedPanelCategory('');
          setSelectedPanelSubcategory('');
          setSelectedPanelCompany('');
        }}
        title="Select Product"
        showCarModelFilter={true}
        filterOptions={memoizedFilterOptions}
        selectedCarModel={selectedPanelCarModel}
        onCarModelSelection={setSelectedPanelCarModel}
        selectedCategory={selectedPanelCategory}
        onCategorySelection={setSelectedPanelCategory}
        selectedSubcategory={selectedPanelSubcategory}
        onSubcategorySelection={setSelectedPanelSubcategory}
        selectedCompany={selectedPanelCompany}
        onCompanySelection={setSelectedPanelCompany}
        searchedProducts={products}
        productSearchTerm={productSearchTerm}
        onSearchTermChange={setProductSearchTerm}
        isLoading={productsLoading}
        onProductSelect={(product) => {
          console.log('🎯 SELECTED PRODUCT FROM PANEL:', {
            product: product.product_name,
            latest_selling_price: product.latest_selling_price,
            gst_rate_percentage: product.gst_rate_percentage,
            gst_rate: product.gst_rate
          });
          handleProductSelection(product);
          setTemplateRow({
            qty: '1',
            rate: product.latest_selling_price?.toString() || product.rate?.toString() || '0',
            gst: product.gst_rate_percentage?.toString() || product.gst_rate?.toString() || '0',
            discount: '0',
            total: ''
          });
          setIsProductPanelOpen(false);
          setProductSearchTerm('');
          // Clear filters after selection
          setSelectedPanelCarModel('');
          setSelectedPanelCategory('');
          setSelectedPanelSubcategory('');
          setSelectedPanelCompany('');
        }}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title={isEditMode ? "Update Invoice?" : "Create Invoice?"}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this invoice for ₹${grandTotal.toFixed(2)}? ${isEditMode ? 'This will update the existing invoice.' : 'This action cannot be undone.'}`}
        confirmText={isEditMode ? "Update Invoice" : "Create Invoice"}
        cancelText="Cancel"
        showLoading={loading}
        loadingText={isEditMode ? "Updating Invoice..." : "Creating Invoice..."}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div >
  );
}
