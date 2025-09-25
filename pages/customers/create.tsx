import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface State {
  id: number;
  state_name: string;
  code: number;
}

export default function CreateCustomer() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    billing_name: '',
    billing_address: '',
    billing_state: '',
    billing_state_code: '',
    billing_gstin: '',
    contact_no: '',
    email: '',
    shipping_name: '',
    shipping_address: '',
    shipping_state: '',
    shipping_state_code: '',
    shipping_gstin: ''
  });

  const [states, setStates] = useState<State[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  useEffect(() => {
    fetchStates();
  }, []);

  const fetchStates = async () => {
    try {
      const response = await fetch('/api/states');
      const data = await response.json();
      setStates(data.states || []);
    } catch (error) {
      console.error('Error fetching states:', error);
    }
  };

  const handleStateChange = (field: 'billing_state' | 'shipping_state', stateName: string) => {
    const selectedState = states.find(s => s.state_name === stateName);
    if (selectedState) {
      setFormData(prev => ({
        ...prev,
        [field]: selectedState.id,
        [`${field}_code`]: selectedState.code.toString().padStart(2, '0')
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Validate required fields
      const requiredFields = ['billing_name', 'billing_address', 'billing_state', 'billing_gstin', 'contact_no', 'email'];
      const missingFields = requiredFields.filter(field => !formData[field as keyof typeof formData]);

      if (missingFields.length > 0) {
        setErrors({ submit: 'Please fill in all required fields.' });
        setLoading(false);
        return;
      }

      // Validate GSTIN format (basic validation)
      if (formData.billing_gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(formData.billing_gstin)) {
        setErrors({ billing_gstin: 'Please enter a valid GSTIN number.' });
        setLoading(false);
        return;
      }

      // Validate email format
      if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
        setErrors({ email: 'Please enter a valid email address.' });
        setLoading(false);
        return;
      }

      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push('/customers'); // Redirect back to customers list
      } else {
        const errorData = await response.json();
        setErrors({ submit: errorData.message || 'Failed to create customer.' });
      }
    } catch (error) {
      setErrors({ submit: 'An error occurred while creating the customer.' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Create New Customer</h1>
        <p className="text-sm text-slate-400 mt-1">Add a new customer to your database</p>
      </div>

      {errors.submit && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <span className="text-red-400">⚠️ {errors.submit}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Create Customer Details</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Billing Name</label>
              <input
                type="text"
                name="billing_name"
                value={formData.billing_name}
                onChange={handleChange}
                className="input w-full"
                required
              />
              {errors.billing_name && <span className="text-red-400 text-sm">{errors.billing_name}</span>}
              {!formData.billing_name && <span className="text-slate-500 text-sm">Billing Name cannot be blank.</span>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Billing Address</label>
              <textarea
                name="billing_address"
                value={formData.billing_address}
                onChange={handleChange}
                className="input w-full min-h-20"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Billing State</label>
                <select
                  name="billing_state"
                  value={states.find(s => s.id === parseInt(formData.billing_state))?.state_name || ''}
                  onChange={(e) => handleStateChange('billing_state', e.target.value)}
                  className="select w-full"
                >
                  <option value="">Select State</option>
                  {states.map(state => (
                    <option key={state.id} value={state.state_name}>{state.state_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Billing State Code</label>
                <input
                  type="text"
                  name="billing_state_code"
                  value={formData.billing_state_code}
                  onChange={handleChange}
                  className="input w-full bg-slate-700"
                  readOnly
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Billing Gstin</label>
              <input
                type="text"
                name="billing_gstin"
                value={formData.billing_gstin}
                onChange={handleChange}
                className="input w-full"
                placeholder="22AAAAA0000A1Z5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Contact No</label>
              <input
                type="tel"
                name="contact_no"
                value={formData.contact_no}
                onChange={handleChange}
                className="input w-full"
                placeholder="+91-XXXXXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input w-full"
                placeholder="customer@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Shipping Name</label>
              <input
                type="text"
                name="shipping_name"
                value={formData.shipping_name}
                onChange={handleChange}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Shipping Address</label>
              <textarea
                name="shipping_address"
                value={formData.shipping_address}
                onChange={handleChange}
                className="input w-full min-h-20"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Shipping State</label>
                <select
                  name="shipping_state"
                  value={states.find(s => s.id === parseInt(formData.shipping_state))?.state_name || ''}
                  onChange={(e) => handleStateChange('shipping_state', e.target.value)}
                  className="select w-full"
                >
                  <option value="">Select State</option>
                  {states.map(state => (
                    <option key={state.id} value={state.state_name}>{state.state_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Shipping State Code</label>
                <input
                  type="text"
                  name="shipping_state_code"
                  value={formData.shipping_state_code}
                  onChange={handleChange}
                  className="input w-full bg-slate-700"
                  readOnly
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Shipping Gstin</label>
              <input
                type="text"
                name="shipping_gstin"
                value={formData.shipping_gstin}
                onChange={handleChange}
                className="input w-full"
                placeholder="22AAAAA0000A1Z5"
              />
            </div>
          </div>

          <div className="border-t border-slate-600 pt-4 mt-6">
            <div className="flex justify-end gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Creating Customer...' : 'Create Customer'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/customers')}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
