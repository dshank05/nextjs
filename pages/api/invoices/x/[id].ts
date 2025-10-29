import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`,
    });
  }

  try {
    const invoiceId = parseInt(id as string);

    if (isNaN(invoiceId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid invoice ID',
      });
    }

    // Fetch the invoicex
    const invoicex = await prisma.invoicex.findUnique({
      where: { id: invoiceId },
    });

    if (!invoicex) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found',
      });
    }

    // Fetch invoice items
    const invoiceItems = await prisma.invoice_itemsx.findMany({
      where: { invoice_no: invoicex.invoice_no },
      orderBy: { id: 'asc' },
    });

    // Get customer details if select_customer is set
    let customerDetails = null;
    if (invoicex.select_customer) {
      customerDetails = await prisma.customer_details.findUnique({
        where: { id: invoicex.select_customer },
      });
    }

    // Format invoice data
    const formattedInvoice = {
      id: invoicex.id,
      invoice_no: invoicex.invoice_no,
      select_customer: invoicex.select_customer,
      customer_name: customerDetails?.billing_name || '',
      contact_number: customerDetails?.contact_no || '',
      address: customerDetails?.billing_address || '',
      address_2: customerDetails?.billing_address_2 || '',
      city: customerDetails?.billing_city || '',
      email_id: customerDetails?.email || '',
      state: customerDetails?.billing_state || '',
      gst_number: customerDetails?.billing_gstin || '',
      items_total: invoicex.items_total,
      freight: invoicex.freight,
      total_taxable_value: invoicex.total_taxable_value,
      taxrate: invoicex.taxrate,
      total_cgst: invoicex.total_cgst,
      total_sgst: invoicex.total_sgst,
      total_igst: invoicex.total_igst,
      total_tax: invoicex.total_tax,
      total: invoicex.total,
      subtotal: invoicex.total,
      notes: invoicex.notes,
      invoice_date: invoicex.invoice_date,
      updated_at: invoicex.updated_at,
      payment_mode: invoicex.payment_mode,
      payment_status: invoicex.payment_status,
      status: invoicex.payment_status,
      fy: invoicex.fy,
      staff_details: invoicex.staff_details,
      staff_id: invoicex.staff_id,
      commission: invoicex.commission,
      mechanic_id: invoicex.mechanic_id,
      descriptions: invoicex.descriptions,
      packing_forwarding_qty: invoicex.packing_forwarding_qty,
      packing_forwarding_rate: invoicex.packing_forwarding_rate,
      packing_forwarding_total: invoicex.packing_forwarding_total,
      bill_reference: invoicex.bill_reference,
      discount: invoicex.discount,
      return_status: invoicex.return_status || 0,
    };

    // Format invoice items
    const formattedItems = invoiceItems.map(item => ({
      id: item.id,
      invoice_no: item.invoice_no,
      name_of_product: item.name_of_product,
      product_id: item.product_id,
      category_id: item.category_id,
      subcategory_id: item.subcategory_id,
      model_id: item.model_id,
      company_id: item.company_id,
      hsn: item.hsn,
      part: item.part,
      qty: item.qty,
      rate: item.rate,
      subtotal: item.subtotal,
      invoice_date: item.invoice_date,
      fy: item.fy,
      cgst: item.cgst,
      gst_percentage: item.gst_percentage,
      igst: item.igst,
      sgst: item.sgst,
      tax: item.tax,
      discount: item.discount,
      discountrate: item.discountrate,
    }));

    res.status(200).json({
      success: true,
      invoicex: formattedInvoice,
      invoiceItems: formattedItems,
    });
  } catch (error) {
    console.error('Error fetching invoicex:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invoice',
    });
  }
}
