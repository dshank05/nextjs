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
      where.OR = [
        { product_name: { contains: search as string } },
        { part_no: { contains: search as string } },
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
      car_model_id,
      company,
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
      sale_price,
    } = req.body

    // Validate required fields
    if (!product_name) {
      return res.status(400).json({ message: 'Product name is required' })
    }

    const product = await prisma.product.create({
      data: {
        product_name,
        display_name: display_name || product_name, // Use display_name or fallback to product_name
        product_category_id: product_category_id ? parseInt(product_category_id) : null,
        product_subcategory_id: product_subcategory_id ? parseInt(product_subcategory_id) : null,
        car_model_id: car_model_id ? parseInt(car_model_id) : null,
        company,
        part_no,
        min_stock: min_stock ? parseInt(min_stock) : null,
        stock: stock ? parseInt(stock) : null,
        rate: rate ? parseFloat(rate) : null,
        hsn,
        notes,
        // Store additional data in separate fields (to be added to schema later)
        // For now, keep backward compatibility
      },
    })

    res.status(201).json(product)
  } catch (error) {
    console.error('Product creation error:', error)
    res.status(500).json({
      message: 'Failed to create product',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
