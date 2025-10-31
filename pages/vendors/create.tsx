import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { broadcast } from '../../lib/broadcast';

interface State {
  id: number;
  state_name: string;
  code: number;
}

export default function CreateVendor() {
  const router = useRouter();
  const { id } = router.query;

  const [formData, setFormData] = useState({
    vendor_name: '',
    address: '',
    address_2: '',
    city: '',
    pin_code: '',
    contact_no: '',
    email: '',
    tax_id: '',
    state: '', // This will store the state name
    state_code: '' // This will store the state ID
  });

  const [states, setStates] = useState<State[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [initialLoading, setInitialLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmData, setConfirmData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchStates();
  }, []);

  // Load vendor data for editing
  useEffect(() => {
    if (id && typeof id === 'string') {
      setIsEditing(true);
      fetchVendor(id);
    }
  }, [id]);

  const fetchVendor = async (vendorId: string) => {
    setInitialLoading(true);
    try {
      const response = await fetch(`/api/vendors/${vendorId}`);
      if (response.ok) {
        const vendorData = await response.json();
        setFormData({
          vendor_name: vendorData.vendor_name || '',
          address: vendorData.address || '',
          address_2: vendorData.address_2 || '',
          city: vendorData.city || '',
          pin_code: vendorData.pin_code || '',
          contact_no: vendorData.contact_no || '',
          email: vendorData.email || '',
          tax_id: vendorData.tax_id || '',
          state: vendorData.state || '',
          state_code: vendorData.state_code ? vendorData.state_code.toString() : ''
        });
      }
    } catch (error) {
      console.error('Error fetching vendor:', error);
      setErrors({ submit: 'Failed to load vendor data.' });
    } finally {
      setInitialLoading(false);
    }
  };

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
        state: selectedState.state_name,
        state_code: selectedState.id.toString()
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

      // Validate GSTIN format (15 characters only)
      if (formData.tax_id && formData.tax_id.length !== 15) {
        setErrors({ tax_id: 'GSTIN must be exactly 15 characters.' });
        setLoading(false);
        return;
      }

      // Validate email format
      if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
        setErrors({ email: 'Please enter a valid email address.' });
        setLoading(false);
        return;
      }

      // Show confirmation modal before submitting
      setConfirmData({
        vendor_name: formData.vendor_name
      });
      setShowConfirmModal(true);
      setLoading(false);
    } catch (error) {
      setErrors({ submit: 'An error occurred while processing the form.' });
      setLoading(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!confirmData) return;

    setIsSaving(true);

    try {
      const url = isEditing ? `/api/vendors/${id}` : '/api/vendors';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        // Broadcast the change to refresh other tabs
        if (isEditing) {
          broadcast({
            type: 'updated',
            resource: 'vendors',
            id: parseInt(id as string)
          });
        } else {
          broadcast({
            type: 'created',
            resource: 'vendors',
            data: { name: formData.vendor_name }
          });
        }

        // Close the current tab only if we opened it as a new tab for creation
        // Don't close if we were navigated to editing from within the app
        if (typeof window !== 'undefined' && !isEditing && window.opener) {
          router.push('/entry/vendordetails');
          setTimeout(() => window.close(), 100); // Small delay to let navigation happen first
        } else {
          router.push(isEditing ? `/vendors/view/${id}` : '/entry/vendordetails');
        }
      } else {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        setErrors({ submit: errorData.message || `Failed to ${isEditing ? 'update' : 'create'} vendor` });
      }
    } catch (error) {
      console.error('Network error:', error);
      setErrors({ submit: 'Network error occurred' });
    } finally {
      setIsSaving(false);
      setShowConfirmModal(false);
      setConfirmData(null);
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

  if (initialLoading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">


      {errors.submit && (
        <div className="card border-red-500 bg-red-500/10 p-4">
          <span className="text-red-400">⚠️ {errors.submit}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card">
          {/* Vendor Information */}
          <h2 className="text-xl font-semibold text-white mb-4">{isEditing ? 'Edit Vendor' : 'Vendor Information'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                City
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                className="input w-full"
                placeholder="City name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Pin Code
              </label>
              <input
                type="text"
                name="pin_code"
                value={formData.pin_code}
                onChange={(e) => handleChange({
                  ...e,
                  target: { ...e.target, name: 'pin_code', value: e.target.value.replace(/\D/g, '').slice(0, 6) }
                })}
                className="input w-full"
                placeholder="6-digit pin code"
                maxLength={6}
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
                maxLength={10}
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
                maxLength={15}
              />
              {errors.tax_id && <span className="text-red-400 text-sm">{errors.tax_id}</span>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                State
              </label>
              <select
                name="state"
                value={formData.state}
                onChange={(e) => handleStateChange(e.target.value)}
                className="select w-full"
              >
                <option value="">Select State</option>
                {states.map(state => (
                  <option key={state.id} value={state.state_name}>{state.state_name}</option>
                ))}
              </select>
            </div>


          </div>

          {/* Action Buttons */}
          <div className="border-t border-slate-600 pt-4 mt-6">
            <div className="flex justify-end gap-3">
              
              <button
                type="button"
                onClick={() => router.push('/entry/vendordetails')}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? (isEditing ? 'Updating Vendor...' : 'Creating Vendor...') : (isEditing ? 'Update Vendor' : 'Create Vendor')}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Pre-Submit Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={isEditing ? 'Update Vendor' : 'Create Vendor'}
        message={`Are you sure you want to ${isEditing ? 'update' : 'create'} vendor "${confirmData?.vendor_name}"?`}
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
