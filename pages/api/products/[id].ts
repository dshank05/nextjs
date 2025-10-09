import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

// Function to enhance a single product using new FK relationships
async function enhanceProduct(product: any) {
  if (!product) return null

  // Get foreign key IDs using new relationships - handle comma-separated car models
  const categoryIds = product.product_category_id ? [product.product_category_id] : []
  const subcategoryIds = product.product_subcategory_id ? [product.product_subcategory_id] : []
  const carModelIds = product.car_model_ids ?
    product.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id))
    : []
  const companyIds = product.company ? [parseInt(product.company)].filter(id => !isNaN(id)) : []

  // Batch fetch names using foreign key relationships
  const [categoryRecords, subcategoryRecords, carModelRecords, companyRecords] = await Promise.all([
    categoryIds.length > 0 ? prisma.product_category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, category_name: true }
    }) : Promise.resolve([]),
    subcategoryIds.length > 0 ? prisma.product_subcategory.findMany({
      where: { id: { in: subcategoryIds } },
      select: { id: true, subcategory_name: true }
    }) : Promise.resolve([]),
    carModelIds.length > 0 ? prisma.car_models.findMany({
      where: { id: { in: carModelIds } },
      select: { id: true, model_name: true }
    }) : Promise.resolve([]),
    companyIds.length > 0 ? prisma.product_company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, company_name: true }
    }) : Promise.resolve([])
  ])

  // Create lookup maps
  const categoryMap = new Map(categoryRecords.map(cat => [cat.id, cat.category_name]))
  const subcategoryMap = new Map(subcategoryRecords.map(sub => [sub.id, sub.subcategory_name]))
  const carModelMap = new Map(carModelRecords.map(model => [model.id, model.model_name]))
  const companyMap = new Map(companyRecords.map(comp => [comp.id.toString(), comp.company_name]))

  // Look up names using foreign key maps
  const categoryName = product.product_category_id ? categoryMap.get(product.product_category_id) || '' : ''
  const subcategoryName = product.product_subcategory_id ? subcategoryMap.get(product.product_subcategory_id) || '' : ''
  const companyName = product.company ? companyMap.get(product.company) || '' : ''

  // Handle comma-separated car model IDs
  let carModelNames: string[] = [];
  if (product.car_model_ids) {
    const modelIds = product.car_model_ids.split(',').map((id: string) => parseInt(id.trim())).filter((id: any) => !isNaN(id));
    carModelNames = modelIds.map(id => carModelMap.get(id)).filter(Boolean) as string[];
  }

  // Separate display for clean data presentation
  const subcategoryDisplay = subcategoryName; // Only subcategory
  const carModelsDisplay = carModelNames.join(', '); // Only car models

  return {
    ...product,
    categoryName,
    companyName,
    subcategoryName: subcategoryDisplay, // Separate subcategory field
    carModelsDisplay, // Separate car models field
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        const product = await prisma.product.findUnique({
          where: { id: productId }
        })

        if (!product) {
          return res.status(404).json({ message: 'Product not found' })
        }

        const enhancedProduct = await enhanceProduct(product)
        res.status(200).json(enhancedProduct)

      } catch (error) {
        console.error('Get product error:', error)
        res.status(500).json({ message: 'Failed to fetch product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'PUT':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        const {
          // ===== MAIN PRODUCT TABLE FIELDS (EXISTING) =====
          product_name,
          display_name,
          product_category_id,
          product_subcategory_id,
          car_model_ids,
          company,
          part_no,
          min_stock,
          stock,
          rate,
          hsn,
          notes,
          is_active, // Add is_active field

          // ===== FIELDS CURRENTLY NOT IN SCHEMA =====
          gst_rate,
          warehouse,
          warehouse_id, // FK field
          gst_rate_id, // FK field
          rack_number,
          descriptions,
          mrp,
          discount,
          sale_price, // Legacy naming from UI
        } = req.body

        // Validate required fields - skip product_name validation if we're only updating is_active
        const requestFields = Object.keys(req.body);
        const isOnlyStatusUpdate = requestFields.length === 1 && requestFields[0] === 'is_active';

        if (!product_name && !isOnlyStatusUpdate) {
          return res.status(400).json({ message: 'Product name is required' })
        }

        // Validate warehouse is required for non-status updates
        if (!isOnlyStatusUpdate && warehouse_id !== undefined && warehouse_id === null) {
          return res.status(400).json({ message: 'Warehouse is required' })
        }

        // ===== FUTURE SCHEMA EXPANSION FIELDS =====
        // These fields don't exist in current schema, handled separately
        const extraFields = {
          gst_rate,
          warehouse,
          rack_number,
          descriptions,
          mrp,
          discount,
          margin: sale_price, // Rename for consistency
        };

        // Build enhanced notes with extra fields
        const extraFieldsString = Object.entries(extraFields)
          .filter(([key, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');

        const enhancedNotes = notes
          ? `${notes}\n\nAdditional Fields:\n${extraFieldsString}`
          : `Additional Fields:\n${extraFieldsString}`;

        // ===== PRODUCT TABLE DATA =====
        // Only include fields that were actually sent in the request
        const productData: any = {};

        // Handle main product fields - only include if they were sent
        if (product_name !== undefined) productData.product_name = product_name;
        if (display_name !== undefined || product_name !== undefined) {
          productData.display_name = display_name || product_name;
        }
        if (product_category_id !== undefined) productData.product_category_id = product_category_id ? parseInt(product_category_id) : null;
        if (product_subcategory_id !== undefined) productData.product_subcategory_id = product_subcategory_id ? parseInt(product_subcategory_id) : null;
        if (car_model_ids !== undefined) productData.car_model_ids = car_model_ids || null;
        if (company !== undefined) productData.company = company ? company.toString() : null;
        if (part_no !== undefined) productData.part_no = part_no;
        if (min_stock !== undefined) productData.min_stock = min_stock ? parseInt(min_stock) : null;
        if (stock !== undefined) productData.stock = stock ? parseInt(stock) : null;
        if (rate !== undefined) productData.rate = rate ? parseFloat(rate) : null;
        if (hsn !== undefined) productData.hsn = hsn;
        if (is_active !== undefined) productData.is_active = Boolean(is_active); // Handle active status toggle
        if (notes !== undefined || Object.keys(extraFields).length > 0) {
          productData.notes = notes ? `${notes}\n\nAdditional Fields:\n${extraFieldsString}` : `Additional Fields:\n${extraFieldsString}`;
        }

        // Handle FK fields
        if (warehouse_id !== undefined) productData.warehouse_id = warehouse_id ? parseInt(warehouse_id) : null;
        if (gst_rate_id !== undefined) productData.gst_rate_id = gst_rate_id ? parseInt(gst_rate_id) : null;

        // ===== FUTURE SCHEMA EXPANSION LOGGING =====
        const futureExpansionData = {
          product_enhancements: {
            gst_rate: gst_rate ? parseFloat(gst_rate) : null,
            warehouse,
            rack_number,
            descriptions,
          },
          pricing_info: {
            mrp: mrp ? parseFloat(mrp) : null,
            discount: discount ? parseFloat(discount) : null,
            margin: sale_price ? parseFloat(sale_price) : null,
          }
        };

        console.log('🔄 Product Update Data:', productData);
        console.log('📋 Future Enhancement Data (not saved yet):', futureExpansionData);

        const updatedProduct = await prisma.product.update({
          where: { id: productId },
          data: productData,
        })

        const enhancedProduct = await enhanceProduct(updatedProduct)
        res.status(200).json(enhancedProduct)

      } catch (error) {
        console.error('Update product error:', error)
        res.status(500).json({ message: 'Failed to update product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    case 'DELETE':
      try {
        const productId = parseInt(id as string)
        if (isNaN(productId)) {
          return res.status(400).json({ message: 'Invalid product ID' })
        }

        await prisma.product.delete({
          where: { id: productId }
        })

        res.status(204).end()

      } catch (error) {
        console.error('Delete product error:', error)
        res.status(500).json({ message: 'Failed to delete product', error: error instanceof Error ? error.message : 'Unknown error' })
      }
      break

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE'])
      res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
