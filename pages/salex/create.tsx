import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Calculator, Loader, Trash2, Edit2, Plus, Filter } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import SessionStorageService from '../../lib/sessionStorage';

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
  gst_percentage: number; // Still kept for display but not used in calculations
  discount_percentage: number;
  tax: number; // Always 0 for salex
  discount_amount: number;
  total: number;
  // New pricing fields from product create
  hsn: string;
  mrp: number;
  discount: number;
  margin: number;
  // GST breakdown - always 0 for salex
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
  tax_rate: string;
  basic_value: string;
  // Removed GST fields for salex
  // total_cgst: string;
  // total_sgst: string;
  // total_igst: string;
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function InvoiceCCreate() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staffList, setStaffList] = useState<StaffDetails[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<InvoiceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [vendorIdToSave, setVendorIdToSave] = useState<number | null>(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customersLoaded, setCustomersLoaded] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);

  // Shipping address selection state
  const [useShippingAddress, setUseShippingAddress] = useState(false);

  // Raw invoice data for re-conversion when filters load
  const [rawInvoiceItems, setRawInvoiceItems] = useState<any[]>([]);

  // State for product selection row filters
  const [productRowFilters, setProductRowFilters] = useState({
    category: '',
    subcategory: '',
    carModels: [] as string[],
    company: '',
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

// Function to generate dynamic product name based on car model selection
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[]): string => {
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name || 'CATEGORY';
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name || 'SUBCATEGORY';
    const companyName = filterOptions.companies.find(comp => comp.id.toString() === (product.company_id || product.company)?.toString())?.name || product.company || 'COMPANY';

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

  // Function to handle product selection and update filters
  const handleProductSelection = (product: Product) => {
    setSelectedRowProduct(product);

    // Filter car models for this product
    const compatibleModels = getFilteredCarModelsForProduct(product);
    setFilteredCarModels(compatibleModels);

    // Initially set car models to unselected
    setProductRowFilters(prev => ({
      ...prev,
      category: product.product_category_id ? product.product_category_id.toString() : '',
      subcategory: product.product_subcategory_id ? product.product_subcategory_id.toString() : '',
      carModels: [], // Initially unselected
      company: product.company_id ? product.company_id.toString() : '',
      partNo: product.part_no || ''
    }));

    console.log('🔄 PRODUCT SELECTED:', {
      product: product.product_name,
      compatibleCarModels: compatibleModels.map(m => m.name),
      initialFilters: {
        category: product.product_category_id,
        subcategory: product.product_subcategory_id,
        carModels: [], // unselected
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
    gst: '0', // Not used but kept for template consistency
    discount: '0'
  });

  // State for discount toggle
  const [enableDiscount, setEnableDiscount] = useState(false);

  // State for selected customer details (fetched on-demand, not stored in formData)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // State for inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<InvoiceItem | null>(null);

  // New state for GST rates - not used for salex but kept for consistency
  const [gstRates, setGstRates] = useState<any[]>([]);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

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
    payment_status: 1, // Default to Paid
    payment_mode: 1, // Default to Cash
    total_discount: '',
    subtotal: '',
    total_tax: '', // Always 0 for salex
    grand_total: '',
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    tax_rate: '',
    basic_value: '',
    // Removed GST fields for salex
    // total_cgst: '',
    // total_sgst: '',
    // total_igst: ''
  });

  // Check for edit mode immediately on mount
  useEffect(() => {
    const { edit } = router.query;
    if (edit && typeof edit === 'string') {
      setIsEditMode(true);
      setEditInvoiceId(parseInt(edit));
    }
  }, [router.query]);

  // Fetch data on mount
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

  // Fetch invoice data when edit mode is detected and customers are loaded
  useEffect(() => {
    if (customersLoaded && isEditMode && editInvoiceId) {
      console.log('🔍 EDIT MODE DETECTED, FETCHING INVOICE:', editInvoiceId);

      // First try to get data from sessionStorage
      const cachedData = SessionStorageService.get('salex', editInvoiceId.toString());
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
          vehicle_number: transportDetails.vehicle_no || '',
          commission: invoiceData.commission ? invoiceData.commission.toString() : '',
          address: invoiceData.address || '',
          transport_name: transportDetails.trans_mode || '',
          city: invoiceData.city || '',
          email_id: invoiceData.email_id || '',
          discount: invoiceData.discount ? invoiceData.discount.toString() : '0',
          state: invoiceData.state || '',
          gst_number: invoiceData.gst_number || '',
          tax: invoiceData.tax || '',
          notes: invoiceData.notes || '',
          payment_status: invoiceData.status || 1,
          payment_mode: invoiceData.mode || 1,
          total_discount: invoiceData.total_discount ? invoiceData.total_discount.toString() : '',
          subtotal: invoiceData.subtotal ? invoiceData.subtotal.toString() : '',
          total_tax: '0', // Always 0 for salex invoices
          grand_total: invoiceData.total ? invoiceData.total.toString() : '',
          descriptions: invoiceData.descriptions || '',
          packing_forwarding_qty: invoiceData.packing_forwarding_qty ? invoiceData.packing_forwarding_qty.toString() : '0',
          packing_forwarding_rate: invoiceData.packing_forwarding_rate ? invoiceData.packing_forwarding_rate.toString() : '0',
          packing_forwarding_total: invoiceData.packing_forwarding_total ? invoiceData.packing_forwarding_total.toString() : '0',
          tax_rate: '0', // Always 0 for salex
          basic_value: invoiceData.basic_value || '0'
        });

        // Set customer data from billingDetails
        if (billingDetails?.customer) {
          const customer = billingDetails.customer;
          setSelectedCustomerId(customer.id.toString());
          setSelectedCustomer(customer);
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
        SessionStorageService.remove('salex', editInvoiceId.toString());
        return;
      }

      // Fallback to API call if no cached data
      fetchInvoiceForEdit(editInvoiceId);
    }
  }, [customersLoaded, isEditMode, editInvoiceId]);

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

  // Fetch subcategories for table filters when category changes
  const fetchSubcategoriesForTable = async (categoryId: string) => {
    if (!categoryId) {
      setFilteredSubcategories([]);
      return;
    }

    try {
      const response = await fetch(`/api/products/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setFilteredSubcategories(data.subcategories || []);
      } else {
        setFilteredSubcategories([]);
      }
    } catch (error) {
      console.error('Error fetching subcategories for table:', error);
      setFilteredSubcategories([]);
    }
  };

  useEffect(() => {
    fetchSubcategoriesForTable(productRowFilters.category);
  }, [productRowFilters.category]);

  // Handle product search with normalized text and filter by car models
  useEffect(() => {
    let filtered = products.filter(product => {
      // Car model filter
      if (selectedPanelCarModels.length > 0) {
        if (!product.car_model_ids || !product.car_model_ids.trim()) {
          return false; // If no car models and filter is active, exclude product
        }
        const productModelIds = product.car_model_ids.split(',').map(id => id.trim());
        const hasMatchingModel = selectedPanelCarModels.some(selectedId =>
          productModelIds.includes(selectedId)
        );
        if (!hasMatchingModel) return false;
      }

      // Text search filter
      if (productSearchTerm.trim()) {
        const searchTermNormalized = productSearchTerm.replace(/[\s\-\_]/g, '').toLowerCase();
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
      }

      return true;
    });

    setSearchedProducts(filtered);
  }, [productSearchTerm, products, selectedPanelCarModels, filterOptions.models]);

  // Convert raw invoice items when filterOptions are loaded
  useEffect(() => {
    if (rawInvoiceItems.length > 0 && filterOptions.categories.length > 0 && filterOptions.models.length > 0) {
      console.log('🔄 Converting raw invoice items to formatted items now that filters are available');
      const convertedItems: InvoiceItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: InvoiceItem = {
          id: (index + 1).toString(),
          product_id: item.product_id || item.name_of_product || 1,
          product_name: item.name_of_product || 'Unknown Product',
          car_model_ids: item.model_id ? [item.model_id.toString()] : [],
          car_model_names: item.model_id ? [filterOptions.models.find(model => model.id.toString() === item.model_id?.toString())?.name || ''] : [],
          category_id: item.category_id || 0,
          category_name: filterOptions.categories.find(cat => cat.id.toString() === item.category_id?.toString())?.name || '',
          subcategory_id: item.subcategory_id || 0,
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
          gst_percentage: 0, // Always 0 for salex
          discount_percentage: item.discountrate || 0,
          tax: 0, // Always 0 for salex
          discount_amount: item.discount || 0,
          total: item.subtotal || 0,
          hsn: item.hsn || '',
          mrp: 0,
          discount: item.discountrate || 0,
          margin: 0,
          cgst: 0, // Always 0 for salex
          sgst: 0, // Always 0 for salex
          igst: 0  // Always 0 for salex
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
      } else {
        setProducts([]); // Set empty array on error
      }
    } catch (error) {
      console.error('Error fetching products:', error);
      setProducts([]); // Set empty array on error
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
      const response = await fetch('/api/salex?limit=1&sort=-invoice_no');
      if (response.ok) {
        const data = await response.json();
        if (data.salex && data.salex.length > 0) {
          const lastInvoiceNum = Math.max(...data.salex.map((s: any) => s.invoice_no || 0));
          const nextInvoiceNum = lastInvoiceNum + 1;
          setFormData(prev => ({ ...prev, invoice_number: nextInvoiceNum.toString() }));
        } else {
          setFormData(prev => ({ ...prev, invoice_number: '1' }));
        }
      }
    } catch (error) {
      console.error('Error fetching last invoice number:', error);
      setFormData(prev => ({ ...prev, invoice_number: '1' }));
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  const fetchInvoiceForEdit = async (invoiceId: number) => {
    try {
      console.log('🔍 FETCHING INVOICE FOR EDIT:', invoiceId);
      const response = await fetch(`/api/salex/${invoiceId}`);
      if (response.ok) {
        const data = await response.json();
        const invoice = data.invoice || data;
        const transportDetails = data.transportDetails
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

        // Prefill form data with all available fields for salex
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
          discount: invoice.discount ? invoice.discount.toString() : '0',
          state: invoice.state || '',
          gst_number: invoice.gst_number || '',
          tax: invoice.tax || '',
          notes: invoice.notes || '',
          payment_status: invoice.status || 1,
          payment_mode: invoice.payment_mode || 1,
          total_discount: invoice.total_discount ? invoice.total_discount.toString() : '',
          subtotal: invoice.subtotal ? invoice.subtotal.toString() : '',
          total_tax: '0', // Always 0 for salex invoices
          grand_total: invoice.total ? invoice.total.toString() : '',
          descriptions: invoice.descriptions || '',
          packing_forwarding_qty: invoice.packing_forwarding_qty ? invoice.packing_forwarding_qty.toString() : '0',
          packing_forwarding_rate: invoice.packing_forwarding_rate ? invoice.packing_forwarding_rate.toString() : '0',
          packing_forwarding_total: invoice.packing_forwarding_total ? invoice.packing_forwarding_total.toString() : '0',
          tax_rate: '0', // Always 0 for salex
          basic_value: invoice.basic_value || '0'
        };

        console.log('📝 SETTING FORM DATA:', formDataToSet);
        setFormData(formDataToSet);

        // Set customer data - find customer in loaded customers list
        if (invoice.select_customer) {
          setSelectedCustomerId(invoice.select_customer.toString());
          setVendorIdToSave(parseInt(invoice.select_customer.toString()));

          // Find customer in loaded customers list
          const existingCustomer = customers.find(c => c.id === invoice.select_customer.toString());
          if (existingCustomer) {
            setSelectedCustomer(existingCustomer);
            handleCustomerSelect(existingCustomer.id);
          } else {
            // This should not happen since we wait for customers to load, but if it does, create from invoice data
            console.warn('Customer not found in loaded list after customers loaded, creating from invoice data');
            const customer = {
              id: invoice.select_customer.toString(),
              billing_name: invoice.customer_name || '',
              shipping_name: '',
              billing_address: invoice.address || '',
              billing_address_2: '',
              billing_city: invoice.city || '',
              billing_state: 0,
              billing_state_code: 0,
              shipping_address: '',
              shipping_address_2: '',
              shipping_city: '',
              shipping_state: 0,
              shipping_state_code: 0,
              billing_gstin: invoice.gst_number || '',
              shipping_gstin: '',
              contact_no: invoice.contact_number || '',
              email: invoice.email_id || ''
            };
            setSelectedCustomer(customer);
          }
        }

        // Set other related entity IDs
        if (invoice.staff_id) {
          setSelectedStaffId(invoice.staff_id.toString());
        }
        if (invoice.mechanic_id) {
          setSelectedMechanicId(invoice.mechanic_id.toString());
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

  const handleInputChange = (field: keyof InvoiceFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleCustomerSelect = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setSelectedCustomer(customer);
      // No GST calculations needed for salex - all tax values remain 0
    } else {
      setSelectedCustomer(null);
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
      if (!editingRowData.qty || editingRowData.qty < 1) {
        setErrors({ inlineEdit: 'Quantity must be at least 1' });
        return;
      }
      if (!editingRowData.rate || editingRowData.rate <= 0) {
        setErrors({ inlineEdit: 'Rate must be greater than 0' });
        return;
      }

      // Recalculate tax and total for salex (tax is always 0)
      const subtotal = editingRowData.qty * editingRowData.rate;
      const discountAmount = enableDiscount ? (subtotal * editingRowData.discount_percentage) / 100 : 0;
      const finalTotal = subtotal - discountAmount; // No tax added for salex

      const updatedItem = {
        ...editingRowData,
        discount_amount: discountAmount,
        total: finalTotal,
        // Tax fields always 0 for salex
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0
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

  const addProductToInvoice = (product: Product) => {
    const qty = 1;
    const rate = product.selling_price || product.rate || 0;
    const subtotal = qty * rate;

    const newItem: InvoiceItem = {
      id: Date.now().toString(),
      product_id: product.id,
      product_name: product.product_name,
      car_model_ids: product.car_model_ids ? product.car_model_ids.split(',').map(id => id.trim()) : [],
      car_model_names: [],
      category_id: product.product_category_id || 0,
      category_name: product.category_name || '',
      subcategory_id: product.product_subcategory_id || 0,
      subcategory_name: product.subcategory_name || '',
      company_id: product.company_id || (product.company ? parseInt(product.company) : 0),
      company_name: filterOptions.companies.find(c => c.id.toString() === product.company)?.name || '',
      part_number: product.part_no || '',
      qty: qty,
      rate: rate,
      gst_percentage: 0, // Always 0 for salex - no tax
      discount_percentage: 0,
      tax: 0, // Always 0 for salex - no tax
      discount_amount: 0,
      total: subtotal, // For salex: total = rate * qty (no tax)
      // New pricing fields
      hsn: product.hsn || '',
      mrp: 0,
      discount: 0,
      margin: 0,
      // GST breakdown - always 0 for salex
      cgst: 0,
      sgst: 0,
      igst: 0
    };

    setSelectedProducts(prev => [...prev, newItem]);
    setSearchTerm('');
  };

  const updateProductQuantity = (id: string, qty: number) => {
    setSelectedProducts(prev => prev.map(item => {
      if (item.id === id) {
        const newSubtotal = qty * item.rate;
        const newDiscountAmount = (newSubtotal * item.discount_percentage) / 100;
        const taxableAmount = newSubtotal - newDiscountAmount;

        return {
          ...item,
          qty,
          discount_amount: newDiscountAmount,
          tax: 0, // Always 0 for salex
          total: taxableAmount, // For salex: total = taxable amount (no tax added)
          cgst: 0,
          sgst: 0,
          igst: 0
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

        return {
          ...item,
          discount_percentage: discountPercentage,
          discount_amount: newDiscountAmount,
          tax: 0, // Always 0 for salex
          total: taxableAmount, // For salex: total = taxable amount (no tax added)
          cgst: 0,
          sgst: 0,
          igst: 0
        };
      }
      return item;
    }));
  };

  const removeProduct = (id: string) => {
    setSelectedProducts(prev => prev.filter(item => item.id !== id));
  };

  // Calculations (all tax-related values are always 0 for salex)
  const subtotal = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + (item.qty * item.rate - item.discount_amount), 0);
  }, [selectedProducts]);

  const totalDiscount = useMemo(() => {
    return selectedProducts.reduce((sum, item) => sum + item.discount_amount, 0);
  }, [selectedProducts]);

  const totalTax = useMemo(() => {
    return 0; // Always 0 for salex - no tax calculations
  }, [selectedProducts]);

  const grandTotal = useMemo(() => {
    const productTotal = selectedProducts.reduce((sum, item) => sum + item.total, 0);
    const packingTotal = parseFloat(formData.packing_forwarding_total) || 0;
    return productTotal + packingTotal;
  }, [selectedProducts, formData.packing_forwarding_total]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.invoice_number.trim()) {
      newErrors.invoice_number = 'Invoice number is required';
    }
    if (!selectedCustomerId || !selectedCustomer) {
      newErrors.customer_name = 'Please select a customer';
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
    setLoading(true);

    try {
      // Payload for salex invoice creation (no tax fields)
      const submitData = {
        // Main invoice fields
        invoice_no: formData.invoice_number,
        invoice_date: formData.date,
        select_customer: parseInt(selectedCustomerId),
        staff_id: formData.staff_id,
        staff_details: staffList.find(e => e.id === formData.staff_id.toString()).staff_name,

        // Invoice items
        invoiceItems: selectedProducts.map(item => ({
          product_id: item.product_id, // Product ID for database relationship
          name_of_product: item.product_name, // Product name for display
          qty: item.qty,
          rate: item.rate,
          subtotal: item.total, // For salex, subtotal = total (no tax added)
          hsn: item.hsn || '',
          part: item.part_number,
          category_id: item.category_id,
          discount: item.discount_amount,
          discountrate: item.discount_percentage,
          model_id: item.car_model_ids[0] ? parseInt(item.car_model_ids[0]) : null,
          company_id: item.company_id,
          subcategory_id:item.subcategory_id,
        })),

        // Customer ID instead of billing details object
        customer_id: selectedCustomerId,

        // Shipping details
        shippingDetails: selectedCustomer ? {
          user_name: selectedCustomer.shipping_name || selectedCustomer.billing_name,
          address: selectedCustomer.shipping_address || selectedCustomer.billing_address,
          state: selectedCustomer.shipping_state ? parseInt(selectedCustomer.shipping_state.toString()) : (selectedCustomer.billing_state ? parseInt(selectedCustomer.billing_state.toString()) : null),
          state_code: selectedCustomer.shipping_state_code ? parseInt(selectedCustomer.shipping_state_code.toString()) : (selectedCustomer.billing_state_code ? parseInt(selectedCustomer.billing_state_code.toString()) : null),
          gstin: selectedCustomer.shipping_gstin || selectedCustomer.billing_gstin
        } : null,

        // Transport details (optional)
        transportDetails: {
          trans_mode: formData.transport_name || null,
          vehicle_no: formData.vehicle_number || null,
          supply_date: formData.date,
          place_of_supply: null
        },

        // Calculated totals (no tax calculations)
        items_total: subtotal,
        freight: 0, // No freight calculation
        total_taxable_value: subtotal,
        total: grandTotal,

        // Additional fields
        notes: formData.notes || '',
        payment_status: formData.payment_status,
        payment_mode: formData.payment_mode,
        discount: formData.total_discount
        // Skip tax-related fields entirely for salex
        // total_cgst, total_sgst, total_igst are not included
      };

      console.log('📤 UI SENDING SALEX PAYLOAD:', submitData);

      console.log('📤 UI SENDING SALEX PAYLOAD:', submitData);

      let additionalFields = {};

      // Get selected staff and mechanic names/details
      if (selectedStaffId && staffList.length > 0) {
        const selectedStaff = staffList.find(s => s.id === selectedStaffId);
        if (selectedStaff) {
          additionalFields = {
            ...additionalFields,
            staff_details: selectedStaff.staff_name,
            staff_id: parseInt(selectedStaffId)
          };
        }
      }

      if (selectedMechanicId && mechanics.length > 0) {
        const selectedMechanic = mechanics.find(m => m.id === selectedMechanicId);
        if (selectedMechanic) {
          additionalFields = {
            ...additionalFields,
            mechanic_id: parseInt(selectedMechanicId)
          };
        }
      }

      // Add form data fields that might not have been included
      if (formData.descriptions && formData.descriptions.trim()) {
        additionalFields = { ...additionalFields, descriptions: formData.descriptions };
      }

      if (formData.commission && formData.commission !== '0' && formData.commission !== '') {
        additionalFields = { ...additionalFields, commission: parseFloat(formData.commission) };
      }

      if (formData.bill_reference && formData.bill_reference.trim()) {
        additionalFields = { ...additionalFields, bill_reference: formData.bill_reference };
      }

      // Add packing & forwarding fields if provided
      if (formData.packing_forwarding_qty && formData.packing_forwarding_qty !== '0' && formData.packing_forwarding_qty !== '') {
        additionalFields = {
          ...additionalFields,
          packing_forwarding_qty: parseFloat(formData.packing_forwarding_qty)
        };
      }

      if (formData.packing_forwarding_rate && formData.packing_forwarding_rate !== '0' && formData.packing_forwarding_rate !== '') {
        additionalFields = {
          ...additionalFields,
          packing_forwarding_rate: parseFloat(formData.packing_forwarding_rate)
        };
      }

      if (formData.packing_forwarding_total && formData.packing_forwarding_total !== '0' && formData.packing_forwarding_total !== '') {
        additionalFields = {
          ...additionalFields,
          packing_forwarding_total: parseFloat(formData.packing_forwarding_total)
        };
      }

      const finalSubmitData = { ...submitData, ...additionalFields };

      console.log('📤 FINAL UI SENDING COMPLETE SALEX PAYLOAD:', finalSubmitData);

      const response = await fetch(isEditMode ? `/api/salex/${editInvoiceId}` : '/api/salex', {
        method: isEditMode ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isEditMode ? finalSubmitData : finalSubmitData),
      });

      if (response.ok) {
        setShowConfirmationModal(false);
        router.push('/salex');
      } else {
        const error = await response.json();
        console.error('❌ API Error:', error);
        setErrors({ submit: error.message || 'Failed to create salex invoice' });
      }
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
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-6">

            {/* Invoice Information */}
            <div className="mb-3">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice C Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">INVOICE C NUMBER *</label>
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
                    value={formData.staff_id || ''}
                    onChange={(e) => handleInputChange('staff_id', e.target.value || null)}
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

              <h3 className="text-lg font-medium text-slate-200 mb-3">
                Customer Information
                <div className="float-right mt-1">
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
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-300">CUSTOMER NAME *</label>
                    <button
                      type="button"
                      onClick={() => router.push('/customers/create?from=salex')}
                      className="text-blue-400 hover:text-blue-300 text-sm underline transition-colors"
                    >
                      + Add New Customer
                    </button>
                  </div>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      const customerId = e.target.value;
                      setSelectedCustomerId(customerId);
                      handleCustomerSelect(customerId);
                    }}
                    className="select w-full"
                  >
                    <option value="" disabled>Select Customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.billing_name}</option>
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={selectedCustomer?.billing_gstin || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from customer"
                    readOnly
                    disabled
                  />
                </div>

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
              <h3 className="text-lg font-medium text-slate-200 mb-3">Service Details</h3>
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
                    value={selectedMechanicId}
                    onChange={(e) => setSelectedMechanicId(e.target.value)}
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
                <h3 className="text-lg font-medium text-slate-200">Discount</h3>
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
              <h3 className="text-lg font-medium text-slate-200 mb-3">Product Selection</h3>

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
                          value={productRowFilters.category}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: e.target.value
                            }));
                          }}
                        >
                          <option value="">Select Category</option>
                          {filterOptions.categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
                          value={productRowFilters.subcategory}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: e.target.value
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
                            <option key={sub.id} value={sub.id}>{sub.subcategory_name}</option>
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
                          value={productRowFilters.company}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: e.target.value
                            }));
                          }}
                        >
                          <option value="">Select Company</option>
                          {filterOptions.companies.map((comp) => (
                            <option key={comp.id} value={comp.id}>{comp.name}</option>
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
                            const discountPercent = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;
                            const subtotal = qty * rate;
                            const discountAmount = (subtotal * discountPercent) / 100;
                            const total = subtotal - discountAmount;
                            return total.toFixed(2);
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center w-20">
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
                                const discountPercent = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;

                                // Calculate amounts - NO TAX for salex
                                const subtotal = qty * rate;
                                const discountAmount = (subtotal * discountPercent) / 100;
                                const finalTotal = subtotal - discountAmount; // No tax added

                                const newItem: InvoiceItem = {
                                  id: Date.now().toString(),
                                  product_id: selectedProduct.id,
                                  product_name: selectedProduct.product_name,
                                  car_model_ids: selectedProduct.car_model_ids ? selectedProduct.car_model_ids.split(',').map(id => id.trim()) : [],
                                  car_model_names: carModelNames ? carModelNames.split(', ') : [],
                                  category_id: selectedProduct.product_category_id || 0,
                                  category_name: filterOptions.categories.find(c => c.id.toString() === productRowFilters.category)?.name || '',
                                  subcategory_id: selectedProduct.product_subcategory_id || 0,
          subcategory_name: productRowFilters.subcategory ? filterOptions.subcategories.find(s => s.id.toString() === productRowFilters.subcategory)?.name || '' : '',
                                  company_id: selectedProduct.company ? parseInt(selectedProduct.company) : 0,
                                  company_name: filterOptions.companies.find(c => c.id.toString() === productRowFilters.company)?.name || '',
                                  part_number: productRowFilters.partNo,
                                  qty: qty,
                                  rate: rate,
                                  gst_percentage: 0, // Always 0 for salex
                                  discount_percentage: discountPercent,
                                  tax: 0, // Always 0 for salex
                                  discount_amount: discountAmount,
                                  total: finalTotal, // For salex: total = (rate * qty) - discount
                                  // New pricing fields
                                  hsn: selectedProduct.hsn || '',
                                  mrp: 0,
                                  discount: discountPercent,
                                  margin: 0,
                                  // GST breakdown - always 0 for salex
                                  cgst: 0,
                                  sgst: 0,
                                  igst: 0
                                };

                                setSelectedProducts(prev => [...prev, newItem]);

                                // Reset form - keep GST as 0
                                setSelectedRowProduct(null);
                                setProductRowFilters({
                                  category: '',
                                  subcategory: '',
                                  carModels: [],
                                  company: '',
                                  partNo: ''
                                });
                                setTemplateRow({
                                  qty: '1',
                                  rate: '0',
                                  gst: '0', // Always 0 for salex
                                  discount: '0'
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
                          Add
                        </button>
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
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          {product.car_model_names.join(', ') || '-'}
                        </td>
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
                                return (subtotal - discountAmount).toFixed(2);
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
                        <td colSpan={enableDiscount ? 10 : 9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                          SUBTOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-slate-200">
                          ₹{subtotal.toFixed(2)}
                        </td>
                      </tr>
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 10 : 9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-white uppercase tracking-wider">
                          GRAND TOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                          ₹{grandTotal.toFixed(2)}
                        </td>
                      </tr>
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 10 : 9} className="px-4 py-3"></td>
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
              <h3 className="text-lg font-medium text-slate-200 mb-3">Additional Information</h3>
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
              <h3 className="text-lg font-medium text-slate-200 mb-3">Summary & Payment</h3>
              <div className="space-y-6">

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
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL DISCOUNT</label>
                    <input
                      type="number"
                      step="0.01"
                      value={totalDiscount.toFixed(2)}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    />
                  </div>
                  {/* <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">DISCOUNT</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.discount}
                      onChange={(e) => handleInputChange('discount', e.target.value)}
                      className="input w-full"
                      placeholder="0.00"
                    />
                  </div> */}
                </div>

                {/* Packing & Forwarding */}
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Packing & Forwarding</h4>
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

                {/* Payment Details */}
                <div className="border-t border-slate-600 pt-4">
                  <h4 className="text-sm font-medium text-slate-300 mb-4">Payment Details</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS *</label>
                      <select
                        value={formData.payment_status.toString()}
                        onChange={(e) => handleInputChange('payment_status', e.target.value)}
                        className="select w-full"
                        required
                      >
                        <option value="0">Unpaid</option>
                        <option value="1">Paid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT MODE *</label>
                      <select
                        value={formData.payment_mode.toString()}
                        onChange={(e) => handleInputChange('payment_mode', e.target.value)}
                        className="select w-full"
                        required
                      >
                        <option value="0">Cash</option>
                        <option value="1">Bank</option>
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
                onClick={() => router.push('/salex')}
                className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Invoice C' : 'Create Invoice C')}
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
          handleProductSelection(product);
          setTemplateRow({
            qty: '1',
            rate: product.selling_price?.toString() || '',
            gst: '0',
            discount: '0'
          });
          setIsProductPanelOpen(false);
          setProductSearchTerm('');
        }}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Create Invoice C?"
        message={`Are you sure you want to create this Invoice C for ₹${grandTotal.toFixed(2)}? This action cannot be undone.`}
        confirmText="Create Invoice C"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Creating Invoice C..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div>
  );
}
