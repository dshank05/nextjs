import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { broadcast } from '../../lib/broadcast';
import { useSnackbar } from '../../components/SnackbarProvider';
import { SearchableSelect, ClearableInput } from '../../components/common';
// Import useForm or similar validation later if needed

interface CustomerFormData {
  // ===== REQUIRED FIELDS =====
  billing_name: string;
  billing_address: string;        // Main billing address line (REQUIRED)
  shipping_name: string;
  shipping_address: string;       // Main shipping address line (REQUIRED)
  contact_no: string;             // Made REQUIRED

  // ===== OPTIONAL FIELDS =====
  billing_address_2: string;      // Additional billing address line
  billing_city: string;           // Billing city
  billing_pin_code: string;       // Billing pin code (6 digits)
  shipping_address_2: string;     // Additional shipping address line
  shipping_city: string;          // Shipping city
  shipping_pin_code: string;      // Shipping pin code (6 digits)
  billing_state: string;
  billing_state_code: string;     // Auto-filled, not shown in UI
  billing_gstin: string;
  shipping_state: string;
  shipping_state_code: string;    // Auto-filled, not shown in UI
  shipping_gstin: string;
  email: string;
  contact_no_2: string;           // Additional phone numbers
  contact_no_3: string;
  status: 'Active' | 'Inactive';  // Status field

  // ===== FORM CONTROLS =====
  copyFromBilling: boolean;       // Checkbox for copying billing to shipping
}

interface Option {
  id: number;
  state_name: string;
  code: number;
}

export default function CustomerCreate() {
  const router = useRouter();
  const { id } = router.query;
  const { showSnackbar } = useSnackbar();
  const [states, setStates] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmData, setConfirmData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialLoading, setInitialLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [formData, setFormData] = useState<CustomerFormData>({
    billing_name: '',
    billing_address: '',
    billing_address_2: '',
    billing_city: '',
    billing_pin_code: '',
    shipping_name: '',
    shipping_address: '',
    shipping_address_2: '',
    shipping_city: '',
    shipping_pin_code: '',
    billing_state: '',
    billing_state_code: '',
    billing_gstin: '',
    shipping_state: '',
    shipping_state_code: '',
    shipping_gstin: '',
    contact_no: '',
    contact_no_2: '',
    contact_no_3: '',
    email: '',
    status: 'Active',
    copyFromBilling: false
  });

  // Fetch states on mount
  useEffect(() => {
    const fetchStates = async () => {
      try {
        const response = await fetch('/api/states');
        if (response.ok) {
          const data = await response.json();
          setStates(data.states || []);
        }
      } catch (error) {
        console.error('Error fetching states:', error);
      }
    };
    fetchStates();
  }, []);

  // Load customer data for editing
  useEffect(() => {
    if (id && typeof id === 'string') {
      setIsEditing(true);
      fetchCustomer(id);
    }
  }, [id]);

  const fetchCustomer = async (customerId: string) => {
    setInitialLoading(true);
    try {
      const response = await fetch(`/api/customers/${customerId}`);
      if (response.ok) {
        const customerData = await response.json();
        setFormData({
          billing_name: customerData.billing_name || '',
          billing_address: customerData.billing_address || '',
          billing_address_2: customerData.billing_address_2 || '',
          billing_city: customerData.billing_city || '',
          billing_pin_code: customerData.billing_pin_code || '',
          shipping_name: customerData.shipping_name || customerData.billing_name || '',
          shipping_address: customerData.shipping_address || customerData.billing_address || '',
          shipping_address_2: customerData.shipping_address_2 || customerData.billing_address_2 || '',
          shipping_city: customerData.shipping_city || customerData.billing_city || '',
          shipping_pin_code: customerData.shipping_pin_code || customerData.billing_pin_code || '',
          billing_state: customerData.billing_state || '',
          billing_state_code: customerData.billing_state_code ? customerData.billing_state_code.toString() : '',
          billing_gstin: customerData.billing_gstin || '',
          shipping_state: customerData.shipping_state || customerData.billing_state || '',
          shipping_state_code: customerData.shipping_state_code ? customerData.shipping_state_code.toString() : (customerData.billing_state_code ? customerData.billing_state_code.toString() : ''),
          shipping_gstin: customerData.shipping_gstin || customerData.billing_gstin || '',
          contact_no: customerData.contact_no || '',
          contact_no_2: customerData.contact_no_2 || '',
          contact_no_3: customerData.contact_no_3 || '',
          email: customerData.email || '',
          status: customerData.status || 'Active',
          copyFromBilling: !customerData.shipping_name || customerData.shipping_name === customerData.billing_name
        });
      }
    } catch (error) {
      console.error('Error fetching customer:', error);
      setErrors({ submit: 'Failed to load customer data.' });
    } finally {
      setInitialLoading(false);
    }
  };

  // Handle copy from billing checkbox functionality
  const handleCopyFromBillingChange = (checked: boolean) => {
    setFormData(prev => {
      if (checked) {
        // Copy billing to shipping when checked
        return {
          ...prev,
          copyFromBilling: true,
          shipping_name: prev.billing_name,
          shipping_address: prev.billing_address,
          shipping_address_2: prev.billing_address_2,
          shipping_city: prev.billing_city,
          shipping_pin_code: prev.billing_pin_code,
          shipping_state: prev.billing_state,
          shipping_state_code: prev.billing_state_code,
          shipping_gstin: prev.billing_gstin
        };
      } else {
        // Clear shipping fields when unchecked
        return {
          ...prev,
          copyFromBilling: false,
          shipping_name: '',
          shipping_address: '',
          shipping_address_2: '',
          shipping_city: '',
          shipping_pin_code: '',
          shipping_state: '',
          shipping_state_code: '',
          shipping_gstin: ''
        };
      }
    });
  };

  // Auto-update shipping when copy from billing is checked and billing fields change
  useEffect(() => {
    if (formData.copyFromBilling) {
      setFormData(prev => ({
        ...prev,
        shipping_name: prev.billing_name,
        shipping_address: prev.billing_address,
        shipping_address_2: prev.billing_address_2,
        shipping_city: prev.billing_city,
        shipping_pin_code: prev.billing_pin_code,
        shipping_state: prev.billing_state,
        shipping_state_code: prev.billing_state_code,
        shipping_gstin: prev.billing_gstin
      }));
    }
  }, [formData.copyFromBilling, formData.billing_name, formData.billing_address, formData.billing_address_2, formData.billing_city, formData.billing_pin_code, formData.billing_state, formData.billing_state_code, formData.billing_gstin]);

  const handleInputChange = (field: keyof CustomerFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear errors when user starts typing
    if (errors[field as string]) {
      setErrors(prev => ({ ...prev, [field as string]: '' }));
    }
  };



  // Auto-fill state code when state is selected
  const handleStateChange = (type: 'billing' | 'shipping', stateName: string | null) => {
    if (!stateName || stateName === '') {
      // Clear selection
      if (type === 'billing') {
        handleInputChange('billing_state', '');
        handleInputChange('billing_state_code', '');
      } else {
        handleInputChange('shipping_state', '');
        handleInputChange('shipping_state_code', '');
      }
      return;
    }

    const selectedState = states.find(state => state.state_name === stateName);
    const stateCode = selectedState ? selectedState.code?.toString() || '' : '';

    if (type === 'billing') {
      handleInputChange('billing_state', stateName);
      handleInputChange('billing_state_code', stateCode);
    } else {
      handleInputChange('shipping_state', stateName);
      handleInputChange('shipping_state_code', stateCode);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

  // ===== REQUIRED FIELD VALIDATION =====
    if (!formData.billing_name.trim()) {
      newErrors.billing_name = 'Billing name is required';
    }
    if (!formData.billing_address.trim()) {
      newErrors.billing_address = 'Billing address is required';
    }

    // Only validate shipping fields if NOT copying from billing
    if (!formData.copyFromBilling) {
      if (!formData.shipping_name.trim()) {
        newErrors.shipping_name = 'Shipping name is required';
      }
      if (!formData.shipping_address.trim()) {
        newErrors.shipping_address = 'Shipping address is required';
      }
      if (!formData.shipping_state) {
        newErrors.shipping_state = 'Shipping state is required';
      }
    }

    if (!formData.contact_no.trim()) {
      newErrors.contact_no = 'Contact number is required';
    }

    if (!formData.billing_state) {
      newErrors.billing_state = 'Billing state is required';
    }

    // ===== EMAIL VALIDATION =====
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // ===== GSTIN VALIDATION =====
    if (formData.billing_gstin && formData.billing_gstin.length !== 15) {
      newErrors.billing_gstin = 'GSTIN must be 15 characters';
    }
    if (formData.shipping_gstin && formData.shipping_gstin.length !== 15) {
      newErrors.shipping_gstin = 'GSTIN must be 15 characters';
    }

    // ===== PHONE NUMBER VALIDATION =====
    const phoneRegex = /^[6-9]\d{9}$/; // Indian mobile number format - start with 6-9, exactly 10 digits
    if (formData.contact_no && !phoneRegex.test(formData.contact_no)) {
      newErrors.contact_no = 'Phone number must be 10 digits and start with 6-9';
    }
    if (formData.contact_no_2 && formData.contact_no_2.trim() && !phoneRegex.test(formData.contact_no_2.trim())) {
      newErrors.contact_no_2 = 'Phone 2 must be 10 digits and start with 6-9';
    }
    if (formData.contact_no_3 && formData.contact_no_3.trim() && !phoneRegex.test(formData.contact_no_3.trim())) {
      newErrors.contact_no_3 = 'Phone 3 must be 10 digits and start with 6-9';
    }

    // ===== PIN CODE VALIDATION =====
    const pinCodeRegex = /^\d{6}$/; // 6-digit pin code
    if (formData.billing_pin_code && !pinCodeRegex.test(formData.billing_pin_code)) {
      newErrors.billing_pin_code = 'Pin code must be exactly 6 digits';
    }
    if (formData.shipping_pin_code && !pinCodeRegex.test(formData.shipping_pin_code) && !formData.copyFromBilling) {
      newErrors.shipping_pin_code = 'Pin code must be exactly 6 digits';
    }

    setErrors(newErrors);
    console.log(newErrors)
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      // Show snackbar with validation errors
      const errorMessages = Object.values(errors).filter(msg => msg && msg !== '');
      if (errorMessages.length > 0) {
        showSnackbar('error', `Please fix the following errors: ${errorMessages.join(', ')}`);
      }
      return;
    }

    // Show confirmation modal before submitting
    setConfirmData({
      billing_name: formData.billing_name,
      shipping_name: formData.shipping_name,
      copyFromBilling: formData.copyFromBilling
    });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!confirmData) return;

    setIsSaving(true);

    try {
      const submitData = {
        ...formData,
        billing_name: formData.billing_name.trim(),
        // ===== BILLING ADDRESS FIELDS =====
        billing_address: formData.billing_address.trim(),
        billing_address_2: formData.billing_address_2.trim(),
        billing_city: formData.billing_city.trim(),
        billing_pin_code: formData.billing_pin_code.trim(),
        billing_state: formData.billing_state,  // Send state name as string
        billing_state_code: parseInt(formData.billing_state_code) || 0,  // Send state code as number
        billing_gstin: formData.billing_gstin.trim(),

        shipping_name: formData.shipping_name?.trim() || '',
        // ===== SHIPPING ADDRESS FIELDS =====
        shipping_address: formData.shipping_address?.trim() || '',
        shipping_address_2: formData.shipping_address_2?.trim() || '',
        shipping_city: formData.shipping_city?.trim() || '',
        shipping_pin_code: formData.shipping_pin_code?.trim() || '',
        shipping_state: formData.shipping_state?.trim() || '',  // Send state name as string
        shipping_state_code: parseInt(formData.shipping_state_code) || 0,  // Send state code as number
        shipping_gstin: formData.shipping_gstin?.trim() || '',

        contact_no: formData.contact_no.trim(),
        contact_no_2: formData.contact_no_2.trim() || null,
        contact_no_3: formData.contact_no_3.trim() || null,
        email: formData.email.trim(),
        status: formData.status || 'Active'
      };

      // Remove unwanted fields that shouldn't be sent to API
      delete (submitData as any).copyFromBilling;

      console.log(`${isEditing ? 'Updating' : 'Creating'} customer with data:`, submitData);

      const url = isEditing ? `/api/customers/${id}` : '/api/customers';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        console.log(`Customer ${isEditing ? 'updated' : 'created'} successfully`);

        // Broadcast the change to refresh other tabs
        if (isEditing) {
          broadcast({
            type: 'updated',
            resource: 'customers',
            id: parseInt(id as string)
          });
        } else {
          // Get the created customer ID from response if available, otherwise don't include ID
          broadcast({
            type: 'created',
            resource: 'customers',
            data: { name: formData.billing_name }
          });
        }

        // Close the current tab only if we opened it as a new tab for creation
        // Don't close if we were navigated to editing from within the app
        if (typeof window !== 'undefined' && !isEditing && window.opener) {
          router.push('/entry/customerdetails');
          setTimeout(() => window.close(), 100); // Small delay to let navigation happen first
        } else {
          router.push(isEditing ? `/customers/view/${id}` : '/entry/customerdetails');
        }
      } else {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        setErrors({ submit: errorData.message || `Failed to ${isEditing ? 'update' : 'create'} customer` });
      }
    } catch (error) {
      console.error('Network error:', error);
      setErrors({ submit: 'Network error occurred' });
    } finally {
      setIsSaving(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* ===== BILLING INFORMATION ===== */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white border-b border-slate-600 pb-2">🏢 Billing Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING NAME *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.billing_name}
                  onChange={(e) => handleInputChange('billing_name', e.target.value)}
                  placeholder="Enter billing name"
                />
                {errors.billing_name && <p className="text-red-400 text-xs mt-1">{errors.billing_name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING ADDRESS LINE 1 *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.billing_address}
                  onChange={(e) => handleInputChange('billing_address', e.target.value)}
                  placeholder="Street address, building, etc."
                />
                {errors.billing_address && <p className="text-red-400 text-xs mt-1">{errors.billing_address}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING ADDRESS LINE 2
                </label>
                <ClearableInput
                  type="text"
                  value={formData.billing_address_2}
                  onChange={(e) => handleInputChange('billing_address_2', e.target.value)}
                  placeholder="Area, locality, landmark (optional)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING CITY
                </label>
                <ClearableInput
                  type="text"
                  value={formData.billing_city}
                  onChange={(e) => handleInputChange('billing_city', e.target.value)}
                  placeholder="Enter city name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING PIN CODE
                </label>
                <input
                  type="text"
                  value={formData.billing_pin_code}
                  onChange={(e) => handleInputChange('billing_pin_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input w-full"
                  placeholder="6-digit pin code"
                  maxLength={6}
                />
                {errors.billing_pin_code && <p className="text-red-400 text-xs mt-1">{errors.billing_pin_code}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING STATE *
                </label>
                <SearchableSelect
                  options={[
                    { id: '', name: 'Select State' },
                    ...states.map(state => ({
                      id: state.state_name,
                      name: state.state_name
                    }))
                  ]}
                  selectedValue={formData.billing_state}
                  onSelectionChange={(value) => handleStateChange('billing', value)}
                  placeholder="Select State"
                />
                {errors.billing_state && <p className="text-red-400 text-xs mt-1">{errors.billing_state}</p>}
              </div>



              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  BILLING GSTIN
                </label>
                <input
                  type="text"
                  value={formData.billing_gstin}
                  onChange={(e) => handleInputChange('billing_gstin', e.target.value.toUpperCase())}
                  className="input w-full"
                  placeholder="15-digit GST number"
                  maxLength={15}
                />
                {errors.billing_gstin && <p className="text-red-400 text-xs mt-1">{errors.billing_gstin}</p>}
              </div>
            </div>
          </div>

          {/* ===== SHIPPING INFORMATION ===== */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-600 pb-2">
              <h3 className="text-lg font-medium text-white">🚚 Shipping Information</h3>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.copyFromBilling}
                  onChange={(e) => handleCopyFromBillingChange(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                />
                Copy from Billing
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING NAME *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.shipping_name}
                  onChange={(e) => handleInputChange('shipping_name', e.target.value)}
                  placeholder="Enter shipping name"
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
                {errors.shipping_name && <p className="text-red-400 text-xs mt-1">{errors.shipping_name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING ADDRESS LINE 1 *
                </label>
                <ClearableInput
                  type="text"
                  value={formData.shipping_address}
                  onChange={(e) => handleInputChange('shipping_address', e.target.value)}
                  placeholder="Street address, building, etc."
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
                {errors.shipping_address && <p className="text-red-400 text-xs mt-1">{errors.shipping_address}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING ADDRESS LINE 2
                </label>
                <ClearableInput
                  type="text"
                  value={formData.shipping_address_2}
                  onChange={(e) => handleInputChange('shipping_address_2', e.target.value)}
                  placeholder="Area, locality, landmark (optional)"
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING CITY
                </label>
                <ClearableInput
                  type="text"
                  value={formData.shipping_city}
                  onChange={(e) => handleInputChange('shipping_city', e.target.value)}
                  placeholder="Enter city name"
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING PIN CODE
                </label>
                <input
                  type="text"
                  value={formData.shipping_pin_code}
                  onChange={(e) => handleInputChange('shipping_pin_code', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input w-full"
                  placeholder="6-digit pin code"
                  maxLength={6}
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING STATE *
                </label>
                <SearchableSelect
                  options={[
                    { id: '', name: 'Select State' },
                    ...states.map(state => ({
                      id: state.state_name,
                      name: state.state_name
                    }))
                  ]}
                  selectedValue={formData.shipping_state}
                  onSelectionChange={(value) => handleStateChange('shipping', value)}
                  placeholder="Select State"
                  disabled={formData.copyFromBilling}
                />
                {errors.shipping_state && <p className="text-red-400 text-xs mt-1">{errors.shipping_state}</p>}
              </div>



              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  SHIPPING GSTIN
                </label>
                <input
                  type="text"
                  value={formData.shipping_gstin}
                  onChange={(e) => handleInputChange('shipping_gstin', e.target.value.toUpperCase())}
                  className="input w-full"
                  placeholder="15-digit GST number"
                  maxLength={15}
                  disabled={formData.copyFromBilling}
                  readOnly={formData.copyFromBilling}
                />
                {errors.shipping_gstin && <p className="text-red-400 text-xs mt-1">{errors.shipping_gstin}</p>}
              </div>
            </div>
          </div>

          {/* ===== CONTACT INFORMATION ===== */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white border-b border-slate-600 pb-2">📞 Contact Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  CONTACT NUMBER *
                </label>
                <ClearableInput
                  type="tel"
                  value={formData.contact_no}
                  onChange={(e) => handleInputChange('contact_no', e.target.value)}
                  placeholder="Enter phone number"
                  maxLength={10}
                />
                {errors.contact_no && <p className="text-red-400 text-xs mt-1">{errors.contact_no}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  PHONE 2
                </label>
                <ClearableInput
                  type="tel"
                  value={formData.contact_no_2}
                  onChange={(e) => handleInputChange('contact_no_2', e.target.value)}
                  placeholder="Additional phone"
                  maxLength={10}
                />
                {errors.contact_no_2 && <p className="text-red-400 text-xs mt-1">{errors.contact_no_2}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  PHONE 3
                </label>
                <ClearableInput
                  type="tel"
                  value={formData.contact_no_3}
                  onChange={(e) => handleInputChange('contact_no_3', e.target.value)}
                  placeholder="Additional phone"
                  maxLength={10}
                />
                {errors.contact_no_3 && <p className="text-red-400 text-xs mt-1">{errors.contact_no_3}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  EMAIL ADDRESS
                </label>
                <ClearableInput
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  placeholder="Enter email address"
                />
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
              </div>
            </div>
          </div>

          {/* ===== ADDITIONAL INFO (Only shown when editing) =====
          {isEditing && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white border-b border-slate-600 pb-2">📋 Additional Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    STATUS
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="select w-full"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
          )} */}

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
                const { from } = router.query;
                if (from === 'sale') {
                  router.push('/sale/create');
                } else if (from === 'salex') {
                  router.push('/salex/create');
                } else {
                  router.push('/entry/customerdetails');
                }
              }}
              className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Customer' : 'Create Customer')}
            </button>
          </div>
        </form>
      </div>

      {/* Pre-Submit Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={isEditing ? 'Update Customer' : 'Create Customer'}
        message={`Are you sure you want to ${isEditing ? 'update' : 'create'} customer "${confirmData?.billing_name}"${formData.copyFromBilling ? ' with shipping address copied from billing?' : ' with separate shipping address?'}`}

        showLoading={isSaving}
        onConfirm={async () => {
          await handleConfirmSubmit();
        }}
        onCancel={() => {
          setShowConfirmModal(false);
          setConfirmData(null);
        }}
      />
    </div>
  );
}
