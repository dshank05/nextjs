import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileText, FileSpreadsheet } from 'lucide-react';

interface Column {
  key: string;
  label: string;
  enabled: boolean;
}

interface ExportConfig {
  title: string;
  fileName: string;
}

interface ExportMenuProps {
  data: any[];
  columns: Column[];
  config: ExportConfig;
  tableRef?: React.RefObject<HTMLElement>;
  onExport?: (exportType: 'excel' | 'pdf') => void;
  className?: string;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  data,
  columns,
  config,
  tableRef,
  onExport,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportPDF = () => {
    setIsOpen(false);

    if (onExport) {
      onExport('pdf');
      return;
    }

    // Default PDF export implementation
    const { exportToPDF } = require('../../lib/export-utils');
    const tableElement = tableRef?.current || document.querySelector('.table') as HTMLElement;

    if (tableElement) {
      exportToPDF(tableElement, data, config);
    } else {
      console.error('No table element found for PDF export');
      alert('Error: Could not find table element for PDF export');
    }
  };

  const handleExportExcel = () => {
    setIsOpen(false);

    if (onExport) {
      onExport('excel');
      return;
    }

    // Open column selector for Excel export
    setShowColumnSelector(true);
  };

  const handleColumnSelection = (selectedColumnKeys: string[]) => {
    setShowColumnSelector(false);

    const exportData = data.map(item => {
      const row: any = {};
      selectedColumnKeys.forEach(key => {
        // Find the column definition to get the proper label
        const columnDef = columns.find(col => col.key === key);
        const label = columnDef ? columnDef.label : key;

        // Map the data based on column key
        switch (key) {
          case 'id':
            row[label] = item.id || item.ID;
            break;
          case 'invoice_no':
            row[label] = item.invoice_no || item['Invoice No'];
            break;
          case 'customer_name':
          case 'customer_vendor_name':
            row[label] = item.customer_name || item.customer_vendor_name || item['Customer Name'] || '';
            break;
          case 'vendor_name':
            row[label] = item.vendor_name || item['Vendor Name'] || '';
            break;
          case 'total':
          case 'total_amount':
            row[label] = item.total || item.total_amount || item['Total Amount'] || 0;
            break;
          case 'invoice_date':
            row[label] = item.formattedDate || item.invoice_date || item['Invoice Date'] || '';
            break;
          case 'payment_status':
            row[label] = item.payment_status === 1 ? 'Paid' : 'Unpaid';
            break;
          case 'bill_reference':
            row[label] = item.bill_reference || item['Bill Reference'] || '';
            break;
          case 'name':
            row[label] = item.name || item['Name'] || '';
            break;
          case 'category_name':
            row[label] = item.category_name || item['Category'] || '';
            break;
          case 'company_name':
            row[label] = item.company_name || item['Company'] || '';
            break;
          case 'model_name':
            row[label] = item.model_name || item['Model'] || '';
            break;
          case 'stock_quantity':
            row[label] = item.stock_quantity || item['Stock'] || 0;
            break;
          case 'selling_price':
            row[label] = item.selling_price || item['Selling Price'] || 0;
            break;
          default:
            // For any other keys, try to get the value directly or use the key as label
            row[label] = item[key] || '';
        }
      });
      return row;
    });

    const { exportToExcelGeneric } = require('../../lib/export-utils');
    exportToExcelGeneric(exportData, config);
  };

  const cancelColumnSelection = () => {
    setShowColumnSelector(false);
  };

  return (
    <>
      <div className={`relative ${className}`} ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="btn-secondary flex items-center gap-2"
          type="button"
        >
          <FileText className="w-4 h-4" />
          Export
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-lg z-50">
            <div className="py-1">
              <button
                onClick={handleExportPDF}
                className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Export as PDF
              </button>
              <button
                onClick={handleExportExcel}
                className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export as Excel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Column Selector Modal */}
      {showColumnSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-6 rounded-lg w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">
              Select Columns for Excel Export
            </h2>

            <div className="mb-6">
              <div className="max-h-64 overflow-y-auto border border-slate-600 rounded p-3 bg-slate-900">
                {columns.filter(col => col.enabled).map((column) => (
                  <label key={column.key} className="flex items-center mb-2 last:mb-0">
                    <input
                      type="checkbox"
                      checked={true} // All enabled columns are selected by default
                      readOnly // For now, select all enabled columns
                      className="mr-3 h-4 w-4 text-blue-600 bg-slate-700 border-slate-500 rounded"
                    />
                    <span className="text-slate-300 text-sm">{column.label}</span>
                  </label>
                ))}
              </div>

              <div className="mt-2 text-xs text-slate-400">
                All available columns will be exported
              </div>
            </div>

            <div className="border-t border-slate-600 pt-4 flex justify-end space-x-3">
              <button
                type="button"
                onClick={cancelColumnSelection}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleColumnSelection(columns.filter(col => col.enabled).map(col => col.key))}
                className="btn-primary"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
