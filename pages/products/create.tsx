import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Upload, Calculator, ChevronDown, X, Check } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';

interface ProductFormData {
  product_category: string;
  product_subcategory: string;
  car_models: string[]; // Changed to array for multi-select
  company_id: string;
  part_no: string;
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
  const [imagePreview, setImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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
    try {
      const response = await fetch(`/api/products/${productId}`);
      if (response.ok) {
        const product = await response.json();

        // Populate form with product data

        setFormData({
          product_category: product.product_category_id?.toString() || '',
          product_subcategory: product.product_subcategory_id?.toString() || '',
          car_models: product.car_model_ids ? product.car_model_ids.split(',').map((id: string) => id.trim()) : [],
          company_id: product.company_id?.toString() || '',
          part_no: product.part_no || '',
          min_stock: product.min_stock?.toString() || '',
          opening_stock: product.opening_stock?.toString() || '',
          opening_rate: product.opening_rate?.toString() || '',
          hsn: product.hsn || '',
          gst_rate: product.gst_rate || '',
          warehouse: product.warehouse_id?.toString() || '', // Use original FK ID directly
          rack_id: product.rack_id?.toString() || '', // Use original FK ID directly
          rack_number: product.rack_number || '', // Direct text value
          descriptions: product.descriptions || '',
          notes: product.notes || '',
          mrp: product.mrp?.toString() || '',
          discount: product.discount?.toString() || '',
          margin: product.margin?.toString() || '',
        });

        // Load racks for the selected warehouse
        if (product.warehouse_id) {
          fetchRacks(product.warehouse_id.toString());
        }
      }
    } catch (error) {
      console.error('Error loading product for edit:', error);
    }
  };

  const generateProductDisplay = () => {
    const category = filterOptions.categories.find(c => c.id.toString() === formData.product_category)?.name || '';
    const subcategory = subcategories.find(s => s.id.toString() === formData.product_subcategory)?.subcategory_name || '';
    const company = filterOptions.companies.find(c => c.id.toString() === formData.company_id)?.name || '';

    // Get first selected car model name
    const firstCarModelId = formData.car_models.length > 0 ? formData.car_models[0] : '';
    const firstCarModel = filterOptions.models.find(m => m.id.toString() === firstCarModelId)?.name || '';

    const displayName = `${category}-${subcategory}-${firstCarModel}-${company}`.trim();
    const cleanDisplayName = displayName
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .trim();

    return cleanDisplayName;
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
    // Don't close modal immediately - wait for API completion
    // setShowConfirmModal(false); // Remove this line
    if (isSaving) return;

    setIsSaving(true);

    try {
      // Generate display name first
      const displayName = generateProductDisplay();


      // Use foreign key IDs instead of names
      const submitData = {
        product_name: displayName,
        product_category_id: formData.product_category ? parseInt(formData.product_category) : null,
        product_subcategory_id: formData.product_subcategory ? parseInt(formData.product_subcategory) : null,
        car_model_ids: formData.car_models.length > 0 ? formData.car_models.join(',') : null, // Comma-separated IDs
        company_id: formData.company_id ? parseInt(formData.company_id) : null, // Company should be FK to product_company table
        part_no: formData.part_no || null,
        min_stock: formData.min_stock ? parseInt(formData.min_stock) : null,
        opening_stock: formData.opening_stock ? parseInt(formData.opening_stock) : null,
        stock: formData.opening_stock ? parseInt(formData.opening_stock) : null, // Set initial stock = opening_stock
        opening_rate: formData.opening_rate ? parseFloat(formData.opening_rate) : null,
        hsn: formData.hsn || null,

        // ===== NEW FK FIELDS =====
        warehouse_id: formData.warehouse ? parseInt(formData.warehouse) : null,
        gst_rate_id: formData.gst_rate ? parseInt(formData.gst_rate) : null,

        rack_id: formData.rack_id ? parseInt(formData.rack_id) : null,
        rack_number: formData.rack_id ? racks.find(rack => rack.id.toString() === formData.rack_id)?.rack_number : null,
        descriptions: formData.descriptions || null,
        notes: formData.notes || null,
        mrp: formData.mrp ? parseFloat(formData.mrp) : null,
        discount: formData.discount ? parseFloat(formData.discount) : null,
        margin: formData.margin ? parseFloat(formData.margin) : null,
      };


      const url = isEditing && editingProductId ? `/api/products/${editingProductId}` : '/api/products';
      const method = isEditing && editingProductId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      const responseData = await response.json();

      if (response.ok) {
        const action = isEditing ? 'updated' : 'created';
        showSnackbar('success', `Product ${action} successfully!`);
        setShowConfirmModal(false);

        // Close the current tab only if we opened it as a new tab for creation
        // Don't close if we were navigated to editing from within the app
        if (typeof window !== 'undefined' && !isEditing && window.opener) {
          router.push('/products');
          setTimeout(() => window.close(), 100); // Small delay to let navigation happen first
        } else {
          router.push(isEditing ? `/products/view/${editingProductId}` : '/products');
        }
      } else {
        console.error('API Error:', responseData);
        const action = isEditing ? 'update' : 'create';
        showSnackbar('error', responseData.message || `Failed to ${action} product`);
        setShowConfirmModal(false); // Close modal on error too
      }
    } catch (error) {
      console.error('Network error:', error);
      showSnackbar('error', 'Network error occurred');
      setShowConfirmModal(false); // Close modal on network error
    } finally {
      setIsSaving(false); // Reset loading state regardless of success/failure
    }
  };

  return (
    <div className="space-y-3">
      <div className="card">
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
        {/* Row 1: Image and Product Name */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">IMAGE</label>
              <div className="border-2 border-dashed border-slate-600 rounded-lg p-4 text-center">
                {imagePreview ? (
                  <div className="space-y-2">
                    <img src={imagePreview} alt="Preview" className="w-32 h-32 object-cover rounded mx-auto" />
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview('');
                      }}
                      className="text-red-400 text-sm hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 text-slate-400 mx-auto" />
                    <div className="text-slate-400 text-sm">Click to upload image</div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                      id="image-upload"
                    />
                    <label
                      htmlFor="image-upload"
                      className="text-blue-400 hover:text-blue-300 cursor-pointer text-sm"
                    >
                      Browse files
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">DISPLAY OF PRODUCT NAME</label>
              <div className="bg-slate-700 rounded p-3 text-sm text-slate-300 min-h-20">
                {generateProductDisplay() || 'Complete product details to see display name'}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Basic Product Information */}
        <div className="mb-3 space-y-2">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">Product Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                className={!formData.product_category || subcategoriesLoading ? "opacity-50 cursor-not-allowed" : ""}
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
              <input
                type="text"
                value={formData.part_no}
                onChange={(e) => handleInputChange('part_no', e.target.value)}
                className="input w-full"
                placeholder="Enter part number"
              />
            </div>
          </div>
        </div>

        {/* Row 4: Pricing */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">Pricing</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">MRP</label>
              <input
                type="number"
                step="0.01"
                value={formData.mrp}
                onChange={(e) => handleInputChange('mrp', e.target.value)}
                className="input w-full"
                placeholder="0.00"
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

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">MARGIN</label>
              <input
                type="number"
                step="0.01"
                value={formData.margin}
                onChange={(e) => handleInputChange('margin', e.target.value)}
                className="input w-full"
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
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">Location & Tax</h3>
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
                className={!formData.warehouse || racksLoading ? "opacity-50 cursor-not-allowed" : ""}
              />
            </div>
          </div>
        </div>

        {/* Row 6: Additional Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">Additional Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">DESCRIPTIONS</label>
              <textarea
                value={formData.descriptions}
                onChange={(e) => handleInputChange('descriptions', e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="Enter product description"
              />
            </div>

            <div>
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

        {/* Row 7: Stock & Inventory */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">Stock & Inventory</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">MINIMUM STOCK</label>
              <input
                type="number"
                value={formData.min_stock}
                onChange={(e) => handleInputChange('min_stock', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">OPENING STOCK</label>
              <input
                type="number"
                value={formData.opening_stock}
                onChange={(e) => handleInputChange('opening_stock', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">OPENING RATE</label>
              <input
                type="number"
                step="0.01"
                value={formData.opening_rate}
                onChange={(e) => handleInputChange('opening_rate', e.target.value)}
                className="input w-full"
                placeholder="0.00"
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
      message={`Are you sure you want to ${isEditing ? 'update' : 'create'} this product? ${isEditing ? 'This will update the existing product.' : 'This action cannot be undone.'}`}
      confirmText={isEditing ? "Update Product" : "Create Product"}
      cancelText="Cancel"
      showLoading={isSaving}
      loadingText={isEditing ? "Updating Product..." : "Creating Product..."}
      onConfirm={handleConfirmSubmit}
      onCancel={() => setShowConfirmModal(false)}
    />

    </div>
  );
}
