import { ExportLayout } from '../export-utils-enhanced';

export const saleViewExportLayout: ExportLayout = {
  sections: [
    {
      type: 'banner',
      template: 'Sales Invoice #{{invoice_no}} • {{customer.billing_name}}'
    },
    {
      type: 'grid',
      columns: 4,
      groups: [
        {
          title: 'Invoice Info',
          fields: [
            { label: 'Invoice No', key: 'invoice_no', format: 'text' },
            { label: 'Date', key: 'formattedDate', format: 'text' },
            { label: 'Bill Reference', key: 'bill_reference', format: 'text' },
            { label: 'Status', key: 'payment_status', format: 'status' },
            { label: 'Payment Mode', key: 'payment_mode', format: 'payment_mode' },
            { label: 'Items', key: 'item_count', format: 'number' },
          ]
        },
        {
          title: 'Customer Info',
          fields: [
            { label: 'Customer', key: 'customer.billing_name', format: 'text' },
            { label: 'Contact', key: 'customer.contact_no', format: 'text' },
            { label: 'Email', key: 'customer.email', format: 'text' },
            { label: 'GSTIN', key: 'customer.billing_gstin', format: 'text' },
          ]
        },
        {
          title: 'Staff & Mechanic',
          fields: [
            { label: 'Staff', key: 'staff.name', format: 'text' },
            { label: 'Staff Phone', key: 'staff.phone', format: 'text' },
            { label: 'Mechanic', key: 'mechanic.name', format: 'text' },
            { label: 'Mechanic Phone', key: 'mechanic.phone', format: 'text' },
            { label: 'Commission', key: 'commission', format: 'currency' },
          ]
        },
        {
          title: 'Financial Summary',
          fields: [
            { label: 'Items Total', key: 'items_total', format: 'currency' },
            { label: 'Freight', key: 'freight', format: 'currency' },
            { label: 'Taxable Value', key: 'total_taxable_value', format: 'currency' },
            { label: 'CGST', key: 'total_cgst', format: 'currency' },
            { label: 'SGST', key: 'total_sgst', format: 'currency' },
            { label: 'IGST', key: 'total_igst', format: 'currency' },
            { label: 'Total Tax', key: 'total_tax', format: 'currency' },
            { label: 'Grand Total', key: 'total', format: 'currency' },
          ]
        }
      ]
    },
    {
      type: 'table',
      title: 'Invoice Items',
      dataKey: 'invoiceItems',
      columns: [
        { label: 'SN', key: '_index', format: 'number', width: 10 },
        { label: 'Product Name', key: 'name_of_product', format: 'text', width: 50 },
        { label: 'Part No', key: 'part', format: 'text', width: 20 },
        { label: 'HSN', key: 'hsn', format: 'text', width: 15 },
        { label: 'Qty', key: 'qty', format: 'number', width: 10 },
        { label: 'Rate', key: 'rate', format: 'currency', width: 20 },
        { label: 'Subtotal', key: 'subtotal', format: 'currency', width: 25 },
      ]
    },
    {
      type: 'grid',
      columns: 3,
      groups: [
        {
          title: 'Transport Details',
          fields: [
            { label: 'Transport Name', key: 'transport_name', format: 'text' },
            { label: 'Vehicle Number', key: 'vehicle_number', format: 'text' },
          ]
        },
        {
          title: 'Packing & Forwarding',
          fields: [
            { label: 'P&F Qty', key: 'packing_forwarding_qty', format: 'number' },
            { label: 'P&F Rate', key: 'packing_forwarding_rate', format: 'currency' },
            { label: 'P&F Total', key: 'packing_forwarding_total', format: 'currency' },
          ]
        },
        {
          title: 'Additional Info',
          fields: [
            { label: 'Descriptions', key: 'descriptions', format: 'text' },
            { label: 'Notes', key: 'notes', format: 'text' },
          ]
        }
      ]
    }
  ]
};

// Helper to prepare sale data for export
export const prepareSaleDataForExport = (sale: any) => {
  return {
    ...sale,
    invoiceItems: sale.invoiceItems?.map((item: any, index: number) => ({
      ...item,
      _index: index + 1,
      name_of_product: item.display_name || item.name_of_product
    })) || []
  };
};
