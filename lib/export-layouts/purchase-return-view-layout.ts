import { ExportLayout } from '../export-utils-enhanced';

export const purchaseReturnViewExportLayout: ExportLayout = {
  sections: [
    {
      type: 'banner',
      template: 'Return {{return_no}} • {{vendor_name}}'
    },
    {
      type: 'grid',
      columns: 4,
      groups: [
        {
          title: 'Basic Return Info',
          fields: [
            { label: 'Total', key: 'total_amount', format: 'currency' },
            { label: 'Items', key: 'items_count', format: 'number' },
            { label: 'Return #', key: 'return_no', format: 'text' },
            { label: 'Date', key: 'return_date', format: 'date' },
            { label: 'Status', key: 'statusText', format: 'text' },
            { label: 'Refund Count', key: 'refund_count', format: 'number' },
          ]
        },
        {
          title: 'Vendor Info',
          fields: [
            { label: 'Vendor', key: 'vendor_name', format: 'text' },
            { label: 'GSTIN', key: 'vendor_gstin', format: 'text' },
            { label: 'Address', key: 'vendor_address', format: 'text' },
          ]
        },
        {
          title: 'Financial Summary',
          fields: [
            { label: 'Items Total', key: 'items_total', format: 'currency' },
            { label: 'Total Tax', key: 'total_tax', format: 'currency' },
            { label: 'Packing & Forwarding', key: 'packing_forwarding_amount', format: 'currency' },
            { label: 'CGST', key: 'total_cgst', format: 'currency' },
            { label: 'SGST', key: 'total_sgst', format: 'currency' },
            { label: 'IGST', key: 'total_igst', format: 'currency' },
          ]
        },
        {
          title: 'Notes',
          fields: [
            { label: 'Return Notes', key: 'notes', format: 'text' },
          ]
        }
      ]
    },
    {
      type: 'table',
      title: 'Return Items',
      dataKey: 'items',
      columns: [
        { label: 'SN', key: '_index', format: 'number', width: 10 },
        { label: 'Product Name', key: 'product_name', format: 'text', width: 50 },
        { label: 'Part Number', key: 'part_number', format: 'text', width: 30 },
        { label: 'Bill No', key: 'invoice_no', format: 'text', width: 20 },
        { label: 'Bill Ref', key: 'bill_reference', format: 'text', width: 20 },
        { label: 'Qty', key: 'return_qty', format: 'number', width: 15 },
        { label: 'Rate', key: 'unit_price', format: 'currency', width: 20 },
        { label: 'Tax %', key: 'tax_rate', format: 'number', width: 15 },
        { label: 'Tax Amount', key: 'tax_amount', format: 'currency', width: 20 },
        { label: 'Subtotal', key: 'subtotal', format: 'currency', width: 25 },
        { label: 'Reason', key: 'return_reason', format: 'text', width: 30 },
        { label: 'Notes', key: 'notes', format: 'text', width: 30 },
      ]
    },
    {
      type: 'table',
      title: 'Refund History',
      dataKey: 'refund_history',
      columns: [
        { label: 'Refund Date', key: 'refund_date', format: 'date', width: 15 },
        { label: 'Amount', key: 'refund_amount', format: 'currency', width: 20 },
        { label: 'Payment Mode', key: 'payment_mode_text', format: 'text', width: 15 },
        { label: 'Payment Type', key: 'payment_type', format: 'text', width: 15 },
        { label: 'Notes', key: 'notes', format: 'text', width: 30 },
      ]
    }
  ]
};

// Helper to prepare purchase return data for export with dynamic layout
export const preparePurchaseReturnDataForExport = (returnData: any, returnItems: any[], fullApiData: any) => {
  const hasTax = returnData.total_tax > 0;
  const hasRefunds = fullApiData?.refund_summary && fullApiData.refund_summary.refund_count > 0;
  
  // Build financial summary fields dynamically
  const financialFields = [
    { label: 'Items Total', key: 'items_total', format: 'currency' as const }
  ];
  
  if (hasTax) {
    financialFields.push(
      { label: 'Total Tax', key: 'total_tax', format: 'currency' as const },
      { label: 'Packing & Forwarding', key: 'packing_forwarding_amount', format: 'currency' as const },
      { label: 'CGST', key: 'total_cgst', format: 'currency' as const },
      { label: 'SGST', key: 'total_sgst', format: 'currency' as const },
      { label: 'IGST', key: 'total_igst', format: 'currency' as const }
    );
  }
  
  // Build table columns dynamically
  const tableColumns = [
    { label: 'SN', key: '_index', format: 'number' as const, width: 10 },
    { label: 'Product Name', key: 'product_name', format: 'text' as const, width: 50 },
    { label: 'Part Number', key: 'part_number', format: 'text' as const, width: 30 },
    { label: 'Bill No', key: 'invoice_no', format: 'text' as const, width: 20 },
    { label: 'Bill Ref', key: 'bill_reference', format: 'text' as const, width: 20 },
    { label: 'Qty', key: 'return_qty', format: 'number' as const, width: 15 },
    { label: 'Rate', key: 'unit_price', format: 'currency' as const, width: 20 }
  ];
  
  if (hasTax) {
    tableColumns.push(
      { label: 'Tax %', key: 'tax_rate', format: 'number' as const, width: 15 },
      { label: 'Tax Amount', key: 'tax_amount', format: 'currency' as const, width: 20 }
    );
  }
  
  tableColumns.push(
    { label: 'Subtotal', key: 'subtotal', format: 'currency' as const, width: 25 },
    { label: 'Reason', key: 'return_reason', format: 'text' as const, width: 30 },
    { label: 'Notes', key: 'notes', format: 'text' as const, width: 30 }
  );
  
  // Create dynamic layout
  const dynamicLayout: ExportLayout = {
    sections: [
      {
        type: 'banner',
        template: 'Return {{return_no}} • {{vendor_name}}'
      },
      {
        type: 'grid',
        columns: 4,
        groups: [
          {
            title: 'Basic Return Info',
            fields: [
              { label: 'Total', key: 'total_amount', format: 'currency' },
              { label: 'Items', key: 'items_count', format: 'number' },
              { label: 'Return #', key: 'return_no', format: 'text' },
              { label: 'Date', key: 'return_date', format: 'date' },
              { label: 'Status', key: 'statusText', format: 'text' },
              { label: 'Refund Count', key: 'refund_count', format: 'number' },
            ]
          },
          {
            title: 'Vendor Info',
            fields: [
              { label: 'Vendor', key: 'vendor_name', format: 'text' },
              { label: 'GSTIN', key: 'vendor_gstin', format: 'text' },
              { label: 'Address', key: 'vendor_address', format: 'text' },
            ]
          },
          {
            title: 'Financial Summary',
            fields: financialFields
          },
          {
            title: 'Notes',
            fields: [
              { label: 'Return Notes', key: 'notes', format: 'text' },
            ]
          }
        ]
      },
      {
        type: 'table',
        title: 'Return Items',
        dataKey: 'items',
        columns: tableColumns
      }
    ]
  };
  
  // Add refund history table if applicable
  if (hasRefunds) {
    dynamicLayout.sections.push({
      type: 'table',
      title: 'Refund History',
      dataKey: 'refund_history',
      columns: [
        { label: 'Refund Date', key: 'refund_date', format: 'date', width: 15 },
        { label: 'Amount', key: 'refund_amount', format: 'currency', width: 20 },
        { label: 'Payment Mode', key: 'payment_mode_text', format: 'text', width: 15 },
        { label: 'Payment Type', key: 'payment_type', format: 'text', width: 15 },
        { label: 'Notes', key: 'notes', format: 'text', width: 30 },
      ]
    });
  }
  
  const preparedData = {
    // Basic info
    return_no: returnData.return_no,
    return_date: returnData.return_date,
    total_amount: returnData.total_amount,
    items_count: returnItems.reduce((sum: number, item: any) => sum + item.return_qty, 0),
    statusText: returnData.statusText,
    refund_count: fullApiData?.refund_summary?.refund_count || 0,
    
    // Vendor info
    vendor_name: returnData.vendor_name,
    vendor_gstin: returnData.vendor_gstin || 'N/A',
    vendor_address: returnData.vendor_address || 'N/A',
    
    // Financial summary
    items_total: returnItems.reduce((sum: number, item: any) => sum + item.subtotal, 0),
    total_tax: returnData.total_tax,
    packing_forwarding_amount: fullApiData?.return?.packing_forwarding_amount || 0,
    total_cgst: returnItems.reduce((sum: number, item: any) => sum + ((item as any).cgst || 0), 0),
    total_sgst: returnItems.reduce((sum: number, item: any) => sum + ((item as any).sgst || 0), 0),
    total_igst: returnItems.reduce((sum: number, item: any) => sum + ((item as any).igst || 0), 0),
    
    // Notes
    notes: returnData.notes || 'No notes available',
    
    // Items with index
    items: returnItems.map((item: any, index: number) => ({
      ...item,
      _index: index + 1,
      part_number: item.part_number || '',
      notes: item.notes || '',
    })),
    
    // Refund history
    refund_history: hasRefunds ? (fullApiData.refund_history || []).map((refund: any) => ({
      refund_date: refund.refund_date,
      refund_amount: refund.refund_amount,
      payment_mode_text: refund.payment_mode === 0 ? 'Cash' : 'Bank',
      payment_type: refund.payment_type || 'N/A',
      notes: refund.notes || '',
    })) : [],
    
    // Conditional flags
    has_tax: hasTax,
    has_refunds: hasRefunds,
  };
  
  return {
    data: preparedData,
    layout: dynamicLayout
  };
};
