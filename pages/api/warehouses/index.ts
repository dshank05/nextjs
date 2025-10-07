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
      status = 'Active'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { location: { contains: search as string } }
      ]
    }

    if (status && status !== '') {
      where.status = status as string
    }

    const [warehouses, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { name: 'asc' }
      }),
      prisma.warehouse.count({ where })
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      warehouses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Warehouses fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch warehouses',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { name, location, status = 'Active' } = req.body

    // Validation
    if (!name || !location) {
      return res.status(400).json({
        message: 'Name and location are required'
      })
    }

    // Check if warehouse with same name already exists
    const existingWarehouse = await prisma.warehouse.findFirst({
      where: { name }
    })

    if (existingWarehouse) {
      return res.status(400).json({
        message: 'Warehouse with this name already exists'
      })
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        name,
        location,
        status
      }
    })

    res.status(201).json(warehouse)
  } catch (error) {
    console.error('Warehouse creation error:', error)
    res.status(500).json({
      message: 'Failed to create warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, name, location } = req.body

    // Validation
    if (!id || !name || !location) {
      return res.status(400).json({
        message: 'ID, name, and location are required'
      })
    }

    // Check if warehouse exists
    const existingWarehouse = await prisma.warehouse.findUnique({
      where: { id: parseInt(id) }
    })

    if (!existingWarehouse) {
      return res.status(404).json({
        message: 'Warehouse not found'
      })
    }

    // Check if another warehouse with same name exists (excluding current one)
    const duplicateWarehouse = await prisma.warehouse.findFirst({
      where: {
        name,
        id: { not: parseInt(id) }
      }
    })

    if (duplicateWarehouse) {
      return res.status(400).json({
        message: 'Another warehouse with this name already exists'
      })
    }

    const updatedWarehouse = await prisma.warehouse.update({
      where: { id: parseInt(id) },
      data: {
        name,
        location
        // Status not updated - all warehouses are active
      }
    })

    res.status(200).json(updatedWarehouse)
  } catch (error) {
    console.error('Warehouse update error:', error)
    res.status(500).json({
      message: 'Failed to update warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
