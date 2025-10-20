import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';

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

interface ExportConfig {
  title: string;
  fileName: string;
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
    default: return 'N/A';
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
      font-size: 12px !important;
    `;

    // Apply white background and black text to all elements in the clone
    const allElements = clonedTable.querySelectorAll('*');
    allElements.forEach(el => {
      (el as HTMLElement).style.cssText = `
        color: black !important;
        background: white !important;
        border-color: #333 !important;
        font-family: Arial, sans-serif !important;
        font-size: 12px !important;
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
    const tableRows = clonedTable.querySelectorAll('tbody tr');
    tableRows.forEach(row => {
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
      (el as HTMLElement).style.cssText = 'color: black !important; background: white !important; font-size: 12px !important;';
    });

    // Temporarily add to DOM for rendering
    document.body.appendChild(clonedTable);

    // Create canvas from the modified table element
    const canvas = await html2canvas(clonedTable, {
      scale: 2, // Higher resolution
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Remove from DOM
    document.body.removeChild(clonedTable);

    const imgData = canvas.toDataURL('image/png');

    // Create PDF
    const pdf = new jsPDF('landscape', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth - 20; // 10mm margin on each side
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Add title
    pdf.setFontSize(16);
    pdf.text(config.title, 10, 15);

    // Add table image
    const yPosition = 25;
    if (imgHeight > pdfHeight - yPosition - 20) {
      // If image is too tall, scale it down
      const scaledHeight = pdfHeight - yPosition - 20;
      const scaledWidth = (scaledHeight * imgWidth) / imgHeight;
      pdf.addImage(imgData, 'PNG', 10, yPosition, scaledWidth, scaledHeight);

      // Add page number
      pdf.setFontSize(8);
      pdf.text('Page 1', pdfWidth / 2, pdfHeight - 10, { align: 'center' });
    } else {
      pdf.addImage(imgData, 'PNG', 10, yPosition, imgWidth, imgHeight);
    }

    // Download the PDF
    pdf.save(`${config.fileName}_${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    alert('Error exporting PDF. Please try again.');
  }
};

// Excel Export function
export const exportToExcel = (
  transactions: Transaction[],
  config: ExportConfig
): void => {
  try {
    // Prepare data for Excel
    const excelData = transactions.map((transaction, index) => ({
      'SN': index + 1,
      'Invoice No': transaction.invoice_no,
      'Customer/Vendor': transaction.customer_vendor_name || 'N/A',
      'Items Qty': transaction.item_count || transaction.items?.length || 0,
      'Total': transaction.total,
      'Tax Amount': transaction.total_tax || 0,
      'Date': formatDate(transaction.invoice_date),
      'Payment Status': getStatusText(transaction.status, transaction.type),
      'Payment Mode': getPaymentModeText(transaction.payment_mode),
      'Notes': transaction.notes || '',
    }));

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const colWidths = [
      { wch: 5 },  // SN
      { wch: 12 }, // Invoice No
      { wch: 25 }, // Customer/Vendor
      { wch: 8 },  // Items Qty
      { wch: 10 }, // Total
      { wch: 10 }, // Tax Amount
      { wch: 12 }, // Date
      { wch: 15 }, // Payment Status
      { wch: 12 }, // Payment Mode
      { wch: 30 }, // Notes
    ];
    ws['!cols'] = colWidths;

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    // Add summary sheet
    const summaryData = [
      { 'Metric': 'Total Records', 'Value': transactions.length },
      { 'Metric': 'Export Date', 'Value': new Date().toLocaleString('en-IN') },
      { 'Metric': 'Total Amount', 'Value': transactions.reduce((sum, t) => sum + (t.total || 0), 0) },
    ];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // Download the Excel file
    XLSX.writeFile(wb, `${config.fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
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
