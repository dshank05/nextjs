import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Trash2, Calculator, Loader } from 'lucide-react';
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

  // State for the product selection row filters
  const [productRowFilters, setProductRowFilters] = useState({
    category: '',
    subcategory: '',
    carModels: [] as string[],
    company: '',
    partNo: ''
  });

  // State for dynamic subcategories in filters
  const [filterSubcategories, setFilterSubcategories] = useState<any[]>([]);
  const [filterSubcategoriesLoading, setFilterSubcategoriesLoading] = useState(false);

  // Fetch subcategories for table filters
  const fetchSubcategoriesForTable = async (categoryId: string) => {
    if (!categoryId) {
      setFilterSubcategories([]);
      return;
    }

    setFilterSubcategoriesLoading(true);
    try {
      const response = await fetch(`/api/products/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setFilterSubcategories(data.subcategories || []);
      } else {
        setFilterSubcategories([]);
      }
    } catch (error) {
      console.error('Error fetching subcategories for table:', error);
      setFilterSubcategories([]);
    } finally {
      setFilterSubcategoriesLoading(false);
    }
  };

  // Populate filters from existing purchase items (for edit mode)
  const populateFiltersFromPurchaseItems = async (items: PurchaseItem[]) => {
    if (items.length === 0) return;

    // Extract unique category names from items
    const uniqueCategories = Array.from(new Set(items.map(item => item.category).filter(Boolean)));

    // Map category names to IDs from filterOptions
    const categoryMappings = uniqueCategories.map(categoryName => {
      const matchingCategory = filterOptions.categories.find(cat =>
        cat.name.toLowerCase() === categoryName.toLowerCase()
      );
      return matchingCategory ? { name: categoryName, id: matchingCategory.id.toString() } : null;
    }).filter(Boolean);

    // If we found category mappings, set up the filters in cascading order
    if (categoryMappings.length > 0) {
      // Set the first category (most common case)
      const firstCategoryId = categoryMappings[0].id;
      setProductRowFilters(prev => ({
        ...prev,
        category: firstCategoryId
      }));

      // Fetch subcategories for this category
      await fetchSubcategoriesForTable(firstCategoryId);

      // After fetching subcategories, map subcategory names to IDs
      setTimeout(() => {
        const subcategoryMappings = items.map(item => {
          const matchingSubcategory = filterSubcategories.find(sub =>
            sub.subcategory_name.toLowerCase() === item.sub_category?.toLowerCase()
          );
          return matchingSubcategory ? matchingSubcategory.id.toString() : '';
        }).filter(Boolean);

        // Set subcategory if found
        if (subcategoryMappings.length > 0) {
          setProductRowFilters(prev => ({
            ...prev,
            subcategory: subcategoryMappings[0]
          }));
        }

        // Extract car models (they are stored as comma-separated names in items)
        const allCarModelNames = items
          .flatMap(item => item.car_model?.split(',').map(name => name.trim()) || [])
          .filter(Boolean)
          .filter((value, index, self) => self.indexOf(value) === index); // unique

        // Map car model names to IDs
        const carModelIds = allCarModelNames.map(modelName => {
          const matchingModel = filterOptions.models.find(model =>
            model.name.toLowerCase() === modelName.toLowerCase()
          );
          return matchingModel ? matchingModel.id.toString() : null;
        }).filter(Boolean) as string[];

        // Extract unique companies
        const uniqueCompanies = Array.from(new Set(items.map(item => item.company).filter(Boolean)));
        const companyMappings = uniqueCompanies.map(companyName => {
          const matchingCompany = filterOptions.companies.find(comp =>
            comp.name.toLowerCase() === companyName.toLowerCase()
          );
          return matchingCompany ? matchingCompany.id.toString() : '';
        }).filter(Boolean);

        // Extract unique part numbers
        const uniquePartNumbers = Array.from(new Set(items.map(item => item.part_number).filter(Boolean)));

        // Update filters with mapped values
        setProductRowFilters(prev => ({
          ...prev,
          carModels: carModelIds,
          company: companyMappings.length > 0 ? companyMappings[0] : '',
          partNo: uniquePartNumbers.length > 0 ? uniquePartNumbers[0] : ''
        }));
      }, 100); // Small delay to ensure subcategories are loaded
    }
  };

  // State for selected product in the table row
  const [selectedRowProduct, setSelectedRowProduct] = useState<Product | null>(null);

  // State for product selection side panel
  const [isProductPanelOpen, setIsProductPanelOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    tax: '0'
  });

  // State for selected vendor details (fetched on-demand, not stored in formData)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

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

  // Fetch subcategories for table filters when category changes
  useEffect(() => {
    fetchSubcategoriesForTable(productRowFilters.category);
  }, [productRowFilters.category]);

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
          vehicle_number: '',
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
              car_model: item.car_model || (item.model_id ? `Model ${item.model_id}` : ''),
              category: item.category || '',
              sub_category: item.sub_category || '',
              company: item.company || (item.company_id ? `Company ${item.company_id}` : ''),
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

          // Cascade populate filters from existing purchase items
          await populateFiltersFromPurchaseItems(convertedItems);

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
        bill: formData.bill,
        tax: formData.tax,
        items: selectedProducts.map(item => {
          // Map category name to ID
          const categoryMatch = memoizedFilterOptions.categories.find(cat =>
            cat.name.toLowerCase() === item.category?.toLowerCase()
          );
          const categoryId = categoryMatch ? categoryMatch.id : null;

          // Map company name to ID
          const companyMatch = memoizedFilterOptions.companies.find(comp =>
            comp.name.toLowerCase() === item.company?.toLowerCase()
          );
          const companyId = companyMatch ? companyMatch.id : null;

          return {
            product_id: item.product_id,
            product_name: item.product_name,
            category_id: categoryId,
            subcategory_id: null, // Will be handled by API using category_id + subcategory name
            company_id: companyId,
            car_model: item.car_model, // Keep as string for now
            hsn: '', // Will be fetched by API from product
            part: item.part_number,
            qty: item.qty,
            rate: item.rate,
            tax: item.tax,
            total: item.total,
            // Include original string names for API to use as fallback
            category_name: item.category,
            subcategory_name: item.sub_category,
            company_name: item.company
          };
        }),
        descriptions: formData.descriptions,
        packing_forwarding_qty: parseFloat(formData.packing_forwarding_qty) || 0,
        packing_forwarding_rate: parseFloat(formData.packing_forwarding_rate) || 0,
        packing_forwarding_total: parseFloat(formData.packing_forwarding_total) || 0,
        tax_rate: parseFloat(formData.tax_rate) || 0,
        basic_value: parseFloat(formData.basic_value) || 0,
        total_cgst: parseFloat(formData.total_cgst) || 0,
        total_sgst: parseFloat(formData.total_sgst) || 0,
        total_igst: parseFloat(formData.total_igst) || 0,
        notes: formData.notes,
        total_tax: totalTax,
        payment_status: formData.payment_status,
        payment_mode: formData.payment_mode,
        grand_total: grandTotal
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
    <div className="space-y-6">

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Single Mega Card with All Sections */}
        <div className="card">
          <div className="p-6">

            {/* Invoice Information */}
            <div className="mb-10">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Invoice Information</h3>
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
            <div className="mb-10 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Vendor Information</h3>
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
            <div className="mb-10 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Transport Information</h3>
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
            <div className="mb-10 border-t border-slate-600 pt-8">
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
                          disabled={!productRowFilters.category || filterSubcategoriesLoading}
                        >
                          <option value="">
                            {!productRowFilters.category
                              ? "Please select a category first"
                              : filterSubcategoriesLoading
                                ? "Loading subcategories..."
                                : "Select Sub Category"
                            }
                          </option>
                          {filterSubcategories.map((sub) => (
                            <option key={sub.id} value={sub.id}>{sub.subcategory_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <SearchableMultiSelect
                          options={filterOptions.models.map(model => ({ id: model.id.toString(), name: model.name }))}
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
                          value={templateRow.tax}
                          onChange={(e) => {
                            setTemplateRow(prev => ({
                              ...prev,
                              tax: e.target.value
                            }));
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-center w-20">
                        <div className="px-2 py-2 bg-slate-800 rounded text-xs text-green-400 text-center font-medium">
                          ₹{(() => {
                            const qty = parseFloat(templateRow.qty) || 0;
                            const rate = parseFloat(templateRow.rate) || 0;
                            const taxPercent = parseFloat(templateRow.tax) || 0;
                            const subtotal = qty * rate;
                            const taxAmount = (subtotal * taxPercent) / 100;
                            const total = subtotal + taxAmount;
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
                                // Use product details and template values
                                const qty = parseFloat(templateRow.qty) || 1;
                                const rate = parseFloat(templateRow.rate) || selectedProduct.selling_price || 0;
                                const taxPercent = templateRow.tax !== '0' ? parseFloat(templateRow.tax) : 0;
                                const subtotal = qty * rate;
                                const taxAmount = (subtotal * taxPercent) / 100;

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

                                const newItem: PurchaseItem = {
                                  id: Date.now().toString(),
                                  product_id: selectedProduct.id,
                                  product_name: selectedProduct.product_name,
                                  car_model: carModelNames || '',
                                  category: filterOptions.categories.find(c => c.id.toString() === productRowFilters.category)?.name || '',
                                  sub_category: filterOptions.subcategories.find(s => s.id.toString() === productRowFilters.subcategory)?.name || '',
                                  company: filterOptions.companies.find(c => c.id.toString() === productRowFilters.company)?.name || '',
                                  part_number: productRowFilters.partNo,
                                  qty: qty,
                                  rate: rate,
                                  gst_percentage: taxPercent,
                                  tax: taxAmount,
                                  cgst: cgst,
                                  sgst: sgst,
                                  igst: igst,
                                  total: subtotal + taxAmount
                                };

                                setSelectedProducts(prev => [...prev, newItem]);

                                // Reset form
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
                                  rate: '',
                                  tax: '0'
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
                      <tr key={product.id} className="bg-slate-800 hover:bg-slate-750 border-t border-slate-600">
                        <td className="px-4 py-3 text-center text-xs text-slate-300">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.product_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.category}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.sub_category}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.car_model || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.company}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-200">
                          {product.part_number || 'N/A'}
                        </td>
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
                        <td colSpan={9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right text-xs font-medium text-slate-200 uppercase tracking-wider">
                          SUBTOTAL
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold text-slate-200" colSpan={2}>
                          ₹{subtotal.toFixed(2)}
                        </td>
                      </tr>
                      <tr className="border-t border-slate-600">
                        <td colSpan={9} className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right" colSpan={3}>
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
            <div className="mb-10 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Additional Information</h3>
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
            <div className="border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Tax & Payment Information</h3>
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
                      onClick={async () => {
                        setSelectedRowProduct(product);

                        // Set category first
                        const categoryId = product.product_category_id ? product.product_category_id.toString() : '';
                        setProductRowFilters(prev => ({
                          ...prev,
                          category: categoryId
                        }));

                        // If category exists, fetch subcategories and wait for completion
                        if (categoryId) {
                          await fetchSubcategoriesForTable(categoryId);

                          // Now set subcategory after subcategories are loaded
                          const subcategoryId = product.product_subcategory_id ? product.product_subcategory_id.toString() : '';
                          setProductRowFilters(prev => ({
                            ...prev,
                            subcategory: subcategoryId,
                            carModels: product.car_model_ids ? product.car_model_ids.split(',').map(id => id.trim()) : [],
                            company: product.company || '',
                            partNo: product.part_no || ''
                          }));
                        } else {
                          // No category, just set the rest
                          setProductRowFilters(prev => ({
                            ...prev,
                            subcategory: '',
                            carModels: product.car_model_ids ? product.car_model_ids.split(',').map(id => id.trim()) : [],
                            company: product.company || '',
                            partNo: product.part_no || ''
                          }));
                        }

                        setTemplateRow({
                          qty: '1',
                          rate: '0',
                          tax: '0'
                        });

                        // Close panel and reset search
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

      {/* Confirmation Modal */}
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
    </div>

  );
}
