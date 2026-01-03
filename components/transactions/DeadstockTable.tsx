import React, { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, Edit, Trash2 } from 'lucide-react';
import { ClearableInput } from '../common';
import DeadstockModal from '../DeadstockModal';
import { ConfirmationModal } from '../ConfirmationModal';
import { useSnackbar } from '../SnackbarProvider';

interface Deadstock {
  id: number;
  product_id: number;
  product_name: string;
  part_no: string;
  quantity: number;
  reason: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  formatted_created_at: string;
  formatted_updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface DeadstockTableProps {
  deadstock: Deadstock[];
  pagination: Pagination;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (value: number) => void;
  onRefresh: () => void;
  sortBy?: SortField;
  sortOrder?: SortOrder;
}

type SortField = 'id' | 'product_name' | 'quantity' | 'reason' | 'created_by' | 'created_at' | 'updated_at';
type SortOrder = 'asc' | 'desc';

export const DeadstockTable: React.FC<DeadstockTableProps> = ({
  deadstock,
  pagination,
  loading,
  onPageChange,
  searchTerm,
  onSearchChange,
  itemsPerPage,
  onItemsPerPageChange,
  onRefresh,
  sortBy: propSortBy = 'created_at',
  sortOrder: propSortOrder = 'desc'
}) => {
  const { showSnackbar } = useSnackbar();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeadstock, setEditingDeadstock] = useState<any>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingDeadstock, setDeletingDeadstock] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Use props for sorting state (controlled component)
  const sortBy = propSortBy;
  const sortOrder = propSortOrder;

  const handleSort = (field: SortField) => {
    // This would be handled by the parent component
    // For now, we'll implement client-side sorting
    console.log('Sort by:', field);
  };

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) {
      return null;
    }
    return sortOrder === 'asc' ?
      <ArrowUp className="inline w-4 h-4 ml-1" /> :
      <ArrowDown className="inline w-4 h-4 ml-1" />;
  };

  const handleEdit = (item: Deadstock) => {
    setEditingDeadstock({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      part_no: item.part_no,
      available_stock: 0, // We'll fetch this in the modal
      quantity: item.quantity,
      reason: item.reason,
      created_by: item.created_by
    });
    setModalOpen(true);
  };

  const handleDelete = (item: Deadstock) => {
    setDeletingDeadstock(item);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingDeadstock) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/deadstock/${deletingDeadstock.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        showSnackbar('success', data.message || 'Deadstock entry deleted successfully!');
        onRefresh();
        setDeleteModalOpen(false);
        setDeletingDeadstock(null);
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to delete deadstock entry');
      }
    } catch (error) {
      console.error('Error deleting deadstock:', error);
      showSnackbar('error', 'Network error occurred');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingDeadstock(null);
  };

  const handleModalSuccess = () => {
    onRefresh();
  };

  const getPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <>
      <div className="card">
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => {
              setEditingDeadstock(null);
              setModalOpen(true);
            }}
            className="btn-primary"
          >
            Add to Deadstock
          </button>
        </div>

        {/* Search Section */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
            <ClearableInput
              type="text"
              placeholder="Search products, reasons, or creators..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>

        {/* Table Section */}
        {pagination && (
          <div className="mb-4 flex justify-between items-center text-sm text-slate-400">
            <div>Showing {deadstock.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} deadstock entries</div>
            <div>Page {pagination.page} of {pagination.totalPages}</div>
          </div>
        )}

        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10 rounded-lg">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('product_name')}>
                  Product {getSortIcon('product_name')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('quantity')}>
                  Quantity {getSortIcon('quantity')}
                </th>
                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('reason')}>
                  Reason {getSortIcon('reason')}
                </th>

                <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => handleSort('created_at')}>
                  Created Date {getSortIcon('created_at')}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deadstock.map((item, idx) => (
                <tr key={item.id}>
                  <td>{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                  <td className="text-slate-300">
                    <div className="font-medium">{item.product_name}</div>
                    {item.part_no && (
                      <div className="text-xs text-slate-400">Part: {item.part_no}</div>
                    )}
                  </td>
                  <td className="text-slate-300 font-semibold">{item.quantity}</td>
                  <td className="text-slate-300 max-w-xs">
                    <div className="truncate" title={item.reason}>
                      {item.reason}
                    </div>
                  </td>
                  <td className="text-slate-300">{item.formatted_created_at}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(item)}
                        title="Edit Deadstock"
                        className="btn-icon text-blue-400 hover:text-blue-300"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        title="Delete Deadstock"
                        className="btn-icon text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {deadstock.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm
                ? 'No deadstock entries found with the current search.'
                : 'No deadstock entries found. Click "Add to Deadstock" to create your first entry.'
              }
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            <button onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page === 1} className="btn-secondary disabled:opacity-50">Previous</button>
            <div className="flex space-x-2">
              {pagination.page > 3 && <> <button onClick={() => onPageChange(1)} className="px-3 py-1 rounded hover:bg-slate-700">1</button> <span>...</span> </>}
              {getPageNumbers().map(p => <button key={p} onClick={() => onPageChange(p)} className={`px-3 py-1 rounded ${p === pagination.page ? 'bg-blue-600 text-white' : 'hover:bg-slate-700'}`}>{p}</button>)}
              {pagination.page < pagination.totalPages - 2 && <> <span>...</span> <button onClick={() => onPageChange(pagination.totalPages)} className="px-3 py-1 rounded hover:bg-slate-700">{pagination.totalPages}</button> </>}
            </div>
            <button onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page === pagination.totalPages} className="btn-secondary disabled:opacity-50">Next</button>
          </div>
        )}
      </div>

      {/* Modals */}
      <DeadstockModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSuccess={handleModalSuccess}
        editingDeadstock={editingDeadstock}
      />

      <ConfirmationModal
        isOpen={deleteModalOpen}
        title="Delete Deadstock Entry"
        message={`Are you sure you want to delete this deadstock entry for "${deletingDeadstock?.product_name}"? This will return ${deletingDeadstock?.quantity} units back to inventory.`}
        confirmText="Delete & Return Stock"
        cancelText="Cancel"
        showLoading={deleteLoading}
        loadingText="Deleting..."
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteModalOpen(false);
          setDeletingDeadstock(null);
        }}
      />
    </>
  );
};
