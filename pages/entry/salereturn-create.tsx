import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Loader } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';
import { ClearableInput, ClearableTextarea } from '../../components/common';

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
  gst_percentage: number;
  discount_percentage: number;
  tax: number;
  discount_amount: number;
  total: number;
  hsn: string;
  mrp: number;
  margin: number;
  cgst: number;
  sgst: number;
  igst: number;
}

interface ReturnReasons {
  id: number;
  reason_name: string;
  type: string;
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

// Return-specific interface
interface ReturnItem extends InvoiceItem {
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

export default function SaleReturnCreatePage() {
  const router = useRouter();
  const { invoice: invoiceIdParam } = router.query;
  const { showSnackbar } = useSnackbar();

  // Create a todo list for this task
  useEffect(() => {
    const todoList = [
      { id: '1', label: 'Restructure UI to match sale create page layout with single mega card', completed: true },
      { id: '2', label: 'Move return configuration into Invoice Information section', completed: true },
      { id: '3', label: 'Move invoice details to Customer Information section', completed: true },
      { id: '4', label: 'Reorganize return items table to match sale create table structure', completed: true },
      { id: '5', label: 'Move summary calculations into Summary & Payment section', completed: true },
      { id: '6', label: 'Test the updated layout and fix any styling issues', completed: true }
    ];

    // Store this todo list (only add if not already present)
    if (!sessionStorage.getItem('sale_return_ui_task')) {
      sessionStorage.setItem('sale_return_ui_task', JSON.stringify(todoList));
    }
  }, []);

  // Business state hardcoded to Uttar Pradesh (assuming state code 9)
  const BUSINESS_STATE_CODE = 9; // Uttar Pradesh

  // State declarations moved above useEffect hooks
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staffList, setStaffList] = useState<StaffDetails[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ReturnItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [editInvoiceId, setEditInvoiceId] = useState<number>(0);

  // Raw invoice data for re-conversion when filters load
  const [rawInvoiceItems, setRawInvoiceItems] = useState<any[]>([]);

  // Return-specific state
  const [returnReasons, setReturnReasons] = useState<ReturnReasons[]>([]);
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [returnStatus, setReturnStatus] = useState<string>('Pending');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

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

  // State for selected customer details (fetched on-demand, not stored in formData)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // State for customer state code (like vendor state in purchase create)
  const [customerStateForTax, setCustomerStateForTax] = useState<number>(BUSINESS_STATE_CODE); // Track customer's state for tax calculations (default to business state)

  // Load original invoice data - Always load from API first for reliability
  useEffect(() => {
    const loadInvoiceData = async () => {
      if (!invoiceIdParam) return;

      const invoiceId = parseInt(invoiceIdParam as string);
      setEditInvoiceId(invoiceId);
      setInvoiceNumberLoading(true);

      try {
        // Try API first (more reliable than sessionStorage)
        await fetchInvoiceForEdit(invoiceId);
        console.log('✅ Invoice data loaded from API');
      } catch (error) {
        console.error('❌ Failed to load invoice from API:', error);

        // Fallback to sessionStorage if API fails
        const cachedData = SessionStorageService.get('sales', invoiceId.toString());
        if (cachedData) {
          console.log('🔄 Fallback: Using cached invoice data from sessionStorage');
          populateFormWithInvoiceData(cachedData);
          // Keep cached data for potential future use
        } else {
          console.error('❌ No cached data available - invoice loading failed completely');
          showSnackbar('error', 'Failed to load invoice data. Please check if the invoice exists and try again.');
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

    loadInvoiceData();
  }, [invoiceIdParam, showSnackbar]);

  // Fetch customers first so customer data is available for invoice loading
  useEffect(() => {
    fetchCustomers();
    fetchStaffList();
    fetchMechanics();
    fetchProducts();
    fetchFilterOptions();
  }, []);

  // Convert raw invoice items when filterOptions are loaded - More reliable conversion
  useEffect(() => {
    if (rawInvoiceItems.length > 0 && filterOptions.categories.length > 0) {
      console.log('🔄 Converting raw invoice items to formatted items now that filters are available');
      const convertedItems: ReturnItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: ReturnItem = {
          id: (index + 1).toString(),
          product_id: item.product_id || item.name_of_product || 1,
          product_name: item.name_of_product,
          car_model_ids: item.model_id ? [item.model_id.toString()] : [],
          car_model_names: item.model_id ? [filterOptions.models.find(model => model.id.toString() === item.model_id?.toString())?.name || ''] : [],
          category_id: item.category_id || 0,
          category_name: filterOptions.categories.find(cat => cat.id.toString() === item.category_id?.toString())?.name || '',
          subcategory_id: item.subcategory_id || 0,
          subcategory_name: filterOptions.subcategories.find(sub => sub.id.toString() === item.subcategory_id?.toString())?.name || '',
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
          margin: 0,
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

      console.log('✅ Setting converted invoice items:', convertedItems);
      setSelectedProducts(convertedItems);

      // Clear raw items after successful conversion
      setRawInvoiceItems([]);
    }
  }, [rawInvoiceItems, filterOptions.categories, filterOptions.subcategories, filterOptions.companies, filterOptions.models, products]);

  function populateFormWithInvoiceData(cachedData: any) {
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
      vehicle_number: transportDetails.vehicle_no || '',
      commission: invoiceData.commission ? invoiceData.commission.toString() : '',
      address: invoiceData.address || '',
      transport_name: transportDetails.trans_mode || '',
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
    if (billingDetails?.customer) {
      const customer = billingDetails.customer;
      setSelectedCustomerId(customer.id.toString());
      setSelectedCustomer(customer);
      setCustomerStateForTax(customer.billing_state_code);
      if (customer.billing_state) {
        setFormData(prev => ({
          ...prev,
          state: customer.billing_state,
          gst_number: customer.billing_gstin || ''
        }));
      }
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
      console.log('Storing cached raw invoice items for conversion:', invoiceItems);
      setRawInvoiceItems(invoiceItems);
    }

    // Set loading to false
    setInvoiceNumberLoading(false);
  }

  // Load return reasons
  const loadReturnReasons = () => {
    setReturnReasons([
      { id: 1, reason_name: 'Damaged Product', type: 'sale' },
      { id: 2, reason_name: 'Wrong Item Received', type: 'sale' },
      { id: 3, reason_name: 'Poor Quality', type: 'sale' },
      { id: 4, reason_name: 'Customer Dissatisfaction', type: 'sale' },
      { id: 5, reason_name: 'Size/Color Issue', type: 'sale' }
    ]);
  };

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      } else {
        setCustomers([]);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setCustomers([]);
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

  const handleCustomerSelect = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setSelectedCustomer(customer);
      setCustomerStateForTax(customer.billing_state_code);

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

  const fetchInvoiceForEdit = async (invoiceId: number) => {
    try {
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
        if (invoice.select_customer) {  // API field is select_customer, not customer_id
          setSelectedCustomerId(invoice.select_customer.toString());

          // Find customer in loaded customers list for proper state codes and data
          const existingCustomer = customers.find(c => c.id === invoice.select_customer.toString());
          if (existingCustomer) {
            // Use real customer data from the API
            setSelectedCustomer(existingCustomer);
            setCustomerStateForTax(existingCustomer.billing_state_code );

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

  // Update return quantity
  const updateReturnQuantity = (id: string, quantity: number) => {
    setSelectedProducts(prev =>
      prev.map(item =>
        item.id === id ? {
          ...item,
          return_qty: Math.min(Math.max(quantity, 0), item.qty), // Cannot return more than original qty
          // Recalculate tax for return quantity - proportional to returned amount
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
        invoice_id: editInvoiceId,
        return_date: Math.floor(new Date(returnDate).getTime() / 1000),
        total_amount: totalReturnAmount,
        total_tax: totalReturnTax,
        status: returnStatus,
        notes: returnNotes,
        fy: new Date().getFullYear(),

        // Return items data
        returnItems: itemsBeingReturned.map(item => ({
          invoice_item_id: parseInt(item.id),
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

      const response = await fetch('/api/sale-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        setShowConfirmationModal(false);
        router.push('/entry/salereturn');
        showSnackbar('success', 'Sale return created successfully!');
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
    <div className="space-y-3">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Process Sale Return</h1>
        <p className="text-slate-400">
          Create return for invoice #{formData.invoice_number} - {formData.customer_name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-6">

            {/* Invoice Information with Return Config */}
            <div className="mb-3">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Return Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">ORIGINAL INVOICE NUMBER</label>
                  {invoiceNumberLoading ? (
                    <div className="input w-full flex items-center justify-center bg-slate-700 border border-slate-600 rounded">
                      <Loader className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                      <span className="text-sm text-slate-400">Loading...</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formData.invoice_number}
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      readOnly
                      disabled
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILL REFERENCE</label>
                  <input
                    type="text"
                    value={formData.bill_reference}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">ORIGINAL DATE</label>
                  <input
                    type="text"
                    value={formData.date}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
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
              </div>
            </div>

            {/* Customer Information */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Original Invoice Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CUSTOMER NAME</label>
                  <input
                    type="text"
                    value={formData.customer_name}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER</label>
                  <input
                    type="text"
                    value={formData.contact_number}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={formData.email_id}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">ORIGINAL INVOICE TOTAL</label>
                  <input
                    type="text"
                    value={formData.grand_total}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
              </div>
            </div>

            {/* Return Items Selection */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Return Item Selection</h3>

              {/* Items Table */}
              <div className="border border-slate-600 rounded">
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">PRODUCT NAME</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">ORIGINAL QTY</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">RETURN QTY</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">RATE</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">RETURN REASON</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">RETURN TAX</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-32">RETURN TOTAL</th>
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
                            className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm"
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
                        <td className="px-4 py-3 text-center text-xs text-slate-300">
                          ₹{item.return_qty > 0 ? item.tax.toFixed(2) : '0.00'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-medium text-green-400">
                          ₹{item.return_qty > 0 ? item.total.toFixed(2) : '0.00'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {errors.noReturns && <p className="text-red-400 text-sm mt-2">{errors.noReturns}</p>}
              {errors.invalidQty && <p className="text-red-400 text-sm mt-2">{errors.invalidQty}</p>}
            </div>

            {/* Additional Information */}
            <div className="mb-3 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Return Notes</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">RETURN NOTES</label>
                  <ClearableTextarea
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    rows={3}
                    placeholder="Additional notes for the return"
                  />
                </div>
              </div>
            </div>

            {/* Summary & Payment */}
            {itemsBeingReturned.length > 0 && (
              <div className="border-t border-slate-600 pt-4">
                <h3 className="text-lg font-medium text-slate-200 mb-3">Return Summary</h3>

                {/* Tax Breakdown */}
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Tax Breakdown</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedProducts.reduce((sum, item) => sum + item.cgst, 0).toFixed(2)}
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
                        value={selectedProducts.reduce((sum, item) => sum + item.sgst, 0).toFixed(2)}
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
                        value={selectedProducts.reduce((sum, item) => sum + item.igst, 0).toFixed(2)}
                        readOnly
                        disabled
                        className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                {/* Return Summary */}
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
                      <p className="text-slate-300 text-sm">Return Amount (incl. tax)</p>
                      <p className="text-green-400 font-bold text-lg">₹{totalReturnAmount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          {itemsBeingReturned.length > 0 && (
            <div className="border-t border-slate-600 pt-6 px-6">
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => router.push('/entry/salereturn')}
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
          )}
        </div>
      </form>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Create Sale Return"
        message={`Are you sure you want to create a return for ${itemsBeingReturned.length} items totaling ₹${totalReturnAmount.toFixed(2)}? This will credit the customer account.`}
        confirmText="Create Return"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Creating Return..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />

      {errors.submit && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow-lg">
          {errors.submit}
        </div>
      )}
    </div>
  );
}
