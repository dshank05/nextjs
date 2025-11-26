import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, context = 'purchase', vendorState } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Barcode required' });
  }

  // Handle context being string or string[]
  const contextStr = Array.isArray(context) ? context[0] : context;

  console.log(`🔍 ${contextStr.toUpperCase()} barcode lookup:`, code);

  try {
    // Get product with all relations
    const product = await prisma.product.findFirst({
      where: { barcode: code, is_active: true },
      include: {
        category_ref: true,
        subcategory_ref: true,
        product_company_ref: true,
        gst_rate: true
      }
    });

    if (!product) {
      console.log('❌ No product found for barcode:', code);
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        barcode: code
      });
    }

    // Get car model names
    let carModelNames = '';
    if (product.car_model_ids) {
      const modelIds = product.car_model_ids.split(',').map(id => parseInt(id.trim()));
      const models = await prisma.car_models.findMany({
        where: { id: { in: modelIds } },
        select: { model_name: true }
      });
      carModelNames = models.map(m => m.model_name).join(', ');
    }

    // Context-dependent pricing
    const qty = 1;
    let rate = 0;
    let gstPercentage = product.gst_rate?.rate || 0;

    switch (contextStr) {
      case 'purchase':
        rate = product.latest_purchase_rate || product.opening_rate || 0;
        break;
      case 'sale':
      case 'salex':
        // Calculate selling price: opening_rate + margin - discount
        const openingRate = product.opening_rate || 0;
        const margin = product.margin || 0;
        const discount = product.discount || 0;
        rate = openingRate + margin - discount;
        break;
    }

    // Tax calculations
    const businessState = 'Uttar Pradesh';
    const counterpartyState = (Array.isArray(vendorState) ? vendorState[0] : vendorState) || businessState;
    const isIntraState = counterpartyState === businessState;

    const subtotal = qty * rate;
    const taxAmount = (subtotal * gstPercentage) / 100;

    const cgst = isIntraState ? taxAmount / 2 : 0;
    const sgst = isIntraState ? taxAmount / 2 : 0;
    const igst = !isIntraState ? taxAmount : 0;

    const productData = {
      product_id: product.id,
      product_name: product.product_name,
      display_name: product.display_name,
      part_number: product.part_no || '',
      hsn: product.hsn,

      category: product.product_category_id?.toString() || '',
      category_name: product.category_ref?.category_name || '',
      sub_category: product.product_subcategory_id?.toString() || '',
      subcategory_name: product.subcategory_ref?.subcategory_name || '',
      company: product.company_id?.toString() || '',
      company_name: product.product_company_ref?.company_name || '',

      car_model: carModelNames,
      car_model_ids: product.car_model_ids,

      qty,
      rate,
      gst_percentage: gstPercentage,
      tax: taxAmount,
      cgst,
      sgst,
      igst,
      total: subtotal + taxAmount,

      stock: product.stock,
      min_stock: product.min_stock,
      notes: product.notes
    };

    console.log(`✅ ${contextStr.toUpperCase()} product found:`, product.product_name);

    return res.status(200).json({
      success: true,
      product: productData,
      scanned_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Barcode lookup error:', error);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}
