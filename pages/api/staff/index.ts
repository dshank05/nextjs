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

// GET /api/staff - List all active staff
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { 
      includeInactive = 'false',
      page = '1',
      limit = '50',
      search = '',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'name', 'email', 'phone', 'status']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'name'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    const where: any = {}
    
    // Search filter
    if (search) {
      const searchTerm = search as string
      where.OR = [
        { name: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
        { email: { contains: searchTerm } }
      ]
    }

    // Status filter
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    const [staff, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        orderBy: { [sortField]: sortDirection },
        skip,
        take: limitNum
      }),
      prisma.staff.count({ where })
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      staff,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages
      }
    })
  } catch (error) {
    console.error('Get staff error:', error)
    res.status(500).json({
      message: 'Failed to fetch staff',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// POST /api/staff - Create new staff member
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      name,
      email,
      phone,
      status = 'Active'
    } = req.body

    // Validation
    if (!name || !phone) {
      return res.status(400).json({
        message: 'Name and phone are required'
      })
    }

    // Check if phone already exists
    const existingStaff = await prisma.staff.findFirst({
      where: { phone }
    })

    if (existingStaff) {
      return res.status(400).json({
        message: 'Staff member with this phone number already exists'
      })
    }

    const staffData = {
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone.trim(),
      status
    }

    const staff = await prisma.staff.create({
      data: staffData,
    })

    res.status(201).json({
      status: "success",
      message: "Staff member created successfully"
    })
  } catch (error) {
    console.error('Create staff error:', error)
    res.status(500).json({
      status: "failure",
      message: 'Failed to create staff member'
    })
  }
}
