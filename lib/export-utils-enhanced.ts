import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

// ==================== TYPE DEFINITIONS ====================

export interface ExportLayoutField {
  label: string;
  key: string;
  format?: 'currency' | 'date' | 'number' | 'text' | 'status' | 'payment_mode';
  transform?: (value: any, data: any) => string;
}

export interface ExportLayoutGroup {
  title?: string;
  fields: ExportLayoutField[];
}

export interface ExportLayoutTable {
  type: 'table';
  title: string;
  dataKey: string; // e.g., 'items' or 'returns'
  columns: {
    label: string;
    key: string;
    format?: 'currency' | 'date' | 'number' | 'text';
    width?: number;
  }[];
}

export interface ExportLayoutGrid {
  type: 'grid';
  columns: number; // 2, 3, or 4 columns
  groups: ExportLayoutGroup[];
}

export interface ExportLayoutBanner {
  type: 'banner';
  template: string; // e.g., 'Purchase #{{invoice_number}} • {{vendor.vendor_name}}'
}

export type ExportLayoutSection = ExportLayoutBanner | ExportLayoutGrid | ExportLayoutTable;

export interface ExportLayout {
  sections: ExportLayoutSection[];
}

export interface ExportConfig {
  title: string;
  fileName: string;
  layout?: ExportLayout;
}

// ==================== FORMATTERS ====================

const formatValue = (value: any, format?: string, data?: any, forPDF: boolean = false): string => {
  if (value === null || value === undefined) return 'N/A';

  switch (format) {
    case 'currency':
      // Use "Rs." for PDF to avoid Unicode issues with rupee symbol
      const currencySymbol = forPDF ? 'Rs.' : '₹';
      return `${currencySymbol}${Number(value)?.toLocaleString('en-IN')}`;
    
    case 'date':
      if (typeof value === 'number') {
        return new Date(value * 1000).toLocaleDateString('en-IN');
      }
      if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString('en-IN');
        }
      }
      return value.toString();
    
    case 'number':
      return Number(value)?.toLocaleString('en-IN');
    
    case 'status':
      return value === 1 ? 'Paid' : 'Unpaid';
    
    case 'payment_mode':
      switch (value) {
        case 0: return 'Cash';
        case 1: return 'Bank';
        default: return 'N/A';
      }
    
    case 'text':
    default:
      return String(value);
  }
};

const getNestedValue = (obj: any, path: string): any => {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
};

const replacePlaceholders = (template: string, data: any, forPDF: boolean = false): string => {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(data, path.trim());
    if (value !== null && value !== undefined) {
      let stringValue = String(value);
      // For PDF, replace problematic characters
      if (forPDF) {
        stringValue = stringValue
          .replace(/&/g, 'and')
          .replace(/•/g, '-');
      }
      return stringValue;
    }
    return '';
  });
};

// ==================== EXCEL EXPORT WITH LAYOUT ====================

export const exportToExcelWithLayout = async (
  data: any,
  config: ExportConfig,
  businessDetails?: any
): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Details');

    let currentRow = 1;

    // Add business header if available
    if (businessDetails?.name) {
      const headerRow = sheet.getRow(currentRow);
      headerRow.getCell(1).value = businessDetails.name;
      headerRow.getCell(1).font = { bold: true, size: 16 };
      sheet.mergeCells(currentRow, 1, currentRow, 6);
      currentRow++;

      if (businessDetails.tagline) {
        const taglineRow = sheet.getRow(currentRow);
        taglineRow.getCell(1).value = businessDetails.tagline;
        taglineRow.getCell(1).font = { size: 10, italic: true };
        sheet.mergeCells(currentRow, 1, currentRow, 6);
        currentRow++;
      }

      const address = `${businessDetails.address_line_1 || ''}${businessDetails.address_line_2 ? ', ' + businessDetails.address_line_2 : ''}${businessDetails.pin_code ? ' - ' + businessDetails.pin_code : ''}`;
      if (address.trim()) {
        const addressRow = sheet.getRow(currentRow);
        addressRow.getCell(1).value = address;
        addressRow.getCell(1).font = { size: 9 };
        sheet.mergeCells(currentRow, 1, currentRow, 6);
        currentRow++;
      }

      currentRow++; // Empty row
    }

    // Process layout sections
    if (config.layout?.sections) {
      for (const section of config.layout.sections) {
        if (section.type === 'banner') {
          const bannerText = replacePlaceholders(section.template, data);
          const bannerRow = sheet.getRow(currentRow);
          bannerRow.getCell(1).value = bannerText;
          bannerRow.getCell(1).font = { bold: true, size: 14 };
          bannerRow.getCell(1).alignment = { horizontal: 'center' };
          sheet.mergeCells(currentRow, 1, currentRow, 6);
          currentRow += 2;
        } else if (section.type === 'grid') {
          // Create 4-column layout matching HTML page structure
          const numGroups = section.groups.length;

          // Add group headers in a single row
          const headerRow = sheet.getRow(currentRow);
          section.groups.forEach((group, groupIdx) => {
            const col = groupIdx + 1;
            const cell = headerRow.getCell(col);
            cell.value = group.title || '';
            cell.font = { bold: true, size: 11 };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF1E88E5' }
            };
          });
          currentRow++;

          // Find max fields in any group to determine how many rows needed
          const maxFields = Math.max(...section.groups.map(g => g.fields.length));

          // Add fields - each field gets its own row with label and value in same cell
          for (let fieldIdx = 0; fieldIdx < maxFields; fieldIdx++) {
            const fieldRow = sheet.getRow(currentRow);

            section.groups.forEach((group, groupIdx) => {
              const field = group.fields[fieldIdx];
              const col = groupIdx + 1;

              if (field) {
                const cell = fieldRow.getCell(col);
                const label = field.label + ':';
                const rawValue = field.transform
                  ? field.transform(getNestedValue(data, field.key), data)
                  : getNestedValue(data, field.key);
                const value = formatValue(rawValue, field.format, data);
                cell.value = `${label} ${value}`;
                cell.font = { size: 10 };
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE3F2FD' }
                };
              }
            });

            currentRow++;
          }

          currentRow++; // Empty row after grid
        } else if (section.type === 'table') {
          // Get table data first
          const tableData = getNestedValue(data, section.dataKey) || [];

          // Only add table section if it has data
          if (tableData.length > 0) {
            // Add table section
            const titleRow = sheet.getRow(currentRow);
            titleRow.getCell(1).value = section.title;
            titleRow.getCell(1).font = { bold: true, size: 12 };
            sheet.mergeCells(currentRow, 1, currentRow, section.columns.length);
            currentRow++;

            // Add table headers
            const headerRow = sheet.getRow(currentRow);
            section.columns.forEach((col, colIdx) => {
              const cell = headerRow.getCell(colIdx + 1);
              cell.value = col.label;
              cell.font = { bold: true, size: 10 };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E88E5' }
              };
            });
            currentRow++;

            // Add table rows
            tableData.forEach((item: any, rowIdx: number) => {
              const dataRow = sheet.getRow(currentRow);
              section.columns.forEach((col, colIdx) => {
                const cell = dataRow.getCell(colIdx + 1);
                const rawValue = getNestedValue(item, col.key);
                cell.value = formatValue(rawValue, col.format, item);
                cell.font = { size: 10 };
              });
              currentRow++;
            });

            currentRow++; // Empty row after table
          }
        }
      }
    }

    // Set column widths
    sheet.columns.forEach((column, idx) => {
      column.width = 20;
    });

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
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

// ==================== PDF EXPORT WITH LAYOUT ====================

export const exportToPDFWithLayout = async (
  data: any,
  config: ExportConfig,
  businessDetails?: any
): Promise<void> => {
  try {
    const doc = new jsPDF();
    let yPosition = 15;

    // Add business header
    if (businessDetails?.name) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(businessDetails.name, 105, yPosition, { align: 'center' });
      yPosition += 6;

      if (businessDetails.tagline) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.text(businessDetails.tagline, 105, yPosition, { align: 'center' });
        yPosition += 5;
      }

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      const address = `${businessDetails.address_line_1 || ''}${businessDetails.address_line_2 ? ', ' + businessDetails.address_line_2 : ''}${businessDetails.pin_code ? ' - ' + businessDetails.pin_code : ''}`;
      if (address.trim()) {
        doc.text(address, 105, yPosition, { align: 'center' });
        yPosition += 4;
      }

      if (businessDetails.phone) {
        doc.text(`Phone: ${businessDetails.phone}`, 105, yPosition, { align: 'center' });
        yPosition += 4;
      }

      if (businessDetails.gstin) {
        doc.text(`GSTIN: ${businessDetails.gstin}`, 105, yPosition, { align: 'center' });
        yPosition += 4;
      }

      yPosition += 5; // Extra space after header
    }

    // Process layout sections
    if (config.layout?.sections) {
      for (const section of config.layout.sections) {
        if (section.type === 'banner') {
          const bannerText = replacePlaceholders(section.template, data, true);
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.text(bannerText, 105, yPosition, { align: 'center' });
          yPosition += 8;
        } else if (section.type === 'grid') {
          // Create grid layout with borders
          const startY = yPosition;
          const numGroups = section.groups.length;
          const pageWidth = doc.internal.pageSize.getWidth();
          const margin = 15;
          const availableWidth = pageWidth - (2 * margin);
          const colWidth = availableWidth / numGroups;

          // Find max fields
          const maxFields = Math.max(...section.groups.map(g => g.fields.length));
          const rowHeight = 7; // Row height for each field

          // Draw group headers
          section.groups.forEach((group, idx) => {
            const x = margin + (idx * colWidth);
            doc.setFillColor(220, 220, 220); // Light gray instead of blue
            doc.rect(x, yPosition, colWidth, rowHeight, 'F');
            doc.setTextColor(0, 0, 0); // Black text
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.text(group.title || '', x + 4, yPosition + 4.5, { maxWidth: colWidth - 8 });
          });
          yPosition += rowHeight;

          // Draw fields
          for (let fieldIdx = 0; fieldIdx < maxFields; fieldIdx++) {
            section.groups.forEach((group, groupIdx) => {
              const field = group.fields[fieldIdx];
              const x = margin + (groupIdx * colWidth);
              
              if (field) {
                // Background
                if (fieldIdx % 2 === 0) {
                  doc.setFillColor(240, 240, 240);
                  doc.rect(x, yPosition, colWidth, rowHeight, 'F');
                }

                // Border
                doc.setDrawColor(200, 200, 200);
                doc.rect(x, yPosition, colWidth, rowHeight, 'S');

                // Label and value on the same line
                doc.setTextColor(0, 0, 0);
                doc.setFontSize(8);
                
                // Label (bold)
                doc.setFont('helvetica', 'bold');
                const label = field.label + ':';
                const labelWidth = doc.getTextWidth(label);
                doc.text(label, x + 4, yPosition + 4.5);

                // Value (normal) - positioned right after label with 2px spacing
                doc.setFont('helvetica', 'normal');
                const rawValue = field.transform
                  ? field.transform(getNestedValue(data, field.key), data)
                  : getNestedValue(data, field.key);
                const value = formatValue(rawValue, field.format, data, true);

                // Handle long text by splitting into multiple lines if needed
                const maxValueWidth = colWidth - 8 - labelWidth - 2;
                const valueLines = doc.splitTextToSize(value, maxValueWidth);
                const lineHeight = 4.5;

                // Draw each line of the value
                valueLines.forEach((line: string, lineIdx: number) => {
                  const yOffset = yPosition + 4.5 + (lineIdx * lineHeight);
                  // Only draw if it fits within the current row height, otherwise truncate
                  if (yOffset <= yPosition + rowHeight - 2) {
                    doc.text(line, x + 4 + labelWidth + 2, yOffset);
                  }
                });
              }
            });
            yPosition += rowHeight;
          }

          yPosition += 5; // Space after grid
        } else if (section.type === 'table') {
          // Add table using autoTable
          const tableData = getNestedValue(data, section.dataKey) || [];
          
          if (tableData.length > 0) {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(section.title, 15, yPosition);
            yPosition += 5;

            const headers = section.columns.map(col => col.label);
            const body = tableData.map((item: any) => 
              section.columns.map(col => {
                const rawValue = getNestedValue(item, col.key);
                return formatValue(rawValue, col.format, item, true);
              })
            );

            autoTable(doc, {
              startY: yPosition,
              head: [headers],
              body: body,
              theme: 'grid',
              styles: {
                fontSize: 6,
                cellPadding: 2,
                halign: 'left',
                overflow: 'linebreak',
                cellWidth: 'auto' // Let columns auto-size to fill available space
              },
              headStyles: {
                fillColor: [220, 220, 220],
                textColor: [0, 0, 0],
                fontStyle: 'bold',
                fontSize: 6,
                halign: 'left'
              },
              margin: { left: 15, right: 15 },
              tableWidth: 'auto', // Use full available width
              // Remove restrictive column width caps to allow proper auto-sizing
            });

            yPosition = (doc as any).lastAutoTable.finalY + 10;
          }
        }

        // Check if we need a new page
        if (yPosition > 270) {
          doc.addPage();
          yPosition = 15;
        }
      }
    }

    // Save PDF
    doc.save(`${config.fileName}_${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    alert('Error exporting PDF. Please try again.');
  }
};
