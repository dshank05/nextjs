import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Trash2, Calculator, Loader, Edit, Edit2 } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

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

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editPurchaseId, setEditPurchaseId] = useState<number | null>(null);

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
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    gst: '0'
  });

  // State for selected vendor details (fetched on-demand, not stored in formData)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

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


  const [formData, setFormData] = useState<PurchaseFormData>({
    invoice_number: '',
    bill_reference: '',
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
    payment_mode: 1
    // grand_total: '' // @deprecated - calculated field, removed from payload
  });

  // Check for edit mode and fetch data
  useEffect(() => {
    const { edit } = router.query;
    if (edit && typeof edit === 'string') {
      setIsEditMode(true);
      setEditPurchaseId(parseInt(edit));
      fetchPurchaseForEdit(parseInt(edit));
    }
  }, [router.query]);

  // Fetch vendors, staff, and products on mount
  useEffect(() => {
    fetchVendors();
    fetchStaff();
    fetchProducts();
    fetchFilterOptions();
    // Only fetch last invoice number in create mode, not edit mode
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
          subcategory: 0,
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

    const companyId = product.company ? parseInt(product.company) : 0;
    const companyName = companyId > 0
      ? filterOptions.companies.find(comp => comp.id === companyId)?.name || ''
      : '';

    // Initially set car models to unselected
    setProductRowFilters(prev => ({
      ...prev,
      category: product.product_category_id || 0,
      categoryName: categoryName,
      subcategory: product.product_subcategory_id || 0,
      subcategoryName: subcategoryName,
      carModels: [], // Initially unselected
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
        carModels: [], // unselected
        company: companyId,
        companyName: companyName
      }
    });
  };



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

  // Auto-product selection (simplified version - removed as per user request)
  // The user wanted to remove complex auto-selection logic, so this effect is now simplified
  useEffect(() => {
    // Removed complex auto-selection logic - now only side panel autofills filters
    // Manual filter selection doesn't auto-select products anymore
  }, []);

  // Auto-calculate tax totals ONLY when vendor state changes and not in edit mode
  // Don't recalculate existing purchase data, preserve what's in the database
  useEffect(() => {
    // Don't auto-recalculate in edit mode - preserve existing calculations
    if (isEditMode || selectedProducts.length === 0) return;

    // Only recalculate if vendor state actually changed due to vendor selection
    // Check if we need to update tax breakdowns
    const businessState = 'Uttar Pradesh';
    const isIntraState = vendorStateForTax === businessState;

    const needsUpdate = selectedProducts.some(item => {
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
  }, [selectedProducts, vendorStateForTax, isEditMode]);

  // Separate effect to update tax fields from product changes
  // Important: Always runs when products change to ensure tax fields are populated
  useEffect(() => {
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

    // In edit mode, only recalculate if tax fields are empty (first load) or if user has modified products
    // Don't overwrite existing tax values from database during initial edit load
    if (isEditMode && (formData.total_cgst || formData.total_sgst || formData.total_igst)) {
      // Skip recalculation in edit mode if tax fields already have database values
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
  }, [selectedProducts, isEditMode, formData.total_cgst, formData.total_sgst, formData.total_igst]);





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

  const fetchLastInvoiceNumber = async () => {
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
          state: purchase.vendor_gstin ? 'Uttar Pradesh' : '', // Approximate based on GSTIN
          gst_number: purchase.vendor_gstin || '',
          transport_name: purchase.transport || '',
          vehicle_number: purchase.vehicle_number || '',
          transport_cost: purchase.freight?.toString() || '',
          bill: '',
          tax: purchase.total_tax?.toString() || '',
          descriptions: purchase.descriptions || '',
          packing_forwarding_qty: '',
          packing_forwarding_rate: '',
          packing_forwarding_total: '',
          tax_rate: purchase.taxrate?.toString() || '',
          basic_value: purchase.total_taxable_value?.toString() || '',
          total_cgst: purchase.total_cgst?.toString() || '',
          total_sgst: purchase.total_sgst?.toString() || '',
          total_igst: purchase.total_igst?.toString() || '',
          notes: purchase.notes || '',
          total_tax: purchase.total_tax?.toString() || '',
          payment_status: purchase.status || 0,
          payment_mode: purchase.payment_mode || 1,
        });

        // Set vendor data - fetch from vendor table or use data from purchase API
        if (purchase.vendor_id) {
          setSelectedVendorId(purchase.vendor_id.toString());
          setVendorIdToSave(purchase.vendor_id);

          // Try to find vendor in already loaded vendors list, or create from purchase data
          let vendor = vendors.find(v => parseInt(v.id) === purchase.vendor_id);

          // If not found in vendors list, create vendor object from purchase data
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
                car_model: item.car_model || (item.model_id ? `Model ${item.model_id}` : ''),
                category: item.category || `Category ${item.category_id || 'N/A'}`,
                sub_category: item.sub_category || `Subcategory ${item.subcategory_id || 'N/A'}`,
                company: item.company || `Company ${item.company_id || 'N/A'}`,
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
              car_model: item.model_id?.toString() || '', // Store model_id as string for dropdown
              category: item.category_id?.toString() || '', // Store category_id as string for dropdown
              sub_category: item.subcategory_id?.toString() || '', // Store subcategory_id as string for dropdown
              company: item.company_id?.toString() || '', // Store company_id as string for dropdown
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
    let processedValue: string | number = value;

    // Convert numeric fields to numbers
    if (field === 'payment_status' || field === 'payment_mode') {
      processedValue = parseInt(value) || 0;
    }

    setFormData(prev => ({ ...prev, [field]: processedValue }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleVendorSelect = (vendorId: string) => {
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
        total_igst: ''
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

      // Recalculate tax and total
      const subtotal = editingRowData.qty * editingRowData.rate;
      const taxAmount = (subtotal * editingRowData.gst_percentage) / 100;
      const updatedItem = {
        ...editingRowData,
        tax: taxAmount,
        total: subtotal + taxAmount,
        cgst: vendorStateForTax === 'Uttar Pradesh' ? taxAmount / 2 : 0,
        sgst: vendorStateForTax === 'Uttar Pradesh' ? taxAmount / 2 : 0,
        igst: vendorStateForTax !== 'Uttar Pradesh' ? taxAmount : 0
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
      gst: '0'
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
    const transportCost = parseFloat(formData.transport_cost) || 0;

    return subtotal + packingTotal + transportCost + totalTax;
  }, [subtotal, totalTax, formData.packing_forwarding_total, formData.transport_cost]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.invoice_number.trim()) {
      newErrors.invoice_number = 'Invoice number is required';
    }
    if (!selectedVendorId || !selectedVendor) {
      newErrors.vendor_name = 'Please select a vendor';
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
      const submitData = {
        invoice_number: formData.invoice_number,
        bill_reference: formData.bill_reference,
        staff_id: formData.staff_id,
        date: formData.date,
        vendor_id: vendorIdToSave, // Only send vendor relationship ID
        // Removed all vendor detail fields - they're only for UI display
        transport_name: formData.transport_name,
        vehicle_number: formData.vehicle_number,
        transport_cost: parseFloat(formData.transport_cost) || 0,
        // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
        // bill: formData.bill,
        // tax: formData.tax,
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
            category_id: categoryId, // ✅ Now properly parsed from stored string ID
            subcategory_id: subcategoryId, // ✅ Now properly parsed from stored string ID
            company_id: companyId, // ✅ Now properly parsed from stored string ID
            model_id: modelId, // ✅ Now populated from selected car model or looked up from car_model
            car_model: carModelNames || item.car_model || '', // ✅ Car model names for display
            // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
            // hsn: '', // Will be fetched by API from product
            part: item.part_number, // ✅ Use stored part number from item
            qty: item.qty,
            rate: item.rate,
            tax: item.tax,
            total: item.total,
            // ===== EXTRA FIELDS - COMMENTED OUT (FALLBACK NAMES NOT STORED) =====
            // category_name: item.category,
            // subcategory_name: item.sub_category,
            // company_name: item.company
          };
        }),
        descriptions: formData.descriptions,
        packing_forwarding_qty: parseFloat(formData.packing_forwarding_qty) || 0,
        packing_forwarding_rate: parseFloat(formData.packing_forwarding_rate) || 0,
        packing_forwarding_total: parseFloat(formData.packing_forwarding_total) || 0,
        // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
        // tax_rate: parseFloat(formData.tax_rate) || 0,
        // basic_value: parseFloat(formData.basic_value) || 0,
        total_cgst: parseFloat(formData.total_cgst) || 0,
        total_sgst: parseFloat(formData.total_sgst) || 0,
        total_igst: parseFloat(formData.total_igst) || 0,
        notes: formData.notes,
        total_tax: totalTax,
        payment_status: formData.payment_status,
        payment_mode: formData.payment_mode,
        // ===== EXTRA FIELDS - COMMENTED OUT (CALCULATED FIELD NOT STORED) =====
        // grand_total: grandTotal
      };

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
        // Show success snackbar after modal closes and navigate
        showSnackbar('success', `Purchase ${isEditMode ? 'updated' : 'created'} successfully!`);
        router.push('/purchases');
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
              <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice Information</h3>
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">STAFF MEMBER</label>
                  <select
                    value={formData.staff_id || ''}
                    onChange={(e) => handleInputChange('staff_id', e.target.value || null)}
                    className="select w-full"
                  >
                    <option value="">Select Staff</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id.toString()}>
                        {member.name} - {member.phone}
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

            {/* Vendor Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Vendor Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">VENDOR NAME *</label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => {
                      const vendorId = e.target.value;
                      setSelectedVendorId(vendorId);
                      handleVendorSelect(vendorId);
                    }}
                    className="select w-full"
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id.toString()}>{vendor.vendor_name}</option>
                    ))}
                  </select>
                  {errors.vendor_name && <p className="text-red-400 text-xs mt-1">{errors.vendor_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER</label>
                  <input
                    type="text"
                    value={selectedVendor?.contact_no || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={selectedVendor?.email || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={selectedVendor?.tax_id || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">LINE 1</label>
                  <input
                    type="text"
                    value={selectedVendor?.address || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CITY</label>
                  <input
                    type="text"
                    value={selectedVendor?.city || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">STATE</label>
                  <input
                    type="text"
                    value={selectedVendor?.state || ''}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-filled from vendor"
                    readOnly
                    disabled
                  />
                </div>
              </div>
            </div>


            {/* Transport Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Transport Information</h3>
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
                    step="0.01"
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
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-24">
                        RATE
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                        TAX (%)
                      </th>
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
                        {!selectedVendorId && (
                          <p className="text-xs text-amber-400 mt-1">Select a vendor first</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={productRowFilters.category.toString()}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            const selectedOption = filterOptions.categories.find(cat => cat.id === value);
                            setProductRowFilters(prev => ({
                              ...prev,
                              category: value,
                              categoryName: selectedOption?.name || ''
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
                          value={productRowFilters.subcategory.toString()}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            const selectedOption = filteredSubcategories.find(sub => sub.id === value);
                            setProductRowFilters(prev => ({
                              ...prev,
                              subcategory: value,
                              subcategoryName: selectedOption?.name || ''
                            }));
                          }}
                        >
                          <option value="">Select Sub Category</option>
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
                            // For purchase, only allow single car model selection
                            let newSelection: string[];

                            if (values.length === 0) {
                              // Clear selection
                              newSelection = [];
                            } else {
                              // Single selection - take only the first item (most recently selected)
                              // Since SearchableMultiSelect calls onChange after each selection,
                              // we get the array with all selected items, but we only want one
                              newSelection = [values[values.length - 1]]; // Take the last selected item
                            }

                            // Update car models in filters
                            setProductRowFilters(prev => ({
                              ...prev,
                              carModels: newSelection
                            }));

                            // Update the product name directly when car models change
                            if (selectedRowProduct) {
                              if (newSelection.length > 0) {
                                const selectedCarModelId = newSelection[0]; // Use the single selected model
                                const selectedCarModel = filterOptions.models.find(model => model.id.toString() === selectedCarModelId);

                                if (selectedCarModel) {
                                  // Parse product name format: category-subcategory-carModel-company
                                  const productName = selectedRowProduct.product_name;
                                  const parts = productName.split('-');
                                  if (parts.length >= 4) {
                                    // Replace the car model part (index 2) with selected model name
                                    parts[2] = selectedCarModel.name;
                                    const updatedProductName = parts.join('-');

                                    // Update the product's name directly
                                    setSelectedRowProduct(prev => prev ? {
                                      ...prev,
                                      product_name: updatedProductName
                                    } : null);
                                  }
                                }
                              } else {
                                // No car model selected - could reset to original name, but let's keep the current behavior
                                // for now as the original name is still accessible
                              }
                            }
                          }}
                          placeholder="Select car model..."
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={productRowFilters.company.toString()}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            const selectedOption = filterOptions.companies.find(comp => comp.id === value);
                            setProductRowFilters(prev => ({
                              ...prev,
                              company: value,
                              companyName: selectedOption?.name || ''
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
                      <td className="px-4 py-3 text-center w-24">
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
                      <td className="px-4 py-3 text-center w-20">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="0%"
                          value={templateRow.gst}
                          onChange={(e) => {
                            setTemplateRow(prev => ({
                              ...prev,
                              gst: e.target.value
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <div className="px-2 py-2 bg-slate-800 rounded text-xs text-green-400 text-center font-medium">
                          ₹{(() => {
                            const qty = parseFloat(templateRow.qty) || 0;
                            const rate = parseFloat(templateRow.rate) || 0;
                            const gstPercent = parseFloat(templateRow.gst) || 0;
                            const subtotal = qty * rate;
                            const gstAmount = (subtotal * gstPercent) / 100;
                            const total = subtotal + gstAmount;
                            return total.toFixed(2);
                          })()}
                        </div>
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
                              if (productRowFilters.subcategory <= 0) {
                                validationErrors.push('Subcategory is required');
                              }
                              if (productRowFilters.carModels.length === 0) {
                                validationErrors.push('At least one car model is required');
                              }
                              if (productRowFilters.company <= 0) {
                                validationErrors.push('Company is required');
                              }
                              if (!productRowFilters.partNo.trim()) {
                                validationErrors.push('Part number is required');
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
                                  const gstPercent = templateRow.gst !== '0' ? parseFloat(templateRow.gst) : 0;
                                  const subtotal = qty * rate;
                                  const taxAmount = (subtotal * gstPercent) / 100;

                                  // Calculate tax breakdown (assume intra-state for now: CGST + SGST)
                                  const cgst = taxAmount / 2;
                                  const sgst = taxAmount / 2;
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
                                    car_model: carModelNames || '',
                                    category: productRowFilters.category.toString(),
                                    sub_category: productRowFilters.subcategory.toString(),
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

                                  // Reset form (preserve category so subcategories aren't cleared)
                                  setSelectedRowProduct(null);
                                  setProductRowFilters(prev => ({
                                    ...prev,
                                    subcategory: 0,
                                    carModels: [],
                                    partNo: ''
                                  }));
                                  setTemplateRow({
                                    qty: '1',
                                    rate: '',
                                    gst: '0'
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
                                  gst: '0'
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
                          {product.product_name}
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
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.car_model}
                        </td>
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
                                value={editingRowData?.qty || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, qty: parseInt(e.target.value) || 1 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-4 py-3 text-center w-24">
                              <input
                                type="number"
                                step="0.01"
                                value={editingRowData?.rate || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, rate: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-4 py-3 text-center w-20">
                              <input
                                type="number"
                                step="0.01"
                                value={editingRowData?.gst_percentage || ''}
                                onChange={(e) => setEditingRowData(prev => prev ? { ...prev, gst_percentage: parseFloat(e.target.value) || 0 } : null)}
                                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                              />
                            </td>
                            <td className="px-4 py-3 text-center w-20 text-green-400">
                              ₹{editingRowData ? (editingRowData.qty * editingRowData.rate * (1 + editingRowData.gst_percentage / 100)).toFixed(2) : product.total.toFixed(2)}
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
                              ₹{product.rate.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-center text-xs text-slate-200">
                              ₹{product.tax.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-center text-xs font-medium text-slate-200">
                              ₹{product.total.toFixed(2)}
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
                      <tr>
                        <td colSpan={11} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                          SUBTOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-slate-200">
                          ₹{subtotal.toFixed(2)}
                        </td>
                      </tr>
                      <tr className="border-t border-slate-600">
                        <td colSpan={11} className="px-4 py-3"></td>
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
            </div>

            {/* Additional Information */}
            <div className="mb-5 border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Additional Information</h3>
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

            {/* Tax & Payment Information */}
            <div className="border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Tax & Payment Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">TAX</label>
                  <input
                    type="number"
                    step="0.01"
                    value={(formData.total_cgst !== '' || formData.total_sgst !== '' || formData.total_igst !== '')
                      ? (parseFloat(formData.total_cgst) + parseFloat(formData.total_sgst) + parseFloat(formData.total_igst)).toFixed(2)
                      : vendorStateForTax === 'Uttar Pradesh'
                        ? (parseFloat(formData.total_cgst) + parseFloat(formData.total_sgst)).toFixed(2)
                        : formData.total_igst
                    }
                    readOnly
                    disabled
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    placeholder="Auto-calculated tax"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                    <input
                      type="number"
                      step="0.01"
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
                      step="0.01"
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
                      step="0.01"
                      value={formData.total_igst}
                      readOnly
                      disabled
                      className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                      placeholder="Auto-calculated IGST"
                    />
                  </div>
                </div>

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
                      className="p-3 bg-slate-800 border border-slate-700 rounded hover:bg-slate-750 cursor-pointer transition-colors"
                      onClick={() => {
                        handleProductSelection(product);
                        setTemplateRow({
                          qty: '1',
                          rate: product.selling_price?.toString() || '',
                          gst: product.gst_rate_percentage?.toString() || '0'
                        });
                        setIsProductPanelOpen(false);
                        setProductSearchTerm('');
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="text-slate-200 font-bold text-sm">{product.id} - {product.product_name}</h4>
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

      {/* Confirmation Modal for Purchase Submit */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title={isEditMode ? "Update Purchase?" : "Create Purchase?"}
        message={`Are you sure you want to ${isEditMode ? 'update' : 'create'} this purchase for ₹${grandTotal.toFixed(2)}? ${isEditMode ? 'This will update the existing purchase.' : 'This action cannot be undone.'}`}
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
