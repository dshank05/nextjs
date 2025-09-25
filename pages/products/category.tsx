import { useState, useEffect } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';

interface Category {
  id: number;
  category_name: string;
  index: number;
}

interface CategoryResponse {
  categories: Category[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('category_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCategoryData, setPendingCategoryData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ id: 0, category_name: '' });

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
    // Reset to first page when sorting
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  useEffect(() => {
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm, sortBy, sortOrder]);

  useEffect(() => {
    fetchCategories();
  }, [pagination.page, pagination.limit, debouncedSearchTerm, sortBy, sortOrder]);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm.trim(),
        sortBy: sortBy,
        sortOrder: sortOrder,
      });
      const response = await fetch(`/api/products/categories?${params}`);
      if (response.ok) {
        const data: CategoryResponse = await response.json();
        setCategories(data.categories);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
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
    setEditingCategory(null);
    setFormData({ id: 0, category_name: '' });
    setShowModal(true);
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({ id: category.id, category_name: category.category_name });
    setShowModal(true);
  };

  // const handleDelete = async (id: number) => {
  //   if (confirm('Are you sure you want to delete this category?')) {
  //     try {
  //       const response = await fetch(`/api/products/categories`, {
  //         method: 'DELETE',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({ id }),
  //       });
  //       if (response.ok) {
  //         fetchCategories();
  //       }
  //     } catch (error) {
  //       console.error('Error deleting category:', error);
  //     }
  //   }
  // };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Store the pending data and show confirmation modal
    const isEditing = editingCategory !== null;
    const method = isEditing ? 'PUT' : 'POST';
    const body = isEditing ? { ...formData, id: editingCategory.id } : formData;

    setPendingCategoryData({ method, body });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingCategoryData || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/products/categories`, {
        method: pendingCategoryData.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingCategoryData.body),
      });
      if (response.ok) {
        setShowModal(false);
        setShowConfirmModal(false);
        setPendingCategoryData(null);
        fetchCategories();
      }
    } catch (error) {
      console.error('Error saving category:', error);
    } finally {
      setIsSaving(false);
      setShowConfirmModal(false);
      setPendingCategoryData(null);
    }
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="inline w-4 h-4 ml-1" />;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setPendingCategoryData(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={handleAdd}>Add Category</button>
      </div>

      <div className="card">
        <div className="flex items-end justify-between">
          <div className="flex items-end space-x-4">
            <div className="w-80">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Categories</label>
              <input
                type="text"
                placeholder="Search categories..."
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
              <div>Showing {categories.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} categories</div>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('id')}>
                      ID {getSortIcon('id')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('category_name')}>
                      Category Name {getSortIcon('category_name')}
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <td>{category.index}</td>
                      <td>{category.id}</td>
                      <td className="font-medium text-white">{category.category_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(category)}>Edit</button>
                        {/* <button className="btn-danger" onClick={() => handleDelete(category.id)}>Delete</button> */}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {categories.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No categories found.</div>
              )}
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingCategory ? 'Edit Category' : 'Add Category'}</h2>
            <form onSubmit={handleSubmit}>
              {editingCategory && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Category ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Category Name</label>
                <input
                  type="text"
                  value={formData.category_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, category_name: e.target.value }))}
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

      <ConfirmationModal
        isOpen={showConfirmModal}
        title="Confirm Action"
        message={`Do you want to ${editingCategory ? 'edit' : 'create'} - ${formData.category_name} category?`}
        showLoading={isSaving}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelConfirm}
      />
    </div>
  );
}
