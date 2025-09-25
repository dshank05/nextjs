import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';

interface Staff {
  id: number;
  name: string;
  role: string;
  department: string;
  email: string;
  status: string;
  index: number;
}

interface StaffResponse {
  staff: Staff[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function StaffDetails() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [formData, setFormData] = useState({ id: 0, name: '', role: '', department: '', email: '' });

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  useEffect(() => {
    fetchStaff();
  }, [pagination.page, pagination.limit, debouncedSearchTerm]);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      // For now, we'll use mock data since we don't have the API endpoint yet
      const mockData: StaffResponse = {
        staff: [
          {
            id: 1,
            name: 'John Doe',
            role: 'Manager',
            department: 'Sales',
            email: 'john@baijnathsons.com',
            status: 'Active',
            index: 1
          },
          {
            id: 2,
            name: 'Jane Smith',
            role: 'Sales Rep',
            department: 'Sales',
            email: 'jane@baijnathsons.com',
            status: 'Active',
            index: 2
          },
          {
            id: 3,
            name: 'Bob Johnson',
            role: 'Mechanic',
            department: 'Service',
            email: 'bob@baijnathsons.com',
            status: 'Active',
            index: 3
          },
        ],
        pagination: { page: 1, limit: 50, total: 3, totalPages: 1, hasMore: false }
      };

      setStaff(mockData.staff);
      setPagination(mockData.pagination);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const handleAdd = () => {
    setEditingStaff(null);
    setFormData({ id: 0, name: '', role: '', department: '', email: '' });
    setShowModal(true);
  };

  const handleEdit = (staffMember: Staff) => {
    setEditingStaff(staffMember);
    setFormData({
      id: staffMember.id,
      name: staffMember.name,
      role: staffMember.role,
      department: staffMember.department,
      email: staffMember.email
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // This will be replaced with actual API call when the endpoint is ready
      console.log('Saving staff:', formData);
      setShowModal(false);
      fetchStaff(); // Refresh the list
    } catch (error) {
      console.error('Error saving staff:', error);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Staff Member</button>
      </div>

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Staff</label>
              <input
                type="text"
                placeholder="Search staff..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input w-full"
              />
            </div>
            <div className="w-40">
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="w-24">
            <button onClick={() => setSearchTerm('')} className="btn-secondary w-full">Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {staff.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} staff members</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((member) => (
                    <tr key={member.id}>
                      <td>{member.index}</td>
                      <td>{member.id}</td>
                      <td className="font-medium text-white">{member.name}</td>
                      <td className="text-white">{member.role}</td>
                      <td className="text-slate-300">{member.department}</td>
                      <td className="text-slate-300">{member.email}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          member.status === 'Active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {member.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(member)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
                <button onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
                <div className="flex space-x-2">
                  {pagination.page > 3 && <> <button onClick={() => handlePageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
                  {getPageNumbers().map(p => <button key={p} onClick={() => handlePageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
                  {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => handlePageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
                </div>
                <button onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
            <form onSubmit={handleSubmit}>
              {editingStaff && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Staff ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="select w-full"
                  required
                >
                  <option value="">Select role</option>
                  <option value="Manager">Manager</option>
                  <option value="Sales Rep">Sales Rep</option>
                  <option value="Mechanic">Mechanic</option>
                  <option value="Accountant">Accountant</option>
                  <option value="Warehouse Staff">Warehouse Staff</option>
                </select>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Department</label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                  className="select w-full"
                  required
                >
                  <option value="">Select department</option>
                  <option value="Sales">Sales</option>
                  <option value="Service">Service</option>
                  <option value="Accounting">Accounting</option>
                  <option value="Warehouse">Warehouse</option>
                  <option value="Management">Management</option>
                </select>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div className="border-t border-slate-600 pt-4 mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
