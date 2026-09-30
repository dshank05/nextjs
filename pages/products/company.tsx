import { useState, useEffect } from 'react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import { useExport } from '../../hooks/useExport';
import { ExportColumnSelector } from '../../components/ExportColumnSelector';
import { ClearableInput } from '../../components/common';
import { getLocalDateString } from '../../lib/date-utils';
import { useListQuery } from '../../hooks/useListQuery';
import { ListPagination, ListSummary, SortIcon, PageSizeSelect } from '../../components/common/ListPagination';

interface Company {
  id: number;
  company_name: string;
}

interface CompanyResponse {
  companies: Company[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean; };
}

export default function Companies() {
  const { showSnackbar } = useSnackbar();
  // Search, sort, page and limit: the shared list hook, as on the settings
  // pages (settings Block 8). This page had its own copy, with two
  // overlapping page-reset effects that fetched twice on every search (PQ-24).
  const list = useListQuery({ defaultSort: 'company_name' });
  const { pagination } = list;
  const sortProps = { sortBy: list.sortBy, sortOrder: list.sortOrder };
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCompanyData, setPendingCompanyData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [formData, setFormData] = useState({ id: 0, company_name: '' });


  // Column definitions for export
  const exportColumns = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'company_name', label: 'Company Name', enabled: true },
  ];

  // Export functionality
  const { showColumnSelector, openColumnSelector, closeColumnSelector } = useExport();

  const handleExport = (exportType: 'excel' | 'pdf') => {
    if (exportType === 'pdf') {
      // For PDF, export current table view
      const { exportToPDF } = require('../../lib/export-utils');
      const config = {
        title: 'Companies Report',
        fileName: `Companies_${getLocalDateString()}`
      };
      exportToPDF(document.querySelector('.table') as HTMLElement, companies, config);
    } else {
      // For Excel, show column selector
      openColumnSelector();
    }
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    closeColumnSelector();

    // Prepare data with selected columns
    const exportData = companies.map(company => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        switch (key) {
          case 'id':
            row.ID = company.id;
            break;
          case 'company_name':
            row['Company Name'] = company.company_name;
            break;
        }
      });
      return row;
    });

    // Export to Excel
    const { exportToExcelGeneric } = require('../../lib/export-utils');
    const config = {
      title: 'Companies Report',
      fileName: `Companies_${getLocalDateString()}`
    };
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    closeColumnSelector();
  };



  const query = list.params.toString();
  useEffect(() => {
    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchCompanies = async () => {
    const isCurrent = list.beginRequest();
    setLoading(true);
    try {
      const response = await fetch(`/api/products/companies?${query}`);
      if (!isCurrent()) return;
      if (response.ok) {
        const data: CompanyResponse = await response.json();
        if (!isCurrent()) return;
        setCompanies(data.companies);
        list.setPagination(data.pagination);
      } else {
        showSnackbar('error', 'Could not load companies');
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      showSnackbar('error', 'Could not load companies');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };





  const handleAdd = () => {
    setEditingCompany(null);
    setFormData({ id: 0, company_name: '' });
    setShowModal(true);
  };

  const handleEdit = (company: Company) => {
    setEditingCompany(company);
    setFormData({ id: company.id, company_name: company.company_name });
    setShowModal(true);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Store the pending data and show confirmation modal
    const isEditing = editingCompany !== null;
    const method = isEditing ? 'PUT' : 'POST';
    const body = isEditing ? { ...formData, id: editingCompany.id } : formData;

    setPendingCompanyData({ method, body });
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!pendingCompanyData || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/products/companies`, {
        method: pendingCompanyData.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingCompanyData.body),
      });
      if (response.ok) {
        setShowModal(false);
        setShowConfirmModal(false);
        setPendingCompanyData(null);
        fetchCompanies();
        showSnackbar('success', `Company ${pendingCompanyData.method === 'PUT' ? 'updated' : 'created'}`);
      } else {
        // A refused save (a duplicate name, say) used to close the dialog
        // exactly as a successful one did, and say nothing (PQ-05).
        const body = await response.json().catch(() => ({}));
        showSnackbar('error', body.message || 'Could not save the company');
      }
    } catch (error) {
      console.error('Error saving company:', error);
      showSnackbar('error', 'Network error while saving the company');
    } finally {
      setIsSaving(false);
      setShowConfirmModal(false);
      setPendingCompanyData(null);
    }
  };

  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setPendingCompanyData(null);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-1 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-2">Search Companies</label>
              <ClearableInput
                type="text"
                placeholder="Search companies..."
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
            <button className="btn-primary" onClick={handleAdd}>Add Company</button>
          </div>
        </div>

        {loading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            <ListSummary pagination={pagination} shown={companies.length} noun="companies" />

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('id')}>
                      ID <SortIcon field="id" {...sortProps} />
                    </th>
                    <th className="cursor-pointer hover:bg-slate-700/50" onClick={() => list.toggleSort('company_name')}>
                      Company Name <SortIcon field="company_name" {...sortProps} />
                    </th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company, i) => (
                    <tr key={company.id}>
                      <td>{list.serialNumber(i)}</td>
                      <td>{company.id}</td>
                      <td className="font-medium text-white">{company.company_name}</td>
                      <td className="text-right">
                        <button className="btn-secondary mr-2" onClick={() => handleEdit(company)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {companies.length === 0 && !loading && (
                <div className="text-center py-8 text-slate-400">No companies found.</div>
              )}
            </div>

            <ListPagination pagination={pagination} onPageChange={list.goToPage} />
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
          <div className="bg-slate-800 p-8 rounded-lg w-96 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">{editingCompany ? 'Edit Company' : 'Add Company'}</h2>
            <form onSubmit={handleSubmit}>
              {editingCompany && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Company ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    className="input w-full"
                    readOnly
                  />
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Company Name</label>
                <ClearableInput
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
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
        message={`Do you want to ${editingCompany ? 'edit' : 'create'} - ${formData.company_name} company?`}
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
