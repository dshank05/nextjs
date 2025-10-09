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

// GET /api/mechanics - List all active mechanics
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { includeInactive = 'false' } = req.query

    const where: any = {}
    if (includeInactive !== 'true') {
      where.status = 'Active'
    }

    const mechanics = await prisma.mechanic.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    res.status(200).json({
      mechanics,
      count: mechanics.length
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

    const mechanicData = {
      name: name.trim(),
      phone: phone.trim(),
      status
    }

    const mechanic = await prisma.mechanic.create({
      data: mechanicData,
    })

    res.status(201).json(mechanic)
  } catch (error) {
    console.error('Create mechanic error:', error)
    res.status(500).json({
      message: 'Failed to create mechanic',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
