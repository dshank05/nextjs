import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'

async function handler(
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

    const searchTerm = (search as string).trim()

    let where: any = {}

    // If search term exists, create a more comprehensive search
    if (searchTerm) {
      where = {
        AND: [
          { warehouse_id: warehouseId }, // Always filter by warehouse_id
          {
            OR: [
              // Search in rack fields
              { rack_number: { contains: searchTerm } },
              { description: { contains: searchTerm } },
              { status: { contains: searchTerm } },
              // Search in warehouse name through relationship
              {
                warehouse: {
                  name: { contains: searchTerm }
                }
              },
              {
                warehouse: {
                  location: { contains: searchTerm }
                }
              }
            ]
          }
        ]
      }
    } else {
      // No search term, just filter by warehouse_id
      where = { warehouse_id: warehouseId }
    }

    const [racks, total] = await Promise.all([
      (prisma as any).warehouse_racks.findMany({
        where,
        include: {
          warehouse: {
            select: {
              name: true,
              location: true
            }
          }
        },
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
    const rackNumberConflict = await (prisma as any).warehouse_racks.findFirst({
      where: {
        warehouse_id: warehouseId,
        rack_number: rack_number.trim()
      }
    })

    if (rackNumberConflict) {
      return res.status(400).json({
        message: 'Rack number already exists in this warehouse'
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
    const { id, warehouse_id, rack_number, description, status } = req.body

    // Validation - require ID
    if (!id) {
      return res.status(400).json({
        message: 'Rack ID is required'
      })
    }

    // Determine target warehouse (from body or URL)
    const targetWarehouseId = warehouse_id ? parseInt(warehouse_id) : warehouseId

    // Check if rack exists (may belong to different warehouse if being moved)
    const existingRack = await (prisma as any).warehouse_racks.findUnique({
      where: { id: parseInt(id) }
    })

    if (!existingRack) {
      return res.status(404).json({
        message: 'Rack not found'
      })
    }

    // Check if target warehouse exists (if warehouse is being changed)
    if (warehouse_id && warehouse_id !== warehouseId) {
      const targetWarehouse = await prisma.warehouse.findUnique({
        where: { id: targetWarehouseId }
      })

      if (!targetWarehouse) {
        return res.status(404).json({
          message: 'Target warehouse not found'
        })
      }
    }

    const updateData: any = {}

    // Handle warehouse change
    if (warehouse_id && warehouse_id !== existingRack.warehouse_id) {
      updateData.warehouse_id = targetWarehouseId
    }

    // Handle rack_number updates
    if (rack_number !== undefined) {
      if (!rack_number || !rack_number.trim()) {
        return res.status(400).json({
          message: 'Rack number is required'
        })
      }

      // Check for rack number conflicts in target warehouse
      const rackNumberConflict = await (prisma as any).warehouse_racks.findFirst({
        where: {
          warehouse_id: targetWarehouseId,
          rack_number: rack_number.trim(),
          id: { not: parseInt(id) }
        }
      })

      if (rackNumberConflict) {
        return res.status(400).json({
          message: 'Rack number already exists in this warehouse'
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

export default withObservability(handler)
