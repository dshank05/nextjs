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
    const { includeInactive = 'false' } = req.query

    const where: any = {}
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    const staff = await prisma.staff.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    res.status(200).json({
      staff,
      count: staff.length
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

    res.status(201).json(staff)
  } catch (error) {
    console.error('Create staff error:', error)
    res.status(500).json({
      message: 'Failed to create staff member',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
