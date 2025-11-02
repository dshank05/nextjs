import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';

interface Category {
  id: number;
  category_name: string;
}

interface Subcategory {
  id: number;
  subcategory_name: string;
  category_id?: number;
  index: number;
  category?: Category;
}

interface SubcategoryResponse {
  subcategories: Subcategory[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Subcategories() {
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [mainCategorySearchTerm, setMainCategorySearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('subcategory_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSubcategoryData, setPendingSubcategoryData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null);
  const [formData, setFormData] = useState({ id: 0, subcategory_name: '', category_id: 0, category_name: '' });
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const debouncedMainCategorySearchTerm = useDebounce(mainCategorySearchTerm, 300);

  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'category_name', label: 'Category', enabled: true },
    { key: 'subcategory_name', label: 'Subcategory Name', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Product Subcategories Report',
        fileName: `Product_Subcategories_${new Date().toISOString().split('T')[0]}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, subcategories, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = subcategories.map(subcategory => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = subcategory.id;
            break;
          case 'category_name':
            row.Category = subcategory.category?.category_name || 'N/A';
            break;
          case 'subcategory_name':
            row['Subcategory Name'] = subcategory.subcategory_name;
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Product Subcategories Report',
      fileName: `Product_Subcategories_${new Date().toISOString().split('T')[0]}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };

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
    // Prevent multiple calls during initial load
    if (isInitialLoad) {
      setIsInitialLoad(false);
      fetchCategories();
      fetchSubcategories();
      return;
    }

    // Only reset pagination and fetch when search/sort actually changes
    if (!loading) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearchTerm, debouncedMainCategorySearchTerm, sortBy, sortOrder]);

  useEffect(() => {
    // Skip initial load call since it's handled above
    if (isInitialLoad) return;

    fetchCategories();
    fetchSubcategories();
  }, [pagination.page, pagination.limit]);

  // Close category dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if ((event.target as Element)?.closest('.category-dropdown') === null) {
        setShowCategoryDropdown(false);
        setCategorySearchTerm('');
      }
    };
    if (showCategoryDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCategoryDropdown]);

  const filteredCategories = categories.filter(category =>
    category.category_name.toLowerCase().includes(categorySearchTerm.toLowerCase())
  );

  const handleCategorySelect = (category: Category | null) => {
    if (category) {
      setFormData(prev => ({ ...prev, category_id: category.id, category_name: category.category_name }));
    }
    setShowCategoryDropdown(false);
    setCategorySearchTerm('');
  };

  const handleCategoryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCategorySearchTerm(value);
    setFormData(prev => ({ ...prev, category_name: value, category_id: 0 }));
    setShowCategoryDropdown(true);
  };

  const handleCategoryInputFocus = () => {
    setShowCategoryDropdown(true);
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/products/categories?limit=1000');
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchSubcategories = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: debouncedSearchTerm.trim(),
        category_search: debouncedMainCategorySearchTerm.trim(),
        sortBy: sortBy,
        sortOrder: sortOrder,
      });
      const response = await fetch(`/api/products/subcategories?${params}`);
      if (response.ok) {
        const data: SubcategoryResponse = await response.json();
        setSubcategories(data.subcategories);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching subcategories:', error);
    } finally {
      setLoading(false);
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
    setEditingSubcategory(null);
    setFormData({ id: 0, subcategory_name: '', category_id: 0, category_name: '' });
    setShowModal(true);
  };

  const handleEdit = (subcategory: Subcategory) => {
    setEditingSubcategory(subcategory);
    setFormData({
      id: subcategory.id,
      subcategory_name: subcategory.subcategory_name,
      category_id: subcategory.category_id || 0,
      category_name: subcategory.category?.category_name || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.category_name || !formData.subcategory_name) {
      alert('Please fill in all required fields');
      return;
    }

    // Store the pending data and show confirmation modal
    const isEditing = editingSubcategory !== null;
    const method = isEditing ? 'PUT' : 'POST';
    const body = isEditing ? { ...formData, id: editingSubcategory.id } : formData;

    setPendingSubcategoryData({ method, body });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingSubcategoryData || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/products/subcategories`, {
        method: pendingSubcategoryData.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingSubcategoryData.body),
      });
      if (response.ok) {
        setShowModal(false);
        setShowConfirmModal(false);
        setPendingSubcategoryData(null);
        fetchSubcategories();
      }
    } catch (error) {
      console.error('Error saving subcategory:', error);
    } finally {
      setIsSaving(false);
      setShowConfirmModal(false);
      setPendingSubcategoryData(null);
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setPendingSubcategoryData(null);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-2xl">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
              <input
                type="text"
                placeholder="Search categories..."
                value={mainCategorySearchTerm}
                onChange={(e) => setMainCategorySearchTerm(e.target.value)}
                className="input w-full"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory</label>
              <input
                type="text"
                placeholder="Search subcategories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Items per page</label>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="select w-full min-w-24"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => handleExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => handleExport('pdf')}>
              📄 Export PDF
            </button>
            {/* <button onClick={() => setSearchTerm('')} className="btn-secondary mr-2">Clear</button> */}
            <button className="btn-primary" onClick={handleAdd}>Add Subcategory</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
              <div>Showing {subcategories.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} subcategories</div>
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
                      Category {getSortIcon('category_name')}
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('subcategory_name')}>
                      Subcategory Name {getSortIcon('subcategory_name')}
                    </th>
                    
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subcategories.map((subcategory) => (
                    <tr key={subcategory.id}>
                      <td>{subcategory.index}</td>
                      <td>{subcategory.id}</td>
                      <td className="text-slate-300">
                        {subcategory.category ? subcategory.category.category_name : 'N/A'}
                      </td>
                      <td className="font-medium text-white">{subcategory.subcategory_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(subcategory)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {subcategories.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No subcategories found.</div>
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
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingSubcategory ? 'Edit Subcategory' : 'Add Subcategory'}</h2>
            <form onSubmit={handleSubmit}>
              {editingSubcategory && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}

              <div className="mb-6 category-dropdown">
                <label className="block text-sm font-medium text-slate-300 mb-2">Category *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.category_name}
                    onChange={handleCategoryInputChange}
                    onFocus={handleCategoryInputFocus}
                    className="input w-full pr-8"
                    placeholder="Select or enter new category"
                    required
                  />
                  <ChevronDown className="absolute right-2 top-2.5 w-5 h-5 text-slate-400 pointer-events-none" />
                  {showCategoryDropdown && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      <div className="py-1">
                        {filteredCategories.length > 0 ? (
                          filteredCategories.map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                              onClick={() => handleCategorySelect(category)}
                            >
                              {category.category_name}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-slate-500 text-sm">No categories found</div>
                        )}
                        {showCategoryDropdown && categorySearchTerm && (
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-slate-700 text-blue-400 hover:text-blue-300 transition-colors border-t border-slate-600"
                            onClick={() => handleCategorySelect(null)}
                          >
                            Create "{categorySearchTerm}"
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory Name *</label>
                <input
                  type="text"
                  value={formData.subcategory_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, subcategory_name: e.target.value }))}
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
        message={`Do you want to ${editingSubcategory ? 'edit' : 'create'} the subcategory - ${formData.subcategory_name}?`}
        showLoading={isSaving}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelConfirm}
      />

      <ExportColumnSelector
        isOpen={showColumnSelector}
        title="Select Columns for Excel Export"
        columns={exportColumns}
        onConfirm={handleColumnSelection}
        onCancel={cancelColumnSelection}
      />
    </div>
  );
}
