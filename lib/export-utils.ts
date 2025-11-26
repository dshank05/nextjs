import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import ExcelJS from 'exceljs';

// Types for export data
interface Transaction {
  id: number;
  invoice_no: number;
  type: 'sale' | 'salex' | 'purchase';
  items_total: number;
  total_taxable_value: number;
  total: number;
  invoice_date: number | string;
  fy: number;
  customer_vendor_name?: string;
  customer_vendor_address?: string;
  customer_vendor_gstin?: string;
  freight?: number;
  taxrate?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_tax?: number;
  notes?: string;
  status?: number;
  payment_mode?: number;
  transport?: string;
  items?: any[];
  item_count?: number;
  select_customer?: number;
}

export interface ExportConfig {
  title: string;
  fileName: string;
  dropdownOptions?: Record<string, string[]>; // Column name -> array of dropdown options
}

// Helper function to format date
const formatDate = (dateValue: number | string): string => {
  if (typeof dateValue === 'string') {
    // Try to parse as Unix timestamp first (if it's all digits)
    if (/^\d+$/.test(dateValue)) {
      const timestamp = parseInt(dateValue);
      if (timestamp > 1000000000) { // Likely a Unix timestamp
        return new Date(timestamp * 1000).toLocaleDateString('en-IN');
      }
    }
    // Try parsing as regular date string
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-IN');
    }
    return 'Invalid Date';
  }
  // Number: assume Unix timestamp in seconds
  return new Date(dateValue * 1000).toLocaleDateString('en-IN');
};

// Helper function to get status text (only Paid or Unpaid, no Unknown)
const getStatusText = (status?: number, type?: string): string => {
  if (status === 1) {
    return 'Paid';
  } else {
    return 'Unpaid';
  }
};

// Helper function to get payment mode text (only Cash or Bank)
const getPaymentModeText = (mode?: number): string => {
  switch (mode) {
    case 0: return 'Cash';
    case 1: return 'Bank';
    default: return `INVALID_PAYMENT_MODE:${mode}`;
  }
};

// PDF Export function
export const exportToPDF = async (
  tableElement: HTMLElement,
  transactions: Transaction[],
  config: ExportConfig
): Promise<void> => {
  try {

    // Create a clone with better contrast for PDF (white background, black text)
    const clonedTable = tableElement.cloneNode(true) as HTMLElement;
    clonedTable.style.cssText = `
      background: white !important;
      color: black !important;
      font-family: Arial, sans-serif !important;
      font-size: 16px !important;
      border-collapse: collapse !important;
    `;

    // Apply white background and black text to all elements in the clone
    const allElements = clonedTable.querySelectorAll('*');
    allElements.forEach(el => {
      (el as HTMLElement).style.cssText = `
        color: black !important;
        background: white !important;
        border-color: #333 !important;
        font-family: Arial, sans-serif !important;
        font-size: 16px !important;
        padding: 10px 16px !important;
        margin: 0 !important;
      `;
    });



    // Hide sorting icons in header (but keep the headers visible)
    const headerCells = clonedTable.querySelectorAll('thead th');
    headerCells.forEach(cell => {
      const svgIcons = cell.querySelectorAll('svg');
      svgIcons.forEach(icon => {
        (icon as SVGElement).style.display = 'none';
      });
    });

    // Hide Actions column header and cells
    if (headerCells.length > 0) {
      const actionsHeader = headerCells[headerCells.length - 1] as HTMLElement;
      actionsHeader.style.display = 'none';
    }

    // Hide Actions column cells in data rows
    const bodyRows = clonedTable.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length > 0) {
        const lastCell = cells[cells.length - 1] as HTMLElement;
        lastCell.style.display = 'none';
      }
    });

    // Update status badges to plain text
    const statusElements = clonedTable.querySelectorAll('.px-2.py-1.rounded-full');
    statusElements.forEach(el => {
      const statusText = el.textContent || 'Unpaid';
      const textNode = document.createTextNode(statusText);
      el.textContent = '';
      el.appendChild(textNode);
      (el as HTMLElement).style.cssText = 'color: black !important; background: white !important; font-size: 16px !important;';
    });

    // Remove blue styling from car model chips but keep layout
    const carModelChips = clonedTable.querySelectorAll('span.bg-blue-600\\/20, span.text-blue-300');
    carModelChips.forEach(chip => {
      // Remove blue background, text color, borders, and rounded styling
      (chip as HTMLElement).style.cssText = `
        background: white !important;
        color: black !important;
        border: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 4px 0 0 !important;
        display: inline !important;
      `;
    });

    // Temporarily add to DOM for rendering
    document.body.appendChild(clonedTable);

    // Create canvas from the modified table element
    const canvas = await html2canvas(clonedTable, {
      scale: 3, // Increased from 2 to 3 for sharper text & proper row height with 16px font
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Remove from DOM
    document.body.removeChild(clonedTable);

    const imgData = canvas.toDataURL('image/png');

    // Create PDF
    const pdf = new jsPDF('portrait', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth() - 20; // 10mm margin each side
    let pdfHeight = pdf.internal.pageSize.getHeight() - 20;  // top/bottom margin
    const pageHeight = pdf.internal.pageSize.getHeight();
    let position = 25; // initial Y

    // Add title
    pdf.setFontSize(16);
    pdf.text(config.title, 10, 15);

    const imgHeight = (canvas.height * pdfWidth) / canvas.width;

    // Add table image with proper positioning
    pdf.addImage(imgData, 'PNG', 10, position, pdfWidth, imgHeight > pdfHeight ? pdfHeight : imgHeight);

    // Download the PDF
    pdf.save(`${config.fileName}_${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    alert('Error exporting PDF. Please try again.');
  }
};



// Helper function to convert column number to Excel column letter (A, B, C, ..., Z, AA, AB, etc.)
const getExcelColumnLetter = (columnNumber: number): string => {
  let result = '';
  while (columnNumber > 0) {
    columnNumber--; // Adjust for 0-based indexing
    result = String.fromCharCode(65 + (columnNumber % 26)) + result;
    columnNumber = Math.floor(columnNumber / 26);
  }
  return result;
};

// Generic Excel Export function for dynamic data
export const exportToExcelGeneric = async (
  data: any[],
  config: ExportConfig,
  selectedColumns?: string[],
  showHeaders: boolean = true
): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');

    // Define columns dynamically
    const headers = Object.keys(data[0] || {});
    sheet.columns = headers.map(header => ({
      header: showHeaders ? header : '',
      key: header,
      width: Math.max(25, header.length * 1.5) // Increased from 10 to 25, with 1.5x multiplier
    }));

    // Add data rows (starting from row 1 if no headers, row 2 if headers)
    data.forEach(row => {
      sheet.addRow(row);
    });

    // Add autofilter only if headers are shown
    if (showHeaders) {
      const lastColumn = getExcelColumnLetter(headers.length);
      const lastRow = data.length + 1; // +1 for header row
      sheet.autoFilter = `A1:${lastColumn}${lastRow}`;

      // Style headers (row 1) only if shown
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, size: 16 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E88E5' },
        };
      });

      // Style all data rows with 16px font (starting from row 2)
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.eachCell((cell) => {
            cell.font = { size: 16 };
          });
        }
      });
    } else {
      // Style all rows with 16px font (starting from row 1, no headers)
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = { size: 16 };
        });
      });
    }

   


    // Generate buffer and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.fileName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Error exporting Excel file. Please try again.');
  }
};

// Get table element for PDF export
export const getTableForExport = (): HTMLElement | null => {
  const table = document.querySelector('.table');
  return table as HTMLElement;
};

// Utility function to determine if we need to scroll and capture more data
export const getAllVisibleData = async (transactions: Transaction[]): Promise<Transaction[]> => {
  // For now, just return all transactions (assuming all data is visible)
  // In future implementations, this could handle pagination and loading all pages
  return transactions;
};

// Print section types
export interface PrintSection {
  type: 'header' | 'info-grid' | 'table' | 'notes';
  title?: string;
  data: any;
  columns?: string[] | Array<{key: string, label: string, format?: 'currency' | 'date' | 'number' | 'text'}>;
  layout?: '1-column' | '2-column' | '3-column' | '4-column';
}

// Universal print function for any page - uses templates
export const printPage = async (config: {
  title: string;
  businessDetails?: any;
  output?: 'print' | 'pdf';
  pageType: 'purchase-view' | 'sale-view' | 'product-view' | 'index-table';
  data: any; // Page-specific data
}): Promise<void> => {
  try {
    // Import template generator
    const { generatePageTemplate } = await import('./pdf-templates');

    // Generate HTML using appropriate template
    const htmlContent = generatePageTemplate(config);

    if (config.output === 'pdf') {
      // Generate PDF using html2pdf
      const html2pdf = (await import('html2pdf.js')).default;

      const options = {
        margin: 0.5,
        filename: `${config.title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 1,
          useCORS: true,
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'in' as const, format: 'a4' as const, orientation: 'portrait' as const }
      };

      await html2pdf().set(options).from(htmlContent.outerHTML).save();
    } else {
      // Open in print window
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent.outerHTML);
        printWindow.document.close();
        printWindow.focus();

        // Wait for content to load then print
        printWindow.onload = () => {
          printWindow.print();
          printWindow.close();
        };
      } else {
        alert('Please allow popups for this site to use the print function.');
      }
    }
  } catch (error) {
    console.error('Print/PDF error:', error);
    alert('Error generating print/PDF. Please try again.');
  }
};
