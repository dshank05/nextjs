import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Trash2, Calculator, Loader } from 'lucide-react';
import { SearchableMultiSelect } from '../../components/common/SearchableMultiSelect';
import { ConfirmationModal } from '../../components/ConfirmationModal';

interface Vendor {
  id: number;
  vendor_name: string;
  contact_number?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  gst_number?: string;
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
  tax: number;
  total: number;
}

interface PurchaseFormData {
  invoice_number: string;
  bill_reference: string;
  staff_details: string;
  date: string;
  vendor_name: string;
  contact_number: string;
  email_id: string;
  address: string;
  city: string;
  state: string;
  gst_number: string;
  transport_name: string;
  vehicle_number: string;
  transport_cost: string;
  bill: string;
  tax: string;
  descriptions: string;
  packing_forwarding_qty: string;
  packing_forwarding_rate: string;
  packing_forwarding_total: string;
  tax_rate: string;
  basic_value: string;
  total_cgst: string;
  total_sgst: string;
  total_igst: string;
  notes: string;
  total_tax: string;
  payment_status: string;
  payment_mode: string;
  grand_total: string;
}

interface FilterOptions {
  categories: any[];
  subcategories: any[];
  companies: any[];
  models: any[];
}

export default function PurchaseCreate() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<PurchaseItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [vendorIdToSave, setVendorIdToSave] = useState<number | null>(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // State for the product selection row filters
  const [productRowFilters, setProductRowFilters] = useState({
    category: '',
    subcategory: '',
    carModels: [] as string[],
    company: '',
    partNo: ''
  });

  // Filtered products based on row filters
  const [filteredRowProducts, setFilteredRowProducts] = useState<Product[]>([]);

  // State for selected product in the table row
  const [selectedRowProduct, setSelectedRowProduct] = useState('');

  // State for template row inputs
  const [templateRow, setTemplateRow] = useState({
    qty: '1',
    rate: '',
    tax: '18'
  });

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    categories: [],
    subcategories: [],
    companies: [],
    models: []
  });

  const [formData, setFormData] = useState<PurchaseFormData>({
    invoice_number: '',
    bill_reference: '',
    staff_details: '',
    date: new Date().toISOString().split('T')[0],
    vendor_name: '',
    contact_number: '',
    email_id: '',
    address: '',
    city: '',
    state: '',
    gst_number: '',
    transport_name: '',
    vehicle_number: '',
    transport_cost: '',
    bill: '',
    tax: '',
    descriptions: '',
    packing_forwarding_qty: '',
    packing_forwarding_rate: '',
    packing_forwarding_total: '',
    tax_rate: '',
    basic_value: '',
    total_cgst: '',
    total_sgst: '',
    total_igst: '',
    notes: '',
    total_tax: '',
    payment_status: 'unpaid',
    payment_mode: 'cash',
    grand_total: ''
  });

  // Fetch vendors and products on mount
  useEffect(() => {
    fetchVendors();
    fetchProducts();
    fetchFilterOptions();
    fetchLastInvoiceNumber();
  }, []);

  // Filter products based on row filters for the dropdown
  useEffect(() => {
    let filtered = [...products];

    // Filter by category ID
    if (productRowFilters.category) {
      filtered = filtered.filter(product =>
        product.product_category_id === parseInt(productRowFilters.category)
      );
    }

    // Filter by subcategory ID
    if (productRowFilters.subcategory) {
      filtered = filtered.filter(product =>
        product.product_subcategory_id === parseInt(productRowFilters.subcategory)
      );
    }

    // Filter by car models (check intersection with product car_model_ids)
    if (productRowFilters.carModels.length > 0) {
      filtered = filtered.filter(product => {
        const productCarModelIds = product.car_model_ids?.split(',').map(id => id.trim()) || [];
        return productRowFilters.carModels.some(selectedId =>
          productCarModelIds.includes(selectedId)
        );
      });
    }

    // Filter by company ID (company field stores company ID string)
    if (productRowFilters.company) {
      filtered = filtered.filter(product =>
        product.company === productRowFilters.company
      );
    }

    // Filter by part number (case-insensitive partial match)
    if (productRowFilters.partNo) {
      const searchPartNo = productRowFilters.partNo.toLowerCase().trim();
      filtered = filtered.filter(product =>
        product.part_no?.toLowerCase().trim().includes(searchPartNo)
      );
    }

    setFilteredRowProducts(filtered);

    // Auto-select product if only one match remains
    if (filtered.length === 1) {
      setSelectedRowProduct(filtered[0].id.toString());
    } else {
      setSelectedRowProduct('');
    }
  }, [productRowFilters, products, filterOptions]);

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/vendors');
      if (response.ok) {
        const data = await response.json();
        setVendors(data.vendors || []);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
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

  const fetchLastInvoiceNumber = async () => {
    try {
      const response = await fetch('/api/purchases/last-invoice');
      if (response.ok) {
        const data = await response.json();
        const lastInvoiceNum = data.lastInvoiceNumber || 0;
        const nextInvoiceNum = lastInvoiceNum + 1;
        setFormData(prev => ({ ...prev, invoice_number: nextInvoiceNum.toString() }));
      }
    } catch (error) {
      console.error('Error fetching last invoice number:', error);
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  const handleInputChange = (field: keyof PurchaseFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleVendorSelect = (vendorId: string) => {
    const vendor = vendors.find(v => v.id.toString() === vendorId);
    if (vendor) {
      setVendorIdToSave(vendor.id); // Store vendor ID for API
      setFormData(prev => ({
        ...prev,
        vendor_name: vendor.vendor_name,
        contact_number: vendor.contact_number || '',
        email_id: vendor.email || '',
        address: vendor.address || '',
        city: vendor.city || '',
        state: vendor.state || '',
        gst_number: vendor.gst_number || ''
      }));
    }
  };

  const addProductToPurchase = (product: Product) => {
    const newItem: PurchaseItem = {
      id: Date.now().toString(),
      product_id: product.id,
      product_name: product.product_name,
      car_model: '',
      category: product.category_name || '',
      sub_category: product.subcategory_name || '',
      company: product.company || '',
      part_number: product.part_no || '',
      qty: 1,
      rate: product.rate,
      tax: product.gst_rate || 0,
      total: product.rate
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

  const calculateSubtotal = () => {
    return selectedProducts.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateTotalTax = () => {
    const subtotal = calculateSubtotal();
    const packingTotal = parseFloat(formData.packing_forwarding_total) || 0;
    const transportCost = parseFloat(formData.transport_cost) || 0;
    const basicValue = subtotal + packingTotal + transportCost;

    const cgst = (basicValue * parseFloat(formData.total_cgst || '0')) / 100;
    const sgst = (basicValue * parseFloat(formData.total_sgst || '0')) / 100;
    const igst = (basicValue * parseFloat(formData.total_igst || '0')) / 100;

    return cgst + sgst + igst;
  };

  const calculateGrandTotal = () => {
    const subtotal = calculateSubtotal();
    const packingTotal = parseFloat(formData.packing_forwarding_total) || 0;
    const transportCost = parseFloat(formData.transport_cost) || 0;
    const totalTax = calculateTotalTax();

    return subtotal + packingTotal + transportCost + totalTax;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.invoice_number.trim()) {
      newErrors.invoice_number = 'Invoice number is required';
    }
    if (!formData.vendor_name.trim()) {
      newErrors.vendor_name = 'Vendor name is required';
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
    setShowConfirmationModal(false);
    setLoading(true);

    try {
      const submitData = {
        invoice_number: formData.invoice_number,
        bill_reference: formData.bill_reference,
        staff_details: formData.staff_details,
        date: formData.date,
        vendor_id: vendorIdToSave, // Send vendor ID
        vendor_name: formData.vendor_name,
        contact_number: formData.contact_number,
        email_id: formData.email_id,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        gst_number: formData.gst_number,
        transport_name: formData.transport_name,
        vehicle_number: formData.vehicle_number,
        transport_cost: parseFloat(formData.transport_cost) || 0,
        bill: formData.bill,
        tax: formData.tax,
        items: selectedProducts.map(item => ({
          product_id: item.product_id,
          product_name: item.product_name,
          car_model: item.car_model,
          category: item.category,
          sub_category: item.sub_category,
          company: item.company,
          part_number: item.part_number,
          qty: item.qty,
          rate: item.rate,
          tax: item.tax,
          total: item.total
        })),
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
        total_tax: calculateTotalTax(),
        payment_status: formData.payment_status,
        payment_mode: formData.payment_mode,
        grand_total: calculateGrandTotal()
      };

      const response = await fetch('/api/purchases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        router.push('/purchases');
      } else {
        const error = await response.json();
        setErrors({ submit: error.message || 'Failed to create purchase' });
      }
    } catch (error) {
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
                  <label className="block text-sm font-medium text-slate-300 mb-2">STAFF DETAILS</label>
                  <input
                    type="text"
                    value={formData.staff_details}
                    onChange={(e) => handleInputChange('staff_details', e.target.value)}
                    className="input w-full"
                    placeholder="Enter staff details"
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

            {/* Vendor Information */}
            <div className="mb-10 border-t border-slate-600 pt-8">
              <h3 className="text-lg font-medium text-slate-200 mb-6">Vendor Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    value={formData.contact_number}
                    onChange={(e) => handleInputChange('contact_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter contact number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={formData.email_id}
                    onChange={(e) => handleInputChange('email_id', e.target.value)}
                    className="input w-full"
                    placeholder="Enter email"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">GST NUMBER</label>
                  <input
                    type="text"
                    value={formData.gst_number}
                    onChange={(e) => handleInputChange('gst_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter GST number"
                  />
                </div>
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">ADDRESS</label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                      className="input w-full"
                      placeholder="Enter address"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">CITY</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      className="input w-full"
                      placeholder="Enter city"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">STATE</label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                      className="input w-full"
                      placeholder="Enter state"
                    />
                  </div>
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
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-20">
                        RATE
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider w-16">
                        TAX AMOUNT
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
                        <select
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white"
                          value={selectedRowProduct}
                          onChange={(e) => setSelectedRowProduct(e.target.value)}
                        >
                          <option value="">Select Product</option>
                          {filteredRowProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.product_name}
                            </option>
                          ))}
                        </select>
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
                      <td className="px-4 py-3 text-center w-20">
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
                      <td className="px-4 py-3 text-center w-16">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full px-2 py-2 bg-slate-700 border border-slate-600 rounded text-xs text-white text-center"
                          placeholder="18%"
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
                          onClick={() => {
                            if (selectedRowProduct) {
                              const product = products.find(p => p.id.toString() === selectedRowProduct);
                              if (product) {
                                // Calculate tax amount (percentage of rate * qty)
                                const qty = parseFloat(templateRow.qty) || 1;
                                const rate = parseFloat(templateRow.rate) || 0;
                                const taxPercent = parseFloat(templateRow.tax) || 0;
                                const subtotal = qty * rate;
                                const taxAmount = (subtotal * taxPercent) / 100;

                                const newItem: PurchaseItem = {
                                  id: Date.now().toString(),
                                  product_id: product.id,
                                  product_name: product.product_name,
                                  car_model: productRowFilters.carModels.join(', '),
                                  category: filterOptions.categories.find(c => c.id.toString() === productRowFilters.category)?.name || '',
                                  sub_category: filterOptions.subcategories.find(s => s.id.toString() === productRowFilters.subcategory)?.name || '',
                                  company: filterOptions.companies.find(c => c.id.toString() === productRowFilters.company)?.name || '',
                                  part_number: productRowFilters.partNo,
                                  qty: qty,
                                  rate: rate,
                                  tax: taxAmount,
                                  total: subtotal + taxAmount
                                };

                                setSelectedProducts(prev => [...prev, newItem]);

                                // Reset form
                                setSelectedRowProduct('');
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
                                  tax: '18'
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
                          ₹{calculateSubtotal().toFixed(2)}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">DESCRIPTIONS</label>
                  <textarea
                    value={formData.descriptions}
                    onChange={(e) => handleInputChange('descriptions', e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Enter descriptions"
                  />
                </div>
                <div>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">BILL</label>
                    <input
                      type="text"
                      value={formData.bill}
                      onChange={(e) => handleInputChange('bill', e.target.value)}
                      className="input w-full"
                      placeholder="Enter bill"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TAX</label>
                    <input
                      type="text"
                      value={formData.tax}
                      onChange={(e) => handleInputChange('tax', e.target.value)}
                      className="input w-full"
                      placeholder="Enter tax"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL CGST</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.total_cgst}
                      onChange={(e) => handleInputChange('total_cgst', e.target.value)}
                      className="input w-full"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL SGST</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.total_sgst}
                      onChange={(e) => handleInputChange('total_sgst', e.target.value)}
                      className="input w-full"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">TOTAL IGST</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.total_igst}
                      onChange={(e) => handleInputChange('total_igst', e.target.value)}
                      className="input w-full"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS *</label>
                    <select
                      value={formData.payment_status}
                      onChange={(e) => handleInputChange('payment_status', e.target.value)}
                      className="select w-full"
                      required
                    >
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT MODE *</label>
                    <select
                      value={formData.payment_mode}
                      onChange={(e) => handleInputChange('payment_mode', e.target.value)}
                      className="select w-full"
                      required
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>

                <div className="bg-slate-700 rounded p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">GRAND TOTAL</span>
                    <div className="flex items-center space-x-2">
                      <Calculator className="w-4 h-4 text-slate-400" />
                      <span className="text-white font-semibold text-lg">
                        ₹{calculateGrandTotal().toFixed(2)}
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
                {loading ? 'Creating...' : 'Create Purchase'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Create Purchase?"
        message={`Are you sure you want to create this purchase for ₹${calculateGrandTotal().toFixed(2)}? This action cannot be undone.`}
        confirmText="Create Purchase"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Creating Purchase..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div>

  );
}
