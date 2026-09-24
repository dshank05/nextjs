import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { ok, updated, badRequest, notFound, fail, parseId, route } from '../../../../lib/api/respond'

/**
 * GET / PUT / DELETE /api/warehouses/[warehouseId]
 *
 * S-22: a warehouse could be fetched, updated and soft-deleted only through
 * `/api/warehouses?id=4`, so `DELETE /api/warehouses/4` answered 404 while
 * `/api/warehouses/4/racks` worked - one resource, two routing conventions, and
 * the obvious URL was the broken one.
 *
 * `staff/[id].ts` is the shape being matched. The query-parameter form on
 * `/api/warehouses` still works so nothing breaks while callers move over.
 */
async function handleGet(res: NextApiResponse, id: number) {
  try {
    const warehouse = await prisma.warehouse.findUnique({ where: { id } })
    if (!warehouse) return notFound(res, 'Warehouse not found')
    return ok(res, warehouse)
  } catch (error) {
    return fail(res, error, 'fetch the warehouse')
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, id: number) {
  try {
    const { name, location, status } = req.body ?? {}

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return badRequest(res, 'Name cannot be empty')
    }
    if (location !== undefined && (typeof location !== 'string' || !location.trim())) {
      return badRequest(res, 'Location cannot be empty')
    }
    if (status !== undefined && status !== 'Active' && status !== 'Inactive') {
      return badRequest(res, "Status must be 'Active' or 'Inactive'")
    }
    if (name === undefined && location === undefined && status === undefined) {
      return badRequest(res, 'At least one field (name, location or status) must be supplied')
    }

    const existing = await prisma.warehouse.findUnique({ where: { id } })
    if (!existing) return notFound(res, 'Warehouse not found')

    if (name !== undefined) {
      const clash = await prisma.warehouse.findFirst({
        where: { name: name.trim(), id: { not: id } },
        select: { id: true },
      })
      if (clash) return badRequest(res, 'Another warehouse with this name already exists')
    }

    const data: any = {}
    if (name !== undefined) data.name = name.trim()
    if (location !== undefined) data.location = location.trim()
    if (status !== undefined) data.status = status

    const row = await prisma.warehouse.update({ where: { id }, data })
    return updated(res, row, 'Warehouse updated successfully')
  } catch (error) {
    return fail(res, error, 'update the warehouse')
  }
}

async function handleDelete(res: NextApiResponse, id: number) {
  try {
    const existing = await prisma.warehouse.findUnique({ where: { id } })
    if (!existing) return notFound(res, 'Warehouse not found')

    // Soft delete, like staff and mechanics: a warehouse is referenced by
    // products and racks, so removing the row would orphan them.
    const row = await prisma.warehouse.update({
      where: { id },
      data: { status: 'Inactive' },
    })
    return updated(res, row, 'Warehouse deactivated successfully')
  } catch (error) {
    return fail(res, error, 'deactivate the warehouse')
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = parseId(req.query.warehouseId)
  if (id === null) return badRequest(res, 'A valid warehouse ID is required')

  return route(req, res, {
    GET: () => handleGet(res, id),
    PUT: () => handlePut(req, res, id),
    DELETE: () => handleDelete(res, id),
  })
}

export default withObservability(handler)
