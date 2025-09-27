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
          { display_name: { contains: search as string } },
          { part_no: { contains: search as string } },
          // Normalized search for flexible matching
          {
            product_name: {
              contains: normalizedSearch
            }
          },
          {
            display_name: {
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
      product_name,
      display_name,
      product_category_id,
      product_subcategory_id,
      car_model_ids, // Changed from car_model_id
      company, // This should be company_id (FK)
      part_no,
      min_stock,
      stock,
      rate,
      hsn,
      notes,
      gst_rate,
      warehouse,
      rack_number,
      descriptions,
      mrp,
      discount,
      margin, // Changed from sale_price to match UI label
    } = req.body

    console.log('📝 API Received POST data:', req.body);

    // Validate required fields
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required' })
    }

    // Validate company FK if provided
    if (company && !isNaN(parseInt(company))) {
      const companyExists = await prisma.product_company.findUnique({
        where: { id: parseInt(company) }
      });
      if (!companyExists) {
        return res.status(400).json({ message: 'Invalid company selected' })
      }
    }

    // For now, store additional fields in notes or skip them since they don't exist in schema
    // We'll need to update the schema to add these fields later
    const enhancedNotes = notes ? `${notes}

Additional Data:
${gst_rate ? `GST Rate: ${gst_rate}` : ''}
${warehouse ? `Warehouse: ${warehouse}` : ''}
${rack_number ? `Rack: ${rack_number}` : ''}
${descriptions ? `Desc: ${descriptions}` : ''}
${mrp ? `MRP: ${mrp}` : ''}
${discount ? `Discount: ${discount}` : ''}
${margin ? `Margin: ${margin}` : ''}` :
    `Additional Data:
${gst_rate ? `GST Rate: ${gst_rate}` : ''}
${warehouse ? `Warehouse: ${warehouse}` : ''}
${rack_number ? `Rack: ${rack_number}` : ''}
${descriptions ? `Desc: ${descriptions}` : ''}
${mrp ? `MRP: ${mrp}` : ''}
${discount ? `Discount: ${discount}` : ''}
${margin ? `Margin: ${margin}` : ''}`;

    const product = await prisma.product.create({
      data: {
        product_name,
        display_name: display_name || product_name,
        product_category_id: product_category_id ? parseInt(product_category_id) : null,
        product_subcategory_id: product_subcategory_id ? parseInt(product_subcategory_id) : null,
        // Store car_model_ids as comma-separated string (schema expects this)
        car_model_ids: car_model_ids || null,
        // For now keep company as string, but we should update schema to make it FK
        company: company ? company.toString() : null,
        part_no: part_no || null,
        min_stock: min_stock ? parseInt(min_stock) : null,
        stock: stock ? parseInt(stock) : null,
        rate: rate ? parseFloat(rate) : null,
        hsn: hsn || null,
        notes: enhancedNotes,
      },
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
