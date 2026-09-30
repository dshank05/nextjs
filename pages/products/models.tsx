import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ClearableInput } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';

interface Model {
  id: number;
  model_name: string;
}

interface ModelResponse {
  models: Model[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Models() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook, as on the settings
  // pages (settings Block 8). This page had its own copy, with two
  // overlapping page-reset effects that fetched twice on every search (PQ-24).
  const list = useListQuery({ defaultSort: 'model_name' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingModelData, setPendingModelData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [formData, setFormData] = useState({ id: 0, model_name: '' });


  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'model_name', label: 'Car Model Name', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Car Models Report',
        fileName: `Car_Models_${getLocalDateString()}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, models, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = models.map(model => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = model.id;
            break;
          case 'model_name':
            row['Car Model Name'] = model.model_name;
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Car Models Report',
      fileName: `Car_Models_${getLocalDateString()}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };



  const query = list.params.toString();
  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchModels = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/products/models?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data: ModelResponse = await response.json();
        if (!isCurrent()) return;
        setModels(data.models);
        list.setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Could not load models');
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      showSnackbar('error', 'Could not load models');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };





  const handleAdd = () => {
    setEditingModel(null);
    setFormData({ id: 0, model_name: '' });
    setShowModal(true);
  };

  const handleEdit = (model: Model) => {
    setEditingModel(model);
    setFormData({ id: model.id, model_name: model.model_name });
    setShowModal(true);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Store the pending data and show confirmation modal
    const isEditing = editingModel !== null;
    const method = isEditing ? 'PUT' : 'POST';
    const body = isEditing ? { ...formData, id: editingModel.id } : formData;

    setPendingModelData({ method, body });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingModelData || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/products/models`, {
        method: pendingModelData.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingModelData.body),
      });
      if (response.ok) {
        setShowModal(false);
        setShowConfirmModal(false);
        setPendingModelData(null);
        fetchModels();
        showSnackbar('success', `Model ${pendingModelData.method === 'PUT' ? 'updated' : 'created'}`);
      } else {
        // A refused save (a duplicate name, say) used to close the dialog
        // exactly as a successful one did, and say nothing (PQ-05).
        const body = await response.json().catch(() => ({}));
        showSnackbar('error', body.message || 'Could not save the model');
      }
    } catch (error) {
      console.error('Error saving model:', error);
      showSnackbar('error', 'Network error while saving the model');
    } finally {
      setIsSaving(false);
      setShowConfirmModal(false);
      setPendingModelData(null);
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setPendingModelData(null);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Car Models</label>
              <ClearableInput
                type="text"
                placeholder="Search car models..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </div>
            <PageSizeSelect limit={list.limit} onChange={list.setLimit} />
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => handleExport('excel')}>
              📊 Export Excel
            </button>
            <button className="btn-secondary" onClick={() => handleExport('pdf')}>
              📄 Export PDF
            </button>
            {/* <button onClick={() => setSearchTerm('')} className="btn-secondary mr-2">Clear</button> */}
            <button className="btn-primary" onClick={handleAdd}>Add Car Model</button>
          </div>
        </div>
        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={models.length} noun="car models" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('model_name')}>
                      Car Model Name <SortIcon field="model_name" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model, i) => (
                    <tr key={model.id}>
                      <td>{list.serialNumber(i)}</td>
                      <td>{model.id}</td>
                      <td className="font-medium text-white">{model.model_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(model)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {models.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No car models found.</div>
              )}
            </div>

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingModel ? 'Edit Car Model' : 'Add Car Model'}</h2>
            <form onSubmit={handleSubmit}>
              {editingModel && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Car Model ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Car Model Name</label>
                <ClearableInput
                  type="text"
                  value={formData.model_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, model_name: e.target.value }))}
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
        message={`Do you want to ${editingModel ? 'edit' : 'create'} - ${formData.model_name} car model?`}
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
