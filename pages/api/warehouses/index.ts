import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check if this is a request for individual warehouse operations
  const { id } = req.query

  if (id && (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE')) {
    return handleIndividualWarehouse(req, res, id)
  }

  // Otherwise handle list operations
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
      status = 'Active',
      includeInactive = 'false' // New parameter to include inactive warehouses
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    if (search) {
      const searchTerm = search as string
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { location: { contains: searchTerm, mode: 'insensitive' } }
      ]
    }

    // Filter active warehouses by default unless explicitly requested to include inactive
    // Use exact match for status to leverage index
    if (includeInactive !== 'true') {
      where.status = status as string || 'Active'
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

    res.status(201).json({
      status: "success",
      message: "Warehouse created successfully"
    })
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

    res.status(200).json({
      status: "success",
      message: "Warehouse updated successfully"
    })
  } catch (error) {
    console.error('Warehouse update error:', error)
    res.status(500).json({
      message: 'Failed to update warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// Handle individual warehouse operations when id query parameter is provided
async function handleIndividualWarehouse(req: NextApiRequest, res: NextApiResponse, id: string | string[]) {
  const warehouseId = parseInt(Array.isArray(id) ? id[0] : id)

  if (isNaN(warehouseId)) {
    return res.status(400).json({ message: 'Invalid warehouse ID' })
  }

  switch (req.method) {
    case 'GET':
      return handleIndividualGet(req, res, warehouseId)
    case 'PUT':
      return handleIndividualPut(req, res, warehouseId)
    case 'DELETE':
      return handleIndividualDelete(req, res, warehouseId)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

// GET /api/warehouses?id={id} - Get warehouse details
async function handleIndividualGet(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId }
    })

    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' })
    }

    res.status(200).json(warehouse)
  } catch (error) {
    console.error('Get warehouse error:', error)
    res.status(500).json({
      message: 'Failed to fetch warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// PUT /api/warehouses?id={id} - Update warehouse
async function handleIndividualPut(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const {
      name,
      location,
      status
    } = req.body

    // Validation - at least one field must be provided
    if (name === undefined && location === undefined && status === undefined) {
      return res.status(400).json({ message: 'At least one field (name, location, or status) must be provided' })
    }

    const updateData: any = {}

    if (name !== undefined) updateData.name = name.trim()
    if (location !== undefined) updateData.location = location.trim()
    if (status !== undefined) updateData.status = status

    // Check for name conflicts if name is being updated
    if (name !== undefined) {
      const existingWarehouse = await prisma.warehouse.findFirst({
        where: {
          name: name.trim(),
          id: { not: warehouseId }
        }
      })

      if (existingWarehouse) {
        return res.status(400).json({
          message: 'Another warehouse with this name already exists'
        })
      }
    }

    const updatedWarehouse = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: updateData,
    })

    res.status(200).json({
      status: "success",
      message: "Warehouse updated successfully"
    })
  } catch (error) {
    console.error('Update warehouse error:', error)
    res.status(500).json({
      message: 'Failed to update warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// DELETE /api/warehouses?id={id} - Soft delete warehouse (set status to Inactive)
async function handleIndividualDelete(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    // Check if warehouse exists
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId }
    })

    if (!warehouse) {
      return res.status(404).json({ message: 'Warehouse not found' })
    }

    // Soft delete - just change status to Inactive
    const deactivatedWarehouse = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { status: 'Inactive' },
    })

    res.status(200).json({
      status: "success",
      message: "Warehouse deactivated successfully"
    })
  } catch (error) {
    console.error('Delete warehouse error:', error)
    res.status(500).json({
      message: 'Failed to deactivate warehouse',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
