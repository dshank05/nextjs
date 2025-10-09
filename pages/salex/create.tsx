import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Calculator, Loader, Trash2 } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';

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
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Edit mode state - salex doesn't support edit mode yet
  const [isEditMode, setIsEditMode] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);

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

  // Function to generate dynamic product name based on car model selection
  const generateDynamicProductName = (product: Product, selectedCarModelIds: string[]): string => {
    const categoryName = filterOptions.categories.find(cat => cat.id.toString() === product.product_category_id?.toString())?.name || 'CATEGORY';
    const subcategoryName = filterOptions.subcategories.find(sub => sub.id.toString() === product.product_subcategory_id?.toString())?.name || 'SUBCATEGORY';
    const companyName = filterOptions.companies.find(comp => comp.id.toString() === product.company)?.name || product.company || 'COMPANY';

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
      company: product.company || '',
      partNo: product.part_no || ''
    }));

    console.log('🔄 PRODUCT SELECTED:', {
      product: product.product_name,
      compatibleCarModels: compatibleModels.map(m => m.name),
      initialFilters: {
        category: product.product_category_id,
        subcategory: product.product_subcategory_id,
        carModels: [], // unselected
        company: product.company
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

  // Fetch customers, staff, mechanics, products, and filters on mount
  useEffect(() => {
    fetchCustomers();
    fetchStaffList();
    fetchMechanics();
    fetchProducts();
    fetchFilterOptions();
    fetchGstRates(); // Not used but kept for consistency
    // Always fetch last invoice number for create mode
    if (!isEditMode) {
      fetchLastInvoiceNumber();
    }
  }, [isEditMode]);

  // Clear validation errors when side panel closes
  useEffect(() => {
    if (!isProductPanelOpen) {
      setErrors({});
    }
  }, [isProductPanelOpen]);

  // Handle product search with normalized text
  useEffect(() => {
    if (productSearchTerm.trim()) {
      const searchTermNormalized = productSearchTerm.replace(/[\s\-\_]/g, '').toLowerCase();
      const filtered = products.filter(product => {
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
      setSearchedProducts(filtered);
    } else {
      setSearchedProducts(products);
    }
  }, [productSearchTerm, products]);

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
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setCustomers([]);
    }
  };

  const fetchStaffList = async () => {
    try {
      setStaffList([]);
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchMechanics = async () => {
    try {
      setMechanics([]);
    } catch (error) {
      console.error('Error fetching mechanics:', error);
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
      company_id: product.company ? parseInt(product.company) : 0,
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

        // Invoice items
        invoiceItems: selectedProducts.map(item => ({
          name_of_product: item.product_id,
          qty: item.qty,
          rate: item.rate,
          subtotal: item.total, // For salex, subtotal = total (no tax added)
          hsn: item.hsn || '',
          part: item.part_number,
          category_id: item.category_id,
          model_id: item.car_model_ids[0] || 0,
          company_id: item.company_id
        })),

        // Billing details
        billingDetails: selectedCustomer ? {
          user_name: selectedCustomer.billing_name,
          address: selectedCustomer.billing_address,
          address2: selectedCustomer.billing_address_2 || null,
          mobile: selectedCustomer.contact_no,
          email: selectedCustomer.email,
          state: selectedCustomer.billing_state,
          state_code: selectedCustomer.billing_state_code || null,
          gstin: selectedCustomer.billing_gstin
        } : null,

        // Shipping details
        shippingDetails: selectedCustomer ? {
          user_name: selectedCustomer.shipping_name || selectedCustomer.billing_name,
          address: selectedCustomer.shipping_address || selectedCustomer.billing_address,
          state: selectedCustomer.shipping_state || selectedCustomer.billing_state,
          state_code: selectedCustomer.shipping_state_code || selectedCustomer.billing_state_code || 0,
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

        // Skip tax-related fields entirely for salex
        // total_cgst, total_sgst, total_igst are not included
      };

      console.log('📤 UI SENDING SALEX PAYLOAD:', submitData);

      const response = await fetch('/api/salex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
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
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-6">

            {/* Invoice Information */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Invoice C Information</h3>
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
            <div className="mb-6 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Customer Information</h3>
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
            <div className="mb-6 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Service Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div></div> {/* Empty column for 4-column layout */}
              </div>
            </div>

            {/* Discount Section */}
            <div className="mb-6 border-t border-slate-600 pt-8">
              <div className="flex items-center justify-between mb-6">
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
            <div className="mb-6 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Product Selection</h3>

              {/* Product Selection & Display Table */}
              <div className="border border-slate-600 rounded mb-6">
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
                          className={`w-full px-3 py-2 border rounded text-xs text-white text-left transition-colors ${
                            selectedCustomerId
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
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={productRowFilters.subcategory}
                          onChange={(e) => {
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: e.target.value
                            }));
                          }}
                        >
                          <option value="">Select Sub Category</option>
                          {filterOptions.subcategories.map((sub) => (
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
                                  subcategory_name: filterOptions.subcategories.find(s => s.id.toString() === productRowFilters.subcategory)?.name || '',
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
                          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                            selectedRowProduct
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
                      <tr key={product.id} className="bg-slate-800 hover:bg-slate-750 border-t border-slate-600">
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
                        <td className="px-3 py-2 text-center text-xs">
                          <input
                            type="number"
                            min="1"
                            value={product.qty}
                            onChange={(e) => updateProductQuantity(product.id, parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          />
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          ₹{product.rate.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-slate-200">
                          ₹{product.tax.toFixed(2)}
                        </td>
                        {enableDiscount && (
                          <td className="px-3 py-2 text-center text-xs">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={product.discount_percentage}
                              onChange={(e) => updateProductDiscount(product.id, parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 text-center text-sm font-medium text-slate-200">
                          ₹{product.total.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => removeProduct(product.id)}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                            title="Remove product"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
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
                        <td className="px-4 py-3"></td>
                      </tr>
                      {totalDiscount > 0 && (
                        <tr>
                          <td colSpan={enableDiscount ? 10 : 9} className="px-4 py-3"></td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                            TOTAL DISCOUNT
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                            -₹{totalDiscount.toFixed(2)}
                          </td>
                          <td className="px-4 py-3"></td>
                        </tr>
                      )}
                      <tr className="border-t border-slate-600">
                        <td colSpan={enableDiscount ? 10 : 9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-white uppercase tracking-wider">
                          GRAND TOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                          ₹{grandTotal.toFixed(2)}
                        </td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {errors.products && <p className="text-red-400 text-xs mt-1">{errors.products}</p>}
            </div>

            {/* Additional Information */}
            <div className="mb-6 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Additional Information</h3>
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
            <div className="border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Summary & Payment</h3>
              <div className="space-y-6">

                {/* Calculations */}
                <div className="grid grid-cols-3 gap-4">
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
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">DISCOUNT</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.discount}
                      onChange={(e) => handleInputChange('discount', e.target.value)}
                      className="input w-full"
                      placeholder="0.00"
                    />
                  </div>
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
                        <option value="1">Cash</option>
                        <option value="2">Bank</option>
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
                {loading ? 'Creating...' : 'Create Invoice C'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Product Selection Side Panel */}
      {isProductPanelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setIsProductPanelOpen(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 w-3/12 h-full bg-slate-900 shadow-lg flex flex-col z-50">
            {/* Header */}
            <div className="p-4 border-b border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-slate-200">Select Product</h3>
                <button
                  onClick={() => setIsProductPanelOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded"
                >
                  <span className="text-slate-400 text-xl">×</span>
                </button>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={productSearchTerm}
                  onChange={(e) => setProductSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Product List */}
            <div className="flex-1 overflow-y-auto">
              {searchedProducts.length > 0 ? (
                <div className="p-4 space-y-2">
                  {searchedProducts.map((product) => (
                    <div
                      key={product.id}
                      className="p-3 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 cursor-pointer transition-colors"
                      onClick={() => {
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
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="text-slate-200 font-bold text-sm">{product.product_name}</h4>
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center">
                              <span className="text-green-400 font-semibold text-sm mr-2">Stock:</span>
                              <span className="text-white font-bold text-sm">{product.stock || 0} units</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <p className="text-slate-400 text-sm">
                    {productSearchTerm ? 'No products found' : 'Loading products...'}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-700">
              <button
                onClick={() => setIsProductPanelOpen(false)}
                className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

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
