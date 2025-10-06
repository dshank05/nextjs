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
      lowStock = 'false' 
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}
    
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
      }),
      prisma.product.count({ where }),
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      products,
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
      stock,
      rate,
      hsn,
      notes,

      // ===== FIELDS CURRENTLY NOT IN SCHEMA (STORED IN NOTES) =====
      gst_rate,
      warehouse,
      rack_number,
      descriptions,

      // ===== PRICING FIELDS (NOT IN SCHEMA YET) =====
      mrp,
      discount,
      margin, // Changed from sale_price to match UI label
    } = req.body

    console.log('📝 API Received POST data:', req.body);

    // ===== VALIDATION =====
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required' })
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

    // ===== FUTURE SCHEMA EXPANSION FIELDS =====
    // These fields don't exist in current Product table, stored in notes for now
    // TODO: Add these fields to Product schema when ready:
    // - gst_rate: Float?
    // - warehouse: String?
    // - rack_number: String?
    // - descriptions: String? (different from notes)
    // - mrp: Float?
    // - discount: Float?
    // - margin: Float?
    const extraFields = {
      gst_rate,
      warehouse,
      rack_number,
      descriptions,
      mrp,
      discount,
      margin,
    };

    // Build enhanced notes with extra fields for now
    const extraFieldsString = Object.entries(extraFields)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const enhancedNotes = notes
      ? `${notes}\n\nAdditional Fields:\n${extraFieldsString}`
      : `Additional Fields:\n${extraFieldsString}`;

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
      rate: rate ? parseFloat(rate) : null,
      hsn: hsn || null,
      notes: enhancedNotes,
    };

    // ===== FUTURE SCHEMA EXPANSION =====
    // Data collection for fields not yet in schema:
    const futureTableFields = {
      product_pricing: { // Could be separate pricing table
        mrp: mrp ? parseFloat(mrp) : null,
        discount: discount ? parseFloat(discount) : null,
        margin: margin ? parseFloat(margin) : null,
      },
      product_location: { // Could be separate warehouse/location table
        warehouse,
        rack_number,
        gst_rate: gst_rate ? parseFloat(gst_rate) : null,
      },
      product_details: { // Additional product metadata
        descriptions,
      }
    };

    console.log('🏗️ Main Product Table Data:', productData);
    console.log('📋 Future Schema Expansion Data:', futureTableFields);

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
