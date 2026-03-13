import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Calculator, Loader, Trash2, Edit2, Plus, Filter } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ProductSelectionPanel } from '../../components/common/ProductSelectionPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';
import { broadcast, subscribeBroadcast } from '../../lib/broadcast';
import type { StaffDetails, MechanicDetails, Customer } from '../../types/staff';
import type { Product, FilterOptions } from '../../types/products';
import type { SalexInvoiceItem, SalexFormData } from '../../types/sales';
import { useStaff, useMechanics, useCustomers } from '../../hooks/useStaff';
import { useProducts, useFilterOptions } from '../../hooks/useProducts';
import { useStates } from '../../hooks/useStates';
import { useSalexItem, useLastSalexInvoiceNumber, useCreateSalex, useUpdateSalex } from '../../hooks/useSalex';

export default function InvoiceCCreate() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  // React Query Hooks
  const { data: staffData } = useStaff();
  const { data: mechanicsData } = useMechanics();
  const { data: customersData } = useCustomers();
  const { data: statesData } = useStates();
  const { data: filterOptionsData } = useFilterOptions();
  const { data: lastInvoiceNumber, isLoading: invoiceNumberLoading } = useLastSalexInvoiceNumber();
  
  // Product filters for side panel
  const [selectedPanelCarModel, setSelectedPanelCarModel] = useState<string>('');
  const [selectedPanelCategory, setSelectedPanelCategory] = useState<string>('');
  const [selectedPanelSubcategory, setSelectedPanelSubcategory] = useState<string>('');
  const [selectedPanelCompany, setSelectedPanelCompany] = useState<string>('');
  const [productSearchTerm, setProductSearchTerm] = useState('');
  
  const { data: productsData, isLoading: productsLoading } = useProducts({
    fetchAll: true,
    modelFilter: selectedPanelCarModel || undefined,
    search: productSearchTerm || undefined,
    categoryFilter: selectedPanelCategory || undefined,
    subcategoryFilter: selectedPanelSubcategory || undefined,
    companyFilter: selectedPanelCompany || undefined,
  });

  // Edit mode hooks
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);
  const { data: salexData, isLoading: editDataLoading } = useSalexItem(editInvoiceId || undefined);
  
  // Mutations
  const createSalex = useCreateSalex();
  const updateSalex = useUpdateSalex();

  // Transform hook data to component state format
  const staffList: StaffDetails[] = staffData?.map((staff: any) => ({
    id: staff.id.toString(),
    staff_name: staff.name
  })) || [];

  const mechanics: MechanicDetails[] = mechanicsData?.map((mechanic: any) => ({
    id: mechanic.id.toString(),
    mechanic_name: mechanic.name
  })) || [];

  const customers: Customer[] = customersData || [];
  const products: Product[] = productsData?.products || [];
  const states = statesData || [];
  const filterOptions: FilterOptions = filterOptionsData || {
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  };

  // Local state
  const [selectedProducts, setSelectedProducts] = useState<SalexInvoiceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Customer selection state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerIdToSave, setCustomerIdToSave] = useState<number | null>(null);
  const [customerStateForTax, setCustomerStateForTax] = useState<string>('');
  const [isOtherCustomerSelected, setIsOtherCustomerSelected] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);

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

  // State for product selection side panel
  const [isProductPanelOpen, setIsProductPanelOpen] = useState(false);
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);

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
      carModels: [product.car_model_ids.split(",")[0]],
      company: product.company_id ? product.company_id.toString() : '',
      partNo: product.part_no || ''
    }));

    console.log('?? PRODUCT SELECTED:', {
      product: product.product_name,
      compatibleCarModels: compatibleModels.map(m => m.name),
      initialFilters: {
        category: product.product_category_id,
        subcategory: product.product_subcategory_id,
        carModels: [product.car_model_ids.split(",")[0]], // unselected
        company: product.company_id
      }
    });
  };

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    gst: '0', // Not used but kept for template consistency
    discount: '0',
    total: ''
  });

  // State for discount toggle
  const [enableDiscount, setEnableDiscount] = useState(false);

  // State to track which field was last edited (for smart calculation)
  const [lastEditedField, setLastEditedField] = useState<'qty' | 'rate' | 'total' | null>(null);

  // State for inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<SalexInvoiceItem | null>(null);

  // New state for GST rates - not used for salex but kept for consistency
  const [gstRates, setGstRates] = useState<any[]>([]);

  // Memoize the filterOptions to prevent unnecessary re-renders
  const memoizedFilterOptions = useMemo(() => filterOptions, [
    filterOptions.categories,
    filterOptions.subcategories,
    filterOptions.companies,
    filterOptions.models
  ]);

  const [formData, setFormData] = useState<SalexFormData>({
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
    total_tax: '', // Always 0 for salex
    grand_total: '',
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    tax_rate: '',
    basic_value: '',
    pin_code: '',
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

  // Data is now fetched automatically by React Query hooks - no manual fetch needed

  // Set invoice number from hook data
  useEffect(() => {
    if (lastInvoiceNumber && !isEditMode && !router.query.edit) {
      setFormData(prev => ({ ...prev, invoice_number: lastInvoiceNumber.toString() }));
    }
  }, [lastInvoiceNumber, isEditMode, router.query.edit]);

  // Load invoice data when edit mode is detected (using useSalexItem hook)
  useEffect(() => {
    if (!salexData || !isEditMode) return;

    const invoice = salexData.invoice || salexData;
    const transportDetails = salexData.transportDetails || {};

    console.log('? Loading salex data from hook:', invoice);

    // Format date
    const formatDateForInput = (dateValue: number | string) => {
      try {
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
      } catch (error) {
        return new Date().toISOString().split('T')[0];
      }
    };

    // Prefill form data
    const formDataToSet = {
      invoice_number: invoice.invoice_no ? invoice.invoice_no.toString() : '',
      bill_reference: invoice.bill_reference || '',
      staff_id: invoice.staff_id || null,
      date: formatDateForInput(invoice.invoice_date),
      customer_name: invoice.customer_name || '',
      contact_number: invoice.contact_number || '',
      mechanic_name: invoice.mechanic?.mechanic_name || '',
      vehicle_number: transportDetails.vehicle_no || '',
      commission: invoice.commission ? invoice.commission.toString() : '',
      address: invoice.address || '',
      address_2: invoice.address_2 || '',
      transport_name: transportDetails.trans_mode || '',
      city: invoice.city || '',
      email_id: invoice.email_id || '',
      discount: invoice.discount || '',
      state: invoice.state || '',
      state_code: invoice.state_code,
      gst_number: invoice.gst_number || '',
      tax: invoice.tax || '',
      notes: invoice.notes || '',
      payment_status: invoice.payment_status !== undefined && invoice.payment_status !== null ? invoice.payment_status : 1,
      payment_mode: invoice.payment_mode !== undefined && invoice.payment_mode !== null ? invoice.payment_mode : 0,
      total_discount: invoice.total_discount ? invoice.total_discount.toString() : '',
      subtotal: invoice.subtotal ? invoice.subtotal.toString() : '',
      total_tax: invoice.total_tax ? invoice.total_tax.toString() : '',
      grand_total: invoice.total ? invoice.total.toString() : '',
      descriptions: invoice.descriptions || '',
      packing_forwarding_qty: invoice.packing_forwarding_qty !== null && invoice.packing_forwarding_qty !== undefined ? invoice.packing_forwarding_qty.toString() : '0',
      packing_forwarding_rate: invoice.packing_forwarding_rate !== null && invoice.packing_forwarding_rate !== undefined ? invoice.packing_forwarding_rate.toString() : '0',
      packing_forwarding_total: invoice.packing_forwarding_total !== null && invoice.packing_forwarding_total !== undefined ? invoice.packing_forwarding_total.toString() : '0',
      tax_rate: invoice.tax_rate ? invoice.tax_rate.toString() : '',
      basic_value: invoice.basic_value ? invoice.basic_value.toString() : '',
      pin_code: invoice.pin_code || ''
    };

    setFormData(formDataToSet);

    // Override with billing details if available
    if (salexData.billingDetails) {
      setFormData(prev => ({
        ...prev,
        customer_name: salexData.billingDetails.customer_name || prev.customer_name,
        contact_number: salexData.billingDetails.contact_number || prev.contact_number,
        email_id: salexData.billingDetails.email_id || prev.email_id,
        address: salexData.billingDetails.address || prev.address,
        address_2: salexData.billingDetails.address_2 || prev.address_2,
        city: salexData.billingDetails.city || prev.city,
        state: salexData.billingDetails.state || prev.state,
        gst_number: salexData.billingDetails.gst_number || prev.gst_number,
        pin_code: salexData.billingDetails.pin_code || prev.pin_code,
      }));
    }

    // Set staff and mechanic IDs
    if (invoice.staff_id) {
      setSelectedStaffId(invoice.staff_id.toString());
    }
    if (invoice.mechanic_id) {
      setSelectedMechanicId(invoice.mechanic_id.toString());
    }

    // Store raw invoice items for conversion
    if (salexData.items && salexData.items.length > 0) {
      setRawInvoiceItems(salexData.items);
    }

    // Set customer selection
    if (salexData.customer && salexData.customer.id && salexData.customer.id !== '0' && salexData.customer.id !== 0) {
      setTimeout(() => {
        handleCustomerSelect(salexData.customer.id.toString());
      }, 0);
    } else {
      setSelectedCustomerId('0');
      setCustomerIdToSave(0);
      setSelectedCustomer(null);
      setIsOtherCustomerSelected(true);
      setCustomerStateForTax(invoice.state || '');
    }
  }, [salexData, isEditMode]);

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

  // Products are now fetched automatically by useProducts hook based on filter state
  // No need for manual fetchProducts useEffect


  // Auto-select product when filters match exactly one product
  useEffect(() => {
    if (productRowFilters.category || productRowFilters.subcategory || productRowFilters.carModels.length > 0 || productRowFilters.company || productRowFilters.partNo) {
      const matchingProducts = products.filter(product => {
        // Category filter
        if (productRowFilters.category && parseInt(productRowFilters.category) > 0 && product.product_category_id !== parseInt(productRowFilters.category)) {
          return false;
        }

        // Subcategory filter
        if (productRowFilters.subcategory && parseInt(productRowFilters.subcategory) > 0 && product.product_subcategory_id !== parseInt(productRowFilters.subcategory)) {
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
        if (productRowFilters.company && parseInt(productRowFilters.company) > 0 && productCompanyId !== parseInt(productRowFilters.company)) {
          return false;
        }

        // Part number filter
        if (productRowFilters.partNo && product.part_no && !product.part_no.toLowerCase().includes(productRowFilters.partNo.toLowerCase())) {
          return false;
        }

        return true;
      });

      if (matchingProducts.length === 1 && !selectedRowProduct) {
        // Only auto-select if nothing is currently selected
        handleProductSelection(matchingProducts[0]);
      } else if (matchingProducts.length === 0) {
        setSelectedRowProduct(null);
      }
    }
  }, [productRowFilters, products, selectedRowProduct]);

  // Convert raw invoice items when filterOptions are loaded
  useEffect(() => {
    if (rawInvoiceItems.length > 0 && filterOptions.categories.length > 0 && filterOptions.models.length > 0) {
      const convertedItems: SalexInvoiceItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: SalexInvoiceItem = {
          id: (index + 1).toString(),
          product_id: item.product_id,
          product_name: item.display_name || item.name_of_product || '',
          car_model_ids: item.model_id ? [item.model_id.toString()] : [],
          car_model_names: (() => {
            if (item.model_id) {
              const modelName = filterOptions.models.find(model => model.id.toString() === item.model_id?.toString())?.name;
              return modelName ? [modelName] : [];
            }
            // Fallback: try to extract from car_model field if it exists
            if (item.car_model) {
              return [item.car_model];
            }
            return [];
          })(),
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




  const handleInputChange = (field: keyof SalexFormData, value: string) => {
    let processedValue: string | number | null = value;

    // Convert numeric fields to numbers
    if (field === 'payment_status' || field === 'payment_mode') {
      processedValue = parseInt(value) || 0;
    } else if (field === 'staff_id') {
      processedValue = value ? parseInt(value) : null;
    } else if (field === 'state_code') {
      processedValue = value ? parseInt(value) : undefined;
    }

    setFormData(prev => ({ ...prev, [field]: processedValue }));
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
        gst_number: customer.billing_gstin || '',
        address: customer.billing_address || '',
        address_2: customer.billing_address_2 || '',
        city: customer.billing_city || '',
        state: customer.billing_state || '',
        state_code: customer.billing_state_code,
        pin_code: customer.billing_pin_code || ''
      }));

      // Clear existing products when customer changes (tax calculations will be different)
      // BUT NOT in edit mode - items are being loaded from API
      if (!isEditMode) {
        setSelectedProducts([]);
        setFormData(prev => ({
          ...prev,
          total_cgst: '',
          total_sgst: '',
          total_igst: ''
        }));
      }

      setCustomerStateForTax(customer.billing_state || '');
    } else {
      // Clear customer selection
      setCustomerIdToSave(null);
      setSelectedCustomer(null);
      setCustomerStateForTax('');
    }
  };


  const handleEditProduct = (item: SalexInvoiceItem) => {
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

      // Recalculate tax and total for salex (tax is always 0)
      const subtotal = editingRowData.qty * editingRowData.rate;
      const discountAmount = enableDiscount ? editingRowData.discount_amount : 0;
      const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
      const finalTotal = subtotal - discountAmount; // No tax added for salex

      const updatedItem = {
        ...editingRowData,
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
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
    if (!selectedCustomerId) {
      newErrors.customer_name = 'Please select a customer';
    }
    if (isOtherCustomerSelected && !formData.customer_name.trim()) {
      newErrors.customer_name = 'Customer name is required';
    }
    if (!formData.state.trim()) {
      newErrors.state = 'State is required';
    }
    if (isOtherCustomerSelected && !formData.contact_number.trim()) {
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
      // Payload for salex invoice creation (no tax fields)
      const submitData = {
        // Main invoice fields
        invoice_no: formData.invoice_number,
        invoice_date: formData.date,
        select_customer: customerIdToSave || 0, // Customer ID or 0 for "Other"
        staff_id: formData.staff_id,
        staff_details: staffList.find(e => e.id === formData?.staff_id?.toString())?.staff_name,

        // ===== CUSTOMER DETAILS (Always included from formData) =====
        customer_name: formData.customer_name,
        contact_number: formData.contact_number,
        email_id: formData.email_id,
        address: formData.address,
        address_2: formData.address_2,
        city: formData.city,
        state: formData.state,
        gst_number: formData.gst_number,
        pin_code: formData.pin_code,

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
          subcategory_id: item.subcategory_id,
        })),

        // Customer ID - always 0 for salex
        customer_id: 0,

        // Shipping details - use formData directly
        shippingDetails: {
          user_name: formData.customer_name,
          address: formData.address,
          state: formData.state ? parseInt(formData.state) : null,
          state_code: formData.state_code || null,
          gstin: formData.gst_number
        },

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

      console.log('?? UI SENDING SALEX PAYLOAD:', submitData);

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

      console.log('?? FINAL UI SENDING COMPLETE SALEX PAYLOAD:', finalSubmitData);

      // Use React Query mutations
      if (isEditMode && editInvoiceId) {
        await updateSalex.mutateAsync({ id: editInvoiceId, data: finalSubmitData });
        
        SessionStorageService.remove('salex', editInvoiceId.toString());
        setShowConfirmationModal(false);

        // Broadcast the update event
        broadcast({
          type: 'updated',
          resource: 'salex',
          data: { id: editInvoiceId }
        });

        // Navigate to salex view page
        router.push(`/salex/view/${editInvoiceId}`);
        showSnackbar('success', 'Salex invoice updated successfully!');
      } else {
        const responseData = await createSalex.mutateAsync(finalSubmitData);
        
        setShowConfirmationModal(false);

        // Broadcast the creation event
        broadcast({
          type: 'created',
          resource: 'salex',
          data: { id: responseData.salex?.id || responseData.id }
        });

        // Navigate to salex view page
        const salexId = responseData.salex?.id || responseData.id;
        if (salexId) {
          router.push(`/salex/view/${salexId}`);
        } else {
          router.push('/salex');
        }
        showSnackbar('success', 'Salex invoice created successfully!');
      }
    } catch (error: any) {
      console.error('? Error:', error);
      showSnackbar('error', error.message || `Failed to ${isEditMode ? 'update' : 'create'} salex invoice`);
      setErrors({ submit: error.message || `Failed to ${isEditMode ? 'update' : 'create'} salex invoice` });
      setShowConfirmationModal(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmationModal(false);
  };

  return (
    <div className="space-y-3">
      {/* Edit Data Loading Spinner */}
      {editDataLoading && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-800 rounded-lg p-6 flex flex-col items-center space-y-4 shadow-xl">
            <Loader className="w-8 h-8 animate-spin text-blue-400" />
            <div className="text-center">
              <p className="text-slate-200 font-medium">Loading Salex Data</p>
              <p className="text-slate-400 text-sm">Please wait while we fetch the salex details...</p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-6">

            {/* Invoice Information */}
            <div className="mb-3">
              {/* <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice C Information</h3> */}
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
                  <SearchableSelect
                    options={[
                      { id: '', name: 'Select Staff' },
                      ...staffList.map((staff) => ({
                        id: staff.id.toString(),
                        name: staff.staff_name
                      }))
                    ]}
                    selectedValue={selectedStaffId || ''}
                    onSelectionChange={(value) => {
                      setSelectedStaffId(value || '');
                      handleInputChange('staff_id', value || '');
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
                      href="/customers/create?from=salex"
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
                      setSelectedCustomerId(customerId.toString());
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
                  {errors.contact_number && <p className="text-red-400 text-xs mt-1">{errors.contact_number}</p>}
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
                    value={formData.gst_number || selectedCustomer?.billing_gstin || ''}
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
                    value={formData.address || selectedCustomer?.billing_address || ''}
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
                    value={formData.address_2 || selectedCustomer?.billing_address_2 || ''}
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
                    value={formData.city || selectedCustomer?.billing_city || ''}
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
                      if (selectedCustomer?.billing_state_code) {
                        const matchingState = states.find(state => state.code === selectedCustomer.billing_state_code);
                        return matchingState ? matchingState.id : '';
                      }
                      // Fallback to state name matching if no state code
                      if (formData.state || selectedCustomer?.billing_state) {
                        const currentStateName = formData.state || selectedCustomer?.billing_state || '';
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
                        id: mechanic.id.toString(),
                        name: mechanic.mechanic_name
                      }))
                    ]}
                    selectedValue={selectedMechanicId || ''}
                    onSelectionChange={(value) => {
                      setSelectedMechanicId(value || '');
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

            {/* Discount Section */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <div className="flex flex-row-reverse mb-3 space-x-6">
                {/* <h3 className="text-lg font-medium text-slate-200">Discount</h3> */}
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
                      {enableDiscount && (
                        <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                          DISCOUNT (?)
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
                          selectedValue={productRowFilters.category}
                          onSelectionChange={(value) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: value || ''
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
                              name: sub.subcategory_name
                            }))
                          ]}
                          selectedValue={productRowFilters.subcategory}
                          onSelectionChange={(value) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: value || ''
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
                          selectedValue={productRowFilters.company}
                          onSelectionChange={(value) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: value || ''
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
                          step="1"
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
                            
                            const enteredQty = parseInt(newQty);
                            if (isNaN(enteredQty) || enteredQty < 0) return;
                            
                            // If user already entered total manually, calculate rate from it
                            if (lastEditedField === 'total' && templateRow.total) {
                              const total = parseInt(templateRow.total);
                              const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;
                              
                              if (enteredQty > 0) {
                                const rate = (total + discountAmount) / enteredQty;
                                setTemplateRow(prev => ({
                                  ...prev,
                                  qty: enteredQty.toString(),
                                  rate: rate.toFixed(2)
                                }));
                              } else {
                                setTemplateRow(prev => ({
                                  ...prev,
                                  qty: enteredQty.toString()
                                }));
                              }
                            } else {
                              // Normal flow: calculate total from qty and rate
                              const rate = parseFloat(templateRow.rate) || 0;
                              const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;
                              
                              if (rate > 0) {
                                const subtotal = enteredQty * rate;
                                const total = Math.round(subtotal - discountAmount);
                                setTemplateRow(prev => ({
                                  ...prev,
                                  qty: enteredQty.toString(),
                                  total: total.toString()
                                }));
                              } else {
                                setTemplateRow(prev => ({
                                  ...prev,
                                  qty: enteredQty.toString(),
                                  total: ''
                                }));
                              }
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
                            
                            const enteredRate = parseFloat(newRate);
                            if (isNaN(enteredRate) || enteredRate < 0) return;
                            
                            const qty = parseInt(templateRow.qty) || 0;
                            const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;
                            
                            if (qty > 0) {
                              const subtotal = qty * enteredRate;
                              const total = Math.round(subtotal - discountAmount);
                              setTemplateRow(prev => ({
                                ...prev,
                                rate: enteredRate.toFixed(2),
                                total: total.toString()
                              }));
                            } else {
                              setTemplateRow(prev => ({
                                ...prev,
                                rate: enteredRate.toFixed(2),
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
                            const discountAmount = enableDiscount ? (parseFloat(templateRow.discount) || 0) : 0;

                            if (qty > 0) {
                              // Calculate rate from total considering discount - allow decimals
                              // total = (qty * rate) - discount
                              // rate = (total + discount) / qty
                              const rate = (enteredTotal + discountAmount) / qty;
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
                                // Get company info properly using the helper function (like sale/create.tsx)
                                const { companyId, companyName } = getCompanyInfo(selectedProduct);

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
                                const discountAmount = enableDiscount ? parseFloat(templateRow.discount) || 0 : 0;

                                // Calculate amounts - NO TAX for salex
                                const subtotal = qty * rate;
                                const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
                                const finalTotal = subtotal - discountAmount; // No tax added

                                const newItem: SalexInvoiceItem = {
                                  id: Date.now().toString(),
                                  product_id: selectedProduct.id,
                                  product_name: selectedProduct.product_name,
                                  car_model_ids: selectedProduct.car_model_ids ? selectedProduct.car_model_ids.split(',').map(id => id.trim()) : [],
                                  car_model_names: carModelNames ? carModelNames.split(', ') : [],
                                  category_id: selectedProduct.product_category_id || 0,
                                  category_name: filterOptions.categories.find(c => c.id.toString() === productRowFilters.category)?.name || '',
                                  subcategory_id: selectedProduct.product_subcategory_id || null,
                                  subcategory_name: productRowFilters.subcategory ? filterOptions.subcategories.find(s => s.id.toString() === productRowFilters.subcategory)?.name || '' : '',
                                  company_id: companyId, // Use helper function result instead of product.company
                                  company_name: companyName, // Use helper function result instead of filter lookup
                                  part_number: productRowFilters.partNo,
                                  qty: qty,
                                  rate: rate,
                                  gst_percentage: 0, // Always 0 for salex
                                  discount_percentage: discountPercentage,
                                  tax: 0, // Always 0 for salex
                                  discount_amount: discountAmount,
                                  total: finalTotal, // For salex: total = (rate * qty) - discount
                                  // New pricing fields
                                  hsn: selectedProduct.hsn || '',
                                  mrp: 0,
                                  discount: discountPercentage,
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
                                  category: '',
                                  subcategory: '',
                                  carModels: [],
                                  company: '',
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
                              �
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
                                      const discountAmount = enableDiscount ? editingRowData.discount_amount : 0;
                                      const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;

                                      const updatedItem = {
                                        ...editingRowData,
                                        car_model_names: newCarModelNames,
                                        product_name: updatedProductName,
                                        discount_amount: discountAmount,
                                        discount_percentage: discountPercentage,
                                        total: subtotal - discountAmount, // No tax for salex
                                        // Tax fields always 0 for salex
                                        tax: 0,
                                        cgst: 0,
                                        sgst: 0,
                                        igst: 0
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
                                step="1"
                                value={editingRowData?.qty || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, qty: parseFloat(e.target.value) || 0 } : null)}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-3 py-2 text-center w-32">
                              <input
                                type="number"
                                value={editingRowData?.rate || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, rate: parseFloat(e.target.value) || 0 } : null)}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center w-20">
                                <input
                                  type="number"

                                  min="0"
                                  max="100"
                                  value={editingRowData?.discount_percentage || ''}
                                  onChange={(e) => setEditingRowData(prev => prev ? { ...prev, discount_percentage: parseFloat(e.target.value) || 0 } : null)}
                                  onWheel={(e) => e.preventDefault()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                      e.preventDefault();
                                    }
                                  }}
                                  className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                                />
                              </td>
                            )}
                            <td className="px-3 py-2 text-center w-20">
                              <input
                                type="number"

                                value={editingRowData?.total || ''}
                                onChange={(e) => {
                                  const newTotal = e.target.value;
                                  setEditingRowData(prev => {
                                    if (!prev) return null;
                                    const updated = { ...prev, total: parseFloat(newTotal) || 0 };

                                    // If total is entered and qty > 0, recalculate rate
                                    const qty = prev.qty || 0;
                                    const discountPercent = enableDiscount ? prev.discount_percentage || 0 : 0;
                                    const enteredTotal = parseFloat(newTotal) || 0;

                                    if (qty > 0 && enteredTotal > 0) {
                                      // Reverse calculation for salex: total = (rate * qty) - discount
                                      // So: rate = (total + discount) / qty
                                      // Where discount = (rate * qty * discountPercent) / 100
                                      // This creates a quadratic equation, so we need to solve iteratively

                                      // For simplicity, assume discount is applied to the final total
                                      // So: rate = total / qty * (1 + discountPercent/100)
                                      const rate = enteredTotal / qty / (1 - discountPercent / 100);

                                      updated.rate = rate;
                                    }

                                    return updated;
                                  });
                                }}
                                onWheel={(e) => e.preventDefault()}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    e.preventDefault();
                                  }
                                }}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
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
                                  ?
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelInlineEdit}
                                  className="px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                                  title="Cancel edit"
                                >
                                  ?
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
                              {Math.round(product.rate)}
                            </td>
                            {enableDiscount && (
                              <td className="px-3 py-2 text-center text-xs text-slate-200">
                                {Math.round(product.discount_amount)}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center text-sm font-medium text-slate-200">
                              {Math.round(product.total)}
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
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 7 : 6} className="px-4 py-3"></td>
                        <td colSpan={2} className="px-4 py-3 text-center">
                          {/* Display Subtotal */}
                        {/* Display Subtotal instead */}
                        <div className="text-sm font-semibold text-slate-200">
                          Subtotal: {subtotal.toFixed(2)}
                        </div>
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
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL DISCOUNT</label>
                  <input
                    type="number"

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
                      
                      value={formData.discount}
                      onChange={(e) => handleInputChange('discount', e.target.value)}
                      className="input w-full"
                      placeholder="0"
                    />
                  </div> */}
              </div>

              {/* Packing & Forwarding */}
              <div>
                {/* <h4 className="text-sm font-medium text-slate-300 mb-3">Packing & Forwarding</h4> */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">QTY</label>
                    <input
                      type="number"
                      step="1"
                      value={formData.packing_forwarding_qty}
                      onChange={(e) => handleInputChange('packing_forwarding_qty', e.target.value)}
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
                  {/* RATE FIELD HIDDEN - Auto-calculated */}
                  {/* <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">RATE</label>
                    <input
                      type="number"

                      value={formData.packing_forwarding_rate}
                      onChange={(e) => handleInputChange('packing_forwarding_rate', e.target.value)}
                      onWheel={(e) => e.preventDefault()}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                          e.preventDefault();
                        }
                      }}
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
                      onSelectionChange={(value) => handleInputChange('payment_status', (parseInt(value || '0')).toString())}
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
                      onSelectionChange={(value) => handleInputChange('payment_mode', (parseInt(value || '0')).toString())}
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
                          ?{grandTotal.toFixed(2)}
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
                SessionStorageService.remove('salex', editInvoiceId.toString());
                router.push('/salex')
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
              {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Invoice C' : 'Create Invoice C')}
            </button>
          </div>
        </div>
      </div>
    </form >

      {/* Product Selection Side Panel */ }
      <ProductSelectionPanel
        isOpen = { isProductPanelOpen }
        onClose = {() => {
          setIsProductPanelOpen(false);
          // Clear filters when closing
          setSelectedPanelCarModel('');
          setSelectedPanelCategory('');
          setSelectedPanelSubcategory('');
          setSelectedPanelCompany('');
        }}

        title = "Select Product"
        showCarModelFilter = { true}
        filterOptions = { memoizedFilterOptions }
        selectedCarModel = { selectedPanelCarModel }
        onCarModelSelection = { setSelectedPanelCarModel }
        selectedCategory = { selectedPanelCategory }
        onCategorySelection = { setSelectedPanelCategory }
        selectedSubcategory = { selectedPanelSubcategory }
        onSubcategorySelection = { setSelectedPanelSubcategory }
        selectedCompany = { selectedPanelCompany }
        onCompanySelection = { setSelectedPanelCompany }
        searchedProducts = { products }
        productSearchTerm = { productSearchTerm }
        onSearchTermChange = { setProductSearchTerm }
        isLoading = { productsLoading }
        onProductSelect = {(product) => {
          handleProductSelection(product);
          setTemplateRow({
            qty: '1',
            rate: product.latest_selling_price?.toString() || product.rate?.toString() || '0',
            gst: '0',
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
        title="Create Invoice C?"
        message={`Are you sure you want to create this Invoice C for ?${grandTotal?.toFixed(2)}? This action cannot be undone.`}
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
