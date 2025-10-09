import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      category = '',
      lowStock = 'false',
      includeInactive = 'false' // New parameter to include inactive products
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Filter active products by default unless explicitly requested to include inactive
    if (includeInactive !== 'true') {
      where.is_active = true
    }

      if (search) {
        // Search normalization function
        const normalizeSearchText = (text: string): string => {
          return text
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '') // Remove all whitespace
            .replace(/[^a-z0-9]/g, '') // Remove special characters except alphanumeric
        }

        const normalizedSearch = normalizeSearchText(search as string)

        where.OR = [
          // Original search for exact matches
          { product_name: { contains: search as string } },
          { part_no: { contains: search as string } },
          // Normalized search for flexible matching
          {
            product_name: {
              contains: normalizedSearch
            }
          },
          {
            part_no: {
              contains: normalizedSearch
            }
          }
        ]
      }

    if (category && category !== '') {
      where.product_category = parseInt(category as string)
    }

    if (lowStock === 'true') {
      // Simple low stock filter - raw SQL for complex comparison
      // For now, let's skip this complex filter and implement later
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { id: 'desc' },
        include: {
          gst_rate: true, // Include GST rate details
        },
      }),
      prisma.product.count({ where }),
    ])

    // Process products to calculate selling price and GST rate percentage
    const processedProducts = products.map(product => {
      let sellingPrice = null
      let gstRatePercentage = product.gst_rate?.rate || 0

      // Calculate selling price directly from schema fields (SP = MRP - Discount + Margin)
      if (product.mrp && product.mrp > 0) {
        const discount = product.discount || 0
        const margin = product.margin || 0
        sellingPrice = product.mrp - discount + margin
      }

      return {
        ...product,
        selling_price: sellingPrice,
        gst_rate_percentage: gstRatePercentage,
        // Keep backward compatibility with existing gst_rate field
      }
    })

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      products: processedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Products fetch error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch products',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      // ===== MAIN PRODUCT TABLE FIELDS =====
      product_name,
      product_category_id,
      product_subcategory_id,
      car_model_ids,
      company,
      part_no,
      min_stock,
      opening_stock,
      stock,
      opening_rate,
      hsn,
      notes,

      // ===== NEW FK FIELDS (STORED IN DATABASE) =====
      warehouse_id,              // ✓ Product.warehouse_id (FK to warehouse)
      gst_rate_id,               // ✓ Product.gst_rate_id (FK to gst_tax_rate)

      // ===== PRODUCT DETAILS =====
      descriptions,              // ✓ Product.descriptions

      // ===== PRICING FIELDS (STORED IN PROPER SCHEMA FIELDS) =====
      // SP = MRP - Discount + Margin (absolute INR values)
      mrp,                       // ✓ Product.mrp
      discount,                  // ✓ Product.discount
      margin,                    // ✓ Product.margin

      // ===== LEGACY FIELDS (KEEP FOR BACKWARD COMPATIBILITY) =====
      rack_number,               // TODO: unused field, will be removed later
    } = req.body

    console.log('📝 API Received POST data:', req.body);

    // ===== VALIDATION =====
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required' })
    }

    if (!warehouse_id) {
      return res.status(400).json({ message: 'Warehouse is required' })
    }

    // Validate company FK if provided (integer input expected)
    if (company && !isNaN(parseInt(company))) {
      const companyExists = await prisma.product_company.findUnique({
        where: { id: parseInt(company) }
      });
      if (!companyExists) {
        return res.status(400).json({ message: 'Invalid company selected' })
      }
    }

    // ===== VALIDATE FK RELATIONSHIPS =====
    // Validate warehouse exists if provided
    if (warehouse_id) {
      const warehouseExists = await prisma.warehouse.findUnique({
        where: { id: parseInt(warehouse_id) }
      })
      if (!warehouseExists) {
        return res.status(400).json({ message: 'Invalid warehouse selected' })
      }
    }

    // Validate GST rate exists if provided
    if (gst_rate_id) {
      const gstRateExists = await prisma.gst_tax_rate.findUnique({
        where: { id: parseInt(gst_rate_id) }
      })
      if (!gstRateExists) {
        return res.status(400).json({ message: 'Invalid GST rate selected' })
      }
    }

    // ===== NOTES =====
    // Store notes directly - no need to append legacy fields

    // ===== PRODUCT TABLE DATA =====
    const productData = {
      // Core Product fields (goes to Product table)
      product_name: product_name,
      product_category_id: product_category_id ? parseInt(product_category_id) : null,
      product_subcategory_id: product_subcategory_id ? parseInt(product_subcategory_id) : null,
      car_model_ids: car_model_ids || null, // Comma-separated car model IDs
      company: company ? company.toString() : null, // Convert to string for schema
      part_no: part_no || null,
      min_stock: min_stock ? parseInt(min_stock) : null,
      stock: stock ? parseInt(stock) : null,
      opening_stock: opening_stock ? parseInt(opening_stock) : null,
      opening_rate: opening_rate ? parseFloat(opening_rate) : null,
      hsn: hsn || null,

      // ===== PRODUCT DETAILS =====
      descriptions: descriptions || null, // Now stored in proper schema field

      // ===== PRICING INFORMATION =====
      mrp: mrp ? parseFloat(mrp) : null,        // Maximum Retail Price
      discount: discount ? parseFloat(discount) : null, // Discount amount
      margin: margin ? parseFloat(margin) : null,       // Profit margin amount

      // ===== WAREHOUSE & TAX RELATIONSHIPS =====
      warehouse_id: warehouse_id ? parseInt(warehouse_id) : null,
      gst_rate_id: gst_rate_id ? parseInt(gst_rate_id) : null,

      // ===== LEGACY/NOTES =====
      notes: notes || null, // General notes (separate from legacy fields)
      rack_number: rack_number || null, // @deprecated - TODO: remove this unused field
    };

    console.log('🏗️ Product Table Data:', productData);

    const product = await prisma.product.create({
      data: productData,
    })

    console.log('✅ Product created successfully:', product);

    res.status(201).json(product)
  } catch (error) {
    console.error('❌ Product creation error:', error)
    res.status(500).json({
      message: 'Failed to create product',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
