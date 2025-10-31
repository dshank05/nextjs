import React, { useState, useEffect } from 'react';

interface Column {
  key: string;
  label: string;
  enabled: boolean;
}

interface ExportColumnSelectorProps {
  isOpen: boolean;
  title: string;
  columns: Column[];
  onConfirm: (selectedColumns: string[]) => void;
  onCancel: () => void;
  showFileFormat?: boolean;
}

export const ExportColumnSelector: React.FC<ExportColumnSelectorProps> = ({
  isOpen,
  title,
  columns,
  onConfirm,
  onCancel,
  showFileFormat = false
}) => {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [fileFormat, setFileFormat] = useState<'excel' | 'pdf'>('excel');

  useEffect(() => {
    if (isOpen) {
      // Initialize with all enabled columns selected
      const initiallySelected = columns.filter(col => col.enabled).map(col => col.key);
      setSelectedColumns(initiallySelected);
      setFileFormat('excel');
    }
  }, [isOpen, columns]);

  if (!isOpen) return null;

  const handleColumnToggle = (columnKey: string) => {
    setSelectedColumns(prev =>
      prev.includes(columnKey)
        ? prev.filter(key => key !== columnKey)
        : [...prev, columnKey]
    );
  };

  const handleSelectAll = () => {
    setSelectedColumns(columns.map(col => col.key));
  };

  const handleDeselectAll = () => {
    setSelectedColumns([]);
  };

  const handleConfirm = () => {
    onConfirm(selectedColumns);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 p-6 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-600 pb-4">
          {title}
        </h2>

        {showFileFormat && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">Export Format</label>
            <div className="flex space-x-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="format"
                  value="excel"
                  checked={fileFormat === 'excel'}
                  onChange={(e) => setFileFormat(e.target.value as 'excel' | 'pdf')}
                  className="mr-2"
                />
                <span className="text-slate-300">Excel</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="format"
                  value="pdf"
                  checked={fileFormat === 'pdf'}
                  onChange={(e) => setFileFormat(e.target.value as 'excel' | 'pdf')}
                  className="mr-2"
                />
                <span className="text-slate-300">PDF</span>
              </label>
            </div>
          </div>
        )}

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-slate-300">Select Columns</label>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-xs bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded transition-colors"
              >
                Deselect All
              </button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto border border-slate-600 rounded p-3 bg-slate-900">
            {columns.map((column) => (
              <label key={column.key} className="flex items-center mb-2 last:mb-0">
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(column.key)}
                  onChange={() => handleColumnToggle(column.key)}
                  className="mr-3 h-4 w-4 text-blue-600 bg-slate-700 border-slate-500 rounded focus:ring-blue-500"
                />
                <span className="text-slate-300 text-sm">{column.label}</span>
              </label>
            ))}
          </div>

          <div className="mt-2 text-xs text-slate-400">
            Selected: {selectedColumns.length} of {columns.length} columns
          </div>
        </div>

        <div className="border-t border-slate-600 pt-4 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedColumns.length === 0}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
