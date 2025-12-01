# Enhanced Export System

## Overview

This document describes the new unified, layout-preserving export system that replaces the scattered custom export logic throughout the application.

## Problem Solved

**Before:**
- 3 different export patterns across the codebase
- Custom export functions duplicated in multiple pages
- Inconsistent user experience
- html2canvas-based PDFs (slow, poor quality, not selectable)
- Manual data transformation in every page

**After:**
- Single unified export system
- Layout-preserving exports (maintains page structure)
- Professional PDFs with jsPDF autoTable
- Configuration-based approach
- Reusable across all page types

## Architecture

### Core Files

1. **lib/export-utils-enhanced.ts**
   - `exportToExcelWithLayout()` - Multi-column Excel exports
   - `exportToPDFWithLayout()` - Professional PDF exports with autoTable
   - Type definitions for layouts

2. **lib/export-layouts/** (directory for layout configs)
   - `purchase-view-layout.ts` - Layout config for purchase view pages
   - (More layouts can be added for other pages)

3. **Pages using the system**
   - `pages/purchases/view/[id].tsx` - First implementation

## Layout System

### Layout Structure

A layout consists of three types of sections:

```typescript
{
  sections: [
    {
      type: 'banner',
      template: 'Purchase #{{invoice_number}} • {{vendor.vendor_name}}'
    },
    {
      type: 'grid',
      columns: 4,
      groups: [
        {
          title: 'Basic Info',
          fields: [
            { label: 'Total', key: 'total', format: 'currency' },
            { label: 'Date', key: 'date', format: 'date' }
          ]
        }
      ]
    },
    {
      type: 'table',
      title: 'Purchase Items',
      dataKey: 'items',
      columns: [
        { label: 'Product', key: 'product_name', format: 'text' }
      ]
    }
  ]
}
```

### Section Types

#### 1. Banner
- Displays a centered title
- Supports template variables: `{{field.name}}`
- **Excel**: Merged cells, bold, large font
- **PDF**: Centered, bold title

#### 2. Grid
- Multi-column layout (2, 3, or 4 columns)
- Groups of label-value pairs
- Maintains page structure
- **Excel**: Uses merged cells, colored headers, structured layout
- **PDF**: Bordered grid with colored headers

#### 3. Table
- Traditional data table
- Supports formatting (currency, date, number)
- **Excel**: Formatted table with headers
- **PDF**: Uses jsPDF autoTable for professional tables

### Supported Formats

- `currency`: ₹1,234.56
- `date`: Formats timestamps to Indian date format
- `number`: 1,234
- `status`: Paid/Unpaid
- `payment_mode`: Cash/Bank
- `text`: Plain text

## Usage

### For View Pages (Complex Layouts)

```typescript
// 1. Create a layout config file
// lib/export-layouts/your-page-layout.ts
export const yourPageLayout: ExportLayout = {
  sections: [
    { type: 'banner', template: 'Title {{field}}' },
    {
      type: 'grid',
      columns: 4,
      groups: [/* your groups */]
    },
    {
      type: 'table',
      title: 'Items',
      dataKey: 'items',
      columns: [/* your columns */]
    }
  ]
};

// 2. Use in your page
const handleExportExcel = async () => {
  const { exportToExcelWithLayout } = await import('../lib/export-utils-enhanced');
  const { yourPageLayout } = await import('../lib/export-layouts/your-page-layout');
  
  const businessDetails = await fetchBusinessDetails();
  
  await exportToExcelWithLayout(
    yourData,
    {
      title: 'Page Title',
      fileName: 'export-filename',
      layout: yourPageLayout
    },
    businessDetails
  );
};

const handleExportPDF = async () => {
  const { exportToPDFWithLayout } = await import('../lib/export-utils-enhanced');
  const { yourPageLayout } = await import('../lib/export-layouts/your-page-layout');
  
  const businessDetails = await fetchBusinessDetails();
  
  await exportToPDFWithLayout(
    yourData,
    {
      title: 'Page Title',
      fileName: 'export-filename',
      layout: yourPageLayout
    },
    businessDetails
  );
};
```

### For Table Pages (Simple Lists)

For simple table pages, continue using the existing `ExportMenu` component:

```typescript
<ExportMenu
  data={items}
  columns={exportColumns}
  config={{
    title: 'Report Title',
    fileName: 'export-filename'
  }}
/>
```

## Benefits

### 1. Layout Preservation
- Excel files maintain the 4-column grid structure
- PDFs show proper sectioned layouts
- Business header automatically included

### 2. Better PDF Quality
- Uses jsPDF autoTable (not html2canvas)
- Selectable text
- Proper table formatting
- Multi-page support
- Professional appearance

### 3. Better Excel Quality
- Multi-column layouts with merged cells
- Colored section headers
- Proper cell formatting
- Professional styling
- Wider default columns (25 char width)

### 4. Maintainability
- Configuration-based (not code-based)
- Single source of truth
- Easy to modify layouts
- Type-safe with TypeScript
- Reusable across pages

### 5. Consistency
- Same export behavior everywhere
- Consistent formatting
- Unified user experience

## Migration Guide

### For Pages with Custom Export Logic

1. **Create a layout config** in `lib/export-layouts/`
2. **Import enhanced functions** in your page
3. **Replace custom export handlers** with new functions
4. **Test both Excel and PDF** exports

Example migration:

**Before (Custom Logic):**
```typescript
const handleExport = () => {
  const excelData = [];
  excelData.push({ 'Label': 'Field1', 'Value': data.field1 });
  excelData.push({ 'Label': 'Field2', 'Value': data.field2 });
  // ... 50 more lines of manual data building
  exportToExcelGeneric(excelData, config);
};
```

**After (Configuration):**
```typescript
// Create config once
const layout = {
  sections: [
    {
      type: 'grid',
      columns: 2,
      groups: [{
        fields: [
          { label: 'Field1', key: 'field1' },
          { label: 'Field2', key: 'field2' }
        ]
      }]
    }
  ]
};

// Use everywhere
const handleExport = async () => {
  await exportToExcelWithLayout(data, { layout }, businessDetails);
};
```

## Testing

### Test Checklist

For each page implementing the new system:

- [ ] Excel export generates multi-column layout
- [ ] Excel has business header
- [ ] Excel has colored section headers
- [ ] Excel table has proper formatting
- [ ] Excel currency values show ₹ symbol
- [ ] Excel dates are formatted correctly
- [ ] PDF export generates professional layout
- [ ] PDF has business header
- [ ] PDF has bordered grid sections
- [ ] PDF tables use autoTable
- [ ] PDF text is selectable
- [ ] PDF handles multi-page content
- [ ] Both exports handle missing/null values gracefully

## Future Enhancements

1. **Add more page layouts**
   - Sale view layout
   - Customer view layout
   - Product view layout

2. **Enhanced ExportMenu**
   - Detect page type automatically
   - Support layout prop
   - Smart export routing

3. **Additional features**
   - Custom color themes
   - Logo in business header
   - Watermarks
   - Page numbering

4. **Migration**
   - Migrate category, company, models, subcategory pages
   - Remove duplicate export code
   - Update all pages to use unified system

## Dependencies

- `jspdf`: ^2.x - PDF generation
- `jspdf-autotable`: ^3.x - Professional PDF tables
- `exceljs`: ^4.x - Excel generation

## Support

For issues or questions:
1. Check this documentation
2. Review example implementation in `pages/purchases/view/[id].tsx`
3. Check layout config in `lib/export-layouts/purchase-view-layout.ts`
