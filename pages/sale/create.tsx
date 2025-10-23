import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Calculator, Loader, Trash2, Edit2, Plus, Filter } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import SessionStorageService from '../../lib/sessionStorage';
import { useSnackbar } from '../../components/SnackbarProvider';

interface Customer {
  id: string;
  billing_name: string;
  shipping_name?: string;
  billing_address?: string;
  billing_address_2?: string;
  billing_city?: string;
  billing_state?: number;
  billing_state_code?: number;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_state?: number;
  shipping_state_code?: number;
  billing_gstin?: string;
  shipping_gstin?: string;
  contact_no?: string;
  email?: string;
}

interface StaffDetails {
  id: string;
  staff_name: string;
}

interface Mechanic {
  id: string;
  mechanic_name: string;
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
  transport_name: string;
  city: string;
  email_id: string;
  discount: string;
  state: string;
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

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staffList, setStaffList] = useState<StaffDetails[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<InvoiceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [vendorIdToSave, setVendorIdToSave] = useState<number | null>(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);

  // Shipping address selection state
  const [useShippingAddress, setUseShippingAddress] = useState(false);

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
  const [selectedPanelCarModels, setSelectedPanelCarModels] = useState<string[]>([]);

  // Helper function to get consistent company info from product
  const getCompanyInfo = (product: Product) => {
    const companyId = product.company_id || (product.company ? parseInt(product.company) : null);
    const companyName = companyId ? filterOptions.companies.find(comp => comp.id.toString() === companyId.toString())?.name : null;
    return { companyId, companyName };
  };

  // Function to generate dynamic product name based on car model selection
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[]): string => {
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name;
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name;
    const { companyName } = getCompanyInfo(product);

    // // If no specific car model is selected, show base product name
    // if (selectedCarModelIds.length === 0) {
    //   return `${categoryName}-${subcategoryName}-ALL-${companyName}`;
    // }

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

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    gst: '0',
    discount: '0'
  });

  // State for discount toggle
  const [enableDiscount, setEnableDiscount] = useState(false);

  // State for selected customer details (fetched on-demand, not stored in formData)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // New state for GST rates (from product create)
  const [gstRates, setGstRates] = useState<any[]>([]);

  // State for customer state code (like vendor state in purchase create)
  const [customerStateForTax, setCustomerStateForTax] = useState<number>(); // Track customer's state code for tax calculations (default to business state)

  // State for inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<InvoiceItem | null>(null);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // Initialize snackbar hook
  const { showSnackbar } = useSnackbar();

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
    transport_name: '',
    city: '',
    email_id: '',
    discount: '',
    state: '',
    gst_number: '',
    tax: '',
    notes: '',
    payment_status: 1, // Default to Paid (only 0=Unpaid, 1=Paid allowed)
    payment_mode: 1, // Default to Cash
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
    total_igst: ''
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
        // Fetch customers first so customer data is available for edit mode
        await fetchCustomers();

        // Fetch other data in parallel
        await Promise.all([
          fetchStaffList(),
          fetchMechanics(),
          fetchProducts(),
          fetchFilterOptions(),
          fetchGstRates()
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

      // Clear raw items after conversion
      setRawInvoiceItems([]);
    }
  }, [rawInvoiceItems, filterOptions.categories, filterOptions.subcategories, filterOptions.companies, filterOptions.models]);

  // Fetch invoice data when edit mode is detected
  useEffect(() => {
    if (customersLoaded && isEditMode && editInvoiceId) {
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
          transport_name: transportDetails?.trans_mode || '',
          city: invoiceData.city || '',
          email_id: invoiceData.email_id || '',
          discount: invoiceData.discount || '',
          state: invoiceData.state || '',
          gst_number: invoiceData.gst_number || '',
          tax: invoiceData.tax || '',
          notes: invoiceData.notes || '',
          payment_status: invoiceData.status || 1,
          payment_mode: invoiceData.payment_mode || 1,
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
          total_igst: invoiceData.total_igst ? invoiceData.total_igst.toString() : '0'
        });

        // Set customer data from billingDetails
        console.log("setting customer id ")
        if (invoiceData?.customer_id || invoiceData?.select_customer) {
          selectCustomerById((invoiceData.customer_id || invoiceData.select_customer).toString())
        }

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

  }, [customersLoaded, isEditMode, editInvoiceId]);

  const selectCustomerById = (customerId: string) => {
    console.log('🔄 selectCustomerById called with customerId:', customerId);
    console.log('📋 Current customers list length:', customers.length);
    console.log('📋 Current customers:', customers.map(c => ({ id: c.id, name: c.billing_name })));

    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      console.log('✅ Customer found in loaded list, setting customer data:', customer.billing_name);
      console.log('📊 Customer details:', {
        id: customer.id,
        billing_name: customer.billing_name,
        contact_no: customer.contact_no,
        billing_address: customer.billing_address
      });

      // Set selection state
      console.log('🔄 Calling setSelectedCustomerId with:', customerId);
      setSelectedCustomerId(customerId);

      console.log('🔄 Calling setSelectedCustomer with customer object');
      setSelectedCustomer(customer);

      console.log('🔄 Calling setVendorIdToSave with:', parseInt(customerId));
      setVendorIdToSave(parseInt(customerId));

      // Populate form fields with customer data
      console.log('🔄 Updating formData with customer details');
      setFormData(prev => ({
        ...prev,
        customer_name: customer.billing_name,
        contact_number: customer.contact_no || '',
        address: customer.billing_address || '',
        city: customer.billing_city || '',
        state: customer.billing_state?.toString() || '',
        gst_number: customer.billing_gstin || '',
        email_id: customer.email || ''
      }));

      console.log('✅ selectCustomerById completed successfully');
    } else {
      console.warn(`❌ Customer with ID ${customerId} not found in loaded customers list`);
      console.log('📋 Available customer IDs:', customers.map(c => c.id));
    }
  };



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




  // Filter products based on car model selection and search term
  useEffect(() => {
    let filtered = products;

    // Apply car model filter if any selected
    if (selectedPanelCarModels.length > 0) {
      filtered = filtered.filter(product => {
        if (!product.car_model_ids) return false;
        const productModelIds = product.car_model_ids.split(',').map(id => id.trim());
        return selectedPanelCarModels.some(selectedModel =>
          productModelIds.includes(selectedModel)
        );
      });
    }

    // Apply text search filter
    if (productSearchTerm.trim()) {
      const searchTermNormalized = productSearchTerm.replace(/[\s\-\_]/g, '').toLowerCase();
      filtered = filtered.filter(product => {
        const productNameNormalized = product.product_name.replace(/[\s\-\_]/g, '').toLowerCase();
        const productIdString = product.id.toString();
        const displayNameNormalized = product.display_name?.replace(/[\s\-\_]/g, '').toLowerCase() || '';
        const partNoNormalized = product.part_no?.replace(/[\s\-\_]/g, '').toLowerCase() || '';
        const companyNameNormalized = product.company?.replace(/[\s\-\_]/g, '').toLowerCase() || '';
        // Also search by product UID (ID)
        return productNameNormalized.includes(searchTermNormalized) ||
          productIdString.includes(searchTermNormalized) ||
          displayNameNormalized.includes(searchTermNormalized) ||
          partNoNormalized.includes(searchTermNormalized) ||
          companyNameNormalized.includes(searchTermNormalized);
      });
    }

    setSearchedProducts(filtered);
  }, [productSearchTerm, products, selectedPanelCarModels]);

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

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
        setCustomersLoaded(true);
      } else {
        setCustomers([]);
        setCustomersLoaded(true);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setCustomers([]); // Set empty array on error
      setCustomersLoaded(true); // Set to true even on error so edit logic can proceed
    }
  };

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

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products');
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };

  const fetchGstRates = async () => {
    try {
      const response = await fetch('/api/gst-rates');
      if (response.ok) {
        const data = await response.json();
        setGstRates(data.gstRates || []);
      }
    } catch (error) { console.error('Error fetching GST rates:', error); }
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
          transport_name: transportDetails?.trans_mode || '',
          city: invoiceData.city || '',
          email_id: invoiceData.email_id || '',
          discount: invoiceData.discount || '',
          state: invoiceData.state || '',
          gst_number: invoiceData.gst_number || '',
          tax: invoiceData.tax || '',
          notes: invoiceData.notes || '',
          payment_status: invoiceData.status || 1,
          payment_mode: invoiceData.payment_mode || 1,
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
          total_igst: invoiceData.total_igst ? invoiceData.total_igst.toString() : '0'
        };

        setFormData(formDataToSet);

        selectCustomerById(invoiceData?.customer_id.toString())

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
          total_igst: invoice.total_igst ? invoice.total_igst.toString() : '0'
        };

        console.log('📝 SETTING FORM DATA:', formDataToSet);
        setFormData(formDataToSet);

        // Set customer data - find customer in loaded customers list for proper state codes
        if (invoice.select_customer || invoice.customer_id) {  // API field is select_customer, not customer_id
          setSelectedCustomerId(invoice.select_customer.toString());
          setVendorIdToSave(invoice.select_customer); // For consistency with purchase create

          // Find customer in loaded customers list for proper state codes and data
          const existingCustomer = customers.find(c => c.id === invoice.select_customer.toString());
          if (existingCustomer) {
            // Use real customer data from the API
            setSelectedCustomer(existingCustomer);
            setCustomerStateForTax(existingCustomer.billing_state_code);

            // CRITICAL: Call handleCustomerSelect to populate customer form fields (STATE, etc.)
            handleCustomerSelect(existingCustomer.id);
          } else {
            // Fallback: create customer object from invoice data if not found in list
            console.warn('Customer not found in loaded list, creating from invoice data');
            const customer = {
              id: invoice.select_customer.toString(),
              billing_name: invoice.customer_name || '',
              shipping_name: '',
              billing_address: invoice.address || '',
              billing_address_2: '',
              billing_city: invoice.city || '',
              billing_state: 0, // We don't have state code from API
              billing_state_code: 0, // We don't have state code from API
              shipping_address: '',
              shipping_address_2: '',
              shipping_city: '',
              shipping_state: 0,
              shipping_state_code: 0, // Default - could be improved with API enhancement
              billing_gstin: invoice.gst_number || '',
              shipping_gstin: '',
              contact_no: invoice.contact_number || '',
              email: invoice.email_id || ''
            };
            setSelectedCustomer(customer);
            setCustomerStateForTax(customer.billing_state_code);
          }
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
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleCustomerSelect = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setSelectedCustomer(customer);
      setCustomerStateForTax(customer.billing_state_code); // Set customer's state for tax calculations

      // Clear tax calculations when customer changes
      setSelectedProducts([]);
      setFormData(prev => ({
        ...prev,
        total_cgst: '',
        total_sgst: '',
        total_igst: ''
      }));
    } else {
      setSelectedCustomer(null);

    }
  };

  const addProductToInvoice = (product: Product) => {
    // Don't allow adding products without customer selection
    if (!selectedCustomer) {
      setErrors({ products: 'Please select a customer before adding products' });
      return;
    }

    const { companyId, companyName } = getCompanyInfo(product);

    const qty = 1;
    const rate = product.latest_selling_price || product.rate || 0;
    const gstPercent = product.gst_rate_percentage || product.gst_rate || 0;
    const subtotal = qty * rate;

    // Calculate tax on the full amount (no discount by default)
    const totalTaxAmount = (subtotal * gstPercent) / 100;

    // Calculate GST breakdown based on customer's state
    const gstBreakdown = calculateGSTBreakdown(totalTaxAmount, selectedCustomer.billing_state_code);

    const newItem: InvoiceItem = {
      id: Date.now().toString(),
      product_id: product.id,
      product_name: product.product_name,
      car_model_ids: product.car_model_ids ? product.car_model_ids.split(',').map(id => id.trim()) : [],
      car_model_names: [],
      category_id: product.product_category_id || 0,
      category_name: product.category_name || '',
      subcategory_id: product.product_subcategory_id || null,
      subcategory_name: product.subcategory_name || '',
      company_id: companyId,
      company_name: companyName,
      part_number: product.part_no || '',
      qty: qty,
      rate: rate,
      gst_percentage: gstPercent,
      discount_percentage: 0,
      tax: totalTaxAmount,
      discount_amount: 0,
      total: subtotal + totalTaxAmount,
      // New pricing fields
      hsn: product.hsn || '',
      mrp: 0, // Default MRP
      discount: 0, // Default discount
      margin: 0, // Default margin
      // GST breakdown - calculated based on state
      cgst: gstBreakdown.cgst,
      sgst: gstBreakdown.sgst,
      igst: gstBreakdown.igst
    };

    setSelectedProducts(prev => [...prev, newItem]);
    setSearchTerm('');

    // Clear any product-related errors after successful addition
    if (errors.products) {
      setErrors(prev => ({ ...prev, products: '' }));
    }
  };

  const updateProductQuantity = (id: string, qty: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        const newSubtotal = qty * item.rate;
        const newDiscountAmount = (newSubtotal * item.discount_percentage) / 100;
        const taxableAmount = newSubtotal - newDiscountAmount;
        const newTax = (taxableAmount * item.gst_percentage) / 100;

        // Recalculate GST breakdown
        const gstBreakdown = calculateGSTBreakdown(newTax, selectedCustomer?.billing_state_code);

        const newTotal = taxableAmount + newTax;

        return {
          ...item,
          qty,
          discount_amount: newDiscountAmount,
          tax: newTax,
          total: newTotal,
          cgst: gstBreakdown.cgst,
          sgst: gstBreakdown.sgst,
          igst: gstBreakdown.igst
        };
      }
      return item;
    }));
  };

  const updateProductDiscount = (id: string, discountPercentage: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        const subtotal = item.qty * item.rate;
        const newDiscountAmount = (subtotal * discountPercentage) / 100;
        const taxableAmount = subtotal - newDiscountAmount;
        const newTax = (taxableAmount * item.gst_percentage) / 100;

        // Recalculate GST breakdown
        const gstBreakdown = calculateGSTBreakdown(newTax, selectedCustomer?.billing_state_code);

        const newTotal = taxableAmount + newTax;

        return {
          ...item,
          discount_percentage: discountPercentage,
          discount_amount: newDiscountAmount,
          tax: newTax,
          total: newTotal,
          cgst: gstBreakdown.cgst,
          sgst: gstBreakdown.sgst,
          igst: gstBreakdown.igst
        };
      }
      return item;
    }));
  };

  const updateProductRate = (id: string, newRate: number, newSubtotal: number, newDiscountAmount: number, newTax: number, newTotal: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          rate: newRate,
          discount_amount: newDiscountAmount,
          tax: newTax,
          total: newTotal
        };
      }
      return item;
    }));
  };

  const updateProductGst = (id: string, newGstPercent: number, newTax: number, newTotal: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          gst_percentage: newGstPercent,
          tax: newTax,
          total: newTotal
        };
      }
      return item;
    }));
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
      if (!editingRowData.qty || editingRowData.qty < 1) {
        setErrors({ inlineEdit: 'Quantity must be at least 1' });
        return;
      }
      if (!editingRowData.rate || editingRowData.rate <= 0) {
        setErrors({ inlineEdit: 'Rate must be greater than 0' });
        return;
      }
      if (editingRowData.gst_percentage < 0) {
        setErrors({ inlineEdit: 'GST percentage cannot be negative' });
        return;
      }

      // Recalculate tax and total based on discount if enabled
      const subtotal = editingRowData.qty * editingRowData.rate;
      const discountAmount = enableDiscount ? (subtotal * editingRowData.discount_percentage) / 100 : 0;
      const taxableAmount = subtotal - discountAmount;
      const taxAmount = (taxableAmount * editingRowData.gst_percentage) / 100;

      // Calculate GST breakdown based on customer's state
      const gstBreakdown = calculateGSTBreakdown(taxAmount, selectedCustomer?.billing_state_code);

      const updatedItem = {
        ...editingRowData,
        tax: taxAmount,
        total: taxableAmount + taxAmount,
        discount_amount: discountAmount,
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
    console.log('👤 CUSTOMER STATE CODE:', selectedCustomer?.billing_state_code);

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
    if (selectedProducts.length > 0 && selectedCustomer) {
      const { totalCgst, totalSgst, totalIgst } = calculateExpectedTax();
      const isIntraState = !selectedCustomer.billing_state_code || selectedCustomer.billing_state_code === BUSINESS_STATE_CODE;

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
    if (!selectedCustomerId || !selectedCustomer) {
      newErrors.customer_name = 'Please select a customer';
      console.log('❌ NO CUSTOMER SELECTED');
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

    if (!formData.payment_status || ![0, 1].includes(paymentStatusNum)) {
      newErrors.payment_status = `Payment status must be either Paid (1) or Unpaid (0), got: ${formData.payment_status}`;
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
      selectedCustomerId,
      selectedCustomer,
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
      alert('Form validation failed. Check console for details.');
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
        invoice_date: Math.floor(new Date(formData.date).getTime() / 1000), // Invoice.invoice_date (convert to UNIX timestamp)
        select_customer: parseInt(selectedCustomerId),              // Invoice.select_customer

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
          invoice_date: Math.floor(new Date(formData.date).getTime() / 1000), // Invoiceitems.invoice_date
          fy: new Date().getFullYear()                                // Invoiceitems.fy
        })),

        // ===== CUSTOMER ID =====
        customer_id: selectedCustomerId,

        // ===== SHIPPING DETAILS =====
        ...(selectedCustomer && {
          shippingDetails: {
            user_name: useShippingAddress ? selectedCustomer.shipping_name || selectedCustomer.billing_name : selectedCustomer.billing_name, // ship_to.user_name
            address: useShippingAddress ? selectedCustomer.shipping_address || selectedCustomer.billing_address : selectedCustomer.billing_address, // ship_to.address
            gstin: useShippingAddress ? selectedCustomer.shipping_gstin || selectedCustomer.billing_gstin : selectedCustomer.billing_gstin // ship_to.gstin
          }
        }),

        // ===== SHIPPING FLAG =====
        useShippingAddress: useShippingAddress,

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
        // Navigate first
        router.push('/sale').then(() => {
          // Show snackbar *after* navigation succeeds
          showSnackbar('success', `Invoice ${isEditMode ? 'updated' : 'created'} successfully!`);
        });
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
                  <select
                    value={selectedStaffId || formData.staff_id || ''}
                    onChange={(e) => {
                      const staffId = e.target.value;
                      setSelectedStaffId(staffId);
                      handleInputChange('staff_id', staffId ? staffId : '');
                    }}
                    className="select w-full"
                  >
                    <option value="">Select Staff</option>
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id.toString()}>
                        {staff.staff_name}
                      </option>
                    ))}
                  </select>
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
              <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                <div className="flex flex-row-reverse mt-1">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useShippingAddress}
                      onChange={(e) => setUseShippingAddress(e.target.checked)}
                      className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded"
                    />
                    <span className="text-sm text-slate-300">Use shipping address</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">CUSTOMER NAME *</label>
                    <button
                      type="button"
                      onClick={() => router.push('/customers/create?from=sale')}
                      className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors"
                    >
                      + Add New Customer
                    </button>
                  </div>
                  <select
                    key={`customer-dropdown-${customers.length}-${selectedCustomerId}`}
                    value={selectedCustomerId || ''}
                    onChange={(e) => {
                      const customerId = e.target.value;
                      console.log('🔄 CUSTOMER DROPDOWN MANUAL CHANGE:', customerId);
                      setSelectedCustomerId(customerId);
                      handleCustomerSelect(customerId);
                    }}
                    className="select w-full"
                  >
                    <option value="" disabled>Select Customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id} selected={customer.id === selectedCustomerId}>
                        {customer.billing_name}
                      </option>
                    ))}
                  </select>
                  {errors.customer_name && <p className="text-red-400 text-xs mt-1">{errors.customer_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER</label>
                  <input
                    type="text"
                    value={selectedCustomer?.contact_no || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={selectedCustomer?.email || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    {useShippingAddress ? 'SHIPPING GST NUMBER' : 'BILLING GST NUMBER'}
                  </label>
                  <input
                    type="text"
                    value={
                      useShippingAddress
                        ? selectedCustomer?.shipping_gstin || ''
                        : selectedCustomer?.billing_gstin || ''
                    }
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILLING ADDRESS</label>
                  <input
                    type="text"
                    value={selectedCustomer?.billing_address || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">ADDRESS LINE 2</label>
                  <input
                    type="text"
                    value={selectedCustomer?.billing_address_2 || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CITY</label>
                  <input
                    type="text"
                    value={selectedCustomer?.billing_city || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STATE</label>
                  <input
                    type="text"
                    value={selectedCustomer?.billing_state || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
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
                  <select
                    value={selectedMechanicId || formData.mechanic_id || ''}
                    onChange={(e) => {
                      const mechanicId = e.target.value;
                      setSelectedMechanicId(mechanicId);
                      setFormData(prev => ({ ...prev, mechanic_id: mechanicId ? parseInt(mechanicId) : null }));
                    }}
                    className="select w-full"
                  >
                    <option value="">Select Mechanic</option>
                    {mechanics.map((mechanic) => (
                      <option key={mechanic.id} value={mechanic.id}>{mechanic.mechanic_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">COMMISSION</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.commission}
                    onChange={(e) => handleInputChange('commission', e.target.value)}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Discount Section */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex items-center justify-between mb-3">
                {/* <h3 className="text-lg font-medium text-slate-200">Discount</h3> */}
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableDiscount}
                    onChange={(e) => setEnableDiscount(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-blue-600 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-sm text-slate-300">Enable Discount</span>
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
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-32">
                        RATE
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-32">
                        GST (%)
                      </th>
                      {enableDiscount && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                          DISCOUNT (%)
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
                              setErrors({ customer_name: 'Please select a customer first' });
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
                          title={!selectedCustomerId ? 'Please select a customer first' : ''}
                        >
                          {selectedRowProduct ? (
                            productRowFilters.carModels.length > 0
                              ? generateDynamicProductName(selectedRowProduct, productRowFilters.carModels)
                              : (selectedRowProduct.product_name || 'Select Product')
                          ) : (
                            <span className="text-slate-400">Select Product</span>
                          )}
                        </button>
                        {!selectedCustomerId && (
                          <p className="text-xs text-amber-400 mt-1">Select a customer first</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={productRowFilters.category || ''}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: parseInt(e.target.value) || 0,
                              categoryName: e.target.options[e.target.selectedIndex]?.text || ''
                            }));
                          }}
                        >
                          <option value="">Select Category</option>
                          {filterOptions.categories.map((cat) => (
                            <option key={cat.id} value={cat.id.toString()}>{cat.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
                          value={productRowFilters.subcategory || ''}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: parseInt(e.target.value) || 0,
                              subcategoryName: e.target.options[e.target.selectedIndex]?.text || ''
                            }));
                          }}
                          disabled={!productRowFilters.category}
                        >
                          <option value="">
                            {!productRowFilters.category
                              ? "Please select a category first"
                              : "Select Sub Category"
                            }
                          </option>
                          {filteredSubcategories.map((sub) => (
                            <option key={sub.id} value={sub.id}>{sub.name}</option>
                          ))}
                        </select>
                      </td>
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
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={productRowFilters.company || ''}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: parseInt(e.target.value) || 0,
                              companyName: e.target.options[e.target.selectedIndex]?.text || ''
                            }));
                          }}
                        >
                          <option value="">Select Company</option>
                          {filterOptions.companies.map((comp) => (
                            <option key={comp.id} value={comp.id.toString()}>{comp.name}</option>
                          ))}
                        </select>
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
                            setTemplateRow(prev => ({
                              ...prev,
                              qty: e.target.value
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-32">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0.00"
                          value={templateRow.rate}
                          onChange={(e) => {
                            setTemplateRow(prev => ({
                              ...prev,
                              rate: e.target.value
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-32">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0.00"
                          value={templateRow.gst}
                          onChange={(e) => {
                            setTemplateRow(prev => ({
                              ...prev,
                              gst: e.target.value
                            }));
                          }}
                        />
                      </td>
                      {enableDiscount && (
                        <td className="px-4 py-3 text-center w-20">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                            placeholder="0.00"
                            value={templateRow.discount}
                            onChange={(e) => {
                              setTemplateRow(prev => ({
                                ...prev,
                                discount: e.target.value
                              }));
                            }}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-center w-20">
                        <div className="px-2 py-2 bg-slate-800 rounded text-xs text-green-400 text-center font-medium">
                          ₹{(() => {
                            const qty = parseFloat(templateRow.qty) || 0;
                            const rate = parseFloat(templateRow.rate) || 0;
                            const gstPercent = parseFloat(templateRow.gst) || 0;
                            const discountPercent = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;

                            const subtotal = qty * rate;
                            const discountAmount = (subtotal * discountPercent) / 100;
                            const taxableAmount = subtotal - discountAmount;
                            const tax = (taxableAmount * gstPercent) / 100;

                            // Calculate GST breakdown
                            const gstBreakdown = calculateGSTBreakdown(tax, selectedCustomer?.billing_state_code);
                            const total = taxableAmount + tax;

                            return total.toFixed(2);
                          })()}
                        </div>
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
                              const gstPercent = parseFloat(templateRow.gst) || 0;
                              const discountPercent = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;

                              // Calculate amounts
                              const subtotal = qty * rate;
                              const discountAmount = (subtotal * discountPercent) / 100;
                              const taxableAmount = subtotal - discountAmount;
                              const tax = (taxableAmount * gstPercent) / 100; // Tax on discounted price

                              // Calculate tax breakdown based on customer's state
                              const gstBreakdown = calculateGSTBreakdown(tax, selectedCustomer?.billing_state_code);
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
                                discount_percentage: discountPercent,
                                tax: tax,
                                discount_amount: discountAmount,
                                total: taxableAmount + tax,
                                // New pricing fields
                                hsn: selectedProduct.hsn || '',
                                mrp: 0, // Default MRP
                                discount: discountPercent, // Store discount percentage
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
                                discount: '0'
                              });
                            }
                          }
                        }}
                        disabled={!selectedRowProduct}
                        className={`px-3 py-1 mr-2 text-xs rounded font-medium transition-colors ${selectedRowProduct
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
                                discount: '0'
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
                          {product.product_name}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.category_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.subcategory_name || '-'}
                        </td>
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
                                        // Parse product name format: category-subcategory-carModel-company
                                        const productName = updatedProductName;
                                        const parts = productName.split('-');
                                        if (parts.length >= 4) {
                                          // Replace the car model part (index 2) with selected model name
                                          parts[2] = newCarModel;
                                          updatedProductName = parts.join('-');
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
                                      const gstBreakdown = calculateGSTBreakdown(taxAmount, selectedCustomer?.billing_state_code);
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
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.company_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.part_number || '-'}
                        </td>
                        {editingRowId === product.id ? (
                          <>
                            {/* Editable fields when inline editing */}
                            <td className="px-3 py-2 text-center w-24">
                              <input
                                type="number"
                                min="1"
                                value={editingRowData?.qty || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, qty: parseInt(e.target.value) || 1 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-3 py-2 text-center w-32">
                              <input
                                type="number"
                                step="0.01"
                                value={editingRowData?.rate || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, rate: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-3 py-2 text-center w-32">
                              <input
                                type="number"
                                step="0.01"
                                value={editingRowData?.gst_percentage || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, gst_percentage: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center w-20">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  value={editingRowData?.discount_percentage || ''}
                                  onChange={(e) => setEditingRowData(prev => prev ? { ...prev, discount_percentage: parseFloat(e.target.value) || 0 } : null)}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
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
                              ₹{product.rate.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center text-xs text-slate-200">
                              ₹{product.tax.toFixed(2)}
                            </td>
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center text-xs text-slate-200">
                                ₹{product.discount_amount.toFixed(2)}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center text-sm font-medium text-slate-200">
                              ₹{product.total.toFixed(2)}
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
                      <tr>
                        <td colSpan={enableDiscount ? 11 : 10} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                          SUBTOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-slate-200">
                          ₹{subtotal.toFixed(2)}
                        </td>
                      </tr>
                      {totalDiscount > 0 && (
                        <tr>
                          <td colSpan={enableDiscount ? 11 : 10} className="px-4 py-3"></td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                            TOTAL DISCOUNT
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                            -₹{totalDiscount.toFixed(2)}
                          </td>
                        </tr>
                      )}
                      {/* <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 11 : 10} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-white uppercase tracking-wider">
                          GRAND TOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                          ₹{grandTotal.toFixed(2)}
                        </td>
                      </tr> */}
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 11 : 10} className="px-4 py-3"></td>
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
                <div>
                  {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Tax Breakdown</h4> */}
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.total_cgst}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL SGST</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.total_sgst}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL IGST</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.total_igst}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="grid gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">DISCOUNT</label>
                        <input
                          type="number"
                          step="0.01"
                          value={totalDiscount.toFixed(2)}
                          readOnly
                          disabled
                          className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Calculations */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">SUBTOTAL</label>
                    <input
                      type="number"
                      step="0.01"
                      value={subtotal.toFixed(2)}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL TAX</label>
                    <input
                      type="number"
                      step="0.01"
                      value={totalTax.toFixed(2)}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Packing & Forwarding */}
                <div>
                  {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Packing & Forwarding</h4> */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">QTY</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.packing_forwarding_qty}
                        onChange={(e) => handleInputChange('packing_forwarding_qty', e.target.value)}
                        className="input w-full"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">RATE</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.packing_forwarding_rate}
                        onChange={(e) => handleInputChange('packing_forwarding_rate', e.target.value)}
                        className="input w-full"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.packing_forwarding_total}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                {/* Additional Calculations */}


                {/* Payment Details */}
                <div className="border-t border-slate-600 pt-4">
                  {/* <h4 className="text-sm font-medium text-slate-300 mb-4">Payment Details</h4> */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS *</label>
                      <select
                        value={formData.payment_status}
                        onChange={(e) => handleInputChange('payment_status', Number(e.target.value))}
                        className="select w-full"
                        required
                      >
                        <option value={0}>Unpaid</option>
                        <option value={1}>Paid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT MODE *</label>
                      <select
                        value={formData.payment_mode}
                        onChange={(e) => handleInputChange('payment_mode', Number(e.target.value))}
                        className="select w-full"
                        required
                      >
                        <option value={0}>Cash</option>
                        <option value={1}>Bank</option>
                      </select>
                    </div>
                  </div>
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
      </form>

      {/* Product Selection Side Panel */}
      <ProductSelectionPanel
        isOpen={isProductPanelOpen}
        onClose={() => setIsProductPanelOpen(false)}
        title="Select Product"
        showCarModelFilter={true}
        filterOptions={memoizedFilterOptions}
        selectedCarModels={selectedPanelCarModels}
        onCarModelSelection={setSelectedPanelCarModels}
        searchedProducts={searchedProducts}
        productSearchTerm={productSearchTerm}
        onSearchTermChange={setProductSearchTerm}
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
            discount: '0'
          });
          setIsProductPanelOpen(false);
          setProductSearchTerm('');
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
    </div>
  );
}
