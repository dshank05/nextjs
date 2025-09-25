import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Trash2, Calculator } from 'lucide-react';

interface Vendor {
  id: number;
  name: string;
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
  category_name?: string;
  subcategory_name?: string;
  company_name?: string;
  part_no?: string;
  rate: number;
  hsn?: string;
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

export default function PurchaseCreate() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<PurchaseItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
  }, []);

  // Filter products based on search term
  useEffect(() => {
    if (searchTerm) {
      const filtered = products.filter(product =>
        product.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.part_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredProducts(filtered);
    } else {
      setFilteredProducts(products);
    }
  }, [searchTerm, products]);

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

  const handleInputChange = (field: keyof PurchaseFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleVendorSelect = (vendorId: string) => {
    const vendor = vendors.find(v => v.id.toString() === vendorId);
    if (vendor) {
      setFormData(prev => ({
        ...prev,
        vendor_name: vendor.name,
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
      company: product.company_name || '',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const submitData = {
        invoice_number: formData.invoice_number,
        bill_reference: formData.bill_reference,
        staff_details: formData.staff_details,
        date: formData.date,
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
                  <input
                    type="text"
                    value={formData.invoice_number}
                    onChange={(e) => handleInputChange('invoice_number', e.target.value)}
                    className="input w-full"
                    placeholder="Enter invoice number"
                  />
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
                    value={formData.vendor_name}
                    onChange={(e) => {
                      handleInputChange('vendor_name', e.target.value);
                      handleVendorSelect(e.target.value);
                    }}
                    className="select w-full"
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
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

              {/* Product Search */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input w-full pl-10"
                    placeholder="Search products by name, part number, or category..."
                  />
                </div>
              </div>

              {/* Product List */}
              <div className="max-h-64 overflow-y-auto border border-slate-600 rounded">
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">FULL PRODUCT NAME</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">CATEGORY</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">COMPANY</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">PART NUMBER</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">RATE</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.slice(0, 10).map((product) => (
                      <tr key={product.id} className="border-t border-slate-600 hover:bg-slate-700">
                        <td className="px-4 py-2 text-sm text-slate-300">{product.product_name}</td>
                        <td className="px-4 py-2 text-sm text-slate-300">{product.category_name}</td>
                        <td className="px-4 py-2 text-sm text-slate-300">{product.company_name}</td>
                        <td className="px-4 py-2 text-sm text-slate-300">{product.part_no}</td>
                        <td className="px-4 py-2 text-sm text-slate-300">₹{product.rate}</td>
                        <td className="px-4 py-2 text-sm">
                          <button
                            type="button"
                            onClick={() => addProductToPurchase(product)}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Selected Products */}
              {selectedProducts.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-md font-semibold mb-4">Selected Products</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full border border-slate-600 rounded">
                      <thead className="bg-slate-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">SN</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">FULL PRODUCT NAME</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">CAR MODEL</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">CATEGORY</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">SUB CATEGORY</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">COMPANY</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">PART NUMBER</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">QTY</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">RATE</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">TAX</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">TOTAL</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-slate-300">ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProducts.map((item, index) => (
                          <tr key={item.id} className="border-t border-slate-600">
                            <td className="px-4 py-2 text-sm text-slate-300">{index + 1}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.product_name}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.car_model}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.category}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.sub_category}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.company}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.part_number}</td>
                            <td className="px-4 py-2 text-sm">
                              <input
                                type="number"
                                min="1"
                                value={item.qty}
                                onChange={(e) => updateProductQuantity(item.id, parseInt(e.target.value) || 1)}
                                className="input w-20"
                              />
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-300">₹{item.rate}</td>
                            <td className="px-4 py-2 text-sm text-slate-300">{item.tax}%</td>
                            <td className="px-4 py-2 text-sm text-slate-300">₹{item.total}</td>
                            <td className="px-4 py-2 text-sm">
                              <button
                                type="button"
                                onClick={() => removeProduct(item.id)}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 text-right">
                    <span className="text-slate-300 font-medium text-lg">Subtotal: ₹{calculateSubtotal().toFixed(2)}</span>
                  </div>
                </div>
              )}
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
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT STATUS</label>
                    <select
                      value={formData.payment_status}
                      onChange={(e) => handleInputChange('payment_status', e.target.value)}
                      className="select w-full"
                    >
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">PAYMENT MODE</label>
                    <select
                      value={formData.payment_mode}
                      onChange={(e) => handleInputChange('payment_mode', e.target.value)}
                      className="select w-full"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
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
    </div>

  );
}
