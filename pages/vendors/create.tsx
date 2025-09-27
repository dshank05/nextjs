import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

interface State {
  id: number;
  state_name: string;
  code: number;
}

export default function CreateVendor() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    vendor_name: '',
    address: '',
    address_2: '',
    contact_no: '',
    email: '',
    tax_id: '',
    state: '', // This will store the state ID as string
    state_code: ''
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

  const handleStateChange = (stateName: string) => {
    const selectedState = states.find(s => s.state_name === stateName);
    if (selectedState) {
      setFormData(prev => ({
        ...prev,
        state: selectedState.id.toString(),
        state_code: selectedState.code.toString().padStart(2, '0')
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Validate required fields
      const requiredFields = ['vendor_name', 'contact_no'];
      const missingFields = requiredFields.filter(field => !formData[field as keyof typeof formData]);

      if (missingFields.length > 0) {
        setErrors({ submit: 'Please fill in all required fields.' });
        setLoading(false);
        return;
      }

      // Validate GSTIN format (basic validation) - tax_id is GST for vendors
      if (formData.tax_id && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(formData.tax_id)) {
        setErrors({ tax_id: 'Please enter a valid GSTIN number.' });
        setLoading(false);
        return;
      }

      // Validate email format
      if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
        setErrors({ email: 'Please enter a valid email address.' });
        setLoading(false);
        return;
      }

      const response = await fetch('/api/vendors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push('/vendors'); // Redirect back to vendors list
      } else {
        const errorData = await response.json();
        setErrors({ submit: errorData.message || 'Failed to create vendor.' });
      }
    } catch (error) {
      setErrors({ submit: 'An error occurred while creating the vendor.' });
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
        <h1 className="text-2xl font-bold text-white">Create New Vendor</h1>
        <p className="text-sm text-slate-400 mt-1">Add a new vendor to your database</p>
      </div>

      {errors.submit && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <span className="text-red-400">⚠️ {errors.submit}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card">
          {/* Vendor Information */}
          <h2 className="text-xl font-semibold text-white mb-4">Vendor Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Vendor Name *
              </label>
              <input
                type="text"
                name="vendor_name"
                value={formData.vendor_name}
                onChange={handleChange}
                className="input w-full"
                required
              />
              {errors.vendor_name && <span className="text-red-400 text-sm">{errors.vendor_name}</span>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Address
              </label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                className="input w-full"
                placeholder="Primary address"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Address 2
              </label>
              <input
                type="text"
                name="address_2"
                value={formData.address_2}
                onChange={handleChange}
                className="input w-full"
                placeholder="Additional address information"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Contact No *
              </label>
              <input
                type="tel"
                name="contact_no"
                value={formData.contact_no}
                onChange={handleChange}
                className="input w-full"
                placeholder="+91-XXXXXXXXXX"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input w-full"
                placeholder="vendor@example.com"
              />
              {errors.email && <span className="text-red-400 text-sm">{errors.email}</span>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                GST No
              </label>
              <input
                type="text"
                name="tax_id"
                value={formData.tax_id}
                onChange={handleChange}
                className="input w-full"
                placeholder="22AAAAA0000A1Z5"
              />
              {errors.tax_id && <span className="text-red-400 text-sm">{errors.tax_id}</span>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                State
              </label>
              <select
                name="state"
                value={states.find(s => s.id === parseInt(formData.state))?.state_name || ''}
                onChange={(e) => handleStateChange(e.target.value)}
                className="select w-full"
              >
                <option value="">Select State</option>
                {states.map(state => (
                  <option key={state.id} value={state.state_name}>{state.state_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                State Code
              </label>
              <input
                type="text"
                name="state_code"
                value={formData.state_code}
                onChange={handleChange}
                className="input w-full bg-slate-700"
                readOnly
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="border-t border-slate-600 pt-4 mt-6">
            <div className="flex justify-end gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Creating Vendor...' : 'Create Vendor'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/vendors')}
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
