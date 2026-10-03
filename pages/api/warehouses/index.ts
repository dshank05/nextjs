import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { created, fail } from '../../../lib/api/respond'

async function handler(
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
      includeInactive = 'false', // New parameter to include inactive warehouses
      sortBy = 'name',
      sortOrder = 'asc',
      dropdown = 'false'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // `dropdown=true` returns every active row, unpaginated. A picker that
    // silently shows only the first page is worse than one that is slow: the
    // entry is simply absent, with nothing to indicate it was cut off (F-58/F-64).
    const isDropdown = dropdown === 'true'

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['id', 'name', 'location', 'status']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'name'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Build where clause
    const where: any = {}

    if (search) {
      const searchTerm = search as string
      where.OR = [
        { name: { contains: searchTerm } },
        { location: { contains: searchTerm } }
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
        ...(isDropdown ? {} : { skip, take: limitNum }),
        orderBy: { [sortField]: sortDirection }
      }),
      prisma.warehouse.count({ where })
    ])

    // Never 0: an empty list is page 1 of 1.
    const totalPages = Math.max(1, Math.ceil(total / limitNum))

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
    return fail(res, error, 'fetch warehouses')
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { status = 'Active' } = req.body
    // Trimmed, as PUT does: "   " is no name, and "Main " is "Main".
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const location = typeof req.body.location === 'string' ? req.body.location.trim() : ''

    // Validation
    if (!name || !location) {
      return res.status(400).json({
        message: 'Name and location are required'
      })
    }

    // S-24: `status` was taken straight from the body and stored, so
    // `status: 'Banana'` became a warehouse that is neither Active nor Inactive
    // and therefore invisible to every filter.
    if (status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: "Status must be 'Active' or 'Inactive'" })
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

    return created(res, warehouse, 'Warehouse created successfully')
  } catch (error) {
    return fail(res, error, 'create the warehouse')
  }
}

/**
 * PUT /api/warehouses with the id in the BODY.
 *
 * This used to read only `{id, name, location}` and write only those two
 * columns, under the comment "Status not updated - all warehouses are active".
 * That comment was false: the settings page has a Deactivate button and the
 * column holds 'Inactive'. So a PUT carrying `status: 'Inactive'` was answered
 * **200 "updated successfully"** and the row stayed Active (S-19).
 *
 * It is now a partial update - it writes what it is given and leaves the rest
 * alone - which also removes the trap in the page: `handleEdit` never loads
 * `status` into its form, so an edit sends `{id, name, location}` and must not
 * be read as "set status to nothing" (S-21).
 *
 * The id still comes from the body here, and from the query in
 * `handleIndividualPut`. Collapsing those two onto one path-segment route is
 * S-20 and belongs with the API convention work, not with this fix.
 */
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, name, location, status } = req.body

    // Validation
    if (!id) {
      return res.status(400).json({
        message: 'ID is required'
      })
    }

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ message: 'Name cannot be empty' })
    }

    if (location !== undefined && (typeof location !== 'string' || !location.trim())) {
      return res.status(400).json({ message: 'Location cannot be empty' })
    }

    if (status !== undefined && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: "Status must be 'Active' or 'Inactive'" })
    }

    if (name === undefined && location === undefined && status === undefined) {
      return res.status(400).json({
        message: 'At least one field (name, location or status) must be supplied'
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
    if (name !== undefined) {
      const duplicateWarehouse = await prisma.warehouse.findFirst({
        where: {
          name: name.trim(),
          id: { not: parseInt(id) }
        }
      })

      if (duplicateWarehouse) {
        return res.status(400).json({
          message: 'Another warehouse with this name already exists'
        })
      }
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name.trim()
    if (location !== undefined) updateData.location = location.trim()
    if (status !== undefined) updateData.status = status

    await prisma.warehouse.update({
      where: { id: parseInt(id) },
      data: updateData
    })

    res.status(200).json({
      status: "success",
      message: "Warehouse updated successfully"
    })
  } catch (error) {
    return fail(res, error, 'update warehouse')
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
    return fail(res, error, 'fetch warehouse')
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
    if (status !== undefined && status !== 'Active' && status !== 'Inactive') {
      return res.status(400).json({ message: "Status must be 'Active' or 'Inactive'" })
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

    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: updateData,
    })

    res.status(200).json({
      status: "success",
      message: "Warehouse updated successfully"
    })
  } catch (error) {
    return fail(res, error, 'update warehouse')
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
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { status: 'Inactive' },
    })

    res.status(200).json({
      status: "success",
      message: "Warehouse deactivated successfully"
    })
  } catch (error) {
    return fail(res, error, 'deactivate warehouse')
  }
}


export default withObservability(handler)