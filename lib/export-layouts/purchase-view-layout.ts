import { ExportLayout } from '../export-utils-enhanced';

export const purchaseViewExportLayout: ExportLayout = {
  sections: [
    {
      type: 'banner',
      template: 'Purchase {{invoice_number}} • {{vendor.vendor_name}}'
    },
    {
      type: 'grid',
      columns: 4,
      groups: [
        {
          title: 'Basic Info',
          fields: [
            { label: 'Total', key: 'total', format: 'currency' },
            { label: 'Items', key: 'items.length', format: 'number' },
            { label: 'Invoice', key: 'invoice_number', format: 'text' },
            { label: 'Date', key: 'date', format: 'date' },
            { label: 'Status', key: 'payment_status', format: 'status' },
            { label: 'Payment Mode', key: 'payment_mode', format: 'payment_mode' },
            { label: 'Bill Reference', key: 'bill_reference', format: 'text' },
          ]
        },
        {
          title: 'Vendor Info',
          fields: [
            { label: 'Vendor', key: 'vendor.vendor_name', format: 'text' },
            { label: 'Contact', key: 'vendor.contact_no', format: 'text' },
            { label: 'Email', key: 'vendor.email', format: 'text' },
            { label: 'GSTIN', key: 'vendor.tax_id', format: 'text' },
            { label: 'Staff', key: 'staff.name', format: 'text' },
          ]
        },
        {
          title: 'Financial Summary',
          fields: [
            { label: 'Items Total', key: 'items_total', format: 'currency' },
            { label: 'Freight', key: 'freight', format: 'currency' },
            { label: 'Taxable Value', key: 'total_taxable_value', format: 'currency' },
            { label: 'Total Tax', key: 'total_tax', format: 'currency' },
            { label: 'Grand Total', key: 'total', format: 'currency' },
            { label: 'CGST', key: 'total_cgst', format: 'currency' },
            { label: 'SGST', key: 'total_sgst', format: 'currency' },
            { label: 'IGST', key: 'total_igst', format: 'currency' },
          ]
        },
        {
          title: 'Transport & Additional',
          fields: [
            { label: 'Transport', key: 'transport_name', format: 'text' },
            { label: 'Vehicle', key: 'vehicle_number', format: 'text' },
            { label: 'P&F Qty', key: 'packing_forwarding_qty', format: 'number' },
            { label: 'P&F Rate', key: 'packing_forwarding_rate', format: 'currency' },
            { label: 'P&F Total', key: 'packing_forwarding_total', format: 'currency' },
            { label: 'Notes', key: 'notes', format: 'text' },
            { label: 'Descriptions', key: 'descriptions', format: 'text' },
          ]
        }
      ]
    },
    {
      type: 'table',
      title: 'Purchase Items',
      dataKey: 'items',
      columns: [
        { label: 'SN', key: '_index', format: 'number', width: 10 },
        { label: 'Product Name', key: 'product_name', format: 'text', width: 50 },
        { label: 'Part No', key: 'part', format: 'text', width: 30 },
        { label: 'HSN', key: 'hsn', format: 'text', width: 20 },
        { label: 'Qty', key: 'qty', format: 'number', width: 15 },
        { label: 'Rate', key: 'rate', format: 'currency', width: 25 },
        { label: 'Tax %', key: 'gst_percentage', format: 'number', width: 15 },
        { label: 'Total', key: 'total', format: 'currency', width: 30 },
      ]
    },
    {
      type: 'table',
      title: 'Purchase Returns',
      dataKey: 'returns',
      columns: [
        { label: 'Return No', key: 'return_no', format: 'text', width: 20 },
        { label: 'Date', key: 'return_date', format: 'date', width: 15 },
        { label: 'Total Amount', key: 'total_amount', format: 'currency', width: 20 },
        { label: 'Refund Amount', key: 'refund_amount', format: 'currency', width: 20 },
        { label: 'Payment Status', key: 'payment_status', format: 'text', width: 15 },
        { label: 'Payment Mode', key: 'payment_mode', format: 'text', width: 15 },
        { label: 'Items Count', key: 'items_count', format: 'number', width: 15 },
      ]
    },
    {
      type: 'table',
      title: 'Payment History',
      dataKey: 'payment_history',
      columns: [
        { label: 'Date', key: 'allocation_date', format: 'date', width: 15 },
        { label: 'Payment Date', key: 'payment_date', format: 'date', width: 15 },
        { label: 'Amount', key: 'allocated_amount', format: 'currency', width: 20 },
        { label: 'Payment Mode', key: 'payment_mode_text', format: 'text', width: 15 },
        { label: 'Payment Type', key: 'payment_type', format: 'text', width: 15 },
        { label: 'Notes', key: 'allocation_notes', format: 'text', width: 30 },
      ]
    }
  ]
};

// Helper to add index to items
export const preparePurchaseDataForExport = (purchase: any) => {
  return {
    ...purchase,
    items: purchase.items?.map((item: any, index: number) => ({
      ...item,
      _index: index + 1,
      product_name: item.display_name || item.product_name
    })) || []
  };
};
