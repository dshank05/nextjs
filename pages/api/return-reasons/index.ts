import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { ok, fail, route } from '../../../lib/api/respond'
import {
  parseListQuery,
  paginationArgs,
  orderByArgs,
  buildPagination,
  listResponse,
} from '../../../lib/api/list-query'

/**
 * GET /api/return-reasons
 *
 * S-54: this read exactly one query parameter, `type`, and ignored `page`,
 * `limit`, `search`, `sortBy` and `sortOrder` entirely - so it answered every
 * request with the whole table. Measured against the running app: `limit=1`
 * returned 4 rows, page 2 repeated page 1, `sortOrder=desc` changed nothing and
 * a nonsense search returned everything.
 *
 * Nothing was broken by that, because the only consumers are the return flows
 * and there are four reasons. It is fixed because "this list endpoint ignores
 * the list parameters" is exactly the assumption that stops being true when
 * somebody adds a fiftieth reason.
 *
 * `data` and `success` are unchanged, so the existing callers are unaffected;
 * `pagination` is additive.
 *
 * Still open: F-50 - these are consumed by the sale and purchase return flows
 * but can only be changed by running a seed script, because there is no
 * settings page and no write endpoint.
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const list = parseListQuery(req, {
      sortFields: ['id', 'reason_name', 'type', 'status'],
      defaultSort: 'reason_name',
      defaultOrder: 'asc',
    })

    const typeParam = req.query.type
    const type = typeof typeParam === 'string' && typeParam ? typeParam : 'purchase'

    const where: any = { type }
    // Active only unless asked otherwise, matching every other settings list.
    if (!list.includeInactive) where.status = 'Active'
    if (list.search) where.reason_name = { contains: list.search }

    const [rows, total] = await Promise.all([
      prisma.return_reasons.findMany({
        where,
        select: { id: true, reason_name: true, type: true, status: true },
        orderBy: orderByArgs(list),
        ...paginationArgs(list),
      }),
      prisma.return_reasons.count({ where }),
    ])

    return ok(res, {
      success: true,
      ...listResponse(rows, buildPagination(list, total)),
    })
  } catch (error) {
    return fail(res, error, 'fetch return reasons')
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  return route(req, res, { GET: () => handleGet(req, res) })
}

export default withObservability(handler)
