import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { warehouseId } = req.query
  const warehouseIdNum = parseInt(warehouseId as string)

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, warehouseIdNum)
    case 'POST':
      return handlePost(req, res, warehouseIdNum)
    case 'PUT':
      return handlePut(req, res, warehouseIdNum)
    case 'DELETE':
      return handleDelete(req, res, warehouseIdNum)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const {
      page = '1',
      limit = '50',
      search = ''
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = { warehouse_id: warehouseId }

    if (search) {
      where.rack_number = { contains: search as string }
    }

    const [racks, total] = await Promise.all([
      (prisma as any).warehouse_racks.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { rack_number: 'asc' }
      }),
      (prisma as any).warehouse_racks.count({ where })
    ])

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      racks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Warehouse racks fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch warehouse racks',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const { rack_number, description, status = 'Active' } = req.body

    // Validation
    if (!rack_number || !rack_number.trim()) {
      return res.status(400).json({
        message: 'Rack number is required'
      })
    }

    // Check if warehouse exists
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId }
    })

    if (!warehouse) {
      return res.status(404).json({
        message: 'Warehouse not found'
      })
    }

    // Check if rack number already exists for this warehouse
    const existingRack = await (prisma as any).warehouse_racks.findFirst({
      where: {
        warehouse_id: warehouseId,
        rack_number: rack_number.trim()
      }
    })

    if (existingRack) {
      return res.status(400).json({
        message: 'A rack with this number already exists in this warehouse'
      })
    }

    const rack = await (prisma as any).warehouse_racks.create({
      data: {
        warehouse_id: warehouseId,
        rack_number: rack_number.trim(),
        description: description?.trim() || null,
        status
      }
    })

    res.status(201).json({
      status: "success",
      message: "Rack created successfully"
    })
  } catch (error) {
    console.error('Warehouse rack creation error:', error)
    res.status(500).json({
      message: 'Failed to create warehouse rack',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const { id, rack_number, description, status } = req.body

    // Validation - require ID
    if (!id) {
      return res.status(400).json({
        message: 'Rack ID is required'
      })
    }

    // Check if rack exists and belongs to this warehouse
    const existingRack = await (prisma as any).warehouse_racks.findFirst({
      where: {
        id: parseInt(id),
        warehouse_id: warehouseId
      }
    })

    if (!existingRack) {
      return res.status(404).json({
        message: 'Rack not found in this warehouse'
      })
    }

    const updateData: any = {}

    // Handle rack_number and description updates (full edit)
    if (rack_number !== undefined) {
      if (!rack_number || !rack_number.trim()) {
        return res.status(400).json({
          message: 'Rack number is required'
        })
      }

      // Check for duplicates only if rack_number is being updated
      const duplicateRack = await (prisma as any).warehouse_racks.findFirst({
        where: {
          warehouse_id: warehouseId,
          rack_number: rack_number.trim(),
          id: { not: parseInt(id) }
        }
      })

      if (duplicateRack) {
        return res.status(400).json({
          message: 'Another rack with this number already exists in this warehouse'
        })
      }

      updateData.rack_number = rack_number.trim()
    }

    // Handle description updates
    if (description !== undefined) {
      updateData.description = description?.trim() || null
    }

    // Handle status updates
    if (status !== undefined) {
      updateData.status = status
    }

    // Ensure at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        message: 'At least one field must be updated'
      })
    }

    const updatedRack = await (prisma as any).warehouse_racks.update({
      where: { id: parseInt(id) },
      data: updateData
    })

    res.status(200).json({
      status: "success",
      message: "Rack updated successfully"
    })
  } catch (error) {
    console.error('Warehouse rack update error:', error)
    res.status(500).json({
      message: 'Failed to update warehouse rack',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const { rackId } = req.query

    if (!rackId) {
      return res.status(400).json({
        message: 'Rack ID is required'
      })
    }

    // Check if rack exists and belongs to this warehouse
    const existingRack = await (prisma as any).warehouse_racks.findFirst({
      where: {
        id: parseInt(rackId as string),
        warehouse_id: warehouseId
      }
    })

    if (!existingRack) {
      return res.status(404).json({
        message: 'Rack not found in this warehouse'
      })
    }

    // Check if rack has products assigned
    const productsCount = await (prisma as any).product.count({
      where: { rack_id: parseInt(rackId as string) }
    })

    if (productsCount > 0) {
      return res.status(400).json({
        message: `Cannot delete rack. ${productsCount} product(s) are assigned to this rack.`
      })
    }

    await (prisma as any).warehouse_racks.delete({
      where: { id: parseInt(rackId as string) }
    })

    res.status(200).json({
      status: "success",
      message: "Rack deleted successfully"
    })
  } catch (error) {
    console.error('Warehouse rack delete error:', error)
    res.status(500).json({
      message: 'Failed to delete warehouse rack',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
