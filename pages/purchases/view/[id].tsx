import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Trash2, FileText, Truck, Printer, FileSpreadsheet } from 'lucide-react';
import SessionStorageService from '../../../lib/sessionStorage';
import { subscribeBroadcast } from '../../../lib/broadcast';
import { ExportMenu } from '../../../components/common';

interface PurchaseItem {
  id?: number; // Optional since API creates new IDs
  invoice_no?: number;
  product_name: string; // Updated to match API
  display_name?: string;
  category_id?: number;
  model_id?: number;
  company_id?: number;
  hsn?: string;
  part?: string; // Now uses "part" instead of "part_number"
  qty: number;
  unit?: number;
  rate: number;
  tax?: number; // Added tax field
  total?: number; // Updated to match API (uses total instead of subtotal)
  subtotal?: number; // Keep for backward compatibility
  fy?: number;
  invoice_date?: number | string;
  product_id?: number; // Added from API
  car_model?: string; // Added from API
  gst_percentage?: number; // Added from API
  cgst?: number; // Added from API
  sgst?: number; // Added from API
  igst?: number; // Added from API
}

interface Vendor {
  id: string;
  vendor_name: string;
  contact_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  state_code?: number;
  tax_id?: string;
}

interface Staff {
  id: number;
  name: string;
  phone: string;
  email?: string;
  status: string;
}

interface Purchase {
  // Main purchase fields
  id: number;
  invoice_number: string;
  bill_reference?: string;
  staff_id?: number | null;
  date: number;  // Unix timestamp
  vendor_id?: number;
  transport_name?: string;
  vehicle_number?: string;
  transport_cost?: number;

  // Financial summary fields
  items_total: number;
  total_taxable_value: number;
  total_tax: number;
  total: number;
  freight?: number;  // For backward compatibility

  // Tax breakdown
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;

  // Additional fields
  descriptions?: string;
  packing_forwarding_qty?: number;
  packing_forwarding_rate?: number;
  packing_forwarding_total?: number;
  notes?: string;

  // Payment fields
  payment_status?: number;
  payment_mode?: number;

  // Legacy fields for compatibility
  invoice_no?: number;  // May still be used in some places
  invoice_date?: number | string;  // May still be used
  fy?: number;
  transport?: string;
  items?: PurchaseItem[];
  item_count?: number;
  formattedDate?: string;

  // Related data
  vendor?: Vendor | null;
  staff?: Staff | null;
}

export default function PurchaseView() {
  const router = useRouter();
  const { id } = router.query;
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchPurchase();
    }
  }, [id]);

  // Listen for broadcast messages to refresh data when this purchase is updated in other tabs
  useEffect(() => {
    const unsubscribe = subscribeBroadcast((msg) => {
      if (msg.resource === 'purchases' && msg.type === 'updated' && msg.id && msg.id.toString() === id?.toString()) {
        console.log(`🔄 Purchase ${msg.id} updated in another tab, refreshing view page...`);
        fetchPurchase();
      }
    });

    return unsubscribe;
  }, [id]);

  const fetchPurchase = async () => {
    try {
      const response = await fetch(`/api/purchases/${id}`);
      if (response.ok) {
        const data = await response.json();
        const purchaseData = data.purchase || data;
        setPurchase(purchaseData);
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditPurchase = () => {
    if (purchase) {
      SessionStorageService.set('purchases', id.toString(), purchase);
    }
    router.push(`/purchases/create?edit=${id}`);
  };

  // Custom print function for the whole page with proper styling
  const handlePrintPage = () => {
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Purchase Invoice #${purchase.invoice_number || purchase.invoice_no}</title>
          <style>
            @media print {
              body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0;
                padding: 20px;
                background: white;
                color: black;
              }

              .print-header {
                background: #1e293b;
                color: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 30px;
                text-align: center;
                border: 1px solid #334155;
              }

              .print-header h1 {
                margin: 0;
                font-size: 24px;
                font-weight: bold;
              }

              .info-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 30px;
                margin-bottom: 30px;
              }

              .info-section {
                background: #f8fafc;
                padding: 20px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
              }

              .info-section h3 {
                margin: 0 0 15px 0;
                font-size: 16px;
                font-weight: bold;
                color: #1e293b;
                border-bottom: 2px solid #3b82f6;
                padding-bottom: 5px;
              }

              .info-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                padding: 4px 0;
                border-bottom: 1px solid #f1f5f9;
              }

              .info-label {
                font-weight: 500;
                color: #64748b;
              }

              .info-value {
                font-weight: 600;
                color: #1e293b;
              }

              .total-highlight {
                font-size: 18px;
                color: #dc2626;
              }

              .table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 30px;
                font-size: 12px;
              }

              .table th,
              .table td {
                border: 1px solid #e2e8f0;
                padding: 8px 12px;
                text-align: left;
              }

              .table th {
                background: #f8fafc;
                font-weight: bold;
                color: #1e293b;
              }

              .table tbody tr:nth-child(even) {
                background: #f8fafc;
              }

              .table tfoot {
                font-weight: bold;
                background: #e2e8f0;
              }

              .notes-section {
                margin-top: 30px;
                background: #fefefe;
                padding: 20px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
              }

              .notes-section h4 {
                margin: 0 0 10px 0;
                color: #1e293b;
                font-size: 14px;
              }

              .notes-content {
                background: white;
                padding: 10px;
                border-radius: 4px;
                border: 1px solid #e2e8f0;
                white-space: pre-wrap;
                font-size: 12px;
                line-height: 1.4;
              }

              @page {
                margin: 0.5in;
                size: A4;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>Purchase Invoice #${purchase.invoice_number || purchase.invoice_no} • ${purchase.vendor?.vendor_name} • ${formatDate(purchase.date || purchase.invoice_date)}</h1>
          </div>

          <div class="info-grid">
            <div class="info-section">
              <h3>Basic Information</h3>
              <div class="info-item">
                <span class="info-label">Total:</span>
                <span class="info-value total-highlight">₹${purchase.total?.toLocaleString('en-IN')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Items:</span>
                <span class="info-value">${purchase.items?.length || 0}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Invoice:</span>
                <span class="info-value">${purchase.invoice_number || purchase.invoice_no}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date:</span>
                <span class="info-value">${formatDate(purchase.date || purchase.invoice_date)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Status:</span>
                <span class="info-value">${purchase.payment_status === 1 ? 'Paid' : 'Unpaid'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Payment Mode:</span>
                <span class="info-value">${getPaymentModeText(purchase.payment_mode)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Bill Reference:</span>
                <span class="info-value">${purchase.bill_reference || 'N/A'}</span>
              </div>
            </div>

            <div class="info-section">
              <h3>Vendor Details</h3>
              <div class="info-item">
                <span class="info-label">Vendor:</span>
                <span class="info-value">${purchase.vendor?.vendor_name}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Contact:</span>
                <span class="info-value">${purchase.vendor?.contact_no || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span class="info-value">${purchase.vendor?.email || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">GSTIN:</span>
                <span class="info-value">${purchase.vendor?.tax_id || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Staff:</span>
                <span class="info-value">${purchase.staff?.name || 'N/A'}</span>
              </div>
            </div>

            <div class="info-section">
              <h3>Financial Summary</h3>
              <div class="info-item">
                <span class="info-label">Items Total:</span>
                <span class="info-value">₹${purchase.items_total?.toLocaleString('en-IN')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Freight:</span>
                <span class="info-value">₹${purchase.freight?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Taxable Value:</span>
                <span class="info-value">₹${purchase.total_taxable_value?.toLocaleString('en-IN')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Tax:</span>
                <span class="info-value">₹${purchase.total_tax?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Grand Total:</span>
                <span class="info-value total-highlight">₹${purchase.total?.toLocaleString('en-IN')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">CGST:</span>
                <span class="info-value">₹${purchase.total_cgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">SGST:</span>
                <span class="info-value">₹${purchase.total_sgst?.toLocaleString('en-IN') || '0'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">IGST:</span>
                <span class="info-value">₹${purchase.total_igst?.toLocaleString('en-IN') || '0'}</span>
              </div>
            </div>

            <div class="info-section">
              <h3>Transport Information</h3>
              <div class="info-item">
                <span class="info-label">Transport:</span>
                <span class="info-value">${purchase.transport_name || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Vehicle:</span>
                <span class="info-value">${purchase.vehicle_number || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Freight:</span>
                <span class="info-value">₹${purchase.freight?.toLocaleString('en-IN') || '0'}</span>
              </div>
            </div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th style="width: 60px;">SN</th>
                <th>Product Name</th>
                <th>Part No</th>
                <th>HSN</th>
                <th style="width: 80px;">Qty</th>
                <th style="width: 100px;">Rate</th>
                <th style="width: 120px;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${purchase.items?.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${item.product_name}</td>
                  <td>${item.part || 'N/A'}</td>
                  <td>${item.hsn || 'N/A'}</td>
                  <td>${item.qty}</td>
                  <td>₹${item.rate?.toLocaleString('en-IN')}</td>
                  <td>₹${(item.total || item.subtotal)?.toLocaleString('en-IN')}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" style="text-align: center;">No items found</td></tr>'}
            </tbody>
            ${purchase.items && purchase.items.length > 0 ? `
              <tfoot>
                <tr>
                  <td colspan="5" style="text-align: right; font-weight: bold;">Items Total:</td>
                  <td colspan="2" style="font-weight: bold;">₹${purchase.items_total?.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            ` : ''}
          </table>

          ${(purchase.notes || purchase.descriptions) ? `
            <div class="notes-section">
              ${purchase.notes ? `
                <h4>Notes:</h4>
                <div class="notes-content">${purchase.notes}</div>
              ` : ''}
              ${purchase.descriptions ? `
                <h4>Descriptions:</h4>
                <div class="notes-content">${purchase.descriptions}</div>
              ` : ''}
            </div>
          ` : ''}
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
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
  };

  // Custom PDF export function for the whole page
  const handleExportPageAsPDF = async () => {
    try {
      // Import html2pdf dynamically
      const html2pdf = (await import('html2pdf.js')).default;

      const element = document.querySelector('.card') as HTMLElement;
      if (!element) {
        alert('Error: Could not find page content for PDF export');
        return;
      }

      const options = {
        margin: 0.5,
        filename: `Purchase_${purchase.invoice_number || purchase.invoice_no}_Full_Page_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in' as const, format: 'a4' as const, orientation: 'portrait' as const }
      };

      await html2pdf().set(options).from(element).save();
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Error exporting PDF. Please try again.');
    }
  };

  // Custom Excel export function for the whole page data
  const handleExportPageAsExcel = () => {
    try {
      // Create comprehensive Excel data from the entire page
      const excelData = [];

      // Add header info
      excelData.push({
        'Section': 'Purchase Invoice Information',
        'Label': `Invoice #${purchase.invoice_number || purchase.invoice_no}`,
        'Value': '',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Purchase Invoice Information',
        'Label': 'Vendor',
        'Value': purchase.vendor?.vendor_name || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Purchase Invoice Information',
        'Label': 'Date',
        'Value': formatDate(purchase.date || purchase.invoice_date),
        'Notes': ''
      });

      excelData.push({
        'Section': 'Purchase Invoice Information',
        'Label': 'Status',
        'Value': purchase.payment_status === 1 ? 'Paid' : 'Unpaid',
        'Notes': ''
      });

      // Add basic purchase info
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Basic Information',
        'Label': 'Total Amount',
        'Value': purchase.total || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Basic Information',
        'Label': 'Items Count',
        'Value': purchase.items?.length || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Basic Information',
        'Label': 'Payment Mode',
        'Value': getPaymentModeText(purchase.payment_mode),
        'Notes': ''
      });

      excelData.push({
        'Section': 'Basic Information',
        'Label': 'Bill Reference',
        'Value': purchase.bill_reference || 'N/A',
        'Notes': ''
      });

      // Add vendor details
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Vendor Details',
        'Label': 'Vendor Name',
        'Value': purchase.vendor?.vendor_name || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Vendor Details',
        'Label': 'Contact',
        'Value': purchase.vendor?.contact_no || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Vendor Details',
        'Label': 'Email',
        'Value': purchase.vendor?.email || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Vendor Details',
        'Label': 'GSTIN',
        'Value': purchase.vendor?.tax_id || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Vendor Details',
        'Label': 'Staff',
        'Value': purchase.staff?.name || 'N/A',
        'Notes': ''
      });

      // Add financial summary
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'Items Total',
        'Value': purchase.items_total || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'Freight',
        'Value': purchase.freight || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'Taxable Value',
        'Value': purchase.total_taxable_value || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'Total Tax',
        'Value': purchase.total_tax || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'Grand Total',
        'Value': purchase.total || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'CGST',
        'Value': purchase.total_cgst || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'SGST',
        'Value': purchase.total_sgst || 0,
        'Notes': ''
      });

      excelData.push({
        'Section': 'Financial Summary',
        'Label': 'IGST',
        'Value': purchase.total_igst || 0,
        'Notes': ''
      });

      // Add transport info
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Transport Information',
        'Label': 'Transport Name',
        'Value': purchase.transport_name || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Transport Information',
        'Label': 'Vehicle Number',
        'Value': purchase.vehicle_number || 'N/A',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Transport Information',
        'Label': 'Freight Amount',
        'Value': purchase.freight || 0,
        'Notes': ''
      });

      // Add notes and descriptions
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Additional Information',
        'Label': 'Notes',
        'Value': purchase.notes || 'No notes available',
        'Notes': ''
      });

      excelData.push({
        'Section': 'Additional Information',
        'Label': 'Descriptions',
        'Value': purchase.descriptions || 'No descriptions available',
        'Notes': ''
      });

      // Add purchase items
      excelData.push({ 'Section': '', 'Label': '', 'Value': '', 'Notes': '' }); // Empty row
      excelData.push({
        'Section': 'Purchase Items',
        'Label': 'Item Details',
        'Value': '',
        'Notes': 'See below for itemized list'
      });

      // Add each purchase item
      purchase.items?.forEach((item, index) => {
        excelData.push({
          'Section': 'Purchase Items',
          'Label': `Item ${index + 1}`,
          'Value': item.product_name || 'N/A',
          'Notes': `Part: ${item.part || 'N/A'}, HSN: ${item.hsn || 'N/A'}, Qty: ${item.qty}, Rate: ₹${item.rate?.toLocaleString('en-IN')}, Total: ₹${(item.total || item.subtotal)?.toLocaleString('en-IN')}`
        });
      });

      // Add items total
      excelData.push({
        'Section': 'Purchase Items',
        'Label': 'Items Total',
        'Value': purchase.items_total || 0,
        'Notes': 'Sum of all item totals'
      });

      // Use the existing export utility
      const { exportToExcelGeneric } = require('../../../lib/export-utils');
      exportToExcelGeneric(excelData, {
        title: 'Purchase Details - Full Page',
        fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}_Full_Page_${new Date().toISOString().split('T')[0]}`
      });

    } catch (error) {
      console.error('Excel export error:', error);
      alert('Error exporting Excel. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="card">
        <p className="text-center text-slate-400">Purchase not found</p>
      </div>
    );
  }

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 0: return <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>;
      case 1: return <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>;
      default: return <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded-full">Unknown</span>;
    }
  };

  const getPaymentModeText = (mode?: number) => {
    switch (mode) {
      case 0: return 'Cash';
      case 1: return 'Bank';
      default: return 'N/A';
    }
  };

  const formatDate = (dateValue: number | string) => {
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

  return (
    <div className="space-y-6">
      {/* Single Comprehensive Card */}
      <div className="card">
        {/* Purchase Banner Inside Card */}
        <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 mb-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-blue-100">
              Purchase #{purchase.invoice_number || purchase.invoice_no} • {purchase.vendor?.vendor_name}
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          {/* Column 1: Basic Purchase Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Total:</span>
              <span className="text-white font-bold text-lg">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Items:</span>
              <span className="text-white font-medium">{purchase.items?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Invoice:</span>
              <span className="text-white font-medium">{purchase.invoice_number || purchase.invoice_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Date:</span>
              <span className="text-white font-medium">{formatDate(purchase.date || purchase.invoice_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status:</span>
              <span className="text-white font-medium">{getStatusBadge(purchase.payment_status)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Mode:</span>
              <span className="text-white font-medium">{getPaymentModeText(purchase.payment_mode)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference:</span>
              <span className="text-white font-medium">{purchase.bill_reference || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bill Reference Date:</span>
              <span className="text-white font-medium">{(purchase as any).bill_reference_date || 'N/A'}</span>
            </div>
          </div>

          {/* Column 2: Vendor & Staff Info */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Vendor:</span>
              <span className="text-white font-medium">{purchase.vendor?.vendor_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Contact:</span>
              <span className="text-white font-medium">{purchase.vendor?.contact_no || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email:</span>
              <span className="text-white font-medium">{purchase.vendor?.email || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="text-white font-medium">{purchase.vendor?.tax_id || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Staff:</span>
              <span className="text-white font-medium">{purchase.staff?.name || 'N/A'}</span>
            </div>
          </div>

          {/* Column 3: Financial Summary */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Items Total:</span>
              <span className="text-white font-medium">₹{purchase.items_total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Freight:</span>
              <span className="text-white font-medium">₹{purchase.freight?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Taxable Value:</span>
              <span className="text-white font-medium">₹{purchase.total_taxable_value?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Tax:</span>
              <span className="text-white font-medium">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-slate-400">Grand Total:</span>
              <span className="text-white font-bold">₹{purchase.total?.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST:</span>
              <span className="text-white font-medium">₹{purchase.total_cgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST:</span>
              <span className="text-white font-medium">₹{purchase.total_sgst?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST:</span>
              <span className="text-white font-medium">₹{purchase.total_igst?.toLocaleString('en-IN') || '0'}</span>
            </div>
          </div>

          {/* Column 4: Transport & Additional */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Transport:</span>
              <span className="text-white font-medium">{purchase.transport_name || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Vehicle:</span>
              <span className="text-white font-medium">{purchase.vehicle_number || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Freight:</span>
              <span className="text-white font-medium">₹{purchase.freight?.toLocaleString('en-IN') || '0'}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Notes:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {purchase.notes || 'No notes available'}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Descriptions:</span>
              </div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">
                {purchase.descriptions || 'No descriptions available'}
              </div>
            </div>
          </div>
        </div>

        {/* Actions Row - Separate from columns */}
        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <ExportMenu
              data={[purchase]}
              columns={[
                { key: 'invoice_number', label: 'Invoice Number', enabled: true },
                { key: 'vendor_name', label: 'Vendor Name', enabled: true },
                { key: 'date', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true },
                { key: 'transport_name', label: 'Transport', enabled: true },
                { key: 'notes', label: 'Notes', enabled: true },
              ]}
              config={{
                title: 'Purchase Details',
                fileName: `Purchase_${purchase.invoice_number || purchase.invoice_no}_${new Date().toISOString().split('T')[0]}`
              }}
            />
            <Link
              href={`/purchases/create?edit=${id}`}
              onClick={handleEditPurchase}
              className="btn-primary flex items-center gap-2"
              title="Edit Purchase"
            >
              <Edit className="w-4 h-4" />
              Edit Purchase
            </Link>
          </div>
        </div>

        {/* Purchase Items Table - Enhanced with more details */}
        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>HSN</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Tax %</th>
                  <th>Tax Amount</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {purchase.items?.map((item, index) => {
                  const taxAmount = (item.total || item.subtotal || 0) - ((item.qty * (item.rate || 0)) / (1 + (item.gst_percentage || 0) / 100));

                  return (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td className="font-medium text-white">{item.display_name || item.product_name}</td>
                      <td className="text-slate-300">{item.part || 'N/A'}</td>
                      <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                      <td className="text-slate-300 font-medium">{item.qty}</td>
                      <td className="text-slate-300">₹{item.rate?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300">{item.gst_percentage || item.tax || 0}%</td>
                      <td className="text-slate-300">₹{taxAmount?.toLocaleString('en-IN')}</td>
                      <td className="text-slate-300 font-semibold">₹{(item.total || item.subtotal)?.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                }) || (
                  <tr>
                    <td colSpan={9} className="text-center text-slate-400 py-4">
                      No items found for this purchase
                    </td>
                  </tr>
                )}
              </tbody>
              {purchase.items && purchase.items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td colSpan={4} className="text-right text-slate-300 font-semibold py-3 pr-4 text-sm">TOTALS</td>
                    <td className="text-white font-bold text-center py-3 bg-slate-700/20">{purchase.items?.reduce((sum, item) => sum + (item.qty || 0), 0)}</td>
                    <td className="text-slate-400 py-3 text-center">-</td>
                    <td className="text-slate-400 py-3 text-center">-</td>
                    <td className="text-white font-bold text-center py-3 bg-slate-700/20">₹{purchase.total_tax?.toLocaleString('en-IN') || '0'}</td>
                    <td className="text-white font-bold text-center py-3 bg-blue-600/10 border-l border-blue-500/30">₹{purchase.items_total?.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
