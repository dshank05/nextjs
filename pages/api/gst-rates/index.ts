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
    case 'PUT':
      return handlePut(req, res)
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
      includeInactive = 'false',
      sortBy = 'description',
      sortOrder = 'asc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum
    const sortField = sortBy as string
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Build where clause
    const where: any = {}

    if (search) {
      const searchTerm = search as string
      const searchConditions: any[] = [
        { description: { contains: searchTerm } },
        { hsn_code: { contains: searchTerm } },
        { applicable_for: { contains: searchTerm } }
      ]

      // If search term is numeric, also search by rate
      const rateValue = parseFloat(searchTerm)
      if (!isNaN(rateValue)) {
        searchConditions.push({ rate: { equals: rateValue } })
      }

      where.OR = searchConditions
    }

    // Filter for active records by default, unless includeInactive is true
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'description', 'rate', 'hsn_code', 'applicable_for', 'status']
    const field = validSortFields.includes(sortField) ? sortField : 'description'

    const [gstRates, total] = await Promise.all([
      prisma.gst_tax_rate.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [field]: sortDirection }
      }),
      prisma.gst_tax_rate.count({ where })
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      gstRates,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('GST rates fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch GST rates',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { description, rate, hsn_code, applicable_for, status } = req.body

    // Validation
    if (!description || !rate || !hsn_code) {
      return res.status(400).json({
        message: 'Description, rate, and HSN code are required'
      })
    }

    // Check if GST rate with same description already exists
    const existingRate = await prisma.gst_tax_rate.findFirst({
      where: { description }
    })

    if (existingRate) {
      return res.status(400).json({
        message: 'GST rate with this description already exists'
      })
    }

    const gstRate = await prisma.gst_tax_rate.create({
      data: {
        description,
        rate: parseFloat(rate),
        hsn_code,
        applicable_for: applicable_for || '',
        status: status || 'Active'
      }
    })

    res.status(201).json({
      status: "success",
      message: "GST rate created successfully"
    })
  } catch (error) {
    console.error('GST rate creation error:', error)
    res.status(500).json({
      message: 'Failed to create GST rate',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, description, rate, hsn_code, applicable_for, status } = req.body

    // Check if GST rate exists
    const existingRate = await prisma.gst_tax_rate.findUnique({
      where: { id: parseInt(id) }
    })

    if (!existingRate) {
      return res.status(404).json({
        message: 'GST rate not found'
      })
    }

    // Handle status-only update (for toggle functionality)
    if (description === undefined && rate === undefined && hsn_code === undefined && applicable_for === undefined && status) {
      const updatedRate = await prisma.gst_tax_rate.update({
        where: { id: parseInt(id) },
        data: { status }
      })
      return res.status(200).json({
        status: "success",
        message: "GST rate updated successfully"
      })
    }

    // Full update validation - accept snake_case field names like the frontend sends
    if (!description || rate === undefined || !hsn_code) {
      return res.status(400).json({
        message: 'Description, rate, and HSN code are required'
      })
    }

    // Check if another GST rate with same description exists (excluding current one)
    const duplicateRate = await prisma.gst_tax_rate.findFirst({
      where: {
        description,
        id: { not: parseInt(id) }
      }
    })

    if (duplicateRate) {
      return res.status(400).json({
        message: 'Another GST rate with this description already exists'
      })
    }

    const updateData: any = {
      description,
      rate: parseFloat(rate),
      hsn_code, // Frontend sends snake_case, store as snake_case
      applicable_for: applicable_for || '' // Frontend sends snake_case, store as snake_case
    }

    // Include status if provided
    if (status) {
      updateData.status = status
    }

    const updatedRate = await prisma.gst_tax_rate.update({
      where: { id: parseInt(id) },
      data: updateData
    })

    res.status(200).json({
      status: "success",
      message: "GST rate updated successfully"
    })
  } catch (error) {
    console.error('GST rate update error:', error)
    res.status(500).json({
      message: 'Failed to update GST rate',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
