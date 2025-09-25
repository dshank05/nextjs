import { useState } from 'react';

interface BusinessDetailsData {
  id: number;
  gstin: string;
  name: string;
  tagline: string;
  address_line_1: string;
  address_line_2: string;
  phone: string;
  email: string;
  fax: string;
  terms: string;
}

export default function BusinessDetails() {
  const [businessData, setBusinessData] = useState<BusinessDetailsData>({
    id: 1,
    gstin: '22AAAAA0000A1Z5',
    name: 'Baijnath Sons',
    tagline: 'Leading Automotive Parts Supplier',
    address_line_1: '123 Main Street',
    address_line_2: 'New Delhi, India',
    phone: '+91-9876543210',
    email: 'info@baijnathsons.com',
    fax: '+91-11-12345678',
    terms: 'Standard terms and conditions apply.'
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState(businessData);

  const handleSave = () => {
    setBusinessData(editedData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedData(businessData);
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">

      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white">Company Information</h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="btn-primary"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Details
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
                onClick={handleSave}
                className="btn-primary"
              >
                Save Changes
              </button>
            </div>
          )}
        </div>

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
                />
              ) : (
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.name}</p>
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
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.tagline || 'Not specified'}</p>
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
                />
              ) : (
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.address_line_1}</p>
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
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.address_line_2 || 'Not specified'}</p>
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
                />
              ) : (
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.gstin}</p>
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
                  onChange={(e) => setEditedData({ ...editedData, phone: e.target.value })}
                  className="input w-full"
                  placeholder="Optional"
                />
              ) : (
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.phone || 'Not specified'}</p>
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
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.email || 'Not specified'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Fax
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedData.fax}
                  onChange={(e) => setEditedData({ ...editedData, fax: e.target.value })}
                  className="input w-full"
                  placeholder="Optional"
                />
              ) : (
                <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.fax || 'Not specified'}</p>
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
            <p className="text-white py-2 px-3 bg-slate-700 rounded">{businessData.terms || 'Not specified'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
