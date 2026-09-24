import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { created, fail, parseId } from '../../../../lib/api/respond'

/**
 * S-69: every query in this file used to go through `(prisma as any)`, which
 * switches off type checking for the whole model - field names, filters and
 * results alike. It was not necessary: `warehouse_racks` is on the generated
 * client, as is `product`, which was also being cast. The cast was habit.
 */

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
      prisma.warehouse_racks.findMany({
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
      prisma.warehouse_racks.count({ where })
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
    return fail(res, error, 'fetch warehouse racks')
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
    const rackNumberConflict = await prisma.warehouse_racks.findFirst({
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

    const rack = await prisma.warehouse_racks.create({
      data: {
        warehouse_id: warehouseId,
        rack_number: rack_number.trim(),
        description: description?.trim() || null,
        status
      }
    })

    return created(res, rack, 'Rack created successfully')
  } catch (error) {
    return fail(res, error, 'create the rack')
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, warehouseId: number) {
  try {
    const { id, warehouse_id, rack_number, description, status } = req.body

    // Validation - require ID (S-88: parseId, not a bare parseInt)
    const rackId = parseId(id)
    if (rackId === null) {
      return res.status(400).json({
        message: 'A valid rack ID is required'
      })
    }

    // Determine target warehouse (from body or URL)
    const targetWarehouseId = warehouse_id ? parseInt(warehouse_id) : warehouseId

    // Check if rack exists AND belongs to the warehouse in the URL.
    //
    // This used to be a findUnique on the id alone, justified by the rack
    // possibly being moved to another warehouse. That is backwards: the URL
    // names the warehouse that currently owns the rack, and the body's
    // `warehouse_id` is the destination. Looking up by id alone meant
    // PUT /api/warehouses/5/racks with { id: 99 } edited rack 99 even when it
    // lived in warehouse 7 - the URL segment was decorative (F-32). A move
    // still works, because only the lookup is scoped, not the update.
    // handleDelete below already did it this way.
    const existingRack = await prisma.warehouse_racks.findFirst({
      where: {
        id: rackId,
        warehouse_id: warehouseId
      }
    })

    if (!existingRack) {
      return res.status(404).json({
        message: 'Rack not found in this warehouse'
      })
    }

    // Check if target warehouse exists (if warehouse is being changed).
    // Compare parsed numbers - `warehouse_id` arrives from JSON as a string, so
    // comparing it directly against a number was always unequal.
    if (warehouse_id && targetWarehouseId !== warehouseId) {
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
    if (warehouse_id && targetWarehouseId !== existingRack.warehouse_id) {
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
      const rackNumberConflict = await prisma.warehouse_racks.findFirst({
        where: {
          warehouse_id: targetWarehouseId,
          rack_number: rack_number.trim(),
          id: { not: rackId }
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

    const updatedRack = await prisma.warehouse_racks.update({
      where: { id: rackId },
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
    // S-83: this read the id from the QUERY while PUT above reads it from the
    // BODY, in one file. Both are accepted now, so a caller does not have to
    // know which verb changed its mind.
    const rawId = req.query.rackId ?? req.body?.id
    const rackId = parseId(rawId)

    if (rackId === null) {
      return res.status(400).json({
        message: 'A valid rack ID is required'
      })
    }

    // Check if rack exists and belongs to this warehouse
    const existingRack = await prisma.warehouse_racks.findFirst({
      where: {
        id: rackId,
        warehouse_id: warehouseId
      }
    })

    if (!existingRack) {
      return res.status(404).json({
        message: 'Rack not found in this warehouse'
      })
    }

    // Check if rack has products assigned
    const productsCount = await prisma.product.count({
      where: { rack_id: rackId }
    })

    if (productsCount > 0) {
      return res.status(400).json({
        message: `Cannot delete rack. ${productsCount} product(s) are assigned to this rack.`
      })
    }

    await prisma.warehouse_racks.delete({
      where: { id: rackId }
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
