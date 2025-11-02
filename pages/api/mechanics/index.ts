import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
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

// GET /api/mechanics - List all active mechanics with pagination, search, and sorting
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      includeInactive = 'false',
      sortBy = 'name',
      sortOrder = 'asc',
      page = '1',
      limit = '50',
      search = ''
    } = req.query

    const pageNum = parseInt(page as string, 10) || 1
    const limitNum = parseInt(limit as string, 10) || 50
    const offset = (pageNum - 1) * limitNum

    const where: any = {}
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    // Add search filter
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim()
      where.OR = [
        { name: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
        { city: { contains: searchTerm } },
      ]
    }

    // Build orderBy based on sortBy and sortOrder
    const orderBy: any = {}
    const validSortFields = ['name', 'phone', 'city', 'status', 'created_at']
    const field = validSortFields.includes(sortBy as string) ? sortBy as string : 'name'
    const order = sortOrder === 'desc' ? 'desc' : 'asc'
    orderBy[field] = order

    // Get total count for pagination
    const total = await prisma.mechanic.count({ where })

    const mechanics = await prisma.mechanic.findMany({
      where,
      orderBy,
      skip: offset,
      take: limitNum,
    })

    const totalPages = Math.ceil(total / limitNum)
    const hasMore = pageNum < totalPages

    res.status(200).json({
      mechanics,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore
      }
    })
  } catch (error) {
    console.error('Get mechanics error:', error)
    res.status(500).json({
      message: 'Failed to fetch mechanics',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// POST /api/mechanics - Create new mechanic
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      name,
      phone,
      city,
      status = 'Active'
    } = req.body

    // Validation
    if (!name || !phone) {
      return res.status(400).json({
        message: 'Name and phone are required'
      })
    }

    // Check if phone already exists
    const existingMechanic = await prisma.mechanic.findFirst({
      where: { phone }
    })

    if (existingMechanic) {
      return res.status(400).json({
        message: 'Mechanic with this phone number already exists'
      })
    }

    const mechanicData: any = {
      name: name.trim(),
      phone: phone.trim(),
      status
    }

    if (city !== undefined && city !== '') {
      mechanicData.city = city.trim()
    }

    const mechanic = await prisma.mechanic.create({
      data: mechanicData,
    })

    res.status(201).json({
      status: "success",
      message: "Mechanic created successfully"
    })
  } catch (error) {
    console.error('Create mechanic error:', error)
    res.status(500).json({
      message: 'Failed to create mechanic',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


export default withObservability(handler)