import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'
import { withObservability } from '../../../../lib/withObservability'
import { ok, badRequest, notFound, fail, parseId, methodNotAllowed } from '../../../../lib/api/respond'

/**
 * PUT /api/financial-years/[id]/current - make this the open financial year.
 *
 * S-46: this used to be a PUT to the collection carrying `{fyId}`, while the
 * save path POSTed a whole record to the same URL - one endpoint, two unrelated
 * operations, told apart by which fields happened to be present. That is the
 * same shape as the warehouse PUT (S-20) and the gst-rate status branch (S-66).
 *
 * Choosing the open financial year is a state transition, like activating a
 * record, so it gets its own route - the rule F-91 established.
 *
 * The collection PUT still works, so nothing breaks while callers move over.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return methodNotAllowed(res, ['PUT', 'PATCH'])
  }

  const id = parseId(req.query.id)
  if (id === null) return badRequest(res, 'A valid financial year ID is required')

  try {
    const fy = await prisma.financial_year.findUnique({ where: { id } })
    if (!fy) return notFound(res, 'Financial year not found')

    // The open year must actually contain today: stamping documents into a year
    // that has not started, or closed months ago, is F-37.
    const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const now = new Date()
    if (now < atMidnight(fy.start_date)) {
      return badRequest(res, `Cannot set FY ${fy.fy} as current: it has not started yet`)
    }
    if (now > atMidnight(fy.end_date)) {
      return badRequest(res, `Cannot set FY ${fy.fy} as current: it ended on ${atMidnight(fy.end_date).toLocaleDateString()}`)
    }

    // Ordered, so "the settings row" is deterministic (S-81).
    const settings = await prisma.settings.findFirst({ orderBy: { id: 'asc' } })
    if (settings) {
      await prisma.settings.update({ where: { id: settings.id }, data: { currentfy: id } })
    } else {
      await prisma.settings.create({ data: { currentfy: id } })
    }

    return ok(res, {
      status: 'success',
      message: `Financial year ${fy.fy} set as current`,
      data: { id: fy.id, fy: fy.fy },
    })
  } catch (error) {
    return fail(res, error, 'set the current financial year')
  }
}

export default withObservability(handler)
