import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';

interface BusinessDetailsData {
  id: number;
  gstin: string;
  name: string;
  tagline: string;
  address_line_1: string;
  address_line_2: string;
  pin_code: string;
  phone: string;
  phone2: string;
  email: string;
  fax: string;
  terms: string;
}

export default function BusinessDetails() {
  const { showSnackbar } = useSnackbar();
  const [businessData, setBusinessData] = useState<BusinessDetailsData>({
    id: 1,
    gstin: '',
    name: '',
    tagline: '',
    address_line_1: '',
    address_line_2: '',
    pin_code: '',
    phone: '',
    phone2: '',
    email: '',
    fax: '',
    terms: ''
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState(businessData);
  const [loading, setLoading] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingData, setPendingData] = useState<BusinessDetailsData | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchBusinessDetails();
  }, []);

  const fetchBusinessDetails = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/business-details');
      if (response.ok) {
        const data = await response.json();
        // Handle empty object from API when no data exists
        const businessDetails = Object.keys(data).length === 0 ? {
          id: 0,
          gstin: '',
          name: '',
          tagline: '',
          address_line_1: '',
          address_line_2: '',
          pin_code: '',
          phone: '',
          phone2: '',
          email: '',
          fax: '',
          terms: ''
        } : data;
        setBusinessData(businessDetails);
        setEditedData(businessDetails);
      } else {
        console.error('Failed to fetch business details');
        showSnackbar('error', 'Failed to load business details');
      }
    } catch (error) {
      console.error('Error fetching business details:', error);
      showSnackbar('error', 'Failed to load business details');
    } finally {
      setLoading(false);
    }
  };

  const validatePhoneNumbers = () => {
    // If phone is present, it must be exactly 10 digits
    if (editedData.phone && editedData.phone.length !== 10) {
      showSnackbar('error', 'Phone number must be exactly 10 digits');
      return false;
    }

    // If phone2 is present, it must be exactly 10 digits
    if (editedData.phone2 && editedData.phone2.length !== 10) {
      showSnackbar('error', 'Phone 2 number must be exactly 10 digits');
      return false;
    }

    // If landline is present, it must be exactly 10 digits
    if (editedData.fax && editedData.fax.length !== 10) {
      showSnackbar('error', 'Landline number must be exactly 10 digits');
      return false;
    }

    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate phone numbers
    if (!validatePhoneNumbers()) {
      return;
    }

    // Show confirmation modal before saving
    setPendingData(editedData);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingData) return;

    setIsSaving(true);

    try {
      const response = await fetch('/api/business-details', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pendingData),
      });

      if (response.ok) {
        const result = await response.json();
        // Success - close modals and update with returned data (includes new id if created)
        setShowConfirmModal(false);
        const updatedData = result.data || pendingData;
        setBusinessData(updatedData);
        setEditedData(updatedData);
        setIsEditing(false);
        setPendingData(null);
        showSnackbar('success', result.message || 'Business details saved successfully!');
      } else {
        // Error - keep modals open and show error
        const error = await response.json();
        console.error('Error saving business details:', error);
        showSnackbar('error', error.message || 'Failed to save business details');
        setShowConfirmModal(false);
      }
    } catch (error) {
      console.error('Error saving business details:', error);
      showSnackbar('error', `Failed to save business details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowConfirmModal(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmModal(false);
    setPendingData(null);
  };

  const handleCancel = () => {
    setEditedData(businessData);
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Company Information</h2>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="btn-primary flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              ) : (
                <div className="flex space-x-3">
                  <button
                    onClick={handleCancel}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    className="btn-primary"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Company Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.name}
                        onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                        className="input w-full"
                        required
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.name || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Tagline
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.tagline}
                        onChange={(e) => setEditedData({ ...editedData, tagline: e.target.value })}
                        className="input w-full"
                        placeholder="Optional"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.tagline || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Address Line 1
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.address_line_1}
                        onChange={(e) => setEditedData({ ...editedData, address_line_1: e.target.value })}
                        className="input w-full"
                        required
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.address_line_1 || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Address Line 2
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.address_line_2}
                        onChange={(e) => setEditedData({ ...editedData, address_line_2: e.target.value })}
                        className="input w-full"
                        placeholder="Optional"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.address_line_2 || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Pin Code
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.pin_code}
                        onChange={(e) => setEditedData({ ...editedData, pin_code: e.target.value })}
                        className="input w-full"
                        placeholder="Optional"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.pin_code || '-'}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      GSTIN
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.gstin}
                        onChange={(e) => setEditedData({ ...editedData, gstin: e.target.value })}
                        className="input w-full"
                        required
                        maxLength={15}
                        placeholder="15 characters"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.gstin || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Phone
                    </label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedData.phone}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 10) {
                            setEditedData({ ...editedData, phone: value });
                          }
                        }}
                        className="input w-full"
                        placeholder="Exactly 10 digits"
                        maxLength={10}
                        pattern="[0-9]{10}"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.phone || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Phone 2
                    </label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedData.phone2}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 10) {
                            setEditedData({ ...editedData, phone2: value });
                          }
                        }}
                        className="input w-full"
                        placeholder="Exactly 10 digits (optional)"
                        maxLength={10}
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.phone2 || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Email
                    </label>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editedData.email}
                        onChange={(e) => setEditedData({ ...editedData, email: e.target.value })}
                        className="input w-full"
                        placeholder="Optional"
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.email || '-'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Landline
                    </label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedData.fax}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 10) {
                            setEditedData({ ...editedData, fax: value });
                          }
                        }}
                        className="input w-full"
                        placeholder="Exactly 10 digits"
                        maxLength={10}
                      />
                    ) : (
                      <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.fax || '-'}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-700">
                <label className="block text-sm font-medium text-slate-300 mb-3">
                  Terms & Conditions
                </label>
                {isEditing ? (
                  <textarea
                    value={editedData.terms}
                    onChange={(e) => setEditedData({ ...editedData, terms: e.target.value })}
                    className="input w-full h-24"
                    placeholder="Optional"
                  />
                ) : (
                  <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.terms || '-'}</p>
                )}
              </div>
            </form>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Update Business Details?"
        message="Are you sure you want to update the business details?"
        confirmText="Update Details"
        cancelText="Cancel"
        showLoading={isSaving}
        loadingText="Updating Business Details..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div>
  );
}
