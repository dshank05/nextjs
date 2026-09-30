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
  // null = the user removed the stored file; '' = there was none.
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>('');
  const [existingBarcodeUrl, setExistingBarcodeUrl] = useState<string | null>('');
  const [isNewImage, setIsNewImage] = useState<boolean>(false);
  const [isNewBarcode, setIsNewBarcode] = useState<boolean>(false);
  const [editLoading, setEditLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  // The `updated_at` this form loaded, sent back on save so the server can tell
  // whether someone else changed the product in the meantime (F-83). null is a
  // real value here - it is what the 602 products that predate the column carry.
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null | undefined>(undefined);

  // Subcategories of the chosen category, from the filter options already
  // loaded (every subcategory, with its category_id). This used to fetch the
  // paginated subcategories endpoint with no limit, so a category's 51st
  // subcategory could not be picked - and on edit a product whose subcategory
  // was past the first 50 lost it from its name (PQ-07).
  const subcategories = filterOptions.subcategories.filter(
    (s: any) => String(s.category_id) === formData.product_category
  );



  // Fetch all options on mount
  useEffect(() => {
    fetchFilterOptions();
    fetchWarehouses();
    fetchGstRates();
  }, []);

  // Check for edit mode and load product data.
  //
  // Keyed on the edit id alone. This also depended on `filterOptions`, which
  // arrives from its own fetch after mount, so the effect ran a second time and
  // re-fetched the product - discarding anything already typed into the form and
  // making a duplicate request every time (F-102). It is also half of F-88: see
  // the cascade note below.
  useEffect(() => {
    const editId = router.query.edit;
    if (editId && typeof editId === 'string') {
      setIsEditing(true);
      setEditingProductId(parseInt(editId));
      // Load product data immediately without waiting for GST rates
      loadProductForEdit(parseInt(editId));
    }
  }, [router.query.edit]);

  // Fetch racks when the warehouse changes. Fetch only: clearing the rack is
  // done in handleInputChange, on the user's own change - a programmatic load
  // for edit is not typing (F-88).
  useEffect(() => {
    if (formData.warehouse) {
      fetchRacks(formData.warehouse);
    } else {
      setRacks([]);
    }
  }, [formData.warehouse]);

  // Show the HSN that the product's own GST rate belongs to, once the rates
  // have loaded.
  //
  // This ran the other way round - it derived gst_rate by matching the HSN
  // string against gst_tax_rate.hsn_code. That is the resolution F-43 removed
  // from the backend and F-76 removed from the load path, and leaving it here
  // meant it could still win a race and re-derive a rate the record already
  // knows. The record's gst_rate_id is the answer; HSN is the field displayed
  // alongside it.
  useEffect(() => {
    if (isEditing && gstRates.length > 0 && formData.gst_rate && !formData.hsn) {
      const currentRate = gstRates.find(rate => rate.id.toString() === formData.gst_rate);
      if (currentRate?.hsn_code) {
        setFormData(prev => ({ ...prev, hsn: currentRate.hsn_code }));
      }
    }
  }, [gstRates, isEditing, formData.gst_rate, formData.hsn]);



  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };

  const fetchWarehouses = async () => {
    try {
      const response = await fetch('/api/warehouses?dropdown=true');
      if (response.ok) {
        const data = await response.json();
        setWarehouses(data.warehouses || []);
      }
    } catch (error) { console.error('Error fetching warehouses:', error); }
  };


  const fetchGstRates = async () => {
    try {
      const response = await fetch('/api/gst-rates?dropdown=true');
      if (response.ok) {
        const data = await response.json();
        setGstRates(data.gstRates || []);
      }
    } catch (error) { console.error('Error fetching GST rates:', error); }
  };

  // Fetch racks based on selected warehouse
  const fetchRacks = async (warehouseId: string) => {
    if (!warehouseId) {
      setRacks([]);
      return;
    }

    setRacksLoading(true);
    try {
      // Every rack of the warehouse; the endpoint pages at 50 by default (PQ-07).
      const response = await fetch(`/api/warehouses/${warehouseId}/racks?limit=1000`);
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
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      // Clearing a dependent selection belongs here, on the user's own change,
      // not in an effect that cannot tell a user's pick from a programmatic
      // load and so wiped the value an edit had just loaded (F-88).
      if (field === 'product_category' && value !== prev.product_category) {
        next.product_subcategory = '';
      }
      if (field === 'warehouse' && value !== prev.warehouse) {
        next.rack_id = '';
      }
      return next;
    });
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

  // calculateSellingPrice() was here. Removed with the commented-out Selling
  // Price panel that was its only caller (F-90). It also disagreed with the
  // server: it computed MRP - discount + margin, while the API derives
  // sale_price from the latest purchase rate (or opening_rate) + margin -
  // discount. Two formulas for one number, one of them unreachable.

  const loadProductForEdit = async (productId: number) => {
    setEditLoading(true);
    try {
      const response = await fetch(`/api/products/${productId}`);
      if (response.ok) {
        const product = await response.json();

        // The product's own gst_rate_id is the answer. Use it.
        //
        // This used to re-derive the rate by matching product.hsn against
        // gst_tax_rate.hsn_code, and only bothered at all if hsn was set. hsn is
        // NULL on every product in the database, so the lookup always failed,
        // the field stayed empty, and saving then wrote gst_rate_id: null -
        // editing a product silently stripped its tax rate (F-76).
        //
        // HSN driving GST is the right interaction for data ENTRY, and it still
        // is (see handleInputChange). It is the wrong way to reload a value the
        // record already holds.
        // Remember what this form loaded, for the conflict check on save (F-83).
        setLoadedUpdatedAt(product.updated_at ?? null);

        let gstRateId = product.gst_rate_id ? product.gst_rate_id.toString() : '';
        let hsnValue = product.hsn || '';

        // If the product carries a rate but no HSN, show the HSN that rate
        // belongs to, so the two fields agree on screen.
        if (gstRateId && !hsnValue && gstRates.length > 0) {
          const currentRate = gstRates.find(rate => rate.id.toString() === gstRateId);
          if (currentRate) hsnValue = currentRate.hsn_code || '';
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
          hsn: hsnValue,
          gst_rate: gstRateId, // the product's own gst_rate_id
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

  // A PREVIEW of the name. The server builds the real one from the ids on every
  // save (PQ-12, lib/product.ts buildProductName) with the same rule: id (once
  // the product exists), every car model, category, subcategory, company, part
  // number. The browser no longer sends a name at all.
  const generateProductDisplay = () => {
    const uid = isEditing && editingProductId ? editingProductId.toString() : '';
    const modelNames = formData.car_models
      .map(id => filterOptions.models.find(m => m.id.toString() === id)?.name)
      .filter(Boolean)
      .join(' / ');
    const categoryName = filterOptions.categories.find(c => c.id.toString() === formData.product_category)?.name || '';
    const subcategoryName = subcategories.find((s: any) => s.id.toString() === formData.product_subcategory)?.name || '';
    const companyName = filterOptions.companies.find(c => c.id.toString() === formData.company_id)?.name || '';

    return [uid, modelNames, categoryName, subcategoryName, companyName, formData.part_no.trim()]
      .filter(Boolean)
      .join(' ');
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

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

  // The real in-flight state, from the mutation hooks.
  //
  // This was a `loading` useState that nothing ever set, so the submit button's
  // disabled attribute and its "Creating.../Updating..." label could never fire
  // and the form's only double-submit guard did nothing (F-103).
  const isSaving = createProduct.isPending || updateProduct.isPending;

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
    // No product_name: the server builds it from the ids (PQ-12).
    const productData = {
      product_category_id: formData.product_category ? parseInt(formData.product_category) : null,
      product_subcategory_id: formData.product_subcategory ? parseInt(formData.product_subcategory) : null,
      car_model_ids: formData.car_models.length > 0 ? formData.car_models.join(',') : null,
      company_id: formData.company_id ? parseInt(formData.company_id) : null,
      part_no: formData.part_no || null,
      min_stock: formData.min_stock ? parseInt(formData.min_stock) : null,
      opening_stock: formData.opening_stock ? parseInt(formData.opening_stock) : null,
      // `stock` is NOT sent. It used to be, set to opening_stock, so saving an
      // edit restored every unit that had been sold (F-75). Stock is derived
      // from purchases, sales and returns; the server owns it and ignores any
      // stock a client sends. On create the server sets it from opening_stock.
      opening_rate: formData.opening_rate ? parseFloat(formData.opening_rate) : null,
      hsn: formData.hsn || null,
      warehouse_id: formData.warehouse ? parseInt(formData.warehouse) : null,
      gst_rate_id: formData.gst_rate ? parseInt(formData.gst_rate) : null,
      rack_id: formData.rack_id ? parseInt(formData.rack_id) : null,
      // rack_number is not sent either - the server derives it from rack_id
      // rather than trusting a string the browser looked up (F-84).
      descriptions: formData.descriptions || null,
      notes: formData.notes || null,
      mrp: formData.mrp ? parseFloat(formData.mrp) : null,
      discount: formData.discount ? parseFloat(formData.discount) : null,
      margin: formData.margin ? parseFloat(formData.margin) : null,
      // The version this edit started from. The server refuses the write with a
      // 409 if the stored row has moved on since (F-83). Only sent when editing,
      // and only when a load actually happened.
      ...(isEditing && loadedUpdatedAt !== undefined ? { updated_at: loadedUpdatedAt } : {}),
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
              existingUrl={existingImageUrl || undefined}
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
              existingUrl={existingBarcodeUrl || undefined}
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
                    options={subcategories.map((sub: any) => ({ id: sub.id.toString(), name: sub.name }))}
                    selectedValue={formData.product_subcategory}
                    onSelectionChange={(value) => handleInputChange('product_subcategory', value || '')}
                    placeholder={
                      !formData.product_category
                        ? "Please select a category first"
                        : "Select Sub Category"
                    }
                    disabled={!formData.product_category}
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

          </div>

          {/* Row 5: Location & Tax */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">HSN</label>
                <SearchableSelect
                  // One option per distinct, non-empty HSN. The code is the option
                  // id, so duplicates or blanks collided in the picker.
                  options={Array.from(new Set(gstRates.map(rate => rate.hsn_code).filter(Boolean)))
                    .map(code => ({ id: code as string, name: code as string }))}
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
                  // Active racks, plus the product's current rack even if it has
                  // since been deactivated - otherwise an edit shows it blank.
                  options={racks.filter(rack => rack.status === 'Active' || rack.id.toString() === formData.rack_id).map(rack => ({
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
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Product' : 'Create Product')}
            </button>
          </div>
        </form>
      </div>

      {/* Main Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={isEditing ? "Update Product?" : "Create Product?"}
        message={`Are you sure you want to ${isEditing ? 'update' : 'create'} this product?${isEditing ? ` This will update the existing product with UID: ${editingProductId}.` : ''}`}
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
