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
      product_category,
      product_subcategory,
      company,
      part_no,
      min_stock,
      stock,
      rate,
      hsn,
      notes,
      // Additional fields from the modal
      car_model,
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

    // For now, we'll store additional fields in the notes field as JSON
    // since the database schema doesn't have all these fields
    const additionalData = {
      car_model,
      gst_rate,
      warehouse,
      rack_number,
      descriptions,
      mrp,
      discount,
      sale_price,
    };

    const notesWithExtras = notes ?
      `${notes}\n\nAdditional Data: ${JSON.stringify(additionalData)}` :
      `Additional Data: ${JSON.stringify(additionalData)}`;

    const product = await prisma.product.create({
      data: {
        product_name,
        product_category,
        product_subcategory,
        company,
        part_no,
        min_stock: min_stock ? parseInt(min_stock) : 0,
        stock: stock ? parseInt(stock) : 0,
        rate: rate ? parseInt(rate) : null,
        hsn,
        notes: notesWithExtras,
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
