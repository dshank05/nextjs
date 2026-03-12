import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Calculator } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ClearableInput, ClearableTextarea, FileUpload } from '../../components/common';
import { useSnackbar } from '../../components/SnackbarProvider';
import { broadcast } from '../../lib/broadcast';
import SessionStorageService from '../../lib/sessionStorage';
import { useCreateProduct, useUpdateProduct } from '../../hooks/useProducts';

interface ProductFormData {
  product_category: string;
  product_subcategory: string;
  car_models: string[]; // Changed to array for multi-select
  company_id: string;
  part_no: string;
  barcode: string; // Optional barcode field
  min_stock: string;
  opening_stock: string;
  opening_rate: string;
  hsn: string;
  gst_rate: string; // Keep as string, change to input field
  warehouse: string;
  rack_id: string;
  rack_number: string;
  descriptions: string;
  notes: string;
  mrp: string;
  discount: string;
  margin: string; // Changed from sale_price to match API expectations
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function ProductCreate() {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  
  // Mutation hooks
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  // ===== NEW STATE FOR WAREHOUSE AND GST =====
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [gstRates, setGstRates] = useState<any[]>([]);
  const [racks, setRacks] = useState<any[]>([]);
  const [racksLoading, setRacksLoading] = useState(false);
  const [formData, setFormData] = useState<ProductFormData>({
    product_category: '',
    product_subcategory: '',
    car_models: [],
    company_id: '',
    part_no: '',
    barcode: '',
    min_stock: '',
    opening_stock: '',
    opening_rate: '',
    hsn: '',
    gst_rate: '',
    warehouse: '',
    rack_id: '',
    rack_number: '',
    descriptions: '',
    notes: '',
    mrp: '',
    discount: '',
    margin: ''
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [barcodeFile, setBarcodeFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [barcodePreview, setBarcodePreview] = useState<string>('');
  const [existingImageUrl, setExistingImageUrl] = useState<string>('');
  const [existingBarcodeUrl, setExistingBarcodeUrl] = useState<string>('');
  const [isNewImage, setIsNewImage] = useState<boolean>(false);
  const [isNewBarcode, setIsNewBarcode] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  // State for dynamic subcategories
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false);



  // Fetch all options on mount
  useEffect(() => {
    fetchFilterOptions();
    fetchWarehouses();
    fetchGstRates();
  }, []);

  // Check for edit mode and load product data
  useEffect(() => {
    const editId = router.query.edit;
    if (editId && typeof editId === 'string') {
      setIsEditing(true);
      setEditingProductId(parseInt(editId));
      // Load product data immediately without waiting for GST rates
      loadProductForEdit(parseInt(editId));
    }
  }, [router.query.edit, filterOptions]);

  // Fetch subcategories when category changes
  useEffect(() => {
    if (formData.product_category) {
      fetchSubcategories(formData.product_category);
      // Clear subcategory selection when category changes
      setFormData(prev => ({ ...prev, product_subcategory: '' }));
    } else {
      setSubcategories([]);
    }
  }, [formData.product_category]);

  // Fetch racks when warehouse changes
  useEffect(() => {
    if (formData.warehouse) {
      fetchRacks(formData.warehouse);
      // Clear rack selection when warehouse changes
      setFormData(prev => ({ ...prev, rack_id: '' }));
    } else {
      setRacks([]);
    }
  }, [formData.warehouse]);

  // Populate GST rate when GST rates are loaded and HSN is set
  useEffect(() => {
    if (isEditing && gstRates.length > 0 && formData.hsn && !formData.gst_rate) {
      const matchingGstRate = gstRates.find(rate => rate.hsn_code === formData.hsn);
      if (matchingGstRate) {
        setFormData(prev => ({ ...prev, gst_rate: matchingGstRate.id.toString() }));
      }
    }
  }, [gstRates, isEditing, formData.hsn, formData.gst_rate]);



  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };

  const fetchWarehouses = async () => {
    try {
      const response = await fetch('/api/warehouses');
      if (response.ok) {
        const data = await response.json();
        setWarehouses(data.warehouses || []);
      }
    } catch (error) { console.error('Error fetching warehouses:', error); }
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
  // Fetch subcategories based on selected category
  const fetchSubcategories = async (categoryId: string) => {
    if (!categoryId) {
      setSubcategories([]);
      return;
    }

    setSubcategoriesLoading(true);
    try {
      const response = await fetch(`/api/products/subcategories?category_id=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setSubcategories(data.subcategories || []);
      } else {
        setSubcategories([]);
      }
    } catch (error) {
      console.error('Error fetching subcategories:', error);
      setSubcategories([]);
    } finally {
      setSubcategoriesLoading(false);
    }
  };

  // Fetch racks based on selected warehouse
  const fetchRacks = async (warehouseId: string) => {
    if (!warehouseId) {
      setRacks([]);
      return;
    }

    setRacksLoading(true);
    try {
      const response = await fetch(`/api/warehouses/${warehouseId}/racks`);
      if (response.ok) {
        const data = await response.json();
        setRacks(data.racks || []);
      } else {
        setRacks([]);
      }
    } catch (error) {
      console.error('Error fetching racks:', error);
      setRacks([]);
    } finally {
      setRacksLoading(false);
    }
  };

  const handleInputChange = (field: keyof ProductFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }

    // Auto-fill GST rate when HSN is selected, clear when unselected
    if (field === 'hsn') {
      if (value) {
        const selectedGstRate = gstRates.find(rate => rate.hsn_code === value);
        if (selectedGstRate) {
          setFormData(prev => ({ ...prev, gst_rate: selectedGstRate.id.toString() }));
        }
      } else {
        // Clear GST rate when HSN is unselected
        setFormData(prev => ({ ...prev, gst_rate: '' }));
      }
    }
  };

  const handleMultiSelectChange = (field: keyof ProductFormData, values: string[]) => {
    setFormData(prev => ({ ...prev, [field]: values }));
  };



  const calculateTotalAmount = () => {
    const stock = parseFloat(formData.opening_stock) || 0;
    const openingRate = parseFloat(formData.opening_rate) || 0;
    return stock * openingRate;
  };

  const calculateSellingPrice = () => {
    const mrp = parseFloat(formData.mrp) || 0;
    const discount = parseFloat(formData.discount) || 0;
    const margin = parseFloat(formData.margin) || 0;
    return mrp - discount + margin; // SP = MRP - Discount + Margin
  };

  const loadProductForEdit = async (productId: number) => {
    setEditLoading(true);
    try {
      const response = await fetch(`/api/products/${productId}`);
      if (response.ok) {
        const product = await response.json();

        // Find GST rate ID based on HSN code for proper form population
        let gstRateId = '';
        if (product.hsn && gstRates.length > 0) {
          const matchingGstRate = gstRates.find(rate => rate.hsn_code === product.hsn);
          if (matchingGstRate) {
            gstRateId = matchingGstRate.id.toString();
          } else {
            // If no matching GST rate found, try to find one with the same rate percentage
            const rateMatchingGstRate = gstRates.find(rate => rate.rate === product.gst_rate);
            if (rateMatchingGstRate) {
              gstRateId = rateMatchingGstRate.id.toString();
              console.log(`Found GST rate by percentage: HSN "${product.hsn}" -> ${product.gst_rate}%`);
            } else {
              console.warn(`No GST rate found for HSN "${product.hsn}" or rate ${product.gst_rate}`);
            }
          }
        }

        // Populate form with product data
        setFormData({
          product_category: product.product_category_id?.toString() || '',
          product_subcategory: product.product_subcategory_id?.toString() || '',
          car_models: product.car_model_ids ? product.car_model_ids.split(',').map((id: string) => id.trim()) : [],
          company_id: product.company_id?.toString() || '',
          part_no: product.part_no || '',
          barcode: product.barcode || '',
          min_stock: product.min_stock?.toString() || '',
          opening_stock: product.opening_stock?.toString() || '',
          opening_rate: product.opening_rate?.toString() || '',
          hsn: product.hsn || '',
          gst_rate: gstRateId, // Use found GST rate ID
          warehouse: product.warehouse_id?.toString() || '', // Use original FK ID directly
          rack_id: product.rack_id?.toString() || '', // Use original FK ID directly
          rack_number: product.rack_number || '', // Direct text value
          descriptions: product.descriptions || '',
          notes: product.notes || '',
          mrp: product.mrp?.toString() || '',
          discount: product.discount?.toString() || '',
          margin: product.margin?.toString() || '',
        });

        // Set existing images for editing
        if (product.pic) {
          setExistingImageUrl(product.pic); // Set existing image URL
          setImagePreview(product.pic); // Show existing image
          setIsNewImage(false); // Mark as existing
        }
        if (product.barcode) {
          setExistingBarcodeUrl(product.barcode); // Set existing barcode URL
          setBarcodePreview(product.barcode); // Show existing barcode image
          setIsNewBarcode(false); // Mark as existing
        }

        // Load racks for the selected warehouse
        if (product.warehouse_id) {
          fetchRacks(product.warehouse_id.toString());
        }
      }
    } catch (error) {
      console.error('Error loading product for edit:', error);
      showSnackbar('error', 'Failed to load product data for editing');
    } finally {
      setEditLoading(false);
    }
  };

  const generateProductDisplay = () => {
    // For new products, we don't have a UID yet, so we'll show a preview format
    // For editing, we show the actual format with UID
    const uid = isEditing && editingProductId ? editingProductId.toString() : '';
    const carModelName = formData.car_models.length > 0
      ? filterOptions.models.find(m => m.id.toString() === formData.car_models[0])?.name || ''
      : '';
    const categoryName = filterOptions.categories.find(c => c.id.toString() === formData.product_category)?.name || '';
    const subcategoryName = subcategories.find(s => s.id.toString() === formData.product_subcategory)?.subcategory_name || '';
    const companyName = filterOptions.companies.find(c => c.id.toString() === formData.company_id)?.name || '';

    // Build parts array - omit empty optional fields
    const parts = [uid, carModelName, categoryName];
    if (subcategoryName) parts.push(subcategoryName);
    parts.push(companyName);
    if (formData.part_no) parts.push(formData.part_no);

    return parts.join(' ');
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    const displayName = generateProductDisplay();
    if (!displayName.trim()) {
      newErrors.product_category = 'Complete product details are required';
    }
    if (!formData.product_category) {
      newErrors.product_category = 'Category is required';
    }
    if (!formData.company_id) {
      newErrors.company_id = 'Company is required';
    }
    if (!formData.warehouse) {
      newErrors.warehouse = 'Warehouse is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    // Generate display name first
    const displayName = generateProductDisplay();

    // Create FormData payload
    const formDataToSend = new FormData();

    // Add product data as JSON string with file state information
    const productData = {
      product_name: displayName,
      product_category_id: formData.product_category ? parseInt(formData.product_category) : null,
      product_subcategory_id: formData.product_subcategory ? parseInt(formData.product_subcategory) : null,
      car_model_ids: formData.car_models.length > 0 ? formData.car_models.join(',') : null,
      company_id: formData.company_id ? parseInt(formData.company_id) : null,
      part_no: formData.part_no || null,
      min_stock: formData.min_stock ? parseInt(formData.min_stock) : null,
      opening_stock: formData.opening_stock ? parseInt(formData.opening_stock) : null,
      stock: formData.opening_stock ? parseInt(formData.opening_stock) : null,
      opening_rate: formData.opening_rate ? parseFloat(formData.opening_rate) : null,
      hsn: formData.hsn || null,
      warehouse_id: formData.warehouse ? parseInt(formData.warehouse) : null,
      gst_rate_id: formData.gst_rate ? parseInt(formData.gst_rate) : null,
      rack_id: formData.rack_id ? parseInt(formData.rack_id) : null,
      rack_number: formData.rack_id ? racks.find(rack => rack.id.toString() === formData.rack_id)?.rack_number : null,
      descriptions: formData.descriptions || null,
      notes: formData.notes || null,
      mrp: formData.mrp ? parseFloat(formData.mrp) : null,
      discount: formData.discount ? parseFloat(formData.discount) : null,
      margin: formData.margin ? parseFloat(formData.margin) : null,
      fileStates: {
        image: {
          hasNewFile: isNewImage && !!imageFile,
          existingUrl: existingImageUrl || null
        },
        barcode: {
          hasNewFile: isNewBarcode && !!barcodeFile,
          existingUrl: existingBarcodeUrl || null
        }
      }
    };

    formDataToSend.append('productData', JSON.stringify(productData));

    // Only add NEW files
    if (isNewImage && imageFile) formDataToSend.append('image', imageFile);
    if (isNewBarcode && barcodeFile) formDataToSend.append('barcode', barcodeFile);

    if (isEditing && editingProductId) {
      // Update existing product
      updateProduct.mutate(
        { id: editingProductId, formData: formDataToSend },
        {
          onSuccess: (responseData) => {
            showSnackbar('success', 'Product updated successfully!');
            broadcast({
              type: 'updated',
              resource: 'products',
              id: editingProductId
            });
            setShowConfirmModal(false);
            router.push(`/products/view/${editingProductId}`);
          },
          onError: (error: Error) => {
            showSnackbar('error', error.message || 'Failed to update product');
            setShowConfirmModal(false);
          }
        }
      );
    } else {
      // Create new product
      createProduct.mutate(formDataToSend, {
        onSuccess: (responseData) => {
          showSnackbar('success', 'Product created successfully!');
          const createdProductId = responseData.product?.id;
          broadcast({
            type: 'created',
            resource: 'products',
            id: createdProductId,
            data: { name: displayName }
          });
          setShowConfirmModal(false);
          if (createdProductId) {
            router.push(`/products/view/${createdProductId}`);
          } else {
            router.push('/products');
          }
        },
        onError: (error: Error) => {
          showSnackbar('error', error.message || 'Failed to create product');
          setShowConfirmModal(false);
        }
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="card relative">
        {/* Loading overlay for edit mode */}
        {editLoading && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-slate-300 font-medium">Loading product data...</p>
              <p className="text-slate-400 text-sm mt-1">Please wait while we fetch the product details</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          {/* Product Display for Edit Mode */}
          {isEditing && editingProductId && (
            <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 mb-4">
              <div className="text-center">
                <h1 className="text-xl font-bold text-blue-100">
                  {generateProductDisplay()} | UID: {editingProductId}
                </h1>
              </div>
            </div>
          )}

          {/* Row 1: Image and Barcode Upload */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FileUpload
              label="PRODUCT IMAGE"
              accept="image/*"
              maxSize={5}
              value={imageFile}
              previewUrl={imagePreview}
              existingUrl={existingImageUrl}
              onChange={(file, isNew) => {
                setImageFile(file);
                setIsNewImage(isNew);
                if (file) {
                  // New file uploaded
                  const reader = new FileReader();
                  reader.onload = () => setImagePreview(reader.result as string);
                  reader.readAsDataURL(file);
                } else {
                  // File removed - check if it was existing
                  if (existingImageUrl && !isNew) {
                    // User removed existing file - signal deletion
                    setExistingImageUrl(null); // null = delete signal
                  }
                  setImagePreview('');
                }
              }}
              onError={(error) => showSnackbar('error', error)}
              icon="image"
              placeholder="Drop product image here or click to browse"
            />

            <FileUpload
              label="BARCODE IMAGE"
              accept="image/*"
              maxSize={5}
              value={barcodeFile}
              previewUrl={barcodePreview}
              existingUrl={existingBarcodeUrl}
              onChange={(file, isNew) => {
                setBarcodeFile(file);
                setIsNewBarcode(isNew);
                if (file) {
                  // New file uploaded
                  const reader = new FileReader();
                  reader.onload = () => setBarcodePreview(reader.result as string);
                  reader.readAsDataURL(file);
                } else {
                  // File removed - check if it was existing
                  if (existingBarcodeUrl && !isNew) {
                    // User removed existing file - signal deletion
                    setExistingBarcodeUrl(null); // null = delete signal
                  }
                  setBarcodePreview('');
                }
              }}
              onError={(error) => showSnackbar('error', error)}
              icon="barcode"
              placeholder="Drop barcode image here or click to browse"
            />
          </div>

          {/* Hidden Barcode Field - Auto-populated from image scanning */}
          <input
            type="hidden"
            name="barcode"
            value={formData.barcode}
          />

          {/* Product Information - 3 Columns Per Row */}
          <div className="mb-3 space-y-2">
            <div className="space-y-4">
              {/* Row 1: Category | Sub Category | Car Models */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CATEGORY *</label>
                  <SearchableSelect
                    options={filterOptions.categories.map(cat => ({ id: cat.id.toString(), name: cat.name }))}
                    selectedValue={formData.product_category}
                    onSelectionChange={(value) => handleInputChange('product_category', value || '')}
                    placeholder="Select Category"
                  />
                  {errors.product_category && <p className="text-red-400 text-xs mt-1">{errors.product_category}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">SUB CATEGORY</label>
                  <SearchableSelect
                    options={subcategories.map(sub => ({ id: sub.id.toString(), name: sub.subcategory_name }))}
                    selectedValue={formData.product_subcategory}
                    onSelectionChange={(value) => handleInputChange('product_subcategory', value || '')}
                    placeholder={
                      !formData.product_category
                        ? "Please select a category first"
                        : subcategoriesLoading
                          ? "Loading subcategories..."
                          : "Select Sub Category"
                    }
                    disabled={!formData.product_category || subcategoriesLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CAR MODELS</label>
                  <SearchableMultiSelect
                    options={filterOptions.models.map(model => ({ id: model.id.toString(), name: model.name }))}
                    selectedValues={formData.car_models}
                    onSelectionChange={(values) => handleMultiSelectChange('car_models', values)}
                    placeholder="Select car models..."
                    closeOnSelect={false}
                  />
                </div>
              </div>

              {/* Row 2: Company | Part Number | Display Name */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">COMPANY *</label>
                  <SearchableSelect
                    options={filterOptions.companies.map(comp => ({ id: comp.id.toString(), name: comp.name }))}
                    selectedValue={formData.company_id}
                    onSelectionChange={(value) => handleInputChange('company_id', value || '')}
                    placeholder="Select Company"
                  />
                  {errors.company_id && <p className="text-red-400 text-xs mt-1">{errors.company_id}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">PART NUMBER</label>
                  <ClearableInput
                    type="text"
                    value={formData.part_no}
                    onChange={(e) => handleInputChange('part_no', e.target.value)}
                    placeholder="Enter part number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">DISPLAY NAME</label>
                  <input
                    type="text"
                    value={generateProductDisplay() || 'Complete product details to see display name'}
                    className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 4: Pricing */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">MRP</label>
                <ClearableInput
                  type="number"
                  value={formData.mrp}
                  onChange={(e) => handleInputChange('mrp', e.target.value)}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">DISCOUNT</label>
                <ClearableInput
                  type="number"
                  value={formData.discount}
                  onChange={(e) => handleInputChange('discount', e.target.value)}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">MARGIN</label>
                <ClearableInput
                  type="number"
                  value={formData.margin}
                  onChange={(e) => handleInputChange('margin', e.target.value)}
                  placeholder="Profit margin in ₹"
                />
              </div>
            </div>

            {/* Selling Price Display */}
            {/* <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-blue-300 font-medium">SELLING PRICE</span>
                <div className="text-xs text-blue-400 mt-1">
                  Auto-calculated: MRP - Discount + Margin
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-blue-300">
                  ₹{calculateSellingPrice().toFixed(2)}
                </span>
                <div className="text-xs text-blue-400 mt-1">
                  Taxable Value
                </div>
              </div>
            </div>
          </div> */}
          </div>

          {/* Row 5: Location & Tax */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">HSN</label>
                <SearchableSelect
                  options={gstRates.map(rate => ({ id: rate.hsn_code, name: rate.hsn_code }))}
                  selectedValue={formData.hsn}
                  onSelectionChange={(value) => handleInputChange('hsn', value || '')}
                  placeholder="Select HSN Code"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">GST RATE</label>
                <input
                  type="text"
                  value={(() => {
                    const selectedRate = gstRates.find(rate => rate.id.toString() === formData.gst_rate);
                    return selectedRate ? `${selectedRate.rate}%` : '';
                  })()}
                  className="input w-full bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed"
                  placeholder="Auto-filled from HSN"
                  readOnly
                  disabled
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">WAREHOUSE *</label>
                <SearchableSelect
                  options={warehouses.map(warehouse => ({
                    id: warehouse.id.toString(),
                    name: `${warehouse.name} - ${warehouse.location}`
                  }))}
                  selectedValue={formData.warehouse}
                  onSelectionChange={(value) => handleInputChange('warehouse', value || '')}
                  placeholder="Select Warehouse"
                />
                {errors.warehouse && <p className="text-red-400 text-xs mt-1">{errors.warehouse}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">RACK</label>
                <SearchableSelect
                  options={racks.filter(rack => rack.status === 'Active').map(rack => ({
                    id: rack.id.toString(),
                    name: `${rack.rack_number} ${rack.description ? `(${rack.description})` : ''}`
                  }))}
                  selectedValue={formData.rack_id}
                  onSelectionChange={(value) => handleInputChange('rack_id', value || '')}
                  placeholder={
                    !formData.warehouse
                      ? "Please select a warehouse first"
                      : racksLoading
                        ? "Loading racks..."
                        : "Select Rack"
                  }
                  disabled={!formData.warehouse || racksLoading}
                />
              </div>
            </div>
          </div>

          {/* Row 6: Additional Information */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">DESCRIPTIONS</label>
                <ClearableTextarea
                  value={formData.descriptions}
                  onChange={(e) => handleInputChange('descriptions', e.target.value)}
                  rows={3}
                  placeholder="Enter product description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">NOTES</label>
                <ClearableTextarea
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  rows={3}
                  placeholder="Enter additional notes"
                />
              </div>
            </div>
          </div>

          {/* Row 7: Stock & Inventory */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">MINIMUM STOCK</label>
                <ClearableInput
                  type="number"
                  value={formData.min_stock}
                  onChange={(e) => handleInputChange('min_stock', e.target.value)}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">OPENING STOCK</label>
                <ClearableInput
                  type="number"
                  value={formData.opening_stock}
                  onChange={(e) => handleInputChange('opening_stock', e.target.value)}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">OPENING RATE</label>
                <ClearableInput
                  type="number"
                  value={formData.opening_rate}
                  onChange={(e) => handleInputChange('opening_rate', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Total Amount Display */}
          <div className="bg-slate-700 rounded p-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium">TOTAL AMOUNT</span>
              <div className="flex items-center space-x-2">
                <Calculator className="w-4 h-4 text-slate-400" />
                <span className="text-white font-semibold text-lg">
                  ₹{calculateTotalAmount().toFixed(2)}
                </span>
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
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={() => {
                // Clean up sessionStorage on cancel
                if (isEditing && editingProductId) {
                  SessionStorageService.remove('products', editingProductId.toString());
                }
                router.push('/products');
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
              {loading ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Product' : 'Create Product')}
            </button>
          </div>
        </form>
      </div>

      {/* Main Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={isEditing ? "Update Product?" : "Create Product?"}
        message={`Are you sure you want to ${isEditing ? 'update' : 'create'} this product? ${isEditing ? `This will update the existing product with UID: ${editingProductId}.` : 'This action cannot be undone.'}`}
        confirmText={isEditing ? "Update Product" : "Create Product"}
        cancelText="Cancel"
        showLoading={createProduct.isPending || updateProduct.isPending}
        loadingText={isEditing ? "Updating Product..." : "Creating Product..."}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
