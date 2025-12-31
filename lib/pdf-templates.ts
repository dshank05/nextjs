// PDF Templates for different page types
// This file contains clean HTML templates that mirror page layouts but use print-friendly styling

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

// Helper function to get payment mode text
const getPaymentModeText = (mode?: number): string => {
  switch (mode) {
    case 0: return 'Cash';
    case 1: return 'Bank';
    default: return 'N/A';
  }
};

// Create business header element
const createBusinessHeader = (businessDetails: any): HTMLElement => {
  const header = document.createElement('div');
  header.style.cssText = `
    width: 100%;
    border-bottom: 2px solid #333;
    padding-bottom: 8px;
    margin-bottom: 15px;
    font-family: Arial, sans-serif;
  `;

  header.innerHTML = `
    <div style="display: table; width: 100%;">
      <div style="display: table-cell; vertical-align: top; width: 65%; padding-right: 10px;">
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 3px;">${businessDetails.name || ''}</div>
        ${businessDetails.tagline ? `<div style="font-size: 10px; color: #666; margin-bottom: 4px;">${businessDetails.tagline}</div>` : ''}
        <div style="font-size: 9px; line-height: 1.2; margin-bottom: 2px;">
          ${businessDetails.address_line_1 || ''}${businessDetails.address_line_2 ? ', ' + businessDetails.address_line_2 : ''}${businessDetails.pin_code ? ' - ' + businessDetails.pin_code : ''}
        </div>
        ${businessDetails.phone ? `<div style="font-size: 9px; line-height: 1.2; margin-bottom: 2px;">Phone: ${businessDetails.phone}${businessDetails.phone2 ? ', ' + businessDetails.phone2 : ''}</div>` : ''}
      </div>
      <div style="display: table-cell; vertical-align: top; width: 35%; text-align: right; padding-top: 15px;">
        ${businessDetails.email ? `<div style="font-size: 9px; line-height: 1.2; margin-bottom: 2px;">Email: ${businessDetails.email}</div>` : ''}
        ${businessDetails.fax ? `<div style="font-size: 9px; line-height: 1.2; margin-bottom: 2px;">Fax: ${businessDetails.fax}</div>` : ''}
        ${businessDetails.gstin ? `<div style="font-size: 9px; line-height: 1.2; margin-bottom: 2px;">GSTIN: ${businessDetails.gstin}</div>` : ''}
      </div>
    </div>
    <div style="font-size: 8px; color: #666; margin-top: 5px; font-style: italic; text-align: center; width: 100%;">
      Printed on: ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}
    </div>
  `;

  return header;
};

// Generate purchase view template
export const generatePurchaseViewTemplate = (purchase: any): HTMLElement => {
  const content = document.createElement('div');

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    text-align: center;
    margin-bottom: 20px;
    padding: 15px;
    border: 2px solid #333;
    background: #f9f9f9;
  `;
  header.innerHTML = `
    <h1 style="margin: 0; font-size: 18px; color: black;">Purchase #${purchase.invoice_number || purchase.invoice_no}</h1>
    <p style="margin: 8px 0 0 0; font-size: 12px; color: #666;">
      ${purchase.vendor?.vendor_name || 'N/A'} • ${formatDate(purchase.date || purchase.invoice_date)}
    </p>
  `;
  content.appendChild(header);

  // Info grid (4 columns like the original page)
  const infoGrid = document.createElement('div');
  infoGrid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    margin-bottom: 30px;
  `;

  // Column 1: Basic Info
  const col1 = document.createElement('div');
  col1.innerHTML = `
    <h3 style="margin: 0 0 10px 0; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">Basic Information</h3>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Total:</span><span>₹${(purchase.total || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Items:</span><span>${purchase.items?.length || 0}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Invoice:</span><span>${purchase.invoice_number || purchase.invoice_no}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Date:</span><span>${formatDate(purchase.date || purchase.invoice_date)}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Status:</span><span>${purchase.payment_status === 1 ? 'Paid' : 'Unpaid'}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Payment Mode:</span><span>${getPaymentModeText(purchase.payment_mode)}</span></div>
    <div style="display: flex; justify-content: space-between; font-size: 11px;"><span>Bill Reference:</span><span>${purchase.bill_reference || 'N/A'}</span></div>
  `;

  // Column 2: Vendor Details
  const col2 = document.createElement('div');
  col2.innerHTML = `
    <h3 style="margin: 0 0 10px 0; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">Vendor Details</h3>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Vendor:</span><span>${purchase.vendor?.vendor_name || 'N/A'}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Contact:</span><span>${purchase.vendor?.contact_no || 'N/A'}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Email:</span><span>${purchase.vendor?.email || 'N/A'}</span></div>
    <div style="display: flex; justify-content: space-between; font-size: 11px;"><span>GSTIN:</span><span>${purchase.vendor?.tax_id || 'N/A'}</span></div>
  `;

  // Column 3: Financial Summary
  const col3 = document.createElement('div');
  col3.innerHTML = `
    <h3 style="margin: 0 0 10px 0; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">Financial Summary</h3>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Items Total:</span><span>₹${(purchase.items_total || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Freight:</span><span>₹${(purchase.freight || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Taxable Value:</span><span>₹${(purchase.total_taxable_value || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Total Tax:</span><span>₹${(purchase.total_tax || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-weight: bold; font-size: 11px;"><span>Grand Total:</span><span>₹${(purchase.total || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>CGST:</span><span>₹${(purchase.total_cgst || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>SGST:</span><span>₹${(purchase.total_sgst || 0)?.toLocaleString('en-IN')}</span></div>
    <div style="display: flex; justify-content: space-between; font-size: 11px;"><span>IGST:</span><span>₹${(purchase.total_igst || 0)?.toLocaleString('en-IN')}</span></div>
  `;

  // Column 4: Transport & Notes
  const col4 = document.createElement('div');
  col4.innerHTML = `
    <h3 style="margin: 0 0 10px 0; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">Transport Information</h3>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Transport:</span><span>${purchase.transport_name || 'N/A'}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px;"><span>Vehicle:</span><span>${purchase.vehicle_number || 'N/A'}</span></div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px;"><span>Freight:</span><span>₹${(purchase.freight || 0)?.toLocaleString('en-IN')}</span></div>
    ${purchase.notes ? `<div style="margin-bottom: 8px; font-size: 10px;"><strong>Notes:</strong><br>${purchase.notes}</div>` : ''}
    ${purchase.descriptions ? `<div style="font-size: 10px;"><strong>Descriptions:</strong><br>${purchase.descriptions}</div>` : ''}
  `;

  infoGrid.appendChild(col1);
  infoGrid.appendChild(col2);
  infoGrid.appendChild(col3);
  infoGrid.appendChild(col4);
  content.appendChild(infoGrid);

  // Items table
  if (purchase.items && purchase.items.length > 0) {
    const tableSection = document.createElement('div');
    tableSection.innerHTML = `
      <h3 style="margin: 30px 0 15px 0; font-size: 16px; color: black;">Purchase Items</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">SN</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Product Name</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Part No</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">HSN</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Qty</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Rate</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Tax %</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Tax Amount</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${purchase.items.map((item: any, index: number) => {
            const taxAmount = (item.total || item.subtotal || 0) - ((item.qty * (item.rate || 0)) / (1 + (item.gst_percentage || 0) / 100));
            return `
              <tr>
                <td style="border: 1px solid #ccc; padding: 8px;">${index + 1}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${item.display_name || item.product_name || 'N/A'}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${item.part || 'N/A'}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${item.hsn || 'N/A'}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${item.qty || 0}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">₹${(item.rate || 0)?.toLocaleString('en-IN')}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${item.gst_percentage || item.tax || 0}%</td>
                <td style="border: 1px solid #ccc; padding: 8px;">₹${taxAmount?.toLocaleString('en-IN')}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">₹${(item.total || item.subtotal || 0)?.toLocaleString('en-IN')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight: bold; background: #f9f9f9;">
            <td colspan="3" style="border: 1px solid #ccc; padding: 8px; text-align: right;">Total Qty:</td>
            <td style="border: 1px solid #ccc; padding: 8px;">${purchase.items.reduce((sum: number, item: any) => sum + (item.qty || 0), 0)}</td>
            <td colspan="3" style="border: 1px solid #ccc; padding: 8px; text-align: right;">Total Tax:</td>
            <td style="border: 1px solid #ccc; padding: 8px;">₹${(purchase.total_tax || 0)?.toLocaleString('en-IN')}</td>
            <td style="border: 1px solid #ccc; padding: 8px;">₹${(purchase.items_total || 0)?.toLocaleString('en-IN')}</td>
          </tr>
        </tfoot>
      </table>
    `;
    content.appendChild(tableSection);
  }

  return content;
};

// Generate page template based on page type
export const generatePageTemplate = (config: {
  title: string;
  businessDetails?: any;
  pageType: 'purchase-view' | 'sale-view' | 'product-view' | 'index-table';
  data: any;
}): HTMLElement => {
  const { businessDetails, pageType, data } = config;

  // Create container
  const container = document.createElement('div');
  container.style.cssText = `
    font-family: Arial, sans-serif;
    color: black;
    background: white;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  `;

  // Add business header
  if (businessDetails) {
    const businessHeader = createBusinessHeader(businessDetails);
    container.appendChild(businessHeader);
  }

  // Generate content based on page type
  switch (pageType) {
    case 'purchase-view':
      container.appendChild(generatePurchaseViewTemplate(data));
      break;
    case 'sale-view':
      container.appendChild(generateSaleViewTemplate(data));
      break;
    case 'product-view':
      container.appendChild(generateProductViewTemplate(data));
      break;
    case 'index-table':
      container.appendChild(generateIndexTableTemplate(data));
      break;
  }

  return container;
};

// Placeholder functions for other page types (to be implemented)
const generateSaleViewTemplate = (data: any): HTMLElement => {
  const content = document.createElement('div');
  content.innerHTML = '<p>Sale view template - to be implemented</p>';
  return content;
};

const generateProductViewTemplate = (data: any): HTMLElement => {
  const content = document.createElement('div');
  content.innerHTML = '<p>Product view template - to be implemented</p>';
  return content;
};

const generateIndexTableTemplate = (data: any): HTMLElement => {
  const content = document.createElement('div');
  content.innerHTML = '<p>Index table template - to be implemented</p>';
  return content;
};
