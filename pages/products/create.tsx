import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Upload, Calculator, ChevronDown, X, Check } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';

interface ProductFormData {
  product_name: string;
  product_category: string;
  product_subcategory: string;
  car_models: string[]; // Changed to array for multi-select
  company: string;
  part_no: string;
  min_stock: string;
  stock: string;
  rate: string;
  hsn: string;
  gst_rate: string; // Keep as string, change to input field
  warehouse: string;
  rack_number: string;
  descriptions: string;
  notes: string;
  mrp: string;
  discount: string;
  sale_price: string;
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function ProductCreate() {
  const router = useRouter();
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });
  const [formData, setFormData] = useState<ProductFormData>({
    product_name: '',
    product_category: '',
    product_subcategory: '',
    car_models: [],
    company: '',
    part_no: '',
    min_stock: '',
    stock: '',
    rate: '',
    hsn: '',
    gst_rate: '',
    warehouse: '',
    rack_number: '',
    descriptions: '',
    notes: '',
    mrp: '',
    discount: '',
    sale_price: ''
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Multi-select state for car models
  const [isModelsDropdownOpen, setIsModelsDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const modelsDropdownRef = useRef<HTMLDivElement>(null);

  // Confirmation modal state for car models
  const [showCarModelsConfirmModal, setShowCarModelsConfirmModal] = useState(false);
  const [pendingCarModelsData, setPendingCarModelsData] = useState<string[] | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelsDropdownRef.current && !modelsDropdownRef.current.contains(event.target as Node)) {
        setIsModelsDropdownOpen(false);
        setModelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);



  // Fetch filter options on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Auto-generate product name from display name
  useEffect(() => {
    const category = filterOptions.categories.find(c => c.id.toString() === formData.product_category)?.name || '';
    const subcategory = filterOptions.subcategories.find(s => s.id.toString() === formData.product_subcategory)?.name || '';
    const company = filterOptions.companies.find(c => c.id.toString() === formData.company)?.name || '';
    
    // Get first selected car model name
    const firstCarModelId = formData.car_models.length > 0 ? formData.car_models[0] : '';
    const firstCarModel = filterOptions.models.find(m => m.id.toString() === firstCarModelId)?.name || '';

    const displayName = `${category}-${subcategory}-${firstCarModel}-${company}`.trim();
    const cleanDisplayName = displayName
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .trim();

    if (cleanDisplayName && cleanDisplayName !== formData.product_name) {
      setFormData(prev => ({ ...prev, product_name: cleanDisplayName }));
    }
  }, [formData.product_category, formData.product_subcategory, formData.company, formData.car_models, filterOptions]);

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters');
      if (response.ok) setFilterOptions(await response.json());
    } catch (error) { console.error('Error fetching filter options:', error); }
  };

  const handleInputChange = (field: keyof ProductFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
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
    const stock = parseFloat(formData.stock) || 0;
    const rate = parseFloat(formData.rate) || 0;
    return stock * rate;
  };

  const generateProductDisplay = () => {
    const category = filterOptions.categories.find(c => c.id.toString() === formData.product_category)?.name || '';
    const subcategory = filterOptions.subcategories.find(s => s.id.toString() === formData.product_subcategory)?.name || '';
    const company = filterOptions.companies.find(c => c.id.toString() === formData.company)?.name || '';

    // Get first selected car model name
    const firstCarModelId = formData.car_models.length > 0 ? formData.car_models[0] : '';
    const firstCarModel = filterOptions.models.find(m => m.id.toString() === firstCarModelId)?.name || '';

    const displayName = `${category}-${subcategory}-${firstCarModel}-${company}`.trim();
    const cleanDisplayName = displayName
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .trim();

    // Update formData.product_name whenever display is generated
    if (cleanDisplayName && cleanDisplayName !== formData.product_name) {
      setFormData(prev => ({ ...prev, product_name: cleanDisplayName }));
    }

    return cleanDisplayName;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.product_name.trim()) {
      newErrors.product_name = 'Product name is required';
    }
    if (!formData.product_category) {
      newErrors.product_category = 'Category is required';
    }
    if (!formData.company) {
      newErrors.company = 'Company is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Show confirmation modal if car models are selected
    if (formData.car_models.length > 0) {
      setPendingCarModelsData(formData.car_models);
      setShowCarModelsConfirmModal(true);
      return;
    }

    // Proceed with submission if no car models selected
    await handleConfirmSubmit();
  };

  const handleConfirmSubmit = async () => {
    if (isSaving) return;

    setIsSaving(true);

    try {
      // Log form data to verify all fields are being sent
      console.log('Submitting form data:', {
        product_name: formData.product_name,
        product_category_id: formData.product_category ? parseInt(formData.product_category) : null,
        product_subcategory_id: formData.product_subcategory ? parseInt(formData.product_subcategory) : null,
        car_models: formData.car_models, // Array of selected model IDs
        car_model_ids: formData.car_models.length > 0 ? formData.car_models.join(',') : null, // Comma-separated
        company: formData.company ? parseInt(formData.company) : null,
        part_no: formData.part_no,
        min_stock: formData.min_stock ? parseInt(formData.min_stock) : null,
        stock: formData.stock ? parseInt(formData.stock) : null,
        rate: formData.rate ? parseFloat(formData.rate) : null,
        hsn: formData.hsn,
        gst_rate: formData.gst_rate,
        warehouse: formData.warehouse,
        rack_number: formData.rack_number,
        descriptions: formData.descriptions,
        notes: formData.notes,
        mrp: formData.mrp ? parseFloat(formData.mrp) : null,
        discount: formData.discount ? parseFloat(formData.discount) : null,
        sale_price: formData.sale_price ? parseFloat(formData.sale_price) : null,
      });

      // Generate display name
      const displayName = generateProductDisplay();

      // Use foreign key IDs instead of names
      const submitData = {
        display_name: displayName,
        product_category_id: formData.product_category ? parseInt(formData.product_category) : null,
        product_subcategory_id: formData.product_subcategory ? parseInt(formData.product_subcategory) : null,
        car_model_ids: formData.car_models.length > 0 ? formData.car_models.join(',') : null, // Comma-separated IDs
        company: formData.company ? parseInt(formData.company) : null, // Company should be FK to product_company table
        part_no: formData.part_no || null,
        min_stock: formData.min_stock ? parseInt(formData.min_stock) : null,
        stock: formData.stock ? parseInt(formData.stock) : null,
        rate: formData.rate ? parseFloat(formData.rate) : null,
        hsn: formData.hsn || null,
        gst_rate: formData.gst_rate || null,
        warehouse: formData.warehouse || null,
        rack_number: formData.rack_number || null,
        descriptions: formData.descriptions || null,
        notes: formData.notes || null,
        mrp: formData.mrp ? parseFloat(formData.mrp) : null,
        discount: formData.discount ? parseFloat(formData.discount) : null,
        margin: formData.sale_price ? parseFloat(formData.sale_price) : null, // Changed from sale_price to margin
      };

      console.log('Submitting data to API:', submitData);

      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      console.log('API Response status:', response.status);
      const responseData = await response.json();
      console.log('API Response data:', responseData);

      if (response.ok) {
        console.log('Product created successfully');
        router.push('/products'); // Redirect to products page after success
      } else {
        console.error('API Error:', responseData);
        setErrors({ submit: responseData.message || 'Failed to create product' });
      }
    } catch (error) {
      console.error('Network error:', error);
      setErrors({ submit: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">📦 Product Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">CATEGORY *</label>
              <select
                value={formData.product_category}
                onChange={(e) => handleInputChange('product_category', e.target.value)}
                className="select w-full"
              >
                <option value="">Select Category</option>
                {filterOptions.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              {errors.product_category && <p className="text-red-400 text-xs mt-1">{errors.product_category}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">SUB CATEGORY</label>
              <select
                value={formData.product_subcategory}
                onChange={(e) => handleInputChange('product_subcategory', e.target.value)}
                className="select w-full"
              >
                <option value="">Select Sub Category</option>
                {filterOptions.subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>{sub.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">COMPANY *</label>
              <select
                value={formData.company}
                onChange={(e) => handleInputChange('company', e.target.value)}
                className="select w-full"
              >
                <option value="">Select Company</option>
                {filterOptions.companies.map((comp) => (
                  <option key={comp.id} value={comp.id}>{comp.name}</option>
                ))}
              </select>
              {errors.company && <p className="text-red-400 text-xs mt-1">{errors.company}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">CAR MODELS</label>
              <SearchableMultiSelect
                options={filterOptions.models.map(model => ({ id: model.id.toString(), name: model.name }))}
                selectedValues={formData.car_models}
                onSelectionChange={(values) => handleMultiSelectChange('car_models', values)}
                placeholder="Select car models..."
              />
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
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">💰 Pricing</h3>
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
                value={formData.sale_price}
                onChange={(e) => handleInputChange('sale_price', e.target.value)}
                className="input w-full"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        {/* Row 5: Location & Tax */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">🏢 Location & Tax</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">HSN</label>
              <input
                type="text"
                value={formData.hsn}
                onChange={(e) => handleInputChange('hsn', e.target.value)}
                className="input w-full"
                placeholder="Enter HSN code"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">GST RATE (%)</label>
              <input
                type="number"
                step="0.01"
                value={formData.gst_rate}
                onChange={(e) => handleInputChange('gst_rate', e.target.value)}
                className="input w-full"
                placeholder="Enter GST rate (e.g., 18.00)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">WARE HOUSE</label>
              <input
                type="text"
                value={formData.warehouse}
                onChange={(e) => handleInputChange('warehouse', e.target.value)}
                className="input w-full"
                placeholder="Enter warehouse"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">RACK NUMBER</label>
              <input
                type="text"
                value={formData.rack_number}
                onChange={(e) => handleInputChange('rack_number', e.target.value)}
                className="input w-full"
                placeholder="Enter rack number"
              />
            </div>
          </div>
        </div>

        {/* Row 6: Additional Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">� Additional Information</h3>
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
          <h3 className="text-lg font-medium text-slate-200 border-b border-slate-600 pb-2">📦 Stock & Inventory</h3>
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
                value={formData.stock}
                onChange={(e) => handleInputChange('stock', e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">RATE</label>
              <input
                type="number"
                step="0.01"
                value={formData.rate}
                onChange={(e) => handleInputChange('rate', e.target.value)}
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
            onClick={() => router.push('/products')}
            className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>

    {/* Car Models Confirmation Modal */}
    <ConfirmationModal
      isOpen={showCarModelsConfirmModal}
      title="Confirm Car Models Selection"
      message={`You have selected ${pendingCarModelsData?.length} car model${pendingCarModelsData && pendingCarModelsData.length > 1 ? 's' : ''}. Do you want to save this product?`}
      showLoading={false}
      onConfirm={async () => {
        setShowCarModelsConfirmModal(false);
        await handleConfirmSubmit();
      }}
      onCancel={() => {
        setShowCarModelsConfirmModal(false);
        setPendingCarModelsData(null);
      }}
    />
    </div>
  );
}
