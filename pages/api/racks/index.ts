import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { ok, fail, route } from '../../../lib/api/respond'
import {
  parseListQuery,
  paginationArgs,
  buildPagination,
  listResponse,
} from '../../../lib/api/list-query'

/**
 * GET /api/racks - every rack, across every warehouse.
 *
 * S-37 / S-77: this did not exist, so the settings page had to fake it. It
 * looped over the warehouse list issuing one `/api/warehouses/{id}/racks`
 * request per warehouse, each hardcoded to `limit: 1000`, concatenated the
 * results, then sorted and paginated **in the browser** - while the per-warehouse
 * endpoint it was calling already paginates and the database can sort. The cost
 * grew linearly with the number of warehouses, and three separate defects fell
 * out of the workaround:
 *
 * - `total` was summed from each warehouse's server-side count while the rows
 *   were capped at 1000 each, so the two could disagree (S-39).
 * - racks in the 51st warehouse onward were invisible, because the warehouse
 *   list itself was paginated (S-38).
 * - the warehouse name was resolved one way for the table and another for the
 *   export (S-64).
 *
 * The per-warehouse route stays: it is the right shape for "the racks in THIS
 * warehouse", and it is what the create and update paths address.
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const list = parseListQuery(req, {
      // `warehouse_name` is not a column; it is handled below as a nested sort.
      sortFields: ['id', 'rack_number', 'status', 'warehouse_id', 'warehouse_name'],
      defaultSort: 'rack_number',
      defaultOrder: 'asc',
    })

    const where: any = {}

    const warehouseId = parseInt(String(req.query.warehouseId ?? ''), 10)
    if (Number.isInteger(warehouseId) && warehouseId > 0) {
      where.warehouse_id = warehouseId
    }

    if (!list.includeInactive) where.status = 'Active'

    if (list.search) {
      where.OR = [
        { rack_number: { contains: list.search } },
        { description: { contains: list.search } },
        { warehouse: { name: { contains: list.search } } },
        { warehouse: { location: { contains: list.search } } },
      ]
    }

    // Sorting by the warehouse's name goes through the relation rather than the
    // foreign key - the page shows the name, so ordering by the id would order
    // by something the user cannot see (S-65).
    const orderBy =
      list.sortField === 'warehouse_name'
        ? { warehouse: { name: list.sortOrder } }
        : { [list.sortField]: list.sortOrder }

    const [rows, total] = await Promise.all([
      prisma.warehouse_racks.findMany({
        where,
        include: { warehouse: { select: { name: true, location: true } } },
        orderBy,
        ...paginationArgs(list),
      }),
      prisma.warehouse_racks.count({ where }),
    ])

    // Flattened alongside the relation, so the table and the export read the
    // same field instead of deriving the name two different ways (S-64).
    const racks = rows.map((rack) => ({
      ...rack,
      warehouse_name: rack.warehouse?.name ?? null,
      warehouse_location: rack.warehouse?.location ?? null,
    }))

    return ok(res, listResponse(racks, buildPagination(list, total), 'racks'))
  } catch (error) {
    return fail(res, error, 'fetch racks')
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  return route(req, res, { GET: () => handleGet(req, res) })
}

export default withObservability(handler)
