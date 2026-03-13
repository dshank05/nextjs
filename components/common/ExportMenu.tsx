import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileText, FileSpreadsheet, Printer } from 'lucide-react';
import { getLocalDateString } from '../../lib/date-utils';

interface Column {
  key: string;
  label: string;
  enabled: boolean;
}

interface ExportConfig {
  title: string;
  fileName: string;
  dropdownOptions?: Record<string, string[]>; // Column name -> array of dropdown options
}

interface ExportMenuProps {
  data: any[];
  columns: Column[];
  config: ExportConfig;
  tableRef?: React.RefObject<HTMLElement>;
  onExport?: (exportType: 'excel' | 'pdf' | 'print') => void;
  pageType?: 'data' | 'view';
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
  const [businessDetails, setBusinessDetails] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Detect if this is a view page
  const isViewPage = () => {
    // Check URL for /view/ pattern
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/view/');
    }
    // Fallback: check data structure (view pages have single object, tables have arrays)
    return data && !Array.isArray(data);
  };

  // Fetch business details on component mount
  useEffect(() => {
    const fetchBusinessDetails = async () => {
      try {
        const response = await fetch('/api/business-details');
        if (response.ok) {
          const data = await response.json();
          setBusinessDetails(data);
        }
      } catch (error) {
        console.error('Failed to fetch business details:', error);
      }
    };

    fetchBusinessDetails();
  }, []);

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

  const handleExportPDF = async () => {
    setIsOpen(false);

    if (onExport) {
      onExport('pdf');
      return;
    }

    try {

      // Add print-specific styles to current page
      const printStyle = document.createElement('style');
      printStyle.id = 'print-styles';
      printStyle.textContent = `
        @media print {
          * {
            color: black !important;
            background: white !important;
            box-shadow: none !important;
            text-shadow: none !important;
          }
          /* Business header - compact */
          .business-header {
            width: 100%;
            border-bottom: 2px solid #333;
            padding-bottom: 8px;
            margin-bottom: 5px;
          }
          .business-header-main {
            display: table;
            width: 100%;
          }
          .business-left {
            display: table-cell;
            vertical-align: top;
            width: 65%;
            padding-right: 10px;
          }
          .business-right {
            display: table-cell;
            vertical-align: top;
            width: 35%;
            text-align: right;
            padding-top: 15px; /* Align with address line */
          }
          .business-name {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 3px;
            display: block;
          }
          .business-tagline {
            font-size: 10px;
            color: #666;
            margin-bottom: 4px;
            display: block;
          }
          .business-address {
            font-size: 9px;
            line-height: 1.2;
            margin-bottom: 2px;
            display: block;
          }
          .business-phone {
            font-size: 9px;
            line-height: 1.2;
            margin-bottom: 2px;
            display: block;
          }
          .business-email,
          .business-fax,
          .business-gstin {
            font-size: 9px;
            line-height: 1.2;
            margin-bottom: 2px;
            display: block;
          }
          .print-date-time {
            font-size: 8px;
            color: #666;
            margin-top: 5px;
            font-style: italic;
            text-align: center;
            width: 100%;
            clear: both;
            display: block;
          }
          /* Hide navigation and layout elements */
          nav, .sidebar, .navigation, aside, header:not(.card) {
            display: none !important;
          }
          /* Hide the main sidebar */
          .bg-slate-800.border-r.border-slate-700 {
            display: none !important;
          }
          /* Hide the main header */
          .bg-slate-800.border-b.border-slate-700 {
            display: none !important;
          }
          /* Hide buttons and interactive elements */
          button, .btn-secondary, .btn-primary, .btn-icon {
            display: none !important;
          }
          /* Hide images and modals */
          img, .image-preview {
            display: none !important;
          }
          .dropdown, .modal, .overlay {
            display: none !important;
          }
          /* Hide footer if any */
          footer {
            display: none !important;
          }
          /* Force 2-column layout for print - compact */
          .xl\\:grid-cols-4 {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap:10px
          }
          .grid {
            gap: 0.25rem !important;
            padding: 0.25rem !important;
          }
          /* Reduce content width for print */
          .card {
            max-width: 98% !important;
            margin: 0 auto !important;
            padding: 0.5rem !important;
          }
          /* Hide all borders and dividers */
          .border-t, .border-slate-700, .border-slate-600, .border, .border-slate-500, .border-slate-400, .border-slate-300, .border-slate-200, .border-slate-100, .border-gray-500, .border-gray-400, .border-gray-300, .border-gray-200, .border-gray-100 {
            border: none !important;
          }
          /* Remove table borders */
          table, th, td {
            border: none !important;
            border-collapse: collapse !important;
          }
          /* Remove any remaining borders */
          * {
            border: none !important;
          }
          /* Compact table styling */
          table {
            font-size: 9px !important;
            line-height: 1.2 !important;
          }
          th, td {
            padding: 3px 6px !important;
            font-size: 9px !important;
            line-height: 1.2 !important;
          }
          /* Consistent text sizes for print */
          .text-xl {
            font-size: 0.75rem !important;
          }
          .text-lg {
            font-size: 0.75rem !important;
          }
          .text-base {
            font-size: 0.75rem !important;
          }
          .text-sm {
            font-size: 0.75rem !important;
          }
          .text-xs {
            font-size: 0.75rem !important;
          }
          /* Make status text more prominent */
          .status-text, .payment-status, .status {
            font-size: 0.875rem !important;
            font-weight: bold !important;
            text-transform: uppercase !important;
          }
          @page {
            margin: 0.3in;
            size: A4;
          }
        }
      `;

      // Add styles to head
      document.head.appendChild(printStyle);

      // Create business header and add to page
      if (businessDetails && businessDetails.name) {
        const businessHeader = document.createElement('div');
        businessHeader.className = 'business-header';
        businessHeader.innerHTML = `
          <div class="business-header-main">
            <div class="business-left">
              <div class="business-name">${businessDetails.name}</div>
              ${businessDetails.tagline ? `<div class="business-tagline">${businessDetails.tagline}</div>` : ''}
              <div class="business-address">
                ${businessDetails.address_line_1 || ''}${businessDetails.address_line_2 ? ', ' + businessDetails.address_line_2 : ''}${businessDetails.pin_code ? ' - ' + businessDetails.pin_code : ''}
              </div>
              ${businessDetails.phone ? `<div class="business-phone">Phone: ${businessDetails.phone}${businessDetails.phone2 ? ', ' + businessDetails.phone2 : ''}</div>` : ''}
            </div>
            <div class="business-right">
              ${businessDetails.email ? `<div class="business-email">Email: ${businessDetails.email}</div>` : ''}
              ${businessDetails.fax ? `<div class="business-fax">Fax: ${businessDetails.fax}</div>` : ''}
              ${businessDetails.gstin ? `<div class="business-gstin">GSTIN: ${businessDetails.gstin}</div>` : ''}
            </div>
          </div>
          <div class="print-date-time">
            Printed on: ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}
          </div>
        `;

        // Insert business header at the top of the page
        const body = document.body;
        body.insertBefore(businessHeader, body.firstChild);
      }

      // Print the current page
      window.print();

      // Remove styles and business header after printing
      setTimeout(() => {
        const styleElement = document.getElementById('print-styles');
        if (styleElement) {
          styleElement.remove();
        }
        const businessHeader = document.querySelector('.business-header');
        if (businessHeader) {
          businessHeader.remove();
        }
      }, 1000);
    } catch (error) {
      console.error('Print function error:', error);
      alert('Error preparing print content. Please try again.');
    }
  };

  const handleExportExcel = () => {
    setIsOpen(false);

    if (onExport) {
      onExport('excel');
      return;
    }

    // Smart Excel export based on page type
    if (isViewPage()) {
      // View page: Export comprehensive data without column selection
      exportViewPageToExcel();
    } else {
      // Data table: Use column selector for Excel export
      setShowColumnSelector(true);
    }
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
          case 'serialNumber':
            row[label] = item.serialNumber || '';
            break;
          case 'carModelsDisplay':
            row[label] = item.carModelsDisplay || '';
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
            // Detect UTC timestamp and format it, otherwise use directly
            const dateValue = item.invoice_date;
            if (typeof dateValue === 'number' && dateValue > 1000000000) {
              // UTC timestamp in seconds - convert to readable date
              row[label] = new Date(dateValue * 1000).toLocaleDateString('en-IN');
            } else if (typeof dateValue === 'string' && /^\d+$/.test(dateValue)) {
              const timestamp = parseInt(dateValue);
              if (timestamp > 1000000000) {
                // UTC timestamp as string - convert to readable date
                row[label] = new Date(timestamp * 1000).toLocaleDateString('en-IN');
              } else {
                // Regular string date
                row[label] = dateValue;
              }
            } else {
              // Use as-is (already formatted or not a timestamp)
              row[label] = dateValue || '';
            }
            break;
          case 'payment_status':
            switch (item.payment_status) {
              case 1: row[label] = 'Paid'; break;
              case 2: row[label] = 'Partially Paid'; break;
              default: row[label] = 'Unpaid'; break;
            }
            break;
          case 'payment_mode':
            switch (item.payment_mode) {
              case 0: row[label] = 'Cash'; break;
              case 1: row[label] = 'Bank'; break;
              default: row[label] = 'N/A'; break;
            }
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

  const exportViewPageToExcel = () => {
    try {
      // Use the single data object (view pages pass single object, not array)
      const pageData = Array.isArray(data) ? data[0] : data;

      if (!pageData) {
        alert('No data available for Excel export');
        return;
      }



      // Create Excel data in a view-page-like format with proper headers
      const excelData = [];

      // Add business header if available
      if (businessDetails && businessDetails.name) {
        excelData.push({
          'Field': businessDetails.name,
          'Value': '',
          '': ''
        });

        if (businessDetails.tagline) {
          excelData.push({
            'Field': businessDetails.tagline,
            'Value': '',
            '': ''
          });
        }

        const address = `${businessDetails.address_line_1 || ''}${businessDetails.address_line_2 ? ', ' + businessDetails.address_line_2 : ''}${businessDetails.pin_code ? ' - ' + businessDetails.pin_code : ''}`;
        if (address.trim()) {
          excelData.push({
            'Field': address,
            'Value': '',
            '': ''
          });
        }

        const phone = businessDetails.phone ? `Phone: ${businessDetails.phone}${businessDetails.phone2 ? ', ' + businessDetails.phone2 : ''}` : '';
        if (phone) {
          excelData.push({
            'Field': phone,
            'Value': '',
            '': ''
          });
        }

        // Add empty row for spacing
        excelData.push({
          'Field': '',
          'Value': '',
          '': ''
        });
      }

      // Add page title
      excelData.push({
        'Field': config.title || 'Purchase Details',
        'Value': '',
        '': ''
      });

      // Add export date
      excelData.push({
        'Field': `Exported on: ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}`,
        'Value': '',
        '': ''
      });

      // Add empty row for spacing
      excelData.push({
        'Field': '',
        'Value': '',
        '': ''
      });

      // Extract and format data similar to view page layout
      const addField = (label, value) => {
        // Allow all values including 0, false, etc. - only filter null/undefined
        if (value !== null && value !== undefined) {
          let displayValue = value;

          // Format dates properly
          if (label.toLowerCase().includes('date') && typeof value === 'number' && value > 1000000000) {
            displayValue = new Date(value * 1000).toLocaleDateString('en-IN');
          } else if (label.toLowerCase().includes('date') && typeof value === 'string') {
            const parsed = new Date(value);
            if (!isNaN(parsed.getTime())) {
              displayValue = parsed.toLocaleDateString('en-IN');
            }
          }

          excelData.push({
            'Field': label,
            'Value': String(displayValue),
            '': ''
          });
        }
      };

      // Basic purchase information - always include these
      addField('Invoice No', pageData.invoice_number || 'N/A');
      addField('Invoice Date', pageData.date || pageData.formattedDate);
      addField('Total Amount', pageData.total || 0);
      addField('Payment Status', pageData.payment_status === 1 ? 'PAID' : 'UNPAID');
      addField('Bill Reference', pageData.bill_reference || 'N/A');

      // Vendor information
      addField('Vendor Name', pageData.vendor?.vendor_name || 'N/A');
      if (pageData.vendor) {
        addField('Vendor Contact', pageData.vendor.phone || 'N/A');
        addField('Vendor Email', pageData.vendor.email || 'N/A');
        addField('Vendor GSTIN', pageData.vendor.gstin || 'N/A');
      }

      // Staff information
      if (pageData.staff) {
        addField('Staff Name', pageData.staff.name || 'N/A');
      }

      // Transport information
      addField('Transport', pageData.transport_name || 'N/A');
      addField('Vehicle No', pageData.vehicle_number || 'N/A');
      addField('Freight', pageData.freight || 0);

      // GST breakdown
      addField('CGST', pageData.total_cgst || 0);
      addField('SGST', pageData.total_sgst || 0);
      addField('IGST', pageData.total_igst || 0);

      // Items count
      if (pageData.items && Array.isArray(pageData.items)) {
        addField('Total Items', pageData.items.length);
      }

      // Add empty row before items
      excelData.push({
        'Field': '',
        'Value': '',
        '': ''
      });

      // Add items table
      if (pageData.items && Array.isArray(pageData.items) && pageData.items.length > 0) {
        excelData.push({
          'Field': 'PURCHASE ITEMS',
          'Value': '',
          '': ''
        });

        // Add item headers
        excelData.push({
          'Field': 'S.No',
          'Value': 'Product',
          '': 'Quantity'
        });

        // Add each item
        pageData.items.forEach((item, index) => {
          excelData.push({
            'Field': (index + 1).toString(),
            'Value': item.product_name || item.name || '',
            '': item.quantity || ''
          });
        });
      }

      const { exportToExcelGeneric } = require('../../lib/export-utils');
      exportToExcelGeneric(excelData, {
        title: config.title || 'Purchase Details',
        fileName: `${config.fileName || 'purchase'}_${getLocalDateString()}`
      }, undefined, false); // false = don't show headers

    } catch (error) {
      console.error('View page Excel export error:', error);
      alert('Error exporting Excel. Please try again.');
    }
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 !mt-0">
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
